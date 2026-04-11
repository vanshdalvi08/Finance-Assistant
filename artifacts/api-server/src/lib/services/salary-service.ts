import { type ActorRole } from "@workspace/db/schema";
import {
  type BusinessStore,
  type ExpenseRecord,
  type FundRecord,
  type SalaryRecord,
  createId,
  loadEmployeeProfile,
  loadEmployees,
  normalizeDate,
  normalizeWeekStart,
  nowIso,
  pushAuditEvent,
  readStore,
  updateStore,
} from "../business-store";
import { assertEmployeeSelfAccess, assertTenantAccess } from "../policies";
import { DEFAULT_TENANT_ID } from "../tenants";

export type SalaryActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type SalaryInput = {
  id?: string;
  employeeId: string;
  employeeNameSnapshot?: string;
  amount: number;
  date?: string;
  note?: string;
  status?: "pending" | "paid";
  source?: "manual" | "timesheet";
  paidAt?: string;
  weekStart?: string;
  hours?: number;
  rate?: number;
  timesheetId?: string;
};

export class SalaryServiceError extends Error {
  code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_input";

  constructor(code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_input", message: string) {
    super(message);
    this.code = code;
  }
}

function paidSalaries(store: BusinessStore) {
  return store.salaries.filter((salary) => salary.status === "paid");
}

function approveExpenses(store: BusinessStore) {
  return store.expenses.filter((expense) => expense.status === "approved");
}

function tenantExpenseFilter(expense: ExpenseRecord, tenantId: string) {
  return (expense.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return (fund.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
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
    throw new SalaryServiceError(
      "insufficient_funds",
      `Insufficient total funds for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`,
    );
  }
}

function summarizeSalary(salary: Pick<SalaryRecord, "employeeId" | "employeeNameSnapshot" | "amount" | "date" | "note" | "status" | "source" | "paidAt" | "weekStart" | "hours" | "rate" | "timesheetId">) {
  return {
    employeeId: salary.employeeId,
    employeeNameSnapshot: salary.employeeNameSnapshot ?? null,
    amount: salary.amount,
    date: salary.date,
    note: salary.note,
    status: salary.status,
    source: salary.source,
    paidAt: salary.paidAt ?? null,
    weekStart: salary.weekStart ?? null,
    hours: salary.hours ?? null,
    rate: salary.rate ?? null,
    timesheetId: salary.timesheetId ?? null,
  };
}

function changedSalaryFields(previous: SalaryRecord | null, next: SalaryRecord) {
  const candidates: Array<keyof ReturnType<typeof summarizeSalary>> = [
    "employeeId",
    "employeeNameSnapshot",
    "amount",
    "date",
    "note",
    "status",
    "source",
    "paidAt",
    "weekStart",
    "hours",
    "rate",
    "timesheetId",
  ];
  if (!previous) {
    return candidates;
  }
  const before = summarizeSalary(previous);
  const after = summarizeSalary(next);
  return candidates.filter((key) => before[key] !== after[key]);
}

export async function listSalariesForActor(tenantId: string, requesterRole?: string, requesterUserId?: string, employeeId?: string | null) {
  const store = await readStore();
  const tenantEmployees = await loadEmployees(tenantId);
  const tenantEmployeeIds = new Set(tenantEmployees.map((employee) => employee.id));
  if (employeeId && !tenantEmployeeIds.has(employeeId)) {
    throw new SalaryServiceError("forbidden", "Forbidden");
  }

  let salaries = [...store.salaries]
    .filter((salary) => tenantSalaryFilter(salary, tenantId))
    .sort((left, right) => new Date(right.paidAt ?? right.date).getTime() - new Date(left.paidAt ?? left.date).getTime());

  if (employeeId) {
    salaries = salaries.filter((salary) => salary.employeeId === employeeId);
  } else if (requesterRole !== "admin") {
    salaries = salaries.filter((salary) => salary.employeeId === requesterUserId);
  }

  return salaries;
}

export async function getSalaryForActor(id: string, tenantId: string, requesterRole?: string, requesterUserId?: string) {
  const store = await readStore();
  const salary = store.salaries.find((item) => item.id === id);
  if (!salary) {
    throw new SalaryServiceError("not_found", "Salary not found");
  }

  assertTenantAccess(salary.tenantId, tenantId, () => new SalaryServiceError("forbidden", "Forbidden"));
  assertEmployeeSelfAccess(salary.employeeId, requesterRole, requesterUserId, () => new SalaryServiceError("forbidden", "Forbidden"));

  return salary;
}

export async function saveSalary(
  input: SalaryInput,
  actor: SalaryActor,
): Promise<{ salary: SalaryRecord; created: boolean; existing: SalaryRecord | null; action: "created" | "updated" | "paid" }> {
  const employee = await loadEmployeeProfile(input.employeeId, actor.tenantId);
  if (!employee) {
    throw new SalaryServiceError("not_found", "Employee not found");
  }

  let salary: SalaryRecord | null = null;
  let created = false;
  let existing: SalaryRecord | null = null;
  let action: "created" | "updated" | "paid" = "updated";

  await updateStore((current) => {
    existing = input.id ? current.salaries.find((item) => item.id === input.id) ?? null : null;
    if (existing) {
      assertTenantAccess(existing.tenantId, actor.tenantId, () => new SalaryServiceError("forbidden", "Forbidden"));
    }

    const nextAmount = Math.abs(input.amount);
    if (nextAmount <= 0) {
      throw new SalaryServiceError("invalid_input", "Salary amount must be greater than zero.");
    }
    const status = input.status ?? existing?.status ?? "pending";
    const additionalRequired =
      status === "paid"
        ? !existing || existing.status !== "paid"
          ? nextAmount
          : Math.max(0, nextAmount - Math.abs(existing.amount))
        : 0;

    if (additionalRequired > 0) {
      ensureFunds(current, additionalRequired, "this salary payment", actor.tenantId);
    }

    salary = {
      id: input.id ?? existing?.id ?? createId("sal"),
      tenantId: actor.tenantId,
      employeeId: input.employeeId.trim(),
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() || existing?.employeeNameSnapshot || employee.name,
      amount: nextAmount,
      date: normalizeDate(input.date ?? existing?.date ?? nowIso()),
      note: input.note?.trim() || existing?.note || "",
      status,
      source: input.source ?? existing?.source ?? "manual",
      paidAt: input.paidAt
        ? normalizeDate(input.paidAt)
        : status === "paid"
          ? existing?.paidAt ?? nowIso()
          : existing?.paidAt,
      weekStart: input.weekStart ? normalizeWeekStart(input.weekStart) : existing?.weekStart,
      hours: input.hours ?? existing?.hours,
      rate: input.rate ?? existing?.rate,
      timesheetId: input.timesheetId?.trim() || existing?.timesheetId,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    created = !existing;
    action = existing ? (status === "paid" && existing.status !== "paid" ? "paid" : "updated") : "created";
    const summary =
      action === "created"
        ? `Created a salary record for ${salary.employeeNameSnapshot ?? "employee"}.`
        : action === "paid"
          ? "Marked a salary record as paid."
          : "Updated a salary record.";

    return pushAuditEvent(
      {
        ...current,
        salaries: existing ? current.salaries.map((item) => (item.id === salary!.id ? salary! : item)) : [salary, ...current.salaries],
      },
      {
        ...actor,
        action,
        entityType: "salary",
        entityId: salary.id,
        summary,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: salary.employeeNameSnapshot ?? employee.name,
          requestId: actor.requestId,
          changedFields: changedSalaryFields(existing, salary),
          before: existing ? summarizeSalary(existing) : null,
          after: summarizeSalary(salary),
          context: { operation: action === "paid" ? "salary_mark_paid" : action === "created" ? "salary_create" : "salary_update" },
        },
      },
    );
  });

  return { salary: salary!, created, existing, action };
}

export async function deleteSalary(id: string, actor: SalaryActor) {
  let salary: SalaryRecord | null = null;
  await updateStore((current) => {
    salary = current.salaries.find((item) => item.id === id) ?? null;
    if (!salary) {
      throw new SalaryServiceError("not_found", "Salary not found");
    }

    assertTenantAccess(salary.tenantId, actor.tenantId, () => new SalaryServiceError("forbidden", "Forbidden"));

    return pushAuditEvent(
      {
        ...current,
        salaries: current.salaries.filter((item) => item.id !== id),
      },
      {
        ...actor,
        action: "deleted",
        entityType: "salary",
        entityId: id,
        summary: "Deleted a salary record.",
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: salary.employeeNameSnapshot || undefined,
          requestId: actor.requestId,
          changedFields: ["deleted"],
          before: summarizeSalary(salary),
          after: null,
          context: { operation: "salary_delete" },
        },
      },
    );
  });
  return salary!;
}

