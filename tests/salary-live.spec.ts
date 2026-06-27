import { expect, test } from "@playwright/test";
import {
  authHeaders,
  createAuthenticatedContext,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  ensureDefaultAdminCredentials,
  FRONTEND_ORIGIN,
  loginApi,
} from "./live-test-helpers";

const weekOneStart = "2026-05-11T12:00:00.000Z";
const weekTwoStart = "2026-05-18T12:00:00.000Z";

test.describe.configure({ mode: "serial" });

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

function blankHours(overrides?: Partial<Record<DayKey, number>>) {
  return {
    mon: 0,
    tue: 0,
    wed: 0,
    thu: 0,
    fri: 0,
    sat: 0,
    sun: 0,
    ...overrides,
  };
}

async function createEmployee(adminSession: Awaited<ReturnType<typeof loginApi>>, suffix: string) {
  const employeeEmail = `salary.smoke.${suffix}@reforix.test`;
  const employeeName = `Salary Smoke ${suffix}`;
  const employeePasswordSeed = `9${suffix.padStart(9, "0").slice(0, 9)}`;

  const response = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: employeeName,
      email: employeeEmail,
      phone: employeePasswordSeed,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: "Engineering",
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `salary-smoke-employee-${suffix}`,
    }),
  });

  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    user: { id: string; email: string };
    temporaryPassword?: string;
  };
  expect(payload.temporaryPassword).toBeTruthy();

  return {
    employeeEmail,
    employeeName,
    employeeId: payload.user.id,
    employeePassword: payload.temporaryPassword as string,
  };
}

async function seedTimesheet(
  employeeSession: Awaited<ReturnType<typeof loginApi>>,
  employeeName: string,
  weekStart: string,
  note: string,
  hours: Partial<Record<DayKey, number>>,
  suffix: string,
  index: number,
) {
  const response = await employeeSession.client.post("/api/business/timesheets", {
    data: {
      employeeId: employeeSession.user.id,
      employeeNameSnapshot: employeeName,
      weekStart,
      lines: [
        {
          project: "Salary Smoke Project",
          task: "Salary Smoke Task",
          notes: "",
          workNotes: {
            mon: note,
            wed: `${note} - midweek follow-up`,
          },
          hours: blankHours(hours),
        },
      ],
    },
    headers: authHeaders(employeeSession, {
      "x-idempotency-key": `salary-smoke-timesheet-${suffix}-${index}`,
    }),
  });

  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    timesheet: { id: string };
  };
  expect(payload.timesheet?.id).toBeTruthy();
  return payload.timesheet.id;
}

async function createPendingSalary(
  adminSession: Awaited<ReturnType<typeof loginApi>>,
  input: {
    employeeId: string;
    employeeName: string;
    amount: number;
    date: string;
    weekStart: string;
    hours: number;
    rate: number;
    note: string;
    timesheetId: string;
  },
  suffix: string,
  index: number,
) {
  const response = await adminSession.client.post("/api/business/salaries", {
    data: {
      employeeId: input.employeeId,
      employeeNameSnapshot: input.employeeName,
      amount: input.amount,
      date: input.date,
      note: input.note,
      source: "timesheet",
      weekStart: input.weekStart,
      hours: input.hours,
      rate: input.rate,
      timesheetId: input.timesheetId,
      status: "pending",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `salary-smoke-record-${suffix}-${index}`,
    }),
  });

  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    salary: { id: string; status: string };
  };
  expect(payload.salary?.id).toBeTruthy();
  expect(payload.salary.status).toBe("pending");
  return payload.salary.id;
}

