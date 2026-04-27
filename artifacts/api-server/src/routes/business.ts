import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  companySettingsTable,
  fundsTable,
  idempotencyKeysTable,
  preApprovalsTable,
  usersTable,
  type CompanySettingsRecord,
  type PreApproval as DbPreApproval,
} from "@workspace/db/schema";
import { auditTrailTable } from "../../../../lib/db/src/schema/business";
import { requireAuth, requireRole, requireTenantRole } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import {
  DAY_KEYS,
  type ApprovalStatus,
  type AuditTrailDetailsRecord,
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
import fundsRouter from "../modules/funds/funds.routes";
import expensesRouter from "../modules/expenses/expenses.routes";
import salaryRouter from "../modules/payroll/payroll.routes";
import projectsRouter from "./business/projects";
import purchaseOrdersRouter from "../modules/purchase-orders/purchase-orders.routes";
import timesheetsRouter from "./business/timesheets";
import {
  addPreApprovalComment,
  approvePreApproval,
  createPreApproval,
  deletePreApproval,
  getPreApprovalForActor,
  listPreApprovalsForActor,
  PreApprovalsServiceError,
  receivePreApprovalFunds,
  requestPreApprovalChanges,
  submitPreApproval,
  updatePreApproval,
} from "../lib/services/pre-approvals-service";
import { assertActorRoleAccess, assertEmployeeSelfAccess, assertTenantAccess } from "../lib/policies";
import { hashSha256 } from "../lib/security";
import { logger } from "../lib/logger";
import { assertWorkflowTransition, WorkflowStateError } from "../lib/workflow-state";

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

function idempotencyKeyFrom(request: Request) {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  return header?.trim() || undefined;
}

class LeaveIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

class CategoryIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

class PreApprovalDraftIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

class CalendarIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

function requestHashForLeaveReview(input: { leaveRequestId: string; status: "approved" | "rejected"; reviewNote?: string }) {
  return hashSha256(
    JSON.stringify({
      leaveRequestId: input.leaveRequestId.trim(),
      status: input.status,
      reviewNote: input.reviewNote?.trim() ?? "",
    }),
  );
}

function requestHashForCategoryMutation(input: { categoryId?: string; name: string; color: string; group: "personal" | "office" }) {
  return hashSha256(
    JSON.stringify({
      categoryId: input.categoryId?.trim() ?? "",
      name: input.name.trim(),
      color: input.color.trim(),
      group: input.group,
    }),
  );
}

function requestHashForCategoryDelete(input: { categoryId: string }) {
  return hashSha256(JSON.stringify({ categoryId: input.categoryId.trim() }));
}

async function claimLeaveReviewIdempotency(
  actor: { tenantId: string; userId?: string },
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
      scope: "leave_review",
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
        eq(idempotencyKeysTable.scope, "leave_review"),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new LeaveIdempotencyError("Unable to acquire idempotency lock for this leave review request.");
  }
  if (row.requestHash !== requestHash) {
    throw new LeaveIdempotencyError("This idempotency key is already used for a different leave review payload.");
  }

  return { row, created: false };
}

async function claimCategoryIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: "category_create" | "category_update" | "category_delete",
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
    throw new CategoryIdempotencyError("Unable to acquire idempotency lock for this category request.");
  }
  if (row.requestHash !== requestHash) {
    throw new CategoryIdempotencyError("This idempotency key is already used for a different category payload.");
  }

  return { row, created: false };
}

function handleLeaveIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof LeaveIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

function handleCategoryIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof CategoryIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

function handlePreApprovalDraftIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof PreApprovalDraftIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

function handleCalendarIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof CalendarIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

const dateSchema = z.string().min(1);
const dayKeySchema = z.enum(DAY_KEYS as [DayKey, ...DayKey[]]);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);
const employeeScopeSchema = z.object({
  employeeId: z.string().uuid().optional(),
});

const businessIdSchema = z.string().trim().min(1);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

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

