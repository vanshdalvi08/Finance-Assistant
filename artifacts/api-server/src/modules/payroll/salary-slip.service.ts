import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  companySettingsTable,
  salariesTable,
  salarySlipsTable,
  timesheetLinesTable,
  timesheetsTable,
  usersTable,
  type SalarySlipSnapshot,
} from "@workspace/db/schema";
import { createId } from "../../lib/business-store";
import { resolveSalarySlipUrl, uploadSalarySlip } from "../../lib/storage";
import { generateSalarySlipPdf } from "./salary-slip.pdf";
import { paySalariesBatch, type SalaryActor } from "./payroll.service";
import { sendMail } from "../../lib/mailer";
import { salaryPaymentEmailTemplate } from "../../lib/email-templates";
import { logger } from "../../lib/logger";
import { DAY_KEYS } from "../../lib/business-store";

export type SalarySlipDraft = SalarySlipSnapshot & {
  salaryIds: string[];
  accountId: string;
};

function formatDate(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function amount(value: number) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function isoDateForTimesheetDay(weekStart: string, dayIndex: number) {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

function timesheetScope(value: string) {
  const match = value.match(/^(.+?)(?::(\d{4}-\d{2}))?$/);
  return {
    timesheetId: match?.[1] ?? value,
    monthKey: match?.[2],
  };
}

async function countWorkedDaysForSalaries(salaries: Array<{ timesheetId: string | null }>) {
  const selectedTimesheetScopes = new Map<string, Set<string | undefined>>();
  for (const salary of salaries) {
    if (!salary.timesheetId) {
      continue;
    }
    const scope = timesheetScope(salary.timesheetId);
    selectedTimesheetScopes.set(scope.timesheetId, selectedTimesheetScopes.get(scope.timesheetId) ?? new Set());
    selectedTimesheetScopes.get(scope.timesheetId)!.add(scope.monthKey);
  }
  if (selectedTimesheetScopes.size === 0) {
    return 0;
  }

  const timesheetIds = Array.from(selectedTimesheetScopes.keys());
  const [timesheetRows, lineRows] = await Promise.all([
    db.select().from(timesheetsTable).where(inArray(timesheetsTable.id, timesheetIds)),
    db.select().from(timesheetLinesTable).where(inArray(timesheetLinesTable.timesheetId, timesheetIds)),
  ]);
  const linesByTimesheet = new Map<string, Array<Record<string, number>>>();
  for (const row of lineRows) {
    linesByTimesheet.set(row.timesheetId, linesByTimesheet.get(row.timesheetId) ?? []);
    linesByTimesheet.get(row.timesheetId)!.push({
      mon: Number(row.mon ?? 0),
      tue: Number(row.tue ?? 0),
      wed: Number(row.wed ?? 0),
      thu: Number(row.thu ?? 0),
      fri: Number(row.fri ?? 0),
      sat: Number(row.sat ?? 0),
      sun: Number(row.sun ?? 0),
    });
  }

  const workedDates = new Set<string>();
  for (const timesheet of timesheetRows) {
    const monthKeys = selectedTimesheetScopes.get(timesheet.id);
    if (!monthKeys) {
      continue;
    }
    const lines =
      linesByTimesheet.get(timesheet.id) ??
      (Array.isArray(timesheet.lines)
        ? timesheet.lines.map((line) => ({ ...(line.hours ?? {}) }) as Record<string, number>)
        : []);
    DAY_KEYS.forEach((day, dayIndex) => {
      const dayHours = lines.reduce((sum, line) => sum + Number(line[day] ?? 0), 0);
      const workDate = isoDateForTimesheetDay(timesheet.weekStart.toISOString(), dayIndex);
      const isSelectedMonth = monthKeys.has(undefined) || Array.from(monthKeys).some((monthKey) => monthKey && workDate.startsWith(monthKey));
      if (dayHours > 0 && isSelectedMonth) {
        workedDates.add(workDate);
      }
    });
  }

  return workedDates.size;
}

async function loadPendingSalaries(tenantId: string, salaryIds: string[]) {
  const rows = await db
    .select()
    .from(salariesTable)
    .where(and(eq(salariesTable.tenantId, tenantId), inArray(salariesTable.id, salaryIds)));
  if (rows.length !== salaryIds.length || rows.some((row) => row.status !== "pending")) {
    throw new Error("One or more payroll records are missing or already paid.");
  }
  const employeeIds = new Set(rows.map((row) => row.employeeId).filter(Boolean));
  if (employeeIds.size !== 1) {
    throw new Error("A salary slip can only combine payroll records for one employee.");
  }
  return rows;
}

export async function buildSalarySlipDraft(input: {
  tenantId: string;
  salaryIds: string[];
  accountId: string;
}): Promise<SalarySlipDraft> {
  const salaries = await loadPendingSalaries(input.tenantId, input.salaryIds);
  const employeeId = salaries[0]?.employeeId;
  if (!employeeId) throw new Error("Salary slip requires an active employee.");

  const [employeeRows, settingsRows] = await Promise.all([
    db.select().from(usersTable).where(and(eq(usersTable.id, employeeId), eq(usersTable.tenantId, input.tenantId))).limit(1),
    db.select().from(companySettingsTable).where(eq(companySettingsTable.tenantId, input.tenantId)).limit(1),
  ]);
  const employee = employeeRows[0];
  if (!employee) throw new Error("Employee not found.");

  const company = settingsRows[0]?.data ?? {};
  const total = salaries.reduce((sum, salary) => sum + salary.amount, 0);
  const dates = salaries.map((salary) => new Date(salary.weekStart ?? salary.date)).sort((a, b) => a.getTime() - b.getTime());
  const firstDate = dates[0] ?? new Date();
  const payPeriod = firstDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate();
  const workedDays = await countWorkedDaysForSalaries(salaries);
  const paidDays = workedDays > 0 ? workedDays : daysInMonth;

  return {
    salaryIds: input.salaryIds,
    accountId: input.accountId,
    companyName: company.companyName?.trim() || "Reforix Engineering",
    companyAddress: "Vastu Anand, Building No. 16, Parsik Nagar, Thane, Maharashtra, India",
    payPeriod,
    paymentDate: new Date().toISOString().slice(0, 10),
    employeeId: employee.employeeId ?? employee.id,
    employeeName: employee.name,
    designation: employee.position ?? "",
    department: employee.department ?? "",
    joiningDate: employee.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : "",
    uan: employee.uan ?? "",
    pfNumber: employee.pfNumber ?? "",
    esiNumber: employee.esiNumber ?? "",
    bankName: employee.bankName ?? "",
    bankAccountNumber: employee.bankAccountNumber ?? "",
    grossWages: total,
    totalWorkingDays: paidDays,
    leaveDays: 0,
    lopDays: 0,
    paidDays,
    earnings: [
      { label: "Basic", amount: total },
      { label: "HRA", amount: 0 },
      { label: "Conveyance Allowance", amount: 0 },
      { label: "Medical Allowance", amount: 0 },
      { label: "Other Allowances", amount: 0 },
    ],
    deductions: [
      { label: "EPF", amount: 0 },
      { label: "ESI", amount: 0 },
      { label: "Professional Tax", amount: 0 },
    ],
    totalEarnings: total,
    totalDeductions: 0,
    netSalary: total,
    note: salaries.map((salary) => salary.note).filter(Boolean).join(" | "),
  };
}

export async function confirmSalarySlip(input: {
  tenantId: string;
  actor: SalaryActor;
  draft: SalarySlipDraft;
}) {
  const salaries = await loadPendingSalaries(input.tenantId, input.draft.salaryIds);
  const employeeId = salaries[0]!.employeeId!;
  const employeeRows = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, employeeId), eq(usersTable.tenantId, input.tenantId)))
    .limit(1);
  const employee = employeeRows[0];
  if (!employee) throw new Error("Employee not found.");

  const snapshot: SalarySlipSnapshot = {
    ...input.draft,
    earnings: input.draft.earnings.map((item) => ({ label: item.label.trim(), amount: amount(item.amount) })).filter((item) => item.label),
    deductions: input.draft.deductions.map((item) => ({ label: item.label.trim(), amount: amount(item.amount) })).filter((item) => item.label),
    totalEarnings: amount(input.draft.earnings.reduce((sum, item) => sum + amount(item.amount), 0)),
    totalDeductions: amount(input.draft.deductions.reduce((sum, item) => sum + amount(item.amount), 0)),
    grossWages: amount(input.draft.grossWages),
    netSalary: 0,
  };
  snapshot.netSalary = snapshot.totalEarnings - snapshot.totalDeductions;
  const payrollTotal = salaries.reduce((sum, salary) => sum + salary.amount, 0);
  if (snapshot.netSalary !== payrollTotal) {
    throw new Error(`Net salary must equal the pending payroll total of INR ${payrollTotal.toLocaleString("en-IN")}.`);
  }
  if (snapshot.netSalary <= 0) throw new Error("Net salary must be greater than zero.");

  const slipId = createId("slip");
  const safePeriod = snapshot.payPeriod.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `${snapshot.employeeId}-${safePeriod || "salary"}-${slipId}.pdf`;
  const pdfBytes = await generateSalarySlipPdf(snapshot);
  const uploaded = await uploadSalarySlip({
    fileName,
    body: pdfBytes,
    tenantId: input.tenantId,
    employeeId,
  });

  const paidSalaries = await paySalariesBatch(
    salaries.map((salary) => salary.id),
    snapshot.note,
    input.actor,
    input.draft.accountId,
  );

  const rows = await db
    .insert(salarySlipsTable)
    .values({
      id: slipId,
      tenantId: input.tenantId,
      employeeId,
      salaryIds: input.draft.salaryIds,
      accountId: input.draft.accountId,
      payPeriod: snapshot.payPeriod,
      paymentDate: new Date(snapshot.paymentDate),
      grossAmount: snapshot.totalEarnings,
      deductionAmount: snapshot.totalDeductions,
      netAmount: snapshot.netSalary,
      snapshot,
      fileName: uploaded.fileName,
      filePath: uploaded.path,
      createdById: input.actor.userId ?? null,
    })
    .returning();
  const slip = rows[0]!;

  const email = salaryPaymentEmailTemplate({
    employeeName: employee.name,
    payPeriod: snapshot.payPeriod,
    paymentDate: formatDate(snapshot.paymentDate),
    grossAmount: snapshot.totalEarnings,
    deductions: snapshot.totalDeductions,
    netAmount: snapshot.netSalary,
  });
  void sendMail({
    to: employee.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: [{ filename: uploaded.fileName, content: pdfBytes, contentType: "application/pdf" }],
  })
    .then(async (sent) => {
      if (sent) {
        await db.update(salarySlipsTable).set({ emailedAt: new Date() }).where(eq(salarySlipsTable.id, slipId));
      }
    })
    .catch((error) => logger.warn({ err: error, slipId }, "Failed to email salary slip"));

  return {
    slip: { ...slip, downloadUrl: uploaded.url },
    salaries: paidSalaries,
  };
}

export async function listSalarySlipsForActor(input: {
  tenantId: string;
  role?: string;
  userId?: string;
  employeeId?: string;
}) {
  const targetEmployeeId = input.role === "employee" ? input.userId : input.employeeId;
  const where = targetEmployeeId
    ? and(eq(salarySlipsTable.tenantId, input.tenantId), eq(salarySlipsTable.employeeId, targetEmployeeId))
    : eq(salarySlipsTable.tenantId, input.tenantId);
  const rows = await db.select().from(salarySlipsTable).where(where).orderBy(desc(salarySlipsTable.paymentDate));
  return Promise.all(rows.map(async (row) => ({ ...row, downloadUrl: await resolveSalarySlipUrl(row.filePath) })));
}
