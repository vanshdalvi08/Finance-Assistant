import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  auditTrailTable,
  companySettingsTable,
  fundsTable,
  preApprovalsTable,
  usersTable,
  type CompanySettingsRecord,
  type PreApproval as DbPreApproval,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import {
  DAY_KEYS,
  type ApprovalStatus,
  type BusinessStore,
  type DayKey,
  type HolidayRecord,
  type ExpenseCategoryRecord,
  type ExpenseRecord,
  type FundRecord,
  type LeaveRequestRecord,
  type LeaveRequestKind,
  type LeaveRequestStatus,
  type LeavePolicyRecord,
  type ProjectBudget,
  type PurchaseOrder,
  type SalaryRecord,
  type TimesheetEntry,
  type TimesheetTaskLine,
  type ActorRole,
  readStore,
  updateStore,
  pushAuditEvent,
  normalizeDate,
  normalizeWeekStart,
  nowIso,
  createId,
  loadEmployees,
  loadEmployeeProfile,
  blankHours,
  sumTimesheetHours,
  effectiveHourlyRate,
  reviewTimesheetFast,
  saveTimesheetFast,
  submitTimesheetEntryFast,
  submitTimesheetFast,
  invalidateBusinessStoreCache,
} from "../lib/business-store";
import { DEFAULT_TENANT_ID } from "../lib/tenants";
import { resolveExpenseAttachmentUrl } from "../lib/storage";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../lib/notifications";

const router: IRouter = Router();
const mutationLimiter = rateLimit({
  name: "business-mutations",
  windowMs: 15 * 60 * 1000,
  max: 180,
  message: "Too many changes in a short period. Please slow down and try again.",
});

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const dateSchema = z.string().min(1);
const dayKeySchema = z.enum(DAY_KEYS as [DayKey, ...DayKey[]]);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);
const employeeScopeSchema = z.object({
  employeeId: z.string().uuid().optional(),
});

const businessIdSchema = z.string().trim().min(1);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

const fundSchema = z.object({
  id: businessIdSchema.optional(),
  source: z.string().trim().min(2),
  amount: z.coerce.number().min(0),
  date: dateSchema,
  note: z.string().trim().optional(),
});

const categorySchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  color: z.string().trim().min(3),
  group: z.enum(["personal", "office"]),
});

const expenseSchema = z.object({
  id: businessIdSchema.optional(),
  employeeId: z.string().uuid().optional(),
  employeeNameSnapshot: z.string().trim().optional(),
  project: z.string().trim().optional(),
  category: z.string().trim().min(2),
  group: z.enum(["personal", "office"]),
  amount: z.coerce.number().min(0),
  date: dateSchema,
  description: z.string().trim().min(2),
  note: z.string().trim().optional(),
  attachmentName: z.string().trim().optional(),
  attachmentPath: z.string().trim().optional(),
  reimbursable: z.boolean().optional(),
  status: approvalStatusSchema.optional(),
  reviewerNote: z.string().trim().optional(),
});

const salarySchema = z.object({
  id: businessIdSchema.optional(),
  employeeId: z.string().uuid(),
  employeeNameSnapshot: z.string().trim().optional(),
  amount: z.coerce.number().min(0),
  date: dateSchema.optional(),
  note: z.string().trim().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  source: z.enum(["manual", "timesheet"]).optional(),
  paidAt: dateSchema.optional(),
  weekStart: dateSchema.optional(),
  hours: z.coerce.number().optional(),
  rate: z.coerce.number().optional(),
  timesheetId: businessIdSchema.optional(),
});

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

const holidaySchema = z.object({
  id: businessIdSchema.optional(),
  date: dateSchema,
  name: z.string().trim().min(2),
});

const leaveRequestSchema = z.object({
  id: businessIdSchema.optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  reason: z.string().trim().max(500).optional(),
});

const leaveDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const leaveSettingsSchema = z.object({
  annualLimit: z.coerce.number().min(0).max(365),
});

const projectTaskSchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  maxHours: z.coerce.number().min(0).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const projectSchema = z.object({
  id: businessIdSchema.optional(),
  project: z.string().trim().min(2),
  totalBudget: z.coerce.number().min(0),
  client: z.string().trim().optional(),
  note: z.string().trim().optional(),
  tasks: z.array(projectTaskSchema).optional(),
});

const poTaskSchema = z.object({
  id: businessIdSchema.optional(),
  taskName: z.string().trim().min(2),
  description: z.string().trim().optional(),
  hours: z.coerce.number().min(0),
  rate: z.coerce.number().min(0),
});

const poSchema = z.object({
  id: businessIdSchema.optional(),
  title: z.string().trim().min(2),
  totalAmount: z.coerce.number().min(0),
  vendor: z.string().trim().optional(),
  date: dateSchema,
  notes: z.string().trim().optional(),
  tasks: z.array(poTaskSchema).optional(),
});

const preApprovalCommentSchema = z.object({
  message: z.string().trim().min(2).max(1000),
});

const partyInfoSchema = z.object({
  companyName: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  website: z.string().trim().optional(),
});

const projectInfoSchema = z.object({
  workDescription: z.string().trim().optional(),
  projectStartDate: z.string().trim().optional(),
  projectCompletionDate: z.string().trim().optional(),
  totalContractValue: z.coerce.number().min(0).optional(),
  retainagePercent: z.coerce.number().min(0).max(100).optional(),
  retainageAmount: z.coerce.number().min(0).optional(),
  previouslyBilledAmount: z.coerce.number().min(0).optional(),
});

const preApprovalSchema = z.object({
  id: businessIdSchema.optional(),
  title: z.string().trim().min(2),
  project: z.string().trim().min(2),
  clientId: z.string().uuid(),
  date: dateSchema,
  notes: z.string().trim().optional(),
  companyInfo: partyInfoSchema.optional(),
  clientInfo: partyInfoSchema.optional(),
  projectInfo: projectInfoSchema.optional(),
  tasks: z.array(poTaskSchema).optional(),
});

function isAdmin(request: Request) {
  return request.auth?.user.role === "admin";
}

function scopedEmployeeId(request: Request, fallback?: string) {
  if (request.auth?.user.role === "employee") {
    return request.auth.user.id;
  }

  return fallback?.trim() || null;
}

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function approveExpenses(store: BusinessStore) {
  return store.expenses.filter((expense) => expense.status === "approved");
}

function paidSalaries(store: BusinessStore) {
  return store.salaries.filter((salary) => salary.status === "paid");
}

function tenantSalaryFilter(salary: SalaryRecord, tenantId: string) {
  return (salary.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function availableFunds(store: BusinessStore, tenantId?: string) {
  const totalFunds = store.funds
    .filter((fund) => (tenantId ? tenantFundFilter(fund, tenantId) : true))
    .reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const spentExpenses = approveExpenses(store)
    .filter((expense) => (tenantId ? tenantExpenseFilter(expense, tenantId) : true))
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const spentSalary = paidSalaries(store)
    .filter((salary) => (tenantId ? tenantSalaryFilter(salary, tenantId) : true))
    .reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);
  return Math.max(0, Number((totalFunds - spentExpenses - spentSalary).toFixed(2)));
}

function ensureFunds(store: BusinessStore, amount: number, label: string, tenantId?: string) {
  const required = Math.abs(Number(amount ?? 0));
  const available = availableFunds(store, tenantId);
  if (required > available) {
    throw new Error(`Insufficient total funds for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`);
  }
}

function calculatePoTaskAmount(hours: number, rate: number) {
  return Math.round(Math.max(0, Number(hours ?? 0)) * Math.max(0, Number(rate ?? 0)));
}

function sumPurchaseOrderTasks(tasks: Array<{ amount: number }>) {
  return tasks.reduce((sum, task) => sum + Math.abs(Number(task.amount ?? 0)), 0);
}

function normalizeApprovalTask(task: z.infer<typeof poTaskSchema>) {
  const hours = Math.max(0, Number(task.hours ?? 0));
  const rate = Math.max(0, Number(task.rate ?? 0));
  return {
    id: task.id ?? createId("pa_task"),
    taskName: task.taskName.trim(),
    description: task.description?.trim() || "",
    hours,
    rate,
    amount: calculatePoTaskAmount(hours, rate),
  };
}

function serializePreApproval(row: DbPreApproval) {
  const tasks = Array.isArray(row.tasks) ? row.tasks : [];

  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    project: row.project,
    clientId: row.clientId,
    clientNameSnapshot: row.clientNameSnapshot,
    date: row.date.toISOString(),
    notes: row.notes || undefined,
    companyInfo: row.companyInfo ?? {},
    clientInfo: row.clientInfo ?? {},
    projectInfo: row.projectInfo ?? {},
    status: row.status,
    submittedAt: row.submittedAt?.toISOString(),
    approvedAt: row.approvedAt?.toISOString(),
    receivedAt: row.receivedAt?.toISOString(),
    receivedFundId: row.receivedFundId ?? undefined,
    createdById: row.createdById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tasks,
    comments: Array.isArray(row.comments) ? row.comments : [],
    totalHours: tasks.reduce((sum, task) => sum + Math.max(0, Number(task.hours ?? 0)), 0),
    totalAmount: tasks.reduce((sum, task) => sum + Math.max(0, Number(task.amount ?? 0)), 0),
  };
}

async function insertBusinessAudit(input: {
  tenantId: string;
  actorName: string;
  actorRole: "admin" | "employee" | "client" | "system";
  action: string;
  entityType: "pre-approval" | "pre-approval-comment";
  entityId: string;
  summary: string;
}) {
  await db.insert(auditTrailTable).values({
    id: createId("audit"),
    tenantId: input.tenantId.trim() || "00000000-0000-0000-0000-000000000101",
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    createdAt: new Date(),
  });
}

