import { createInsertSchema } from "drizzle-zod";
import { relations, sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimesheetWorkNotes = Partial<Record<DayKey, string>>;
export type TimesheetDailyReviewStatus = Partial<Record<DayKey, "reviewed" | "reverted">>;
export type TimesheetDailyReviewNotes = Partial<Record<DayKey, string>>;
export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type SalaryStatus = "pending" | "paid";
export type ExpenseGroup = "personal" | "office";
export type ActorRole = "admin" | "employee" | "client" | "platform_super_admin" | "system";
export type ProjectStatus = "active" | "archived";
export type ProjectTaskStatus = "active" | "archived";
export type ProjectTaskHourLimitScope = "overall" | "per_employee";
export type PurchaseOrderStatus = "active" | "archived";
export type PurchaseOrderTaskStatus = "pending" | "paid";
export type PreApprovalStatus = "draft" | "submitted" | "changes_requested" | "approved";
export type IdempotencyRequestStatus = "processing" | "completed";
export type LeavePolicyPeriod = "monthly" | "quarterly" | "yearly";
export type LeavePolicyScope = "all" | "selected";
export type AuditEntityType =
  | "employee"
  | "expense"
  | "fund"
  | "salary"
  | "timesheet"
  | "timesheet-line"
  | "category"
  | "project"
  | "project-task"
  | "project-budget"
  | "purchase-order"
  | "purchase-order-task"
  | "pre-approval"
  | "pre-approval-comment";

export interface TimesheetHours {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
}

export interface ProjectBudgetTaskRecord {
  id: string;
  name: string;
  description?: string;
  maxHours?: number;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  hourLimitScope?: ProjectTaskHourLimitScope;
  subTasks?: string[];
  status: ProjectTaskStatus;
}

export interface TimesheetLineRecord {
  id: string;
  project: string;
  task: string;
  projectBudgetId?: string;
  projectTaskId?: string;
  subTask?: string;
  notes?: string;
  workNotes?: TimesheetWorkNotes;
  hours: TimesheetHours;
}

export interface PurchaseOrderTaskRecord {
  id: string;
  taskName: string;
  description: string;
  hours?: number;
  rate?: number;
  amount: number;
  status: PurchaseOrderTaskStatus;
  paidAt?: string;
}

export interface PreApprovalTaskRecord {
  id: string;
  taskName: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

export interface PreApprovalCommentRecord {
  id: string;
  authorId?: string;
  authorName: string;
  authorRole: "admin" | "client";
  message: string;
  createdAt: string;
}

export interface PreApprovalPartyInfoRecord {
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface PreApprovalProjectInfoRecord {
  workDescription?: string;
  projectStartDate?: string;
  projectCompletionDate?: string;
  totalContractValue?: number;
  retainagePercent?: number;
  retainageAmount?: number;
  previouslyBilledAmount?: number;
}

export interface CompanySettingsRecord extends PreApprovalPartyInfoRecord {
  googleSheetsEnabled?: boolean;
  leavePolicy?: {
    annualLimit: number;
    period?: LeavePolicyPeriod;
    appliesTo?: LeavePolicyScope;
    employeeIds?: string[];
    updatedAt: string;
    updatedBy?: string;
  };
}

export interface AuditTrailDetailsRecord {
  entityLabel?: string;
  requestId?: string;
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
}

export const approvalStatusEnum = pgEnum("approval_status", ["draft", "submitted", "approved", "rejected"]);
export const salaryStatusEnum = pgEnum("salary_status", ["pending", "paid"]);
export const salarySourceEnum = pgEnum("salary_source", ["manual", "timesheet"]);
export const expenseGroupEnum = pgEnum("expense_group", ["personal", "office"]);
export const actorRoleEnum = pgEnum("audit_actor_role", ["admin", "employee", "client", "platform_super_admin", "system"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const projectTaskStatusEnum = pgEnum("project_task_status", ["active", "archived"]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", ["active", "archived"]);
export const purchaseOrderTaskStatusEnum = pgEnum("purchase_order_task_status", ["pending", "paid"]);
export const preApprovalStatusEnum = pgEnum("pre_approval_status", ["draft", "submitted", "changes_requested", "approved"]);
export const idempotencyRequestStatusEnum = pgEnum("idempotency_request_status", ["processing", "completed"]);
export const auditEntityTypeEnum = pgEnum("audit_entity_type", [
  "employee",
  "expense",
  "fund",
  "salary",
  "timesheet",
  "timesheet-line",
  "category",
  "project",
  "project-task",
  "project-budget",
  "purchase-order",
  "purchase-order-task",
  "pre-approval",
  "pre-approval-comment",
]);

export const businessStateTable = pgTable("business_state", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companySettingsTable = pgTable(
  "company_settings",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<CompanySettingsRecord>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUnique: uniqueIndex("company_settings_tenant_unique").on(table.tenantId),
  }),
);

export const fundsTable = pgTable(
  "funds",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    amount: integer("amount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    receiptName: text("receipt_name"),
    receiptPath: text("receipt_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("funds_tenant_index").on(table.tenantId),
    sourceIndex: index("funds_source_index").on(table.source),
    dateIndex: index("funds_date_index").on(table.date),
    positiveAmount: check("funds_amount_positive_check", sql`${table.amount} > 0`),
  }),
);

export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyRequestStatusEnum("status").notNull().default("processing"),
    responseEntityId: text("response_entity_id"),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantScopeKeyUnique: uniqueIndex("idempotency_keys_tenant_scope_key_unique").on(table.tenantId, table.scope, table.keyHash),
    tenantIndex: index("idempotency_keys_tenant_index").on(table.tenantId),
    scopeStatusIndex: index("idempotency_keys_scope_status_index").on(table.scope, table.status),
    responseEntityIndex: index("idempotency_keys_response_entity_index").on(table.responseEntityId),
  }),
);

export const insertFundSchema = createInsertSchema(fundsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const expenseCategoriesTable = pgTable(
  "expense_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    group: expenseGroupEnum("group").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameGroupUnique: uniqueIndex("expense_categories_name_group_unique").on(table.name, table.group),
    groupIndex: index("expense_categories_group_index").on(table.group),
  }),
);

export const insertExpenseCategorySchema = createInsertSchema(expenseCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const expensesTable = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => usersTable.id, { onDelete: "set null" }),
    employeeNameSnapshot: text("employee_name_snapshot"),
    project: text("project"),
    category: text("category").notNull(),
    group: expenseGroupEnum("group").notNull(),
    amount: integer("amount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    note: text("note").notNull().default(""),
    attachmentName: text("attachment_name"),
    attachmentPath: text("attachment_path"),
    reimbursable: boolean("reimbursable").notNull().default(false),
    status: approvalStatusEnum("status").notNull().default("approved"),
    reviewerNote: text("reviewer_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("expenses_tenant_index").on(table.tenantId),
    employeeIndex: index("expenses_employee_index").on(table.employeeId),
    statusIndex: index("expenses_status_index").on(table.status),
    dateIndex: index("expenses_date_index").on(table.date),
    categoryIndex: index("expenses_category_index").on(table.category),
    projectIndex: index("expenses_project_index").on(table.project),
    positiveAmount: check("expenses_amount_positive_check", sql`${table.amount} > 0`),
  }),
);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const salariesTable = pgTable(
  "salaries",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    employeeNameSnapshot: text("employee_name_snapshot"),
    amount: integer("amount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    status: salaryStatusEnum("status").notNull().default("pending"),
    source: salarySourceEnum("source").notNull().default("manual"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    weekStart: timestamp("week_start", { withTimezone: true }),
    hours: real("hours"),
    rate: integer("rate"),
    timesheetId: text("timesheet_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("salaries_tenant_index").on(table.tenantId),
    employeeIndex: index("salaries_employee_index").on(table.employeeId),
    statusIndex: index("salaries_status_index").on(table.status),
    dateIndex: index("salaries_date_index").on(table.date),
    paidAtIndex: index("salaries_paid_at_index").on(table.paidAt),
    timesheetUnique: uniqueIndex("salaries_timesheet_unique").on(table.timesheetId),
    positiveAmount: check("salaries_amount_positive_check", sql`${table.amount} > 0`),
    nonNegativeHours: check("salaries_hours_nonnegative_check", sql`${table.hours} IS NULL OR ${table.hours} >= 0`),
    nonNegativeRate: check("salaries_rate_nonnegative_check", sql`${table.rate} IS NULL OR ${table.rate} >= 0`),
  }),
);

export const insertSalarySchema = createInsertSchema(salariesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const timesheetsTable = pgTable(
  "timesheets",
  {
    id: text("id").primaryKey(),
    employeeId: uuid("employee_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    employeeNameSnapshot: text("employee_name_snapshot").notNull(),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    status: approvalStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewNotes: text("review_notes"),
  dailyReviewStatus: jsonb("daily_review_status").$type<TimesheetDailyReviewStatus>().notNull().default({}),
  dailyReviewNotes: jsonb("daily_review_notes").$type<TimesheetDailyReviewNotes>().notNull().default({}),
  lines: jsonb("lines").$type<TimesheetLineRecord[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    employeeIndex: index("timesheets_employee_index").on(table.employeeId),
    weekIndex: index("timesheets_week_index").on(table.weekStart),
    statusIndex: index("timesheets_status_index").on(table.status),
    employeeWeekUnique: uniqueIndex("timesheets_employee_week_unique").on(table.employeeId, table.weekStart),
  }),
);

export const insertTimesheetSchema = createInsertSchema(timesheetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const projectBudgetsTable = pgTable(
  "project_budgets",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    project: text("project").notNull(),
    totalBudget: integer("total_budget").notNull().default(0),
    client: text("client"),
    note: text("note").notNull().default(""),
    tasks: jsonb("tasks").$type<ProjectBudgetTaskRecord[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("project_budgets_tenant_index").on(table.tenantId),
    projectUnique: uniqueIndex("project_budgets_tenant_project_unique").on(table.tenantId, table.project),
    projectIndex: index("project_budgets_project_index").on(table.project),
    updatedIndex: index("project_budgets_updated_index").on(table.updatedAt),
  }),
);

export const insertProjectBudgetSchema = createInsertSchema(projectBudgetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const purchaseOrdersTable = pgTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    totalAmount: integer("total_amount").notNull().default(0),
    usedAmount: integer("used_amount").notNull().default(0),
    remainingAmount: integer("remaining_amount").notNull().default(0),
    vendor: text("vendor"),
    status: purchaseOrderStatusEnum("status").notNull().default("active"),
    date: timestamp("date", { withTimezone: true }).notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    tasks: jsonb("tasks").$type<PurchaseOrderTaskRecord[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => ({
    tenantIndex: index("purchase_orders_tenant_index").on(table.tenantId),
    titleIndex: index("purchase_orders_title_index").on(table.title),
    vendorIndex: index("purchase_orders_vendor_index").on(table.vendor),
    statusIndex: index("purchase_orders_status_index").on(table.status),
    dateIndex: index("purchase_orders_date_index").on(table.date),
    updatedIndex: index("purchase_orders_updated_index").on(table.updatedAt),
    nonNegativeTotalAmount: check("purchase_orders_total_amount_nonnegative_check", sql`${table.totalAmount} >= 0`),
    nonNegativeUsedAmount: check("purchase_orders_used_amount_nonnegative_check", sql`${table.usedAmount} >= 0`),
    nonNegativeRemainingAmount: check("purchase_orders_remaining_amount_nonnegative_check", sql`${table.remainingAmount} >= 0`),
    usedNotOverTotal: check("purchase_orders_used_not_over_total_check", sql`${table.usedAmount} <= ${table.totalAmount}`),
    remainingNotOverTotal: check("purchase_orders_remaining_not_over_total_check", sql`${table.remainingAmount} <= ${table.totalAmount}`),
  }),
);

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const preApprovalsTable = pgTable(
  "pre_approvals",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    project: text("project").notNull(),
    clientId: uuid("client_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    clientNameSnapshot: text("client_name_snapshot").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    notes: text("notes").notNull().default(""),
    companyInfo: jsonb("company_info").$type<PreApprovalPartyInfoRecord>().notNull().default({}),
    clientInfo: jsonb("client_info").$type<PreApprovalPartyInfoRecord>().notNull().default({}),
    projectInfo: jsonb("project_info").$type<PreApprovalProjectInfoRecord>().notNull().default({}),
    status: preApprovalStatusEnum("status").notNull().default("draft"),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedFundId: text("received_fund_id").references(() => fundsTable.id, { onDelete: "set null" }),
    tasks: jsonb("tasks").$type<PreApprovalTaskRecord[]>().notNull().default(sql`'[]'::jsonb`),
    comments: jsonb("comments").$type<PreApprovalCommentRecord[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("pre_approvals_tenant_index").on(table.tenantId),
    clientIndex: index("pre_approvals_client_index").on(table.clientId),
    statusIndex: index("pre_approvals_status_index").on(table.status),
    projectIndex: index("pre_approvals_project_index").on(table.project),
    createdByIndex: index("pre_approvals_created_by_index").on(table.createdById),
    updatedIndex: index("pre_approvals_updated_index").on(table.updatedAt),
  }),
);

export const insertPreApprovalSchema = createInsertSchema(preApprovalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const auditTrailTable = pgTable(
  "audit_trail",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    actorRole: actorRoleEnum("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: auditEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    requestId: text("request_id"),
    details: jsonb("details").$type<AuditTrailDetailsRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("audit_trail_tenant_index").on(table.tenantId),
    actorIndex: index("audit_trail_actor_index").on(table.actorName),
    actorUserIndex: index("audit_trail_actor_user_index").on(table.actorUserId),
    entityIndex: index("audit_trail_entity_index").on(table.entityType, table.entityId),
    requestIndex: index("audit_trail_request_index").on(table.requestId),
    createdIndex: index("audit_trail_created_index").on(table.createdAt),
  }),
);

export const insertAuditTrailSchema = createInsertSchema(auditTrailTable).omit({
  id: true,
  createdAt: true,
});

export const projectsTable = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    client: text("client"),
    note: text("note").notNull().default(""),
    status: projectStatusEnum("status").notNull().default("active"),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("projects_tenant_index").on(table.tenantId),
    nameIndex: index("projects_name_index").on(table.name),
    clientIndex: index("projects_client_index").on(table.client),
    statusIndex: index("projects_status_index").on(table.status),
    createdByIndex: index("projects_created_by_index").on(table.createdById),
  }),
);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const projectTasksTable = pgTable(
  "project_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    maxHours: real("max_hours"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    durationDays: integer("duration_days"),
    hourLimitScope: text("hour_limit_scope").$type<ProjectTaskHourLimitScope>().notNull().default("overall"),
    subTasks: jsonb("sub_tasks").$type<string[]>().notNull().default([]),
    status: projectTaskStatusEnum("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("project_tasks_tenant_index").on(table.tenantId),
    projectIndex: index("project_tasks_project_index").on(table.projectId),
    nameIndex: index("project_tasks_name_index").on(table.name),
    statusIndex: index("project_tasks_status_index").on(table.status),
    sortOrderIndex: index("project_tasks_sort_order_index").on(table.sortOrder),
    createdByIndex: index("project_tasks_created_by_index").on(table.createdById),
    nonNegativeMaxHours: check("project_tasks_max_hours_nonnegative_check", sql`${table.maxHours} IS NULL OR ${table.maxHours} >= 0`),
    pairedWindowDates: check(
      "project_tasks_window_pair_check",
      sql`(${table.startDate} IS NULL AND ${table.endDate} IS NULL) OR (${table.startDate} IS NOT NULL AND ${table.endDate} IS NOT NULL)`,
    ),
    orderedWindowDates: check(
      "project_tasks_window_order_check",
      sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    nonNegativeDurationDays: check("project_tasks_duration_days_nonnegative_check", sql`${table.durationDays} IS NULL OR ${table.durationDays} >= 0`),
  }),
);

export const insertProjectTaskSchema = createInsertSchema(projectTasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const timesheetLinesTable = pgTable(
  "timesheet_lines",
  {
    id: text("id").primaryKey(),
    timesheetId: text("timesheet_id").notNull().references(() => timesheetsTable.id, { onDelete: "cascade" }),
    projectBudgetId: text("project_budget_id").references(() => projectBudgetsTable.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
    projectTaskId: text("project_task_id").references(() => projectTasksTable.id, { onDelete: "set null" }),
    subTask: text("sub_task"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes").notNull().default(""),
    workNotes: jsonb("work_notes").$type<TimesheetWorkNotes>().notNull().default({}),
    mon: real("mon").notNull().default(0),
    tue: real("tue").notNull().default(0),
    wed: real("wed").notNull().default(0),
    thu: real("thu").notNull().default(0),
    fri: real("fri").notNull().default(0),
    sat: real("sat").notNull().default(0),
    sun: real("sun").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timesheetIndex: index("timesheet_lines_timesheet_index").on(table.timesheetId),
    projectBudgetIndex: index("timesheet_lines_project_budget_index").on(table.projectBudgetId),
    projectIndex: index("timesheet_lines_project_index").on(table.projectId),
    projectTaskIndex: index("timesheet_lines_project_task_index").on(table.projectTaskId),
    sortOrderIndex: index("timesheet_lines_sort_order_index").on(table.sortOrder),
    nonNegativeHours: check(
      "timesheet_lines_hours_nonnegative_check",
      sql`${table.mon} >= 0 AND ${table.tue} >= 0 AND ${table.wed} >= 0 AND ${table.thu} >= 0 AND ${table.fri} >= 0 AND ${table.sat} >= 0 AND ${table.sun} >= 0`,
    ),
  }),
);

export const insertTimesheetLineSchema = createInsertSchema(timesheetLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const projectsRelations = relations(projectsTable, ({ many, one }) => ({
  tasks: many(projectTasksTable),
  timesheetLines: many(timesheetLinesTable),
  createdBy: one(usersTable, {
    fields: [projectsTable.createdById],
    references: [usersTable.id],
  }),
}));

export const projectTasksRelations = relations(projectTasksTable, ({ many, one }) => ({
  project: one(projectsTable, {
    fields: [projectTasksTable.projectId],
    references: [projectsTable.id],
  }),
  timesheetLines: many(timesheetLinesTable),
  createdBy: one(usersTable, {
    fields: [projectTasksTable.createdById],
    references: [usersTable.id],
  }),
}));

export const timesheetsRelations = relations(timesheetsTable, ({ many }) => ({
  lines: many(timesheetLinesTable),
}));

export const projectBudgetsRelations = relations(projectBudgetsTable, ({ many }) => ({
  timesheetLines: many(timesheetLinesTable),
}));

export const timesheetLinesRelations = relations(timesheetLinesTable, ({ one }) => ({
  timesheet: one(timesheetsTable, {
    fields: [timesheetLinesTable.timesheetId],
    references: [timesheetsTable.id],
  }),
  projectBudget: one(projectBudgetsTable, {
    fields: [timesheetLinesTable.projectBudgetId],
    references: [projectBudgetsTable.id],
  }),
  project: one(projectsTable, {
    fields: [timesheetLinesTable.projectId],
    references: [projectsTable.id],
  }),
  projectTask: one(projectTasksTable, {
    fields: [timesheetLinesTable.projectTaskId],
    references: [projectTasksTable.id],
  }),
}));

export type Fund = typeof fundsTable.$inferSelect;
export type InsertFund = typeof fundsTable.$inferInsert;
export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type InsertExpenseCategory = typeof expenseCategoriesTable.$inferInsert;
export type Expense = typeof expensesTable.$inferSelect;
export type InsertExpense = typeof expensesTable.$inferInsert;
export type Salary = typeof salariesTable.$inferSelect;
export type InsertSalary = typeof salariesTable.$inferInsert;
export type Timesheet = typeof timesheetsTable.$inferSelect;
export type InsertTimesheet = typeof timesheetsTable.$inferInsert;
export type ProjectBudget = typeof projectBudgetsTable.$inferSelect;
export type InsertProjectBudget = typeof projectBudgetsTable.$inferInsert;
export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;
export type ProjectTask = typeof projectTasksTable.$inferSelect;
export type InsertProjectTask = typeof projectTasksTable.$inferInsert;
export type TimesheetLine = typeof timesheetLinesTable.$inferSelect;
export type InsertTimesheetLine = typeof timesheetLinesTable.$inferInsert;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrdersTable.$inferInsert;
export type PreApproval = typeof preApprovalsTable.$inferSelect;
export type InsertPreApproval = typeof preApprovalsTable.$inferInsert;
export type AuditTrailEntry = typeof auditTrailTable.$inferSelect;
export type InsertAuditTrailEntry = typeof auditTrailTable.$inferInsert;
