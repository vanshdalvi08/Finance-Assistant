import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { companySettingsTable, idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import {
  DAY_KEYS,
  type BusinessStore,
  type DayKey,
  type HolidayRecord,
  type LeaveRequestKind,
  type LeaveRequestRecord,
  type LeavePolicyRecord,
  type LeaveRequestStatus,
  type TimesheetEntry,
  blankHours,
  createId,
  loadEmployeeProfile,
  loadEmployees,
  normalizeDate,
  normalizeWeekStart,
  nowIso,
  pushAuditEvent,
  reconcileDailyReviewState,
  readStore,
  reviewTimesheetFast,
  saveTimesheetFast,
  setTimesheetDayReviewStatusFast,
  submitTimesheetEntryFast,
  submitTimesheetFast,
  sumTimesheetHours,
  TaskHourLimitError,
  TaskWindowError,
  updateStore,
} from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { assertTenantEmployeeAccess } from "../../lib/policies";
import { hashSha256 } from "../../lib/security";
import { WorkflowStateError } from "../../lib/workflow-state";
import { appEvents } from "../../lib/events";
import { rateLimit } from "../../middlewares/rate-limit";

const router: IRouter = Router();
const timesheetReviewLimiter = rateLimit({
  name: "timesheet-review",
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: "Too many timesheet review actions. Please wait and retry.",
});

const dateSchema = z.string().min(1);
const businessIdSchema = z.string().trim().min(1);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);
const dayKeySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const timesheetLineSchema = z.object({
  id: businessIdSchema.optional(),
  project: z.string().trim().optional(),
  task: z.string().trim().optional(),
  projectBudgetId: businessIdSchema.optional(),
  projectTaskId: businessIdSchema.optional(),
  subTask: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  workNotes: z
    .object({
      mon: z.string().trim().max(500).optional(),
      tue: z.string().trim().max(500).optional(),
      wed: z.string().trim().max(500).optional(),
      thu: z.string().trim().max(500).optional(),
      fri: z.string().trim().max(500).optional(),
      sat: z.string().trim().max(500).optional(),
      sun: z.string().trim().max(500).optional(),
    })
    .optional(),
  hours: z.object({
    mon: z.coerce.number().min(0).optional(),
    tue: z.coerce.number().min(0).optional(),
    wed: z.coerce.number().min(0).optional(),
    thu: z.coerce.number().min(0).optional(),
    fri: z.coerce.number().min(0).optional(),
    sat: z.coerce.number().min(0).optional(),
    sun: z.coerce.number().min(0).optional(),
  }),
});

const timesheetSchema = z.object({
  id: businessIdSchema.optional(),
  employeeId: z.string().uuid(),
  employeeNameSnapshot: z.string().trim().optional(),
  weekStart: dateSchema,
  status: approvalStatusSchema.optional(),
  submittedAt: dateSchema.optional(),
  reviewedAt: dateSchema.optional(),
  reviewedBy: z.string().trim().optional(),
  reviewNotes: z.string().trim().optional(),
  dailyReviewStatus: z
    .object({
      mon: z.enum(["reviewed", "reverted"]).optional(),
      tue: z.enum(["reviewed", "reverted"]).optional(),
      wed: z.enum(["reviewed", "reverted"]).optional(),
      thu: z.enum(["reviewed", "reverted"]).optional(),
      fri: z.enum(["reviewed", "reverted"]).optional(),
      sat: z.enum(["reviewed", "reverted"]).optional(),
      sun: z.enum(["reviewed", "reverted"]).optional(),
    })
    .optional(),
  dailyReviewNotes: z
    .object({
      mon: z.string().trim().max(1000).optional(),
      tue: z.string().trim().max(1000).optional(),
      wed: z.string().trim().max(1000).optional(),
      thu: z.string().trim().max(1000).optional(),
      fri: z.string().trim().max(1000).optional(),
      sat: z.string().trim().max(1000).optional(),
      sun: z.string().trim().max(1000).optional(),
    })
    .optional(),
  lines: z.array(timesheetLineSchema).min(1),
});

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

class TimesheetIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

function handleWorkflowStateError(error: unknown, response: Response) {
  if (!(error instanceof WorkflowStateError)) {
    throw error;
  }

  response.status(409).json({ message: error.message });
  return true;
}

function handleTaskHourLimitError(error: unknown, response: Response) {
  const taskHourLimitError =
    error instanceof TaskHourLimitError
      ? error
      : error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code === "task_hour_limit"
        ? (error as { message?: string })
        : null;

  if (!taskHourLimitError) {
    const taskWindowError =
      error instanceof TaskWindowError
        ? error
        : error &&
              typeof error === "object" &&
              "code" in error &&
              (error as { code?: unknown }).code === "task_window"
          ? (error as { message?: string })
          : null;

    if (!taskWindowError) {
      throw error;
    }

    response.status(400).json({ message: taskWindowError.message ?? "Task date window violated." });
    return true;
  }

  response.status(400).json({ message: taskHourLimitError.message ?? "Task hour limit exceeded." });
  return true;
}