async function loadClientUser(clientId: string, tenantId?: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, clientId),
        eq(usersTable.role, "client"),
        eq(usersTable.status, "active"),
        tenantId ? eq(usersTable.tenantId, tenantId) : undefined,
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function assertClientCanAccess(request: Request, preApproval: DbPreApproval, response: Response) {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if ((preApproval.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return false;
  }

  if (request.auth?.user.role === "client" && preApproval.clientId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return false;
  }

  return true;
}

function timesheetHasContent(entry: TimesheetEntry) {
  return entry.lines.some((line) => {
    const hasText = Boolean(line.project.trim() || line.task.trim() || line.notes?.trim());
    const hasHours = DAY_KEYS.some((day) => Number(line.hours[day] ?? 0) > 0);
    return hasText || hasHours;
  });
}

function recordActor(request: Request): { actorName: string; actorRole: ActorRole } {
  return {
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

function isSameIsoDate(left: string, right: string) {
  return normalizeDate(left).slice(0, 10) === normalizeDate(right).slice(0, 10);
}

function isDateWithinRange(date: string, start: string, end: string) {
  const target = new Date(normalizeDate(date)).getTime();
  const startTime = new Date(normalizeDate(start)).getTime();
  const endTime = new Date(normalizeDate(end)).getTime();
  return target >= startTime && target <= endTime;
}

function leaveKindLabel(kind: LeaveRequestKind) {
  return kind === "holiday" ? "holiday" : "leave";
}

function countLeaveDaysInYear(store: BusinessStore, employeeId: string, year: number, tenantId: string) {
  return store.leaveRequests.reduce((sum, request) => {
    if (
      (request.tenantId ?? DEFAULT_TENANT_ID) !== tenantId ||
      request.employeeId !== employeeId ||
      request.kind !== "leave" ||
      request.status === "rejected"
    ) {
      return sum;
    }

    return (
      sum +
      enumerateDays(request.startDate, request.endDate).filter((day) => new Date(`${day}T00:00:00.000Z`).getUTCFullYear() === year)
        .length
    );
  }, 0);
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

function buildMonthCalendar(store: BusinessStore, employeeId: string, month: string, tenantId: string) {
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
      holidayName: holiday?.name ?? (approvedHolidayRequest ? "Requested Holiday" : undefined),
      timeOffKind: leaveRequest?.kind ?? undefined,
      timeOffSource: holiday ? "admin" : leaveRequest ? "employee" : undefined,
      timeOffRequestId: leaveRequest?.id,
      leaveStatus: leaveRequest?.status ?? undefined,
      leaveReason: leaveRequest?.reason ?? undefined,
      pendingLeave,
      pendingHoliday: pendingHolidayRequest,
      hours: Number(bucket.hours.toFixed(1)),
      expenseCount: bucket.expenseCount,
    });
  }

  return {
    month,
    monthLabel: new Date(`${month}-01T00:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" }),
    summary: {
      daysWorked,
      hoursLogged: Number(hoursLogged.toFixed(1)),
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

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    console.error("Failed to deliver notification", error);
  });
  return Promise.resolve();
}

function isoDay(value: string) {
  return normalizeDate(value).slice(0, 10);
}

function enumerateDays(startDate: string, endDate: string) {
  const start = new Date(`${isoDay(startDate)}T12:00:00.000Z`);
  const end = new Date(`${isoDay(endDate)}T12:00:00.000Z`);
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

async function serializeExpense(expense: ExpenseRecord) {
  return {
    ...expense,
    attachmentUrl: await resolveExpenseAttachmentUrl(expense.attachmentPath),
  };
}

async function serializeExpenses(expenses: ExpenseRecord[]) {
  return Promise.all(expenses.map((expense) => serializeExpense(expense)));
}

function tenantExpenseFilter(expense: ExpenseRecord, tenantId: string) {
  return (expense.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return (fund.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantProjectFilter(project: ProjectBudget, tenantId: string) {
  return (project.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantPurchaseOrderFilter(order: PurchaseOrder, tenantId: string) {
  return (order.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

router.use(requireAuth);
router.use((request, response, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return mutationLimiter(request, response, next);
  }

  next();
});

router.get("/overview", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantFunds = store.funds.filter((fund) => tenantFundFilter(fund, tenantId));
  const tenantSalaries = store.salaries.filter((salary) => tenantSalaryFilter(salary, tenantId));
  const approved = approveExpenses({ ...store, expenses: tenantExpenses });
  const totalFunds = tenantFunds.reduce((sum, fund) => sum + Math.abs(fund.amount), 0);
  const totalExpenses = approved.reduce((sum, expense) => sum + Math.abs(expense.amount), 0);
  const totalSalaryPaid = paidSalaries({ ...store, salaries: tenantSalaries }).reduce((sum, salary) => sum + Math.abs(salary.amount), 0);
  const currentBalance = availableFunds(store, tenantId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear();

  response.json({
    totalFunds,
    totalExpenses,
    totalSalaryPaid,
    activeEmployees: employees.filter((employee) => employee.status === "active").length,
    currentBalance,
    pendingExpenses: tenantExpenses.filter((expense) => expense.status === "submitted").length,
    pendingTimesheets: store.timesheets.filter(
      (entry) => entry.status === "submitted" && employees.some((employee) => employee.id === entry.employeeId),
    ).length,
    monthToDateFunds: tenantFunds.filter((fund) => fund.date.slice(0, 7) === currentMonth).reduce((sum, fund) => sum + fund.amount, 0),
    monthToDateExpenses: approved.filter((expense) => expense.date.slice(0, 7) === currentMonth).reduce((sum, expense) => sum + expense.amount, 0),
    yearToDateFunds: tenantFunds.filter((fund) => new Date(fund.date).getFullYear() === currentYear).reduce((sum, fund) => sum + fund.amount, 0),
    yearToDateExpenses: approved.filter((expense) => new Date(expense.date).getFullYear() === currentYear).reduce((sum, expense) => sum + expense.amount, 0),
  });
});

router.get("/charts", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const tenantFunds = store.funds.filter((fund) => tenantFundFilter(fund, tenantId));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantSalaries = paidSalaries(store).filter((salary) => tenantSalaryFilter(salary, tenantId));
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index), 1);
    return {
      key: date.toISOString().slice(0, 7),
      month: date.toLocaleString("en-US", { month: "short" }),
      funds: 0,
      expenses: 0,
      salary: 0,
    };
  });

  const buckets = new Map(months.map((month) => [month.key, month]));
  for (const fund of tenantFunds) {
    const bucket = buckets.get(fund.date.slice(0, 7));
    if (bucket) {
      bucket.funds += Math.abs(fund.amount);
    }
  }
  for (const expense of approveExpenses({ ...store, expenses: tenantExpenses })) {
    const bucket = buckets.get(expense.date.slice(0, 7));
    if (bucket) {
      bucket.expenses += Math.abs(expense.amount);
    }
  }
  for (const salary of tenantSalaries.filter((item) => tenantEmployeeIds.has(item.employeeId))) {
    const bucket = buckets.get((salary.paidAt ?? salary.date).slice(0, 7));
    if (bucket) {
      bucket.salary += Math.abs(salary.amount);
    }
  }

  response.json({
    finance: months.map(({ month, funds, expenses, salary }) => ({ month, funds, expenses, salary })),
    expenseCategories: Array.from(
      approveExpenses({ ...store, expenses: tenantExpenses }).reduce((map, expense) => {
        map.set(expense.category, (map.get(expense.category) ?? 0) + Math.abs(expense.amount));
        return map;
      }, new Map<string, number>()),
    ).map(([name, value]) => ({ name, value })).sort((left, right) => right.value - left.value),
  });
});

router.get("/transactions", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const tenantFunds = store.funds.filter((fund) => tenantFundFilter(fund, tenantId));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantSalaries = paidSalaries(store).filter((salary) => tenantSalaryFilter(salary, tenantId));
  const transactions = [
    ...tenantFunds.map((fund) => ({
      id: `tx_${fund.id}`,
      type: "fund" as const,
      amount: Math.abs(fund.amount),
      date: fund.date,
      description: fund.source,
      category: "Funds",
    })),
    ...approveExpenses({ ...store, expenses: tenantExpenses }).map((expense) => ({
      id: `tx_${expense.id}`,
      type: "expense" as const,
      amount: -Math.abs(expense.amount),
      date: expense.date,
      description: expense.description,
      category: expense.category,
    })),
    ...tenantSalaries.map((salary) => ({
      id: `tx_${salary.id}`,
      type: "salary" as const,
      amount: -Math.abs(salary.amount),
      date: salary.paidAt ?? salary.date,
      description: `${salary.employeeNameSnapshot ?? employeeNames.get(salary.employeeId) ?? "Employee"} Salary`,
      category: "Payroll",
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

  response.json({ transactions });
});

router.get("/audit-trail", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  response.json({
    auditTrail: [...store.auditTrail]
      .filter((entry) => (entry.tenantId ?? DEFAULT_TENANT_ID) === tenantId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  });
});

router.get("/holidays", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const month = request.query.month?.toString().trim();
  const holidays = month
    ? store.holidays.filter((holiday) => (holiday.tenantId ?? DEFAULT_TENANT_ID) === tenantId && holiday.date.slice(0, 7) === month)
    : store.holidays.filter((holiday) => (holiday.tenantId ?? DEFAULT_TENANT_ID) === tenantId);
  response.json({ holidays: [...holidays].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()) });
});

router.post("/holidays", requireRole("admin"), async (request, response) => {
  const parsed = holidaySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid holiday payload" });
    return;
  }

  const store = await readStore();
  const now = nowIso();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = parsed.data.id ? store.holidays.find((holiday) => holiday.id === parsed.data.id) : null;
  if (existing && (existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const holiday: HolidayRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("hol"),
    tenantId,
    date: normalizeDate(parsed.data.date),
    name: parsed.data.name.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await updateStore((current) => ({
    ...current,
    holidays: existing ? current.holidays.map((item) => (item.id === holiday.id ? holiday : item)) : [holiday, ...current.holidays],
  }));

  response.status(existing ? 200 : 201).json({ holiday });
});

router.delete("/holidays/:id", requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.holidays.find((holiday) => holiday.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Holiday not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  await updateStore((current) => ({
    ...current,
    holidays: current.holidays.filter((holiday) => holiday.id !== request.params.id),
  }));

  response.status(204).end();
});

router.get("/leave-settings", async (_request, response) => {
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const rows = await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1);
  const leavePolicy = (rows[0]?.data as { leavePolicy?: LeavePolicyRecord } | undefined)?.leavePolicy;
  if (leavePolicy) {
    response.json({ leavePolicy });
    return;
  }

  const store = await readStore();
  response.json({ leavePolicy: store.leavePolicy });
});

router.patch("/leave-settings", requireRole("admin"), async (request, response) => {
  const parsed = leaveSettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid leave policy payload" });
    return;
  }

  const leavePolicy: LeavePolicyRecord = {
    annualLimit: Math.max(0, Math.round(parsed.data.annualLimit)),
    updatedAt: nowIso(),
    updatedBy: request.auth?.user.name ?? "Admin",
  };

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const rows = await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1);
  const existing = rows[0]?.data ?? {};
  const nextData = {
    ...(existing as Record<string, unknown>),
    leavePolicy,
  };

  const updated = await db
    .insert(companySettingsTable)
    .values({
      id: tenantId,
      tenantId,
      data: nextData as CompanySettingsRecord,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: companySettingsTable.tenantId,
      set: {
        data: nextData as CompanySettingsRecord,
        updatedAt: new Date(),
      },
    })
    .returning();

  response.json({ leavePolicy: (updated[0]?.data as { leavePolicy?: LeavePolicyRecord } | undefined)?.leavePolicy ?? leavePolicy });
});

router.get("/company-settings", requireRole("admin"), async (_request, response) => {
  const tenantId = _request.auth?.user.tenantId;
  const rows = tenantId
    ? await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1)
    : [];
  response.json({ companyInfo: rows[0]?.data ?? {} });
});

router.patch("/company-settings", requireRole("admin"), async (request, response) => {
  const parsed = partyInfoSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid company information." });
    return;
  }

  const now = new Date();
  const tenantId = request.auth?.user.tenantId;
  if (!tenantId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const rows = await db
    .insert(companySettingsTable)
    .values({
      id: tenantId,
      tenantId,
      data: parsed.data,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: companySettingsTable.tenantId,
      set: {
        data: parsed.data,
        updatedAt: now,
      },
    })
    .returning();

  response.json({ companyInfo: rows[0]?.data ?? parsed.data });
});

router.get("/leave-requests", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : request.query.employeeId?.toString().trim();
  const month = request.query.month?.toString().trim();
  const status = request.query.status?.toString().trim();
  const leaveRequests = employeeId
    ? store.leaveRequests.filter((leaveRequest) => (leaveRequest.tenantId ?? DEFAULT_TENANT_ID) === tenantId && leaveRequest.employeeId === employeeId)
    : request.auth?.user.role === "admin"
      ? store.leaveRequests.filter((leaveRequest) => (leaveRequest.tenantId ?? DEFAULT_TENANT_ID) === tenantId)
      : [];

  const filtered = leaveRequests.filter((leaveRequest) => {
    if (month && !(leaveRequest.startDate.slice(0, 7) <= month && leaveRequest.endDate.slice(0, 7) >= month)) {
      return false;
    }
    if (status && status !== "all" && leaveRequest.status !== status) {
      return false;
    }
    return true;
  });

  response.json({
    leaveRequests: [...filtered].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  });
});

router.post("/leave-requests", async (request, response) => {
  if (request.auth?.user.role !== "employee") {
    response.status(403).json({ message: "Only employees can create leave requests." });
    return;
  }

  const parsed = leaveRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid leave request payload" });
    return;
  }

  const employeeId = request.auth.user.id;
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeProfile = await loadEmployeeProfile(employeeId, tenantId);
  const employeeNameSnapshot = employeeProfile?.name ?? request.auth.user.name ?? "Employee";
  const startDate = normalizeDate(parsed.data.startDate);
  const endDate = normalizeDate(parsed.data.endDate);
  const kind: LeaveRequestKind = "leave";

  if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
    response.status(400).json({ message: "Leave start date cannot be after the end date." });
    return;
  }

  const requestYear = new Date(startDate).getUTCFullYear();
  if (requestYear !== new Date(endDate).getUTCFullYear()) {
    response.status(400).json({ message: "Leave request must stay within a single calendar year." });
    return;
  }

  const overlapping = store.leaveRequests.find(
    (requestItem) =>
      requestItem.employeeId === employeeId &&
      requestItem.status !== "rejected" &&
      !(new Date(requestItem.endDate).getTime() < new Date(startDate).getTime() ||
        new Date(requestItem.startDate).getTime() > new Date(endDate).getTime()),
  );

  if (overlapping) {
    response.status(409).json({
      message: `A ${leaveKindLabel(overlapping.kind)} request already exists for the selected date range.`,
    });
    return;
  }

  const requestedDays = enumerateDays(startDate, endDate).length;
  const alreadyUsedDays = countLeaveDaysInYear(store, employeeId, requestYear, tenantId);
  const nextUsedDays = alreadyUsedDays + requestedDays;
  const leavePolicyRows = await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1);
  const tenantLeavePolicy = (leavePolicyRows[0]?.data as { leavePolicy?: LeavePolicyRecord } | undefined)?.leavePolicy ?? store.leavePolicy;
  if (nextUsedDays > tenantLeavePolicy.annualLimit) {
    response.status(400).json({
      message: `This request exceeds the annual leave limit of ${tenantLeavePolicy.annualLimit} day(s).`,
    });
    return;
  }

  const leaveRequest: LeaveRequestRecord = {
    id: parsed.data.id ?? createId("leave"),
    tenantId,
    employeeId,
    employeeNameSnapshot,
    startDate,
    endDate,
    kind,
    reason: parsed.data.reason?.trim() || undefined,
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await updateStore((current) => ({
    ...current,
    leaveRequests: [leaveRequest, ...current.leaveRequests],
  }));

  response.status(201).json({ leaveRequest });
});

router.delete("/leave-requests/:id", async (request, response) => {
  const store = await readStore();
  const existing = store.leaveRequests.find((leaveRequest) => leaveRequest.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Leave request not found");
    return;
  }

  const isAdminRequest = request.auth?.user.role === "admin";
  const isOwnEmployeeRequest = request.auth?.user.role === "employee" && existing.employeeId === request.auth.user.id;

  if (!isAdminRequest && !isOwnEmployeeRequest) {
    response.status(403).json({ message: "You cannot modify this leave request." });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!isAdminRequest && existing.status === "approved") {
    response.status(409).json({ message: "Approved time off cannot be removed by the employee." });
    return;
  }

  await updateStore((current) => ({
    ...current,
    leaveRequests: current.leaveRequests.filter((leaveRequest) => leaveRequest.id !== existing.id),
  }));

  response.status(204).end();
});

router.patch("/leave-requests/:id/status", requireRole("admin"), async (request, response) => {
  const parsed = leaveDecisionSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid leave decision payload" });
    return;
  }

  const store = await readStore();
  const existing = store.leaveRequests.find((leaveRequest) => leaveRequest.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Leave request not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const updatedRequest: LeaveRequestRecord = {
    ...existing,
    status: parsed.data.status,
    reviewNote: parsed.data.reviewNote?.trim() || undefined,
    reviewedAt: nowIso(),
    reviewedBy: request.auth?.user.name ?? "Admin",
    updatedAt: nowIso(),
  };

  await updateStore((current) => ({
    ...current,
    leaveRequests: current.leaveRequests.map((leaveRequest) => (leaveRequest.id === updatedRequest.id ? updatedRequest : leaveRequest)),
  }));

  response.json({ leaveRequest: updatedRequest });
});

router.get("/month-calendar", async (request, response) => {
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

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  response.json({ monthCalendar: buildMonthCalendar(store, employeeId, month, tenantId) });
});

router.route("/funds").get(requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const funds = store.funds.filter((fund) => tenantFundFilter(fund, tenantId));
  response.json({ funds: [...funds].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()) });
}).post(requireRole("admin"), async (request, response) => {
  const parsed = fundSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid fund payload" });
    return;
  }

  const store = await readStore();
  const existing = parsed.data.id ? store.funds.find((fund) => fund.id === parsed.data.id) : null;
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (existing && (existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const fund: FundRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("fund"),
    tenantId,
    source: parsed.data.source.trim(),
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date),
    note: parsed.data.note?.trim() ?? "",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      funds: existing ? store.funds.map((item) => (item.id === fund.id ? fund : item)) : [fund, ...store.funds],
    },
    {
      ...recordActor(request),
      action: existing ? "updated" : "created",
      entityType: "fund",
      entityId: fund.id,
      summary: `${existing ? "Updated" : "Added"} fund inflow from ${fund.source}.`,
    },
  );

  await updateStore(() => next);
  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry saved",
          body: `Fund inflow from ${fund.source} was recorded.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund updated",
          body: `A fund inflow from ${fund.source} was recorded.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.status(existing ? 200 : 201).json({ fund });
});

router.route("/funds/:id").get(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const fund = store.funds.find((item) => item.id === request.params.id);
  if (!fund) {
    respondNotFound(response, "Fund not found");
    return;
  }

  if ((fund.tenantId ?? DEFAULT_TENANT_ID) !== (request.auth?.user.tenantId ?? DEFAULT_TENANT_ID)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ fund });
}).patch(requireRole("admin"), async (request, response) => {
  const parsed = fundSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid fund payload" });
    return;
  }

  const store = await readStore();
  const existing = store.funds.find((fund) => fund.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Fund not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== (request.auth?.user.tenantId ?? DEFAULT_TENANT_ID)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const fund: FundRecord = {
    ...existing,
    source: parsed.data.source.trim(),
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date),
    note: parsed.data.note?.trim() ?? "",
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      funds: store.funds.map((item) => (item.id === fund.id ? fund : item)),
    },
    {
      ...recordActor(request),
      action: "updated",
      entityType: "fund",
      entityId: fund.id,
      summary: `Updated fund inflow from ${fund.source}.`,
    },
  );

  await updateStore(() => next);
  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry updated",
          body: `Fund inflow from ${fund.source} was updated.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund entry updated",
          body: `A fund inflow from ${fund.source} was updated.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.json({ fund });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const target = store.funds.find((fund) => fund.id === request.params.id);
  if (!target) {
    respondNotFound(response, "Fund not found");
    return;
  }

  if ((target.tenantId ?? DEFAULT_TENANT_ID) !== (request.auth?.user.tenantId ?? DEFAULT_TENANT_ID)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      funds: store.funds.filter((fund) => fund.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "fund",
      entityId: String(request.params.id),
      summary: `Deleted fund inflow from ${target.source}.`,
    },
  );

  await updateStore(() => next);
  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry deleted",
          body: `Fund inflow from ${target.source} was removed.`,
          link: "/funds",
          email: false,
          metadata: { fundId: target.id, amount: target.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund entry deleted",
          body: `A fund inflow from ${target.source} was removed.`,
          link: "/funds",
          email: false,
          metadata: { fundId: target.id, amount: target.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.status(204).send();
});

router.route("/categories").get(async (_request, response) => {
  const store = await readStore();
  response.json({ categories: [...store.categories] });
}).post(requireRole("admin"), async (request, response) => {
  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid category payload" });
    return;
  }

  const store = await readStore();
  const existing = parsed.data.id ? store.categories.find((category) => category.id === parsed.data.id) : null;
  const category: ExpenseCategoryRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("cat"),
    name: parsed.data.name.trim(),
    color: parsed.data.color.trim(),
    group: parsed.data.group,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const nextStore: BusinessStore = {
    ...store,
    categories: existing ? store.categories.map((item) => (item.id === category.id ? category : item)) : [...store.categories, category],
    expenses: existing
      ? store.expenses.map((expense) =>
          (expense.tenantId ?? DEFAULT_TENANT_ID) === (request.auth?.user.tenantId ?? DEFAULT_TENANT_ID) &&
          expense.category === existing.name
            ? { ...expense, category: category.name, group: category.group, updatedAt: nowIso() }
            : expense,
        )
      : store.expenses,
  };

  const next = pushAuditEvent(nextStore, {
    ...recordActor(request),
    action: existing ? "updated" : "created",
    entityType: "category",
    entityId: category.id,
    summary: `${existing ? "Updated" : "Created"} category ${category.name}.`,
  });

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ category });
});

router.route("/categories/:id").get(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const category = store.categories.find((item) => item.id === request.params.id);
  if (!category) {
    respondNotFound(response, "Category not found");
    return;
  }

  response.json({ category });
}).patch(requireRole("admin"), async (request, response) => {
  const parsed = categorySchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid category payload" });
    return;
  }

  const store = await readStore();
  const existing = store.categories.find((category) => category.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Category not found");
    return;
  }

  const category: ExpenseCategoryRecord = {
    ...existing,
    name: parsed.data.name.trim(),
    color: parsed.data.color.trim(),
    group: parsed.data.group,
    updatedAt: nowIso(),
  };

  const nextStore: BusinessStore = {
    ...store,
    categories: store.categories.map((item) => (item.id === category.id ? category : item)),
    expenses: store.expenses.map((expense) =>
      (expense.tenantId ?? DEFAULT_TENANT_ID) === (request.auth?.user.tenantId ?? DEFAULT_TENANT_ID) &&
      expense.category === existing.name
        ? { ...expense, category: category.name, group: category.group, updatedAt: nowIso() }
        : expense,
    ),
  };

  const next = pushAuditEvent(nextStore, {
    ...recordActor(request),
    action: "updated",
    entityType: "category",
    entityId: category.id,
    summary: `Updated category ${category.name}.`,
  });

  await updateStore(() => next);
  response.json({ category });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const target = store.categories.find((category) => category.id === request.params.id);
  if (!target) {
    respondNotFound(response, "Category not found");
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      categories: store.categories.filter((category) => category.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "category",
      entityId: String(request.params.id),
      summary: "Deleted an expense category.",
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.get("/expenses", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  let expenses = store.expenses.filter((expense) => expense.tenantId === tenantId || (expense.tenantId == null && tenantId === DEFAULT_TENANT_ID));

  if (employeeId) {
    expenses = expenses.filter((expense) => expense.employeeId === employeeId);
  } else if (request.auth?.user.role !== "admin") {
    expenses = expenses.filter((expense) => expense.employeeId === request.auth?.user.id);
  }

  const status = approvalStatusSchema.safeParse(request.query.status);
  if (status.success) {
    expenses = expenses.filter((expense) => expense.status === status.data);
  }

  response.json({
    expenses: await serializeExpenses(
      [...expenses].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()),
    ),
  });
});

router.post("/expenses", async (request, response) => {
  const parsed = expenseSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense payload" });
    return;
  }

  const store = await readStore();
  const actor = recordActor(request);
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId?.trim() || undefined;
  const employee = employeeId ? await loadEmployeeProfile(employeeId, tenantId) : null;
  const existing = parsed.data.id ? store.expenses.find((expense) => expense.id === parsed.data.id) : null;
  const status = parsed.data.status ?? existing?.status ?? "submitted";

  if (existing && existing.tenantId !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  if (employeeId && employeeId !== request.auth?.user.id && request.auth?.user.role === "employee") {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (status === "approved" && (!existing || existing.status !== "approved")) {
    ensureFunds(store, parsed.data.amount, "this expense", tenantId);
  }

  const expense: ExpenseRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("exp"),
    tenantId,
    employeeId,
    employeeNameSnapshot: request.auth?.user.role === "employee" ? request.auth.user.name : parsed.data.employeeNameSnapshot?.trim() || existing?.employeeNameSnapshot || employee?.name,
    project: parsed.data.project?.trim() || existing?.project,
    category: parsed.data.category.trim(),
    group: parsed.data.group,
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date),
    description: parsed.data.description.trim(),
    note: parsed.data.note?.trim() || existing?.note,
    attachmentName: parsed.data.attachmentName?.trim() || existing?.attachmentName,
    attachmentPath: parsed.data.attachmentPath?.trim() || existing?.attachmentPath,
    reimbursable: parsed.data.reimbursable ?? existing?.reimbursable ?? parsed.data.group === "office",
    status,
    reviewerNote: parsed.data.reviewerNote?.trim() || existing?.reviewerNote,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      expenses: existing ? store.expenses.map((item) => (item.id === expense.id ? expense : item)) : [expense, ...store.expenses],
    },
    {
      actorName: actor.actorName,
      actorRole: request.auth?.user.role ?? "system",
      action: existing ? "updated" : "created",
      entityType: "expense",
      entityId: expense.id,
      summary: `Submitted ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR.`,
    },
  );

  await updateStore(() => next);
  if (request.auth?.user.role === "employee" && !existing) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "expense_submitted",
          title: "Expense submitted",
          body: `Your ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR is awaiting review.`,
          link: "/employee/expenses",
          email: false,
          metadata: { expenseId: expense.id, category: expense.category },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "expense_submitted",
          title: "New expense needs review",
          body: `${expense.employeeNameSnapshot ?? "An employee"} submitted ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR.`,
          link: "/expenses",
          email: true,
          metadata: { expenseId: expense.id, category: expense.category, employeeId: expense.employeeId },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.status(existing ? 200 : 201).json({ expense: await serializeExpense(expense) });
});

router.route("/expenses/:id").get(async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const expense = store.expenses.find((item) => item.id === request.params.id);
  if (!expense) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if ((expense.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (request.auth?.user.role === "employee" && expense.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ expense: await serializeExpense(expense) });
}).patch(async (request, response) => {
  const parsed = expenseSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const status = parsed.data.status ?? existing.status;
  if (status === "approved" && existing.status !== "approved") {
    ensureFunds(store, parsed.data.amount, "this expense", tenantId);
  }

  const expense: ExpenseRecord = {
    ...existing,
    employeeId: request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId?.trim() || existing.employeeId,
    employeeNameSnapshot:
      request.auth?.user.role === "employee"
        ? request.auth.user.name
        : parsed.data.employeeNameSnapshot?.trim() || existing.employeeNameSnapshot,
    project: parsed.data.project?.trim() || existing.project,
    category: parsed.data.category.trim(),
    group: parsed.data.group,
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date),
    description: parsed.data.description.trim(),
    note: parsed.data.note?.trim() || existing.note,
    attachmentName: parsed.data.attachmentName?.trim() || existing.attachmentName,
    attachmentPath: parsed.data.attachmentPath?.trim() || existing.attachmentPath,
    reimbursable: parsed.data.reimbursable ?? existing.reimbursable,
    status,
    reviewerNote: parsed.data.reviewerNote?.trim() || existing.reviewerNote,
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      expenses: store.expenses.map((item) => (item.id === expense.id ? expense : item)),
    },
    {
      ...recordActor(request),
      action: status === "approved" ? "approved" : "updated",
      entityType: "expense",
      entityId: expense.id,
      summary: `${status === "approved" ? "Approved" : "Updated"} an expense submission.`,
    },
  );

  await updateStore(() => next);
  response.json({ expense: await serializeExpense(expense) });
}).delete(async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      expenses: store.expenses.filter((expense) => expense.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "expense",
      entityId: String(request.params.id),
      summary: "Deleted an expense submission.",
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.patch("/expenses/:id/status", requireRole("admin"), async (request, response) => {
  const parsed = z.object({
    status: approvalStatusSchema,
    reviewerNote: z.string().trim().optional(),
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense status payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if (existing.tenantId !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (parsed.data.status === "approved" && existing.status !== "approved") {
    ensureFunds(store, existing.amount, "this expense", tenantId);
  }

  const expense: ExpenseRecord = {
    ...existing,
    status: parsed.data.status,
    reviewerNote: parsed.data.reviewerNote?.trim() || undefined,
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      expenses: store.expenses.map((item) => (item.id === expense.id ? expense : item)),
    },
    {
      ...recordActor(request),
      action: parsed.data.status === "approved" ? "approved" : "rejected",
      entityType: "expense",
      entityId: expense.id,
      summary: `${parsed.data.status === "approved" ? "Approved" : "Rejected"} an expense submission.`,
    },
  );

  await updateStore(() => next);
  if (expense.employeeId && expense.status !== existing.status && (expense.status === "approved" || expense.status === "rejected")) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyEmployee(
        expense.employeeId,
        actor,
        {
          type: expense.status === "approved" ? "expense_approved" : "expense_rejected",
          title: expense.status === "approved" ? "Expense approved" : "Expense returned",
          body:
            expense.status === "approved"
              ? `Your expense for ${expense.amount.toLocaleString("en-IN")} INR was approved.`
              : `Your expense was rejected${expense.reviewerNote ? `: ${expense.reviewerNote}` : "."}`,
          link: "/employee/expenses",
          email: true,
          metadata: { expenseId: expense.id, reviewerNote: expense.reviewerNote },
        },
      ),
    );
  }
  response.json({ expense: await serializeExpense(expense) });
});

router.get("/salaries", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  if (employeeId && !tenantEmployeeIds.has(employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  let salaries = [...store.salaries]
    .filter((salary) => tenantSalaryFilter(salary, tenantId))
    .sort(
      (left, right) => new Date(right.paidAt ?? right.date).getTime() - new Date(left.paidAt ?? left.date).getTime(),
    );

  if (employeeId) {
    salaries = salaries.filter((salary) => salary.employeeId === employeeId);
  } else if (request.auth?.user.role !== "admin") {
    salaries = salaries.filter((salary) => salary.employeeId === request.auth?.user.id);
  }

  response.json({ salaries });
});

router.post("/salaries", requireRole("admin"), async (request, response) => {
  const parsed = salarySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = parsed.data.id ? store.salaries.find((salary) => salary.id === parsed.data.id) : null;
  if (existing && !tenantSalaryFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const employee = await loadEmployeeProfile(parsed.data.employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const status = parsed.data.status ?? existing?.status ?? "pending";
  if (status === "paid" && (!existing || existing.status !== "paid")) {
    ensureFunds(store, parsed.data.amount, "this salary payment", tenantId);
  }

  const salary: SalaryRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("sal"),
    tenantId,
    employeeId: parsed.data.employeeId.trim(),
    employeeNameSnapshot: parsed.data.employeeNameSnapshot?.trim() || existing?.employeeNameSnapshot || employee.name,
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date ?? nowIso()),
    note: parsed.data.note?.trim() || existing?.note || "",
    status,
    source: parsed.data.source ?? existing?.source ?? "manual",
    paidAt: parsed.data.paidAt ? normalizeDate(parsed.data.paidAt) : status === "paid" ? existing?.paidAt ?? nowIso() : existing?.paidAt,
    weekStart: parsed.data.weekStart ? normalizeWeekStart(parsed.data.weekStart) : existing?.weekStart,
    hours: parsed.data.hours ?? existing?.hours,
    rate: parsed.data.rate ?? existing?.rate,
    timesheetId: parsed.data.timesheetId?.trim() || existing?.timesheetId,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      salaries: existing ? store.salaries.map((item) => (item.id === salary.id ? salary : item)) : [salary, ...store.salaries],
    },
    {
      ...recordActor(request),
      action: existing ? "updated" : "created",
      entityType: "salary",
      entityId: salary.id,
      summary: `${existing ? "Updated" : "Created"} a salary record for ${salary.employeeNameSnapshot ?? "employee"}.`,
    },
  );

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ salary });
});

router.route("/salaries/:id").get(async (request, response) => {
  const store = await readStore();
  const salary = store.salaries.find((item) => item.id === request.params.id);
  if (!salary) {
    respondNotFound(response, "Salary not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantSalaryFilter(salary, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (request.auth?.user.role === "employee" && salary.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ salary });
}).patch(requireRole("admin"), async (request, response) => {
  const parsed = salarySchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payload" });
    return;
  }

  const store = await readStore();
  const existing = store.salaries.find((salary) => salary.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Salary not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantSalaryFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const employee = await loadEmployeeProfile(parsed.data.employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const status = parsed.data.status ?? existing.status;
  if (status === "paid" && existing.status !== "paid") {
    ensureFunds(store, parsed.data.amount, "this salary payment", tenantId);
  }

  const salary: SalaryRecord = {
    ...existing,
    tenantId,
    employeeId: parsed.data.employeeId.trim(),
    employeeNameSnapshot: parsed.data.employeeNameSnapshot?.trim() || existing.employeeNameSnapshot || employee.name,
    amount: Math.abs(parsed.data.amount),
    date: normalizeDate(parsed.data.date ?? existing.date),
    note: parsed.data.note?.trim() || existing.note,
    status,
    source: parsed.data.source ?? existing.source,
    paidAt: parsed.data.paidAt ? normalizeDate(parsed.data.paidAt) : status === "paid" ? existing.paidAt ?? nowIso() : existing.paidAt,
    weekStart: parsed.data.weekStart ? normalizeWeekStart(parsed.data.weekStart) : existing.weekStart,
    hours: parsed.data.hours ?? existing.hours,
    rate: parsed.data.rate ?? existing.rate,
    timesheetId: parsed.data.timesheetId?.trim() || existing.timesheetId,
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      salaries: store.salaries.map((item) => (item.id === salary.id ? salary : item)),
    },
    {
      ...recordActor(request),
      action: status === "paid" ? "paid" : "updated",
      entityType: "salary",
      entityId: salary.id,
      summary: `${status === "paid" ? "Marked" : "Updated"} a salary record.`,
    },
  );

  await updateStore(() => next);
  if (salary.employeeId && status === "paid" && existing.status !== "paid") {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "salary_paid",
          title: "Salary updated",
          body: `Salary record for ${salary.employeeNameSnapshot ?? "an employee"} was marked as paid.`,
          link: "/salary",
          email: false,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        salary.employeeId,
        actor,
        {
          type: "salary_paid",
          title: "Salary paid",
          body: `Your salary payment of ${salary.amount.toLocaleString("en-IN")} INR has been marked as paid.`,
          link: "/employee/salary-slips",
          email: true,
          metadata: { salaryId: salary.id, amount: salary.amount },
        },
      ),
    );
  }
  response.json({ salary });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const salary = store.salaries.find((item) => item.id === request.params.id);
  if (!salary) {
    respondNotFound(response, "Salary not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantSalaryFilter(salary, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      salaries: store.salaries.filter((item) => item.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "salary",
      entityId: String(request.params.id),
      summary: "Deleted a salary record.",
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.post("/salaries/:id/pay", requireRole("admin"), async (request, response) => {
  const parsed = z.object({ note: z.string().trim().optional() }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payment payload" });
    return;
  }

  const store = await readStore();
  const existing = store.salaries.find((salary) => salary.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Salary not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantSalaryFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status !== "paid") {
    try {
      ensureFunds(store, existing.amount, "this salary payment", tenantId);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : "Insufficient total funds for this salary payment.",
      });
      return;
    }
  }

  const salary: SalaryRecord = {
    ...existing,
    tenantId,
    status: "paid",
    paidAt: nowIso(),
    date: nowIso(),
    note: parsed.data.note?.trim() || existing.note,
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      salaries: store.salaries.map((item) => (item.id === salary.id ? salary : item)),
    },
    {
      ...recordActor(request),
      action: "paid",
      entityType: "salary",
      entityId: salary.id,
      summary: "Marked a salary record as paid.",
    },
  );

  await updateStore(() => next);
  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "salary_paid",
          title: "Salary payment completed",
          body: `Marked salary payment of ${salary.amount.toLocaleString("en-IN")} INR as paid.`,
          link: "/salary",
          email: false,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        salary.employeeId,
        actor,
        {
          type: "salary_paid",
          title: "Salary paid",
          body: `Your salary payment of ${salary.amount.toLocaleString("en-IN")} INR has been marked as paid.`,
          link: "/employee/salary-slips",
          email: true,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId, amount: salary.amount },
        },
      ),
    );
  }
  response.json({ salary });
});

router.get("/timesheets", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  if (employeeId && !tenantEmployeeIds.has(employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
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

router.get("/timesheets/summary", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  if (employeeId && !tenantEmployeeIds.has(employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
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

router.get("/timesheets/by-week", async (request, response) => {
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  const weekStart = (request.query as { weekStart?: string }).weekStart;
  if (!employeeId || !weekStart) {
    response.status(400).json({ message: "Missing employee or week" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  if (!tenantEmployees.some((employee) => employee.id === employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const timesheet = store.timesheets.find(
    (entry) => entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(weekStart),
  );

  response.json({ timesheet: timesheet ?? null });
});

router.get("/timesheets/:id", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const timesheet = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!timesheet) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  if (!tenantEmployeeIds.has(timesheet.employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  if (request.auth?.user.role === "employee" && timesheet.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ timesheet });
});

router.post("/timesheets", async (request, response) => {
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
    if (!tenantEmployees.some((employee) => employee.id === employeeId)) {
      response.status(403).json({ message: "Forbidden" });
      return;
    }
  }
  const employee =
    request.auth?.user.role === "employee"
      ? {
          id: request.auth.user.id,
          name: request.auth.user.name ?? "Employee",
        }
      : await loadEmployeeProfile(employeeId, tenantId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const existing = parsed.data.id ? store.timesheets.find((entry) => entry.id === parsed.data.id) : store.timesheets.find(
    (entry) => entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(parsed.data.weekStart),
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
    status: parsed.data.status ?? existing?.status ?? "draft",
    submittedAt: parsed.data.submittedAt ? normalizeDate(parsed.data.submittedAt) : existing?.submittedAt,
    reviewedAt: parsed.data.reviewedAt ? normalizeDate(parsed.data.reviewedAt) : existing?.reviewedAt,
    reviewedBy: parsed.data.reviewedBy?.trim() || existing?.reviewedBy,
    reviewNotes: parsed.data.reviewNotes?.trim() || existing?.reviewNotes,
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

  const savedEntry = await saveTimesheetFast({
    entry,
    audit: {
      actorName: actor.actorName,
      actorRole: request.auth?.user.role ?? "system",
      action: existing ? "saved" : "created",
      entityType: "timesheet",
      entityId: entry.id,
      summary: `${existing ? "Saved" : "Started"} timesheet draft for week of ${entry.weekStart}.`,
    },
  });

  response.status(existing ? 200 : 201).json({ timesheet: savedEntry ?? entry });
});

router.patch("/timesheets/:id", async (request, response) => {
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

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId;
  const employee =
    request.auth?.user.role === "employee"
      ? {
          id: request.auth.user.id,
          name: request.auth.user.name ?? existing.employeeNameSnapshot,
        }
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
    status: parsed.data.status ?? existing.status,
    submittedAt: parsed.data.submittedAt ? normalizeDate(parsed.data.submittedAt) : existing.submittedAt,
    reviewedAt: parsed.data.reviewedAt ? normalizeDate(parsed.data.reviewedAt) : existing.reviewedAt,
    reviewedBy: parsed.data.reviewedBy?.trim() || existing.reviewedBy,
    reviewNotes: parsed.data.reviewNotes?.trim() || existing.reviewNotes,
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

  const savedEntry = await saveTimesheetFast({
    entry,
    audit: {
      ...recordActor(request),
      action: "saved",
      entityType: "timesheet",
      entityId: entry.id,
      summary: `Saved timesheet draft for week of ${entry.weekStart}.`,
    },
  });

  response.json({ timesheet: savedEntry ?? entry });
});

router.post("/timesheets/submit", async (request, response) => {
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
      ? {
          id: request.auth.user.id,
          name: request.auth.user.name ?? "Employee",
        }
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

  const submittedEntry = await submitTimesheetEntryFast({
    entry,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  });

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

router.post("/timesheets/:id/submit", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  if (!tenantEmployeeIds.has(existing.employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const submittedEntry = await submitTimesheetFast({
    id: request.params.id,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  });
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

router.post("/timesheets/:id/approve", requireRole("admin"), async (request, response) => {
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

  if (!tenantEmployeeIds.has(existing.employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const employee = await loadEmployeeProfile(existing.employeeId, tenantId);
  const reviewResult = await reviewTimesheetFast({
    id: String(request.params.id),
    status: "approved",
    actorName: request.auth?.user.name ?? "Admin",
    note: parsed.data.note?.trim() || undefined,
    employee,
  });
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

router.post("/timesheets/:id/reject", requireRole("admin"), async (request, response) => {
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

  if (!tenantEmployeeIds.has(existing.employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const reviewResult = await reviewTimesheetFast({
    id: String(request.params.id),
    status: "rejected",
    actorName: request.auth?.user.name ?? "Admin",
    note: parsed.data.note,
  });
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

router.delete("/timesheets/:id", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  if (!tenantEmployeeIds.has(existing.employeeId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
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

router.get("/projects", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const projectBudgets = store.projectBudgets.filter((budget) => tenantProjectFilter(budget, tenantId));
  response.json({
    projectBudgets: [...projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
    projects: [...projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
  });
});

router.get("/projects/catalog", async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const projects = store.projectBudgets
    .filter((budget) => tenantProjectFilter(budget, tenantId))
    .sort((left, right) => left.project.localeCompare(right.project))
    .map((budget) => ({
      id: budget.id,
      project: budget.project,
      client: budget.client,
      notes: budget.note,
      totalBudget: budget.totalBudget,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      tasks: [...budget.tasks].filter((task) => task.status !== "archived").sort((left, right) => left.name.localeCompare(right.name)),
    }));

  response.json({ projectCatalog: projects, projects });
});

router.get("/projects/summary", async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantProjectBudgets = store.projectBudgets.filter((budget) => tenantProjectFilter(budget, tenantId));
  const grouped = new Map<string, {
    id: string;
    project: string;
    labourHours: number;
    labourCost: number;
    expenseCost: number;
    totalBudget: number;
    client?: string;
    note?: string;
  }>();

  const ensureBucket = (project: string) => {
    if (!grouped.has(project)) {
      const budget = tenantProjectBudgets.find((item) => item.project === project);
      grouped.set(project, {
        id: budget?.id ?? `project_${project.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        project,
        labourHours: 0,
        labourCost: 0,
        expenseCost: 0,
        totalBudget: budget?.totalBudget ?? 0,
        client: budget?.client,
        note: budget?.note,
      });
    }

    return grouped.get(project)!;
  };

  for (const entry of store.timesheets) {
    if (!employeeMap.has(entry.employeeId)) {
      continue;
    }
    if (entry.status === "draft" || entry.status === "rejected") {
      continue;
    }

    const employee = employeeMap.get(entry.employeeId);
    const rate = effectiveHourlyRate(employee);
    for (const line of entry.lines) {
      const project = line.project.trim();
      if (!project) {
        continue;
      }

      const hours = DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
      const bucket = ensureBucket(project);
      bucket.labourHours += hours;
      bucket.labourCost += hours * rate;
    }
  }

  for (const expense of approveExpenses({ ...store, expenses: tenantExpenses })) {
    const project = expense.project?.trim();
    if (!project) {
      continue;
    }

    const bucket = ensureBucket(project);
    bucket.expenseCost += Math.abs(expense.amount);
  }

  const projectBudgetSummary = Array.from(grouped.values())
    .map((item) => {
      const spent = item.labourCost + item.expenseCost;
      return {
        ...item,
        spent,
        remainingBudget: Math.max(0, item.totalBudget - spent),
        utilisation: item.totalBudget > 0 ? Math.min(100, Number(((spent / item.totalBudget) * 100).toFixed(1))) : 0,
      };
    })
    .sort((left, right) => right.spent - left.spent || left.project.localeCompare(right.project));

  response.json({ projectBudgetSummary, projects: projectBudgetSummary });
});

