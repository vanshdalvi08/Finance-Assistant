import {
  createEmployeeAccount,
  deactivateEmployeeAccount,
  listEmployeeAccounts,
  updateEmployeeAccount,
} from "@/auth/auth-service";
import { requestJson } from "@/auth/http-client";
import type { AuthUser } from "@/auth/types";

export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

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

export interface Salary {
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
}

export interface Fund {
  id: string;
  source: string;
  amount: number;
  date: string;
  note: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  group: "personal" | "office";
}

export interface Expense {
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
}

export interface AuditTrailEntry {
  id: string;
  actorName: string;
  actorRole: "admin" | "employee" | "system";
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
  status: "active" | "archived";
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
  tasks: PurchaseOrderTask[];
}

interface CategoryInput {
  name: string;
  color: string;
  group: "personal" | "office";
  editId?: string;
}

interface AddFundInput {
  source: string;
  amount: number;
  date: string;
  note?: string;
}

interface AddSalaryInput {
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

interface UpdateEmployeeInput extends AddEmployeeInput {
  id: string;
}

interface AddExpenseInput {
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
    amount: number;
  }>;
}

interface AdminOverview {
  totalFunds: number;
  totalExpenses: number;
  totalSalaryPaid: number;
  activeEmployees: number;
  currentBalance: number;
  pendingExpenses: number;
  pendingTimesheets: number;
  monthToDateFunds: number;
  monthToDateExpenses: number;
  yearToDateFunds: number;
  yearToDateExpenses: number;
}

interface ChartPoint {
  month: string;
  funds: number;
  expenses: number;
  salary: number;
}

interface MonthCalendarDay {
  date: string;
  day: number;
  isWeekend: boolean;
  worked: boolean;
  leave: boolean;
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

function normalizeTimesheet(entry: TimesheetEntry): TimesheetEntry {
  return {
    ...entry,
    weekStart: normalizeWeekStart(entry.weekStart),
    lines: (entry.lines.length ? entry.lines : [{ id: createId("line"), project: "", task: "", notes: "", hours: blankHours() }]).map((line) => ({
      ...line,
      id: line.id || createId("line"),
      notes: line.notes ?? "",
      hours: { ...blankHours(), ...line.hours },
    })),
  };
}

function normalizeProjectBudget(project: ProjectBudget): ProjectBudget {
  return {
    ...project,
    note: project.note ?? project.notes ?? "",
    notes: project.notes ?? project.note ?? "",
  };
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

function buildMonthCalendar(month: string, employeeId: string, timesheets: TimesheetEntry[], expenses: Expense[]): MonthCalendar {
  const [yearString, monthString] = month.split("-");
  const year = Number(yearString);
  const monthIndex = Number(monthString) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const daily = new Map<string, { hours: number; expenseCount: number }>();

  for (const entry of timesheets.filter((item) => item.employeeId === employeeId && monthKey(item.weekStart) <= month)) {
    const weekStart = new Date(entry.weekStart);
    entry.lines.forEach((line) => {
      const keys: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      keys.forEach((key, offset) => {
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

  for (const expense of expenses.filter((item) => item.employeeId === employeeId && monthKey(item.date) === month)) {
    const iso = expense.date.slice(0, 10);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    bucket.expenseCount += 1;
    daily.set(iso, bucket);
  }

  const days: MonthCalendarDay[] = [];
  let daysWorked = 0;
  let leaveDays = 0;
  let hoursLogged = 0;
  let expenseSubmissions = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
    const iso = date.toISOString().slice(0, 10);
    const bucket = daily.get(iso) ?? { hours: 0, expenseCount: 0 };
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const worked = bucket.hours > 0;
    const leave = !worked && !isWeekend && bucket.expenseCount === 0;
    if (worked) daysWorked += 1;
    if (leave) leaveDays += 1;
    hoursLogged += bucket.hours;
    expenseSubmissions += bucket.expenseCount;

    days.push({
      date: `${iso}T12:00:00.000Z`,
      day,
      isWeekend,
      worked,
      leave,
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
      expenseSubmissions,
    },
    days,
  };
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

  addFund: async (input: AddFundInput) =>
    (await businessPost<{ fund: Fund }>("/funds", input)).fund,

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

  updateExpenseStatus: async (id: string, status: ApprovalStatus, reviewerNote?: string) =>
    (await businessPost<{ expense: Expense }>(`/expenses/${id}/status`, { status, reviewerNote }, "PATCH")).expense,

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

  paySalaryRecord: async (id: string) =>
    (await businessPost<{ salary: Salary }>(`/salaries/${id}/pay`, {})).salary,

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
          notes: "",
          hours: blankHours(),
        },
      ],
    };
  },

  saveTimesheet: async (entry: TimesheetEntry) =>
    normalizeTimesheet((await businessPost<{ timesheet: TimesheetEntry }>("/timesheets", normalizeTimesheet(entry))).timesheet),

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

  getEmployeeMonthCalendar: async ({ employeeId, month }: { employeeId: string; month: string }) => {
    const [timesheets, expenses] = await Promise.all([
      api.getTimesheets({ employeeId }),
      api.getExpenses({ employeeId }),
    ]);
    return buildMonthCalendar(month, employeeId, timesheets, expenses);
  },

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

  addPurchaseOrderTask: async (input: { poId: string; taskName: string; description?: string; amount: number }) =>
    (await businessPost<{ task: PurchaseOrderTask }>(`/purchase-orders/${input.poId}/tasks`, input)).task,

  payPurchaseOrderTask: async (input: { poId: string; taskId: string; actorName?: string }) =>
    (await businessPost<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${input.poId}/tasks/${input.taskId}/pay`, {})).purchaseOrder,

  getTransactions: async () => (await businessGet<{ transactions: Transaction[] }>("/transactions")).transactions,

  getChartData: async () => (await businessGet<{ finance: ChartPoint[] }>("/charts")).finance,

  getAdminOverview: async () => businessGet<AdminOverview>("/overview"),

  getAuditTrail: async () => (await businessGet<{ auditTrail: AuditTrailEntry[] }>("/audit-trail")).auditTrail,
};
