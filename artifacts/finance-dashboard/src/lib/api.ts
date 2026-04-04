import { deactivateEmployeeAccount, updateEmployeeAccount } from "@/auth/auth-service";
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
  category: string;
  group: "personal" | "office";
  amount: number;
  date: string;
  description: string;
  note?: string;
  attachmentName?: string;
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
}

export interface TimesheetTaskLine {
  id: string;
  project: string;
  task: string;
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

interface FinanceStore {
  employees: Employee[];
  salaries: Salary[];
  funds: Fund[];
  expenses: Expense[];
  categories: ExpenseCategory[];
  timesheets: TimesheetEntry[];
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
  category: string;
  group: "personal" | "office";
  amount: number;
  date: string;
  description: string;
  note?: string;
  attachmentName?: string;
  reimbursable?: boolean;
  status?: ApprovalStatus;
  reviewerNote?: string;
}

const STORAGE_KEY = "finance-dashboard-store-v2";

const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: "oc1", name: "Software", color: "#6366f1", group: "office" },
  { id: "oc2", name: "Office Rent", color: "#f59e0b", group: "office" },
  { id: "oc3", name: "Travel", color: "#10b981", group: "office" },
  { id: "oc4", name: "Marketing", color: "#3b82f6", group: "office" },
  { id: "oc5", name: "Legal", color: "#ef4444", group: "office" },
  { id: "oc6", name: "Equipment", color: "#8b5cf6", group: "office" },
  { id: "pc1", name: "Rent", color: "#f97316", group: "personal" },
  { id: "pc2", name: "Groceries", color: "#22c55e", group: "personal" },
  { id: "pc3", name: "Subscriptions", color: "#a855f7", group: "personal" },
  { id: "pc4", name: "Health", color: "#ec4899", group: "personal" },
  { id: "pc5", name: "Transport", color: "#14b8a6", group: "personal" },
  { id: "pc6", name: "Entertainment", color: "#f59e0b", group: "personal" },
];

const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function cloneCategories(categories: ExpenseCategory[]): ExpenseCategory[] {
  return categories.map((category) => ({ ...category }));
}

function sanitizeEmail(name: string): string {
  return `${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "employee"}@yojak.local`;
}

function normalizePayType(value?: string | null): "monthly" | "hourly" {
  return String(value ?? "").toLowerCase() === "hourly" ? "hourly" : "monthly";
}

function normalizeEmployeeStatus(value?: string | null): "Active" | "Inactive" {
  return String(value ?? "").toLowerCase() === "inactive" ? "Inactive" : "Active";
}

function shouldIgnoreRemoteSyncError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  return error.message === "Request failed." || error.message.includes("404") || error.message.includes("Not Found");
}

function toLocalEmployee(account: AuthUser, existing?: Employee): Employee {
  const payType = normalizePayType(account.payType ?? existing?.payType);

  return {
    id: account.id,
    name: account.name?.trim() || existing?.name || account.email.split("@")[0],
    email: account.email.trim().toLowerCase(),
    phone: account.phone?.trim() || existing?.phone || "",
    employeeId: account.employeeId?.trim() || existing?.employeeId || undefined,
    profilePhotoUrl: account.profilePhotoUrl ?? existing?.profilePhotoUrl ?? null,
    role: account.position?.trim() || existing?.role || "Operations Associate",
    department: account.department?.trim() || existing?.department || "Operations",
    salary: Math.max(0, Number(account.salary ?? existing?.salary ?? 0)),
    payType,
    hourlyRate: payType === "hourly" ? Math.abs(Number(account.hourlyRate ?? existing?.hourlyRate ?? 0)) : 0,
    status: normalizeEmployeeStatus(account.status ?? existing?.status),
  };
}

function syncRemoteEmployees(store: FinanceStore, accounts: AuthUser[]): FinanceStore {
  return accounts.reduce((currentStore, account) => {
    const existingById = currentStore.employees.find((employee) => employee.id === account.id) ?? null;
    const existingByEmail =
      currentStore.employees.find((employee) => employee.email.toLowerCase() === account.email.toLowerCase()) ?? null;
    const existing = existingById ?? existingByEmail;
    const employee = toLocalEmployee(account, existing ?? undefined);

    const nextStore =
      existing && existing.id !== employee.id
        ? remapEmployeeReferences(currentStore, existing.id, employee.id, employee.name)
        : currentStore;

    return {
      ...nextStore,
      employees: [
        employee,
        ...nextStore.employees.filter((item) => item.id !== employee.id && item.id !== existing?.id),
      ],
    };
  }, store);
}