router.get("/projects/names", async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantProjectBudgets = store.projectBudgets.filter((budget) => tenantProjectFilter(budget, tenantId));
  const names = new Set<string>();

  for (const entry of store.timesheets) {
    if (!employeeIds.has(entry.employeeId)) {
      continue;
    }
    for (const line of entry.lines) {
      if (line.project.trim()) {
        names.add(line.project.trim());
      }
    }
  }

  for (const expense of tenantExpenses) {
    if (expense.project?.trim()) {
      names.add(expense.project.trim());
    }
  }

  for (const budget of tenantProjectBudgets) {
    if (budget.project.trim()) {
      names.add(budget.project.trim());
    }
  }

  response.json({ projectNames: Array.from(names).sort((left, right) => left.localeCompare(right)) });
});

router.post("/projects", requireRole("admin"), async (request, response) => {
  const parsed = projectSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = parsed.data.id ? store.projectBudgets.find((budget) => budget.id === parsed.data.id) : null;
  if (existing && !tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const budget: ProjectBudget = {
    id: parsed.data.id ?? existing?.id ?? createId("pb"),
    tenantId,
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing?.client,
    note: parsed.data.note?.trim() || existing?.note,
    tasks: (parsed.data.tasks ?? existing?.tasks ?? []).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
      status: task.status === "archived" ? "archived" : "active",
    })),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: existing ? store.projectBudgets.map((item) => (item.id === budget.id ? budget : item)) : [budget, ...store.projectBudgets],
    },
    {
      ...recordActor(request),
      action: existing ? "updated" : "created",
      entityType: "project-budget",
      entityId: budget.id,
      summary: `${existing ? "Updated" : "Added"} budget for project ${budget.project}.`,
    },
  );

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ projectBudget: budget, project: budget });
});