export async function paySalary(
  id: string,
  note: string | undefined,
  actor: SalaryActor,
): Promise<{ salary: SalaryRecord; wasAlreadyPaid: boolean }> {
  let salary: SalaryRecord | null = null;
  let wasAlreadyPaid = false;

  await updateStore((current) => {
    const existing = current.salaries.find((item) => item.id === id);
    if (!existing) {
      throw new SalaryServiceError("not_found", "Salary not found");
    }

    assertTenantAccess(existing.tenantId, actor.tenantId, () => new SalaryServiceError("forbidden", "Forbidden"));

    if (existing.status === "paid") {
      salary = existing;
      wasAlreadyPaid = true;
      return current;
    }

    ensureFunds(current, existing.amount, "this salary payment", actor.tenantId);

    const paidAt = nowIso();
    salary = {
      ...existing,
      tenantId: actor.tenantId,
      status: "paid",
      paidAt,
      date: paidAt,
      note: note?.trim() || existing.note,
      updatedAt: paidAt,
    };

    return pushAuditEvent(
      {
        ...current,
        salaries: current.salaries.map((item) => (item.id === salary!.id ? salary! : item)),
      },
      {
        ...actor,
        action: "paid",
        entityType: "salary",
        entityId: salary.id,
        summary: "Marked a salary record as paid.",
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: salary.employeeNameSnapshot || undefined,
          requestId: actor.requestId,
          changedFields: changedSalaryFields(existing, salary),
          before: summarizeSalary(existing),
          after: summarizeSalary(salary),
          context: { operation: "salary_pay" },
        },
      },
    );
  });

  return { salary: salary!, wasAlreadyPaid };
}
