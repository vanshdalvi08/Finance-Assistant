import { expect, test } from "@playwright/test";
import {
  authHeaders,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  ensureDefaultAdminCredentials,
  FRONTEND_ORIGIN,
  loginApi,
} from "./live-test-helpers";

test.describe.configure({ mode: "serial" });

async function loginThroughUi(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto(`${FRONTEND_ORIGIN}/login`);
  await expect(page.getByRole("heading", { name: /enter your credentials/i })).toBeVisible();
  await page.getByRole("textbox", { name: /e-mail/i }).fill(email);
  await page.getByRole("textbox", { name: /password/i }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("admin session survives refresh and keeps the same workspace visible", async ({ browser }) => {
  test.setTimeout(120_000);

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const context = await browser.newContext();
  const page = await context.newPage();

  await loginThroughUi(page, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
  await page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible();

  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible();

  await context.close();
  await adminSession.client.dispose();
});

test("employee session survives refresh and stays on timesheet", async ({ browser }) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const employeeEmail = `employee.refresh.${suffix}@reforix.test`;
  const employeePhone = `6${suffix.padStart(9, "0").slice(0, 9)}`;

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: `Refresh Check ${suffix}`,
      email: employeeEmail,
      phone: employeePhone,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: "Engineering",
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `refresh-live-${suffix}`,
    }),
  });
  expect(createEmployeeResponse.ok()).toBeTruthy();
  const createEmployeePayload = (await createEmployeeResponse.json()) as {
    temporaryPassword?: string;
  };
  expect(createEmployeePayload.temporaryPassword).toBeTruthy();

  const employeePassword = createEmployeePayload.temporaryPassword as string;
  const context = await browser.newContext();
  const page = await context.newPage();

  await loginThroughUi(page, employeeEmail, employeePassword);
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();

  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();

  await context.close();
  await adminSession.client.dispose();
});