router.route("/projects/:id").get(async (request, response) => {
  const store = await readStore();
  const project = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!project) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(project, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ projectBudget: project, project });
}).patch(requireRole("admin"), async (request, response) => {
  const parsed = projectSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project payload" });
    return;
  }

  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const budget: ProjectBudget = {
    ...existing,
    tenantId,
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing.client,
    note: parsed.data.note?.trim() || existing.note,
    tasks: (parsed.data.tasks ?? existing.tasks).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
      status: task.status === "archived" ? "archived" : "active",
    })),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.map((item) => (item.id === budget.id ? budget : item)),
    },
    {
      ...recordActor(request),
      action: "updated",
      entityType: "project-budget",
      entityId: budget.id,
      summary: `Updated budget for project ${budget.project}.`,
    },
  );

  await updateStore(() => next);
  response.json({ projectBudget: budget, project: budget });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.filter((budget) => budget.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "project-budget",
      entityId: String(request.params.id),
      summary: `Deleted project budget ${existing.project}.`,
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.post("/projects/:id/tasks", requireRole("admin"), async (request, response) => {
  const parsed = projectTaskSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project task payload" });
    return;
  }

  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const task: ProjectBudget["tasks"][number] = {
    id: parsed.data.id ?? createId("pbt"),
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || undefined,
    maxHours: Number(parsed.data.maxHours ?? 0) > 0 ? Number(parsed.data.maxHours) : undefined,
    status: parsed.data.status === "archived" ? "archived" : "active",
  };
  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.map((budget) =>
        budget.id === request.params.id ? { ...budget, tasks: [...budget.tasks, task], updatedAt: nowIso() } : budget,
      ),
    },
    {
      ...recordActor(request),
      action: "created",
      entityType: "project-budget",
      entityId: String(request.params.id),
      summary: `Added task ${task.name} to ${existing.project}.`,
    },
  );

  await updateStore(() => next);
  response.status(201).json({ task });
});