function blankHours(): Record<DayKey, number> {
  return {
    mon: 0,
    tue: 0,
    wed: 0,
    thu: 0,
    fri: 0,
    sat: 0,
    sun: 0,
  };
}

function cloneTimesheets(timesheets: TimesheetEntry[]): TimesheetEntry[] {
  return timesheets.map((entry) => ({
    ...entry,
    lines: entry.lines.map((line) => ({
      ...line,
      hours: { ...line.hours },
    })),
  }));
}

function createDefaultStore(): FinanceStore {
  return {
    employees: [],
    salaries: [],
    funds: [],
    expenses: [],
    categories: cloneCategories(DEFAULT_CATEGORIES),
    timesheets: [],
  };
}

function cloneStore(store: FinanceStore): FinanceStore {
  return {
    employees: store.employees.map((employee) => ({ ...employee })),
    salaries: store.salaries.map((salary) => ({ ...salary })),
    funds: store.funds.map((fund) => ({ ...fund })),
    expenses: store.expenses.map((expense) => ({ ...expense })),
    categories: cloneCategories(store.categories),
    timesheets: cloneTimesheets(store.timesheets),
  };
}

function normalizeDate(value: string): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (value.includes("T")) {
    return new Date(value).toISOString();
  }

  return new Date(`${value}T12:00:00`).toISOString();
}

