import { randomUUID } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  auditTrailTable,
  businessStateTable,
  expenseCategoriesTable,
  expensesTable,
  fundsTable,
  projectBudgetsTable,
  projectTasksTable,
  projectsTable,
  purchaseOrdersTable,
  salariesTable,
  timesheetLinesTable,
  timesheetsTable,
  type AuditTrailEntry as DbAuditTrailEntry,
  type Expense as DbExpense,
  type ExpenseCategory as DbExpenseCategory,
  type Fund as DbFund,
  type Project as DbProject,
  type ProjectBudget as DbProjectBudget,
  type ProjectTask as DbProjectTask,
  type ProjectTaskHourLimitScope,
  type PurchaseOrder as DbPurchaseOrder,
  type InsertPurchaseOrder as DbInsertPurchaseOrder,
  type Salary as DbSalary,
  type TimesheetDailyReviewStatus,
  type Timesheet as DbTimesheet,
  type TimesheetLine as DbTimesheetLine,
} from "@workspace/db/schema";
import { DEFAULT_TENANT_ID } from "./tenants";
import { assertWorkflowTransition } from "./workflow-state";

export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimesheetWorkNotes = Partial<Record<DayKey, string>>;
export type ActorRole = "admin" | "employee" | "client" | "platform_super_admin" | "system";
export type LeaveRequestStatus = "pending" | "approved" | "rejected";
export type LeaveRequestKind = "leave" | "holiday";
export type LeavePolicyPeriod = "monthly" | "quarterly" | "yearly";
export type LeavePolicyScope = "all" | "selected";

function normalizeProjectTaskHourLimitScope(value: unknown): ProjectTaskHourLimitScope {
  return value === "per_employee" ? "per_employee" : "overall";
}

export class TaskHourLimitError extends Error {
  code = "task_hour_limit" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskHourLimitError";
  }
}

export class TaskWindowError extends Error {
  code = "task_window" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskWindowError";
  }
}

export interface AuditTrailDetailsRecord {
  entityLabel?: string;
  requestId?: string;
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
}