function handleTimesheetIdempotencyError(error: unknown, response: Response) {
  const conflictError =
    error instanceof TimesheetIdempotencyError
      ? error
      : error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "conflict"
        ? (error as { message?: string })
        : null;

  if (!conflictError) {
    throw error;
  }

  response.status(409).json({ message: conflictError.message ?? "Conflicting idempotency request." });
  return true;
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    logger.warn({ err: error }, "Failed to deliver notification");
  });
  return Promise.resolve();
}

function idempotencyKeyFrom(request: Request) {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  return header?.trim() || undefined;
}

function requestHashForTimesheetReview(input: { timesheetId: string; status: "approved" | "rejected"; note?: string }) {
  return hashSha256(
    JSON.stringify({
      timesheetId: input.timesheetId.trim(),
      status: input.status,
      note: input.note?.trim() ?? "",
    }),
  );
}

async function claimTimesheetReviewIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: "timesheet_review" | "timesheet_submit" | "timesheet_create" | "timesheet_update" | "timesheet_delete",
  key: string,
  requestHash: string,
) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
      scope,
      keyHash,
      requestHash,
      status: "processing",
      createdById: actor.userId ?? null,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .returning();

  if (insertedRows[0]) {
    return { row: insertedRows[0], created: true };
  }

  const existingRows = await db
    .select()
    .from(idempotencyKeysTable)
    .where(
      and(
        eq(idempotencyKeysTable.tenantId, actor.tenantId),
        eq(idempotencyKeysTable.scope, scope),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new TimesheetIdempotencyError("Unable to acquire idempotency lock for this timesheet review request.");
  }
  if (row.requestHash !== requestHash) {
    throw new TimesheetIdempotencyError("This idempotency key is already used for a different timesheet review payload.");
  }

  return { row, created: false };
}

function requestHashForTimesheetMutation(input: {
  id?: string;
  employeeId: string;
  employeeNameSnapshot?: string;
  weekStart: string;
  lines: Array<{
    id?: string;
    project?: string;
    task?: string;
    notes?: string;
    workNotes?: Partial<Record<DayKey, string>>;
    projectBudgetId?: string;
    projectTaskId?: string;
    hours: Partial<Record<DayKey, number>>;
  }>;
}) {
  const normalizedLines = input.lines.map((line) => ({
    id: line.id?.trim() ?? "",
    project: line.project?.trim() ?? "",
    task: line.task?.trim() ?? "",
    notes: line.notes?.trim() ?? "",
    workNotes: Object.fromEntries(
      DAY_KEYS.map((day) => [day, line.workNotes?.[day]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
    ),
    projectBudgetId: line.projectBudgetId?.trim() ?? "",
    projectTaskId: line.projectTaskId?.trim() ?? "",
    hours: {
      mon: Number(line.hours.mon ?? 0),
      tue: Number(line.hours.tue ?? 0),
      wed: Number(line.hours.wed ?? 0),
      thu: Number(line.hours.thu ?? 0),
      fri: Number(line.hours.fri ?? 0),
      sat: Number(line.hours.sat ?? 0),
      sun: Number(line.hours.sun ?? 0),
    },
  }));

  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      employeeId: input.employeeId.trim(),
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() ?? "",
      weekStart: normalizeWeekStart(input.weekStart),
      lines: normalizedLines,
    }),
  );
}

function requestHashForTimesheetDelete(input: { timesheetId: string }) {
  return hashSha256(JSON.stringify({ timesheetId: input.timesheetId.trim() }));
}

function requestHashForTimesheetSubmitById(input: { timesheetId: string }) {
  return hashSha256(
    JSON.stringify({
      timesheetId: input.timesheetId.trim(),
    }),
  );
}

