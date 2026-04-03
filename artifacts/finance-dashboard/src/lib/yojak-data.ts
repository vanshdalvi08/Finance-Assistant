export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type EmployeeStatus = "active" | "inactive";
export type ExpenseKind = "personal" | "office";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  roleTitle: string;
  department: string;
  monthlySalary: number;
  status: EmployeeStatus;
  joinedAt: string;
}

export interface FundRecord {
  id: string;
  source: string;
  sourceType: "revenue" | "investment" | "grant" | "bridge" | "other";
  amount: number;
  date: string;
  note: string;
}

export interface ExpenseCategoryRecord {
  id: string;
  name: string;
  kind: ExpenseKind;
  color: string;
}

export interface ExpenseRecord {
  id: string;
  employeeId: string;
  employeeNameSnapshot: string;
  title: string;
  categoryId: string;
  categoryNameSnapshot: string;
  kind: ExpenseKind;
  amount: number;
  date: string;
  note: string;
  attachmentName?: string;
  reimbursable: boolean;
  status: ApprovalStatus;
  reviewerNote?: string;
}

export interface SalarySlipRecord {
  id: string;
  employeeId: string;
  employeeNameSnapshot: string;
  month: number;
  year: number;
  gross: number;
  deductions: number;
  reimbursements: number;
  net: number;
  status: "processed" | "paid" | "scheduled";
  paidAt?: string;
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

interface WorkspaceStore {
  employees: EmployeeRecord[];
  funds: FundRecord[];
  expenseCategories: ExpenseCategoryRecord[];
  expenses: ExpenseRecord[];
  salarySlips: SalarySlipRecord[];
  timesheets: TimesheetEntry[];
}

interface LegacyStore {
  employees?: Array<{
    id: string;
    name: string;
    department: string;
    role: string;
    salary: number;
    status: "Active" | "Inactive";
  }>;
  funds?: Array<{
    id: string;
    source: string;
    amount: number;
    date: string;
    note: string;
  }>;
  categories?: Array<{
    id: string;
    name: string;
    group: ExpenseKind;
    color: string;
  }>;
  expenses?: Array<{
    id: string;
    category: string;
    group: ExpenseKind;
    amount: number;
    date: string;
    description: string;
  }>;
  salaries?: Array<{
    id: string;
    employeeId: string;
    employeeNameSnapshot?: string;
    amount: number;
    date: string;
    note: string;
  }>;
}

const STORAGE_KEY = "yojak-workspace-v1";
const LEGACY_STORAGE_KEY = "finance-dashboard-store-v1";
const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DEFAULT_CATEGORIES: ExpenseCategoryRecord[] = [
  { id: "cat-office-software", name: "Software", kind: "office", color: "#ac8648" },
  { id: "cat-office-rent", name: "Rent", kind: "office", color: "#6b7cbd" },
  { id: "cat-office-travel", name: "Travel", kind: "office", color: "#3d9f87" },
  { id: "cat-office-hardware", name: "Equipment", kind: "office", color: "#9b6a5b" },
  { id: "cat-personal-groceries", name: "Groceries", kind: "personal", color: "#5aa67a" },
  { id: "cat-personal-bills", name: "Bills", kind: "personal", color: "#8a77c7" },
  { id: "cat-personal-travel", name: "Travel", kind: "personal", color: "#d48c57" },
  { id: "cat-personal-health", name: "Health", kind: "personal", color: "#c5656d" },
];

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blankHours() {
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

function cloneStore(store: WorkspaceStore): WorkspaceStore {
  return {
    employees: store.employees.map((employee) => ({ ...employee })),
    funds: store.funds.map((fund) => ({ ...fund })),
    expenseCategories: store.expenseCategories.map((category) => ({ ...category })),
    expenses: store.expenses.map((expense) => ({ ...expense })),
    salarySlips: store.salarySlips.map((slip) => ({ ...slip })),
    timesheets: store.timesheets.map((entry) => ({
      ...entry,
      lines: entry.lines.map((line) => ({ ...line, hours: { ...line.hours } })),
    })),
  };
}

function createDefaultStore(): WorkspaceStore {
  return {
    employees: [],
    funds: [],
    expenseCategories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    expenses: [],
    salarySlips: [],
    timesheets: [],
  };
}

function normalizeDate(date: string) {
  if (!date) {
    return new Date().toISOString();
  }

  if (date.includes("T")) {
    return new Date(date).toISOString();
  }

  return new Date(`${date}T12:00:00`).toISOString();
}

function startOfWeekIso(baseDate = new Date()) {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function monthKeyFromParts(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthKeyFromDate(date: string) {
  const value = new Date(date);
  return monthKeyFromParts(value.getFullYear(), value.getMonth() + 1);
}

function migrateLegacyStore() {
  if (!isBrowser()) {
    return createDefaultStore();
  }

  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);

  if (!raw) {
    return createDefaultStore();
  }

  try {
    const legacy = JSON.parse(raw) as LegacyStore;
    const store = createDefaultStore();

    store.employees = (legacy.employees ?? []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      email: `${employee.name.toLowerCase().replace(/\s+/g, ".")}@yojak.local`,
      roleTitle: employee.role,
      department: employee.department,
      monthlySalary: Math.round(employee.salary / 12),
      status: employee.status === "Active" ? "active" : "inactive",
      joinedAt: new Date().toISOString(),
    }));

    store.funds = (legacy.funds ?? []).map((fund) => ({
      id: fund.id,
      source: fund.source,
      sourceType: "other",
      amount: fund.amount,
      date: normalizeDate(fund.date),
      note: fund.note,
    }));

    if ((legacy.categories ?? []).length > 0) {
      store.expenseCategories = legacy.categories!.map((category) => ({
        id: category.id,
        name: category.name,
        kind: category.group,
        color: category.color,
      }));
    }

    store.expenses = (legacy.expenses ?? []).map((expense) => ({
      id: expense.id,
      employeeId: "system",
      employeeNameSnapshot: "Imported",
      title: expense.description,
      categoryId: expense.category.toLowerCase().replace(/\s+/g, "-"),
      categoryNameSnapshot: expense.category,
      kind: expense.group,
      amount: expense.amount,
      date: normalizeDate(expense.date),
      note: "",
      reimbursable: expense.group === "office",
      status: "approved",
    }));

    store.salarySlips = (legacy.salaries ?? []).map((salary) => {
      const paidAt = normalizeDate(salary.date);
      const value = new Date(paidAt);
      return {
        id: salary.id,
        employeeId: salary.employeeId,
        employeeNameSnapshot: salary.employeeNameSnapshot ?? "Imported Employee",
        month: value.getMonth() + 1,
        year: value.getFullYear(),
        gross: salary.amount,
        deductions: 0,
        reimbursements: 0,
        net: salary.amount,
        status: "paid" as const,
        paidAt,
      };
    });

    return store;
  } catch {
    return createDefaultStore();
  }
}

let memoryStore = createDefaultStore();

function readStore(): WorkspaceStore {
  if (!isBrowser()) {
    return cloneStore(memoryStore);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    const migrated = migrateLegacyStore();
    writeStore(migrated);
    return migrated;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceStore;
    memoryStore = cloneStore({
      ...createDefaultStore(),
      ...parsed,
    });
    return cloneStore(memoryStore);
  } catch {
    const fallback = createDefaultStore();
    writeStore(fallback);
    return fallback;
  }
}

function writeStore(store: WorkspaceStore) {
  memoryStore = cloneStore(store);

  if (isBrowser()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }
}

function updateStore(updater: (current: WorkspaceStore) => WorkspaceStore) {
  const next = updater(readStore());
  writeStore(next);
  return cloneStore(next);
}

function sumTimesheet(entry: TimesheetEntry) {
  return entry.lines.reduce(
    (total, line) => total + DAYS.reduce((sum, day) => sum + (line.hours[day] ?? 0), 0),
    0,
  );
}

function buildTransactions(store: WorkspaceStore) {
  return [
    ...store.funds.map((fund) => ({
      id: `txn_${fund.id}`,
      type: "fund" as const,
      amount: fund.amount,
      date: fund.date,
      title: fund.source,
      category: fund.sourceType,
      actor: "Treasury",
    })),
    ...store.expenses.map((expense) => ({
      id: `txn_${expense.id}`,
      type: "expense" as const,
      amount: -expense.amount,
      date: expense.date,
      title: expense.title,
      category: expense.categoryNameSnapshot,
      actor: expense.employeeNameSnapshot,
    })),
    ...store.salarySlips
      .filter((slip) => slip.status !== "scheduled")
      .map((slip) => ({
        id: `txn_${slip.id}`,
        type: "salary" as const,
        amount: -slip.net,
        date: slip.paidAt ?? new Date(slip.year, slip.month - 1, 1).toISOString(),
        title: `${slip.employeeNameSnapshot} salary`,
        category: "payroll",
        actor: slip.employeeNameSnapshot,
      })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

function lastSixMonths() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      month: date.toLocaleString("en-US", { month: "short" }),
      key: monthKeyFromParts(date.getFullYear(), date.getMonth() + 1),
    };
  });
}

