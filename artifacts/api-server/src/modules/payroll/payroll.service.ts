import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import {
  type BusinessStore,
  type SalaryRecord,
  createId,
  effectiveHourlyRate,
  effectiveMonthlySalary,
  loadEmployeeProfile,
  loadEmployees,
  monthScopedTimesheetId,
  normalizeDate,
  normalizeWeekStart,
  nowIso,
  pushAuditEvent,
  readStore,
  salaryMatchesTimesheetMonth,
  sumTimesheetHours,
  timesheetMonthBreakdowns,
  updateStore,
} from "../../lib/business-store";
import { assertEmployeeSelfAccess, assertTenantAccess } from "../../lib/policies";
import { hashSha256 } from "../../lib/security";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { assertFinancialAccount, availableFundsByAccount, preferredFinancialAccount } from "../../lib/financial-accounts";

export type SalaryActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type SalaryInput = {
  id?: string;
  accountId?: string;
  employeeId?: string;
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
  code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_input" | "conflict";

  constructor(code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_input" | "conflict", message: string) {
    super(message);
    this.code = code;
  }
}

function tenantSalaryFilter(salary: SalaryRecord, tenantId: string) {
  return (salary.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function payrollMonthKey(value: string) {
  return normalizeWeekStart(value).slice(0, 7);
}

async function reconcileTimesheetPayroll(tenantId: string, employeeId?: string | null) {
  const employees = (await loadEmployees(tenantId)).filter(
    (employee) =>
      (
        (employee.payType === "monthly" && effectiveMonthlySalary(employee) > 0) ||
        (employee.payType === "hourly" && effectiveHourlyRate(employee) > 0)
      ) &&
      (!employeeId || employee.id === employeeId),
  );
  if (employees.length === 0) {
    return;
  }

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const store = await readStore();
  const approvedTimesheets = store.timesheets.filter(
    (timesheet) =>
      timesheet.status === "approved" &&
      employeeById.has(timesheet.employeeId),
  );
  const approvedMonthlyGroups = new Map<string, typeof store.timesheets>();

  for (const timesheet of approvedTimesheets) {
    const employee = employeeById.get(timesheet.employeeId);
    if (employee?.payType !== "monthly") {
      continue;
    }
    const key = `${timesheet.employeeId}:${payrollMonthKey(timesheet.weekStart)}`;
    approvedMonthlyGroups.set(key, [...(approvedMonthlyGroups.get(key) ?? []), timesheet]);
  }

  const needsHourlyReconciliation = approvedTimesheets.some((timesheet) => {
    const employee = employeeById.get(timesheet.employeeId);
    if (employee?.payType !== "hourly") {
      return false;
    }
    const rate = effectiveHourlyRate(employee);
    return timesheetMonthBreakdowns(timesheet).some((breakdown) => {
      const existing = store.salaries.find(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salaryMatchesTimesheetMonth(salary, timesheet.id, breakdown.monthKey),
      );
      return (
        !existing ||
        (
          existing.status === "pending" &&
          (
            Number(existing.hours ?? 0) !== breakdown.hours ||
            Number(existing.rate ?? 0) !== rate ||
            existing.amount !== Math.round(breakdown.hours * rate)
          )
        )
      );
    });
  });

  const needsMonthlyReconciliation = Array.from(approvedMonthlyGroups.entries()).some(
    ([key, timesheets]) => {
      const [groupEmployeeId = "", monthKey = ""] = key.split(":");
      const existing = store.salaries.find(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salary.employeeId === groupEmployeeId &&
          salary.rate == null &&
          payrollMonthKey(salary.weekStart ?? salary.date) === monthKey,
      );
      const hours = timesheets.reduce((total, timesheet) => total + sumTimesheetHours(timesheet), 0);
      return !existing || (existing.status === "pending" && Number(existing.hours ?? 0) !== hours);
    },
  );

  const needsReconciliation = needsHourlyReconciliation || needsMonthlyReconciliation;
  if (!needsReconciliation) {
    return;
  }

  await updateStore((current) => {
    const nextSalaries = [...current.salaries];
    const updatedAt = nowIso();
    const currentApprovedGroups = new Map<string, typeof current.timesheets>();

    for (const timesheet of current.timesheets) {
      if (
        timesheet.status !== "approved" ||
        !employeeById.has(timesheet.employeeId)
      ) {
        continue;
      }
      const employee = employeeById.get(timesheet.employeeId);
      if (employee?.payType === "hourly") {
        const rate = effectiveHourlyRate(employee);
        for (const breakdown of timesheetMonthBreakdowns(timesheet)) {
          const existingIndex = nextSalaries.findIndex(
            (salary) =>
              tenantSalaryFilter(salary, tenantId) &&
              salary.source === "timesheet" &&
              salaryMatchesTimesheetMonth(salary, timesheet.id, breakdown.monthKey),
          );
          const existing = existingIndex >= 0 ? nextSalaries[existingIndex] : undefined;
          if (existing?.status === "paid") {
            continue;
          }

          const salary: SalaryRecord = {
            id: existing?.id ?? createId("sal"),
            tenantId,
            accountId: existing?.accountId,
            employeeId: employee.id,
            employeeNameSnapshot: employee.name,
            amount: Math.round(breakdown.hours * rate),
            date: existing?.date ?? updatedAt,
            note: existing?.note || `Timesheet payout for ${breakdown.monthKey}`,
            status: "pending",
            source: "timesheet",
            weekStart: breakdown.firstWorkDate,
            hours: breakdown.hours,
            rate,
            timesheetId: existing?.timesheetId ?? monthScopedTimesheetId(timesheet.id, breakdown.monthKey),
            createdAt: existing?.createdAt ?? updatedAt,
            updatedAt,
          };

          if (existingIndex >= 0) {
            nextSalaries[existingIndex] = salary;
          } else {
            nextSalaries.unshift(salary);
          }
        }
        continue;
      }

      const key = `${timesheet.employeeId}:${payrollMonthKey(timesheet.weekStart)}`;
      currentApprovedGroups.set(key, [...(currentApprovedGroups.get(key) ?? []), timesheet]);
    }

    for (const [key, timesheets] of currentApprovedGroups) {
      const [groupEmployeeId = "", monthKey = ""] = key.split(":");
      const employee = employeeById.get(groupEmployeeId);
      if (!employee) {
        continue;
      }
      const sortedTimesheets = [...timesheets].sort((left, right) =>
        left.weekStart.localeCompare(right.weekStart),
      );
      const hours = sortedTimesheets.reduce(
        (total, timesheet) => total + sumTimesheetHours(timesheet),
        0,
      );
      const existingIndex = nextSalaries.findIndex(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salary.employeeId === employee.id &&
          salary.rate == null &&
          payrollMonthKey(salary.weekStart ?? salary.date) === monthKey,
      );
      const existing = existingIndex >= 0 ? nextSalaries[existingIndex] : undefined;
      if (existing?.status === "paid") {
        continue;
      }

      const firstTimesheet = sortedTimesheets[0];
      if (!firstTimesheet) {
        continue;
      }
      const salary: SalaryRecord = {
        id: existing?.id ?? createId("sal"),
        tenantId,
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        amount: effectiveMonthlySalary(employee),
        date: existing?.date ?? updatedAt,
        note: existing?.note || `Monthly salary for ${monthKey}`,
        status: "pending",
        source: "timesheet",
        weekStart: existing?.weekStart ?? firstTimesheet.weekStart,
        hours,
        rate: undefined,
        timesheetId: existing?.timesheetId ?? firstTimesheet.id,
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      };

      if (existingIndex >= 0) {
        nextSalaries[existingIndex] = salary;
      } else {
        nextSalaries.unshift(salary);
      }
    }

    return { ...current, salaries: nextSalaries };
  });
}

function ensureFunds(store: BusinessStore, amount: number, label: string, tenantId: string, accountId: string) {
  const required = Math.abs(Number(amount ?? 0));
  const available = availableFundsByAccount(store, tenantId, accountId);
  if (required > available) {
    throw new SalaryServiceError(
      "insufficient_funds",
      `Insufficient funds in the selected account for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`,
    );
  }
}

function summarizeSalary(salary: Pick<SalaryRecord, "accountId" | "employeeId" | "employeeNameSnapshot" | "amount" | "date" | "note" | "status" | "source" | "paidAt" | "weekStart" | "hours" | "rate" | "timesheetId">) {
  return {
    accountId: salary.accountId ?? null,
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
    "accountId",
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

function requestHashForSalaryPay(input: { salaryId: string; note?: string; accountId?: string | null }) {
  return hashSha256(
    JSON.stringify({
      salaryId: input.salaryId.trim(),
      note: input.note?.trim() ?? "",
      accountId: input.accountId?.trim() ?? "",
    }),
  );
}

async function claimSalaryPayIdempotency(actor: SalaryActor, key: string, requestHash: string) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
      scope: "salary_pay",
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
        eq(idempotencyKeysTable.scope, "salary_pay"),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new SalaryServiceError("conflict", "Unable to acquire idempotency lock for this salary pay request.");
  }
  if (row.requestHash !== requestHash) {
    throw new SalaryServiceError("conflict", "This idempotency key is already used for a different salary pay payload.");
  }

  return { row, created: false };
}

export async function listSalariesForActor(tenantId: string, requesterRole?: string, requesterUserId?: string, employeeId?: string | null) {
  await reconcileTimesheetPayroll(
    tenantId,
    employeeId ?? (requesterRole === "employee" ? requesterUserId : null),
  );
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
  if (requesterRole === "employee" && !salary.employeeId) {
    throw new SalaryServiceError("forbidden", "Forbidden");
  }
  assertEmployeeSelfAccess(salary.employeeId, requesterRole, requesterUserId, () => new SalaryServiceError("forbidden", "Forbidden"));

  return salary;
}

export async function saveSalary(
  input: SalaryInput,
  actor: SalaryActor,
): Promise<{ salary: SalaryRecord; created: boolean; existing: SalaryRecord | null; action: "created" | "updated" | "paid" }> {
  const normalizedEmployeeId = input.employeeId?.trim() || undefined;
  const employee = normalizedEmployeeId ? await loadEmployeeProfile(normalizedEmployeeId, actor.tenantId) : null;
  if (normalizedEmployeeId && !employee) {
    throw new SalaryServiceError("not_found", "Employee not found");
  }
  if (!normalizedEmployeeId && !(input.employeeNameSnapshot?.trim())) {
    throw new SalaryServiceError("invalid_input", "Enter the former employee name for this historical salary.");
  }
  if (!normalizedEmployeeId && (input.status ?? "pending") !== "paid") {
    throw new SalaryServiceError("invalid_input", "Former employee salary records must be saved as historical paid entries.");
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
    const selectedAccountId = input.accountId?.trim() || existing?.accountId;
    if (status === "paid") {
      if (!selectedAccountId) {
        throw new SalaryServiceError("invalid_input", "Select a financial account before marking salary as paid.");
      }
      assertFinancialAccount(current, actor.tenantId, selectedAccountId, (message) => new SalaryServiceError("invalid_input", message));
    }
    const additionalRequired =
      status === "paid"
        ? !existing || existing.status !== "paid"
          ? nextAmount
          : Math.max(0, nextAmount - Math.abs(existing.amount))
        : 0;

    if (additionalRequired > 0) {
      ensureFunds(current, additionalRequired, "this salary payment", actor.tenantId, selectedAccountId!);
    }

    salary = {
      id: input.id ?? existing?.id ?? createId("sal"),
      tenantId: actor.tenantId,
      accountId: status === "paid" ? selectedAccountId : selectedAccountId,
      employeeId: normalizedEmployeeId,
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() || existing?.employeeNameSnapshot || employee?.name || "Former Employee",
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
          entityLabel: salary.employeeNameSnapshot ?? employee?.name ?? "Former Employee",
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
  options?: { idempotencyKey?: string | null; accountId?: string | null },
): Promise<{ salary: SalaryRecord; wasAlreadyPaid: boolean }> {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForSalaryPay({ salaryId: id, note, accountId: options?.accountId }) : null;
  const idempotencyClaim = idempotencyKey && requestHash ? await claimSalaryPayIdempotency(actor, idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const existingSalary = await getSalaryForActor(id, actor.tenantId);
      return { salary: existingSalary, wasAlreadyPaid: true };
    }
    throw new SalaryServiceError("conflict", "This salary pay request is already being processed. Please retry shortly.");
  }

  let salary: SalaryRecord | null = null;
  let wasAlreadyPaid = false;
  try {
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

      const selectedAccountId =
        options?.accountId?.trim() ||
        existing.accountId ||
        preferredFinancialAccount(current, actor.tenantId)?.id;
      if (!selectedAccountId) {
        throw new SalaryServiceError("invalid_input", "Select a financial account before paying salary.");
      }
      assertFinancialAccount(current, actor.tenantId, selectedAccountId, (message) => new SalaryServiceError("invalid_input", message));
      ensureFunds(current, existing.amount, "this salary payment", actor.tenantId, selectedAccountId);

      const paidAt = nowIso();
      salary = {
        ...existing,
        tenantId: actor.tenantId,
        accountId: selectedAccountId,
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

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: id,
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

  return { salary: salary!, wasAlreadyPaid };
}