const poTaskSchema = z.object({
  id: businessIdSchema.optional(),
  taskName: z.string().trim().min(2),
  description: z.string().trim().optional(),
  hours: z.coerce.number().min(0),
  rate: z.coerce.number().min(0),
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

type PreApprovalDraftIdempotencyScope = "pre_approval_create" | "pre_approval_update" | "pre_approval_delete";

function requestHashForPreApprovalMutation(input: z.infer<typeof preApprovalSchema> & { id?: string }) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      title: input.title.trim(),
      project: input.project.trim(),
      clientId: input.clientId.trim(),
      date: input.date.trim(),
      notes: input.notes?.trim() ?? "",
      companyInfo: {
        companyName: input.companyInfo?.companyName?.trim() ?? "",
        address: input.companyInfo?.address?.trim() ?? "",
        phone: input.companyInfo?.phone?.trim() ?? "",
        email: input.companyInfo?.email?.trim() ?? "",
        website: input.companyInfo?.website?.trim() ?? "",
      },
      clientInfo: {
        companyName: input.clientInfo?.companyName?.trim() ?? "",
        address: input.clientInfo?.address?.trim() ?? "",
        phone: input.clientInfo?.phone?.trim() ?? "",
        email: input.clientInfo?.email?.trim() ?? "",
        website: input.clientInfo?.website?.trim() ?? "",
      },
      projectInfo: {
        workDescription: input.projectInfo?.workDescription?.trim() ?? "",
        projectStartDate: input.projectInfo?.projectStartDate?.trim() ?? "",
        projectCompletionDate: input.projectInfo?.projectCompletionDate?.trim() ?? "",
        totalContractValue: Number(input.projectInfo?.totalContractValue ?? 0),
        retainagePercent: Number(input.projectInfo?.retainagePercent ?? 0),
        retainageAmount: Number(input.projectInfo?.retainageAmount ?? 0),
        previouslyBilledAmount: Number(input.projectInfo?.previouslyBilledAmount ?? 0),
      },
      tasks: (input.tasks ?? []).map((task) => ({
        id: task.id?.trim() ?? "",
        taskName: task.taskName.trim(),
        description: task.description?.trim() ?? "",
        hours: Number(task.hours),
        rate: Number(task.rate),
      })),
    }),
  );
}

function requestHashForPreApprovalDelete(input: { id: string }) {
  return hashSha256(JSON.stringify({ id: input.id.trim() }));
}

async function claimPreApprovalDraftIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: PreApprovalDraftIdempotencyScope,
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

  const rows = await db
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

  const row = rows[0];
  if (!row) {
    throw new PreApprovalDraftIdempotencyError("Unable to acquire idempotency lock for this pre-approval request.");
  }
  if (row.requestHash !== requestHash) {
    throw new PreApprovalDraftIdempotencyError("This idempotency key is already used for a different pre-approval payload.");
  }

  return { row, created: false };
}

type CalendarIdempotencyScope = "holiday_create" | "holiday_delete" | "leave_request_create" | "leave_request_delete";

function requestHashForHolidayMutation(input: z.infer<typeof holidaySchema>) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      date: input.date.trim(),
      name: input.name.trim(),
    }),
  );
}

function requestHashForLeaveRequestMutation(input: z.infer<typeof leaveRequestSchema> & { employeeId: string }) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      employeeId: input.employeeId.trim(),
      startDate: input.startDate.trim(),
      endDate: input.endDate.trim(),
      reason: input.reason?.trim() ?? "",
    }),
  );
}

function requestHashForDeleteById(input: { id: string }) {
  return hashSha256(JSON.stringify({ id: input.id.trim() }));
}

