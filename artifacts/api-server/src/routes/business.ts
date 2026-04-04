import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  DAY_KEYS,
  type ApprovalStatus,
  type BusinessStore,
  type DayKey,
  type ExpenseCategoryRecord,
  type ExpenseRecord,
  type FundRecord,
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
} from "../lib/business-store";
import { resolveExpenseAttachmentUrl } from "../lib/storage";

const router: IRouter = Router();

const dateSchema = z.string().min(1);
const dayKeySchema = z.enum(DAY_KEYS as [DayKey, ...DayKey[]]);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);
const employeeScopeSchema = z.object({
  employeeId: z.string().uuid().optional(),
});

const businessIdSchema = z.string().trim().min(1);

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

const projectTaskSchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
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
  amount: z.coerce.number().min(0),
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

function availableFunds(store: BusinessStore) {
  const totalFunds = store.funds.reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const spentExpenses = approveExpenses(store).reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const spentSalary = paidSalaries(store).reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);
  return Math.max(0, Number((totalFunds - spentExpenses - spentSalary).toFixed(2)));
}

function ensureFunds(store: BusinessStore, amount: number, label: string) {
  const required = Math.abs(Number(amount ?? 0));
  const available = availableFunds(store);
  if (required > available) {
    throw new Error(`Insufficient total funds for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`);
  }
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

async function serializeExpense(expense: ExpenseRecord) {
  return {
    ...expense,
    attachmentUrl: await resolveExpenseAttachmentUrl(expense.attachmentPath),
  };
}

async function serializeExpenses(expenses: ExpenseRecord[]) {
  return Promise.all(expenses.map((expense) => serializeExpense(expense)));
}

router.use(requireAuth);

router.get("/overview", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const employees = await loadEmployees();
  const approved = approveExpenses(store);
  const totalFunds = store.funds.reduce((sum, fund) => sum + Math.abs(fund.amount), 0);
  const totalExpenses = approved.reduce((sum, expense) => sum + Math.abs(expense.amount), 0);
  const totalSalaryPaid = paidSalaries(store).reduce((sum, salary) => sum + Math.abs(salary.amount), 0);
  const currentBalance = availableFunds(store);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear();

  response.json({
    totalFunds,
    totalExpenses,
    totalSalaryPaid,
    activeEmployees: employees.filter((employee) => employee.status === "active").length,
    currentBalance,
    pendingExpenses: store.expenses.filter((expense) => expense.status === "submitted").length,
    pendingTimesheets: store.timesheets.filter((entry) => entry.status === "submitted").length,
    monthToDateFunds: store.funds.filter((fund) => fund.date.slice(0, 7) === currentMonth).reduce((sum, fund) => sum + fund.amount, 0),
    monthToDateExpenses: approved.filter((expense) => expense.date.slice(0, 7) === currentMonth).reduce((sum, expense) => sum + expense.amount, 0),
    yearToDateFunds: store.funds.filter((fund) => new Date(fund.date).getFullYear() === currentYear).reduce((sum, fund) => sum + fund.amount, 0),
    yearToDateExpenses: approved.filter((expense) => new Date(expense.date).getFullYear() === currentYear).reduce((sum, expense) => sum + expense.amount, 0),
  });
});

router.get("/charts", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
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
  for (const fund of store.funds) {
    const bucket = buckets.get(fund.date.slice(0, 7));
    if (bucket) {
      bucket.funds += Math.abs(fund.amount);
    }
  }
  for (const expense of approveExpenses(store)) {
    const bucket = buckets.get(expense.date.slice(0, 7));
    if (bucket) {
      bucket.expenses += Math.abs(expense.amount);
    }
  }
  for (const salary of paidSalaries(store)) {
    const bucket = buckets.get((salary.paidAt ?? salary.date).slice(0, 7));
    if (bucket) {
      bucket.salary += Math.abs(salary.amount);
    }
  }

  response.json({
    finance: months.map(({ month, funds, expenses, salary }) => ({ month, funds, expenses, salary })),
    expenseCategories: Array.from(
      approveExpenses(store).reduce((map, expense) => {
        map.set(expense.category, (map.get(expense.category) ?? 0) + Math.abs(expense.amount));
        return map;
      }, new Map<string, number>()),
    ).map(([name, value]) => ({ name, value })).sort((left, right) => right.value - left.value),
  });
});