router.get("/purchase-orders", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  response.json({
    purchaseOrders: store.purchaseOrders
      .filter((order) => tenantPurchaseOrderFilter(order, tenantId))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  });
});

router.post("/purchase-orders", requireRole("admin"), async (request, response) => {
  const parsed = poSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = parsed.data.id ? store.purchaseOrders.find((order) => order.id === parsed.data.id) : null;
  if (existing && !tenantPurchaseOrderFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const tasks = (parsed.data.tasks ?? existing?.tasks ?? [])
    .map((task) => {
      const hours = Math.max(0, Number(task.hours ?? 0));
      const rate = Math.max(0, Number(task.rate ?? 0));
      return {
        id: task.id ?? createId("po_task"),
        taskName: task.taskName.trim(),
        description: task.description?.trim() || "",
        hours,
        rate,
        amount: calculatePoTaskAmount(hours, rate),
        status: "pending" as const,
      };
    })
    .filter((task) => task.taskName.trim() && task.amount > 0);
  const totalAmount = Math.abs(parsed.data.totalAmount);
  const plannedAmount = sumPurchaseOrderTasks(tasks);
  if (plannedAmount > totalAmount) {
    response.status(400).json({ message: "Planned work rows cannot exceed the PO cap amount." });
    return;
  }
  const order: PurchaseOrder = {
    id: parsed.data.id ?? existing?.id ?? createId("po"),
    tenantId,
    title: parsed.data.title.trim(),
    totalAmount,
    usedAmount: existing?.usedAmount ?? 0,
    remainingAmount: existing ? Math.max(0, totalAmount - existing.usedAmount) : totalAmount,
    vendor: parsed.data.vendor?.trim() || existing?.vendor,
    date: normalizeDate(parsed.data.date),
    notes: parsed.data.notes?.trim() || existing?.notes,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    tasks,
  };

  const next = pushAuditEvent(
    {
      ...store,
      purchaseOrders: existing ? store.purchaseOrders.map((item) => (item.id === order.id ? order : item)) : [order, ...store.purchaseOrders],
    },
    {
      ...recordActor(request),
      action: existing ? "updated" : "created",
      entityType: "purchase-order",
      entityId: order.id,
      summary: `${existing ? "Updated" : "Created"} budget sheet ${order.title}.`,
    },
  );

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ purchaseOrder: order });
});