export const yojakData = {
  async ensureEmployeeProfile(input: {
    id: string;
    name: string;
    email: string;
    roleTitle?: string;
    department?: string;
  }) {
    const store = updateStore((current) => {
      if (current.employees.some((employee) => employee.id === input.id)) {
        return current;
      }

      return {
        ...current,
        employees: [
          {
            id: input.id,
            name: input.name,
            email: input.email,
            roleTitle: input.roleTitle ?? "Operations Associate",
            department: input.department ?? "Operations",
            monthlySalary: 42000,
            status: "active",
            joinedAt: new Date().toISOString(),
          },
          ...current.employees,
        ],
      };
    });

    return store.employees.find((employee) => employee.id === input.id) ?? null;
  },
  async getEmployees() {
    return readStore().employees;
  },
  async saveEmployee(employee: Partial<EmployeeRecord> & Pick<EmployeeRecord, "name" | "email">) {
    const next = updateStore((current) => {
      const previous = employee.id
        ? current.employees.find((item) => item.id === employee.id) ?? null
        : null;
      const record: EmployeeRecord = {
        id: employee.id ?? createId("emp"),
        name: employee.name.trim(),
        email: employee.email.trim(),
        roleTitle: employee.roleTitle?.trim() || "Team Member",
        department: employee.department?.trim() || "Operations",
        monthlySalary: employee.monthlySalary ?? 0,
        status: employee.status ?? "active",
        joinedAt: employee.joinedAt ?? new Date().toISOString(),
      };

      const exists = current.employees.some((item) => item.id === record.id);
      return {
        ...current,
        employees: exists
          ? current.employees.map((item) => (item.id === record.id ? record : item))
          : [record, ...current.employees],
        expenses: previous
          ? current.expenses.map((expense) =>
              expense.employeeId === record.id
                ? { ...expense, employeeNameSnapshot: record.name }
                : expense,
            )
          : current.expenses,
        salarySlips: previous
          ? current.salarySlips.map((slip) =>
              slip.employeeId === record.id
                ? { ...slip, employeeNameSnapshot: record.name }
                : slip,
            )
          : current.salarySlips,
        timesheets: previous
          ? current.timesheets.map((entry) =>
              entry.employeeId === record.id
                ? { ...entry, employeeNameSnapshot: record.name }
                : entry,
            )
          : current.timesheets,
      };
    });

    return next.employees;
  },
  async deleteEmployee(id: string) {
    updateStore((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== id),
    }));
  },
  async getFunds() {
    return readStore().funds;
  },
  async addFund(input: Omit<FundRecord, "id">) {
    updateStore((current) => ({
      ...current,
      funds: [
        {
          id: createId("fund"),
          ...input,
          amount: Math.abs(input.amount),
          date: normalizeDate(input.date),
        },
        ...current.funds,
      ],
    }));
  },
  async getExpenseCategories(kind?: ExpenseKind) {
    const categories = readStore().expenseCategories;
    return kind ? categories.filter((category) => category.kind === kind) : categories;
  },
  async saveExpenseCategory(category: Partial<ExpenseCategoryRecord> & Pick<ExpenseCategoryRecord, "name" | "kind" | "color">) {
    updateStore((current) => {
      const record: ExpenseCategoryRecord = {
        id: category.id ?? createId("cat"),
        name: category.name.trim(),
        kind: category.kind,
        color: category.color,
      };

      return {
        ...current,
        expenseCategories: current.expenseCategories.some((item) => item.id === record.id)
          ? current.expenseCategories.map((item) => (item.id === record.id ? record : item))
          : [...current.expenseCategories, record],
        expenses: current.expenses.map((expense) =>
          expense.categoryId === record.id
            ? { ...expense, categoryNameSnapshot: record.name, kind: record.kind }
            : expense,
        ),
      };
    });
  },
  async deleteExpenseCategory(id: string) {
    updateStore((current) => ({
      ...current,
      expenseCategories: current.expenseCategories.filter((category) => category.id !== id),
    }));
  },
  async getExpenses(scope?: { employeeId?: string }) {
    const expenses = readStore().expenses;
    return scope?.employeeId ? expenses.filter((expense) => expense.employeeId === scope.employeeId) : expenses;
  },
  async addExpense(input: Omit<ExpenseRecord, "id" | "status">) {
    updateStore((current) => ({
      ...current,
      expenses: [
        {
          id: createId("exp"),
          ...input,
          amount: Math.abs(input.amount),
          date: normalizeDate(input.date),
          status: "submitted",
        },
        ...current.expenses,
      ],
    }));
  },
  async updateExpenseStatus(id: string, status: ApprovalStatus, reviewerNote?: string) {
    updateStore((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === id ? { ...expense, status, reviewerNote } : expense,
      ),
    }));
  },
  async getSalarySlips(scope?: { employeeId?: string }) {
    const slips = readStore().salarySlips.sort((left, right) => {
      const leftKey = left.year * 100 + left.month;
      const rightKey = right.year * 100 + right.month;
      return rightKey - leftKey;
    });

    return scope?.employeeId ? slips.filter((slip) => slip.employeeId === scope.employeeId) : slips;
  },
  async runPayroll(input: { employeeId: string; month: number; year: number; deductions: number; reimbursements: number }) {
    const store = readStore();
    const employee = store.employees.find((item) => item.id === input.employeeId);

    if (!employee) {
      throw new Error("Employee not found for payroll run.");
    }

    updateStore((current) => ({
      ...current,
      salarySlips: [
        {
          id:
            current.salarySlips.find(
              (slip) =>
                slip.employeeId === employee.id &&
                slip.month === input.month &&
                slip.year === input.year,
            )?.id ?? createId("slip"),
          employeeId: employee.id,
          employeeNameSnapshot: employee.name,
          month: input.month,
          year: input.year,
          gross: employee.monthlySalary,
          deductions: Math.abs(input.deductions),
          reimbursements: Math.abs(input.reimbursements),
          net: employee.monthlySalary - Math.abs(input.deductions) + Math.abs(input.reimbursements),
          status: "paid",
          paidAt: new Date().toISOString(),
        },
        ...current.salarySlips.filter(
          (slip) =>
            !(
              slip.employeeId === employee.id &&
              slip.month === input.month &&
              slip.year === input.year
            ),
        ),
      ],
    }));
  },
  async getTransactions() {
    return buildTransactions(readStore());
  },
  async getAdminOverview() {
    const store = readStore();
    const totalFunds = store.funds.reduce((sum, fund) => sum + fund.amount, 0);
    const totalExpenses = store.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const totalSalaryPaid = store.salarySlips.reduce((sum, slip) => sum + slip.net, 0);
    const activeEmployees = store.employees.filter((employee) => employee.status === "active").length;
    const currentBalance = totalFunds - totalExpenses - totalSalaryPaid;

    const currentMonth = monthKeyFromDate(new Date().toISOString());
    const monthToDateFunds = store.funds.filter((fund) => monthKeyFromDate(fund.date) === currentMonth).reduce((sum, fund) => sum + fund.amount, 0);
    const monthToDateExpenses = store.expenses.filter((expense) => monthKeyFromDate(expense.date) === currentMonth).reduce((sum, expense) => sum + expense.amount, 0);
    const year = new Date().getFullYear();
    const ytdFunds = store.funds.filter((fund) => new Date(fund.date).getFullYear() === year).reduce((sum, fund) => sum + fund.amount, 0);
    const ytdExpenses = store.expenses.filter((expense) => new Date(expense.date).getFullYear() === year).reduce((sum, expense) => sum + expense.amount, 0);

    return {
      totalFunds,
      totalExpenses,
      totalSalaryPaid,
      activeEmployees,
      currentBalance,
      monthToDateFunds,
      monthToDateExpenses,
      yearToDateFunds: ytdFunds,
      yearToDateExpenses: ytdExpenses,
      pendingExpenseApprovals: store.expenses.filter((expense) => expense.status === "submitted").length,
      pendingTimesheets: store.timesheets.filter((entry) => entry.status === "submitted").length,
    };
  },
  async getFinanceChartSeries() {
    const store = readStore();
    return lastSixMonths().map(({ month, key }) => ({
      month,
      funds: store.funds.filter((fund) => monthKeyFromDate(fund.date) === key).reduce((sum, fund) => sum + fund.amount, 0),
      expenses: store.expenses.filter((expense) => monthKeyFromDate(expense.date) === key).reduce((sum, expense) => sum + expense.amount, 0),
      payroll: store.salarySlips.filter((slip) => monthKeyFromParts(slip.year, slip.month) === key).reduce((sum, slip) => sum + slip.net, 0),
    }));
  },
  async getExpenseCategoryBreakdown() {
    const breakdown = new Map<string, number>();
    for (const expense of readStore().expenses) {
      breakdown.set(expense.categoryNameSnapshot, (breakdown.get(expense.categoryNameSnapshot) ?? 0) + expense.amount);
    }
    return Array.from(breakdown.entries()).map(([name, value]) => ({ name, value }));
  },
  async getTimesheets(scope?: { employeeId?: string }) {
    const entries = readStore().timesheets.sort((left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime());
    return scope?.employeeId ? entries.filter((entry) => entry.employeeId === scope.employeeId) : entries;
  },
  async getTimesheetByWeek(employeeId: string, weekStart: string) {
    return readStore().timesheets.find((entry) => entry.employeeId === employeeId && entry.weekStart === weekStart) ?? null;
  },
  async saveDraftTimesheet(input: Omit<TimesheetEntry, "status"> & { status?: ApprovalStatus }) {
    updateStore((current) => {
      const record: TimesheetEntry = {
        ...input,
        weekStart: input.weekStart || startOfWeekIso(),
        status: input.status ?? "draft",
        lines: input.lines.map((line) => ({
          ...line,
          hours: { ...blankHours(), ...line.hours },
        })),
      };

      return {
        ...current,
        timesheets: current.timesheets.some((entry) => entry.id === record.id)
          ? current.timesheets.map((entry) => (entry.id === record.id ? record : entry))
          : [record, ...current.timesheets],
      };
    });
  },
  async submitTimesheet(id: string) {
    updateStore((current) => ({
      ...current,
      timesheets: current.timesheets.map((entry) =>
        entry.id === id ? { ...entry, status: "submitted", submittedAt: new Date().toISOString() } : entry,
      ),
    }));
  },
  async createTimesheetDraft(input: { employeeId: string; employeeNameSnapshot: string; weekStart?: string }) {
    const entry: TimesheetEntry = {
      id: createId("ts"),
      employeeId: input.employeeId,
      employeeNameSnapshot: input.employeeNameSnapshot,
      weekStart: input.weekStart ?? startOfWeekIso(),
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
    await this.saveDraftTimesheet(entry);
    return entry;
  },
  async approveTimesheet(id: string, reviewer: string, reviewNotes?: string) {
    updateStore((current) => ({
      ...current,
      timesheets: current.timesheets.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "approved",
              reviewedAt: new Date().toISOString(),
              reviewedBy: reviewer,
              reviewNotes,
            }
          : entry,
      ),
    }));
  },
  async rejectTimesheet(id: string, reviewer: string, reviewNotes: string) {
    updateStore((current) => ({
      ...current,
      timesheets: current.timesheets.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "rejected",
              reviewedAt: new Date().toISOString(),
              reviewedBy: reviewer,
              reviewNotes,
            }
          : entry,
      ),
    }));
  },
  async getTimesheetSummary() {
    const timesheets = readStore().timesheets;
    return {
      pending: timesheets.filter((entry) => entry.status === "submitted").length,
      approved: timesheets.filter((entry) => entry.status === "approved").length,
      rejected: timesheets.filter((entry) => entry.status === "rejected").length,
      totalHours: timesheets.reduce((sum, entry) => sum + sumTimesheet(entry), 0),
    };
  },
};
