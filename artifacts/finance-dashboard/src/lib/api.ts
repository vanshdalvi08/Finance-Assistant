import {
  createAdminAccount,
  createClientAccount,
  createEmployeeAccount,
  deactivateAdminAccount,
  deactivateClientAccount,
  deactivateEmployeeAccount,
  listAdminAccounts,
  listClientAccounts,
  listEmployeeAccounts,
  updateAdminAccount,
  updateClientAccount,
  updateEmployeeAccount,
} from "@/auth/auth-service";
import { requestJson } from "@/auth/http-client";
import type { AuthUser } from "@/auth/types";

export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimesheetWorkNotes = Partial<Record<DayKey, string>>;
export type TimesheetDailyReviewStatus = Partial<Record<DayKey, "reviewed" | "reverted">>;
export type TimesheetDailyReviewNotes = Partial<Record<DayKey, string>>;
type TimeOffKind = "leave" | "holiday";

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone?: string;
  employeeId?: string;
  profilePhotoUrl?: string | null;
  role: string;
  department: string;
  salary: number;
  payType: "monthly" | "hourly";
  hourlyRate?: number;
  status: "Active" | "Inactive";
}

export interface ClientAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  website?: string;
  billingEmail?: string;
  status: "Active" | "Inactive";
  temporaryPassword?: string;
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  position?: string;
  department?: string;
  status: "Active" | "Inactive";
  temporaryPassword?: string;
}

export interface Salary {
  id: string;
  accountId?: string;
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
}

