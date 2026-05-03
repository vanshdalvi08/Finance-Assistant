import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";

type ApiSession = {
  client: APIRequestContext;
  accessToken: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
};

async function loginApi(email: string, password: string): Promise<ApiSession> {
  const client = await playwrightRequest.newContext({
    baseURL: "http://localhost:3001",
    extraHTTPHeaders: {
      Origin: "http://localhost:5173",
      Referer: "http://localhost:5173/",
    },
  });

  const csrfResponse = await client.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfPayload = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await client.post("/api/auth/login", {
    data: {
      email,
      password,
    },
    headers: {
      "x-csrf-token": csrfPayload.csrfToken,
    },
  });

  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = (await loginResponse.json()) as {
    accessToken: string;
    csrfToken: string;
    user: ApiSession["user"];
  };

  return {
    client,
    accessToken: loginPayload.accessToken,
    csrfToken: loginPayload.csrfToken,
    user: loginPayload.user,
  };
}

function authHeaders(session: ApiSession, extras?: Record<string, string>) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "x-csrf-token": session.csrfToken,
    ...extras,
  };
}

function trackPageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

test("live employee work note persists across save draft, reload, and update", async ({ page }) => {
  test.setTimeout(120_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const employeeEmail = `employee.timesheet.${suffix}@reforix.test`;
  const employeePhone = `9${suffix.padStart(9, "0").slice(0, 9)}`;
  const initialNote =
    `Live persistence note ${suffix}: drafted rollout updates, checked totals, and verified the note save path.`;
  const updatedNote =
    `Live persistence note ${suffix}: returned next day, changed hours, and saved the revised summary before review.`;

  const adminSession = await loginApi("admin@reforix.com", "reforix123");

  const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: `Timesheet E2E ${suffix}`,
      email: employeeEmail,
      phone: employeePhone,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: "Engineering",
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `work-note-live-${suffix}`,
    }),
  });

  expect(createEmployeeResponse.ok()).toBeTruthy();
  const createEmployeePayload = (await createEmployeeResponse.json()) as {
    user: { id: string; email: string };
    temporaryPassword?: string;
  };
  expect(createEmployeePayload.temporaryPassword).toBeTruthy();

  const employeePassword = createEmployeePayload.temporaryPassword as string;
  const employeeSession = await loginApi(employeeEmail, employeePassword);

  const pageErrors = trackPageErrors(page);

  await page.goto("/login");
  await page.getByRole("textbox", { name: "E-mail" }).fill(employeeEmail);
  await page.getByRole("textbox", { name: "Password" }).fill(employeePassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();

  const taskRow = page.locator("tbody tr").first();
  const mondayCell = taskRow.locator("td").nth(2);

  await mondayCell.locator("input").hover();
  await page.getByRole("button", { name: "Add work note for Mon" }).click();

  const workNoteDialog = page.getByRole("dialog");
  await expect(workNoteDialog).toBeVisible();
  await workNoteDialog.locator('input[inputmode="decimal"]').fill("1.5");
  await workNoteDialog
    .getByPlaceholder("Describe the work completed, key update, or specific output for this task.")
    .fill(initialNote);
  await workNoteDialog.getByRole("button", { name: "Save" }).click();

  await expect(workNoteDialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save Draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();

  const mondayEditButton = page.getByRole("button", { name: "Edit work note for Mon" }).first();
  await expect(mondayEditButton).toBeVisible();
  await mondayEditButton.click();
  await expect(workNoteDialog).toBeVisible();
  await expect(workNoteDialog.locator('input[inputmode="decimal"]')).toHaveValue("1.5");
  await expect(
    workNoteDialog.getByPlaceholder("Describe the work completed, key update, or specific output for this task."),
  ).toHaveValue(initialNote);

  await workNoteDialog.locator('input[inputmode="decimal"]').fill("2.5");
  await workNoteDialog
    .getByPlaceholder("Describe the work completed, key update, or specific output for this task.")
    .fill(updatedNote);
  await workNoteDialog.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved", { exact: true }).first()).toBeVisible();

  const employeeTimesheetsResponse = await employeeSession.client.get("/api/business/timesheets", {
    headers: {
      Authorization: `Bearer ${employeeSession.accessToken}`,
    },
  });
  expect(employeeTimesheetsResponse.ok()).toBeTruthy();

  const employeeTimesheetsPayload = (await employeeTimesheetsResponse.json()) as {
    timesheets: Array<{
      id: string;
      employeeId: string;
      status: string;
      lines: Array<{
        id: string;
        workNotes?: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", string>>;
        hours: Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", number>;
      }>;
    }>;
  };

  const persistedDraft = employeeTimesheetsPayload.timesheets.find(
    (entry) =>
      entry.employeeId === employeeSession.user.id
      && entry.lines.some((line) => line.workNotes?.mon === updatedNote && Number(line.hours.mon ?? 0) === 2.5),
  );

  expect(persistedDraft).toBeTruthy();
  expect(persistedDraft?.status).toBe("draft");

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await page.getByRole("button", { name: "Edit work note for Mon" }).first().click();
  await expect(workNoteDialog.locator('input[inputmode="decimal"]')).toHaveValue("2.5");
  await expect(
    workNoteDialog.getByPlaceholder("Describe the work completed, key update, or specific output for this task."),
  ).toHaveValue(updatedNote);

  expect(pageErrors).toEqual([]);

  await employeeSession.client.dispose();
  await adminSession.client.dispose();
});
