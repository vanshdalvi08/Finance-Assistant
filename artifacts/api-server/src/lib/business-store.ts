import { randomUUID } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";
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
  type PurchaseOrder as DbPurchaseOrder,
  type Salary as DbSalary,
  type Timesheet as DbTimesheet,
  type TimesheetLine as DbTimesheetLine,
} from "@workspace/db/schema";

export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ActorRole = "admin" | "employee" | "system";

export interface FundRecord {
  id: string;
  source: string;
  amount: number;
  date: string;
  note: string;
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
  notes?: string;
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
  lines: TimesheetTaskLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBudgetTask {
  id: string;
  name: string;
  description?: string;
  status: "active" | "archived";
}

export interface ProjectBudget {
  id: string;
  project: string;
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
  amount: number;
  status: "pending" | "paid";
  paidAt?: string;
}

export interface PurchaseOrder {
  id: string;
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

export interface AuditTrailEntry {
  id: string;
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
    | "purchase-order-task";
  entityId: string;
  summary: string;
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
  auditTrail: AuditTrailEntry[];
}

type BusinessStateData = Partial<BusinessStore>;

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
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
    source: row.source.trim(),
    amount: Math.abs(Number(row.amount ?? 0)),
    date: toIso(row.date),
    note: row.note ?? "",
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function fundToRow(fund: FundRecord) {
  return {
    id: fund.id,
    source: fund.source.trim(),
    amount: Math.abs(Number(fund.amount ?? 0)),
    date: toDate(fund.date),
    note: fund.note ?? "",
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

  return {
    id: row.id,
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
  return {
    id: row.id,
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
          amount: Math.abs(Number(task.amount ?? 0)),
          status: task.status === "paid" ? "paid" : "pending",
          paidAt: task.paidAt ? normalizeDate(String(task.paidAt)) : undefined,
        }))
      : [],
  };
}

function purchaseOrderToRow(order: PurchaseOrder) {
  return {
    id: order.id,
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
      amount: Math.abs(Number(task.amount ?? 0)),
      status: task.status === "paid" ? ("paid" as const) : ("pending" as const),
      paidAt: task.paidAt ? normalizeDate(task.paidAt) : undefined,
    })),
  };
}

function auditEntryFromRow(row: DbAuditTrailEntry): AuditTrailEntry {
  return {
    id: row.id,
    actorName: row.actorName.trim(),
    actorRole: row.actorRole === "employee" || row.actorRole === "system" ? row.actorRole : "admin",
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
      row.entityType === "purchase-order-task"
        ? row.entityType
        : "timesheet",
    entityId: row.entityId,
    summary: row.summary,
    createdAt: toIso(row.createdAt),
  };
}

function auditEntryToRow(entry: AuditTrailEntry) {
  return {
    id: entry.id,
    actorName: entry.actorName.trim(),
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    createdAt: toDate(entry.createdAt),
  };
}

function projectBudgetFromRow(row: DbProjectBudget): ProjectBudget {
  return {
    id: row.id,
    project: row.project,
    totalBudget: Number(row.totalBudget ?? 0),
    client: row.client?.trim() || undefined,
    note: row.note?.trim() || undefined,
    tasks: Array.isArray(row.tasks)
      ? row.tasks
          .filter((task) => task && task.name?.trim())
          .map((task) => ({
            id: task.id ?? createId("pbt"),
            name: String(task.name ?? "").trim(),
            description: task.description?.trim() || undefined,
            status: task.status === "archived" ? "archived" : "active",
          }))
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
  return {
    id: row.id,
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
      .map((task) => ({
        id: task.id,
        name: task.name.trim(),
        description: task.description?.trim() || undefined,
        status: task.status === "archived" ? "archived" : "active",
      })),
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
    lines: Array.isArray(row.lines) && row.lines.length > 0
      ? row.lines.map((line) => ({
          id: line.id ?? createId("line"),
          project: String(line.project ?? "").trim(),
          task: String(line.task ?? "").trim(),
          projectBudgetId: line.projectBudgetId?.trim() || undefined,
          projectTaskId: line.projectTaskId?.trim() || undefined,
          notes: line.notes?.trim() || undefined,
          hours: { ...blankHours(), ...(line.hours ?? {}) },
        }))
      : [{ id: createId("line"), project: "", task: "", notes: "", hours: blankHours() }],
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
          notes: line.notes?.trim() || undefined,
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
  return {
    id: budget.id,
    project: budget.project.trim(),
    totalBudget: Math.abs(Number(budget.totalBudget ?? 0)),
    client: budget.client?.trim() || null,
    note: budget.note?.trim() || "",
    tasks: (budget.tasks ?? []).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      status: task.status === "archived" ? ("archived" as const) : ("active" as const),
    })),
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
    lines: (entry.lines ?? []).map((line) => ({
      id: line.id ?? createId("line"),
      project: line.project?.trim() || "",
      task: line.task?.trim() || "",
      projectBudgetId: line.projectBudgetId?.trim() || undefined,
      projectTaskId: line.projectTaskId?.trim() || undefined,
      notes: line.notes?.trim() || undefined,
      hours: { ...blankHours(), ...(line.hours ?? {}) },
    })),
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt),
  };
}