test("salary modal combines weekly payouts and keeps the worklog scrollable", async ({ browser }) => {
  test.setTimeout(300_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const accountResponse = await adminSession.client.post("/api/business/financial-accounts", {
    data: {
      name: `Salary Ops ${suffix}`,
      accountType: "operational",
      category: "bank",
      openingBalance: 250000,
      description: "Smoke-test payout account",
      includeInOperationalReporting: true,
      isActive: true,
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `salary-smoke-account-${suffix}`,
    }),
  });
  expect(accountResponse.ok()).toBeTruthy();
  const accountPayload = (await accountResponse.json()) as {
    account: { id: string; name: string };
  };
  expect(accountPayload.account.id).toBeTruthy();

  const employee = await createEmployee(adminSession, suffix);
  const employeeSession = await loginApi(employee.employeeEmail, employee.employeePassword);

  const firstTimesheetId = await seedTimesheet(
    employeeSession,
    employee.employeeName,
    weekOneStart,
    `Salary smoke ${suffix}: week one notes for the monthly payroll review.`,
    { mon: 4, wed: 3, fri: 7 },
    suffix,
    0,
  );
  const secondTimesheetId = await seedTimesheet(
    employeeSession,
    employee.employeeName,
    weekTwoStart,
    `Salary smoke ${suffix}: week two notes for the monthly payroll review.`,
    { mon: 5, tue: 2, thu: 4 },
    suffix,
    1,
  );

  const firstSalaryId = await createPendingSalary(
    adminSession,
    {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      amount: 11200,
      date: "2026-05-11",
      weekStart: weekOneStart,
      hours: 14,
      rate: 800,
      note: `Week one payout for ${employee.employeeName}`,
      timesheetId: firstTimesheetId,
    },
    suffix,
    0,
  );
  const secondSalaryId = await createPendingSalary(
    adminSession,
    {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      amount: 12000,
      date: "2026-05-18",
      weekStart: weekTwoStart,
      hours: 15,
      rate: 800,
      note: `Week two payout for ${employee.employeeName}`,
      timesheetId: secondTimesheetId,
    },
    suffix,
    1,
  );

  const { context, page, pageErrors } = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  await page.goto(`${FRONTEND_ORIGIN}/salary`);
  await expect(page.getByRole("heading", { name: "Payroll Management" })).toBeVisible();
  await expect(page.getByText(employee.employeeName, { exact: true })).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: employee.employeeName }).first();
  await expect(row.getByRole("button", { name: "View Payroll" })).toBeVisible();
  await row.getByRole("button", { name: "View Payroll" }).click();

  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Final Payout", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Combined payroll payout", { exact: false })).toBeVisible();
  await expect(dialog.getByText("11 May 2026 - 17 May 2026", { exact: true })).toBeVisible();
  await expect(dialog.getByText("18 May 2026 - 24 May 2026", { exact: true })).toBeVisible();

  const modalText = (await dialog.textContent()) ?? "";
  const firstWeekIndex = modalText.indexOf("11 May 2026 - 17 May 2026");
  const secondWeekIndex = modalText.indexOf("18 May 2026 - 24 May 2026");
  expect(firstWeekIndex).toBeGreaterThanOrEqual(0);
  expect(secondWeekIndex).toBeGreaterThan(firstWeekIndex);

  const viewport = dialog.locator("[data-radix-scroll-area-viewport]").first();
  const isScrollable = await viewport.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(isScrollable).toBeTruthy();

  const payoutAccountLabel = `${accountPayload.account.name} • Main`;
  const accountSelect = dialog.getByRole("combobox").first();
  await accountSelect.click();
  await page.getByRole("option", { name: payoutAccountLabel }).last().click();
  await expect(accountSelect).toContainText(payoutAccountLabel);
  await expect(dialog.getByRole("button", { name: "Pay Final Salary" })).toBeVisible();

  await dialog.getByRole("button", { name: "Pay Final Salary" }).click();
  await expect(page.getByText("Salary paid", { exact: true })).toBeVisible();

  const salariesResponse = await adminSession.client.get("/api/business/salaries", {
    headers: authHeaders(adminSession),
  });
  expect(salariesResponse.ok()).toBeTruthy();
  const salariesPayload = (await salariesResponse.json()) as {
    salaries: Array<{ id: string; status: string }>;
  };
  expect(salariesPayload.salaries.find((salary) => salary.id === firstSalaryId)?.status).toBe("paid");
  expect(salariesPayload.salaries.find((salary) => salary.id === secondSalaryId)?.status).toBe("paid");

  expect(pageErrors).toEqual([]);

  await context.close();
  await employeeSession.client.dispose();
  await adminSession.client.dispose();
});
