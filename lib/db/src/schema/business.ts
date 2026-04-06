import { createInsertSchema } from "drizzle-zod";
import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type SalaryStatus = "pending" | "paid";
export type ExpenseGroup = "personal" | "office";
export type ActorRole = "admin" | "employee" | "system";
export type ProjectStatus = "active" | "archived";
export type ProjectTaskStatus = "active" | "archived";
export type PurchaseOrderTaskStatus = "pending" | "paid";
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
  | "purchase-order-task";

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
  status: ProjectTaskStatus;
}

export interface TimesheetLineRecord {
  id: string;
  project: string;
  task: string;
  projectBudgetId?: string;
  projectTaskId?: string;
  notes?: string;
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

export const approvalStatusEnum = pgEnum("approval_status", ["draft", "submitted", "approved", "rejected"]);
export const salaryStatusEnum = pgEnum("salary_status", ["pending", "paid"]);
export const salarySourceEnum = pgEnum("salary_source", ["manual", "timesheet"]);
export const expenseGroupEnum = pgEnum("expense_group", ["personal", "office"]);
export const actorRoleEnum = pgEnum("audit_actor_role", ["admin", "employee", "system"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const projectTaskStatusEnum = pgEnum("project_task_status", ["active", "archived"]);
export const purchaseOrderTaskStatusEnum = pgEnum("purchase_order_task_status", ["pending", "paid"]);
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
]);

export const businessStateTable = pgTable("business_state", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fundsTable = pgTable(
  "funds",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    amount: integer("amount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIndex: index("funds_source_index").on(table.source),
    dateIndex: index("funds_date_index").on(table.date),
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
    employeeIndex: index("expenses_employee_index").on(table.employeeId),
    statusIndex: index("expenses_status_index").on(table.status),
    dateIndex: index("expenses_date_index").on(table.date),
    categoryIndex: index("expenses_category_index").on(table.category),
    projectIndex: index("expenses_project_index").on(table.project),
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
    employeeIndex: index("salaries_employee_index").on(table.employeeId),
    statusIndex: index("salaries_status_index").on(table.status),
    dateIndex: index("salaries_date_index").on(table.date),
    paidAtIndex: index("salaries_paid_at_index").on(table.paidAt),
    timesheetUnique: uniqueIndex("salaries_timesheet_unique").on(table.timesheetId),
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
    project: text("project").notNull(),
    totalBudget: integer("total_budget").notNull().default(0),
    client: text("client"),
    note: text("note").notNull().default(""),
    tasks: jsonb("tasks").$type<ProjectBudgetTaskRecord[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectUnique: uniqueIndex("project_budgets_project_unique").on(table.project),
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
    title: text("title").notNull(),
    totalAmount: integer("total_amount").notNull().default(0),
    usedAmount: integer("used_amount").notNull().default(0),
    remainingAmount: integer("remaining_amount").notNull().default(0),
    vendor: text("vendor"),
    date: timestamp("date", { withTimezone: true }).notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    tasks: jsonb("tasks").$type<PurchaseOrderTaskRecord[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => ({
    titleIndex: index("purchase_orders_title_index").on(table.title),
    vendorIndex: index("purchase_orders_vendor_index").on(table.vendor),
    dateIndex: index("purchase_orders_date_index").on(table.date),
    updatedIndex: index("purchase_orders_updated_index").on(table.updatedAt),
  }),
);

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const auditTrailTable = pgTable(
  "audit_trail",
  {
    id: text("id").primaryKey(),
    actorName: text("actor_name").notNull(),
    actorRole: actorRoleEnum("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: auditEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorIndex: index("audit_trail_actor_index").on(table.actorName),
    entityIndex: index("audit_trail_entity_index").on(table.entityType, table.entityId),
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
    name: text("name").notNull(),
    client: text("client"),
    note: text("note").notNull().default(""),
    status: projectStatusEnum("status").notNull().default("active"),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
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
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: projectTaskStatusEnum("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIndex: index("project_tasks_project_index").on(table.projectId),
    nameIndex: index("project_tasks_name_index").on(table.name),
    statusIndex: index("project_tasks_status_index").on(table.status),
    sortOrderIndex: index("project_tasks_sort_order_index").on(table.sortOrder),
    createdByIndex: index("project_tasks_created_by_index").on(table.createdById),
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
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes").notNull().default(""),
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
export type AuditTrailEntry = typeof auditTrailTable.$inferSelect;
export type InsertAuditTrailEntry = typeof auditTrailTable.$inferInsert;