function projectBudgetToNormalizedRow(budget: ProjectBudget, createdById: string | null) {
  return {
    id: budget.id,
    name: budget.project.trim(),
    client: budget.client?.trim() || null,
    note: budget.note?.trim() || "",
    status: "active" as const,
    createdById,
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  };
}

function projectTasksToRows(budget: ProjectBudget, createdById: string | null) {
  return (budget.tasks ?? []).map((task, index) => ({
    id: task.id ?? createId("task"),
    projectId: budget.id,
    name: task.name.trim(),
    description: task.description?.trim() || "",
    status: task.status === "archived" ? ("archived" as const) : ("active" as const),
    sortOrder: index,
    createdById,
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  }));
}

function timesheetLinesToRows(entry: TimesheetEntry) {
  return (entry.lines ?? []).map((line, index) => ({
    id: line.id ?? createId("line"),
    timesheetId: entry.id,
    projectBudgetId: null,
    projectId: line.projectBudgetId?.trim() || null,
    projectTaskId: line.projectTaskId?.trim() || null,
    sortOrder: index,
    notes: line.notes?.trim() || "",
    mon: Number(line.hours.mon ?? 0),
    tue: Number(line.hours.tue ?? 0),
    wed: Number(line.hours.wed ?? 0),
    thu: Number(line.hours.thu ?? 0),
    fri: Number(line.hours.fri ?? 0),
    sat: Number(line.hours.sat ?? 0),
    sun: Number(line.hours.sun ?? 0),
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt),
  }));
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
  const timesheetLines = store.timesheets.flatMap((entry) => timesheetLinesToRows(entry));

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
      source: String(fund.source ?? "").trim(),
      amount: Math.abs(Number(fund.amount ?? 0)),
      date: normalizeDate(String(fund.date ?? nowIso())),
      note: String(fund.note ?? ""),
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
      lines: Array.isArray(entry.lines) && entry.lines.length > 0 ? entry.lines.map((line) => ({
        id: line.id ?? createId("line"),
        project: String(line.project ?? "").trim(),
        task: String(line.task ?? "").trim(),
        projectBudgetId: line.projectBudgetId?.trim() || undefined,
        projectTaskId: line.projectTaskId?.trim() || undefined,
        notes: line.notes?.trim() || undefined,
        hours: { ...blankHours(), ...(line.hours ?? {}) },
      })) : [
        { id: createId("line"), project: "", task: "", notes: "", hours: blankHours() },
      ],
      createdAt: normalizeDate(String(entry.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(entry.updatedAt ?? entry.createdAt ?? nowIso())),
    })) : [],
    projectBudgets: Array.isArray(input.projectBudgets) ? input.projectBudgets.map((budget) => ({
      id: budget.id ?? createId("pb"),
      project: String(budget.project ?? "").trim(),
      totalBudget: Math.abs(Number(budget.totalBudget ?? 0)),
      client: budget.client?.trim() || undefined,
      note: budget.note?.trim() || undefined,
      tasks: Array.isArray(budget.tasks) ? budget.tasks.filter((task) => task.name?.trim()).map((task) => ({
        id: task.id ?? createId("pbt"),
        name: String(task.name ?? "").trim(),
        description: task.description?.trim() || undefined,
        status: task.status === "archived" ? "archived" : "active",
      })) : [],
      createdAt: normalizeDate(String(budget.createdAt ?? nowIso())),
      updatedAt: normalizeDate(String(budget.updatedAt ?? budget.createdAt ?? nowIso())),
    })) : [],
    purchaseOrders: Array.isArray(input.purchaseOrders) ? input.purchaseOrders.map((order) => ({
      id: order.id ?? createId("po"),
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
        amount: Math.abs(Number(task.amount ?? 0)),
        status: task.status === "paid" ? "paid" : "pending",
        paidAt: task.paidAt ? normalizeDate(String(task.paidAt)) : undefined,
      })) : [],
    })) : [],
    auditTrail: Array.isArray(input.auditTrail) ? input.auditTrail.map((entry) => ({
      id: entry.id ?? createId("audit"),
      actorName: String(entry.actorName ?? "System").trim(),
      actorRole: entry.actorRole === "employee" || entry.actorRole === "system" ? entry.actorRole : "admin",
      action: String(entry.action ?? "updated"),
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? "").trim(),
      summary: String(entry.summary ?? ""),
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

export async function readStore(): Promise<BusinessStore> {
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

  return normalizeStore({
    ...legacyStore,
    funds: fundRows.map(fundFromRow),
    categories: categoryRows.map(categoryFromRow),
    expenses: expenseRows.map(expenseFromRow),
    salaries: salaryRows.map(salaryFromRow),
    projectBudgets: normalizedProjects,
    timesheets: normalizedTimesheets,
    purchaseOrders: purchaseOrderRows.map(purchaseOrderFromRow),
    auditTrail: auditRows.map(auditEntryFromRow),
  });
}

async function persistStoreUnsafe(store: BusinessStore): Promise<void> {
  const funds = store.funds.map(fundToRow);
  const categories = store.categories.map(categoryToRow);
  const expenses = store.expenses.map(expenseToRow);
  const salaries = store.salaries.map(salaryToRow);
  const projectBudgets = store.projectBudgets.map(projectBudgetToRow);
  const projects = store.projectBudgets.map((budget) => projectBudgetToNormalizedRow(budget, null));
  const projectTasks = store.projectBudgets.flatMap((budget) => projectTasksToRows(budget, null));
  const timesheets = store.timesheets.map(timesheetToRow);
  const timesheetLines = store.timesheets.flatMap((entry) => timesheetLinesToRows(entry));
  const purchaseOrders = store.purchaseOrders.map(purchaseOrderToRow);
  const auditTrail = store.auditTrail.map(auditEntryToRow);

  await db.transaction(async (tx) => {
    await tx.delete(auditTrailTable);
    await tx.delete(purchaseOrdersTable);
    await tx.delete(timesheetLinesTable);
    await tx.delete(salariesTable);
    await tx.delete(expensesTable);
    await tx.delete(expenseCategoriesTable);
    await tx.delete(fundsTable);
    await tx.delete(projectTasksTable);
    await tx.delete(projectBudgetsTable);
    await tx.delete(projectsTable);
    await tx.delete(timesheetsTable);

    if (funds.length > 0) {
      await tx.insert(fundsTable).values(funds);
    }

    if (categories.length > 0) {
      await tx.insert(expenseCategoriesTable).values(categories);
    }

    if (expenses.length > 0) {
      await tx.insert(expensesTable).values(expenses);
    }

    if (salaries.length > 0) {
      await tx.insert(salariesTable).values(salaries);
    }

    if (projectBudgets.length > 0) {
      await tx.insert(projectBudgetsTable).values(projectBudgets);
    }

    if (projects.length > 0) {
      await tx.insert(projectsTable).values(projects);
    }

    if (projectTasks.length > 0) {
      await tx.insert(projectTasksTable).values(projectTasks);
    }

    if (timesheets.length > 0) {
      await tx.insert(timesheetsTable).values(timesheets);
    }

    if (timesheetLines.length > 0) {
      await tx.insert(timesheetLinesTable).values(timesheetLines);
    }

    if (purchaseOrders.length > 0) {
      await tx.insert(purchaseOrdersTable).values(purchaseOrders);
    }

    if (auditTrail.length > 0) {
      await tx.insert(auditTrailTable).values(auditTrail);
    }

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
  });
}

export async function writeStore(store: BusinessStore): Promise<void> {
  await ensureSchema();
  await withStoreWriteLock(() => persistStoreUnsafe(store));
}

export async function updateStore(mutator: (current: BusinessStore) => BusinessStore): Promise<BusinessStore> {
  await ensureSchema();
  return withStoreWriteLock(async () => {
    const current = await readStore();
    const next = normalizeStore(mutator(cloneStore(current)));
    await persistStoreUnsafe(next);
    return next;
  });
}

export function pushAuditEvent(store: BusinessStore, input: Omit<AuditTrailEntry, "id" | "createdAt">): BusinessStore {
  return {
    ...store,
    auditTrail: [
      { id: createId("audit"), createdAt: nowIso(), ...input },
      ...store.auditTrail,
    ].slice(0, 250),
  };
}

export async function loadEmployeeProfile(employeeId: string): Promise<UserProfile | null> {
  const rows = await db
    .select({
      id: usersTable.id,
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
    .where(eq(usersTable.id, employeeId.trim()))
    .limit(1);

  const user = rows[0];
  if (!user) {
    return null;
  }

  return {
    id: user.id,
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

export async function loadEmployees() {
  const rows = await db
    .select({
      id: usersTable.id,
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
    .where(eq(usersTable.role, "employee"));

  return rows.map((user) => ({
    id: user.id,
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