export interface FinancialAccount {
  id: string;
  name: string;
  accountType: "operational" | "personal" | "mixed_use" | "reserve" | "cash";
  category: "bank" | "cash" | "wallet" | "other";
  openingBalance: number;
  description?: string;
  includeInOperationalReporting: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialAccountBalance extends FinancialAccount {
  balance: number;
}

export interface Fund {
  id: string;
  accountId?: string;
  source: string;
  amount: number;
  date: string;
  note: string;
  receiptName?: string;
  receiptPath?: string;
  receiptUrl?: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  group: "personal" | "office";
}

export interface Expense {
  id: string;
  accountId?: string;
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
  attachmentUrl?: string;
  reimbursable?: boolean;
  status: ApprovalStatus;
  reviewerNote?: string;
}

export interface Transaction {
  id: string;
  type: "fund" | "salary" | "expense";
  amount: number;
  date: string;
  description: string;
  category: string;
  project?: string;
  accountId?: string;
  accountName?: string;
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
  dailyReviewNotes?: TimesheetDailyReviewNotes;
  lines: TimesheetTaskLine[];
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeNameSnapshot: string;
  startDate: string;
  endDate: string;
  reason?: string;
  kind?: TimeOffKind;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeavePolicy {
  annualLimit: number;
  period?: "monthly" | "quarterly" | "yearly";
  appliesTo?: "all" | "selected";
  employeeIds?: string[];
  updatedAt: string;
  updatedBy?: string;
}

export interface AuditTrailEntry {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  actorName: string;
  actorRole: "admin" | "employee" | "client" | "platform_super_admin" | "system";
  action: string;
  entityType:
    | "employee"
    | "expense"
    | "fund"
    | "financial-account"
    | "salary"
    | "timesheet"
    | "category"
    | "project-budget"
    | "purchase-order"
    | "purchase-order-task"
    | "pre-approval"
    | "pre-approval-comment"
    | "holiday"
    | "leave-request";
  entityId: string;
  summary: string;
  requestId?: string;
  details?: {
    entityLabel?: string;
    requestId?: string;
    changedFields?: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    context?: Record<string, unknown> | null;
  };
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  kind: "timesheet" | "expense" | "salary" | "purchase-order" | "employee" | "system";
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  readAt?: string | null;
  emailSentAt?: string | null;
  createdAt: string;
  link?: string;
}

export interface ProjectBudget {
  id: string;
  project: string;
  totalBudget: number;
  client?: string;
  note?: string;
  notes?: string;
  tasks: ProjectBudgetTask[];
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
  employeeHourLimits?: Array<{ employeeId: string; hours: number }>;
  subTasks?: string[];
  status: "active" | "archived";
  usedHours?: number;
  remainingHours?: number;
  utilisation?: number;
  hoursPerDay?: number;
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
  title: string;
  totalAmount: number;
  usedAmount: number;
  remainingAmount: number;
  vendor?: string;
  date: string;
  notes?: string;
  createdAt: string;
  tasks: PurchaseOrderTask[];
}

export type PreApprovalStatus = "draft" | "submitted" | "changes_requested" | "approved";

export interface PreApprovalTask {
  id: string;
  taskName: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

export interface PreApprovalComment {
  id: string;
  authorId?: string;
  authorName: string;
  authorRole: "admin" | "client";
  message: string;
  createdAt: string;
}

export interface PreApprovalPartyInfo {
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface PreApprovalProjectInfo {
  workDescription?: string;
  projectStartDate?: string;
  projectCompletionDate?: string;
  totalContractValue?: number;
  retainagePercent?: number;
  retainageAmount?: number;
  previouslyBilledAmount?: number;
}

export interface PreApproval {
  id: string;
  title: string;
  project: string;
  clientId: string;
  clientNameSnapshot: string;
  date: string;
  notes?: string;
  companyInfo?: PreApprovalPartyInfo;
  clientInfo?: PreApprovalPartyInfo;
  projectInfo?: PreApprovalProjectInfo;
  status: PreApprovalStatus;
  submittedAt?: string;
  approvedAt?: string;
  receivedAt?: string;
  receivedFundId?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  totalHours: number;
  totalAmount: number;
  tasks: PreApprovalTask[];
  comments: PreApprovalComment[];
}

interface CategoryInput {
  name: string;
  color: string;
  group: "personal" | "office";
  editId?: string;
}

interface AddFundInput {
  accountId?: string;
  source: string;
  amount: number;
  date: string;
  note?: string;
  receiptName?: string;
  receiptPath?: string;
}

interface AddSalaryInput {
  accountId?: string;
  employeeId: string;
  amount: number;
  note?: string;
  source?: "manual" | "timesheet";
  status?: "pending" | "paid";
  weekStart?: string;
  hours?: number;
  rate?: number;
  timesheetId?: string;
}

interface AddEmployeeInput {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  employeeId?: string;
  profilePhotoUrl?: string | null;
  role: string;
  department: string;
  salary: number;
  payType: "monthly" | "hourly";
  hourlyRate?: number;
  status: "Active" | "Inactive";
}

interface AddAdminInput {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  position?: string;
  department?: string;
  status?: "Active" | "Inactive";
}

interface UpdateAdminInput extends AddAdminInput {
  id: string;
}

interface UpdateEmployeeInput extends AddEmployeeInput {
  id: string;
}

interface AddExpenseInput {
  accountId?: string;
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
  status?: ApprovalStatus;
  reviewerNote?: string;
}

interface SaveProjectBudgetInput {
  id?: string;
  project: string;
  totalBudget: number;
  client?: string;
  note?: string;
  tasks?: Array<{
    id?: string;
    name: string;
    description?: string;
    maxHours?: number;
    startDate?: string;
    endDate?: string;
    durationDays?: number;
    hourLimitScope?: "overall" | "per_employee";
    employeeHourLimits?: Array<{ employeeId: string; hours: number }>;
    subTasks?: string[];
    status?: "active" | "archived";
  }>;
  actorName?: string;
}

interface CreatePurchaseOrderInput {
  title: string;
  totalAmount: number;
  vendor?: string;
  date: string;
  notes?: string;
  tasks?: Array<{
    taskName: string;
    description?: string;
    hours: number;
    rate: number;
  }>;
}

interface CreatePreApprovalInput {
  title: string;
  project: string;
  clientId: string;
  date: string;
  notes?: string;
  companyInfo?: PreApprovalPartyInfo;
  clientInfo?: PreApprovalPartyInfo;
  projectInfo?: PreApprovalProjectInfo;
  tasks?: Array<{
    taskName: string;
    description?: string;
    hours: number;
    rate: number;
  }>;
}

export interface AdminOverview {
  totalFunds: number;
  totalExpenses: number;
  totalSalaryPaid: number;
  activeEmployees: number;
  currentBalance: number;
  allAccountsBalance: number;
  operationalBalance: number;
  financialAccounts: FinancialAccountBalance[];
  pendingExpenses: number;
  pendingTimesheets: number;
  monthToDateFunds: number;
  monthToDateExpenses: number;
  yearToDateFunds: number;
  yearToDateExpenses: number;
}

export interface PlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  userCount: number;
  adminCount: number;
  employeeCount: number;
  clientCount: number;
  platformAdminCount: number;
  lastActivityAt: string;
  isPlatformTenant?: boolean;
}

export interface PlatformEvent {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  severity: "info" | "warning" | "error";
  category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  title: string;
  message: string;
  path?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  fingerprint?: string;
  acknowledgedAt?: string;
  acknowledgedByUserId?: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  delivery?: PlatformEventDelivery | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformEventDelivery {
  state: "delivered" | "failed" | "suppressed" | "pending" | "unknown";
  provider?: string | null;
  destination?: string | null;
  attemptedAt?: string | null;
  deliveredAt?: string | null;
  failedAt?: string | null;
  statusCode?: number | null;
  attempts?: number | null;
  reason?: string | null;
  error?: string | null;
}

export interface PlatformExternalAlertRetryResult {
  eventId: string;
  status: "retried" | "skipped" | "not_found";
  reason?: "event_not_found" | "legacy_mode_unsupported" | "not_failed" | "internal_failure_event" | "dispatch_error";
  previousState?: PlatformEventDelivery["state"];
  nextState?: PlatformEventDelivery["state"];
  title?: string;
}

export interface RetryFailedPlatformExternalAlertsResult {
  dryRun: boolean;
  limit: number;
  candidateCount: number;
  retried: number;
  delivered: number;
  failed: number;
  suppressed: number;
  skipped: number;
  results: PlatformExternalAlertRetryResult[];
}

export interface PlatformOverview {
  totalTenants: number;
  activeTenants: number;
  inactiveTenants: number;
  totalUsers: number;
  platformAdmins: number;
  tenantUsers: number;
  errorCount: number;
  slowRequestCount: number;
  incidentWorkflowSupported?: boolean;
  recentEvents: PlatformEvent[];
  tenants: PlatformTenantSummary[];
}

export interface PlatformMonitoringResponse {
  events: PlatformEvent[];
  summary: Record<"info" | "warning" | "error", number>;
  categorySummary: Record<"request" | "auth" | "database" | "upload" | "tenant" | "system", number>;
  stateSummary: Record<"open" | "acknowledged" | "resolved", number>;
  externalAlertSummary: Record<
    "delivered" | "failed" | "skipped" | "notConfigured" | "belowMinSeverity" | "cooldownActive" | "unknown",
    number
  >;
  externalAlerting: {
    enabled: boolean;
    provider: "webhook";
    endpoint: string | null;
    minSeverity: "info" | "warning" | "error";
    cooldownMs: number;
  };
  workflowSupported?: boolean;
  appliedFilters: {
    severity: PlatformEvent["severity"] | null;
    category: PlatformEvent["category"] | null;
    tenantId: string | null;
    state: "open" | "acknowledged" | "resolved" | "all";
    search: string | null;
    from: string | null;
    to: string | null;
    limit: number;
  };
}

export interface PlatformAdminSummary {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: "platform_super_admin";
  status: "active" | "inactive";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSettingsResponse {
  platformTenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
    createdAt: string;
    updatedAt: string;
  } | null;
  platformAdmins: PlatformAdminSummary[];
  operationalDefaults: {
    supportEmail: string;
    incidentLatencyThresholdMs: number;
    monitoringWindowSize: number;
    hardeningTier: string;
    auditRetention: string;
    externalMonitoring: {
      enabled: boolean;
      provider: "webhook";
      endpoint: string | null;
      minSeverity: "info" | "warning" | "error";
      cooldownMs: number;
    };
    backupRecovery: {
      strategy: string;
      frequency: string;
      retentionDays: number;
      storage: string;
      runbookUrl: string;
      lastRecoveryDrillDate: string | null;
    };
    retention: {
      platformEvents: {
        supported: boolean;
        mode: "manual";
        unresolvedRetention: "indefinite";
        excludedSources: string[];
        resolvedRetentionDays: {
          info: number;
          warning: number;
          error: number;
        };
        stats: {
          totalEvents: number;
          openEvents: number;
          acknowledgedEvents: number;
          resolvedEvents: number;
          pruneEligibleTotal: number;
          pruneEligibleBySeverity: {
            info: number;
            warning: number;
            error: number;
          };
          oldestEventAt: string | null;
          newestEventAt: string | null;
        };
        latestPruneRun: {
          at: string;
          deletedCount: number;
          limit: number;
          actorUserId?: string;
        } | null;
      };
      auditTrail: {
        mode: "protected";
        destructivePruningEnabled: boolean;
        defaultRetentionDays: number;
        stats: {
          totalEntries: number;
          oldestEntryAt: string | null;
          newestEntryAt: string | null;
          estimatedEligibleEntries: number;
        };
        note: string;
      };
    };
  };
}

export interface PlatformRetentionPruneResult {
  supported: boolean;
  dryRun: boolean;
  limit: number;
  deletedCount: number;
  eligibleCount: number;
  retainedAuditEntries: number;
  preview: PlatformSettingsResponse["operationalDefaults"]["retention"];
}

export interface PlatformRecoveryDrill {
  id: string;
  type: "tabletop" | "restore" | "failover" | "backup-validation" | "other";
  title: string;
  scope: "platform" | "tenant" | "database" | "storage" | "service";
  status: "passed" | "partial" | "failed";
  summary: string;
  notes?: string;
  durationMinutes?: number;
  tenantId?: string;
  actorUserId?: string;
  performedAt: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface CreatePlatformRecoveryDrillInput {
  type?: PlatformRecoveryDrill["type"];
  title?: string;
  scope?: PlatformRecoveryDrill["scope"];
  status: PlatformRecoveryDrill["status"];
  summary: string;
  notes?: string;
  durationMinutes?: number;
  tenantId?: string;
  performedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount?: number;
}

export interface ChartPoint {
  month: string;
  funds: number;
  expenses: number;
  salary: number;
}

export interface MonthCalendarDay {
  date: string;
  day: number;
  isWeekend: boolean;
  worked: boolean;
  leave: boolean;
  leaveStatus?: "pending" | "approved" | "rejected";
  holiday: boolean;
  holidayName?: string;
  leaveReason?: string;
  timeOffKind?: TimeOffKind;
  timeOffSource?: "admin" | "employee";
  timeOffRequestId?: string;
  pendingLeave?: boolean;
  pendingHoliday?: boolean;
  holidaySource?: "company" | "requested";
  hours: number;
  expenseCount: number;
}

export interface MonthCalendar {
  month: string;
  monthLabel: string;
  summary: {
    annualLeaveLimit?: number;
    approvedLeaveDaysYear?: number;
    pendingLeaveDaysYear?: number;
    remainingLeaveDaysYear?: number;
    daysWorked: number;
    hoursLogged: number;
    leaveDays: number;
    holidayDays: number;
    companyHolidayDays?: number;
    requestedHolidayDays?: number;
    pendingLeaveDays: number;
    pendingHolidayDays?: number;
    expenseSubmissions: number;
  };
  days: MonthCalendarDay[];
}

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function blankHours(): Record<DayKey, number> {
  return { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
}

function startOfWeek(baseDate = new Date()) {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date;
}

function normalizeWeekStart(weekStart?: string) {
  return startOfWeek(weekStart ? new Date(weekStart) : new Date()).toISOString();
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim()) {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function sumTimesheetHours(entry: TimesheetEntry) {
  return entry.lines.reduce(
    (sum, line) =>
      sum +
      (Number(line.hours.mon ?? 0) +
        Number(line.hours.tue ?? 0) +
        Number(line.hours.wed ?? 0) +
        Number(line.hours.thu ?? 0) +
        Number(line.hours.fri ?? 0) +
        Number(line.hours.sat ?? 0) +
        Number(line.hours.sun ?? 0)),
    0,
  );
}

function mapAuthUserToEmployee(user: AuthUser): Employee {
  return {
    id: user.id,
    name: user.name ?? user.email.split("@")[0],
    email: user.email,
    phone: user.phone ?? "",
    employeeId: user.employeeId ?? undefined,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    role: user.position ?? "Employee",
    department: user.department ?? "General",
    salary: Number(user.salary ?? 0),
    payType: user.payType ?? ((user.hourlyRate ?? 0) > 0 ? "hourly" : "monthly"),
    hourlyRate: user.hourlyRate ?? undefined,
    status: user.status === "inactive" ? "Inactive" : "Active",
  };
}

function mapAuthUserToClient(user: AuthUser): ClientAccount {
  return {
    id: user.id,
    name: user.name ?? user.email.split("@")[0],
    email: user.email,
    phone: user.phone ?? "",
    company: user.department ?? "",
    address: user.clientInfo?.address ?? "",
    website: user.clientInfo?.website ?? "",
    billingEmail: user.clientInfo?.email ?? user.email,
    status: user.status === "inactive" ? "Inactive" : "Active",
  };
}

function mapAuthUserToAdmin(user: AuthUser): AdminAccount {
  return {
    id: user.id,
    name: user.name ?? user.email.split("@")[0],
    email: user.email,
    phone: user.phone ?? "",
    position: user.position ?? "Administrator",
    department: user.department ?? "Operations",
    status: user.status === "inactive" ? "Inactive" : "Active",
  };
}

function normalizeTimesheet(entry: TimesheetEntry): TimesheetEntry {
  return {
    ...entry,
    weekStart: normalizeWeekStart(entry.weekStart),
    dailyReviewStatus: Object.fromEntries(
      Object.entries(entry.dailyReviewStatus ?? {}).filter(([, value]) => value === "reviewed" || value === "reverted"),
    ) as TimesheetDailyReviewStatus,
    dailyReviewNotes: Object.fromEntries(
      Object.entries(entry.dailyReviewNotes ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
    ) as TimesheetDailyReviewNotes,
    lines: (entry.lines.length ? entry.lines : [{ id: createId("line"), project: "", task: "", subTask: "", notes: "", workNotes: {}, hours: blankHours() }]).map((line) => ({
      ...line,
      id: line.id || createId("line"),
      notes: line.notes ?? "",
      subTask: line.subTask ?? "",
      workNotes: Object.fromEntries(
        Object.entries(line.workNotes ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
      ) as TimesheetWorkNotes,
      hours: { ...blankHours(), ...line.hours },
    })),
  };
}

function normalizeProjectBudget(project: ProjectBudget): ProjectBudget {
  return {
    ...project,
    note: project.note ?? project.notes ?? "",
    notes: project.notes ?? project.note ?? "",
    tasks: (project.tasks ?? []).map((task) => ({
      ...task,
      employeeHourLimits: Array.isArray(task.employeeHourLimits)
        ? task.employeeHourLimits
            .map((limit) => ({
              employeeId: String(limit.employeeId ?? "").trim(),
              hours: Number(limit.hours ?? 0),
            }))
            .filter((limit) => limit.employeeId && Number.isFinite(limit.hours) && limit.hours > 0)
        : [],
    })),
  };
}

export interface SaveFinancialAccountInput {
  id?: string;
  name: string;
  accountType: FinancialAccount["accountType"];
  category: FinancialAccount["category"];
  openingBalance: number;
  description?: string;
  includeInOperationalReporting?: boolean;
  isActive?: boolean;
}

const TIME_OFF_STORAGE_KEY = "finance.assistant.time-off";

interface LocalTimeOffStore {
  holidays: Holiday[];
  leaveRequests: LeaveRequest[];
  leavePolicy?: LeavePolicy;
}

function normalizeLeavePolicy(input?: Partial<LeavePolicy> | null): LeavePolicy {
  return {
    annualLimit: Math.max(0, Math.round(Number(input?.annualLimit ?? 10))),
    period: input?.period === "monthly" || input?.period === "quarterly" || input?.period === "yearly" ? input.period : "yearly",
    appliesTo: input?.appliesTo === "selected" ? "selected" : "all",
    employeeIds:
      input?.appliesTo === "selected"
        ? Array.from(
            new Set(
              Array.isArray(input.employeeIds)
                ? input.employeeIds.map((employeeId) => employeeId?.trim()).filter((employeeId): employeeId is string => Boolean(employeeId))
                : [],
            ),
          )
        : [],
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
    updatedBy: typeof input?.updatedBy === "string" ? input.updatedBy : undefined,
  };
}

function leavePolicyAppliesToEmployee(policy: LeavePolicy, employeeId?: string) {
  if (policy.appliesTo !== "selected") {
    return true;
  }

  return Boolean(employeeId && policy.employeeIds?.includes(employeeId));
}

function effectiveLeavePolicy(policy: LeavePolicy, employeeId?: string) {
  return leavePolicyAppliesToEmployee(policy, employeeId) ? policy : normalizeLeavePolicy();
}

function leavePolicyWindowForDate(date: string, period: LeavePolicy["period"]) {
  const target = new Date(`${date.slice(0, 10)}T12:00:00.000Z`);
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();

  if (period === "monthly") {
    return {
      startDate: new Date(Date.UTC(year, month, 1, 12, 0, 0, 0)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)).toISOString().slice(0, 10),
    };
  }

  if (period === "quarterly") {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return {
      startDate: new Date(Date.UTC(year, quarterStartMonth, 1, 12, 0, 0, 0)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, quarterStartMonth + 3, 0, 12, 0, 0, 0)).toISOString().slice(0, 10),
    };
  }

  return {
    startDate: new Date(Date.UTC(year, 0, 1, 12, 0, 0, 0)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, 12, 0, 12, 0, 0, 0)).toISOString().slice(0, 10),
  };
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocalTimeOffStore(): LocalTimeOffStore {
  if (!canUseLocalStorage()) {
    return { holidays: [], leaveRequests: [] };
  }

  try {
    const raw = window.localStorage.getItem(TIME_OFF_STORAGE_KEY);
    if (!raw) {
      return { holidays: [], leaveRequests: [] };
    }

    const parsed = JSON.parse(raw) as Partial<LocalTimeOffStore>;
  return {
    holidays: Array.isArray(parsed.holidays) ? parsed.holidays : [],
    leaveRequests: Array.isArray(parsed.leaveRequests) ? parsed.leaveRequests : [],
    leavePolicy: parsed.leavePolicy ? normalizeLeavePolicy(parsed.leavePolicy) : undefined,
  };
  } catch {
    return { holidays: [], leaveRequests: [] };
  }
}

function writeLocalTimeOffStore(store: LocalTimeOffStore) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(TIME_OFF_STORAGE_KEY, JSON.stringify(store));
}

function normalizeIsoDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function createLocalHoliday(input: { date: string; name: string }): Holiday {
  const now = new Date().toISOString();
  return {
    id: createId("hol"),
    date: new Date(input.date).toISOString(),
    name: input.name.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function createLocalLeaveRequest(input: {
  employeeId?: string;
  employeeNameSnapshot?: string;
  startDate: string;
  endDate: string;
  reason?: string;
  kind?: TimeOffKind;
}): LeaveRequest {
  const now = new Date().toISOString();
  return {
    id: createId("lr"),
    employeeId: input.employeeId?.trim() || "unknown",
    employeeNameSnapshot: input.employeeNameSnapshot?.trim() || "Employee",
    startDate: new Date(input.startDate).toISOString(),
    endDate: new Date(input.endDate).toISOString(),
    reason: input.reason?.trim() || undefined,
    kind: input.kind ?? "leave",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function updateLocalTimeOffStore(mutator: (store: LocalTimeOffStore) => LocalTimeOffStore) {
  const current = readLocalTimeOffStore();
  const next = mutator({
    holidays: [...current.holidays],
    leaveRequests: [...current.leaveRequests],
  });
  writeLocalTimeOffStore(next);
  return next;
}

function dayRange(startDate: string, endDate: string) {
  const start = new Date(normalizeIsoDate(startDate));
  const end = new Date(normalizeIsoDate(endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return [] as string[];
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function isMissingRoute(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404);
}

async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>) {
  try {
    return await primary();
  } catch (error) {
    if (isMissingRoute(error)) {
      return fallback();
    }

    throw error;
  }
}

async function fallbackGetHolidays(scope?: { month?: string }) {
  const store = readLocalTimeOffStore();
  const holidays = scope?.month ? store.holidays.filter((holiday) => holiday.date.slice(0, 7) === scope.month) : store.holidays;
  return holidays.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

async function fallbackAddHoliday(input: { date: string; name: string }) {
  const holiday = createLocalHoliday(input);
  updateLocalTimeOffStore((store) => ({
    ...store,
    holidays: [holiday, ...store.holidays.filter((item) => normalizeIsoDate(item.date) !== normalizeIsoDate(holiday.date))],
  }));
  return holiday;
}

async function fallbackDeleteHoliday(id: string) {
  updateLocalTimeOffStore((store) => ({
    ...store,
    holidays: store.holidays.filter((holiday) => holiday.id !== id),
  }));
}

async function fallbackGetLeaveRequests(scope?: { employeeId?: string; month?: string; status?: LeaveRequest["status"] | "all" }) {
  const store = readLocalTimeOffStore();
  const requests = store.leaveRequests.filter((leaveRequest) => {
    if (scope?.employeeId && leaveRequest.employeeId !== scope.employeeId) {
      return false;
    }

    if (scope?.month && !(leaveRequest.startDate.slice(0, 7) <= scope.month && leaveRequest.endDate.slice(0, 7) >= scope.month)) {
      return false;
    }

    if (scope?.status && scope.status !== "all" && leaveRequest.status !== scope.status) {
      return false;
    }

    return true;
  });

  return requests.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function fallbackCreateLeaveRequest(input: { employeeId?: string; startDate: string; endDate: string; reason?: string; kind?: TimeOffKind }) {
  const currentUser = await getCurrentAuthUser().catch(() => null);
  const request = createLocalLeaveRequest({
    ...input,
    employeeId: input.employeeId ?? currentUser?.id,
    employeeNameSnapshot: currentUser?.name ?? currentUser?.email?.split("@")[0] ?? "Employee",
  });
  updateLocalTimeOffStore((store) => ({
    ...store,
    leaveRequests: [request, ...store.leaveRequests.filter((item) => item.id !== request.id)],
  }));
  return request;
}

async function fallbackUpdateLeaveRequestStatus(id: string, input: { status: "approved" | "rejected"; reviewNote?: string }) {
  let updated: LeaveRequest | null = null;
  updateLocalTimeOffStore((store) => {
    const nextLeaveRequests = store.leaveRequests.map((leaveRequest) => {
      if (leaveRequest.id !== id) {
        return leaveRequest;
      }

      updated = {
        ...leaveRequest,
        status: input.status,
        reviewNote: input.reviewNote?.trim() || undefined,
        reviewedAt: new Date().toISOString(),
        reviewedBy: "admin",
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });

    return {
      ...store,
      leaveRequests: nextLeaveRequests,
    };
  });

  if (!updated) {
    throw new Error("Leave request not found");
  }

  return updated;
}

async function fallbackDeleteLeaveRequest(id: string) {
  updateLocalTimeOffStore((store) => ({
    ...store,
    leaveRequests: store.leaveRequests.filter((request) => request.id !== id),
  }));
}

async function fallbackGetEmployeeMonthCalendar({ employeeId, month }: { employeeId: string; month: string }) {
  const [timesheets, expenses, holidays, leaveRequests, leavePolicy] = await Promise.all([
    api.getTimesheets({ employeeId }).catch(() => [] as TimesheetEntry[]),
    api.getExpenses({ employeeId }).catch(() => [] as Expense[]),
    fallbackGetHolidays({ month }),
    fallbackGetLeaveRequests({ employeeId, status: "all" }),
    fallbackGetLeavePolicy(),
  ]);
  const employeeLeavePolicy = effectiveLeavePolicy(leavePolicy, employeeId);

  const [yearString, monthString] = month.split("-");
  const year = Number(yearString);
  const monthIndex = Number(monthString) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const daily = new Map<string, { hours: number; expenseCount: number }>();
  for (const entry of timesheets.filter((item) => item.employeeId === employeeId && item.weekStart.slice(0, 7) <= month)) {
    const weekStart = new Date(entry.weekStart);
    entry.lines.forEach((line) => {
      DAY_KEYS.forEach((dayKey, offset) => {
        const amount = Number(line.hours[dayKey] ?? 0);
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

  for (const expense of expenses.filter((item) => item.employeeId === employeeId && item.date.slice(0, 7) === month)) {
    const iso = normalizeIsoDate(expense.date);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    bucket.expenseCount += 1;
    daily.set(iso, bucket);
  }

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = new Date(year, monthIndex, dayNumber, 12, 0, 0, 0);
    const iso = date.toISOString().slice(0, 10);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    const holiday = holidays.find((item) => normalizeIsoDate(item.date) === iso);
    const leaveRequest = leaveRequests.find((item) => dayRange(item.startDate, item.endDate).includes(iso));
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const worked = bucket.hours > 0;
    const isHoliday = Boolean(holiday || (leaveRequest?.kind === "holiday" && leaveRequest.status !== "rejected"));
    const isLeave = Boolean(leaveRequest && leaveRequest.kind !== "holiday" && leaveRequest.status === "approved");
    const isPending = Boolean(leaveRequest && leaveRequest.status === "pending");

    return {
      date: `${iso}T12:00:00.000Z`,
      day: dayNumber,
      isWeekend,
      worked,
      leave: isLeave,
      leaveStatus: leaveRequest?.status,
      holiday: isHoliday,
      holidayName: holiday?.name ?? (leaveRequest?.kind === "holiday" ? leaveRequest.reason || "Holiday" : undefined),
      leaveReason: leaveRequest?.reason,
      timeOffKind: leaveRequest?.kind,
      timeOffSource: holiday ? "admin" : leaveRequest ? "employee" : undefined,
      timeOffRequestId: leaveRequest?.id,
      pendingLeave: isPending && !isHoliday,
      hours: Number(bucket.hours.toFixed(1)),
      expenseCount: bucket.expenseCount,
    } satisfies MonthCalendarDay;
  });

  const summary = days.reduce(
    (acc, day) => {
      if (day.worked) acc.daysWorked += 1;
      if (day.leave) acc.leaveDays += 1;
      if (day.holiday) acc.holidayDays += 1;
      if (day.pendingLeave) acc.pendingLeaveDays += 1;
      acc.hoursLogged += day.hours;
      acc.expenseSubmissions += day.expenseCount;
      return acc;
    },
    {
      daysWorked: 0,
      leaveDays: 0,
      holidayDays: 0,
      pendingLeaveDays: 0,
      hoursLogged: 0,
      expenseSubmissions: 0,
    },
  );
  const policyWindow = leavePolicyWindowForDate(`${month}-01`, employeeLeavePolicy.period);
  const approvedLeaveDaysInCycle = leaveRequests
    .filter((request) => request.kind !== "holiday" && request.status === "approved")
    .reduce(
      (sum, request) =>
        sum +
        dayRange(request.startDate, request.endDate).filter((day) => day >= policyWindow.startDate && day <= policyWindow.endDate).length,
      0,
    );
  const pendingLeaveDaysInCycle = leaveRequests
    .filter((request) => request.kind !== "holiday" && request.status === "pending")
    .reduce(
      (sum, request) =>
        sum +
        dayRange(request.startDate, request.endDate).filter((day) => day >= policyWindow.startDate && day <= policyWindow.endDate).length,
      0,
    );
  const annualLeaveLimit = Math.max(0, Number(employeeLeavePolicy.annualLimit ?? 0));

  return {
    month,
    monthLabel: new Date(`${month}-01T00:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" }),
    summary: {
      annualLeaveLimit,
      approvedLeaveDaysYear: approvedLeaveDaysInCycle,
      pendingLeaveDaysYear: pendingLeaveDaysInCycle,
      remainingLeaveDaysYear: Math.max(0, annualLeaveLimit - approvedLeaveDaysInCycle - pendingLeaveDaysInCycle),
      ...summary,
      hoursLogged: Number(summary.hoursLogged.toFixed(1)),
    },
    days,
  } satisfies MonthCalendar;
}

async function fallbackGetLeavePolicy() {
  const store = readLocalTimeOffStore();
  return normalizeLeavePolicy(store.leavePolicy);
}

async function fallbackUpdateLeavePolicy(input: { annualLimit: number; period?: LeavePolicy["period"]; appliesTo?: LeavePolicy["appliesTo"]; employeeIds?: string[]; updatedBy?: string }) {
  const policy: LeavePolicy = normalizeLeavePolicy({
    annualLimit: input.annualLimit,
    period: input.period,
    appliesTo: input.appliesTo,
    employeeIds: input.employeeIds,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy?.trim() || undefined,
  });

  updateLocalTimeOffStore((store) => ({
    ...store,
    leavePolicy: policy,
  }));

  return policy;
}

async function getCurrentAuthUser() {
  const response = await requestJson<{ user: AuthUser | null }>("/auth/me");
  return response.user;
}

async function businessGet<T>(path: string) {
  return requestJson<T>(`/business${path}`);
}

async function businessPost<T>(path: string, data?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
  return requestJson<T>(`/business${path}`, {
    method,
    data,
  });
}

async function platformGet<T>(path: string) {
  return requestJson<T>(`/platform${path}`);
}

async function platformPost<T>(path: string, data?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
  return requestJson<T>(`/platform${path}`, {
    method,
    data,
  });
}

async function uploadBinary<T>(path: string, file: File) {
  return requestJson<T>(path, {
    method: "POST",
    data: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
  });
}

export const api = {
  uploadProfilePhoto: async (file: File) =>
    uploadBinary<{ fileName: string; path: string; url: string }>("/uploads/profile-photo", file),

  uploadExpenseAttachment: async (file: File) =>
    uploadBinary<{ fileName: string; path: string; url: string }>("/uploads/expense-attachment", file),

  getEmployees: async () => {
    const result = await listEmployeeAccounts();
    return result.employees
      .filter((employee) => employee.role === "employee")
      .map(mapAuthUserToEmployee)
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  getEmployeeProfile: async (scope: { employeeId?: string; email?: string }) => {
    const current = await getCurrentAuthUser();
    if (current && (!scope.employeeId || current.id === scope.employeeId || current.email === scope.email)) {
      return mapAuthUserToEmployee(current);
    }

    const employees = await api.getEmployees();
    return employees.find((employee) => employee.id === scope.employeeId || employee.email === scope.email) ?? null;
  },

  ensureEmployeeProfile: async (input: {
    id: string;
    email: string;
    name: string;
    phone?: string;
    employeeId?: string;
    profilePhotoUrl?: string;
    role?: string;
    department?: string;
    salary?: number;
    payType?: "monthly" | "hourly";
    hourlyRate?: number;
    status?: "Active" | "Inactive" | "active" | "inactive";
  }) => {
    const existing = await api.getEmployeeProfile({ employeeId: input.id, email: input.email });
    if (existing) {
      return existing;
    }

    return {
      id: input.id,
      name: input.name,
      email: input.email,
      phone: input.phone ?? "",
      employeeId: input.employeeId,
      profilePhotoUrl: input.profilePhotoUrl ?? null,
      role: input.role ?? "Employee",
      department: input.department ?? "General",
      salary: input.salary ?? 0,
      payType: input.payType ?? "monthly",
      hourlyRate: input.hourlyRate,
      status: input.status === "inactive" || input.status === "Inactive" ? "Inactive" : "Active",
    };
  },

  syncEmployeeAccounts: async (employees: AuthUser[]) => employees.filter((item) => item.role === "employee").map(mapAuthUserToEmployee),
  syncEmployeeAccount: async (employee: AuthUser) => mapAuthUserToEmployee(employee),

  getClients: async () => {
    const result = await listClientAccounts();
    return result.clients
      .filter((client) => client.role === "client")
      .map(mapAuthUserToClient)
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  getAdmins: async () => {
    const result = await listAdminAccounts();
    return result.admins
      .filter((admin) => admin.role === "admin")
      .map(mapAuthUserToAdmin)
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  addClient: async (input: {
    name: string;
    email: string;
    phone: string;
    company?: string;
    address?: string;
    website?: string;
    billingEmail?: string;
    status?: "Active" | "Inactive";
  }) => {
    const result = await createClientAccount({
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      address: input.address,
      website: input.website,
      billingEmail: input.billingEmail,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return {
      ...mapAuthUserToClient(result.user),
      temporaryPassword: result.temporaryPassword,
    };
  },

  updateClient: async (input: {
    id: string;
    name: string;
    email: string;
    phone: string;
    company?: string;
    address?: string;
    website?: string;
    billingEmail?: string;
    status?: "Active" | "Inactive";
  }) => {
    const result = await updateClientAccount({
      id: input.id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      address: input.address,
      website: input.website,
      billingEmail: input.billingEmail,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return mapAuthUserToClient(result.user);
  },

  deleteClient: async (id: string) => {
    await deactivateClientAccount(id);
  },

  addAdmin: async (input: AddAdminInput) => {
    const result = await createAdminAccount({
      name: input.name,
      email: input.email,
      phone: input.phone ?? "",
      position: input.position,
      department: input.department,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return {
      ...mapAuthUserToAdmin(result.user),
      temporaryPassword: result.temporaryPassword,
    };
  },

  updateAdmin: async (input: UpdateAdminInput) => {
    const result = await updateAdminAccount({
      id: input.id,
      name: input.name,
      email: input.email,
      phone: input.phone ?? "",
      position: input.position,
      department: input.department,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return mapAuthUserToAdmin(result.user);
  },

  deleteAdmin: async (id: string) => {
    await deactivateAdminAccount(id);
  },

  addEmployee: async (input: AddEmployeeInput) => {
    const result = await createEmployeeAccount({
      name: input.name,
      email: input.email,
      phone: input.phone ?? "",
      position: input.role,
      salary: input.salary,
      payType: input.payType,
      hourlyRate: input.hourlyRate,
      profilePhotoUrl: input.profilePhotoUrl,
      department: input.department,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return mapAuthUserToEmployee(result.user);
  },

  updateEmployee: async (input: UpdateEmployeeInput) => {
    const current = await getCurrentAuthUser();
    if (current?.id === input.id && current.role === "employee") {
      const me = await getCurrentAuthUser();
      if (!me) {
        throw new Error("Employee profile not found.");
      }
      return mapAuthUserToEmployee({
        ...me,
        name: input.name,
        email: input.email,
        phone: input.phone,
        position: input.role,
        department: input.department,
        profilePhotoUrl: input.profilePhotoUrl ?? me.profilePhotoUrl,
      });
    }

    const result = await updateEmployeeAccount({
      id: input.id,
      name: input.name,
      email: input.email,
      phone: input.phone ?? "",
      position: input.role,
      salary: input.salary,
      payType: input.payType,
      hourlyRate: input.hourlyRate,
      profilePhotoUrl: input.profilePhotoUrl,
      department: input.department,
      status: input.status === "Inactive" ? "inactive" : "active",
    });

    return mapAuthUserToEmployee(result.user);
  },

  deleteEmployee: async (id: string) => {
    const [expenses, salaries, timesheets] = await Promise.all([
      api.getExpenses({ employeeId: id }),
      api.getSalaries({ employeeId: id }),
      api.getTimesheets({ employeeId: id }),
    ]);

    await Promise.all([
      ...expenses.map((expense) => businessPost<void>(`/expenses/${expense.id}`, undefined, "DELETE")),
      ...salaries.map((salary) => businessPost<void>(`/salaries/${salary.id}`, undefined, "DELETE")),
      ...timesheets.map((timesheet) => businessPost<void>(`/timesheets/${timesheet.id}`, undefined, "DELETE")),
    ]);

    await deactivateEmployeeAccount(id);
  },

  getFunds: async () => (await businessGet<{ funds: Fund[] }>("/funds")).funds,

  getFinancialAccounts: async () => (await businessGet<{ accounts: FinancialAccount[] }>("/financial-accounts")).accounts,

  saveFinancialAccount: async (input: SaveFinancialAccountInput) => {
    if (input.id) {
      return (await businessPost<{ account: FinancialAccount }>(`/financial-accounts/${input.id}`, input, "PATCH")).account;
    }

    return (await businessPost<{ account: FinancialAccount }>("/financial-accounts", input)).account;
  },

  addFund: async (input: AddFundInput) =>
    (await businessPost<{ fund: Fund }>("/funds", input)).fund,

  deleteFund: async (id: string) =>
    businessPost<void>(`/funds/${id}`, undefined, "DELETE"),

  getCategories: async () => (await businessGet<{ categories: ExpenseCategory[] }>("/categories")).categories,

  getExpenseCategories: async (group?: "personal" | "office") => {
    const categories = await api.getCategories();
    return group ? categories.filter((category) => category.group === group) : categories;
  },

  saveCategory: async (input: CategoryInput) => {
    const payload = {
      id: input.editId,
      name: input.name,
      color: input.color,
      group: input.group,
    };

    if (input.editId) {
      return (await businessPost<{ category: ExpenseCategory }>(`/categories/${input.editId}`, payload, "PATCH")).category;
    }

    return (await businessPost<{ category: ExpenseCategory }>("/categories", payload)).category;
  },

  deleteCategory: async (id: string) => {
    await businessPost<void>(`/categories/${id}`, undefined, "DELETE");
  },

  getExpenses: async (scope?: { employeeId?: string; status?: ApprovalStatus }) => {
    const path = withQuery("/expenses", {
      employeeId: scope?.employeeId,
      status: scope?.status,
    });
    return (await businessGet<{ expenses: Expense[] }>(path)).expenses;
  },

  addExpense: async (input: AddExpenseInput) =>
    (await businessPost<{ expense: Expense }>("/expenses", input)).expense,

  updateExpenseStatus: async (id: string, status: ApprovalStatus, reviewerNote?: string, accountId?: string) =>
    (await businessPost<{ expense: Expense }>(`/expenses/${id}/status`, { status, reviewerNote, accountId }, "PATCH")).expense,

  getSalaries: (async (...args: [{ employeeId?: string }?]) => {
    const scope = args[0];
    const path = withQuery("/salaries", { employeeId: scope?.employeeId });
    return (await businessGet<{ salaries: Salary[] }>(path)).salaries;
  }) as {
    (): Promise<Salary[]>;
    (scope: { employeeId?: string }): Promise<Salary[]>;
  },

  getSalarySlips: async (scope: { employeeId: string } | string) =>
    api.getSalaries({ employeeId: typeof scope === "string" ? scope : scope.employeeId }),

  addSalary: async (input: AddSalaryInput) =>
    (await businessPost<{ salary: Salary }>("/salaries", {
      ...input,
      date: input.weekStart ?? new Date().toISOString(),
      note: input.note ?? "",
    })).salary,

  paySalaryRecord: async (id: string, input?: { note?: string; accountId?: string }) =>
    (await businessPost<{ salary: Salary }>(`/salaries/${id}/pay`, input ?? {})).salary,

  getTimesheets: async (scope?: { employeeId?: string }) => {
    const path = withQuery("/timesheets", { employeeId: scope?.employeeId });
    return (await businessGet<{ timesheets: TimesheetEntry[] }>(path)).timesheets.map(normalizeTimesheet);
  },

  getTimesheetByWeek: async (employeeId: string, weekStart: string) => {
    const path = withQuery("/timesheets/by-week", { employeeId, weekStart: normalizeWeekStart(weekStart) });
    const result = await businessGet<{ timesheet: TimesheetEntry | null }>(path);
    return result.timesheet ? normalizeTimesheet(result.timesheet) : null;
  },

  createTimesheetDraft: async (input: {
    employeeId: string;
    employeeNameSnapshot: string;
    weekStart?: string;
  }) => {
    const existing = await api.getTimesheetByWeek(input.employeeId, input.weekStart ?? new Date().toISOString());
    if (existing) {
      return existing;
    }

    return {
      id: createId("ts"),
      employeeId: input.employeeId,
      employeeNameSnapshot: input.employeeNameSnapshot,
      weekStart: normalizeWeekStart(input.weekStart),
      status: "draft" as const,
      lines: [
        {
          id: createId("line"),
          project: "",
          task: "",
          projectBudgetId: undefined,
          projectTaskId: undefined,
          subTask: "",
          notes: "",
          workNotes: {},
          hours: blankHours(),
        },
      ],
    };
  },

  saveTimesheet: async (entry: TimesheetEntry) =>
    normalizeTimesheet((await businessPost<{ timesheet: TimesheetEntry }>("/timesheets", normalizeTimesheet(entry))).timesheet),

  setTimesheetDayReviewStatus: async (id: string, day: DayKey, reviewed: boolean, note?: string) =>
    normalizeTimesheet(
      (await businessPost<{ timesheet: TimesheetEntry }>(`/timesheets/${id}/daily-review/${day}`, { reviewed, note }, "PATCH")).timesheet,
    ),

  submitTimesheetEntry: async (entry: TimesheetEntry) =>
    normalizeTimesheet(
      (await businessPost<{ timesheet: TimesheetEntry }>("/timesheets/submit", normalizeTimesheet(entry))).timesheet,
    ),

  submitTimesheet: async (id: string) =>
    normalizeTimesheet((await businessPost<{ timesheet: TimesheetEntry }>(`/timesheets/${id}/submit`, {})).timesheet),

  approveTimesheet: async (id: string, _reviewer: string, note?: string) =>
    normalizeTimesheet((await businessPost<{ timesheet: TimesheetEntry }>(`/timesheets/${id}/approve`, { note })).timesheet),

  rejectTimesheet: async (id: string, _reviewer: string, note: string) =>
    normalizeTimesheet((await businessPost<{ timesheet: TimesheetEntry }>(`/timesheets/${id}/reject`, { note })).timesheet),

  getTimesheetSummary: async (scope?: { employeeId?: string }) => {
    const path = withQuery("/timesheets/summary", { employeeId: scope?.employeeId });
    return businessGet<{
      pending: number;
      approved: number;
      rejected: number;
      totalHours: number;
    }>(path);
  },

  getHolidays: async (scope?: { month?: string }) =>
    withFallback(
      async () => (await businessGet<{ holidays: Holiday[] }>(withQuery("/holidays", { month: scope?.month }))).holidays,
      () => fallbackGetHolidays(scope),
    ),

  addHoliday: async (input: { date: string; name: string }) =>
    withFallback(
      async () => (await businessPost<{ holiday: Holiday }>("/holidays", input)).holiday,
      () => fallbackAddHoliday(input),
    ),

  deleteHoliday: async (id: string) => {
    await withFallback(
      async () => {
        await businessPost<void>(`/holidays/${id}`, undefined, "DELETE");
        return undefined;
      },
      () => fallbackDeleteHoliday(id),
    );
  },

  getLeaveRequests: async (scope?: { employeeId?: string; month?: string; status?: LeaveRequest["status"] | "all" }) => {
    const path = withQuery("/leave-requests", {
      employeeId: scope?.employeeId,
      month: scope?.month,
      status: scope?.status && scope.status !== "all" ? scope.status : undefined,
    });

    return withFallback(
      async () => (await businessGet<{ leaveRequests: LeaveRequest[] }>(path)).leaveRequests,
      () => fallbackGetLeaveRequests(scope),
    );
  },

  createLeaveRequest: async (input: { employeeId?: string; startDate: string; endDate: string; reason?: string; kind?: TimeOffKind }) =>
    withFallback(
      async () => (await businessPost<{ leaveRequest: LeaveRequest }>("/leave-requests", input)).leaveRequest,
      () => fallbackCreateLeaveRequest(input),
    ),

  updateLeaveRequestStatus: async (id: string, input: { status: "approved" | "rejected"; reviewNote?: string }) =>
    withFallback(
      async () => (await businessPost<{ leaveRequest: LeaveRequest }>(`/leave-requests/${id}/status`, input, "PATCH")).leaveRequest,
      () => fallbackUpdateLeaveRequestStatus(id, input),
    ),

  deleteLeaveRequest: async (id: string) => {
    await withFallback(
      async () => {
        await businessPost<void>(`/leave-requests/${id}`, undefined, "DELETE");
      },
      () => fallbackDeleteLeaveRequest(id),
    );
  },

  getLeavePolicy: async () =>
    withFallback(
      async () => (await businessGet<{ leavePolicy: LeavePolicy }>("/leave-settings")).leavePolicy,
      () => fallbackGetLeavePolicy(),
    ),

  updateLeavePolicy: async (input: { annualLimit: number; period?: LeavePolicy["period"]; appliesTo?: LeavePolicy["appliesTo"]; employeeIds?: string[]; updatedBy?: string }) =>
    withFallback(
      async () => (await businessPost<{ leavePolicy: LeavePolicy }>("/leave-settings", input, "PATCH")).leavePolicy,
      () => fallbackUpdateLeavePolicy(input),
    ),

  getEmployeeMonthCalendar: async ({ employeeId, month }: { employeeId: string; month: string }) =>
    withFallback(
      async () => (await businessGet<{ monthCalendar: MonthCalendar }>(withQuery("/month-calendar", { employeeId, month }))).monthCalendar,
      () => fallbackGetEmployeeMonthCalendar({ employeeId, month }),
    ),

  getProjectBudgets: async () => (await businessGet<{ projects: ProjectBudget[] }>("/projects")).projects.map(normalizeProjectBudget),

  getProjectNames: async () => (await api.getProjectBudgets()).map((project) => project.project),

  getProjectCatalog: async () => (await businessGet<{ projects: ProjectBudget[] }>("/projects/catalog")).projects.map(normalizeProjectBudget),

  getProjectBudgetSummary: async () =>
    (await businessGet<{
      projects: Array<{
        id: string;
        project: string;
        labourHours: number;
        labourCost: number;
        expenseCost: number;
        totalBudget: number;
        client?: string;
        note?: string;
        spent: number;
        remainingBudget: number;
        utilisation: number;
        tasks: ProjectBudgetTask[];
      }>;
    }>("/projects/summary")).projects,

  saveProjectBudget: async (input: SaveProjectBudgetInput) => {
    if (input.id) {
      return normalizeProjectBudget((await businessPost<{ project: ProjectBudget }>(`/projects/${input.id}`, input, "PATCH")).project);
    }
    return normalizeProjectBudget((await businessPost<{ project: ProjectBudget }>("/projects", input)).project);
  },

  deleteProjectBudget: async (id: string, _actorName?: string) => {
    await businessPost<void>(`/projects/${id}`, undefined, "DELETE");
  },

  getPurchaseOrders: async () =>
    (await businessGet<{ purchaseOrders: PurchaseOrder[] }>("/purchase-orders")).purchaseOrders,

  createPurchaseOrder: async (input: CreatePurchaseOrderInput) =>
    (await businessPost<{ purchaseOrder: PurchaseOrder }>("/purchase-orders", input)).purchaseOrder,

  updatePurchaseOrder: async (input: {
    id: string;
    title: string;
    totalAmount: number;
    vendor?: string;
    date: string;
    notes?: string;
  }) =>
    (await businessPost<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${input.id}`, input, "PATCH")).purchaseOrder,

  deletePurchaseOrder: async (id: string) => {
    await businessPost<void>(`/purchase-orders/${id}`, undefined, "DELETE");
  },

  addPurchaseOrderTask: async (input: { poId: string; taskName: string; description?: string; hours: number; rate: number }) =>
    (await businessPost<{ task: PurchaseOrderTask }>(`/purchase-orders/${input.poId}/tasks`, input)).task,

  payPurchaseOrderTask: async (input: { poId: string; taskId: string; actorName?: string }) =>
    (await businessPost<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${input.poId}/tasks/${input.taskId}/pay`, {})).purchaseOrder,

  getPreApprovals: async () =>
    (await businessGet<{ preApprovals: PreApproval[] }>("/pre-approvals")).preApprovals,

  getCompanySettings: async () =>
    (await businessGet<{ companyInfo: PreApprovalPartyInfo }>("/company-settings")).companyInfo,

  updateCompanySettings: async (input: PreApprovalPartyInfo) =>
    (await businessPost<{ companyInfo: PreApprovalPartyInfo }>("/company-settings", input, "PATCH")).companyInfo,

  createPreApproval: async (input: CreatePreApprovalInput) =>
    (await businessPost<{ preApproval: PreApproval }>("/pre-approvals", input)).preApproval,

  updatePreApproval: async (input: CreatePreApprovalInput & { id: string }) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${input.id}`, input, "PATCH")).preApproval,

  deletePreApproval: async (id: string) => {
    await businessPost<void>(`/pre-approvals/${id}`, undefined, "DELETE");
  },

  submitPreApproval: async (id: string) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${id}/submit`, {})).preApproval,

  approvePreApproval: async (id: string) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${id}/approve`, {})).preApproval,

  receivePreApprovalFunds: async (id: string) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${id}/receive-funds`, {})).preApproval,

  requestPreApprovalChanges: async (id: string, message: string) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${id}/request-changes`, { message })).preApproval,

  commentOnPreApproval: async (id: string, message: string) =>
    (await businessPost<{ preApproval: PreApproval }>(`/pre-approvals/${id}/comments`, { message })).preApproval,

  getTransactions: async () => (await businessGet<{ transactions: Transaction[] }>("/transactions")).transactions,

  getChartData: async () => (await businessGet<{ finance: ChartPoint[] }>("/charts")).finance,

  getAdminOverview: async () => businessGet<AdminOverview>("/overview"),

  getPlatformOverview: async () => platformGet<PlatformOverview>("/overview"),

  getPlatformTenants: async () => (await platformGet<{ tenants: PlatformTenantSummary[] }>("/tenants")).tenants,

  createPlatformTenant: async (input: {
    name: string;
    slug: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    ownerPosition?: string;
    ownerDepartment?: string;
    ownerPassword?: string;
  }) =>
    platformPost<{
      tenant: { id: string; name: string; slug: string; status: "active" | "inactive"; createdAt: string; updatedAt: string };
      owner: AuthUser;
      temporaryPassword: string | null;
      passwordWasGenerated: boolean;
    }>("/tenants", input),

  updatePlatformTenantStatus: async (input: {
    tenantId: string;
    status: "active" | "inactive";
    confirmationPassword?: string;
  }) =>
    (
      await platformPost<{ tenant: PlatformTenantSummary }>(
        `/tenants/${input.tenantId}/status`,
        {
          status: input.status,
          confirmationPassword: input.confirmationPassword,
        },
        "PATCH",
      )
    ).tenant,

  getPlatformMonitoring: async (limit?: number) => {
    const path = withQuery("/monitoring", { limit: limit ? String(limit) : undefined });
    return platformGet<PlatformMonitoringResponse>(path);
  },

  getFilteredPlatformMonitoring: async (filters: {
    limit?: number;
    severity?: PlatformEvent["severity"];
    category?: PlatformEvent["category"];
    tenantId?: string;
    state?: "open" | "acknowledged" | "resolved" | "all";
    search?: string;
  }) => {
    const path = withQuery("/monitoring", {
      limit: filters.limit ? String(filters.limit) : undefined,
      severity: filters.severity,
      category: filters.category,
      tenantId: filters.tenantId,
      state: filters.state,
      search: filters.search,
    });
    return platformGet<PlatformMonitoringResponse>(path);
  },

  acknowledgePlatformEvent: async (eventId: string) =>
    (await platformPost<{ event: PlatformEvent }>(`/monitoring/${eventId}/acknowledge`, {}, "PATCH")).event,

  resolvePlatformEvent: async (eventId: string) =>
    (await platformPost<{ event: PlatformEvent }>(`/monitoring/${eventId}/resolve`, {}, "PATCH")).event,

  retryPlatformEventDelivery: async (eventId: string) =>
    (await platformPost<{ result: PlatformExternalAlertRetryResult }>(`/monitoring/${eventId}/retry-delivery`, {})).result,

  retryFailedPlatformEventDeliveries: async (input?: { dryRun?: boolean; limit?: number }) =>
    (await platformPost<{ result: RetryFailedPlatformExternalAlertsResult }>("/monitoring/retry-failed", input ?? {})).result,

  triggerPlatformTestAlert: async (input?: {
    severity?: PlatformEvent["severity"];
    category?: PlatformEvent["category"];
    title?: string;
    message?: string;
  }) =>
    platformPost<{
      queued: boolean;
      testAlert: {
        severity: "info" | "warning" | "error";
        category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
        title: string;
        requestId: string;
        triggeredAt: string;
      };
    }>("/monitoring/test-alert", input ?? {}),

  getPlatformSettings: async () => platformGet<PlatformSettingsResponse>("/settings"),

  getPlatformRetention: async () =>
    (await platformGet<{ retention: PlatformSettingsResponse["operationalDefaults"]["retention"] }>("/retention")).retention,

  runPlatformRetentionPrune: async (input?: { dryRun?: boolean; limit?: number }) =>
    (await platformPost<{ result: PlatformRetentionPruneResult }>("/retention/prune", input ?? {})).result,

  getPlatformRecoveryDrills: async (limit = 100) =>
    (await platformGet<{ drills: PlatformRecoveryDrill[] }>(withQuery("/recovery/drills", { limit: String(limit) }))).drills,

  createPlatformRecoveryDrill: async (input: CreatePlatformRecoveryDrillInput) =>
    (await platformPost<{ drill: PlatformRecoveryDrill }>("/recovery/drills", input)).drill,

  getAuditTrail: async () => (await businessGet<{ auditTrail: AuditTrailEntry[] }>("/audit-trail")).auditTrail,

  getNotifications: async () => {
    const response = await requestJson<NotificationsResponse>("/notifications");
    return {
      notifications: response.notifications,
      unreadCount:
        typeof response.unreadCount === "number"
          ? response.unreadCount
          : response.notifications.filter((item) => !item.readAt).length,
    };
  },

  markNotificationRead: async (id: string) =>
    (await requestJson<{ notification: NotificationItem }>(`/notifications/${id}/read`, { method: "POST", data: {} })).notification,

  markAllNotificationsRead: async () =>
    requestJson<void>("/notifications/read-all", { method: "POST", data: {} }),
};