router.route("/purchase-orders/:id").get(async (request, response) => {
  const store = await readStore();
  const purchaseOrder = store.purchaseOrders.find((order) => order.id === request.params.id);
  if (!purchaseOrder) {
    respondNotFound(response, "Purchase order not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantPurchaseOrderFilter(purchaseOrder, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ purchaseOrder });
}).patch(requireRole("admin"), async (request, response) => {
  const parsed = poSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order payload" });
    return;
  }

  const store = await readStore();
  const existing = store.purchaseOrders.find((order) => order.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Purchase order not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantPurchaseOrderFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const totalAmount = Math.abs(parsed.data.totalAmount);
  if (totalAmount < existing.usedAmount) {
    response.status(400).json({ message: "Total fund amount cannot be less than the used amount." });
    return;
  }

  const plannedAmount = sumPurchaseOrderTasks(existing.tasks);
  if (totalAmount < plannedAmount) {
    response.status(400).json({ message: "PO cap cannot be less than the total of all work rows." });
    return;
  }

  const purchaseOrder: PurchaseOrder = {
    ...existing,
    tenantId,
    title: parsed.data.title.trim(),
    totalAmount,
    remainingAmount: Number((totalAmount - existing.usedAmount).toFixed(2)),
    vendor: parsed.data.vendor?.trim() || undefined,
    date: normalizeDate(parsed.data.date),
    notes: parsed.data.notes?.trim() || undefined,
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      purchaseOrders: store.purchaseOrders.map((order) => (order.id === purchaseOrder.id ? purchaseOrder : order)),
    },
    {
      ...recordActor(request),
      action: "updated",
      entityType: "purchase-order",
      entityId: purchaseOrder.id,
      summary: `Updated budget sheet ${purchaseOrder.title}.`,
    },
  );

  await updateStore(() => next);
  response.json({ purchaseOrder });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.purchaseOrders.find((order) => order.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Purchase order not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantPurchaseOrderFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.usedAmount > 0 || existing.tasks.some((task) => task.status === "paid")) {
    response.status(400).json({ message: "Paid purchase orders cannot be deleted. Keep the sheet for record history." });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      purchaseOrders: store.purchaseOrders.filter((order) => order.id !== request.params.id),
    },
    {
      ...recordActor(request),
      action: "deleted",
      entityType: "purchase-order",
      entityId: String(request.params.id),
      summary: `Deleted budget sheet ${existing.title}.`,
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.post("/purchase-orders/:id/tasks", requireRole("admin"), async (request, response) => {
  const parsed = poTaskSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order task payload" });
    return;
  }

  const store = await readStore();
  const existing = store.purchaseOrders.find((order) => order.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Purchase order not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantPurchaseOrderFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const taskHours = Math.max(0, Number(parsed.data.hours ?? 0));
  const taskRate = Math.max(0, Number(parsed.data.rate ?? 0));
  const task = {
    id: parsed.data.id ?? createId("po_task"),
    taskName: parsed.data.taskName.trim(),
    description: parsed.data.description?.trim() || "",
    hours: taskHours,
    rate: taskRate,
    amount: calculatePoTaskAmount(taskHours, taskRate),
    status: "pending" as const,
  };

  if (task.amount <= 0) {
    response.status(400).json({ message: "Task total must be greater than zero." });
    return;
  }

  const plannedAmount = sumPurchaseOrderTasks(existing.tasks) + task.amount;
  if (plannedAmount > existing.totalAmount) {
    response.status(400).json({ message: "This row exceeds the remaining PO cap. Increase the cap or lower the row total." });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      purchaseOrders: store.purchaseOrders.map((order) =>
        order.id === existing.id ? { ...order, tasks: [...order.tasks, task], updatedAt: nowIso() } : order,
      ),
    },
    {
      ...recordActor(request),
      action: "created",
      entityType: "purchase-order-task",
      entityId: task.id,
      summary: `Added task ${task.taskName} to ${existing.title}.`,
    },
  );

  await updateStore(() => next);
  response.status(201).json({ task });
});

router.post("/purchase-orders/:id/tasks/:taskId/pay", requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const order = store.purchaseOrders.find((item) => item.id === request.params.id);
  const task = order?.tasks.find((item) => item.id === request.params.taskId);
  if (!order || !task) {
    respondNotFound(response, "Purchase order task not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantPurchaseOrderFilter(order, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (task.status === "paid") {
    response.json({ purchaseOrder: order });
    return;
  }

  if (task.amount > order.remainingAmount) {
    response.status(400).json({ message: "Insufficient balance in PO fund" });
    return;
  }

  ensureFunds(store, task.amount, "this PO task payment", tenantId);
  const now = nowIso();
  const next = pushAuditEvent(
    {
      ...store,
      expenses: [
        {
          id: createId("exp"),
          tenantId,
          category: "Budget Sheet",
          group: "office",
          amount: task.amount,
          date: now,
          description: `${order.title} - ${task.taskName}`,
          note: task.description,
          reimbursable: true,
          status: "approved",
          createdAt: now,
          updatedAt: now,
        },
        ...store.expenses,
      ],
      purchaseOrders: store.purchaseOrders.map((item) =>
        item.id === order.id
          ? {
              ...item,
              usedAmount: Number((item.usedAmount + task.amount).toFixed(2)),
              remainingAmount: Math.max(0, Number((item.remainingAmount - task.amount).toFixed(2))),
              tasks: item.tasks.map((row) => (row.id === task.id ? { ...row, status: "paid" as const, paidAt: now } : row)),
              updatedAt: now,
            }
          : item,
      ),
    },
    {
      ...recordActor(request),
      action: "paid",
      entityType: "purchase-order-task",
      entityId: task.id,
      summary: `Marked ${task.taskName} as paid in ${order.title}.`,
    },
  );

  await updateStore(() => next);
  {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "purchase_order_task_paid",
          title: "PO task paid",
          body: `${task.taskName} in ${order.title} was marked as paid for ${task.amount.toLocaleString("en-IN")} INR.`,
          link: "/purchase-orders",
          email: false,
          metadata: { purchaseOrderId: order.id, purchaseOrderTaskId: task.id, amount: task.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "purchase_order_task_paid",
          title: "PO task paid",
          body: `${task.taskName} in ${order.title} was marked as paid for ${task.amount.toLocaleString("en-IN")} INR.`,
          link: "/purchase-orders",
          email: false,
          metadata: { purchaseOrderId: order.id, purchaseOrderTaskId: task.id, amount: task.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }
  response.json({ purchaseOrder: next.purchaseOrders.find((item) => item.id === order.id) ?? order });
});

router.get("/pre-approvals", requireRole("admin", "client"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const rows = await db
    .select()
    .from(preApprovalsTable)
    .where(
      request.auth?.user.role === "client"
        ? and(eq(preApprovalsTable.tenantId, tenantId), eq(preApprovalsTable.clientId, request.auth.user.id))
        : eq(preApprovalsTable.tenantId, tenantId),
    )
    .orderBy(desc(preApprovalsTable.updatedAt));

  response.json({ preApprovals: rows.map(serializePreApproval) });
});

router.post("/pre-approvals", requireRole("admin"), async (request, response) => {
  const parsed = preApprovalSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid pre-approval payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const client = await loadClientUser(parsed.data.clientId, tenantId);
  if (!client) {
    response.status(400).json({ message: "Select a valid active client." });
    return;
  }
  if ((client.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const now = new Date();
  const tasks = (parsed.data.tasks ?? [])
    .map(normalizeApprovalTask)
    .filter((task) => task.taskName && task.amount > 0);

  const rows = await db
    .insert(preApprovalsTable)
    .values({
      id: createId("pa"),
      tenantId,
      title: parsed.data.title.trim(),
      project: parsed.data.project.trim(),
      clientId: client.id,
      clientNameSnapshot: client.name,
      date: new Date(normalizeDate(parsed.data.date)),
      notes: parsed.data.notes?.trim() || "",
      companyInfo: parsed.data.companyInfo ?? {},
      clientInfo: parsed.data.clientInfo ?? {},
      projectInfo: parsed.data.projectInfo ?? {},
      status: "draft",
      createdById: request.auth?.user.id ?? null,
      tasks,
      comments: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "created",
    entityType: "pre-approval",
    entityId: rows[0]!.id,
    summary: `Created pre-approval ${rows[0]!.title} for ${client.name}.`,
  });

  response.status(201).json({ preApproval: serializePreApproval(rows[0]!) });
});

router.route("/pre-approvals/:id").get(requireRole("admin", "client"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const preApproval = rows[0];
  if (!preApproval) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((preApproval.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!assertClientCanAccess(request, preApproval, response)) {
    return;
  }

  response.json({ preApproval: serializePreApproval(preApproval) });
}).patch(requireRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const parsed = preApprovalSchema.safeParse({ ...request.body, id: preApprovalId });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid pre-approval payload" });
    return;
  }

  const existingRows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = existingRows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status === "approved") {
    response.status(400).json({ message: "Approved pre-approvals cannot be edited." });
    return;
  }

  const client = await loadClientUser(parsed.data.clientId, tenantId);
  if (!client) {
    response.status(400).json({ message: "Select a valid active client." });
    return;
  }
  if ((client.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const tasks = (parsed.data.tasks ?? [])
    .map(normalizeApprovalTask)
    .filter((task) => task.taskName && task.amount > 0);

  const rows = await db
    .update(preApprovalsTable)
    .set({
      title: parsed.data.title.trim(),
      project: parsed.data.project.trim(),
      tenantId,
      clientId: client.id,
      clientNameSnapshot: client.name,
      date: new Date(normalizeDate(parsed.data.date)),
      notes: parsed.data.notes?.trim() || "",
      companyInfo: parsed.data.companyInfo ?? {},
      clientInfo: parsed.data.clientInfo ?? {},
      projectInfo: parsed.data.projectInfo ?? {},
      tasks,
      status: existing.status === "changes_requested" ? "draft" : existing.status,
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "updated",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Updated pre-approval ${parsed.data.title.trim()}.`,
  });

  response.json({ preApproval: serializePreApproval(rows[0]!) });
}).delete(requireRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const existingRows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = existingRows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status === "approved") {
    response.status(400).json({ message: "Approved pre-approvals cannot be deleted." });
    return;
  }

  await db.delete(preApprovalsTable).where(eq(preApprovalsTable.id, existing.id));
  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "deleted",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Deleted pre-approval ${existing.title}.`,
  });

  response.status(204).send();
});

router.post("/pre-approvals/:id/submit", requireRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = rows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.tasks.length === 0) {
    response.status(400).json({ message: "Add at least one work row before sending for client approval." });
    return;
  }

  if (existing.status === "approved") {
    response.status(400).json({ message: "Approved pre-approvals cannot be resubmitted." });
    return;
  }

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "submitted",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Sent pre-approval ${existing.title} to ${existing.clientNameSnapshot}.`,
  });

  await deliverNotification(
    notifyUsersByIds([existing.clientId], notificationActor(request), {
      type: "pre_approval_submitted",
      title: "Pre-approval ready for review",
      body: `${existing.title} is waiting for your approval.`,
      link: "/client/pre-approvals",
      metadata: { entityType: "pre-approval", entityId: existing.id },
    }),
  );

  response.json({ preApproval: serializePreApproval(updatedRows[0]!) });
});

router.post("/pre-approvals/:id/comments", requireRole("admin", "client"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = preApprovalCommentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Comment is required." });
    return;
  }

  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = rows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!assertClientCanAccess(request, existing, response)) {
    return;
  }

  const role = request.auth?.user.role;
  if (role !== "admin" && role !== "client") {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const comment = {
    id: createId("pa_comment"),
    authorId: request.auth?.user.id,
    authorName: request.auth?.user.name ?? "User",
    authorRole: role,
    message: parsed.data.message,
    createdAt: nowIso(),
  };

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      comments: [...existing.comments, comment],
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "commented",
    entityType: "pre-approval-comment",
    entityId: comment.id,
    summary: `${comment.authorName} commented on ${existing.title}.`,
  });

  response.status(201).json({ preApproval: serializePreApproval(updatedRows[0]!), comment });
});

router.post("/pre-approvals/:id/approve", requireRole("client"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = rows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!assertClientCanAccess(request, existing, response)) {
    return;
  }

  if (existing.status !== "submitted") {
    response.status(400).json({ message: "Only submitted pre-approvals can be approved." });
    return;
  }

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "approved",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `${existing.clientNameSnapshot} approved pre-approval ${existing.title}.`,
  });

  await deliverNotification(
    notifyAdmins(notificationActor(request), {
      type: "pre_approval_approved",
      title: "Client approved pre-approval",
      body: `${existing.clientNameSnapshot} approved ${existing.title}.`,
      link: "/pre-approvals",
      metadata: { entityType: "pre-approval", entityId: existing.id },
    }),
  );

  response.json({ preApproval: serializePreApproval(updatedRows[0]!) });
});

router.post("/pre-approvals/:id/receive-funds", requireRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = rows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status !== "approved") {
    response.status(400).json({ message: "Only client-approved pre-approvals can be marked as received." });
    return;
  }

  if (existing.receivedAt || existing.receivedFundId) {
    response.status(400).json({ message: "Funds for this pre-approval were already marked as received." });
    return;
  }

  const totalAmount = serializePreApproval(existing).totalAmount;
  if (totalAmount <= 0) {
    response.status(400).json({ message: "This pre-approval does not have a receivable quotation amount." });
    return;
  }

  const now = new Date();
  const fundId = createId("fund");
  const [updatedPreApproval] = await db.transaction(async (transaction) => {
    await transaction.insert(fundsTable).values({
      id: fundId,
      tenantId,
      source: `Pre Approval - ${existing.title}`,
      amount: totalAmount,
      date: now,
      note: `Received from ${existing.clientNameSnapshot} for ${existing.project}.`,
      createdAt: now,
      updatedAt: now,
    } as never);

    return transaction
      .update(preApprovalsTable)
      .set({
        receivedAt: now,
        receivedFundId: fundId,
        updatedAt: now,
      })
      .where(eq(preApprovalsTable.id, existing.id))
      .returning();
  });

  invalidateBusinessStoreCache();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "funds_received",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Marked INR ${totalAmount} received for pre-approval ${existing.title}.`,
  });

  response.json({ preApproval: serializePreApproval(updatedPreApproval!) });
});

router.post("/pre-approvals/:id/request-changes", requireRole("client"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = preApprovalCommentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Please add a comment explaining the requested changes." });
    return;
  }

  const preApprovalId = routeParam(request.params.id);
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, preApprovalId)).limit(1);
  const existing = rows[0];
  if (!existing) {
    respondNotFound(response, "Pre-approval not found");
    return;
  }

  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!assertClientCanAccess(request, existing, response)) {
    return;
  }

  if (existing.status !== "submitted") {
    response.status(400).json({ message: "Only submitted pre-approvals can be returned for changes." });
    return;
  }

  const comment = {
    id: createId("pa_comment"),
    authorId: request.auth!.user.id,
    authorName: request.auth!.user.name ?? existing.clientNameSnapshot,
    authorRole: "client" as const,
    message: parsed.data.message,
    createdAt: nowIso(),
  };

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "changes_requested",
      comments: [...existing.comments, comment],
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertBusinessAudit({
    tenantId,
    ...recordActor(request),
    action: "changes_requested",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `${existing.clientNameSnapshot} requested changes for ${existing.title}.`,
  });

  await deliverNotification(
    notifyAdmins(notificationActor(request), {
      type: "pre_approval_changes_requested",
      title: "Client requested changes",
      body: `${existing.clientNameSnapshot} requested changes on ${existing.title}.`,
      link: "/pre-approvals",
      metadata: { entityType: "pre-approval", entityId: existing.id },
    }),
  );

  response.json({ preApproval: serializePreApproval(updatedRows[0]!) });
});

export default router;