function startOfWeekIso(baseDate = new Date()): string {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function normalizeWeekStart(weekStart?: string): string {
  if (!weekStart) {
    return startOfWeekIso();
  }

  return startOfWeekIso(new Date(weekStart));
}

function monthKey(date: string): string {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateForNote(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeStore(value?: Partial<FinanceStore>): FinanceStore {
  const categories =
    Array.isArray(value?.categories) && value.categories.length > 0
      ? value.categories
      : DEFAULT_CATEGORIES;

  return {
      employees: Array.isArray(value?.employees)
        ? value.employees.map((employee) => {
            const payType = normalizePayType(employee.payType);

            return {
              ...employee,
              email: employee.email || sanitizeEmail(employee.name),
              phone: employee.phone ?? "",
              employeeId: employee.employeeId ?? undefined,
              profilePhotoUrl: employee.profilePhotoUrl ?? null,
              payType,
              hourlyRate: payType === "hourly" ? Math.abs(employee.hourlyRate ?? 0) : 0,
              status: normalizeEmployeeStatus(employee.status),
            };
          })
        : [],
      salaries: Array.isArray(value?.salaries)
        ? value.salaries.map((salary) => ({
            ...salary,
            amount: Math.abs(salary.amount),
            date: normalizeDate(salary.date),
            note: salary.note ?? "",
            status: salary.status ?? "paid",
            source: salary.source ?? "manual",
            paidAt: salary.paidAt ? normalizeDate(salary.paidAt) : undefined,
            weekStart: salary.weekStart ? normalizeWeekStart(salary.weekStart) : undefined,
            hours: salary.hours ?? undefined,
            rate: salary.rate ?? undefined,
            timesheetId: salary.timesheetId ?? undefined,
          }))
        : [],
    funds: Array.isArray(value?.funds)
      ? value.funds.map((fund) => ({
          ...fund,
          amount: Math.abs(fund.amount),
          date: normalizeDate(fund.date),
          note: fund.note ?? "",
        }))
      : [],
    expenses: Array.isArray(value?.expenses)
      ? value.expenses.map((expense) => ({
          ...expense,
          amount: Math.abs(expense.amount),
          date: normalizeDate(expense.date),
          note: expense.note ?? "",
          status: expense.status ?? "approved",
          reimbursable: expense.reimbursable ?? expense.group === "office",
        }))
      : [],
    categories: cloneCategories(categories),
    timesheets: Array.isArray(value?.timesheets)
      ? value.timesheets.map((entry) => ({
          ...entry,
          weekStart: normalizeWeekStart(entry.weekStart),
          status: entry.status ?? "draft",
          lines: Array.isArray(entry.lines) && entry.lines.length > 0
            ? entry.lines.map((line) => ({
                ...line,
                notes: line.notes ?? "",
                hours: { ...blankHours(), ...line.hours },
              }))
            : [
                {
                  id: createId("line"),
                  project: "",
                  task: "",
                  notes: "",
                  hours: blankHours(),
                },
              ],
        }))
      : [],
  };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

let memoryStore = createDefaultStore();

function writeStore(store: FinanceStore): void {
  memoryStore = cloneStore(store);

  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function readStore(): FinanceStore {
  if (!isBrowser()) {
    return cloneStore(memoryStore);
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      const defaults = createDefaultStore();
      writeStore(defaults);
      return defaults;
    }

    const normalized = normalizeStore(JSON.parse(raw) as Partial<FinanceStore>);
    memoryStore = cloneStore(normalized);
    return normalized;
  } catch {
    const defaults = createDefaultStore();
    writeStore(defaults);
    return defaults;
  }
}

function updateStore(updater: (store: FinanceStore) => FinanceStore): FinanceStore {
  const next = updater(readStore());
  writeStore(next);
  return cloneStore(next);
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findEmployee(store: FinanceStore, employeeId?: string, email?: string) {
  if (employeeId) {
    const match = store.employees.find((employee) => employee.id === employeeId);
    if (match) {
      return match;
    }
  }

  if (email) {
    return store.employees.find((employee) => employee.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  return null;
}

function remapEmployeeReferences(store: FinanceStore, fromId: string, toId: string, employeeName: string) {
  return {
    ...store,
    salaries: store.salaries.map((salary) =>
      salary.employeeId === fromId ? { ...salary, employeeId: toId, employeeNameSnapshot: employeeName } : salary,
    ),
    expenses: store.expenses.map((expense) =>
      expense.employeeId === fromId
        ? { ...expense, employeeId: toId, employeeNameSnapshot: employeeName }
        : expense,
    ),
    timesheets: store.timesheets.map((entry) =>
      entry.employeeId === fromId ? { ...entry, employeeId: toId, employeeNameSnapshot: employeeName } : entry,
    ),
  };
}

function approvedExpenses(store: FinanceStore) {
  return store.expenses.filter((expense) => expense.status === "approved");
}

function paidSalaries(store: FinanceStore) {
  return store.salaries.filter((salary) => salary.status === "paid");
}

function calculateHourlyPayroll(entry: TimesheetEntry, employee: Employee) {
  const hours = sumTimesheetHours(entry);
  const rate = employee.hourlyRate ?? 0;
  return {
    hours,
    rate,
    amount: Math.round(hours * rate),
  };
}

function buildTransactions(store: FinanceStore): Transaction[] {
  const employeeNames = new Map(store.employees.map((employee) => [employee.id, employee.name]));

  return [
    ...store.funds.map((fund) => ({
      id: `tx_${fund.id}`,
      type: "fund" as const,
      amount: Math.abs(fund.amount),
      date: fund.date,
      description: fund.source,
      category: "Funds",
    })),
    ...approvedExpenses(store).map((expense) => ({
      id: `tx_${expense.id}`,
      type: "expense" as const,
      amount: -Math.abs(expense.amount),
      date: expense.date,
      description: expense.description,
      category: expense.category,
    })),
    ...paidSalaries(store).map((salary) => ({
      id: `tx_${salary.id}`,
      type: "salary" as const,
      amount: -Math.abs(salary.amount),
      date: salary.paidAt ?? salary.date,
      description: `${salary.employeeNameSnapshot ?? employeeNames.get(salary.employeeId) ?? "Employee"} Salary`,
      category: "Payroll",
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

function buildChartData(store: FinanceStore) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: monthKey(date.toISOString()),
      month: date.toLocaleString("en-US", { month: "short" }),
      funds: 0,
      expenses: 0,
      salary: 0,
    };
  });

  const buckets = new Map(months.map((entry) => [entry.key, entry]));

  for (const fund of store.funds) {
    const bucket = buckets.get(monthKey(fund.date));
    if (bucket) {
      bucket.funds += Math.abs(fund.amount);
    }
  }

  for (const expense of approvedExpenses(store)) {
    const bucket = buckets.get(monthKey(expense.date));
    if (bucket) {
      bucket.expenses += Math.abs(expense.amount);
    }
  }

  for (const salary of paidSalaries(store)) {
    const bucket = buckets.get(monthKey(salary.paidAt ?? salary.date));
    if (bucket) {
      bucket.salary += Math.abs(salary.amount);
    }
  }

  return months.map(({ month, funds, expenses, salary }) => ({
    month,
    funds,
    expenses,
    salary,
  }));
}

function buildExpenseCategories(store: FinanceStore) {
  const totals = new Map<string, number>();

  for (const expense of approvedExpenses(store)) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + Math.abs(expense.amount));
  }

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);
}

function sumTimesheetHours(entry: TimesheetEntry): number {
  return entry.lines.reduce(
    (total, line) => total + DAYS.reduce((sum, day) => sum + (line.hours[day] ?? 0), 0),
    0,
  );
}

function hasTimesheetContent(entry: TimesheetEntry): boolean {
  return entry.lines.some((line) => {
    const hasText = Boolean(line.project.trim() || line.task.trim() || line.notes?.trim());
    const hasHours = DAYS.some((day) => Number(line.hours[day] ?? 0) > 0);
    return hasText || hasHours;
  });
}

export const api = {
  getEmployees: async () => readStore().employees,
  syncEmployeeAccounts: async (accounts: AuthUser[]) => {
    const next = updateStore((store) => syncRemoteEmployees(store, accounts));
    return next.employees;
  },
  syncEmployeeAccount: async (account: AuthUser) => {
    const next = updateStore((store) => syncRemoteEmployees(store, [account]));
    return findEmployee(next, account.id, account.email);
  },
  getEmployeeProfile: async (scope: { employeeId?: string; email?: string }) => {
    return findEmployee(readStore(), scope.employeeId, scope.email);
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
    status?: "active" | "inactive" | "Active" | "Inactive";
  }) => {
    const next = updateStore((store) => {
      const existingById = store.employees.find((employee) => employee.id === input.id);
      if (existingById) {
        return syncRemoteEmployees(store, [
          {
            id: input.id,
              email: input.email,
              name: input.name,
              phone: input.phone,
              employeeId: input.employeeId,
              profilePhotoUrl: input.profilePhotoUrl,
              position: input.role,
            department: input.department,
            salary: input.salary,
            payType: input.payType,
            hourlyRate: input.hourlyRate,
            status: typeof input.status === "string" ? input.status.toLowerCase() as "active" | "inactive" : undefined,
            role: "employee",
          },
        ]);
      }

      const existingByEmail = store.employees.find(
        (employee) => employee.email.toLowerCase() === input.email.toLowerCase(),
      );

      if (!existingByEmail) {
        return {
          ...store,
          employees: [
            {
              id: input.id,
              name: input.name,
              email: input.email,
              phone: input.phone?.trim() ?? "",
              employeeId: input.employeeId?.trim() || undefined,
              profilePhotoUrl: input.profilePhotoUrl?.trim() || null,
              role: input.role ?? "Operations Associate",
              department: input.department ?? "Operations",
              salary: Math.max(0, Number(input.salary ?? 420000)),
              payType: normalizePayType(input.payType),
              hourlyRate: normalizePayType(input.payType) === "hourly" ? Math.abs(input.hourlyRate ?? 0) : 0,
              status: normalizeEmployeeStatus(input.status),
            },
            ...store.employees,
          ],
        };
      }

      const remappedStore = remapEmployeeReferences(store, existingByEmail.id, input.id, existingByEmail.name);
      const syncedEmployee = toLocalEmployee(
        {
          id: input.id,
          email: input.email,
          name: input.name,
          phone: input.phone,
          employeeId: input.employeeId,
          profilePhotoUrl: input.profilePhotoUrl,
          position: input.role,
          department: input.department,
          salary: input.salary,
          payType: input.payType,
          hourlyRate: input.hourlyRate,
          status: typeof input.status === "string" ? input.status.toLowerCase() as "active" | "inactive" : undefined,
          role: "employee",
        },
        existingByEmail,
      );

      return {
        ...remappedStore,
        employees: [
          syncedEmployee,
          ...remappedStore.employees.filter((employee) => employee.id !== input.id && employee.id !== existingByEmail.id),
        ],
      };
    });

    return findEmployee(next, input.id, input.email);
  },
  getSalaries: async () => readStore().salaries,
  getSalarySlips: async (scope?: { employeeId?: string }) => {
    const salaries = [...readStore().salaries].sort(
      (left, right) => new Date(right.paidAt ?? right.date).getTime() - new Date(left.paidAt ?? left.date).getTime(),
    );

    return scope?.employeeId
      ? salaries.filter((salary) => salary.employeeId === scope.employeeId)
      : salaries;
  },
  getFunds: async () => readStore().funds,
  getExpenses: async (scope?: { employeeId?: string; status?: ApprovalStatus }) => {
    let expenses = readStore().expenses;

    if (scope?.employeeId) {
      expenses = expenses.filter((expense) => expense.employeeId === scope.employeeId);
    }

    if (scope?.status) {
      expenses = expenses.filter((expense) => expense.status === scope.status);
    }

    return [...expenses].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  },
  getTransactions: async () => buildTransactions(readStore()),
  getChartData: async () => buildChartData(readStore()),
  getExpenseCategories: async () => buildExpenseCategories(readStore()),
  getCategories: async () => readStore().categories,
  getAdminOverview: async () => {
    const store = readStore();
    const approved = approvedExpenses(store);
    const totalFunds = store.funds.reduce((sum, fund) => sum + fund.amount, 0);
    const totalExpenses = approved.reduce((sum, expense) => sum + expense.amount, 0);
    const totalSalaryPaid = paidSalaries(store).reduce((sum, salary) => sum + salary.amount, 0);
    const activeEmployees = store.employees.filter((employee) => employee.status === "Active").length;
    const currentBalance = totalFunds - totalExpenses - totalSalaryPaid;
    const currentMonth = monthKey(new Date().toISOString());
    const currentYear = new Date().getFullYear();

    return {
      totalFunds,
      totalExpenses,
      totalSalaryPaid,
      activeEmployees,
      currentBalance,
      pendingExpenses: store.expenses.filter((expense) => expense.status === "submitted").length,
      pendingTimesheets: store.timesheets.filter((entry) => entry.status === "submitted").length,
      monthToDateFunds: store.funds
        .filter((fund) => monthKey(fund.date) === currentMonth)
        .reduce((sum, fund) => sum + fund.amount, 0),
      monthToDateExpenses: approved
        .filter((expense) => monthKey(expense.date) === currentMonth)
        .reduce((sum, expense) => sum + expense.amount, 0),
      yearToDateFunds: store.funds
        .filter((fund) => new Date(fund.date).getFullYear() === currentYear)
        .reduce((sum, fund) => sum + fund.amount, 0),
      yearToDateExpenses: approved
        .filter((expense) => new Date(expense.date).getFullYear() === currentYear)
        .reduce((sum, expense) => sum + expense.amount, 0),
    };
  },
  addEmployee: async (data: AddEmployeeInput) => {
    const payType = normalizePayType(data.payType);
    const store = readStore();
    const existingById = data.id ? store.employees.find((item) => item.id === data.id) : null;
    const existingByEmail = store.employees.find((item) => item.email.toLowerCase() === data.email.trim().toLowerCase()) ?? null;
    const current = existingById ?? existingByEmail;
    const employeeId = data.employeeId?.trim() || current?.employeeId || undefined;
    const employee: Employee = {
      id: data.id ?? current?.id ?? createId("emp"),
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone?.trim() ?? "",
      employeeId,
      profilePhotoUrl: data.profilePhotoUrl?.trim() || current?.profilePhotoUrl || null,
      role: data.role.trim(),
      department: data.department,
      salary: data.salary,
      payType,
      hourlyRate: payType === "hourly" ? Math.abs(data.hourlyRate ?? 0) : 0,
      status: normalizeEmployeeStatus(data.status),
    };

    updateStore((currentStore) => {
      const previousId = current?.id;
      const nextStore =
        previousId && previousId !== employee.id
          ? remapEmployeeReferences(currentStore, previousId, employee.id, employee.name)
          : currentStore;

      if (previousId && previousId !== employee.id) {
        return {
          ...nextStore,
          employees: [employee, ...nextStore.employees.filter((item) => item.id !== previousId && item.id !== employee.id)],
        };
      }

      return {
        ...nextStore,
        employees: nextStore.employees.some((item) => item.id === employee.id)
          ? nextStore.employees.map((item) => (item.id === employee.id ? employee : item))
          : [employee, ...nextStore.employees],
      };
    });

    return employee;
  },
  updateEmployee: async (data: UpdateEmployeeInput) => {
    const payType = normalizePayType(data.payType);
    const store = readStore();
    const existing = store.employees.find((item) => item.id === data.id) ?? null;
    const employee: Employee = {
      id: data.id,
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone?.trim() ?? "",
      employeeId: data.employeeId?.trim() || existing?.employeeId || undefined,
      profilePhotoUrl: data.profilePhotoUrl?.trim() || existing?.profilePhotoUrl || null,
      role: data.role.trim(),
      department: data.department,
      salary: data.salary,
      payType,
      hourlyRate: payType === "hourly" ? Math.abs(data.hourlyRate ?? 0) : 0,
      status: normalizeEmployeeStatus(data.status),
    };

    try {
      await updateEmployeeAccount({
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone ?? "",
        position: employee.role,
          salary: employee.salary,
          payType: employee.payType,
          hourlyRate: employee.hourlyRate,
          profilePhotoUrl: employee.profilePhotoUrl ?? undefined,
          department: employee.department,
        status: employee.status === "Active" ? "active" : "inactive",
      });
    } catch (error) {
      if (!shouldIgnoreRemoteSyncError(error)) {
        throw error;
      }
    }

    updateStore((currentStore) => ({
      ...currentStore,
      employees: currentStore.employees.some((item) => item.id === employee.id)
        ? currentStore.employees.map((item) => (item.id === employee.id ? employee : item))
        : [employee, ...currentStore.employees],
      salaries: currentStore.salaries.map((salary) =>
        salary.employeeId === employee.id
          ? { ...salary, employeeNameSnapshot: employee.name }
          : salary,
      ),
      expenses: currentStore.expenses.map((expense) =>
        expense.employeeId === employee.id
          ? { ...expense, employeeNameSnapshot: employee.name }
          : expense,
      ),
      timesheets: currentStore.timesheets.map((entry) =>
        entry.employeeId === employee.id
          ? { ...entry, employeeNameSnapshot: employee.name }
          : entry,
      ),
    }));

    return employee;
  },
  deleteEmployee: async (id: string) => {
    try {
      const result = await deactivateEmployeeAccount(id);
      if (result?.user) {
        updateStore((store) => ({
          ...store,
          employees: store.employees.filter((employee) => employee.id !== id),
          salaries: store.salaries.filter((salary) => salary.employeeId !== id),
          expenses: store.expenses.filter((expense) => expense.employeeId !== id),
          timesheets: store.timesheets.filter((entry) => entry.employeeId !== id),
        }));
        return;
      }
    } catch (error) {
      if (!shouldIgnoreRemoteSyncError(error)) {
        throw error;
      }
    }

    updateStore((store) => ({
      ...store,
      employees: store.employees.filter((employee) => employee.id !== id),
      salaries: store.salaries.filter((salary) => salary.employeeId !== id),
      expenses: store.expenses.filter((expense) => expense.employeeId !== id),
      timesheets: store.timesheets.filter((entry) => entry.employeeId !== id),
    }));
  },
  addFund: async (data: AddFundInput) => {
    const fund: Fund = {
      id: createId("fund"),
      source: data.source.trim(),
      amount: Math.abs(data.amount),
      date: normalizeDate(data.date),
      note: data.note?.trim() ?? "",
    };

    updateStore((store) => ({
      ...store,
      funds: [fund, ...store.funds],
    }));

    return fund;
  },
  addExpense: async (data: AddExpenseInput) => {
    const expense: Expense = {
      id: createId("exp"),
      employeeId: data.employeeId,
      employeeNameSnapshot: data.employeeNameSnapshot,
      category: data.category,
      group: data.group,
      amount: Math.abs(data.amount),
      date: normalizeDate(data.date),
      description: data.description.trim(),
      note: data.note?.trim() ?? "",
      attachmentName: data.attachmentName?.trim() || undefined,
      reimbursable: data.reimbursable ?? data.group === "office",
      status: data.status ?? "approved",
      reviewerNote: data.reviewerNote,
    };

    updateStore((store) => ({
      ...store,
      expenses: [expense, ...store.expenses],
    }));

    return expense;
  },
  updateExpenseStatus: async (id: string, status: ApprovalStatus, reviewerNote?: string) => {
    updateStore((store) => ({
      ...store,
      expenses: store.expenses.map((expense) =>
        expense.id === id ? { ...expense, status, reviewerNote } : expense,
      ),
    }));
  },
  addSalary: async (data: AddSalaryInput) => {
    const employee = readStore().employees.find((item) => item.id === data.employeeId);
    const salary: Salary = {
      id: createId("sal"),
      employeeId: data.employeeId,
      employeeNameSnapshot: employee?.name,
      amount: Math.abs(data.amount),
      date: new Date().toISOString(),
      note: data.note?.trim() ?? "",
      status: data.status ?? "pending",
      source: data.source ?? "manual",
      paidAt: data.status === "paid" ? new Date().toISOString() : undefined,
      weekStart: data.weekStart ? normalizeWeekStart(data.weekStart) : undefined,
      hours: data.hours,
      rate: data.rate,
      timesheetId: data.timesheetId,
    };

    updateStore((store) => {
      const existingRecord = salary.timesheetId
        ? store.salaries.find((entry) => entry.timesheetId === salary.timesheetId)
        : store.salaries.find(
            (entry) =>
              entry.employeeId === salary.employeeId &&
              entry.source === salary.source &&
              entry.status === "pending" &&
              monthKey(entry.date) === monthKey(salary.date),
          );

      return {
        ...store,
        salaries: existingRecord
          ? [
              salary,
              ...store.salaries.filter((entry) => entry.id !== existingRecord.id),
            ]
          : [salary, ...store.salaries],
      };
    });

    return salary;
  },
  paySalaryRecord: async (id: string, note?: string) => {
    updateStore((store) => ({
      ...store,
      salaries: store.salaries.map((salary) =>
        salary.id === id
          ? {
              ...salary,
              status: "paid",
              paidAt: new Date().toISOString(),
              date: new Date().toISOString(),
              note: note?.trim() || salary.note,
            }
          : salary,
      ),
    }));
  },
  saveCategory: async (data: CategoryInput) => {
    const name = data.name.trim();

    const store = updateStore((current) => {
      if (data.editId) {
        const existingCategory = current.categories.find((category) => category.id === data.editId);

        return {
          ...current,
          categories: current.categories.map((category) =>
            category.id === data.editId
              ? {
                  ...category,
                  name,
                  color: data.color,
                  group: data.group,
                }
              : category,
          ),
          expenses: existingCategory
            ? current.expenses.map((expense) =>
                expense.category === existingCategory.name
                  ? { ...expense, category: name, group: data.group }
                  : expense,
              )
            : current.expenses,
        };
      }

      const category: ExpenseCategory = {
        id: createId("cat"),
        name,
        color: data.color,
        group: data.group,
      };

      return {
        ...current,
        categories: [...current.categories, category],
      };
    });

    return store.categories.find((category) => category.id === data.editId || category.name === name);
  },
  deleteCategory: async (id: string) => {
    updateStore((store) => ({
      ...store,
      categories: store.categories.filter((category) => category.id !== id),
    }));
  },
  getTimesheets: async (scope?: { employeeId?: string }) => {
    const entries = readStore().timesheets
      .filter((entry) => entry.status !== "draft" || hasTimesheetContent(entry))
      .sort(
      (left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime(),
    );

    return scope?.employeeId
      ? entries.filter((entry) => entry.employeeId === scope.employeeId)
      : entries;
  },
  getTimesheetByWeek: async (employeeId: string, weekStart: string) => {
    return (
      readStore().timesheets.find(
        (entry) =>
          entry.employeeId === employeeId &&
          normalizeWeekStart(entry.weekStart) === normalizeWeekStart(weekStart),
      ) ?? null
    );
  },
  createTimesheetDraft: async (input: {
    employeeId: string;
    employeeNameSnapshot: string;
    weekStart?: string;
  }) => {
    const store = readStore();
    const weekStart = normalizeWeekStart(input.weekStart);
    const existing = store.timesheets.find(
      (entry) => entry.employeeId === input.employeeId && entry.weekStart === weekStart,
    );

    if (existing) {
      return existing;
    }

    const entry: TimesheetEntry = {
      id: createId("ts"),
      employeeId: input.employeeId,
      employeeNameSnapshot: input.employeeNameSnapshot,
      weekStart,
      status: "draft",
      lines: [
        {
          id: createId("line"),
          project: "",
          task: "",
          notes: "",
          hours: blankHours(),
        },
      ],
    };

    updateStore((current) => ({
      ...current,
      timesheets: [entry, ...current.timesheets],
    }));

    return entry;
  },
  saveTimesheet: async (entry: TimesheetEntry) => {
    const normalized: TimesheetEntry = {
      ...entry,
      weekStart: normalizeWeekStart(entry.weekStart),
      status: entry.status ?? "draft",
      lines: entry.lines.map((line) => ({
        ...line,
        notes: line.notes ?? "",
        hours: { ...blankHours(), ...line.hours },
        })),
    };

    if (normalized.status === "draft" && !hasTimesheetContent(normalized)) {
      updateStore((store) => ({
        ...store,
        timesheets: store.timesheets.filter((item) => item.id !== normalized.id),
      }));

      return normalized;
    }

    updateStore((store) => ({
      ...store,
      timesheets: store.timesheets.some((item) => item.id === normalized.id)
        ? store.timesheets.map((item) => (item.id === normalized.id ? normalized : item))
        : [normalized, ...store.timesheets],
    }));

    return normalized;
  },
  submitTimesheet: async (id: string) => {
    updateStore((store) => ({
      ...store,
      timesheets: store.timesheets.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "submitted",
              submittedAt: new Date().toISOString(),
              reviewedAt: undefined,
              reviewedBy: undefined,
              reviewNotes: undefined,
            }
          : entry,
      ),
    }));
  },
  approveTimesheet: async (id: string, reviewer: string, note?: string) => {
    updateStore((store) => {
      const target = store.timesheets.find((entry) => entry.id === id);
      const employee = target ? store.employees.find((item) => item.id === target.employeeId) : null;

      const timesheets: TimesheetEntry[] = store.timesheets.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "approved",
              reviewedAt: new Date().toISOString(),
              reviewedBy: reviewer,
              reviewNotes: note,
            }
          : entry,
      );

      if (!target || !employee || employee.payType !== "hourly" || !(employee.hourlyRate ?? 0)) {
        return {
          ...store,
          timesheets,
        };
      }

      const payroll = calculateHourlyPayroll(target, employee);
      const existingPayroll = store.salaries.find((salary) => salary.timesheetId === target.id);
      const payrollRecord: Salary = {
        id: existingPayroll?.id ?? createId("sal"),
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        amount: payroll.amount,
        date: new Date().toISOString(),
        note: note?.trim() || `Timesheet payout for week of ${formatDateForNote(target.weekStart)}`,
        status: existingPayroll?.status === "paid" ? "paid" : "pending",
        source: "timesheet",
        paidAt: existingPayroll?.status === "paid" ? existingPayroll.paidAt ?? existingPayroll.date : undefined,
        weekStart: target.weekStart,
        hours: payroll.hours,
        rate: payroll.rate,
        timesheetId: target.id,
      };

      return {
        ...store,
        timesheets,
        salaries: [payrollRecord, ...store.salaries.filter((salary) => salary.id !== existingPayroll?.id)],
      };
    });
  },
  rejectTimesheet: async (id: string, reviewer: string, note: string) => {
    updateStore((store) => ({
      ...store,
      timesheets: store.timesheets.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "rejected",
              reviewedAt: new Date().toISOString(),
              reviewedBy: reviewer,
              reviewNotes: note,
            }
          : entry,
      ),
    }));
  },
  getTimesheetSummary: async (scope?: { employeeId?: string }) => {
    const timesheets = scope?.employeeId
      ? readStore().timesheets.filter((entry) => entry.employeeId === scope.employeeId)
      : readStore().timesheets;

    return {
      pending: timesheets.filter((entry) => entry.status === "submitted").length,
      approved: timesheets.filter((entry) => entry.status === "approved").length,
      rejected: timesheets.filter((entry) => entry.status === "rejected").length,
      totalHours: timesheets.reduce((sum, entry) => sum + sumTimesheetHours(entry), 0),
    };
  },
};