async function claimCalendarIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: CalendarIdempotencyScope,
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

  const rows = await db
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

  const row = rows[0];
  if (!row) {
    throw new CalendarIdempotencyError("Unable to acquire idempotency lock for this request.");
  }
  if (row.requestHash !== requestHash) {
    throw new CalendarIdempotencyError("This idempotency key is already used for a different payload.");
  }

  return { row, created: false };
}

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
  actorUserId?: string;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  entityType: "pre-approval" | "pre-approval-comment";
  entityId: string;
  summary: string;
  requestId?: string;
  details?: AuditTrailDetailsRecord;
}) {
  await db.insert(auditTrailTable).values({
    id: createId("audit"),
    tenantId: input.tenantId.trim() || "00000000-0000-0000-0000-000000000101",
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    requestId: input.requestId?.trim() || null,
    details: input.details ?? null,
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

function preApprovalActor(request: Request) {
  return {
    userId: request.auth?.user.id,
    requestId: String(request.id),
    tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  } as const;
}

function handlePreApprovalServiceError(error: unknown, response: Response) {
  if (!(error instanceof PreApprovalsServiceError)) {
    throw error;
  }

  if (error.code === "not_found") {
    respondNotFound(response, error.message);
    return true;
  }

  if (error.code === "forbidden") {
    response.status(403).json({ message: error.message });
    return true;
  }

  if (error.code === "conflict") {
    response.status(409).json({ message: error.message });
    return true;
  }

  response.status(400).json({ message: error.message });
  return true;
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
    logger.warn({ err: error }, "Failed to deliver notification");
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

router.use(requireAuth);
router.use((request, response, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return mutationLimiter(request, response, next);
  }

  next();
});
router.use(fundsRouter);
router.use(expensesRouter);
router.use(salaryRouter);
router.use(purchaseOrdersRouter);
router.use(timesheetsRouter);

router.get("/overview", requireTenantRole("admin"), async (_request, response) => {
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

router.get("/charts", requireTenantRole("admin"), async (_request, response) => {
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

router.get("/transactions", requireTenantRole("admin"), async (_request, response) => {
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

router.get("/audit-trail", requireTenantRole("admin"), async (_request, response) => {
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

router.post("/holidays", requireTenantRole("admin"), async (request, response) => {
  const parsed = holidaySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid holiday payload" });
    return;
  }

  const store = await readStore();
  const now = nowIso();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForHolidayMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCalendarIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCalendarIdempotency({ tenantId, userId: request.auth?.user.id }, "holiday_create", idempotencyKey, requestHash)
        : null;
  } catch (error) {
    if (handleCalendarIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const replayed = idempotencyClaim.row.responseEntityId ? latest.holidays.find((item) => item.id === idempotencyClaim.row.responseEntityId) : null;
      response.json({ holiday: replayed ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This holiday request is already being processed. Please retry shortly." });
    return;
  }
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

  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: holiday.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(existing ? 200 : 201).json({ holiday, duplicate: false });
});

router.delete("/holidays/:id", requireTenantRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.holidays.find((holiday) => holiday.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Holiday not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForDeleteById({ id: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCalendarIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCalendarIdempotency({ tenantId, userId: request.auth?.user.id }, "holiday_delete", idempotencyKey, requestHash)
        : null;
  } catch (error) {
    if (handleCalendarIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).end();
      return;
    }
    response.status(409).json({ message: "This holiday delete request is already being processed. Please retry shortly." });
    return;
  }
  if ((existing.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  await updateStore((current) => ({
    ...current,
    holidays: current.holidays.filter((holiday) => holiday.id !== request.params.id),
  }));

  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: routeParam(request.params.id), updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

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

router.patch("/leave-settings", requireTenantRole("admin"), async (request, response) => {
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

router.get("/company-settings", requireTenantRole("admin"), async (_request, response) => {
  const tenantId = _request.auth?.user.tenantId;
  const rows = tenantId
    ? await db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, tenantId)).limit(1)
    : [];
  response.json({ companyInfo: rows[0]?.data ?? {} });
});

router.patch("/company-settings", requireTenantRole("admin"), async (request, response) => {
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

router.get("/leave-requests", requireTenantRole("admin", "employee"), async (request, response) => {
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

router.post("/leave-requests", requireTenantRole("employee"), async (request, response) => {
  const user = request.auth?.user;
  if (!user) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = leaveRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid leave request payload" });
    return;
  }

  const employeeId = user.id;
  const store = await readStore();
  const tenantId = user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForLeaveRequestMutation({ ...parsed.data, employeeId }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCalendarIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCalendarIdempotency({ tenantId, userId: user.id }, "leave_request_create", idempotencyKey, requestHash)
        : null;
  } catch (error) {
    if (handleCalendarIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const replayed = idempotencyClaim.row.responseEntityId ? latest.leaveRequests.find((item) => item.id === idempotencyClaim.row.responseEntityId) : null;
      response.json({ leaveRequest: replayed ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This leave request is already being processed. Please retry shortly." });
    return;
  }
  const employeeProfile = await loadEmployeeProfile(employeeId, tenantId);
  const employeeNameSnapshot = employeeProfile?.name ?? user.name ?? "Employee";
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

  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: leaveRequest.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(201).json({ leaveRequest, duplicate: false });
});

router.delete("/leave-requests/:id", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const existing = store.leaveRequests.find((leaveRequest) => leaveRequest.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Leave request not found");
    return;
  }

  const role = request.auth?.user.role;
  const userId = request.auth?.user.id;
  const isAdminRequest = role === "admin";
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForDeleteById({ id: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCalendarIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCalendarIdempotency({ tenantId, userId }, "leave_request_delete", idempotencyKey, requestHash)
        : null;
  } catch (error) {
    if (handleCalendarIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).end();
      return;
    }
    response.status(409).json({ message: "This leave delete request is already being processed. Please retry shortly." });
    return;
  }
  try {
    assertTenantAccess(existing.tenantId, tenantId, () => new Error("Forbidden"));
    if (!isAdminRequest) {
      assertActorRoleAccess(role, ["employee"], () => new Error("You cannot modify this leave request."));
      assertEmployeeSelfAccess(existing.employeeId, role, userId, () => new Error("You cannot modify this leave request."));
    }
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Forbidden" });
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

  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: existing.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(204).end();
});

router.patch("/leave-requests/:id/status", requireTenantRole("admin"), async (request, response) => {
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
  try {
    assertTenantAccess(existing.tenantId, tenantId, () => new Error("Forbidden"));
  } catch {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const reviewNote = parsed.data.reviewNote?.trim() || undefined;
  const requestHash = idempotencyKey
    ? requestHashForLeaveReview({
        leaveRequestId: routeParam(request.params.id),
        status: parsed.data.status,
        reviewNote,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimLeaveReviewIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimLeaveReviewIdempotency(
            { tenantId, userId: request.auth?.user.id },
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleLeaveIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latestStore = await readStore();
      const latestLeave = latestStore.leaveRequests.find((leaveRequest) => leaveRequest.id === request.params.id);
      response.json({ leaveRequest: latestLeave ?? existing, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This leave review request is already being processed. Please retry shortly." });
    return;
  }

  try {
    assertWorkflowTransition("leaveRequest", existing.status, parsed.data.status);
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (error instanceof WorkflowStateError) {
      response.status(409).json({ message: error.message });
      return;
    }
    throw error;
  }

  const updatedRequest: LeaveRequestRecord = {
    ...existing,
    status: parsed.data.status,
    reviewNote,
    reviewedAt: nowIso(),
    reviewedBy: request.auth?.user.name ?? "Admin",
    updatedAt: nowIso(),
  };

  try {
    await updateStore((current) => ({
      ...current,
      leaveRequests: current.leaveRequests.map((leaveRequest) => (leaveRequest.id === updatedRequest.id ? updatedRequest : leaveRequest)),
    }));
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: updatedRequest.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }

  response.json({ leaveRequest: updatedRequest, duplicate: false });
});

router.route("/categories").get(async (_request, response) => {
  const store = await readStore();
  response.json({ categories: [...store.categories] });
}).post(requireTenantRole("admin"), async (request, response) => {
  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid category payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForCategoryMutation({
        categoryId: parsed.data.id,
        name: parsed.data.name,
        color: parsed.data.color,
        group: parsed.data.group,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCategoryIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCategoryIdempotency(
            { tenantId, userId: request.auth?.user.id },
            parsed.data.id ? "category_update" : "category_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleCategoryIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const latest = await readStore();
      const replayed = latest.categories.find((category) => category.id === idempotencyClaim.row.responseEntityId);
      if (replayed) {
        response.status(200).json({ category: replayed, duplicate: true });
        return;
      }
    }
    response.status(409).json({ message: "This category request is already being processed. Please retry shortly." });
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
    details: {
      entityLabel: category.name,
      requestId: String(request.id),
      changedFields: existing ? ["name", "color", "group"] : ["name", "color", "group"],
      before: existing
        ? {
            id: existing.id,
            name: existing.name,
            color: existing.color,
            group: existing.group,
          }
        : null,
      after: {
        id: category.id,
        name: category.name,
        color: category.color,
        group: category.group,
      },
      context: { operation: existing ? "category_update" : "category_create" },
    },
  });

  try {
    await updateStore(() => next);
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: category.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }

  response.status(existing ? 200 : 201).json({ category, duplicate: false });
});

router.route("/categories/:id").get(requireTenantRole("admin"), async (request, response) => {
  const store = await readStore();
  const category = store.categories.find((item) => item.id === request.params.id);
  if (!category) {
    respondNotFound(response, "Category not found");
    return;
  }

  response.json({ category });
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = categorySchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid category payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey
    ? requestHashForCategoryMutation({
        categoryId: routeParam(request.params.id),
        name: parsed.data.name,
        color: parsed.data.color,
        group: parsed.data.group,
      })
    : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCategoryIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCategoryIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "category_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleCategoryIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const replayed = latest.categories.find((category) => category.id === request.params.id);
      if (replayed) {
        response.json({ category: replayed, duplicate: true });
        return;
      }
    }
    response.status(409).json({ message: "This category update request is already being processed. Please retry shortly." });
    return;
  }

  const store = await readStore();
  const existing = store.categories.find((category) => category.id === request.params.id);
  if (!existing) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
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
    details: {
      entityLabel: category.name,
      requestId: String(request.id),
      changedFields: ["name", "color", "group"],
      before: {
        id: existing.id,
        name: existing.name,
        color: existing.color,
        group: existing.group,
      },
      after: {
        id: category.id,
        name: category.name,
        color: category.color,
        group: category.group,
      },
      context: { operation: "category_update" },
    },
  });

  try {
    await updateStore(() => next);
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: category.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
  response.json({ category, duplicate: false });
}).delete(requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForCategoryDelete({ categoryId: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimCategoryIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimCategoryIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "category_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleCategoryIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This category delete request is already being processed. Please retry shortly." });
    return;
  }

  const store = await readStore();
  const target = store.categories.find((category) => category.id === request.params.id);
  if (!target) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
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
      details: {
        entityLabel: target.name,
        requestId: String(request.id),
        changedFields: ["deleted"],
        before: {
          id: target.id,
          name: target.name,
          color: target.color,
          group: target.group,
        },
        after: null,
        context: { operation: "category_delete" },
      },
    },
  );

  try {
    await updateStore(() => next);
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: routeParam(request.params.id),
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
  response.status(204).send();
});

router.get("/expenses", requireTenantRole("admin", "employee"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const requesterRole = request.auth?.user.role;
  const employeeIdQuery = (request.query as { employeeId?: string }).employeeId?.trim() || null;
  const employeeId = requesterRole === "employee" ? request.auth?.user.id ?? null : employeeIdQuery;
  let expenses = store.expenses.filter((expense) => expense.tenantId === tenantId || (expense.tenantId == null && tenantId === DEFAULT_TENANT_ID));

  if (employeeId) {
    expenses = expenses.filter((expense) => expense.employeeId === employeeId);
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

router.get("/projects/summary", requireTenantRole("admin", "employee"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantProjectBudgets = store.projectBudgets.filter((budget) => tenantProjectFilter(budget, tenantId));
  const archivedProjectNames = new Set(
    tenantProjectBudgets
      .filter((budget) => budget.status === "archived")
      .map((budget) => budget.project.trim())
      .filter(Boolean),
  );
  const activeProjectBudgets = tenantProjectBudgets.filter((budget) => budget.status !== "archived");
  const activeTaskCatalog = new Map<string, ProjectBudget["tasks"][number]>();
  for (const budget of activeProjectBudgets) {
    for (const task of budget.tasks.filter((item) => item.status !== "archived")) {
      activeTaskCatalog.set(task.id, task);
    }
  }
  const taskUsageById = new Map<string, number>();
  for (const entry of store.timesheets) {
    if (!employeeMap.has(entry.employeeId)) {
      continue;
    }
    if (entry.status === "rejected") {
      continue;
    }

    for (const line of entry.lines) {
      if (!line.projectTaskId || !activeTaskCatalog.has(line.projectTaskId)) {
        continue;
      }

      const hours = DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
      taskUsageById.set(line.projectTaskId, (taskUsageById.get(line.projectTaskId) ?? 0) + hours);
    }
  }
  const grouped = new Map<string, {
    id: string;
    project: string;
    labourHours: number;
    labourCost: number;
    expenseCost: number;
    totalBudget: number;
    client?: string;
    note?: string;
    tasks: Array<{
      id: string;
      name: string;
      description?: string;
      maxHours?: number;
      durationDays?: number;
      status: "active" | "archived";
      usedHours: number;
      remainingHours?: number;
      utilisation: number;
      hoursPerDay?: number;
    }>;
  }>();

  const ensureBucket = (project: string) => {
    if (!grouped.has(project)) {
      const budget = activeProjectBudgets.find((item) => item.project === project);
      grouped.set(project, {
        id: budget?.id ?? `project_${project.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        project,
        labourHours: 0,
        labourCost: 0,
        expenseCost: 0,
        totalBudget: budget?.totalBudget ?? 0,
        client: budget?.client,
        note: budget?.note,
        tasks: [],
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
      if (archivedProjectNames.has(project)) {
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
    if (archivedProjectNames.has(project)) {
      continue;
    }

    const bucket = ensureBucket(project);
    bucket.expenseCost += Math.abs(expense.amount);
  }

  for (const budget of activeProjectBudgets) {
    const bucket = ensureBucket(budget.project);
    bucket.tasks = budget.tasks
      .filter((task) => task.status !== "archived")
      .map((task) => {
      const usedHours = Number((taskUsageById.get(task.id) ?? 0).toFixed(2));
      const maxHours = Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : 0;
      const remainingHours = maxHours > 0 ? Math.max(0, Number((maxHours - usedHours).toFixed(2))) : undefined;
      const utilisation = maxHours > 0 ? Math.min(100, Number(((usedHours / maxHours) * 100).toFixed(1))) : 0;
      const hoursPerDay = maxHours > 0 && Number(task.durationDays ?? 0) > 0
        ? Number((maxHours / Number(task.durationDays)).toFixed(1))
        : undefined;

      return {
        id: task.id,
        name: task.name,
        description: task.description,
        maxHours: task.maxHours,
        durationDays: task.durationDays,
        status: task.status,
        usedHours,
        remainingHours,
        utilisation,
        hoursPerDay,
      };
    });
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

router.get("/projects/names", requireTenantRole("admin", "employee"), async (_request, response) => {
  const store = await readStore();
  const tenantId = _request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const employees = await loadEmployees(tenantId);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const tenantExpenses = store.expenses.filter((expense) => tenantExpenseFilter(expense, tenantId));
  const tenantProjectBudgets = store.projectBudgets.filter((budget) => tenantProjectFilter(budget, tenantId));
  const archivedProjectNames = new Set(
    tenantProjectBudgets
      .filter((budget) => budget.status === "archived")
      .map((budget) => budget.project.trim())
      .filter(Boolean),
  );
  const activeProjectBudgets = tenantProjectBudgets.filter((budget) => budget.status !== "archived");
  const names = new Set<string>();

  for (const entry of store.timesheets) {
    if (!employeeIds.has(entry.employeeId)) {
      continue;
    }
    for (const line of entry.lines) {
      if (line.project.trim()) {
        const projectName = line.project.trim();
        if (!archivedProjectNames.has(projectName)) {
          names.add(projectName);
        }
      }
    }
  }

  for (const expense of tenantExpenses) {
    if (expense.project?.trim()) {
      const projectName = expense.project.trim();
      if (!archivedProjectNames.has(projectName)) {
        names.add(projectName);
      }
    }
  }

  for (const budget of activeProjectBudgets) {
    if (budget.project.trim()) {
      names.add(budget.project.trim());
    }
  }

  response.json({ projectNames: Array.from(names).sort((left, right) => left.localeCompare(right)) });
});

router.use(projectsRouter);

router.get("/pre-approvals", requireTenantRole("admin", "client"), async (request, response) => {
  const rows = await listPreApprovalsForActor(preApprovalActor(request));
  response.json({ preApprovals: rows.map(serializePreApproval) });
});

router.post("/pre-approvals", requireTenantRole("admin"), async (request, response) => {
  const parsed = preApprovalSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid pre-approval payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPreApprovalMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPreApprovalDraftIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPreApprovalDraftIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "pre_approval_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePreApprovalDraftIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getPreApprovalForActor(idempotencyClaim.row.responseEntityId, preApprovalActor(request));
      response.json({ preApproval: serializePreApproval(replayed), duplicate: true });
      return;
    }
    response.status(409).json({ message: "This pre-approval request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const row = await createPreApproval(parsed.data, preApprovalActor(request));
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: row.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    response.status(201).json({ preApproval: serializePreApproval(row), duplicate: false });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.route("/pre-approvals/:id").get(requireTenantRole("admin", "client"), async (request, response) => {
  try {
    const preApproval = await getPreApprovalForActor(routeParam(request.params.id), preApprovalActor(request));
    response.json({ preApproval: serializePreApproval(preApproval) });
  } catch (error) {
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = preApprovalSchema.safeParse({ ...request.body, id: routeParam(request.params.id) });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid pre-approval payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPreApprovalMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPreApprovalDraftIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPreApprovalDraftIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "pre_approval_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePreApprovalDraftIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getPreApprovalForActor(idempotencyClaim.row.responseEntityId, preApprovalActor(request));
      response.json({ preApproval: serializePreApproval(replayed), duplicate: true });
      return;
    }
    response.status(409).json({ message: "This pre-approval update request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const row = await updatePreApproval(routeParam(request.params.id), parsed.data, preApprovalActor(request));
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: row.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    response.json({ preApproval: serializePreApproval(row), duplicate: false });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).delete(requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPreApprovalDelete({ id: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPreApprovalDraftIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPreApprovalDraftIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "pre_approval_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePreApprovalDraftIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This pre-approval delete request is already being processed. Please retry shortly." });
    return;
  }

  try {
    await deletePreApproval(routeParam(request.params.id), preApprovalActor(request));
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: routeParam(request.params.id),
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    response.status(204).send();
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post("/pre-approvals/:id/submit", requireTenantRole("admin"), async (request, response) => {
  try {
    const result = await submitPreApproval(routeParam(request.params.id), preApprovalActor(request), {
      idempotencyKey: idempotencyKeyFrom(request),
    });
    if (!result.wasAlreadySubmitted) {
      await deliverNotification(
        notifyUsersByIds([result.preApproval.clientId], notificationActor(request), {
        type: "pre_approval_submitted",
        title: "Pre-approval ready for review",
        body: `${result.preApproval.title} is waiting for your approval.`,
        link: "/client/pre-approvals",
        metadata: { entityType: "pre-approval", entityId: result.preApproval.id },
      }),
      );
    }
    response.json({ preApproval: serializePreApproval(result.preApproval), duplicate: result.wasAlreadySubmitted });
  } catch (error) {
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post("/pre-approvals/:id/comments", requireTenantRole("admin", "client"), async (request, response) => {
  const parsed = preApprovalCommentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Comment is required." });
    return;
  }

  try {
    const result = await addPreApprovalComment(routeParam(request.params.id), parsed.data.message, preApprovalActor(request), {
      idempotencyKey: idempotencyKeyFrom(request),
    });
    response
      .status(result.wasDuplicate ? 200 : 201)
      .json({ preApproval: serializePreApproval(result.preApproval), comment: result.comment, duplicate: result.wasDuplicate });
  } catch (error) {
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post("/pre-approvals/:id/approve", requireTenantRole("client"), async (request, response) => {
  try {
    const result = await approvePreApproval(routeParam(request.params.id), preApprovalActor(request), {
      idempotencyKey: idempotencyKeyFrom(request),
    });
    if (!result.wasAlreadyApproved) {
      await deliverNotification(
        notifyAdmins(notificationActor(request), {
        type: "pre_approval_approved",
        title: "Client approved pre-approval",
        body: `${result.preApproval.clientNameSnapshot} approved ${result.preApproval.title}.`,
        link: "/pre-approvals",
        metadata: { entityType: "pre-approval", entityId: result.preApproval.id },
      }),
      );
    }
    response.json({ preApproval: serializePreApproval(result.preApproval), duplicate: result.wasAlreadyApproved });
  } catch (error) {
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

  router.post("/pre-approvals/:id/receive-funds", requireTenantRole("admin"), async (request, response) => {
    try {
      const result = await receivePreApprovalFunds(routeParam(request.params.id), preApprovalActor(request), {
        idempotencyKey: request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key"),
      });
      response.json({ preApproval: serializePreApproval(result.preApproval), duplicate: result.wasAlreadyReceived });
    } catch (error) {
      if (handlePreApprovalServiceError(error, response)) {
        return;
    }
    throw error;
  }
});

router.post("/pre-approvals/:id/request-changes", requireTenantRole("client"), async (request, response) => {
  const parsed = preApprovalCommentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Please add a comment explaining the requested changes." });
    return;
  }

  try {
    const result = await requestPreApprovalChanges(routeParam(request.params.id), parsed.data.message, preApprovalActor(request), {
      idempotencyKey: idempotencyKeyFrom(request),
    });
    if (!result.wasAlreadyRequested) {
      await deliverNotification(
        notifyAdmins(notificationActor(request), {
        type: "pre_approval_changes_requested",
        title: "Client requested changes",
        body: `${result.preApproval.clientNameSnapshot} requested changes on ${result.preApproval.title}.`,
        link: "/pre-approvals",
        metadata: { entityType: "pre-approval", entityId: result.preApproval.id },
      }),
      );
    }
    response.json({ preApproval: serializePreApproval(result.preApproval), duplicate: result.wasAlreadyRequested });
  } catch (error) {
    if (handlePreApprovalServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

export default router;