function requestHashForTimesheetSubmit(input: {
  employeeId: string;
  weekStart: string;
  lines: Array<{
    project?: string;
    task?: string;
    notes?: string;
    workNotes?: Partial<Record<DayKey, string>>;
    projectBudgetId?: string;
    projectTaskId?: string;
    hours: Partial<Record<DayKey, number>>;
  }>;
}) {
  const normalizedLines = input.lines.map((line) => ({
    project: line.project?.trim() ?? "",
    task: line.task?.trim() ?? "",
    notes: line.notes?.trim() ?? "",
    workNotes: Object.fromEntries(
      DAY_KEYS.map((day) => [day, line.workNotes?.[day]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
    ),
    projectBudgetId: line.projectBudgetId?.trim() ?? "",
    projectTaskId: line.projectTaskId?.trim() ?? "",
    hours: {
      mon: Number(line.hours.mon ?? 0),
      tue: Number(line.hours.tue ?? 0),
      wed: Number(line.hours.wed ?? 0),
      thu: Number(line.hours.thu ?? 0),
      fri: Number(line.hours.fri ?? 0),
      sat: Number(line.hours.sat ?? 0),
      sun: Number(line.hours.sun ?? 0),
    },
  }));

  return hashSha256(
    JSON.stringify({
      employeeId: input.employeeId.trim(),
      weekStart: normalizeWeekStart(input.weekStart),
      lines: normalizedLines,
    }),
  );
}

function scopedEmployeeId(request: Request, fallback?: string) {
  if (request.auth?.user.role === "employee") {
    return request.auth.user.id;
  }

  return fallback?.trim() || null;
}

function timesheetHasContent(entry: TimesheetEntry) {
  return entry.lines.some((line) => {
    const hasText =
      Boolean(line.project.trim() || line.task.trim() || line.notes?.trim()) ||
      DAY_KEYS.some((day) => Boolean(line.workNotes?.[day]?.trim()));
    const hasHours = DAY_KEYS.some((day) => Number(line.hours[day] ?? 0) > 0);
    return hasText || hasHours;
  });
}

function recordActor(request: Request): { actorUserId?: string; requestId?: string; tenantId: string; actorName: string; actorRole: ActorRole } {
  return {
    actorUserId: request.auth?.user.id,
    requestId: String(request.id),
    tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  };
}

function notificationActor(request: Request) {
  return {
    id: request.auth?.user.id,
    name: request.auth?.user.name ?? "System",
    role: request.auth?.user.role ?? "system",
    tenantId: request.auth?.user.tenantId,
  } as const;
}

function monthKeyFromDate(date: string) {
  return normalizeDate(date).slice(0, 7);
}

function isDateWithinRange(date: string, start: string, end: string) {
  const target = new Date(normalizeDate(date)).getTime();
  const startTime = new Date(normalizeDate(start)).getTime();
  const endTime = new Date(normalizeDate(end)).getTime();
  return target >= startTime && target <= endTime;
}

interface MonthCalendarDay {
  date: string;
  day: number;
  isWeekend: boolean;
  worked: boolean;
  leave: boolean;
  holiday: boolean;
  holidayName?: string;
  timeOffKind?: LeaveRequestKind;
  timeOffSource?: "admin" | "employee";
  timeOffRequestId?: string;
  holidaySource?: "company" | "requested";
  leaveStatus?: LeaveRequestStatus;
  leaveReason?: string;
  pendingLeave: boolean;
  pendingHoliday: boolean;
  hours: number;
  expenseCount: number;
}

interface MonthCalendar {
  month: string;
  monthLabel: string;
  summary: {
    annualLeaveLimit: number;
    approvedLeaveDaysYear: number;
    pendingLeaveDaysYear: number;
    remainingLeaveDaysYear: number;
    daysWorked: number;
    hoursLogged: number;
    leaveDays: number;
    holidayDays: number;
    companyHolidayDays: number;
    requestedHolidayDays: number;
    pendingLeaveDays: number;
    pendingHolidayDays: number;
    expenseSubmissions: number;
  };
  days: MonthCalendarDay[];
}

function countLeaveDaysInYearByStatus(
  store: BusinessStore,
  employeeId: string,
  tenantId: string,
  year: number,
  status: LeaveRequestStatus,
) {
  return store.leaveRequests.reduce((sum, request) => {
    if (
      (request.tenantId ?? DEFAULT_TENANT_ID) !== tenantId ||
      request.employeeId !== employeeId ||
      request.kind !== "leave" ||
      request.status !== status
    ) {
      return sum;
    }

    return (
      sum +
      enumerateDays(request.startDate, request.endDate).filter(
        (day) => new Date(`${day}T00:00:00.000Z`).getUTCFullYear() === year,
      ).length
    );
  }, 0);
}

function enumerateDays(startDate: string, endDate: string) {
  const start = new Date(`${normalizeDate(startDate).slice(0, 10)}T12:00:00.000Z`);
  const end = new Date(`${normalizeDate(endDate).slice(0, 10)}T12:00:00.000Z`);
  if (end.getTime() < start.getTime()) {
    return [] as string[];
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function buildMonthCalendar(
  store: BusinessStore,
  employeeId: string,
  month: string,
  tenantId: string,
  leavePolicy: LeavePolicyRecord,
): MonthCalendar {
  const [yearString, monthString] = month.split("-");
  const year = Number(yearString);
  const monthIndex = Number(monthString) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const daily = new Map<string, { hours: number; expenseCount: number }>();
  const holidaysByDate = new Map<string, HolidayRecord>();
  const leaveRequestsByDate = new Map<string, LeaveRequestRecord>();

  for (const holiday of store.holidays.filter((item) => (item.tenantId ?? DEFAULT_TENANT_ID) === tenantId && monthKeyFromDate(item.date) === month)) {
    holidaysByDate.set(normalizeDate(holiday.date).slice(0, 10), holiday);
  }

  for (const request of store.leaveRequests.filter((item) => (item.tenantId ?? DEFAULT_TENANT_ID) === tenantId && item.employeeId === employeeId && item.status !== "rejected")) {
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
      const iso = date.toISOString().slice(0, 10);
      if (!isDateWithinRange(iso, request.startDate, request.endDate)) {
        continue;
      }

      const existing = leaveRequestsByDate.get(iso);
      if (!existing || existing.status !== "approved") {
        leaveRequestsByDate.set(iso, request);
      }
    }
  }

  for (const entry of store.timesheets.filter((item) => item.employeeId === employeeId && monthKeyFromDate(item.weekStart) <= month)) {
    const weekStart = new Date(entry.weekStart);
    entry.lines.forEach((line) => {
      DAY_KEYS.forEach((key, offset) => {
        const amount = Number(line.hours[key] ?? 0);
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + offset);
        const iso = dayDate.toISOString().slice(0, 10);
        if (dayDate.getFullYear() !== year || dayDate.getMonth() !== monthIndex) {
          return;
        }

        const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
        bucket.hours += amount;
        daily.set(iso, bucket);
      });
    });
  }

  for (const expense of store.expenses.filter((item) => item.employeeId === employeeId && monthKeyFromDate(item.date) === month)) {
    const iso = normalizeDate(expense.date).slice(0, 10);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    bucket.expenseCount += 1;
    daily.set(iso, bucket);
  }

  const days: MonthCalendarDay[] = [];
  let daysWorked = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let companyHolidayDays = 0;
  let requestedHolidayDays = 0;
  let pendingLeaveDays = 0;
  let pendingHolidayDays = 0;
  let hoursLogged = 0;
  let expenseSubmissions = 0;
  const approvedLeaveDaysYear = countLeaveDaysInYearByStatus(store, employeeId, tenantId, year, "approved");
  const pendingLeaveDaysYear = countLeaveDaysInYearByStatus(store, employeeId, tenantId, year, "pending");
  const annualLeaveLimit = Math.max(0, Number(leavePolicy.annualLimit ?? 0));
  const remainingLeaveDaysYear = Math.max(0, annualLeaveLimit - approvedLeaveDaysYear - pendingLeaveDaysYear);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
    const iso = date.toISOString().slice(0, 10);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    const holiday = holidaysByDate.get(iso);
    const leaveRequest = leaveRequestsByDate.get(iso);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const worked = bucket.hours > 0;
    const approvedHolidayRequest = Boolean(leaveRequest && leaveRequest.status === "approved" && leaveRequest.kind === "holiday");
    const pendingHolidayRequest = Boolean(leaveRequest && leaveRequest.status === "pending" && leaveRequest.kind === "holiday");
    const approvedLeaveRequest = Boolean(leaveRequest && leaveRequest.status === "approved" && leaveRequest.kind === "leave");
    const pendingLeaveRequest = Boolean(leaveRequest && leaveRequest.status === "pending" && leaveRequest.kind === "leave");
    const isHoliday = Boolean(holiday || approvedHolidayRequest);
    const leave = Boolean(approvedLeaveRequest && !holiday);
    const pendingLeave = Boolean(pendingLeaveRequest && !isHoliday);
    if (worked) daysWorked += 1;
    if (leave) leaveDays += 1;
    if (pendingLeave && !isWeekend && !isHoliday) pendingLeaveDays += 1;
    if (pendingHolidayRequest && !isWeekend && !isHoliday) pendingHolidayDays += 1;
    if (holiday) companyHolidayDays += 1;
    if (approvedHolidayRequest) requestedHolidayDays += 1;
    if (isHoliday) holidayDays += 1;
    hoursLogged += bucket.hours;
    expenseSubmissions += bucket.expenseCount;

    days.push({
      date: `${iso}T12:00:00.000Z`,
      day,
      isWeekend,
      worked,
      leave,
      holiday: isHoliday,
      holidayName: holiday?.name,
      timeOffKind: leaveRequest?.kind,
      timeOffSource: leaveRequest ? "employee" : undefined,
      timeOffRequestId: leaveRequest?.id,
      holidaySource: holiday ? "company" : approvedHolidayRequest || pendingHolidayRequest ? "requested" : undefined,
      leaveStatus: leaveRequest?.status,
      leaveReason: leaveRequest?.reason,
      pendingLeave,
      pendingHoliday: pendingHolidayRequest,
      hours: bucket.hours,
      expenseCount: bucket.expenseCount,
    });
  }

  return {
    month,
    monthLabel: new Date(year, monthIndex, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    summary: {
      annualLeaveLimit,
      approvedLeaveDaysYear,
      pendingLeaveDaysYear,
      remainingLeaveDaysYear,
      daysWorked,
      hoursLogged,
      leaveDays,
      holidayDays,
      companyHolidayDays,
      requestedHolidayDays,
      pendingLeaveDays,
      pendingHolidayDays,
      expenseSubmissions,
    },
    days,
  };
}

router.get("/month-calendar", requireTenantRole("admin", "employee"), async (request, response) => {
  const month = request.query.month?.toString().trim();
  if (!month) {
    response.status(400).json({ message: "Month is required" });
    return;
  }

  const requestedEmployeeId = request.query.employeeId?.toString().trim();
  const employeeId = scopedEmployeeId(request, requestedEmployeeId ?? undefined);
  if (!employeeId) {
    response.status(400).json({ message: "Employee ID is required" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  try {
    assertTenantEmployeeAccess(employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const store = await readStore();
  const leavePolicyRows = await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1);
  const leavePolicy = (leavePolicyRows[0]?.data as { leavePolicy?: LeavePolicyRecord } | undefined)?.leavePolicy ?? store.leavePolicy;
  response.json({ monthCalendar: buildMonthCalendar(store, employeeId, month, tenantId, leavePolicy) });
});

router.get("/timesheets", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  if (employeeId) {
    try {
      assertTenantEmployeeAccess(employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
    } catch {
      response.status(403).json({ message: "Forbidden" });
      return;
    }
  }

  let timesheets = store.timesheets
    .filter((entry) => entry.status !== "draft" || timesheetHasContent(entry))
    .sort((left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime());

  if (employeeId) {
    timesheets = timesheets.filter((entry) => entry.employeeId === employeeId);
  } else if (request.auth?.user.role !== "admin") {
    timesheets = timesheets.filter((entry) => entry.employeeId === request.auth?.user.id);
  } else {
    timesheets = timesheets.filter((entry) => tenantEmployeeIds.has(entry.employeeId));
  }

  response.json({ timesheets });
});

router.get("/timesheets/summary", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  if (employeeId) {
    try {
      assertTenantEmployeeAccess(employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
    } catch {
      response.status(403).json({ message: "Forbidden" });
      return;
    }
  }

  const timesheets = employeeId
    ? store.timesheets.filter((entry) => entry.employeeId === employeeId)
    : request.auth?.user.role === "admin"
      ? store.timesheets.filter((entry) => tenantEmployeeIds.has(entry.employeeId))
      : store.timesheets.filter((entry) => entry.employeeId === request.auth?.user.id);

  response.json({
    pending: timesheets.filter((entry) => entry.status === "submitted").length,
    approved: timesheets.filter((entry) => entry.status === "approved").length,
    rejected: timesheets.filter((entry) => entry.status === "rejected").length,
    totalHours: timesheets.reduce((sum, entry) => sum + sumTimesheetHours(entry), 0),
  });
});

router.get("/timesheets/by-week", requireTenantRole("admin", "employee"), async (request, response) => {
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  const weekStart = (request.query as { weekStart?: string }).weekStart;
  if (!employeeId || !weekStart) {
    response.status(400).json({ message: "Missing employee or week" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  try {
    assertTenantEmployeeAccess(employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const timesheet = store.timesheets.find(
    (entry) => entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(weekStart),
  );

  response.json({ timesheet: timesheet ?? null });
});

router.get("/timesheets/:id", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const timesheet = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!timesheet) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  try {
    assertTenantEmployeeAccess(timesheet.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ timesheet });
});

router.post("/timesheets", requireTenantRole("admin", "employee"), async (request, response) => {
  const parsed = timesheetSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timesheet payload" });
    return;
  }

  const store = await readStore();
  const actor = recordActor(request);
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForTimesheetMutation({
        id: parsed.data.id,
        employeeId,
        employeeNameSnapshot: parsed.data.employeeNameSnapshot,
        weekStart: parsed.data.weekStart,
        lines: parsed.data.lines,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestTimesheet = idempotencyClaim.row.responseEntityId
        ? latestStore.timesheets.find((entry) => entry.id === idempotencyClaim.row.responseEntityId)
        : null;
      response.json({ timesheet: latestTimesheet ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet create request is already being processed. Please retry shortly." });
    return;
  }
  if (request.auth?.user.role === "employee" || request.auth?.user.role === "admin") {
    const tenantEmployees = await loadEmployees(tenantId);
    const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
    try {
      assertTenantEmployeeAccess(employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
    } catch {
      response.status(403).json({ message: "Forbidden" });
      return;
    }
  }

  const employee =
    request.auth?.user.role === "employee"
      ? { id: request.auth.user.id, name: request.auth.user.name ?? "Employee" }
      : await loadEmployeeProfile(employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const existing = parsed.data.id
    ? store.timesheets.find((entry) => entry.id === parsed.data.id)
    : store.timesheets.find(
        (entry) =>
          entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(parsed.data.weekStart),
      );

  if (existing && existing.status !== "draft" && existing.status !== "rejected") {
    response.status(409).json({ message: "Only draft or returned timesheets can be edited." });
    return;
  }

  const lines = parsed.data.lines.map((line) => ({
    id: line.id ?? createId("line"),
    project: line.project?.trim() || "",
    task: line.task?.trim() || "",
    projectBudgetId: line.projectBudgetId?.trim() || undefined,
    projectTaskId: line.projectTaskId?.trim() || undefined,
    subTask: line.subTask?.trim() || undefined,
    notes: line.notes?.trim() || undefined,
    workNotes: Object.fromEntries(
      DAY_KEYS.map((day) => [day, line.workNotes?.[day]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
    ),
    hours: { ...blankHours(), ...line.hours },
  }));
  const dailyReviewState = reconcileDailyReviewState(existing?.dailyReviewStatus, existing?.dailyReviewNotes, existing?.lines ?? [], lines);

  const entry: TimesheetEntry = {
    id: parsed.data.id ?? existing?.id ?? createId("ts"),
    employeeId,
    employeeNameSnapshot:
      request.auth?.user.role === "employee"
        ? request.auth.user.name
        : parsed.data.employeeNameSnapshot?.trim() || employee.name,
    weekStart: normalizeWeekStart(parsed.data.weekStart),
    status: existing?.status ?? "draft",
    submittedAt: existing?.submittedAt,
    reviewedAt: existing?.reviewedAt,
    reviewedBy: existing?.reviewedBy,
    reviewNotes: existing?.reviewNotes,
    dailyReviewStatus: dailyReviewState.status,
    dailyReviewNotes: dailyReviewState.notes,
    lines,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  if (entry.status === "draft" && !timesheetHasContent(entry)) {
    if (existing) {
      await saveTimesheetFast({
        entry,
        audit: {
          ...actor,
          action: "deleted",
          entityType: "timesheet",
          entityId: entry.id,
          summary: `Removed an empty draft for week of ${entry.weekStart}.`,
        },
      });
    }

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: entry.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }

    response.status(existing ? 200 : 201).json({ timesheet: entry, duplicate: false });
    return;
  }

  let savedEntry: TimesheetEntry | null;
  try {
    savedEntry = await saveTimesheetFast({
      entry,
      audit: {
        ...actor,
        action: existing ? "saved" : "created",
        entityType: "timesheet",
        entityId: entry.id,
        summary: `${existing ? "Saved" : "Started"} timesheet draft for week of ${entry.weekStart}.`,
      },
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleTaskHourLimitError(error, response)) {
      return;
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: (savedEntry ?? entry).id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(existing ? 200 : 201).json({ timesheet: savedEntry ?? entry, duplicate: false });
});

router.patch("/timesheets/:id", requireTenantRole("admin", "employee"), async (request, response) => {
  const parsed = timesheetSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timesheet payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status !== "draft" && existing.status !== "rejected") {
    response.status(409).json({ message: "Only draft or returned timesheets can be edited." });
    return;
  }

  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId;
  const requestHash = idempotencyKey
    ? requestHashForTimesheetMutation({
        id: routeParam(request.params.id),
        employeeId,
        employeeNameSnapshot: parsed.data.employeeNameSnapshot,
        weekStart: parsed.data.weekStart,
        lines: parsed.data.lines,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestTimesheet = latestStore.timesheets.find((entry) => entry.id === request.params.id);
      response.json({ timesheet: latestTimesheet ?? existing, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet update request is already being processed. Please retry shortly." });
    return;
  }
  const employee =
    request.auth?.user.role === "employee"
      ? { id: request.auth.user.id, name: request.auth.user.name ?? existing.employeeNameSnapshot }
      : await loadEmployeeProfile(employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const lines = parsed.data.lines.map((line) => ({
    id: line.id ?? createId("line"),
    project: line.project?.trim() || "",
    task: line.task?.trim() || "",
    projectBudgetId: line.projectBudgetId?.trim() || undefined,
    projectTaskId: line.projectTaskId?.trim() || undefined,
    subTask: line.subTask?.trim() || undefined,
    notes: line.notes?.trim() || undefined,
    workNotes: Object.fromEntries(
      DAY_KEYS.map((day) => [day, line.workNotes?.[day]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
    ),
    hours: { ...blankHours(), ...line.hours },
  }));
  const dailyReviewState = reconcileDailyReviewState(existing.dailyReviewStatus, existing.dailyReviewNotes, existing.lines, lines);

  const entry: TimesheetEntry = {
    ...existing,
    employeeId,
    employeeNameSnapshot:
      request.auth?.user.role === "employee"
        ? request.auth.user.name
        : parsed.data.employeeNameSnapshot?.trim() || existing.employeeNameSnapshot,
    weekStart: normalizeWeekStart(parsed.data.weekStart),
    status: existing.status,
    submittedAt: existing.submittedAt,
    reviewedAt: existing.reviewedAt,
    reviewedBy: existing.reviewedBy,
    reviewNotes: existing.reviewNotes,
    dailyReviewStatus: dailyReviewState.status,
    dailyReviewNotes: dailyReviewState.notes,
    lines,
    updatedAt: nowIso(),
  };

  let savedEntry: TimesheetEntry | null;
  try {
    savedEntry = await saveTimesheetFast({
      entry,
      audit: {
        ...recordActor(request),
        action: "saved",
        entityType: "timesheet",
        entityId: entry.id,
        summary: `Saved timesheet draft for week of ${entry.weekStart}.`,
      },
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleTaskHourLimitError(error, response)) {
      return;
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: (savedEntry ?? entry).id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.json({ timesheet: savedEntry ?? entry, duplicate: false });
});

router.patch("/timesheets/:id/daily-review/:day", requireTenantRole("admin"), async (request, response) => {
  const day = dayKeySchema.safeParse(routeParam(request.params.day));
  const body = z.object({ reviewed: z.boolean(), note: z.string().trim().max(1000).optional() }).safeParse(request.body);
  if (!day.success || !body.success) {
    response.status(400).json({ message: "Invalid daily review payload" });
    return;
  }

  const store = await readStore();
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const updated = await setTimesheetDayReviewStatusFast({
    id: existing.id,
    day: day.data,
    reviewed: body.data.reviewed,
    note: body.data.note,
    tenantId,
    actorName: request.auth?.user.name ?? "Admin",
    actorRole: request.auth?.user.role ?? "admin",
    requestId: String(request.id),
  });

  if (!updated) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  if (!body.data.reviewed && body.data.note) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyEmployee(
        existing.employeeId,
        actor,
        {
          type: "timesheet_reverted",
          title: "Day returned for changes",
          body: `Your ${day.data.toUpperCase()} work entry for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} was returned${body.data.note ? `: ${body.data.note}` : "."}`,
          link: "/employee/timesheet",
          email: true,
          metadata: { timesheetId: existing.id, employeeId: existing.employeeId, day: day.data, reviewNote: body.data.note ?? null },
        },
      ),
    );
  }

  response.json({ timesheet: updated });
});

router.post("/timesheets/submit", requireTenantRole("admin", "employee"), async (request, response) => {
  const parsed = timesheetSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timesheet payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForTimesheetSubmit({
        employeeId,
        weekStart: parsed.data.weekStart,
        lines: parsed.data.lines,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_submit",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const existingById = idempotencyClaim.row.responseEntityId
        ? latestStore.timesheets.find((entry) => entry.id === idempotencyClaim.row.responseEntityId)
        : null;
      response.json({ timesheet: existingById ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet submit request is already being processed. Please retry shortly." });
    return;
  }

  const employee =
    request.auth?.user.role === "employee"
      ? { id: request.auth.user.id, name: request.auth.user.name ?? "Employee" }
      : await loadEmployeeProfile(employeeId, tenantId);

  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const existing = parsed.data.id
    ? store.timesheets.find((entry) => entry.id === parsed.data.id)
    : store.timesheets.find(
        (entry) =>
          entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(parsed.data.weekStart),
      );

  const lines = parsed.data.lines.map((line) => ({
    id: line.id ?? createId("line"),
    project: line.project?.trim() || "",
    task: line.task?.trim() || "",
    projectBudgetId: line.projectBudgetId?.trim() || undefined,
    projectTaskId: line.projectTaskId?.trim() || undefined,
    subTask: line.subTask?.trim() || undefined,
    notes: line.notes?.trim() || undefined,
    workNotes: Object.fromEntries(
      DAY_KEYS.map((day) => [day, line.workNotes?.[day]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
    ),
    hours: { ...blankHours(), ...line.hours },
  }));
  const dailyReviewState = reconcileDailyReviewState(existing?.dailyReviewStatus, existing?.dailyReviewNotes, existing?.lines ?? [], lines);

  const entry: TimesheetEntry = {
    id: parsed.data.id ?? existing?.id ?? createId("ts"),
    employeeId,
    employeeNameSnapshot:
      request.auth?.user.role === "employee"
        ? request.auth.user.name
        : parsed.data.employeeNameSnapshot?.trim() || employee.name,
    weekStart: normalizeWeekStart(parsed.data.weekStart),
    status: "submitted",
    submittedAt: nowIso(),
    reviewedAt: undefined,
    reviewedBy: undefined,
    reviewNotes: undefined,
    dailyReviewStatus: dailyReviewState.status,
    dailyReviewNotes: dailyReviewState.notes,
    lines,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  if (!timesheetHasContent(entry)) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    response.status(400).json({ message: "Timesheet must include at least one task or logged hour before submission." });
    return;
  }

  let submittedEntry: TimesheetEntry;
  try {
    submittedEntry = await submitTimesheetEntryFast({
      entry,
      tenantId,
      actorName: request.auth?.user.name ?? "System",
      actorRole: request.auth?.user.role ?? "system",
      requestId: String(request.id),
    });
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: submittedEntry.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleTaskHourLimitError(error, response)) {
      return;
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  if (request.auth?.user.role === "employee") {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "timesheet_submitted",
          title: "Timesheet submitted",
          body: `Your timesheet for the week of ${new Date(submittedEntry.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} is waiting for review.`,
          link: "/employee/timesheet",
          email: false,
          metadata: { timesheetId: submittedEntry.id, weekStart: submittedEntry.weekStart },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "timesheet_submitted",
          title: "New timesheet submitted",
          body: `${submittedEntry.employeeNameSnapshot} submitted a timesheet for the week of ${new Date(submittedEntry.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}.`,
          link: "/timesheets",
          email: true,
          metadata: { timesheetId: submittedEntry.id, weekStart: submittedEntry.weekStart, employeeId: submittedEntry.employeeId },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.status(existing ? 200 : 201).json({ timesheet: submittedEntry, duplicate: false });
});

router.post("/timesheets/:id/submit", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForTimesheetSubmitById({ timesheetId: String(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_submit",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestTimesheet = latestStore.timesheets.find((entry) => entry.id === request.params.id);
      response.json({ timesheet: latestTimesheet ?? existing, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet submit request is already being processed. Please retry shortly." });
    return;
  }

  let submittedEntry: TimesheetEntry | null;
  try {
    submittedEntry = await submitTimesheetFast({
      id: String(request.params.id),
      tenantId,
      actorName: request.auth?.user.name ?? "System",
      actorRole: request.auth?.user.role ?? "system",
      requestId: String(request.id),
    });
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: String(request.params.id),
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }
  if (request.auth?.user.role === "employee") {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "timesheet_submitted",
          title: "Timesheet submitted",
          body: `Your timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} is waiting for review.`,
          link: "/employee/timesheet",
          email: false,
          metadata: { timesheetId: existing.id, weekStart: existing.weekStart },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "timesheet_submitted",
          title: "New timesheet submitted",
          body: `${existing.employeeNameSnapshot} submitted a timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}.`,
          link: "/timesheets",
          email: true,
          metadata: { timesheetId: existing.id, weekStart: existing.weekStart, employeeId: existing.employeeId },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.json({ timesheet: submittedEntry ?? existing, duplicate: false });
});

router.post("/timesheets/:id/approve", requireTenantRole("admin"), timesheetReviewLimiter, async (request, response) => {
  const parsed = z.object({ note: z.string().trim().optional() }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid approval payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const employee = await loadEmployeeProfile(existing.employeeId, tenantId);
  const note = parsed.data.note?.trim() || undefined;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForTimesheetReview({ timesheetId: String(request.params.id), status: "approved", note })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_review",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestTimesheet = latestStore.timesheets.find((entry) => entry.id === request.params.id);
      response.json({ timesheet: latestTimesheet ?? existing, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet review request is already being processed. Please retry shortly." });
    return;
  }

  let reviewResult: { timesheet: TimesheetEntry; salary?: unknown };
  try {
    reviewResult = await reviewTimesheetFast({
      id: String(request.params.id),
      tenantId,
      status: "approved",
      actorName: request.auth?.user.name ?? "Admin",
      requestId: String(request.id),
      note,
      employee,
    });
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: String(request.params.id),
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  {
    const actor = notificationActor(request);
    appEvents.emit("timesheet_approved", {
      tenantId,
      timesheet: reviewResult.timesheet,
      employee,
      approvedBy: {
        userId: request.auth?.user.id,
        name: request.auth?.user.name ?? "Admin",
      },
    });
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "timesheet_approved",
          title: "Timesheet approved",
          body: `Approved ${existing.employeeNameSnapshot}'s timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}.`,
          link: "/timesheets",
          email: false,
          metadata: { timesheetId: existing.id, employeeId: existing.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        existing.employeeId,
        actor,
        {
          type: "timesheet_approved",
          title: "Timesheet approved",
          body: `Your timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} was approved${parsed.data.note?.trim() ? `: ${parsed.data.note.trim()}` : "."}`,
          link: "/employee/timesheet",
          email: true,
          metadata: { timesheetId: existing.id, employeeId: existing.employeeId },
        },
      ),
    );
  }
  response.json({ timesheet: reviewResult.timesheet, duplicate: false });
});

router.post("/timesheets/:id/reject", requireTenantRole("admin"), timesheetReviewLimiter, async (request, response) => {
  const parsed = z.object({ note: z.string().trim().min(1) }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid rejection payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  let reviewResult: { timesheet: TimesheetEntry; salary?: unknown };
  const note = parsed.data.note;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForTimesheetReview({ timesheetId: String(request.params.id), status: "rejected", note })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_review",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestTimesheet = latestStore.timesheets.find((entry) => entry.id === request.params.id);
      response.json({ timesheet: latestTimesheet ?? existing, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This timesheet review request is already being processed. Please retry shortly." });
    return;
  }

  try {
    reviewResult = await reviewTimesheetFast({
      id: String(request.params.id),
      tenantId,
      status: "rejected",
      actorName: request.auth?.user.name ?? "Admin",
      requestId: String(request.id),
      note,
    });
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: String(request.params.id),
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "timesheet_reverted",
          title: "Timesheet returned",
          body: `Returned ${existing.employeeNameSnapshot}'s timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}.`,
          link: "/timesheets",
          email: false,
          metadata: { timesheetId: existing.id, employeeId: existing.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        existing.employeeId,
        actor,
        {
          type: "timesheet_reverted",
          title: "Timesheet returned for changes",
          body: `Your timesheet for the week of ${new Date(existing.weekStart).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} was returned${parsed.data.note ? `: ${parsed.data.note}` : "."}`,
          link: "/employee/timesheet",
          email: true,
          metadata: { timesheetId: existing.id, employeeId: existing.employeeId, reviewNote: parsed.data.note },
        },
      ),
    );
  }
  response.json({ timesheet: reviewResult.timesheet, duplicate: false });
});

router.delete("/timesheets/:id", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForTimesheetDelete({ timesheetId: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimTimesheetReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimTimesheetReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "timesheet_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleTimesheetIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This timesheet delete request is already being processed. Please retry shortly." });
    return;
  }

  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  try {
    assertTenantEmployeeAccess(existing.employeeId, tenantEmployeeIds, request.auth?.user.role, request.auth?.user.id, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      timesheets: store.timesheets.filter((entry) => entry.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "timesheet",
      entityId: String(request.params.id),
      summary: "Deleted a timesheet record.",
    },
  );

  await updateStore(() => next);
  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: String(request.params.id),
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }
  response.status(204).send();
});

export default router;
