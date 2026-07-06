import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import {
  type BusinessStore,
  type SalaryRecord,
  createId,
  daysInCalendarMonth,
  effectiveHourlyRate,
  effectiveMonthlySalary,
  loadEmployeeProfile,
  loadEmployees,
  monthKey as calendarMonthKey,
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
  days?: number;
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

function monthKeyFromTimesheetId(value?: string): string | undefined {
  return value?.match(/:(\d{4}-\d{2})$/)?.[1];
}

function payrollMonthKey(value: string) {
  return calendarMonthKey(value);
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
  // For monthly employees, group by employeeId:actualCalendarMonth using breakdown dates
  const approvedMonthlyGroups = new Map<string, typeof store.timesheets>();

  for (const timesheet of approvedTimesheets) {
    const employee = employeeById.get(timesheet.employeeId);
    if (employee?.payType !== "monthly") {
      continue;
    }
    const breakdowns = timesheetMonthBreakdowns(timesheet);
    if (breakdowns.length === 0) {
      continue;
    }
    for (const breakdown of breakdowns) {
      const key = `${timesheet.employeeId}:${breakdown.monthKey}`;
      if (!approvedMonthlyGroups.has(key)) {
        approvedMonthlyGroups.set(key, []);
      }
      if (!approvedMonthlyGroups.get(key)!.includes(timesheet)) {
        approvedMonthlyGroups.get(key)!.push(timesheet);
      }
    }
  }

  const needsHourlyReconciliation = approvedTimesheets.some((timesheet) => {
    const employee = employeeById.get(timesheet.employeeId);
    if (employee?.payType !== "hourly") {
      return false;
    }
    const rate = effectiveHourlyRate(employee);
    const breakdowns = timesheetMonthBreakdowns(timesheet);
    const breakdownMonths = new Set(breakdowns.map((b) => b.monthKey));

    const hasMissingOrStaleRecords = breakdowns.some((breakdown) => {
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

    if (hasMissingOrStaleRecords) {
      return true;
    }

    // Also trigger reconcile if there are orphaned pending records from before
    // calendar-month splitting was introduced (plain timesheetId, wrong month)
    return store.salaries.some(
      (salary) =>
        tenantSalaryFilter(salary, tenantId) &&
        salary.source === "timesheet" &&
        salary.timesheetId === timesheet.id &&
        salary.status !== "paid" &&
        !breakdownMonths.has(payrollMonthKey(salary.weekStart ?? salary.date)),
    );
  });

  const needsMonthlyReconciliation = Array.from(approvedMonthlyGroups.entries()).some(
    ([key, timesheets]) => {
      const colonIdx = key.indexOf(":");
      const groupEmployeeId = key.slice(0, colonIdx);
      const monthKey = key.slice(colonIdx + 1);
      const employee = employeeById.get(groupEmployeeId);
      const monthlyAmount = employee ? effectiveMonthlySalary(employee) : 0;
      const existing = store.salaries.find(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salary.employeeId === groupEmployeeId &&
          salary.rate == null &&
          (
            payrollMonthKey(salary.weekStart ?? salary.date) === monthKey ||
            monthKeyFromTimesheetId(salary.timesheetId) === monthKey
          ),
      );
      let totalDays = 0;
      let totalHours = 0;
      for (const timesheet of timesheets) {
        for (const breakdown of timesheetMonthBreakdowns(timesheet)) {
          if (breakdown.monthKey === monthKey) {
            totalDays += breakdown.days;
            totalHours += breakdown.hours;
          }
        }
      }
      // Detect duplicate pending records for this employee/month (created by old reconciler bugs).
      const allForMonth = store.salaries.filter(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salary.employeeId === groupEmployeeId &&
          salary.rate == null &&
          salary.status === "pending" &&
          (
            payrollMonthKey(salary.weekStart ?? salary.date) === monthKey ||
            monthKeyFromTimesheetId(salary.timesheetId) === monthKey
          ),
      );
      if (allForMonth.length > 1) {
        return true;
      }
      // Preserve admin-added extra days but cap at the actual days in the month.
      const storedDays = Number(existing?.days ?? 0);
      const maxDays = daysInCalendarMonth(monthKey);
      const reconciledDays = Math.min(Math.max(totalDays, storedDays), maxDays);
      const reconciledAmount = monthlyAmount > 0
        ? Math.round(monthlyAmount / maxDays * reconciledDays)
        : 0;
      return (
        !existing ||
        (existing.status === "pending" && (
          Number(existing.hours ?? 0) !== totalHours ||
          storedDays !== reconciledDays ||
          existing.amount !== reconciledAmount
        ))
      );
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
        const breakdowns = timesheetMonthBreakdowns(timesheet);
        const breakdownMonths = new Set(breakdowns.map((b) => b.monthKey));

        for (const breakdown of breakdowns) {
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

        // Remove stale pending records from before calendar-month splitting:
        // plain timesheetId records whose weekStart month isn't in any current breakdown
        for (let i = nextSalaries.length - 1; i >= 0; i--) {
          const salary = nextSalaries[i];
          if (
            tenantSalaryFilter(salary, tenantId) &&
            salary.source === "timesheet" &&
            salary.timesheetId === timesheet.id &&
            salary.status !== "paid" &&
            !breakdownMonths.has(payrollMonthKey(salary.weekStart ?? salary.date))
          ) {
            nextSalaries.splice(i, 1);
          }
        }

        continue;
      }

      const breakdowns = timesheetMonthBreakdowns(timesheet);
      if (breakdowns.length === 0) {
        continue;
      }
      for (const breakdown of breakdowns) {
        const key = `${timesheet.employeeId}:${breakdown.monthKey}`;
        if (!currentApprovedGroups.has(key)) {
          currentApprovedGroups.set(key, []);
        }
        if (!currentApprovedGroups.get(key)!.includes(timesheet)) {
          currentApprovedGroups.get(key)!.push(timesheet);
        }
      }
    }

    for (const [key, timesheets] of currentApprovedGroups) {
      const colonIdx = key.indexOf(":");
      const groupEmployeeId = key.slice(0, colonIdx);
      const monthKey = key.slice(colonIdx + 1);
      const employee = employeeById.get(groupEmployeeId);
      if (!employee) {
        continue;
      }
      const sortedTimesheets = [...timesheets].sort((left, right) =>
        left.weekStart.localeCompare(right.weekStart),
      );

      let totalDays = 0;
      let totalHours = 0;
      let firstWorkDate: string | undefined;
      for (const timesheet of sortedTimesheets) {
        for (const breakdown of timesheetMonthBreakdowns(timesheet)) {
          if (breakdown.monthKey === monthKey) {
            totalDays += breakdown.days;
            totalHours += breakdown.hours;
            if (!firstWorkDate || breakdown.firstWorkDate < firstWorkDate) {
              firstWorkDate = breakdown.firstWorkDate;
            }
          }
        }
      }

      const monthlyAmount = effectiveMonthlySalary(employee);

      const existingIndex = nextSalaries.findIndex(
        (salary) =>
          tenantSalaryFilter(salary, tenantId) &&
          salary.source === "timesheet" &&
          salary.employeeId === employee.id &&
          salary.rate == null &&
          (
            payrollMonthKey(salary.weekStart ?? salary.date) === monthKey ||
            monthKeyFromTimesheetId(salary.timesheetId) === monthKey
          ),
      );
      const existing = existingIndex >= 0 ? nextSalaries[existingIndex] : undefined;
      if (existing?.status === "paid") {
        continue;
      }

      const firstTimesheet = sortedTimesheets[0];
      if (!firstTimesheet) {
        continue;
      }

      // Preserve admin-added extra days but cap at the actual days in the month.
      const monthCalendarDays = daysInCalendarMonth(monthKey);
      const reconciledDays = Math.min(Math.max(totalDays, Number(existing?.days ?? 0)), monthCalendarDays);
      const proratedAmount = monthlyAmount > 0
        ? Math.round(monthlyAmount / monthCalendarDays * reconciledDays)
        : 0;

      const salary: SalaryRecord = {
        id: existing?.id ?? createId("sal"),
        tenantId,
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        amount: proratedAmount > 0 ? proratedAmount : monthlyAmount,
        date: existing?.date ?? updatedAt,
        note: existing?.note || `Monthly salary for ${monthKey}`,
        status: "pending",
        source: "timesheet",
        weekStart: existing?.weekStart ?? firstWorkDate ?? firstTimesheet.weekStart,
        hours: totalHours,
        rate: undefined,
        days: reconciledDays,
        timesheetId: existing?.timesheetId ?? monthScopedTimesheetId(firstTimesheet.id, monthKey),
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      };

      if (existingIndex >= 0) {
        nextSalaries[existingIndex] = salary;
      } else {
        nextSalaries.unshift(salary);
      }

      // Remove any other duplicate pending records for the same employee/month.
      const keptId = salary.id;
      for (let i = nextSalaries.length - 1; i >= 0; i--) {
        const s = nextSalaries[i]!;
        if (
          s.id !== keptId &&
          tenantSalaryFilter(s, tenantId) &&
          s.source === "timesheet" &&
          s.employeeId === employee.id &&
          s.rate == null &&
          s.status !== "paid" &&
          (
            payrollMonthKey(s.weekStart ?? s.date) === monthKey ||
            monthKeyFromTimesheetId(s.timesheetId) === monthKey
          )
        ) {
          nextSalaries.splice(i, 1);
        }
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

function summarizeSalary(salary: Pick<SalaryRecord, "accountId" | "employeeId" | "employeeNameSnapshot" | "amount" | "date" | "note" | "status" | "source" | "paidAt" | "weekStart" | "hours" | "rate" | "days" | "timesheetId">) {
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
    days: salary.days ?? null,
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
    "days",
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
      days: input.days ?? existing?.days,
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

export async function paySalariesBatch(
  ids: string[],
  note: string | undefined,
  actor: SalaryActor,
  accountId: string,
): Promise<SalaryRecord[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    throw new SalaryServiceError("invalid_input", "Select at least one salary record.");
  }

  let paidSalaries: SalaryRecord[] = [];
  await updateStore((current) => {
    const selected = uniqueIds.map((id) => current.salaries.find((salary) => salary.id === id));
    if (selected.some((salary) => !salary)) {
      throw new SalaryServiceError("not_found", "One or more salary records were not found.");
    }

    const salaries = selected as SalaryRecord[];
    for (const salary of salaries) {
      assertTenantAccess(salary.tenantId, actor.tenantId, () => new SalaryServiceError("forbidden", "Forbidden"));
      if (salary.status !== "pending") {
        throw new SalaryServiceError("conflict", "One or more salary records have already been paid.");
      }
    }

    assertFinancialAccount(current, actor.tenantId, accountId, (message) => new SalaryServiceError("invalid_input", message));
    ensureFunds(
      current,
      salaries.reduce((sum, salary) => sum + salary.amount, 0),
      "this salary payment",
      actor.tenantId,
      accountId,
    );

    const paidAt = nowIso();
    paidSalaries = salaries.map((salary) => ({
      ...salary,
      tenantId: actor.tenantId,
      accountId,
      status: "paid",
      paidAt,
      date: paidAt,
      note: note?.trim() || salary.note,
      updatedAt: paidAt,
    }));
    const paidById = new Map(paidSalaries.map((salary) => [salary.id, salary]));
    let nextStore = {
      ...current,
      salaries: current.salaries.map((salary) => paidById.get(salary.id) ?? salary),
    };

    for (const salary of paidSalaries) {
      const previous = salaries.find((item) => item.id === salary.id)!;
      nextStore = pushAuditEvent(nextStore, {
        ...actor,
        action: "paid",
        entityType: "salary",
        entityId: salary.id,
        summary: "Marked a salary record as paid through a generated salary slip.",
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: salary.employeeNameSnapshot || undefined,
          requestId: actor.requestId,
          changedFields: changedSalaryFields(previous, salary),
          before: summarizeSalary(previous),
          after: summarizeSalary(salary),
          context: { operation: "salary_slip_batch_pay" },
        },
      });
    }

    return nextStore;
  });

  return paidSalaries;
}
