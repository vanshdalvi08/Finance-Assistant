import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import {
  DAY_KEYS,
  type BusinessStore,
  type DayKey,
  type HolidayRecord,
  type LeaveRequestKind,
  type LeaveRequestRecord,
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
  readStore,
  reviewTimesheetFast,
  saveTimesheetFast,
  submitTimesheetEntryFast,
  submitTimesheetFast,
  sumTimesheetHours,
  updateStore,
} from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../../lib/notifications";
import { assertTenantEmployeeAccess } from "../../lib/policies";
import { WorkflowStateError } from "../../lib/workflow-state";

const router: IRouter = Router();

const dateSchema = z.string().min(1);
const businessIdSchema = z.string().trim().min(1);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);

const timesheetLineSchema = z.object({
  id: businessIdSchema.optional(),
  project: z.string().trim().optional(),
  task: z.string().trim().optional(),
  projectBudgetId: businessIdSchema.optional(),
  projectTaskId: businessIdSchema.optional(),
  notes: z.string().trim().optional(),
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
  lines: z.array(timesheetLineSchema).min(1),
});

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function handleWorkflowStateError(error: unknown, response: Response) {
  if (!(error instanceof WorkflowStateError)) {
    throw error;
  }

  response.status(409).json({ message: error.message });
  return true;
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    console.error("Failed to deliver notification", error);
  });
  return Promise.resolve();
}

function scopedEmployeeId(request: Request, fallback?: string) {
  if (request.auth?.user.role === "employee") {
    return request.auth.user.id;
  }

  return fallback?.trim() || null;
}

function timesheetHasContent(entry: TimesheetEntry) {
  return entry.lines.some((line) => {
    const hasText = Boolean(line.project.trim() || line.task.trim() || line.notes?.trim());
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

function buildMonthCalendar(store: BusinessStore, employeeId: string, month: string, tenantId: string): MonthCalendar {
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
  response.json({ monthCalendar: buildMonthCalendar(store, employeeId, month, tenantId) });
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
    notes: line.notes?.trim() || undefined,
    hours: { ...blankHours(), ...line.hours },
  }));

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

    response.status(existing ? 200 : 201).json({ timesheet: entry });
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
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(existing ? 200 : 201).json({ timesheet: savedEntry ?? entry });
});

router.patch("/timesheets/:id", requireTenantRole("admin", "employee"), async (request, response) => {
  const parsed = timesheetSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timesheet payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
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
  const employee =
    request.auth?.user.role === "employee"
      ? { id: request.auth.user.id, name: request.auth.user.name ?? existing.employeeNameSnapshot }
      : await loadEmployeeProfile(employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

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
    lines: parsed.data.lines.map((line) => ({
      id: line.id ?? createId("line"),
      project: line.project?.trim() || "",
      task: line.task?.trim() || "",
      projectBudgetId: line.projectBudgetId?.trim() || undefined,
      projectTaskId: line.projectTaskId?.trim() || undefined,
      notes: line.notes?.trim() || undefined,
      hours: { ...blankHours(), ...line.hours },
    })),
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
    if (handleWorkflowStateError(error, response)) {
      return;
    }
    throw error;
  }

  response.json({ timesheet: savedEntry ?? entry });
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
    notes: line.notes?.trim() || undefined,
    hours: { ...blankHours(), ...line.hours },
  }));

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
    lines,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  if (!timesheetHasContent(entry)) {
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
  } catch (error) {
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

  response.status(existing ? 200 : 201).json({ timesheet: submittedEntry });
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

  let submittedEntry: TimesheetEntry | null;
  try {
    submittedEntry = await submitTimesheetFast({
      id: String(request.params.id),
      tenantId,
      actorName: request.auth?.user.name ?? "System",
      actorRole: request.auth?.user.role ?? "system",
      requestId: String(request.id),
    });
  } catch (error) {
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
  response.json({ timesheet: submittedEntry ?? existing });
});

router.post("/timesheets/:id/approve", requireTenantRole("admin"), async (request, response) => {
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
  let reviewResult: { timesheet: TimesheetEntry; salary?: unknown };
  try {
    reviewResult = await reviewTimesheetFast({
      id: String(request.params.id),
      tenantId,
      status: "approved",
      actorName: request.auth?.user.name ?? "Admin",
      requestId: String(request.id),
      note: parsed.data.note?.trim() || undefined,
      employee,
    });
  } catch (error) {
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
  response.json({ timesheet: reviewResult.timesheet });
});

router.post("/timesheets/:id/reject", requireTenantRole("admin"), async (request, response) => {
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
  try {
    reviewResult = await reviewTimesheetFast({
      id: String(request.params.id),
      tenantId,
      status: "rejected",
      actorName: request.auth?.user.name ?? "Admin",
      requestId: String(request.id),
      note: parsed.data.note,
    });
  } catch (error) {
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
  response.json({ timesheet: reviewResult.timesheet });
});

router.delete("/timesheets/:id", requireTenantRole("admin", "employee"), async (request, response) => {
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
  response.status(204).send();
});

export default router;