export interface FundRecord {
  id: string;
  tenantId: string;
  source: string;
  amount: number;
  date: string;
  note: string;
  receiptName?: string;
  receiptPath?: string;
  receiptUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategoryRecord {
  id: string;
  name: string;
  color: string;
  group: "personal" | "office";
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  tenantId: string;
  employeeId?: string;
  employeeNameSnapshot?: string;
  project?: string;
  category: string;
  group: "personal" | "office";
  amount: number;
  date: string;
  description: string;
  note?: string;
  attachmentName?: string;
  attachmentPath?: string;
  reimbursable?: boolean;
  status: ApprovalStatus;
  reviewerNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeNameSnapshot?: string;
  amount: number;
  date: string;
  note: string;
  status: "pending" | "paid";
  source: "manual" | "timesheet";
  paidAt?: string;
  weekStart?: string;
  hours?: number;
  rate?: number;
  timesheetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetTaskLine {
  id: string;
  project: string;
  task: string;
  projectBudgetId?: string;
  projectTaskId?: string;
  subTask?: string;
  notes?: string;
  workNotes?: TimesheetWorkNotes;
  hours: Record<DayKey, number>;
}

export interface TimesheetEntry {
  id: string;
  employeeId: string;
  employeeNameSnapshot: string;
  weekStart: string;
  status: ApprovalStatus;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  dailyReviewStatus?: TimesheetDailyReviewStatus;
  lines: TimesheetTaskLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBudgetTask {
  id: string;
  name: string;
  description?: string;
  maxHours?: number;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  hourLimitScope?: "overall" | "per_employee";
  subTasks?: string[];
  status: "active" | "archived";
}

export interface ProjectBudget {
  id: string;
  tenantId: string;
  project: string;
  status: "active" | "archived";
  totalBudget: number;
  client?: string;
  note?: string;
  tasks: ProjectBudgetTask[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderTask {
  id: string;
  taskName: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
  status: "pending" | "paid";
  paidAt?: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  status: "active" | "archived";
  title: string;
  totalAmount: number;
  usedAmount: number;
  remainingAmount: number;
  vendor?: string;
  date: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  tasks: PurchaseOrderTask[];
}

export interface HolidayRecord {
  id: string;
  tenantId: string;
  date: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeNameSnapshot: string;
  startDate: string;
  endDate: string;
  kind: LeaveRequestKind;
  reason?: string;
  status: LeaveRequestStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeavePolicyRecord {
  annualLimit: number;
  period?: LeavePolicyPeriod;
  appliesTo?: LeavePolicyScope;
  employeeIds?: string[];
  updatedAt: string;
  updatedBy?: string;
}

export interface AuditTrailEntry {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  entityType:
    | "employee"
    | "expense"
    | "fund"
    | "salary"
    | "timesheet"
    | "category"
    | "project-budget"
    | "purchase-order"
    | "purchase-order-task"
    | "pre-approval"
    | "pre-approval-comment";
  entityId: string;
  summary: string;
  requestId?: string;
  details?: AuditTrailDetailsRecord;
  createdAt: string;
}

export interface BusinessStore {
  funds: FundRecord[];
  categories: ExpenseCategoryRecord[];
  expenses: ExpenseRecord[];
  salaries: SalaryRecord[];
  timesheets: TimesheetEntry[];
  projectBudgets: ProjectBudget[];
  purchaseOrders: PurchaseOrder[];
  holidays: HolidayRecord[];
  leaveRequests: LeaveRequestRecord[];
  leavePolicy: LeavePolicyRecord;
  auditTrail: AuditTrailEntry[];
}

type BusinessStateData = Partial<BusinessStore>;

export interface UserProfile {
  id: string;
  tenantId?: string;
  name: string;
  email: string;
  role: "admin" | "employee" | "client" | "platform_super_admin";
  employeeId: string | null;
  position: string | null;
  department: string | null;
  salary: number;
  payType: "monthly" | "hourly";
  hourlyRate: number;
  status: "active" | "inactive";
}

export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DEFAULT_CATEGORIES: ExpenseCategoryRecord[] = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Software", color: "#6366f1", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000002", name: "Office Rent", color: "#f59e0b", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000003", name: "Travel", color: "#10b981", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000004", name: "Marketing", color: "#3b82f6", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000005", name: "Legal", color: "#ef4444", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000006", name: "Equipment", color: "#8b5cf6", group: "office", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000011", name: "Rent", color: "#f97316", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000012", name: "Groceries", color: "#22c55e", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000013", name: "Subscriptions", color: "#a855f7", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000014", name: "Health", color: "#ec4899", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000015", name: "Transport", color: "#14b8a6", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "00000000-0000-0000-0000-000000000016", name: "Entertainment", color: "#f59e0b", group: "personal", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
];

const STATE_ID = "default";
let schemaReady: Promise<void> | null = null;
let storeWriteQueue: Promise<void> = Promise.resolve();
let storeCache: BusinessStore | null = null;
let storeReadPromise: Promise<BusinessStore> | null = null;

export function invalidateBusinessStoreCache() {
  storeCache = null;
  storeReadPromise = null;
}

export function createId(prefix: string): string {
  void prefix;
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

async function withStoreWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const next = storeWriteQueue.then(work, work);
  storeWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

export function normalizeDate(value: string): string {
  if (!value) {
    return nowIso();
  }

  if (value.includes("T")) {
    return new Date(value).toISOString();
  }

  return new Date(`${value}T12:00:00`).toISOString();
}

export function normalizeDateOnly(value?: string | null): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeTaskWindowRange(startDate?: string | null, endDate?: string | null) {
  const normalizedStartDate = normalizeDateOnly(startDate);
  const normalizedEndDate = normalizeDateOnly(endDate);
  if (!normalizedStartDate || !normalizedEndDate) {
    return {
      startDate: undefined,
      endDate: undefined,
    };
  }

  return normalizedEndDate >= normalizedStartDate
    ? { startDate: normalizedStartDate, endDate: normalizedEndDate }
    : { startDate: undefined, endDate: undefined };
}

function weekDateIso(weekStart: string, day: DayKey): string {
  const base = new Date(weekStart);
  const dayIndex = DAY_KEYS.indexOf(day);
  const next = new Date(base);
  next.setUTCDate(base.getUTCDate() + Math.max(0, dayIndex));
  return next.toISOString().slice(0, 10);
}

export function calculateTaskWindowDays(task: { startDate?: string; endDate?: string; durationDays?: number }): number | undefined {
  const startDate = normalizeDateOnly(task.startDate);
  const endDate = normalizeDateOnly(task.endDate);
  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    return diff >= 0 ? diff + 1 : undefined;
  }

  return Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : undefined;
}

export function isDateWithinTaskWindow(
  dateIso: string,
  task: { startDate?: string; endDate?: string },
): boolean {
  const startDate = normalizeDateOnly(task.startDate);
  const endDate = normalizeDateOnly(task.endDate);
  if (!startDate || !endDate) {
    return true;
  }

  return dateIso >= startDate && dateIso <= endDate;
}

export function sumTaskLineHoursWithinWindow(
  weekStart: string,
  lineHours: Record<DayKey, number>,
  task: { startDate?: string; endDate?: string },
): number {
  return DAY_KEYS.reduce((sum, day) => {
    const hours = Number(lineHours[day] ?? 0);
    if (hours <= 0) {
      return sum;
    }

    const dateIso = weekDateIso(weekStart, day);
    return isDateWithinTaskWindow(dateIso, task) ? sum + hours : sum;
  }, 0);
}

export function startOfWeekIso(baseDate = new Date()): string {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

export function normalizeWeekStart(weekStart?: string): string {
  if (!weekStart) {
    return startOfWeekIso();
  }

  return startOfWeekIso(new Date(weekStart));
}

export function monthKey(date: string): string {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function blankHours(): Record<DayKey, number> {
  return { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
}

function normalizeWorkNotes(input?: Partial<Record<DayKey, string>> | null): TimesheetWorkNotes | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    DAY_KEYS.map((day) => [day, String(input[day] ?? "").trim()])
      .filter(([, value]) => value.length > 0),
  ) as TimesheetWorkNotes;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeDailyReviewStatus(input?: Partial<Record<DayKey, string>> | null): TimesheetDailyReviewStatus | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    DAY_KEYS.map((day) => [day, input[day] === "reviewed" ? "reviewed" : ""]).filter(([, value]) => value === "reviewed"),
  ) as TimesheetDailyReviewStatus;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function dayContentSignature(lines: TimesheetTaskLine[], day: DayKey) {
  return JSON.stringify(
    lines
      .map((line) => ({
        hours: Number(line.hours?.[day] ?? 0),
        workNote: line.workNotes?.[day]?.trim() ?? "",
      }))
      .filter((item) => item.hours > 0 || item.workNote.length > 0),
  );
}

export function reconcileDailyReviewStatus(
  currentStatus: Partial<Record<DayKey, string>> | null | undefined,
  previousLines: TimesheetTaskLine[],
  nextLines: TimesheetTaskLine[],
): TimesheetDailyReviewStatus | undefined {
  const nextStatus = { ...(normalizeDailyReviewStatus(currentStatus) ?? {}) };

  for (const day of DAY_KEYS) {
    if (nextStatus[day] !== "reviewed") {
      continue;
    }

    if (dayContentSignature(previousLines, day) !== dayContentSignature(nextLines, day)) {
      delete nextStatus[day];
    }
  }

  return normalizeDailyReviewStatus(nextStatus);
}

export function sumTimesheetHours(entry: TimesheetEntry): number {
  return entry.lines.reduce((total, line) => total + DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0), 0);
}

export function effectiveHourlyRate(employee?: UserProfile | null): number {
  if (!employee) {
    return 0;
  }

  if (employee.payType === "hourly") {
    return Math.max(0, Number(employee.hourlyRate ?? 0));
  }

  return Math.max(0, Number(employee.hourlyRate ?? Math.round(employee.salary / 160)));
}

export function cloneStore(store: BusinessStore): BusinessStore {
  return structuredClone(store);
}

function toDate(value?: string | Date | null): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" && value) {
    return new Date(value);
  }

  return new Date();
}

function toIso(value?: string | Date | null): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value) {
    return normalizeDate(value);
  }

  return nowIso();
}

function calculatePurchaseOrderTaskAmount(hours?: number | null, rate?: number | null, fallbackAmount?: number | null): number {
  const normalizedHours = Math.max(0, Number(hours ?? 0));
  const normalizedRate = Math.max(0, Number(rate ?? 0));
  if (normalizedHours > 0 || normalizedRate > 0) {
    return Math.round(normalizedHours * normalizedRate);
  }

  return Math.abs(Math.round(Number(fallbackAmount ?? 0)));
}

function stripNormalizedStore(store: BusinessStore): BusinessStateData {
  const {
    funds: _funds,
    categories: _categories,
    expenses: _expenses,
    salaries: _salaries,
    timesheets: _timesheets,
    projectBudgets: _projectBudgets,
    purchaseOrders: _purchaseOrders,
    auditTrail: _auditTrail,
    ...rest
  } = store;
  return rest;
}

function fundFromRow(row: DbFund): FundRecord {
  return {
    id: row.id,
    tenantId: String((row as DbFund & { tenantId?: string }).tenantId ?? DEFAULT_TENANT_ID),
    source: row.source.trim(),
    amount: Math.abs(Number(row.amount ?? 0)),
    date: toIso(row.date),
    note: row.note ?? "",
    receiptName: "receiptName" in row && typeof (row as { receiptName?: unknown }).receiptName === "string" ? String((row as { receiptName?: string }).receiptName ?? "").trim() || undefined : undefined,
    receiptPath: "receiptPath" in row && typeof (row as { receiptPath?: unknown }).receiptPath === "string" ? String((row as { receiptPath?: string }).receiptPath ?? "").trim() || undefined : undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function fundToRow(fund: FundRecord) {
  return {
    id: fund.id,
    tenantId: fund.tenantId?.trim() || DEFAULT_TENANT_ID,
    source: fund.source.trim(),
    amount: Math.abs(Number(fund.amount ?? 0)),
    date: toDate(fund.date),
    note: fund.note ?? "",
    receiptName: fund.receiptName?.trim() || null,
    receiptPath: fund.receiptPath?.trim() || null,
    createdAt: toDate(fund.createdAt),
    updatedAt: toDate(fund.updatedAt),
  };
}

function categoryFromRow(row: DbExpenseCategory): ExpenseCategoryRecord {
  return {
    id: row.id,
    name: row.name.trim(),
    color: row.color.trim(),
    group: row.group === "personal" ? "personal" : "office",
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function categoryToRow(category: ExpenseCategoryRecord) {
  return {
    id: category.id,
    name: category.name.trim(),
    color: category.color.trim(),
    group: category.group,
    createdAt: toDate(category.createdAt),
    updatedAt: toDate(category.updatedAt),
  };
}

function expenseFromRow(row: DbExpense): ExpenseRecord {
  const attachmentPath =
    "attachmentPath" in row && typeof row.attachmentPath === "string" ? row.attachmentPath : null;
  const tenantId =
    "tenantId" in row && typeof (row as { tenantId?: unknown }).tenantId === "string"
      ? String((row as { tenantId?: string }).tenantId ?? DEFAULT_TENANT_ID)
      : DEFAULT_TENANT_ID;

  return {
    id: row.id,
    tenantId,
    employeeId: row.employeeId ?? undefined,
    employeeNameSnapshot: row.employeeNameSnapshot?.trim() || undefined,
    project: row.project?.trim() || undefined,
    category: row.category.trim(),
    group: row.group === "personal" ? "personal" : "office",
    amount: Math.abs(Number(row.amount ?? 0)),
    date: toIso(row.date),
    description: row.description.trim(),
    note: row.note?.trim() || undefined,
    attachmentName: row.attachmentName?.trim() || undefined,
    attachmentPath: attachmentPath?.trim() || undefined,
    reimbursable: Boolean(row.reimbursable),
    status:
      row.status === "approved" || row.status === "rejected" || row.status === "draft"
        ? row.status
        : "submitted",
    reviewerNote: row.reviewerNote?.trim() || undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function expenseToRow(expense: ExpenseRecord) {
  return {
    id: expense.id,
    tenantId: expense.tenantId?.trim() || DEFAULT_TENANT_ID,
    employeeId: expense.employeeId ?? null,
    employeeNameSnapshot: expense.employeeNameSnapshot?.trim() || null,
    project: expense.project?.trim() || null,
    category: expense.category.trim(),
    group: expense.group,
    amount: Math.abs(Number(expense.amount ?? 0)),
    date: toDate(expense.date),
    description: expense.description.trim(),
    note: expense.note?.trim() || "",
    attachmentName: expense.attachmentName?.trim() || null,
    attachmentPath: expense.attachmentPath?.trim() || null,
    reimbursable: Boolean(expense.reimbursable),
    status: expense.status,
    reviewerNote: expense.reviewerNote?.trim() || null,
    createdAt: toDate(expense.createdAt),
    updatedAt: toDate(expense.updatedAt),
  };
}

function salaryFromRow(row: DbSalary): SalaryRecord {
  return {
    id: row.id,
    tenantId: String((row as DbSalary & { tenantId?: string }).tenantId ?? DEFAULT_TENANT_ID),
    employeeId: row.employeeId,
    employeeNameSnapshot: row.employeeNameSnapshot?.trim() || undefined,
    amount: Math.abs(Number(row.amount ?? 0)),
    date: toIso(row.date),
    note: row.note ?? "",
    status: row.status === "paid" ? "paid" : "pending",
    source: row.source === "timesheet" ? "timesheet" : "manual",
    paidAt: row.paidAt ? toIso(row.paidAt) : undefined,
    weekStart: row.weekStart ? normalizeWeekStart(toIso(row.weekStart)) : undefined,
    hours: row.hours ?? undefined,
    rate: row.rate ?? undefined,
    timesheetId: row.timesheetId ?? undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function salaryToRow(salary: SalaryRecord) {
  return {
    id: salary.id,
    tenantId: salary.tenantId?.trim() || DEFAULT_TENANT_ID,
    employeeId: salary.employeeId,
    employeeNameSnapshot: salary.employeeNameSnapshot?.trim() || null,
    amount: Math.abs(Number(salary.amount ?? 0)),
    date: toDate(salary.date),
    note: salary.note ?? "",
    status: salary.status,
    source: salary.source,
    paidAt: salary.paidAt ? toDate(salary.paidAt) : null,
    weekStart: salary.weekStart ? toDate(salary.weekStart) : null,
    hours: salary.hours ?? null,
    rate: salary.rate ?? null,
    timesheetId: salary.timesheetId?.trim() || null,
    createdAt: toDate(salary.createdAt),
    updatedAt: toDate(salary.updatedAt),
  };
}

function purchaseOrderFromRow(row: DbPurchaseOrder): PurchaseOrder {
  const rowStatus = (row as DbPurchaseOrder & { status?: string }).status;
  return {
    id: row.id,
    tenantId: String((row as DbPurchaseOrder & { tenantId?: string }).tenantId ?? DEFAULT_TENANT_ID),
    status: rowStatus === "archived" ? "archived" : "active",
    title: row.title.trim(),
    totalAmount: Math.abs(Number(row.totalAmount ?? 0)),
    usedAmount: Math.abs(Number(row.usedAmount ?? 0)),
    remainingAmount: Math.max(0, Number(row.remainingAmount ?? 0)),
    vendor: row.vendor?.trim() || undefined,
    date: toIso(row.date),
    notes: row.notes?.trim() || undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    tasks: Array.isArray(row.tasks)
      ? row.tasks.map((task) => ({
          id: task.id ?? createId("po_task"),
          taskName: String(task.taskName ?? "").trim(),
          description: String(task.description ?? "").trim(),
          hours: Math.max(0, Number(task.hours ?? (Number(task.amount ?? 0) > 0 ? 1 : 0))),
          rate: Math.max(0, Number(task.rate ?? Number(task.amount ?? 0))),
          amount: calculatePurchaseOrderTaskAmount(task.hours, task.rate, Number(task.amount ?? 0)),
          status: task.status === "paid" ? "paid" : "pending",
          paidAt: task.paidAt ? normalizeDate(String(task.paidAt)) : undefined,
        }))
      : [],
  };
}

function purchaseOrderToRow(order: PurchaseOrder): DbInsertPurchaseOrder {
  return {
    id: order.id,
    tenantId: order.tenantId?.trim() || DEFAULT_TENANT_ID,
    status: order.status === "archived" ? "archived" : "active",
    title: order.title.trim(),
    totalAmount: Math.abs(Number(order.totalAmount ?? 0)),
    usedAmount: Math.abs(Number(order.usedAmount ?? 0)),
    remainingAmount: Math.max(0, Number(order.remainingAmount ?? 0)),
    vendor: order.vendor?.trim() || null,
    date: toDate(order.date),
    notes: order.notes?.trim() || "",
    createdAt: toDate(order.createdAt),
    updatedAt: toDate(order.updatedAt),
    tasks: (order.tasks ?? []).map((task) => ({
      id: task.id ?? createId("po_task"),
      taskName: task.taskName.trim(),
      description: task.description.trim(),
      hours: Math.max(0, Number(task.hours ?? 0)),
      rate: Math.max(0, Number(task.rate ?? 0)),
      amount: calculatePurchaseOrderTaskAmount(task.hours, task.rate, task.amount),
      status: task.status === "paid" ? ("paid" as const) : ("pending" as const),
      paidAt: task.paidAt ? normalizeDate(task.paidAt) : undefined,
    })),
  };
}

function normalizeAuditTrailDetails(
  details: unknown,
  requestId?: string | null,
): AuditTrailDetailsRecord | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    const normalizedRequestId = requestId?.trim();
    return normalizedRequestId ? { requestId: normalizedRequestId } : undefined;
  }

  const source = details as Record<string, unknown>;
  const normalized: AuditTrailDetailsRecord = {};
  const normalizedRequestId = requestId?.trim() || (typeof source.requestId === "string" ? source.requestId.trim() : "");

  if (normalizedRequestId) {
    normalized.requestId = normalizedRequestId;
  }

  if (typeof source.entityLabel === "string" && source.entityLabel.trim()) {
    normalized.entityLabel = source.entityLabel.trim();
  }

  if (Array.isArray(source.changedFields)) {
    const changedFields = source.changedFields
      .map((field) => (typeof field === "string" ? field.trim() : ""))
      .filter(Boolean);
    if (changedFields.length > 0) {
      normalized.changedFields = changedFields;
    }
  }

  if ("before" in source) {
    normalized.before =
      source.before && typeof source.before === "object" && !Array.isArray(source.before)
        ? (source.before as Record<string, unknown>)
        : null;
  }

  if ("after" in source) {
    normalized.after =
      source.after && typeof source.after === "object" && !Array.isArray(source.after)
        ? (source.after as Record<string, unknown>)
        : null;
  }

  if ("context" in source) {
    normalized.context =
      source.context && typeof source.context === "object" && !Array.isArray(source.context)
        ? (source.context as Record<string, unknown>)
        : null;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function auditEntryFromRow(row: DbAuditTrailEntry): AuditTrailEntry {
  return {
    id: row.id,
    tenantId: row.tenantId ?? DEFAULT_TENANT_ID,
    actorUserId: row.actorUserId ?? undefined,
    actorName: row.actorName.trim(),
    actorRole:
      row.actorRole === "employee" ||
      row.actorRole === "client" ||
      row.actorRole === "platform_super_admin" ||
      row.actorRole === "system"
        ? row.actorRole
        : "admin",
    action: row.action,
    entityType:
      row.entityType === "employee" ||
      row.entityType === "expense" ||
      row.entityType === "fund" ||
      row.entityType === "salary" ||
      row.entityType === "timesheet" ||
      row.entityType === "category" ||
      row.entityType === "project-budget" ||
      row.entityType === "purchase-order" ||
      row.entityType === "purchase-order-task" ||
      row.entityType === "pre-approval" ||
      row.entityType === "pre-approval-comment"
        ? row.entityType
        : "timesheet",
    entityId: row.entityId,
    summary: row.summary,
    requestId: row.requestId ?? undefined,
    details: normalizeAuditTrailDetails(row.details, row.requestId ?? undefined),
    createdAt: toIso(row.createdAt),
  };
}

function auditEntryToRow(entry: AuditTrailEntry) {
  return {
    id: entry.id,
    tenantId: entry.tenantId?.trim() || DEFAULT_TENANT_ID,
    actorUserId: entry.actorUserId?.trim() || null,
    actorName: entry.actorName.trim(),
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    requestId: entry.requestId?.trim() || null,
    details: normalizeAuditTrailDetails(entry.details, entry.requestId) ?? null,
    createdAt: toDate(entry.createdAt),
  };
}

function projectBudgetFromRow(row: DbProjectBudget): ProjectBudget {
  return {
    id: row.id,
    tenantId: String((row as DbProjectBudget & { tenantId?: string }).tenantId ?? DEFAULT_TENANT_ID),
    status: "active",
    project: row.project,
    totalBudget: Number(row.totalBudget ?? 0),
    client: row.client?.trim() || undefined,
    note: row.note?.trim() || undefined,
    tasks: Array.isArray(row.tasks)
      ? row.tasks
          .filter((task) => task && task.name?.trim())
          .map((task) => {
            const taskWithMaxHours = task as typeof task & { maxHours?: number | null };
            const taskWithStartDate = task as typeof task & { startDate?: string | null };
            const taskWithEndDate = task as typeof task & { endDate?: string | null };
            const taskWithDurationDays = task as typeof task & { durationDays?: number | null };
            const taskWithHourLimitScope = task as typeof task & { hourLimitScope?: unknown };
            const taskWithSubTasks = task as typeof task & { subTasks?: unknown };
            const taskWindow = normalizeTaskWindowRange(taskWithStartDate.startDate, taskWithEndDate.endDate);
            return {
              id: task.id ?? createId("pbt"),
              name: String(task.name ?? "").trim(),
              description: task.description?.trim() || undefined,
              maxHours: Number(taskWithMaxHours.maxHours ?? 0) > 0 ? Number(taskWithMaxHours.maxHours) : undefined,
              startDate: taskWindow.startDate,
              endDate: taskWindow.endDate,
              durationDays: Number(taskWithDurationDays.durationDays ?? 0) > 0 ? Number(taskWithDurationDays.durationDays) : undefined,
              hourLimitScope: normalizeProjectTaskHourLimitScope(taskWithHourLimitScope.hourLimitScope),
              subTasks: Array.isArray(taskWithSubTasks.subTasks)
                ? taskWithSubTasks.subTasks.map((subTask) => String(subTask ?? "").trim()).filter((subTask) => Boolean(subTask))
                : [],
              status: task.status === "archived" ? "archived" : "active",
            };
          })
      : [],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function projectBudgetFromNormalizedRow(
  row: DbProject,
  tasks: DbProjectTask[],
  legacyBudget?: DbProjectBudget | null,
): ProjectBudget {
  const legacyTenantId = String((legacyBudget as DbProjectBudget & { tenantId?: string } | null | undefined)?.tenantId ?? DEFAULT_TENANT_ID);
  return {
    id: row.id,
    tenantId: String((row as DbProject & { tenantId?: string }).tenantId ?? legacyTenantId ?? DEFAULT_TENANT_ID),
    status: row.status === "archived" ? "archived" : "active",
    project: row.name,
    totalBudget: Number(legacyBudget?.totalBudget ?? 0),
    client: row.client?.trim() || legacyBudget?.client?.trim() || undefined,
    note: row.note?.trim() || legacyBudget?.note?.trim() || undefined,
    tasks: tasks
      .filter((task) => task.projectId === row.id)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }

        return left.name.localeCompare(right.name);
      })
      .map((task) => {
        const taskWithMaxHours = task as DbProjectTask & { maxHours?: number | null };
        const taskWithStartDate = task as DbProjectTask & { startDate?: string | null };
        const taskWithEndDate = task as DbProjectTask & { endDate?: string | null };
        const taskWithDurationDays = task as DbProjectTask & { durationDays?: number | null };
        const taskWithHourLimitScope = task as DbProjectTask & { hourLimitScope?: unknown };
        const taskWithSubTasks = task as DbProjectTask & { subTasks?: unknown };
        const taskWindow = normalizeTaskWindowRange(taskWithStartDate.startDate, taskWithEndDate.endDate);
        return {
          id: task.id,
          name: task.name.trim(),
          description: task.description?.trim() || undefined,
          maxHours: Number(taskWithMaxHours.maxHours ?? 0) > 0 ? Number(taskWithMaxHours.maxHours) : undefined,
          startDate: taskWindow.startDate,
          endDate: taskWindow.endDate,
          durationDays: Number(taskWithDurationDays.durationDays ?? 0) > 0 ? Number(taskWithDurationDays.durationDays) : undefined,
          hourLimitScope: normalizeProjectTaskHourLimitScope(taskWithHourLimitScope.hourLimitScope),
          subTasks: Array.isArray(taskWithSubTasks.subTasks)
            ? taskWithSubTasks.subTasks.map((subTask) => String(subTask ?? "").trim()).filter((subTask) => Boolean(subTask))
            : [],
          status: task.status === "archived" ? "archived" : "active",
        };
      }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function timesheetFromRow(row: DbTimesheet): TimesheetEntry {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeNameSnapshot: row.employeeNameSnapshot,
    weekStart: normalizeWeekStart(toIso(row.weekStart)),
    status: row.status ?? "draft",
    submittedAt: row.submittedAt ? toIso(row.submittedAt) : undefined,
    reviewedAt: row.reviewedAt ? toIso(row.reviewedAt) : undefined,
    reviewedBy: row.reviewedBy?.trim() || undefined,
    reviewNotes: row.reviewNotes?.trim() || undefined,
    dailyReviewStatus: normalizeDailyReviewStatus(row.dailyReviewStatus),
    lines: Array.isArray(row.lines) && row.lines.length > 0
      ? row.lines.map((line) => ({
          id: line.id ?? createId("line"),
        project: String(line.project ?? "").trim(),
        task: String(line.task ?? "").trim(),
        projectBudgetId: line.projectBudgetId?.trim() || undefined,
        projectTaskId: line.projectTaskId?.trim() || undefined,
        subTask: line.subTask?.trim() || undefined,
        notes: line.notes?.trim() || undefined,
        workNotes: normalizeWorkNotes(line.workNotes),
        hours: { ...blankHours(), ...(line.hours ?? {}) },
      }))
      : [{ id: createId("line"), project: "", task: "", subTask: "", notes: "", workNotes: {}, hours: blankHours() }],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function timesheetFromNormalizedRow(
  row: DbTimesheet,
  lines: DbTimesheetLine[],
  projectLookup: Map<string, ProjectBudget>,
): TimesheetEntry {
  const projectTaskLookup = new Map<string, ProjectBudgetTask>();
  for (const project of projectLookup.values()) {
    for (const task of project.tasks) {
      projectTaskLookup.set(task.id, task);
    }
  }

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeNameSnapshot: row.employeeNameSnapshot,
    weekStart: normalizeWeekStart(toIso(row.weekStart)),
    status: row.status ?? "draft",
    submittedAt: row.submittedAt ? toIso(row.submittedAt) : undefined,
    reviewedAt: row.reviewedAt ? toIso(row.reviewedAt) : undefined,
    reviewedBy: row.reviewedBy?.trim() || undefined,
    reviewNotes: row.reviewNotes?.trim() || undefined,
    dailyReviewStatus: normalizeDailyReviewStatus(row.dailyReviewStatus),
    lines: lines
      .filter((line) => line.timesheetId === row.id)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }

        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((line) => {
        const project = (line.projectId ? projectLookup.get(line.projectId) : undefined) ?? (line.projectBudgetId ? projectLookup.get(line.projectBudgetId) : undefined);
        const task = line.projectTaskId ? projectTaskLookup.get(line.projectTaskId) : undefined;

        return {
          id: line.id,
          project: project?.project ?? "",
          task: task?.name ?? "",
          projectBudgetId: line.projectId ?? line.projectBudgetId ?? undefined,
          projectTaskId: line.projectTaskId ?? undefined,
          subTask: line.subTask?.trim() || undefined,
          notes: line.notes?.trim() || undefined,
          workNotes: normalizeWorkNotes(line.workNotes),
          hours: {
            mon: Number(line.mon ?? 0),
            tue: Number(line.tue ?? 0),
            wed: Number(line.wed ?? 0),
            thu: Number(line.thu ?? 0),
            fri: Number(line.fri ?? 0),
            sat: Number(line.sat ?? 0),
            sun: Number(line.sun ?? 0),
          },
        };
      }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function projectBudgetToRow(budget: ProjectBudget) {
  const tasks = (budget.tasks ?? []).map((task) => {
    const taskWindow = normalizeTaskWindowRange(task.startDate, task.endDate);
    return {
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
      startDate: taskWindow.startDate,
      endDate: taskWindow.endDate,
      durationDays: Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : undefined,
      hourLimitScope: normalizeProjectTaskHourLimitScope(task.hourLimitScope),
      subTasks: Array.isArray(task.subTasks)
        ? task.subTasks.map((subTask) => String(subTask ?? "").trim()).filter((subTask) => Boolean(subTask))
        : [],
      status: task.status === "archived" ? ("archived" as const) : ("active" as const),
    };
  });

  return {
    id: budget.id,
    tenantId: budget.tenantId?.trim() || DEFAULT_TENANT_ID,
    project: budget.project.trim(),
    totalBudget: Math.abs(Number(budget.totalBudget ?? 0)),
    client: budget.client?.trim() || null,
    note: budget.note?.trim() || "",
    tasks,
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  };
}

function timesheetToRow(entry: TimesheetEntry) {
  return {
    id: entry.id,
    employeeId: entry.employeeId,
    employeeNameSnapshot: entry.employeeNameSnapshot,
    weekStart: toDate(entry.weekStart),
    status: entry.status,
    submittedAt: entry.submittedAt ? toDate(entry.submittedAt) : null,
    reviewedAt: entry.reviewedAt ? toDate(entry.reviewedAt) : null,
    reviewedBy: entry.reviewedBy?.trim() || null,
    reviewNotes: entry.reviewNotes?.trim() || null,
    dailyReviewStatus: normalizeDailyReviewStatus(entry.dailyReviewStatus) ?? {},
    lines: (entry.lines ?? []).map((line) => ({
      id: line.id ?? createId("line"),
      project: line.project?.trim() || "",
      task: line.task?.trim() || "",
      projectBudgetId: line.projectBudgetId?.trim() || undefined,
      projectTaskId: line.projectTaskId?.trim() || undefined,
      subTask: line.subTask?.trim() || undefined,
      notes: line.notes?.trim() || undefined,
      workNotes: normalizeWorkNotes(line.workNotes),
      hours: { ...blankHours(), ...(line.hours ?? {}) },
    })),
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt),
  };
}

function projectBudgetToNormalizedRow(budget: ProjectBudget, createdById: string | null) {
  return {
    id: budget.id,
    tenantId: budget.tenantId?.trim() || DEFAULT_TENANT_ID,
    name: budget.project.trim(),
    client: budget.client?.trim() || null,
    note: budget.note?.trim() || "",
    status: budget.status === "archived" ? ("archived" as const) : ("active" as const),
    createdById,
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  };
}

function projectTasksToRows(budget: ProjectBudget, createdById: string | null) {
  return (budget.tasks ?? []).map((task, index) => {
    const taskWindow = normalizeTaskWindowRange(task.startDate, task.endDate);
    return {
    id: task.id ?? createId("task"),
    tenantId: budget.tenantId?.trim() || DEFAULT_TENANT_ID,
    projectId: budget.id,
    name: task.name.trim(),
    description: task.description?.trim() || "",
    maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : null,
    startDate: taskWindow.startDate ?? null,
    endDate: taskWindow.endDate ?? null,
    durationDays: Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : null,
    hourLimitScope: normalizeProjectTaskHourLimitScope(task.hourLimitScope),
    subTasks: Array.isArray(task.subTasks)
      ? task.subTasks.map((subTask) => String(subTask ?? "").trim()).filter((subTask) => Boolean(subTask))
      : [],
    status: task.status === "archived" ? ("archived" as const) : ("active" as const),
    sortOrder: index,
    createdById,
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  };
  });
}

function timesheetLinesToRows(
  entry: TimesheetEntry,
  validProjectIds?: Set<string>,
  validTaskIds?: Set<string>,
) {
  return (entry.lines ?? []).map((line, index) => {
    const projectId = line.projectBudgetId?.trim() || null;
    const taskId = line.projectTaskId?.trim() || null;

    return {
      id: line.id ?? createId("line"),
      timesheetId: entry.id,
      projectBudgetId: null,
      projectId:
        projectId && (!validProjectIds || validProjectIds.has(projectId))
          ? projectId
          : null,
      projectTaskId:
        taskId && (!validTaskIds || validTaskIds.has(taskId))
          ? taskId
          : null,
      subTask: line.subTask?.trim() || null,
      sortOrder: index,
      notes: line.notes?.trim() || "",
      workNotes: normalizeWorkNotes(line.workNotes) ?? {},
      mon: Number(line.hours.mon ?? 0),
      tue: Number(line.hours.tue ?? 0),
      wed: Number(line.hours.wed ?? 0),
      thu: Number(line.hours.thu ?? 0),
      fri: Number(line.hours.fri ?? 0),
      sat: Number(line.hours.sat ?? 0),
      sun: Number(line.hours.sun ?? 0),
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt),
    };
  });
}

async function ensureNormalizedBusinessMigration(store: BusinessStore) {
  const [fundRows, categoryRows, expenseRows, salaryRows, projectRows, projectTaskRows, timesheetRows, timesheetLineRows, purchaseOrderRows, auditRows] = await Promise.all([
    db.select({ id: fundsTable.id }).from(fundsTable).limit(1),
    db.select({ id: expenseCategoriesTable.id }).from(expenseCategoriesTable).limit(1),
    db.select({ id: expensesTable.id }).from(expensesTable).limit(1),
    db.select({ id: salariesTable.id }).from(salariesTable).limit(1),
    db.select({ id: projectsTable.id }).from(projectsTable).limit(1),
    db.select({ id: projectTasksTable.id }).from(projectTasksTable).limit(1),
    db.select({ id: timesheetsTable.id }).from(timesheetsTable).limit(1),
    db.select({ id: timesheetLinesTable.id }).from(timesheetLinesTable).limit(1),
    db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).limit(1),
    db.select({ id: auditTrailTable.id }).from(auditTrailTable).limit(1),
  ]);

  const needsFunds = fundRows.length === 0 && store.funds.length > 0;
  const needsCategories = categoryRows.length === 0 && store.categories.length > 0;
  const needsExpenses = expenseRows.length === 0 && store.expenses.length > 0;
  const needsSalaries = salaryRows.length === 0 && store.salaries.length > 0;
  const needsProjectBudgets = projectRows.length === 0 && store.projectBudgets.length > 0;
  const needsProjectTasks = projectTaskRows.length === 0 && store.projectBudgets.some((budget) => budget.tasks.length > 0);
  const needsTimesheets = timesheetRows.length === 0 && store.timesheets.length > 0;
  const needsTimesheetLines = timesheetLineRows.length === 0 && store.timesheets.some((entry) => entry.lines.length > 0);
  const needsPurchaseOrders = purchaseOrderRows.length === 0 && store.purchaseOrders.length > 0;
  const needsAuditTrail = auditRows.length === 0 && store.auditTrail.length > 0;
  if (
    !needsFunds &&
    !needsCategories &&
    !needsExpenses &&
    !needsSalaries &&
    !needsProjectBudgets &&
    !needsProjectTasks &&
    !needsTimesheets &&
    !needsTimesheetLines &&
    !needsPurchaseOrders &&
    !needsAuditTrail
  ) {
    return;
  }

  const defaultActorId = null;
  const projectTasks = store.projectBudgets.flatMap((budget) => projectTasksToRows(budget, defaultActorId));
  const validProjectIds = new Set(store.projectBudgets.map((budget) => budget.id));
  const validTaskIds = new Set(projectTasks.map((task) => task.id));
  const timesheetLines = store.timesheets.flatMap((entry) => timesheetLinesToRows(entry, validProjectIds, validTaskIds));

  await db.transaction(async (tx) => {
    if (needsFunds) {
      await tx.insert(fundsTable).values(store.funds.map(fundToRow));
    }

    if (needsCategories) {
      await tx.insert(expenseCategoriesTable).values(store.categories.map(categoryToRow));
    }

    if (needsExpenses) {
      await tx.insert(expensesTable).values(store.expenses.map(expenseToRow));
    }

    if (needsSalaries) {
      await tx.insert(salariesTable).values(store.salaries.map(salaryToRow));
    }

    if (needsProjectBudgets) {
      await tx.insert(projectsTable).values(store.projectBudgets.map((budget) => projectBudgetToNormalizedRow(budget, defaultActorId)));
    }

    if ((needsProjectBudgets || needsProjectTasks) && projectTasks.length > 0) {
      await tx.insert(projectTasksTable).values(projectTasks);
    }

    if (needsTimesheets) {
      await tx.insert(timesheetsTable).values(store.timesheets.map(timesheetToRow));
    }

    if (needsTimesheetLines && timesheetLines.length > 0) {
      await tx.insert(timesheetLinesTable).values(timesheetLines);
    }

    if (needsPurchaseOrders) {
      await tx.insert(purchaseOrdersTable).values(store.purchaseOrders.map(purchaseOrderToRow));
    }

    if (needsAuditTrail) {
      await tx.insert(auditTrailTable).values(store.auditTrail.map(auditEntryToRow));
    }
  });
}

export function createDefaultStore(): BusinessStore {
  return {
    funds: [],
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    expenses: [],
    salaries: [],
    timesheets: [],
    projectBudgets: [],
    purchaseOrders: [],
    holidays: [],
    leaveRequests: [],
    leavePolicy: {
      annualLimit: 10,
      period: "yearly",
      appliesTo: "all",
      employeeIds: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
    auditTrail: [],
  };
}

export function normalizeStore(input?: Partial<BusinessStore> | null): BusinessStore {
  const defaults = createDefaultStore();
  if (!input) {
    return defaults;
  }

  return {
    funds: Array.isArray(input.funds) ? input.funds.map((fund) => ({
      id: fund.id ?? createId("fund"),
      tenantId: String((fund as FundRecord).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      source: String(fund.source ?? "").trim(),
      amount: Math.abs(Number(fund.amount ?? 0)),
      date: normalizeDate(String(fund.date ?? nowIso())),
      note: String(fund.note ?? ""),
      receiptName: String((fund as FundRecord).receiptName ?? "").trim() || undefined,
      receiptPath: String((fund as FundRecord).receiptPath ?? "").trim() || undefined,
      createdAt: normalizeDate(String(fund.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(fund.updatedAt ?? fund.createdAt ?? nowIso())),
    })) : [],
    categories: Array.isArray(input.categories) && input.categories.length > 0 ? input.categories.map((category) => ({
      id: category.id ?? createId("cat"),
      name: String(category.name ?? "").trim(),
      color: String(category.color ?? "#64748b"),
      group: category.group === "personal" ? "personal" : "office",
      createdAt: normalizeDate(String(category.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(category.updatedAt ?? category.createdAt ?? nowIso())),
    })) : defaults.categories,
    expenses: Array.isArray(input.expenses) ? input.expenses.map((expense) => ({
      id: expense.id ?? createId("exp"),
      tenantId: String((expense as ExpenseRecord).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      employeeId: expense.employeeId?.trim() || undefined,
      employeeNameSnapshot: expense.employeeNameSnapshot?.trim() || undefined,
      project: expense.project?.trim() || undefined,
      category: String(expense.category ?? "").trim(),
      group: expense.group === "personal" ? "personal" : "office",
      amount: Math.abs(Number(expense.amount ?? 0)),
      date: normalizeDate(String(expense.date ?? nowIso())),
      description: String(expense.description ?? "").trim(),
      note: expense.note?.trim() || undefined,
      attachmentName: expense.attachmentName?.trim() || undefined,
      attachmentPath: expense.attachmentPath?.trim() || undefined,
      reimbursable: expense.reimbursable ?? expense.group === "office",
      status: expense.status ?? "submitted",
      reviewerNote: expense.reviewerNote?.trim() || undefined,
      createdAt: normalizeDate(String(expense.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(expense.updatedAt ?? expense.createdAt ?? nowIso())),
    })) : [],
    salaries: Array.isArray(input.salaries) ? input.salaries.map((salary) => ({
      id: salary.id ?? createId("sal"),
      tenantId: String((salary as SalaryRecord).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      employeeId: String(salary.employeeId ?? "").trim(),
      employeeNameSnapshot: salary.employeeNameSnapshot?.trim() || undefined,
      amount: Math.abs(Number(salary.amount ?? 0)),
      date: normalizeDate(String(salary.date ?? nowIso())),
      note: String(salary.note ?? ""),
      status: salary.status === "paid" ? "paid" : "pending",
      source: salary.source === "timesheet" ? "timesheet" : "manual",
      paidAt: salary.paidAt ? normalizeDate(String(salary.paidAt)) : undefined,
      weekStart: salary.weekStart ? normalizeWeekStart(String(salary.weekStart)) : undefined,
      hours: salary.hours ?? undefined,
      rate: salary.rate ?? undefined,
      timesheetId: salary.timesheetId?.trim() || undefined,
      createdAt: normalizeDate(String(salary.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(salary.updatedAt ?? salary.createdAt ?? nowIso())),
    })) : [],
    timesheets: Array.isArray(input.timesheets) ? input.timesheets.map((entry) => ({
      id: entry.id ?? createId("ts"),
      employeeId: String(entry.employeeId ?? "").trim(),
      employeeNameSnapshot: String(entry.employeeNameSnapshot ?? "").trim(),
      weekStart: normalizeWeekStart(String(entry.weekStart ?? nowIso())),
      status: entry.status ?? "draft",
      submittedAt: entry.submittedAt ? normalizeDate(String(entry.submittedAt)) : undefined,
      reviewedAt: entry.reviewedAt ? normalizeDate(String(entry.reviewedAt)) : undefined,
      reviewedBy: entry.reviewedBy?.trim() || undefined,
      reviewNotes: entry.reviewNotes?.trim() || undefined,
      dailyReviewStatus: normalizeDailyReviewStatus(entry.dailyReviewStatus),
      lines: Array.isArray(entry.lines) && entry.lines.length > 0 ? entry.lines.map((line) => ({
        id: line.id ?? createId("line"),
        project: String(line.project ?? "").trim(),
        task: String(line.task ?? "").trim(),
        projectBudgetId: line.projectBudgetId?.trim() || undefined,
        projectTaskId: line.projectTaskId?.trim() || undefined,
        subTask: line.subTask?.trim() || undefined,
        notes: line.notes?.trim() || undefined,
        workNotes: normalizeWorkNotes(line.workNotes),
        hours: { ...blankHours(), ...(line.hours ?? {}) },
      })) : [
        { id: createId("line"), project: "", task: "", subTask: "", notes: "", workNotes: {}, hours: blankHours() },
      ],
      createdAt: normalizeDate(String(entry.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(entry.updatedAt ?? entry.createdAt ?? nowIso())),
    })) : [],
    projectBudgets: Array.isArray(input.projectBudgets) ? input.projectBudgets.map((budget) => ({
      id: budget.id ?? createId("pb"),
      tenantId: String((budget as ProjectBudget).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      status: (budget as ProjectBudget).status === "archived" ? "archived" : "active",
      project: String(budget.project ?? "").trim(),
      totalBudget: Math.abs(Number(budget.totalBudget ?? 0)),
      client: budget.client?.trim() || undefined,
      note: budget.note?.trim() || undefined,
      tasks: Array.isArray(budget.tasks) ? budget.tasks.filter((task) => task.name?.trim()).map((task) => {
        const taskWindow = normalizeTaskWindowRange(task.startDate, task.endDate);
        return {
          id: task.id ?? createId("pbt"),
          name: String(task.name ?? "").trim(),
          description: task.description?.trim() || undefined,
          maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
          startDate: taskWindow.startDate,
          endDate: taskWindow.endDate,
          durationDays: Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : undefined,
          hourLimitScope: normalizeProjectTaskHourLimitScope(task.hourLimitScope),
          subTasks: Array.isArray(task.subTasks)
            ? task.subTasks.map((subTask) => String(subTask ?? "").trim()).filter((subTask) => Boolean(subTask))
            : [],
          status: task.status === "archived" ? "archived" : "active",
        };
      }) : [],
      createdAt: normalizeDate(String(budget.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(budget.updatedAt ?? budget.createdAt ?? nowIso())),
    })) : [],
    purchaseOrders: Array.isArray(input.purchaseOrders) ? input.purchaseOrders.map((order) => ({
      id: order.id ?? createId("po"),
      tenantId: String((order as PurchaseOrder).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      status: (order as PurchaseOrder).status === "archived" ? "archived" : "active",
      title: String(order.title ?? "").trim(),
      totalAmount: Math.abs(Number(order.totalAmount ?? 0)),
      usedAmount: Math.abs(Number(order.usedAmount ?? 0)),
      remainingAmount: Math.max(0, Number(order.remainingAmount ?? 0)),
      vendor: order.vendor?.trim() || undefined,
      date: normalizeDate(String(order.date ?? nowIso())),
      notes: order.notes?.trim() || undefined,
      createdAt: normalizeDate(String(order.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(order.updatedAt ?? order.createdAt ?? nowIso())),
      tasks: Array.isArray(order.tasks) ? order.tasks.map((task) => ({
        id: task.id ?? createId("po_task"),
        taskName: String(task.taskName ?? "").trim(),
        description: String(task.description ?? "").trim(),
        hours: Math.max(0, Number(task.hours ?? (Number(task.amount ?? 0) > 0 ? 1 : 0))),
        rate: Math.max(0, Number(task.rate ?? Number(task.amount ?? 0))),
        amount: calculatePurchaseOrderTaskAmount(task.hours, task.rate, Number(task.amount ?? 0)),
        status: task.status === "paid" ? "paid" : "pending",
        paidAt: task.paidAt ? normalizeDate(String(task.paidAt)) : undefined,
      })) : [],
    })) : [],
    holidays: Array.isArray(input.holidays) ? input.holidays.map((holiday) => ({
      id: holiday.id ?? createId("hol"),
      tenantId: String((holiday as HolidayRecord).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      date: normalizeDate(String(holiday.date ?? nowIso())),
      name: String(holiday.name ?? "").trim() || "Holiday",
      createdAt: normalizeDate(String(holiday.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(holiday.updatedAt ?? holiday.createdAt ?? nowIso())),
    })) : [],
    leaveRequests: Array.isArray(input.leaveRequests) ? input.leaveRequests.map((request) => ({
      id: request.id ?? createId("leave"),
      tenantId: String((request as LeaveRequestRecord).tenantId ?? DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID,
      employeeId: String(request.employeeId ?? "").trim(),
      employeeNameSnapshot: String(request.employeeNameSnapshot ?? "").trim(),
      startDate: normalizeDate(String(request.startDate ?? nowIso())),
      endDate: normalizeDate(String(request.endDate ?? request.startDate ?? nowIso())),
      kind: request.kind === "holiday" ? "holiday" : "leave",
      reason: request.reason?.trim() || undefined,
      status: request.status === "approved" || request.status === "rejected" ? request.status : "pending",
      reviewedAt: request.reviewedAt ? normalizeDate(String(request.reviewedAt)) : undefined,
      reviewedBy: request.reviewedBy?.trim() || undefined,
      reviewNote: request.reviewNote?.trim() || undefined,
      createdAt: normalizeDate(String(request.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(request.updatedAt ?? request.createdAt ?? nowIso())),
    })) : [],
    leavePolicy: {
      annualLimit: Math.max(0, Math.round(Number(input.leavePolicy?.annualLimit ?? defaults.leavePolicy.annualLimit))),
      period:
        input.leavePolicy?.period === "monthly" || input.leavePolicy?.period === "quarterly" || input.leavePolicy?.period === "yearly"
          ? input.leavePolicy.period
          : (defaults.leavePolicy.period ?? "yearly"),
      appliesTo: input.leavePolicy?.appliesTo === "selected" ? "selected" : "all",
      employeeIds:
        input.leavePolicy?.appliesTo === "selected"
          ? Array.from(
              new Set(
                Array.isArray(input.leavePolicy.employeeIds)
                  ? input.leavePolicy.employeeIds.map((employeeId) => employeeId?.trim()).filter((employeeId): employeeId is string => Boolean(employeeId))
                  : [],
              ),
            )
          : [],
      updatedAt: normalizeDate(String(input.leavePolicy?.updatedAt ?? defaults.leavePolicy.updatedAt ?? nowIso())),
      updatedBy: input.leavePolicy?.updatedBy?.trim() || undefined,
    },
    auditTrail: Array.isArray(input.auditTrail) ? input.auditTrail.map((entry) => ({
      id: entry.id ?? createId("audit"),
      tenantId: entry.tenantId?.trim() || DEFAULT_TENANT_ID,
      actorUserId: entry.actorUserId?.trim() || undefined,
      actorName: String(entry.actorName ?? "System").trim(),
      actorRole:
        entry.actorRole === "employee" ||
        entry.actorRole === "client" ||
        entry.actorRole === "platform_super_admin" ||
        entry.actorRole === "system"
          ? entry.actorRole
          : "admin",
      action: String(entry.action ?? "updated"),
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? "").trim(),
      summary: String(entry.summary ?? ""),
      requestId: entry.requestId?.trim() || undefined,
      details: normalizeAuditTrailDetails(entry.details, entry.requestId),
      createdAt: normalizeDate(String(entry.createdAt ?? nowIso())),
    })) : [],
  };
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      let existing;
      try {
        existing = await db
          .select({ id: businessStateTable.id })
          .from(businessStateTable)
          .where(eq(businessStateTable.id, STATE_ID))
          .limit(1);
      } catch (error) {
        throw new Error(
          "Database schema is missing. Run `corepack pnpm --filter @workspace/db run migrate` before starting the API server.",
          { cause: error instanceof Error ? error : undefined },
        );
      }

      if (existing.length === 0) {
        await db.insert(businessStateTable).values({
          id: STATE_ID,
          data: stripNormalizedStore(createDefaultStore()) as Record<string, unknown>,
        });
      }
    })();
  }

  return schemaReady;
}

function cacheStore(store: BusinessStore) {
  storeCache = cloneStore(store);
}

function sameSlice<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadStoreFromDatabase(): Promise<BusinessStore> {
  await ensureSchema();
  const stateRows = await db
    .select({ data: businessStateTable.data })
    .from(businessStateTable)
    .where(eq(businessStateTable.id, STATE_ID))
    .limit(1);

  const legacyStore = normalizeStore(stateRows[0]?.data ?? createDefaultStore());

  let [
    fundRows,
    categoryRows,
    expenseRows,
    salaryRows,
    projectBudgetRows,
    projectRows,
    projectTaskRows,
    timesheetRows,
    timesheetLineRows,
    purchaseOrderRows,
    auditRows,
  ] = await Promise.all([
    db.select().from(fundsTable).orderBy(desc(fundsTable.date), desc(fundsTable.createdAt)),
    db.select().from(expenseCategoriesTable).orderBy(asc(expenseCategoriesTable.group), asc(expenseCategoriesTable.name)),
    db.select().from(expensesTable).orderBy(desc(expensesTable.date), desc(expensesTable.createdAt)),
    db.select().from(salariesTable).orderBy(desc(salariesTable.paidAt), desc(salariesTable.date), desc(salariesTable.createdAt)),
    db.select().from(projectBudgetsTable).orderBy(asc(projectBudgetsTable.project)),
    db.select().from(projectsTable).orderBy(asc(projectsTable.name)),
    db.select().from(projectTasksTable).orderBy(asc(projectTasksTable.projectId), asc(projectTasksTable.sortOrder)),
    db.select().from(timesheetsTable).orderBy(desc(timesheetsTable.weekStart), desc(timesheetsTable.updatedAt)),
    db.select().from(timesheetLinesTable).orderBy(asc(timesheetLinesTable.timesheetId), asc(timesheetLinesTable.sortOrder)),
    db.select().from(purchaseOrdersTable).orderBy(desc(purchaseOrdersTable.date), desc(purchaseOrdersTable.createdAt)),
    db.select().from(auditTrailTable).orderBy(desc(auditTrailTable.createdAt)),
  ]);

  const effectiveFunds = fundRows.length > 0 ? fundRows.map(fundFromRow) : legacyStore.funds;
  const effectiveCategories = categoryRows.length > 0 ? categoryRows.map(categoryFromRow) : legacyStore.categories;
  const effectiveExpenses = expenseRows.length > 0 ? expenseRows.map(expenseFromRow) : legacyStore.expenses;
  const effectiveSalaries = salaryRows.length > 0 ? salaryRows.map(salaryFromRow) : legacyStore.salaries;
  const effectiveProjectBudgets =
    projectBudgetRows.length > 0 ? projectBudgetRows.map(projectBudgetFromRow) : legacyStore.projectBudgets;
  const effectiveTimesheets = timesheetRows.length > 0 ? timesheetRows.map(timesheetFromRow) : legacyStore.timesheets;
  const effectivePurchaseOrders = purchaseOrderRows.length > 0 ? purchaseOrderRows.map(purchaseOrderFromRow) : legacyStore.purchaseOrders;
  const effectiveAuditTrail = auditRows.length > 0 ? auditRows.map(auditEntryFromRow) : legacyStore.auditTrail;

  const needsFunds = fundRows.length === 0 && effectiveFunds.length > 0;
  const needsCategories = categoryRows.length === 0 && effectiveCategories.length > 0;
  const needsExpenses = expenseRows.length === 0 && effectiveExpenses.length > 0;
  const needsSalaries = salaryRows.length === 0 && effectiveSalaries.length > 0;
  const needsProjects = projectRows.length === 0 && effectiveProjectBudgets.length > 0;
  const needsProjectTasks = projectTaskRows.length === 0 && effectiveProjectBudgets.some((project) => project.tasks.length > 0);
  const needsTimesheets = timesheetRows.length === 0 && effectiveTimesheets.length > 0;
  const needsTimesheetLines = timesheetLineRows.length === 0 && effectiveTimesheets.some((entry) => entry.lines.length > 0);
  const needsPurchaseOrders = purchaseOrderRows.length === 0 && effectivePurchaseOrders.length > 0;
  const needsAuditTrail = auditRows.length === 0 && effectiveAuditTrail.length > 0;

  if (
    needsFunds ||
    needsCategories ||
    needsExpenses ||
    needsSalaries ||
    needsProjects ||
    needsProjectTasks ||
    needsTimesheets ||
    needsTimesheetLines ||
    needsPurchaseOrders ||
    needsAuditTrail
  ) {
    await ensureNormalizedBusinessMigration({
      ...legacyStore,
      funds: effectiveFunds,
      categories: effectiveCategories,
      expenses: effectiveExpenses,
      salaries: effectiveSalaries,
      projectBudgets: effectiveProjectBudgets,
      timesheets: effectiveTimesheets,
      purchaseOrders: effectivePurchaseOrders,
      auditTrail: effectiveAuditTrail,
    });

    [
      fundRows,
      categoryRows,
      expenseRows,
      salaryRows,
      projectBudgetRows,
      projectRows,
      projectTaskRows,
      timesheetRows,
      timesheetLineRows,
      purchaseOrderRows,
      auditRows,
    ] = await Promise.all([
      db.select().from(fundsTable).orderBy(desc(fundsTable.date), desc(fundsTable.createdAt)),
      db.select().from(expenseCategoriesTable).orderBy(asc(expenseCategoriesTable.group), asc(expenseCategoriesTable.name)),
      db.select().from(expensesTable).orderBy(desc(expensesTable.date), desc(expensesTable.createdAt)),
      db.select().from(salariesTable).orderBy(desc(salariesTable.paidAt), desc(salariesTable.date), desc(salariesTable.createdAt)),
      db.select().from(projectBudgetsTable).orderBy(asc(projectBudgetsTable.project)),
      db.select().from(projectsTable).orderBy(asc(projectsTable.name)),
      db.select().from(projectTasksTable).orderBy(asc(projectTasksTable.projectId), asc(projectTasksTable.sortOrder)),
      db.select().from(timesheetsTable).orderBy(desc(timesheetsTable.weekStart), desc(timesheetsTable.updatedAt)),
      db.select().from(timesheetLinesTable).orderBy(asc(timesheetLinesTable.timesheetId), asc(timesheetLinesTable.sortOrder)),
      db.select().from(purchaseOrdersTable).orderBy(desc(purchaseOrdersTable.date), desc(purchaseOrdersTable.createdAt)),
      db.select().from(auditTrailTable).orderBy(desc(auditTrailTable.createdAt)),
    ]);
  }

  const fallbackBudgetMap = new Map(projectBudgetRows.map((row) => [row.id, row]));
  const fallbackBudgetByNameMap = new Map(projectBudgetRows.map((row) => [row.project.trim().toLowerCase(), row]));
  const normalizedProjects =
    projectRows.length > 0
      ? projectRows.map((row) =>
          projectBudgetFromNormalizedRow(
            row,
            projectTaskRows,
            fallbackBudgetMap.get(row.id) ?? fallbackBudgetByNameMap.get(row.name.trim().toLowerCase()) ?? null,
          ),
        )
      : projectBudgetRows.map(projectBudgetFromRow);

  const projectLookup = new Map(normalizedProjects.map((project) => [project.id, project]));
  const normalizedTimesheets = timesheetRows.map((row) =>
    timesheetLineRows.some((line) => line.timesheetId === row.id)
      ? timesheetFromNormalizedRow(row, timesheetLineRows, projectLookup)
      : timesheetFromRow(row),
  );

  const store = normalizeStore({
    ...legacyStore,
    funds: fundRows.map(fundFromRow),
    categories: categoryRows.map(categoryFromRow),
    expenses: expenseRows.map(expenseFromRow),
    salaries: salaryRows.map(salaryFromRow),
    projectBudgets: normalizedProjects,
    timesheets: normalizedTimesheets,
    purchaseOrders: purchaseOrderRows.map(purchaseOrderFromRow),
    holidays: legacyStore.holidays,
    leaveRequests: legacyStore.leaveRequests,
    auditTrail: auditRows.map(auditEntryFromRow),
  });

  cacheStore(store);
  return store;
}

export async function readStore(options?: { fresh?: boolean }): Promise<BusinessStore> {
  if (!options?.fresh && storeCache) {
    return cloneStore(storeCache);
  }

  if (!options?.fresh) {
    if (!storeReadPromise) {
      storeReadPromise = loadStoreFromDatabase().finally(() => {
        storeReadPromise = null;
      });
    }

    return cloneStore(await storeReadPromise);
  }

  return cloneStore(await loadStoreFromDatabase());
}

async function persistStoreUnsafe(previousStore: BusinessStore | null, store: BusinessStore): Promise<void> {
  const funds = store.funds.map(fundToRow);
  const categories = store.categories.map(categoryToRow);
  const expenses = store.expenses.map(expenseToRow);
  const salaries = store.salaries.map(salaryToRow);
  const projectBudgets = store.projectBudgets.map(projectBudgetToRow);
  const projects = store.projectBudgets.map((budget) => projectBudgetToNormalizedRow(budget, null));
  const projectTasks = store.projectBudgets.flatMap((budget) => projectTasksToRows(budget, null));
  const validProjectIds = new Set(store.projectBudgets.map((budget) => budget.id));
  const validTaskIds = new Set(projectTasks.map((task) => task.id));
  const timesheets = store.timesheets.map(timesheetToRow);
  const timesheetLines = store.timesheets.flatMap((entry) => timesheetLinesToRows(entry, validProjectIds, validTaskIds));
  const purchaseOrders = store.purchaseOrders.map(purchaseOrderToRow);
  const auditTrail = store.auditTrail.map(auditEntryToRow);
  const fundsChanged = !previousStore || !sameSlice(previousStore.funds, store.funds);
  const categoriesChanged = !previousStore || !sameSlice(previousStore.categories, store.categories);
  const expensesChanged = !previousStore || !sameSlice(previousStore.expenses, store.expenses);
  const salariesChanged = !previousStore || !sameSlice(previousStore.salaries, store.salaries);
  const projectsChanged = !previousStore || !sameSlice(previousStore.projectBudgets, store.projectBudgets);
  const timesheetsChanged = !previousStore || !sameSlice(previousStore.timesheets, store.timesheets);
  const purchaseOrdersChanged = !previousStore || !sameSlice(previousStore.purchaseOrders, store.purchaseOrders);
  const auditTrailChanged = !previousStore || !sameSlice(previousStore.auditTrail, store.auditTrail);
  const businessStateChanged = !previousStore || !sameSlice(stripNormalizedStore(previousStore), stripNormalizedStore(store));

  await db.transaction(async (tx) => {
    if (auditTrailChanged) {
      const previousIds = new Set(previousStore?.auditTrail.map((entry) => entry.id) ?? []);
      const nextIds = new Set(store.auditTrail.map((entry) => entry.id));
      const removedIds = [...previousIds].filter((id) => !nextIds.has(id));
      const newEntries = store.auditTrail.filter((entry) => !previousIds.has(entry.id)).map(auditEntryToRow);

      if (removedIds.length > 0) {
        await tx.delete(auditTrailTable).where(inArray(auditTrailTable.id, removedIds));
      }

      if (newEntries.length > 0) {
        await tx.insert(auditTrailTable).values(newEntries);
      }
    }

    if (purchaseOrdersChanged) {
      const previousOrders = new Map(previousStore?.purchaseOrders.map((order) => [order.id, order]) ?? []);
      const nextOrders = new Map(store.purchaseOrders.map((order) => [order.id, order]));
      const removedIds = [...previousOrders.keys()].filter((id) => !nextOrders.has(id));
      const changedIds = store.purchaseOrders
        .filter((order) => !previousOrders.has(order.id) || !sameSlice(previousOrders.get(order.id), order))
        .map((order) => order.id);

      if (removedIds.length > 0) {
        await tx.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, removedIds));
      }

      for (const order of purchaseOrders.filter((row) => changedIds.includes(row.id))) {
        const { id: _orderId, createdAt: _orderCreatedAt, ...updateValues } = order;
        if (previousOrders.has(order.id)) {
          await tx.update(purchaseOrdersTable).set(updateValues).where(eq(purchaseOrdersTable.id, order.id));
        } else {
          await tx.insert(purchaseOrdersTable).values(order);
        }
      }
    }

    if (timesheetsChanged) {
      await tx.delete(timesheetLinesTable);
      await tx.delete(timesheetsTable);
      if (timesheets.length > 0) {
        await tx.insert(timesheetsTable).values(timesheets);
      }
      if (timesheetLines.length > 0) {
        await tx.insert(timesheetLinesTable).values(timesheetLines);
      }
    }

    if (salariesChanged) {
      const previousSalaries = new Map(previousStore?.salaries.map((salary) => [salary.id, salary]) ?? []);
      const nextSalaries = new Map(store.salaries.map((salary) => [salary.id, salary]));
      const removedIds = [...previousSalaries.keys()].filter((id) => !nextSalaries.has(id));
      const changedIds = store.salaries
        .filter((salary) => !previousSalaries.has(salary.id) || !sameSlice(previousSalaries.get(salary.id), salary))
        .map((salary) => salary.id);

      if (removedIds.length > 0) {
        await tx.delete(salariesTable).where(inArray(salariesTable.id, removedIds));
      }

      for (const salary of salaries.filter((row) => changedIds.includes(row.id))) {
        const { id: _salaryId, createdAt: _salaryCreatedAt, ...updateValues } = salary;
        if (previousSalaries.has(salary.id)) {
          await tx.update(salariesTable).set(updateValues).where(eq(salariesTable.id, salary.id));
        } else {
          await tx.insert(salariesTable).values(salary);
        }
      }
    }

    if (expensesChanged) {
      const previousExpenses = new Map(previousStore?.expenses.map((expense) => [expense.id, expense]) ?? []);
      const nextExpenses = new Map(store.expenses.map((expense) => [expense.id, expense]));
      const removedIds = [...previousExpenses.keys()].filter((id) => !nextExpenses.has(id));
      const changedIds = store.expenses
        .filter((expense) => !previousExpenses.has(expense.id) || !sameSlice(previousExpenses.get(expense.id), expense))
        .map((expense) => expense.id);

      if (removedIds.length > 0) {
        await tx.delete(expensesTable).where(inArray(expensesTable.id, removedIds));
      }

      for (const expense of expenses.filter((row) => changedIds.includes(row.id))) {
        const { id: _expenseId, createdAt: _expenseCreatedAt, ...updateValues } = expense;
        if (previousExpenses.has(expense.id)) {
          await tx.update(expensesTable).set(updateValues).where(eq(expensesTable.id, expense.id));
        } else {
          await tx.insert(expensesTable).values(expense);
        }
      }
    }

    if (categoriesChanged) {
      const previousCategories = new Map(previousStore?.categories.map((category) => [category.id, category]) ?? []);
      const nextCategories = new Map(store.categories.map((category) => [category.id, category]));
      const removedIds = [...previousCategories.keys()].filter((id) => !nextCategories.has(id));
      const changedIds = store.categories
        .filter((category) => !previousCategories.has(category.id) || !sameSlice(previousCategories.get(category.id), category))
        .map((category) => category.id);

      if (removedIds.length > 0) {
        await tx.delete(expenseCategoriesTable).where(inArray(expenseCategoriesTable.id, removedIds));
      }

      for (const category of categories.filter((row) => changedIds.includes(row.id))) {
        const { id: _categoryId, createdAt: _categoryCreatedAt, ...updateValues } = category;
        if (previousCategories.has(category.id)) {
          await tx.update(expenseCategoriesTable).set(updateValues).where(eq(expenseCategoriesTable.id, category.id));
        } else {
          await tx.insert(expenseCategoriesTable).values(category);
        }
      }
    }

    if (fundsChanged) {
      const previousFunds = new Map(previousStore?.funds.map((fund) => [fund.id, fund]) ?? []);
      const nextFunds = new Map(store.funds.map((fund) => [fund.id, fund]));
      const removedIds = [...previousFunds.keys()].filter((id) => !nextFunds.has(id));
      const changedIds = store.funds
        .filter((fund) => !previousFunds.has(fund.id) || !sameSlice(previousFunds.get(fund.id), fund))
        .map((fund) => fund.id);

      if (removedIds.length > 0) {
        await tx.delete(fundsTable).where(inArray(fundsTable.id, removedIds));
      }

      for (const fund of funds.filter((row) => changedIds.includes(row.id))) {
        const { id: _fundId, createdAt: _fundCreatedAt, ...updateValues } = fund;
        if (previousFunds.has(fund.id)) {
          await tx.update(fundsTable).set(updateValues).where(eq(fundsTable.id, fund.id));
        } else {
          await tx.insert(fundsTable).values(fund);
        }
      }
    }

    if (projectsChanged) {
      const previousBudgets = new Map(previousStore?.projectBudgets.map((budget) => [budget.id, budget]) ?? []);
      const nextBudgets = new Map(store.projectBudgets.map((budget) => [budget.id, budget]));
      const removedProjectIds = [...previousBudgets.keys()].filter((id) => !nextBudgets.has(id));
      const changedProjectIds = store.projectBudgets
        .filter((budget) => !previousBudgets.has(budget.id) || !sameSlice(previousBudgets.get(budget.id), budget))
        .map((budget) => budget.id);

      if (removedProjectIds.length > 0) {
        await tx.delete(projectBudgetsTable).where(inArray(projectBudgetsTable.id, removedProjectIds));
        await tx.delete(projectsTable).where(inArray(projectsTable.id, removedProjectIds));
      }

      for (const budget of store.projectBudgets.filter((item) => changedProjectIds.includes(item.id))) {
        const budgetRow = projectBudgetToRow(budget);
        const projectRow = projectBudgetToNormalizedRow(budget, null);
        const taskRows = projectTasksToRows(budget, null);
        const previousBudget = previousBudgets.get(budget.id);
        const previousTaskIds = new Set(previousBudget?.tasks.map((task) => task.id) ?? []);
        const nextTaskIds = new Set(budget.tasks.map((task) => task.id));
        const removedTaskIds = [...previousTaskIds].filter((id) => !nextTaskIds.has(id));
        const { id: _budgetId, createdAt: _budgetCreatedAt, ...budgetUpdateValues } = budgetRow;
        const { id: _projectId, createdAt: _projectCreatedAt, ...projectUpdateValues } = projectRow;

        if (previousBudgets.has(budget.id)) {
          await tx.update(projectBudgetsTable).set(budgetUpdateValues).where(eq(projectBudgetsTable.id, budget.id));
          await tx.update(projectsTable).set(projectUpdateValues).where(eq(projectsTable.id, budget.id));
        } else {
          await tx.insert(projectBudgetsTable).values(budgetRow);
          await tx.insert(projectsTable).values(projectRow);
        }

        if (removedTaskIds.length > 0) {
          await tx.delete(projectTasksTable).where(inArray(projectTasksTable.id, removedTaskIds));
        }

        for (const taskRow of taskRows) {
          const { id: _taskId, createdAt: _taskCreatedAt, ...taskUpdateValues } = taskRow;
          if (previousTaskIds.has(taskRow.id)) {
            await tx.update(projectTasksTable).set(taskUpdateValues).where(eq(projectTasksTable.id, taskRow.id));
          } else {
            await tx.insert(projectTasksTable).values(taskRow);
          }
        }
      }
    }

    if (businessStateChanged) {
      await tx
        .insert(businessStateTable)
        .values({
          id: STATE_ID,
          data: stripNormalizedStore(store),
        })
        .onConflictDoUpdate({
          target: businessStateTable.id,
          set: {
            data: stripNormalizedStore(store),
            updatedAt: new Date(),
          },
        });
    } else if (!previousStore) {
      // Ensure the singleton row exists on first write even if the normalized payload is empty.
      await tx
        .insert(businessStateTable)
        .values({
          id: STATE_ID,
          data: stripNormalizedStore(store),
        })
        .onConflictDoNothing();
    }
  });
}

function hasPersistedTimesheetContent(entry: TimesheetEntry): boolean {
  return entry.lines.some((line) => {
    const normalizedWorkNotes = normalizeWorkNotes(line.workNotes);
    const hasText =
      Boolean(line.project.trim() || line.task.trim() || line.notes?.trim()) ||
      Boolean(normalizedWorkNotes && Object.keys(normalizedWorkNotes).length > 0);
    const hasHours = DAY_KEYS.some((day) => Number(line.hours[day] ?? 0) > 0);
    return hasText || hasHours;
  });
}

function summarizeTimesheetAudit(entry: TimesheetEntry) {
  return {
    employeeId: entry.employeeId,
    employeeNameSnapshot: entry.employeeNameSnapshot ?? null,
    weekStart: entry.weekStart,
    status: entry.status,
    totalHours: sumTimesheetHours(entry),
    submittedAt: entry.submittedAt ?? null,
    reviewedAt: entry.reviewedAt ?? null,
    reviewedBy: entry.reviewedBy ?? null,
    reviewNotes: entry.reviewNotes ?? null,
  };
}

function createAuditEntry(input: Omit<AuditTrailEntry, "id" | "createdAt">): AuditTrailEntry {
  return {
    id: createId("audit"),
    createdAt: nowIso(),
    ...input,
    tenantId: input.tenantId?.trim() || DEFAULT_TENANT_ID,
    actorUserId: input.actorUserId?.trim() || undefined,
    requestId: input.requestId?.trim() || undefined,
    details: normalizeAuditTrailDetails(input.details, input.requestId),
  };
}

async function persistTargetedTimesheetUnsafe(input: {
  currentStore: BusinessStore;
  nextStore: BusinessStore;
  entry?: TimesheetEntry | null;
  deleteTimesheetId?: string | null;
  salary?: SalaryRecord | null;
  auditEntry?: AuditTrailEntry | null;
}): Promise<void> {
  const { currentStore, nextStore, entry, deleteTimesheetId, salary, auditEntry } = input;
  const projectTasks = nextStore.projectBudgets.flatMap((budget) => budget.tasks ?? []);
  const validProjectIds = new Set(nextStore.projectBudgets.map((budget) => budget.id));
  const validTaskIds = new Set(projectTasks.map((task) => task.id));

  await db.transaction(async (tx) => {
    if (deleteTimesheetId) {
      await tx.delete(timesheetLinesTable).where(eq(timesheetLinesTable.timesheetId, deleteTimesheetId));
      await tx.delete(timesheetsTable).where(eq(timesheetsTable.id, deleteTimesheetId));
    }

    if (entry) {
      const row = timesheetToRow(entry);
      const { id: _rowId, createdAt: _rowCreatedAt, ...updateValues } = row;
      const alreadyExists = currentStore.timesheets.some((timesheet) => timesheet.id === entry.id);

      if (alreadyExists) {
        await tx.update(timesheetsTable).set(updateValues).where(eq(timesheetsTable.id, entry.id));
      } else {
        await tx.insert(timesheetsTable).values(row);
      }

      await tx.delete(timesheetLinesTable).where(eq(timesheetLinesTable.timesheetId, entry.id));

      const lineRows = timesheetLinesToRows(entry, validProjectIds, validTaskIds);
      if (lineRows.length > 0) {
        await tx.insert(timesheetLinesTable).values(lineRows);
      }
    }

    if (salary) {
      const row = salaryToRow(salary);
      const { id: _salaryId, createdAt: _salaryCreatedAt, ...salaryUpdateValues } = row;
      const alreadyExists = currentStore.salaries.some((item) => item.id === salary.id);
      if (alreadyExists) {
        await tx.update(salariesTable).set(salaryUpdateValues).where(eq(salariesTable.id, salary.id));
      } else {
        await tx.insert(salariesTable).values(row);
      }
    }

    if (auditEntry) {
      await tx.insert(auditTrailTable).values(auditEntryToRow(auditEntry));
    }
  });
}

export async function writeStore(store: BusinessStore): Promise<void> {
  await ensureSchema();
  await withStoreWriteLock(async () => {
    storeReadPromise = null;
    const previous = storeCache ?? await readStore({ fresh: true });
    const next = normalizeStore(store);
    await persistStoreUnsafe(previous, next);
    cacheStore(next);
  });
}

export async function updateStore(mutator: (current: BusinessStore) => BusinessStore): Promise<BusinessStore> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const next = normalizeStore(mutator(cloneStore(current)));
    await persistStoreUnsafe(current, next);
    cacheStore(next);
    return cloneStore(next);
  });
}

function taskHoursFromLine(line: TimesheetTaskLine): number {
  return DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
}

type TaskWindowCatalogEntry = {
  taskName: string;
  projectName: string;
  maxHours?: number;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  hourLimitScope: ProjectTaskHourLimitScope;
};

function buildTaskUsageMap(
  taskCatalog: Map<string, TaskWindowCatalogEntry>,
  timesheets: TimesheetEntry[],
  options?: { excludeTimesheetId?: string; includedStatuses?: ApprovalStatus[] },
): Map<string, number> {
  const allowedStatuses = new Set(options?.includedStatuses ?? ["submitted", "approved"]);
  const totals = new Map<string, number>();

  for (const entry of timesheets) {
    if (options?.excludeTimesheetId && entry.id === options.excludeTimesheetId) {
      continue;
    }

    if (!allowedStatuses.has(entry.status)) {
      continue;
    }

    for (const line of entry.lines) {
      if (!line.projectTaskId) {
        continue;
      }

      const task = taskCatalog.get(line.projectTaskId);
      const hours = task ? sumTaskLineHoursWithinWindow(entry.weekStart, line.hours, task) : taskHoursFromLine(line);
      totals.set(line.projectTaskId, (totals.get(line.projectTaskId) ?? 0) + hours);
    }
  }

  return totals;
}

function buildTaskUsageByEmployeeMap(
  taskCatalog: Map<string, TaskWindowCatalogEntry>,
  timesheets: TimesheetEntry[],
  options?: { excludeTimesheetId?: string; includedStatuses?: ApprovalStatus[] },
): Map<string, Map<string, number>> {
  const allowedStatuses = new Set(options?.includedStatuses ?? ["submitted", "approved"]);
  const totals = new Map<string, Map<string, number>>();

  for (const entry of timesheets) {
    if (options?.excludeTimesheetId && entry.id === options.excludeTimesheetId) {
      continue;
    }

    if (!allowedStatuses.has(entry.status)) {
      continue;
    }

    for (const line of entry.lines) {
      if (!line.projectTaskId) {
        continue;
      }

      const task = taskCatalog.get(line.projectTaskId);
      const hours = task ? sumTaskLineHoursWithinWindow(entry.weekStart, line.hours, task) : taskHoursFromLine(line);
      const current = totals.get(line.projectTaskId) ?? new Map<string, number>();
      current.set(entry.employeeId, (current.get(entry.employeeId) ?? 0) + hours);
      totals.set(line.projectTaskId, current);
    }
  }

  return totals;
}

function assertTaskHourLimits(entry: TimesheetEntry, projects: ProjectBudget[], currentTimesheets: TimesheetEntry[]) {
  const taskCatalog = new Map<string, TaskWindowCatalogEntry>(
    projects.flatMap((project) =>
      project.tasks.map((task) => [
        task.id,
        {
          taskName: task.name,
          projectName: project.project,
          maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
          ...normalizeTaskWindowRange(task.startDate, task.endDate),
          durationDays: calculateTaskWindowDays(task),
          hourLimitScope: normalizeProjectTaskHourLimitScope(task.hourLimitScope),
        },
      ] as const),
    ),
  );

  const totalsByTask = buildTaskUsageMap(taskCatalog, currentTimesheets, {
    excludeTimesheetId: entry.id,
    includedStatuses: ["draft", "submitted", "approved"],
  });
  const totalsByTaskAndEmployee = buildTaskUsageByEmployeeMap(taskCatalog, currentTimesheets, {
    excludeTimesheetId: entry.id,
    includedStatuses: ["draft", "submitted", "approved"],
  });

  for (const line of entry.lines) {
    if (!line.projectTaskId) {
      continue;
    }

    const task = taskCatalog.get(line.projectTaskId);
    if (!task) {
      continue;
    }

    for (const day of DAY_KEYS) {
      const hours = Number(line.hours[day] ?? 0);
      if (hours <= 0) {
        continue;
      }

      const claimDate = weekDateIso(entry.weekStart, day);
      if (!isDateWithinTaskWindow(claimDate, task)) {
        const startLabel = task.startDate ?? "the task start date";
        const endLabel = task.endDate ?? "the task end date";
        throw new TaskWindowError(
          `${task.taskName} in ${task.projectName} can only be claimed between ${startLabel} and ${endLabel}. Remove hours outside that window before saving.`,
        );
      }
    }

    const lineHours = sumTaskLineHoursWithinWindow(entry.weekStart, line.hours, task);
    totalsByTask.set(line.projectTaskId, (totalsByTask.get(line.projectTaskId) ?? 0) + lineHours);
    const employeeUsage = totalsByTaskAndEmployee.get(line.projectTaskId) ?? new Map<string, number>();
    employeeUsage.set(entry.employeeId, (employeeUsage.get(entry.employeeId) ?? 0) + lineHours);
    totalsByTaskAndEmployee.set(line.projectTaskId, employeeUsage);
  }

  for (const [taskId, totalHours] of totalsByTask.entries()) {
    const task = taskCatalog.get(taskId);
    if (!task?.maxHours) {
      continue;
    }

    const effectiveHours =
      task.hourLimitScope === "per_employee"
        ? totalsByTaskAndEmployee.get(taskId)?.get(entry.employeeId) ?? 0
        : totalHours;

    if (Number(effectiveHours.toFixed(2)) > Number(task.maxHours.toFixed(2))) {
      const durationLabel = task.startDate && task.endDate
        ? ` between ${task.startDate} and ${task.endDate}`
        : task.durationDays
          ? ` over ${task.durationDays} day${task.durationDays === 1 ? "" : "s"}`
          : "";
      const scopeLabel = task.hourLimitScope === "per_employee" ? " per employee" : "";
      throw new TaskHourLimitError(
        `${task.taskName} in ${task.projectName} allows a maximum of ${task.maxHours} hours${scopeLabel}${durationLabel}. Reduce the claimed hours before saving.`,
      );
    }
  }
}

export async function saveTimesheetFast(input: {
  entry: TimesheetEntry;
  audit?: Omit<AuditTrailEntry, "id" | "createdAt">;
}): Promise<TimesheetEntry | null> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const normalizedEntry = normalizeStore({ timesheets: [input.entry] }).timesheets[0];
    assertTaskHourLimits(normalizedEntry, current.projectBudgets, current.timesheets);
    const existing = current.timesheets.find((timesheet) => timesheet.id === normalizedEntry.id);

    if (normalizedEntry.status === "draft" && !hasPersistedTimesheetContent(normalizedEntry)) {
      if (!existing) {
        return null;
      }

      const auditEntry = input.audit
        ? createAuditEntry({
            ...input.audit,
            entityId: existing.id,
            details: {
              entityLabel: existing.employeeNameSnapshot,
              requestId: input.audit.requestId,
              changedFields: ["deleted"],
              before: summarizeTimesheetAudit(existing),
              after: null,
              context: { operation: "timesheet_delete_draft" },
            },
          })
        : null;

      const nextStore = normalizeStore({
        ...current,
        timesheets: current.timesheets.filter((timesheet) => timesheet.id !== existing.id),
        auditTrail: auditEntry ? [auditEntry, ...current.auditTrail].slice(0, 250) : current.auditTrail,
      });

      await persistTargetedTimesheetUnsafe({
        currentStore: current,
        nextStore,
        deleteTimesheetId: existing.id,
        auditEntry,
      });
      cacheStore(nextStore);
      return null;
    }

    const nextStore = normalizeStore({
      ...current,
      timesheets: existing
        ? current.timesheets.map((timesheet) => (timesheet.id === normalizedEntry.id ? normalizedEntry : timesheet))
        : [normalizedEntry, ...current.timesheets],
      auditTrail: input.audit
        ? [
            createAuditEntry({
              ...input.audit,
              entityId: normalizedEntry.id,
              details: {
                entityLabel: normalizedEntry.employeeNameSnapshot,
                requestId: input.audit.requestId,
                changedFields: existing ? ["entry"] : ["created"],
                before: existing ? summarizeTimesheetAudit(existing) : null,
                after: summarizeTimesheetAudit(normalizedEntry),
                context: { operation: existing ? "timesheet_save" : "timesheet_create" },
              },
            }),
            ...current.auditTrail,
          ].slice(0, 250)
        : current.auditTrail,
    });

    const auditEntry = input.audit ? nextStore.auditTrail[0] ?? null : null;

    await persistTargetedTimesheetUnsafe({
      currentStore: current,
      nextStore,
      entry: normalizedEntry,
      auditEntry,
    });
    cacheStore(nextStore);
    return structuredClone(normalizedEntry);
  });
}

export async function setTimesheetDayReviewStatusFast(input: {
  id: string;
  day: DayKey;
  reviewed: boolean;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
  requestId?: string;
}): Promise<TimesheetEntry | null> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const existing = current.timesheets.find((timesheet) => timesheet.id === input.id);

    if (!existing) {
      return null;
    }

    const nextDailyReviewStatus = { ...(existing.dailyReviewStatus ?? {}) };
    if (input.reviewed) {
      nextDailyReviewStatus[input.day] = "reviewed";
    } else {
      delete nextDailyReviewStatus[input.day];
    }

    const updatedEntry = normalizeStore({
      timesheets: [
        {
          ...existing,
          dailyReviewStatus: nextDailyReviewStatus,
          updatedAt: nowIso(),
        },
      ],
    }).timesheets[0];

    const auditEntry = createAuditEntry({
      tenantId: input.tenantId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      action: "reviewed",
      entityType: "timesheet",
      entityId: existing.id,
      summary: `${input.reviewed ? "Marked" : "Cleared"} ${input.day.toUpperCase()} as reviewed for a timesheet.`,
      requestId: input.requestId,
      details: {
        entityLabel: existing.employeeNameSnapshot,
        requestId: input.requestId,
        changedFields: ["dailyReviewStatus"],
        before: { dailyReviewStatus: existing.dailyReviewStatus ?? {} },
        after: { dailyReviewStatus: updatedEntry.dailyReviewStatus ?? {} },
        context: { operation: input.reviewed ? "timesheet_day_review_mark" : "timesheet_day_review_clear", day: input.day },
      },
    });

    const nextStore = normalizeStore({
      ...current,
      timesheets: current.timesheets.map((timesheet) => (timesheet.id === existing.id ? updatedEntry : timesheet)),
      auditTrail: [auditEntry, ...current.auditTrail].slice(0, 250),
    });

    await persistTargetedTimesheetUnsafe({
      currentStore: current,
      nextStore,
      entry: updatedEntry,
      auditEntry,
    });
    cacheStore(nextStore);
    return structuredClone(updatedEntry);
  });
}

export async function submitTimesheetFast(input: {
  id: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
  requestId?: string;
}): Promise<TimesheetEntry | null> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const existing = current.timesheets.find((timesheet) => timesheet.id === input.id);

    if (!existing) {
      return null;
    }

    assertWorkflowTransition("timesheetSubmission", existing.status, "submitted");

    const updatedEntry = normalizeStore({
      timesheets: [
        {
          ...existing,
          status: "submitted" as const,
          submittedAt: nowIso(),
          reviewedAt: undefined,
          reviewedBy: undefined,
          reviewNotes: undefined,
          updatedAt: nowIso(),
        },
      ],
    }).timesheets[0];
    assertTaskHourLimits(updatedEntry, current.projectBudgets, current.timesheets);

    const auditEntry = createAuditEntry({
      tenantId: input.tenantId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      action: "submitted",
      entityType: "timesheet",
      entityId: existing.id,
      summary: "Submitted a timesheet for review.",
      requestId: input.requestId,
      details: {
        entityLabel: existing.employeeNameSnapshot,
        requestId: input.requestId,
        changedFields: ["status", "submittedAt"],
        before: summarizeTimesheetAudit(existing),
        after: summarizeTimesheetAudit(updatedEntry),
        context: { operation: "timesheet_submit" },
      },
    });

    const nextStore = normalizeStore({
      ...current,
      timesheets: current.timesheets.map((timesheet) => (timesheet.id === existing.id ? updatedEntry : timesheet)),
      auditTrail: [auditEntry, ...current.auditTrail].slice(0, 250),
    });

    await persistTargetedTimesheetUnsafe({
      currentStore: current,
      nextStore,
      entry: updatedEntry,
      auditEntry,
    });
    cacheStore(nextStore);
    return structuredClone(updatedEntry);
  });
}

export async function submitTimesheetEntryFast(input: {
  entry: TimesheetEntry;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
  requestId?: string;
}): Promise<TimesheetEntry> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const normalizedEntry = normalizeStore({ timesheets: [input.entry] }).timesheets[0];
    assertTaskHourLimits(normalizedEntry, current.projectBudgets, current.timesheets);
    const existing = current.timesheets.find((timesheet) => timesheet.id === normalizedEntry.id);
    assertWorkflowTransition("timesheetSubmission", existing?.status ?? "draft", "submitted");
    const submittedEntry = normalizeStore({
      timesheets: [
        {
          ...normalizedEntry,
          submittedAt: nowIso(),
          reviewedAt: undefined,
          reviewedBy: undefined,
          reviewNotes: undefined,
          status: "submitted" as const,
          updatedAt: nowIso(),
          createdAt: existing?.createdAt ?? normalizedEntry.createdAt,
        },
      ],
    }).timesheets[0];

    const auditEntry = createAuditEntry({
      tenantId: input.tenantId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      action: "submitted",
      entityType: "timesheet",
      entityId: submittedEntry.id,
      summary: "Submitted a timesheet for review.",
      requestId: input.requestId,
      details: {
        entityLabel: submittedEntry.employeeNameSnapshot,
        requestId: input.requestId,
        changedFields: ["status", "submittedAt"],
        before: existing ? summarizeTimesheetAudit(existing) : null,
        after: summarizeTimesheetAudit(submittedEntry),
        context: { operation: "timesheet_submit" },
      },
    });

    const nextStore = normalizeStore({
      ...current,
      timesheets: existing
        ? current.timesheets.map((timesheet) => (timesheet.id === submittedEntry.id ? submittedEntry : timesheet))
        : [submittedEntry, ...current.timesheets],
      auditTrail: [auditEntry, ...current.auditTrail].slice(0, 250),
    });

    await persistTargetedTimesheetUnsafe({
      currentStore: current,
      nextStore,
      entry: submittedEntry,
      auditEntry,
    });
    cacheStore(nextStore);
    return structuredClone(submittedEntry);
  });
}

export async function reviewTimesheetFast(input: {
  id: string;
  tenantId: string;
  status: "approved" | "rejected";
  actorName: string;
  requestId?: string;
  note?: string;
  employee?: UserProfile | null;
}): Promise<{ timesheet: TimesheetEntry; salary?: SalaryRecord }> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    storeReadPromise = null;
    const current = storeCache ?? await readStore({ fresh: true });
    const existing = current.timesheets.find((timesheet) => timesheet.id === input.id);

    if (!existing) {
      throw new Error("Timesheet not found");
    }

    assertWorkflowTransition("timesheetReview", existing.status, input.status);

    const now = nowIso();
    const reviewedEntry = normalizeStore({
      timesheets: [
        {
          ...existing,
          status: input.status,
          reviewedAt: now,
          reviewedBy: input.actorName,
          reviewNotes: input.note?.trim() || undefined,
          updatedAt: now,
        },
      ],
    }).timesheets[0];

    let salary: SalaryRecord | undefined;
    if (input.status === "approved" && input.employee && input.employee.payType === "hourly" && effectiveHourlyRate(input.employee) > 0) {
      const existingPayroll = current.salaries.find((item) => item.timesheetId === existing.id);
      const hours = sumTimesheetHours(existing);
      const rate = effectiveHourlyRate(input.employee);
      salary = {
        id: existingPayroll?.id ?? createId("sal"),
        tenantId: input.employee.tenantId ?? DEFAULT_TENANT_ID,
        employeeId: input.employee.id,
        employeeNameSnapshot: input.employee.name,
        amount: Math.round(hours * rate),
        date: now,
        note: input.note?.trim() || `Timesheet payout for week of ${existing.weekStart}`,
        status: existingPayroll?.status === "paid" ? "paid" : "pending",
        source: "timesheet",
        paidAt: existingPayroll?.status === "paid" ? existingPayroll.paidAt ?? existingPayroll.date : undefined,
        weekStart: existing.weekStart,
        hours,
        rate,
        timesheetId: existing.id,
        createdAt: existingPayroll?.createdAt ?? now,
        updatedAt: now,
      };
    }

    const auditEntry = createAuditEntry({
      tenantId: input.tenantId,
      actorName: input.actorName,
      actorRole: "admin",
      action: input.status === "approved" ? "approved" : "reverted",
      entityType: "timesheet",
      entityId: existing.id,
      summary:
        input.status === "approved"
          ? `Approved timesheet for ${existing.employeeNameSnapshot}.`
          : "Returned a timesheet for changes.",
      requestId: input.requestId,
      details: {
        entityLabel: existing.employeeNameSnapshot,
        requestId: input.requestId,
        changedFields: ["status", "reviewedAt", "reviewedBy", "reviewNotes"],
        before: summarizeTimesheetAudit(existing),
        after: summarizeTimesheetAudit(reviewedEntry),
        context: { operation: input.status === "approved" ? "timesheet_approve" : "timesheet_reject" },
      },
    });

    const nextStore = normalizeStore({
      ...current,
      timesheets: current.timesheets.map((timesheet) => (timesheet.id === existing.id ? reviewedEntry : timesheet)),
      salaries: salary
        ? current.salaries.some((item) => item.id === salary!.id)
          ? current.salaries.map((item) => (item.id === salary!.id ? salary! : item))
          : [salary, ...current.salaries]
        : current.salaries,
      auditTrail: [auditEntry, ...current.auditTrail].slice(0, 250),
    });

    await persistTargetedTimesheetUnsafe({
      currentStore: current,
      nextStore,
      entry: reviewedEntry,
      salary: salary ?? null,
      auditEntry,
    });
    cacheStore(nextStore);
    return {
      timesheet: structuredClone(reviewedEntry),
      salary: salary ? structuredClone(salary) : undefined,
    };
  });
}

export function pushAuditEvent(store: BusinessStore, input: Omit<AuditTrailEntry, "id" | "createdAt">): BusinessStore {
  const auditEntry = createAuditEntry(input);
  return {
    ...store,
    auditTrail: [
        auditEntry,
        ...store.auditTrail,
      ].slice(0, 250),
  };
}

export async function loadEmployeeProfile(employeeId: string, tenantId?: string): Promise<UserProfile | null> {
  const rows = await db
    .select({
      id: usersTable.id,
      tenantId: usersTable.tenantId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      employeeId: usersTable.employeeId,
      position: usersTable.position,
      department: usersTable.department,
      salary: usersTable.salary,
      payType: usersTable.payType,
      hourlyRate: usersTable.hourlyRate,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(tenantId ? and(eq(usersTable.id, employeeId.trim()), eq(usersTable.tenantId, tenantId.trim())) : eq(usersTable.id, employeeId.trim()))
    .limit(1);

  const user = rows[0];
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    tenantId: String(user.tenantId ?? DEFAULT_TENANT_ID),
    name: user.name,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    salary: user.salary,
    payType: user.payType,
    hourlyRate: user.hourlyRate,
    status: user.status,
  };
}

export async function loadEmployees(tenantId?: string) {
  const rows = await db
    .select({
      id: usersTable.id,
      tenantId: usersTable.tenantId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      employeeId: usersTable.employeeId,
      position: usersTable.position,
      department: usersTable.department,
      salary: usersTable.salary,
      payType: usersTable.payType,
      hourlyRate: usersTable.hourlyRate,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(tenantId ? and(eq(usersTable.role, "employee"), eq(usersTable.tenantId, tenantId.trim())) : eq(usersTable.role, "employee"));

  return rows.map((user) => ({
    id: user.id,
    tenantId: String(user.tenantId ?? DEFAULT_TENANT_ID),
    name: user.name,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    salary: user.salary,
    payType: user.payType,
    hourlyRate: user.hourlyRate,
    status: user.status,
  }));
}