router.get("/transactions", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  const employees = await loadEmployees();
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const transactions = [
    ...store.funds.map((fund) => ({
      id: `tx_${fund.id}`,
      type: "fund" as const,
      amount: Math.abs(fund.amount),
      date: fund.date,
      description: fund.source,
      category: "Funds",
    })),
    ...approveExpenses(store).map((expense) => ({
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

  response.json({ transactions });
});

router.get("/audit-trail", requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  response.json({ auditTrail: [...store.auditTrail].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()) });
});

router.route("/funds").get(requireRole("admin"), async (_request, response) => {
  const store = await readStore();
  response.json({ funds: [...store.funds].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()) });
}).post(requireRole("admin"), async (request, response) => {
  const parsed = fundSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid fund payload" });
    return;
  }

  const store = await readStore();
  const existing = parsed.data.id ? store.funds.find((fund) => fund.id === parsed.data.id) : null;
  const fund: FundRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("fund"),
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
  response.status(existing ? 200 : 201).json({ fund });
});

router.route("/funds/:id").get(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const fund = store.funds.find((item) => item.id === request.params.id);
  if (!fund) {
    respondNotFound(response, "Fund not found");
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
  response.json({ fund });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const target = store.funds.find((fund) => fund.id === request.params.id);
  if (!target) {
    respondNotFound(response, "Fund not found");
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
          expense.category === existing.name ? { ...expense, category: category.name, group: category.group, updatedAt: nowIso() } : expense,
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
      expense.category === existing.name ? { ...expense, category: category.name, group: category.group, updatedAt: nowIso() } : expense,
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
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  let expenses = store.expenses;

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
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId?.trim() || undefined;
  const employee = employeeId ? await loadEmployeeProfile(employeeId) : null;
  const existing = parsed.data.id ? store.expenses.find((expense) => expense.id === parsed.data.id) : null;
  const status = parsed.data.status ?? existing?.status ?? "submitted";

  if (status === "approved" && (!existing || existing.status !== "approved")) {
    ensureFunds(store, parsed.data.amount, "this expense");
  }

  const expense: ExpenseRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("exp"),
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
  response.status(existing ? 200 : 201).json({ expense: await serializeExpense(expense) });
});

router.route("/expenses/:id").get(async (request, response) => {
  const store = await readStore();
  const expense = store.expenses.find((item) => item.id === request.params.id);
  if (!expense) {
    respondNotFound(response, "Expense not found");
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
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const status = parsed.data.status ?? existing.status;
  if (status === "approved" && existing.status !== "approved") {
    ensureFunds(store, parsed.data.amount, "this expense");
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
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
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
  const existing = store.expenses.find((expense) => expense.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Expense not found");
    return;
  }

  if (parsed.data.status === "approved" && existing.status !== "approved") {
    ensureFunds(store, existing.amount, "this expense");
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
  response.json({ expense: await serializeExpense(expense) });
});

router.get("/salaries", async (request, response) => {
  const store = await readStore();
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  let salaries = [...store.salaries].sort(
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
  const existing = parsed.data.id ? store.salaries.find((salary) => salary.id === parsed.data.id) : null;
  const employee = await loadEmployeeProfile(parsed.data.employeeId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const status = parsed.data.status ?? existing?.status ?? "pending";
  if (status === "paid" && (!existing || existing.status !== "paid")) {
    ensureFunds(store, parsed.data.amount, "this salary payment");
  }

  const salary: SalaryRecord = {
    id: parsed.data.id ?? existing?.id ?? createId("sal"),
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

  const employee = await loadEmployeeProfile(parsed.data.employeeId);
  if (!employee) {
    respondNotFound(response, "Employee not found");
    return;
  }

  const status = parsed.data.status ?? existing.status;
  if (status === "paid" && existing.status !== "paid") {
    ensureFunds(store, parsed.data.amount, "this salary payment");
  }

  const salary: SalaryRecord = {
    ...existing,
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
  response.json({ salary });
}).delete(requireRole("admin"), async (request, response) => {
  const store = await readStore();
  const salary = store.salaries.find((item) => item.id === request.params.id);
  if (!salary) {
    respondNotFound(response, "Salary not found");
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

  if (existing.status !== "paid") {
    ensureFunds(store, existing.amount, "this salary payment");
  }

  const salary: SalaryRecord = {
    ...existing,
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
  response.json({ salary });
});

router.get("/timesheets", async (request, response) => {
  const store = await readStore();
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  let timesheets = store.timesheets
    .filter((entry) => entry.status !== "draft" || timesheetHasContent(entry))
    .sort((left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime());

  if (employeeId) {
    timesheets = timesheets.filter((entry) => entry.employeeId === employeeId);
  } else if (request.auth?.user.role !== "admin") {
    timesheets = timesheets.filter((entry) => entry.employeeId === request.auth?.user.id);
  }

  response.json({ timesheets });
});

router.get("/timesheets/summary", async (request, response) => {
  const store = await readStore();
  const employeeId = scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId);
  const timesheets = employeeId ? store.timesheets.filter((entry) => entry.employeeId === employeeId) : store.timesheets;

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
  const timesheet = store.timesheets.find(
    (entry) => entry.employeeId === employeeId && normalizeWeekStart(entry.weekStart) === normalizeWeekStart(weekStart),
  );

  response.json({ timesheet: timesheet ?? null });
});

router.get("/timesheets/:id", async (request, response) => {
  const store = await readStore();
  const timesheet = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!timesheet) {
    respondNotFound(response, "Timesheet not found");
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
  const employeeId = request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId;
  const employee = await loadEmployeeProfile(employeeId);
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
      const next = pushAuditEvent(
        {
          ...store,
          timesheets: store.timesheets.filter((item) => item.id !== entry.id),
        },
        {
          ...actor,
          action: "deleted",
          entityType: "timesheet",
          entityId: entry.id,
          summary: `Removed an empty draft for week of ${entry.weekStart}.`,
        },
      );
      await updateStore(() => next);
    }

    response.status(existing ? 200 : 201).json({ timesheet: entry });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      timesheets: existing ? store.timesheets.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...store.timesheets],
    },
    {
      actorName: actor.actorName,
      actorRole: request.auth?.user.role ?? "system",
      action: existing ? "saved" : "created",
      entityType: "timesheet",
      entityId: entry.id,
      summary: `${existing ? "Saved" : "Started"} timesheet draft for week of ${entry.weekStart}.`,
    },
  );

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ timesheet: entry });
});

router.patch("/timesheets/:id", async (request, response) => {
  const parsed = timesheetSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timesheet payload" });
    return;
  }

  const store = await readStore();
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
  const employee = await loadEmployeeProfile(employeeId);
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

  const next = pushAuditEvent(
    {
      ...store,
      timesheets: store.timesheets.map((item) => (item.id === entry.id ? entry : item)),
    },
    {
      ...recordActor(request),
      action: "saved",
      entityType: "timesheet",
      entityId: entry.id,
      summary: `Saved timesheet draft for week of ${entry.weekStart}.`,
    },
  );

  await updateStore(() => next);
  response.json({ timesheet: entry });
});

router.post("/timesheets/:id/submit", async (request, response) => {
  const store = await readStore();
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  if (request.auth?.user.role === "employee" && existing.employeeId !== request.auth.user.id) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const next = pushAuditEvent(
    {
      ...store,
      timesheets: store.timesheets.map((entry) =>
        entry.id === request.params.id
          ? {
              ...entry,
              status: "submitted",
              submittedAt: nowIso(),
              reviewedAt: undefined,
              reviewedBy: undefined,
              reviewNotes: undefined,
              updatedAt: nowIso(),
            }
          : entry,
      ),
    },
    {
      ...recordActor(request),
      action: "submitted",
      entityType: "timesheet",
      entityId: String(request.params.id),
      summary: "Submitted a timesheet for review.",
    },
  );

  await updateStore(() => next);
  response.json({ timesheet: next.timesheets.find((entry) => entry.id === request.params.id) ?? existing });
});

router.post("/timesheets/:id/approve", requireRole("admin"), async (request, response) => {
  const parsed = z.object({ note: z.string().trim().optional() }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid approval payload" });
    return;
  }

  const store = await readStore();
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  const employee = await loadEmployeeProfile(existing.employeeId);
  const now = nowIso();
  const nextTimesheets = store.timesheets.map((entry) =>
    entry.id === request.params.id
      ? {
          ...entry,
          status: "approved" as const,
          reviewedAt: now,
          reviewedBy: request.auth?.user.name ?? "Admin",
          reviewNotes: parsed.data.note?.trim() || undefined,
          updatedAt: now,
        }
      : entry,
  );

  let nextSalaries = store.salaries;
  if (employee && employee.payType === "hourly" && effectiveHourlyRate(employee) > 0) {
    const hours = sumTimesheetHours(existing);
    const rate = effectiveHourlyRate(employee);
    const amount = Math.round(hours * rate);
    const existingPayroll = store.salaries.find((salary) => salary.timesheetId === existing.id);
    const payroll: SalaryRecord = {
      id: existingPayroll?.id ?? createId("sal"),
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      amount,
      date: now,
      note: parsed.data.note?.trim() || `Timesheet payout for week of ${existing.weekStart}`,
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

    nextSalaries = existingPayroll
      ? store.salaries.map((salary) => (salary.id === existingPayroll.id ? payroll : salary))
      : [payroll, ...store.salaries];
  }

  const next = pushAuditEvent(
    {
      ...store,
      timesheets: nextTimesheets,
      salaries: nextSalaries,
    },
    {
      actorName: request.auth?.user.name ?? "Admin",
      actorRole: "admin",
      action: "approved",
      entityType: "timesheet",
      entityId: String(request.params.id),
      summary: `Approved timesheet for ${existing.employeeNameSnapshot}.`,
    },
  );

  await updateStore(() => next);
  response.json({ timesheet: next.timesheets.find((entry) => entry.id === request.params.id) ?? existing });
});

router.post("/timesheets/:id/reject", requireRole("admin"), async (request, response) => {
  const parsed = z.object({ note: z.string().trim().min(1) }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid rejection payload" });
    return;
  }

  const store = await readStore();
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
    return;
  }

  const now = nowIso();
  const next = pushAuditEvent(
    {
      ...store,
      timesheets: store.timesheets.map((entry) =>
        entry.id === request.params.id
          ? {
              ...entry,
              status: "rejected" as const,
              reviewedAt: now,
              reviewedBy: request.auth?.user.name ?? "Admin",
              reviewNotes: parsed.data.note,
              updatedAt: now,
            }
          : entry,
      ),
    },
    {
      actorName: request.auth?.user.name ?? "Admin",
      actorRole: "admin",
      action: "reverted",
      entityType: "timesheet",
      entityId: String(request.params.id),
      summary: "Returned a timesheet for changes.",
    },
  );

  await updateStore(() => next);
  response.json({ timesheet: next.timesheets.find((entry) => entry.id === request.params.id) ?? existing });
});

router.delete("/timesheets/:id", async (request, response) => {
  const store = await readStore();
  const existing = store.timesheets.find((entry) => entry.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Timesheet not found");
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
  response.json({
    projectBudgets: [...store.projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
    projects: [...store.projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
  });
});

router.get("/projects/catalog", async (_request, response) => {
  const store = await readStore();
  const projects = [...store.projectBudgets]
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
  const employees = await loadEmployees();
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
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
      const budget = store.projectBudgets.find((item) => item.project === project);
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

  for (const expense of store.expenses.filter((item) => item.status === "approved")) {
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
  const names = new Set<string>();

  for (const entry of store.timesheets) {
    for (const line of entry.lines) {
      if (line.project.trim()) {
        names.add(line.project.trim());
      }
    }
  }

  for (const expense of store.expenses) {
    if (expense.project?.trim()) {
      names.add(expense.project.trim());
    }
  }

  for (const budget of store.projectBudgets) {
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
  const existing = parsed.data.id ? store.projectBudgets.find((budget) => budget.id === parsed.data.id) : null;
  const budget: ProjectBudget = {
    id: parsed.data.id ?? existing?.id ?? createId("pb"),
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing?.client,
    note: parsed.data.note?.trim() || existing?.note,
    tasks: (parsed.data.tasks ?? existing?.tasks ?? []).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
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

  const budget: ProjectBudget = {
    ...existing,
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing.client,
    note: parsed.data.note?.trim() || existing.note,
    tasks: (parsed.data.tasks ?? existing.tasks).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
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

  const task: ProjectBudget["tasks"][number] = {
    id: parsed.data.id ?? createId("pbt"),
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || undefined,
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
  response.json({
    purchaseOrders: [...store.purchaseOrders].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  });
});

router.post("/purchase-orders", requireRole("admin"), async (request, response) => {
  const parsed = poSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order payload" });
    return;
  }

  const store = await readStore();
  const existing = parsed.data.id ? store.purchaseOrders.find((order) => order.id === parsed.data.id) : null;
  const tasks = (parsed.data.tasks ?? existing?.tasks ?? []).filter((task) => task.taskName.trim() && Number(task.amount) > 0).map((task) => ({
    id: task.id ?? createId("po_task"),
    taskName: task.taskName.trim(),
    description: task.description?.trim() || "",
    amount: Math.abs(Number(task.amount)),
    status: "pending" as const,
  }));
  const order: PurchaseOrder = {
    id: parsed.data.id ?? existing?.id ?? createId("po"),
    title: parsed.data.title.trim(),
    totalAmount: Math.abs(parsed.data.totalAmount),
    usedAmount: existing?.usedAmount ?? 0,
    remainingAmount: existing ? Math.max(0, existing.totalAmount - existing.usedAmount) : Math.abs(parsed.data.totalAmount),
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

  const totalAmount = Math.abs(parsed.data.totalAmount);
  if (totalAmount < existing.usedAmount) {
    response.status(400).json({ message: "Total fund amount cannot be less than the used amount." });
    return;
  }

  const purchaseOrder: PurchaseOrder = {
    ...existing,
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

  const task = {
    id: parsed.data.id ?? createId("po_task"),
    taskName: parsed.data.taskName.trim(),
    description: parsed.data.description?.trim() || "",
    amount: Math.abs(parsed.data.amount),
    status: "pending" as const,
  };

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

  if (task.status === "paid") {
    response.json({ purchaseOrder: order });
    return;
  }

  if (task.amount > order.remainingAmount) {
    response.status(400).json({ message: "Insufficient balance in PO fund" });
    return;
  }

  ensureFunds(store, task.amount, "this PO task payment");
  const now = nowIso();
  const next = pushAuditEvent(
    {
      ...store,
      expenses: [
        {
          id: createId("exp"),
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
  response.json({ purchaseOrder: next.purchaseOrders.find((item) => item.id === order.id) ?? order });
});

export default router;
