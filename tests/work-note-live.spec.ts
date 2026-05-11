import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  authHeaders,
  createAuthenticatedContext,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  ensureDefaultAdminCredentials,
  FRONTEND_ORIGIN,
  loginApi,
} from "./live-test-helpers";

const weekStart = "2026-05-04T12:00:00.000Z";
const weekStartDate = weekStart.slice(0, 10);

test.describe.configure({ mode: "serial" });

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type TimesheetLineSnapshot = {
  workNotes?: Partial<Record<DayKey, string>>;
  hours: Record<DayKey, number>;
};

type TimesheetSnapshot = {
  employeeId: string;
  status?: string;
  dailyReviewStatus?: Partial<Record<DayKey, "reviewed" | "reverted">>;
  dailyReviewNotes?: Partial<Record<DayKey, string>>;
  lines: TimesheetLineSnapshot[];
};

type SeededEmployeeSession = {
  name: string;
  email: string;
  department: string;
  password: string;
  session: Awaited<ReturnType<typeof loginApi>>;
};

async function fetchEmployeeTimesheet(
  accessToken: string,
  employeeId: string,
  client: Awaited<ReturnType<typeof loginApi>>["client"],
) {
  const response = await client.get("/api/business/timesheets", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    timesheets: TimesheetSnapshot[];
  };

  return payload.timesheets.find((entry) => entry.employeeId === employeeId);
}

function employeeCardFor(page: Page, employeeName: string) {
  return page
    .getByText(employeeName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'overflow-hidden') and contains(@class,'shadow-sm')][1]");
}

async function selectSeededWeek(page: Page) {
  await page.locator('input[type="date"]').first().fill(weekStartDate);
}

async function toggleDailyReview(page: Page, trigger: Locator, day: DayKey, note?: string) {
  if (typeof note === "string") {
    await trigger.click();
    const revertDialog = page.getByRole("dialog").last();
    await expect(revertDialog).toBeVisible();
    await revertDialog.getByPlaceholder("Explain what needs to be updated for this day.").fill(note);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/daily-review/${day}`)
          && response.request().method() === "PATCH"
          && response.status() === 200,
      ),
      revertDialog.getByRole("button", { name: "Return to employee" }).click(),
    ]);
    await expect(revertDialog).toBeHidden();
    return;
  }

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/daily-review/${day}`)
        && response.request().method() === "PATCH"
        && response.status() === 200,
    ),
    trigger.click(),
  ]);
}

async function undoDailyReview(page: Page, trigger: Locator, day: DayKey) {
  await trigger.click();
  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "Undo review" })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/daily-review/${day}`)
        && response.request().method() === "PATCH"
        && response.status() === 200,
    ),
    confirmDialog.getByRole("button", { name: "Undo review" }).click(),
  ]);
}

async function chooseSelectOption(page: Page, trigger: Locator, optionName: string) {
  await trigger.click();
  const option = page.getByRole("option", { name: optionName }).last();
  await expect(option).toBeVisible();
  await option.evaluate((element) => {
    (element as HTMLElement).focus();
  });
  await option.press("Enter");
}

function blankHours(overrides?: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", number>>) {
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

async function provisionEmployeeTimesheet(
  adminSession: Awaited<ReturnType<typeof loginApi>>,
  input: {
    name: string;
    email: string;
    phone: string;
    department: string;
    note: string;
    hours: Partial<Record<DayKey, number>>;
    mode: "draft" | "submitted";
  },
  suffix: string,
  index: number,
): Promise<SeededEmployeeSession> {
  const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: input.department,
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `daily-review-scale-${suffix}-${index}`,
    }),
  });

  expect(createEmployeeResponse.ok()).toBeTruthy();
  const createEmployeePayload = (await createEmployeeResponse.json()) as {
    temporaryPassword?: string;
  };
  expect(createEmployeePayload.temporaryPassword).toBeTruthy();

  const password = createEmployeePayload.temporaryPassword as string;
  const session = await loginApi(input.email, password);
  const endpoint = input.mode === "draft" ? "/api/business/timesheets" : "/api/business/timesheets/submit";
  const seededResponse = await session.client.post(endpoint, {
    data: {
      employeeId: session.user.id,
      employeeNameSnapshot: input.name,
      weekStart,
      lines: [
        {
          project: "Custom project",
          task: "Custom task",
          notes: "",
          workNotes: { mon: input.note },
          hours: blankHours(input.hours),
        },
      ],
    },
    headers: authHeaders(session, {
      "x-idempotency-key": `daily-review-scale-seed-${suffix}-${index}`,
    }),
  });
  expect(seededResponse.ok()).toBeTruthy();

  return {
    name: input.name,
    email: input.email,
    department: input.department,
    password,
    session,
  };
}

test("live employee work note persists across save draft, reload, and update", async ({ browser }) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const employeeEmail = `employee.timesheet.${suffix}@reforix.test`;
  const employeePhone = `9${suffix.padStart(9, "0").slice(0, 9)}`;
  const initialNote =
    `Live persistence note ${suffix}: drafted rollout updates, checked totals, and verified the note save path.`;
  const updatedNote =
    `Live persistence note ${suffix}: returned next day, changed hours, and saved the revised summary before review.`;

  await ensureDefaultAdminCredentials();

  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

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

  const seedDraftResponse = await employeeSession.client.post("/api/business/timesheets", {
    data: {
      employeeId: employeeSession.user.id,
      employeeNameSnapshot: `Timesheet E2E ${suffix}`,
      weekStart,
      lines: [
        {
          project: "Custom project",
          task: "Custom task",
          notes: "",
          workNotes: { mon: initialNote },
          hours: blankHours({ mon: 1.5 }),
        },
      ],
    },
    headers: authHeaders(employeeSession, {
      "x-idempotency-key": `work-note-live-seed-${suffix}`,
    }),
  });
  expect(seedDraftResponse.ok()).toBeTruthy();

  const { context: employeeContext, page, pageErrors } = await createAuthenticatedContext(browser, employeeEmail, employeePassword);

  await page.goto(`${FRONTEND_ORIGIN}/employee/timesheet`);
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await selectSeededWeek(page);

  const workNoteDialog = page.getByRole("dialog");

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

  const persistedDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );

  expect(persistedDraft).toBeTruthy();
  expect(persistedDraft?.status).toBe("draft");
  expect(
    persistedDraft?.lines.some((line) => line.workNotes?.mon === updatedNote && Number(line.hours.mon ?? 0) === 2.5),
  ).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await selectSeededWeek(page);
  await page.getByRole("button", { name: "Edit work note for Mon" }).first().click();
  await expect(workNoteDialog.locator('input[inputmode="decimal"]')).toHaveValue("2.5");
  await expect(
    workNoteDialog.getByPlaceholder("Describe the work completed, key update, or specific output for this task."),
  ).toHaveValue(updatedNote);

  expect(pageErrors).toEqual([]);

  await employeeContext.close();
  await employeeSession.client.dispose();
  await adminSession.client.dispose();
});

test("live daily review persists, resets after employee edits, and supports undo", async ({ browser }) => {
  test.setTimeout(240_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const employeeName = `Daily Review E2E ${suffix}`;
  const employeeEmail = `employee.daily.review.${suffix}@reforix.test`;
  const employeePhone = `8${suffix.padStart(9, "0").slice(0, 9)}`;
  const initialNote = `Daily review initial note ${suffix}: drafted design coordination and task follow-up summary.`;
  const updatedNote = `Daily review updated note ${suffix}: changed the work summary after admin review and resaved the draft.`;

  await ensureDefaultAdminCredentials();

  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: employeeName,
      email: employeeEmail,
      phone: employeePhone,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: "Engineering",
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `daily-review-live-${suffix}`,
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

  const saveDraftResponse = await employeeSession.client.post("/api/business/timesheets", {
    data: {
      employeeId: employeeSession.user.id,
      employeeNameSnapshot: employeeName,
      weekStart,
      lines: [
        {
          project: "Custom project",
          task: "Custom task",
          notes: "",
          workNotes: { mon: initialNote },
          hours: blankHours({ mon: 2.5 }),
        },
      ],
    },
    headers: authHeaders(employeeSession, {
      "x-idempotency-key": `daily-review-draft-${suffix}`,
    }),
  });
  expect(saveDraftResponse.ok()).toBeTruthy();

  const { context: employeeContext, page: employeePage, pageErrors: employeePageErrors } = await createAuthenticatedContext(
    browser,
    employeeEmail,
    employeePassword,
  );
  const { context: adminContext, page: adminPage, pageErrors: adminPageErrors } = await createAuthenticatedContext(
    browser,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
  );

  await employeePage.goto(`${FRONTEND_ORIGIN}/employee/timesheet`);
  await expect(employeePage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await selectSeededWeek(employeePage);
  await expect(employeePage.getByRole("button", { name: "Edit work note for Mon" }).first()).toBeVisible();

  await adminPage.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminPage.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Daily Review", exact: true }).click();

  await adminPage.locator('input[type="date"]').first().fill(weekStartDate);
  const employeeCard = employeeCardFor(adminPage, employeeName);
  await expect(employeeCard).toBeVisible({ timeout: 15000 });

  const markMondayReviewed = employeeCard.getByRole("button", { name: "Mark Monday as reviewed" }).first();
  await expect(markMondayReviewed).toBeVisible();
  await toggleDailyReview(adminPage, markMondayReviewed, "mon");
  await expect(employeeCard.getByRole("button", { name: "Undo review" }).first()).toBeVisible();

  const reviewedDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(reviewedDraft?.dailyReviewStatus?.mon).toBe("reviewed");
  expect(reviewedDraft?.dailyReviewNotes?.mon).toBeUndefined();

  await employeePage.reload();
  await expect(employeePage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await selectSeededWeek(employeePage);
  const mondayHeader = employeePage.locator("thead th").filter({ hasText: "Mon" }).first();
  await expect(mondayHeader).toContainText("Verify");

  const lockedEditButton = employeePage.getByRole("button", { name: "Edit work note for Mon" }).first();
  await expect(lockedEditButton).toBeDisabled();

  await adminPage.reload();
  await expect(adminPage.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminPage.locator('input[type="date"]').first().fill(weekStartDate);
  const employeeCardAfterReload = employeeCardFor(adminPage, employeeName);
  await expect(employeeCardAfterReload).toBeVisible({ timeout: 15000 });

  const undoButton = employeeCardAfterReload.getByRole("button", { name: "Undo review" }).first();
  await expect(undoButton).toBeVisible();
  await undoDailyReview(adminPage, undoButton, "mon");

  const undoneDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(undoneDraft?.dailyReviewStatus?.mon).toBeUndefined();
  expect(undoneDraft?.dailyReviewNotes?.mon).toBeUndefined();

  await employeePage.reload();
  await selectSeededWeek(employeePage);
  const revertedMondayHeader = employeePage.locator("thead th").filter({ hasText: "Mon" }).first();
  await expect(revertedMondayHeader.getByText("Reverted", { exact: true })).toHaveCount(0);
  await expect(revertedMondayHeader.locator("svg")).toHaveCount(0);

  const unlockedEditButton = employeePage.getByRole("button", { name: "Edit work note for Mon" }).first();
  await expect(unlockedEditButton).toBeEnabled();
  await unlockedEditButton.click();

  const workNoteDialog = employeePage.getByRole("dialog");
  await expect(workNoteDialog).toBeVisible();
  await workNoteDialog.locator('input[inputmode="decimal"]').fill("3");
  await workNoteDialog
    .getByPlaceholder("Describe the work completed, key update, or specific output for this task.")
    .fill(updatedNote);
  await workNoteDialog.getByRole("button", { name: "Save" }).click();

  await employeePage.getByRole("button", { name: "Save Draft" }).click();
  await expect(employeePage.getByText("Draft saved", { exact: true }).first()).toBeVisible();

  const resetDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(resetDraft?.dailyReviewStatus?.mon).toBeUndefined();
  expect(resetDraft?.lines[0]?.workNotes?.mon).toBe(updatedNote);
  expect(Number(resetDraft?.lines[0]?.hours.mon ?? 0)).toBe(3);

  const returnButton = employeeCardAfterReload.getByRole("button", { name: "Return to employee with note" }).first();
  await expect(returnButton).toBeVisible();
  const revertNote = `Please clarify the Monday work note and update the logged hours for review ${suffix}.`;
  await toggleDailyReview(adminPage, returnButton, "mon", revertNote);

  const revertedDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(revertedDraft?.dailyReviewStatus?.mon).toBe("reverted");
  expect(revertedDraft?.dailyReviewNotes?.mon).toBe(revertNote);

  await employeePage.reload();
  await selectSeededWeek(employeePage);
  await revertedMondayHeader.hover();
  await expect(employeePage.getByText("Returned for changes", { exact: true })).toBeVisible();
  await expect(employeePage.getByText(revertNote, { exact: true })).toBeVisible();

  await adminPage.reload();
  await expect(adminPage.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminPage.locator('input[type="date"]').first().fill(weekStartDate);
  const employeeCardReviewedAgain = employeeCardFor(adminPage, employeeName);
  await expect(employeeCardReviewedAgain).toBeVisible({ timeout: 15000 });

  const markAgainButton = employeeCardReviewedAgain.getByRole("button", { name: "Mark Monday as reviewed" }).first();
  await expect(markAgainButton).toBeVisible();
  await toggleDailyReview(adminPage, markAgainButton, "mon");
  const reviewedAgainDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(reviewedAgainDraft?.dailyReviewStatus?.mon).toBe("reviewed");
  expect(reviewedAgainDraft?.dailyReviewNotes?.mon).toBeUndefined();

  expect(employeePageErrors).toEqual([]);
  expect(adminPageErrors).toEqual([]);

  await employeeContext.close();
  await adminContext.close();
  await employeeSession.client.dispose();
  await adminSession.client.dispose();
});

test("live daily review keeps reviewed days intact when the employee adds a new task row", async ({ browser }) => {
  test.setTimeout(240_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const employeeName = `Daily Review Preserve ${suffix}`;
  const employeeEmail = `employee.daily.preserve.${suffix}@reforix.test`;
  const employeePhone = `8${suffix.padStart(9, "0").slice(0, 9)}`;

  await ensureDefaultAdminCredentials();

  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
  const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
    data: {
      name: employeeName,
      email: employeeEmail,
      phone: employeePhone,
      position: "QA Engineer",
      salary: 600000,
      payType: "monthly",
      department: "Engineering",
      status: "active",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `daily-review-preserve-${suffix}`,
    }),
  });
  expect(createEmployeeResponse.ok()).toBeTruthy();

  const createEmployeePayload = (await createEmployeeResponse.json()) as {
    temporaryPassword?: string;
  };
  expect(createEmployeePayload.temporaryPassword).toBeTruthy();

  const employeePassword = createEmployeePayload.temporaryPassword as string;
  const employeeSession = await loginApi(employeeEmail, employeePassword);

  const seedDraftResponse = await employeeSession.client.post("/api/business/timesheets", {
    data: {
      employeeId: employeeSession.user.id,
      employeeNameSnapshot: employeeName,
      weekStart,
      lines: [
        {
          project: "Custom project",
          task: "Original reviewed task",
          notes: "",
          workNotes: {
            mon: `Preserve review Monday note ${suffix}.`,
            tue: `Preserve review Tuesday note ${suffix}.`,
          },
          hours: blankHours({ mon: 2, tue: 3 }),
        },
      ],
    },
    headers: authHeaders(employeeSession, {
      "x-idempotency-key": `daily-review-preserve-seed-${suffix}`,
    }),
  });
  expect(seedDraftResponse.ok()).toBeTruthy();

  const { context: employeeContext, page: employeePage, pageErrors: employeePageErrors } = await createAuthenticatedContext(
    browser,
    employeeEmail,
    employeePassword,
  );
  const { context: adminContext, page: adminPage, pageErrors: adminPageErrors } = await createAuthenticatedContext(
    browser,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
  );

  await adminPage.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminPage.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminPage.locator('input[type="date"]').first().fill(weekStartDate);

  const employeeCard = employeeCardFor(adminPage, employeeName);
  await expect(employeeCard).toBeVisible({ timeout: 15000 });

  await toggleDailyReview(
    adminPage,
    employeeCard.getByRole("button", { name: "Mark Monday as reviewed" }).first(),
    "mon",
  );
  await toggleDailyReview(
    adminPage,
    employeeCard.getByRole("button", { name: "Mark Tuesday as reviewed" }).first(),
    "tue",
  );
  await expect(employeeCard.getByRole("button", { name: "Undo review" }).first()).toBeVisible();
  await expect(employeeCard.getByRole("button", { name: "Undo review" }).nth(1)).toBeVisible();

  await employeePage.goto(`${FRONTEND_ORIGIN}/employee/timesheet`);
  await expect(employeePage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await selectSeededWeek(employeePage);

  const mondayHeader = employeePage.locator("thead th").filter({ hasText: "Mon" }).first();
  const tuesdayHeader = employeePage.locator("thead th").filter({ hasText: "Tue" }).first();
  await expect(mondayHeader).toContainText("Verify");
  await expect(tuesdayHeader).toContainText("Verify");

  await employeePage.getByRole("button", { name: "Add Task" }).click();
  const secondRow = employeePage.locator("tbody tr").nth(1);
  await expect(secondRow).toBeVisible();

  await secondRow.locator("select").first().selectOption("__custom__");
  await secondRow.getByPlaceholder("Project name").fill(`Preserve Project ${suffix}`);
  await secondRow.getByPlaceholder("Custom task name").fill(`Preserve Added Task ${suffix}`);
  await secondRow.locator('input[placeholder="0"]:not([disabled])').first().fill("1.5");

  await employeePage.getByRole("button", { name: "Save Draft" }).click();
  await expect(employeePage.getByText("Draft saved", { exact: true }).first()).toBeVisible();

  const preservedDraft = await fetchEmployeeTimesheet(
    employeeSession.accessToken,
    employeeSession.user.id,
    employeeSession.client,
  );
  expect(preservedDraft?.dailyReviewStatus?.mon).toBe("reviewed");
  expect(preservedDraft?.dailyReviewStatus?.tue).toBe("reviewed");
  expect(preservedDraft?.dailyReviewNotes?.mon).toBeUndefined();
  expect(preservedDraft?.dailyReviewNotes?.tue).toBeUndefined();
  expect(preservedDraft?.lines).toHaveLength(2);
  expect(Number(preservedDraft?.lines[1]?.hours.wed ?? 0)).toBe(1.5);

  await employeePage.reload();
  await selectSeededWeek(employeePage);
  await expect(mondayHeader).toContainText("Verify");
  await expect(tuesdayHeader).toContainText("Verify");

  expect(employeePageErrors).toEqual([]);
  expect(adminPageErrors).toEqual([]);

  await employeeContext.close();
  await adminContext.close();
  await employeeSession.client.dispose();
  await adminSession.client.dispose();
});

test("live daily review keeps employee states isolated, supports multiple reviewed days, and survives fresh sessions", async ({ browser }) => {
  test.setTimeout(300_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const firstEmployee = {
    name: `Daily Review Multi A ${suffix}`,
    email: `employee.multi.a.${suffix}@reforix.test`,
    phone: `7${suffix.padStart(9, "0").slice(0, 9)}`,
    department: "Engineering",
    initialNote: `Multi review A ${suffix}: worked across Monday and Tuesday and saved a draft for both days.`,
  };
  const secondEmployee = {
    name: `Daily Review Multi B ${suffix}`,
    email: `employee.multi.b.${suffix}@reforix.test`,
    phone: `6${suffix.padStart(9, "0").slice(0, 9)}`,
    department: "Engineering",
    initialNote: `Multi review B ${suffix}: logged Monday work only and left the rest untouched.`,
  };

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const createEmployee = async (employee: typeof firstEmployee, keyPrefix: string) => {
    const response = await adminSession.client.post("/api/admin/employees", {
      data: {
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        position: "QA Engineer",
        salary: 600000,
        payType: "monthly",
        department: employee.department,
        status: "active",
      },
      headers: authHeaders(adminSession, {
        "x-idempotency-key": `${keyPrefix}-${suffix}`,
      }),
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as {
      temporaryPassword?: string;
    };
    expect(payload.temporaryPassword).toBeTruthy();
    return payload.temporaryPassword as string;
  };

  const firstEmployeePassword = await createEmployee(firstEmployee, "daily-review-multi-a");
  const secondEmployeePassword = await createEmployee(secondEmployee, "daily-review-multi-b");

  const firstEmployeeSession = await loginApi(firstEmployee.email, firstEmployeePassword);
  const secondEmployeeSession = await loginApi(secondEmployee.email, secondEmployeePassword);

  const seedDraft = async (
    employeeSession: typeof firstEmployeeSession,
    employeeName: string,
    note: string,
    hours: Partial<Record<DayKey, number>>,
    keyPrefix: string,
  ) => {
    const response = await employeeSession.client.post("/api/business/timesheets", {
      data: {
        employeeId: employeeSession.user.id,
        employeeNameSnapshot: employeeName,
        weekStart,
        lines: [
          {
            project: "Custom project",
            task: "Custom task",
            notes: "",
            workNotes: { mon: note, ...(hours.tue ? { tue: `${note} Tuesday continuation.` } : {}) },
            hours: blankHours(hours),
          },
        ],
      },
      headers: authHeaders(employeeSession, {
        "x-idempotency-key": `${keyPrefix}-${suffix}`,
      }),
    });
    expect(response.ok()).toBeTruthy();
  };

  await seedDraft(
    firstEmployeeSession,
    firstEmployee.name,
    firstEmployee.initialNote,
    { mon: 2.5, tue: 1.5 },
    "daily-review-multi-seed-a",
  );
  await seedDraft(
    secondEmployeeSession,
    secondEmployee.name,
    secondEmployee.initialNote,
    { mon: 4 },
    "daily-review-multi-seed-b",
  );

  let adminBrowserSession = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  await adminBrowserSession.page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminBrowserSession.page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminBrowserSession.page.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);

  const firstEmployeeCard = employeeCardFor(adminBrowserSession.page, firstEmployee.name);
  const secondEmployeeCard = employeeCardFor(adminBrowserSession.page, secondEmployee.name);
  await expect(firstEmployeeCard).toBeVisible({ timeout: 15000 });
  await expect(secondEmployeeCard).toBeVisible({ timeout: 15000 });

  await toggleDailyReview(
    adminBrowserSession.page,
    firstEmployeeCard.getByRole("button", { name: "Mark Monday as reviewed" }).first(),
    "mon",
  );
  await expect(firstEmployeeCard.getByRole("button", { name: "Undo review" }).first()).toBeVisible();
  await toggleDailyReview(
    adminBrowserSession.page,
    firstEmployeeCard.getByRole("button", { name: "Mark Tuesday as reviewed" }).first(),
    "tue",
  );
  await expect(firstEmployeeCard.getByRole("button", { name: "Undo review" }).nth(1)).toBeVisible();

  await toggleDailyReview(
    adminBrowserSession.page,
    secondEmployeeCard.getByRole("button", { name: "Mark Monday as reviewed" }).first(),
    "mon",
  );
  await expect(secondEmployeeCard.getByRole("button", { name: "Undo review" }).first()).toBeVisible();
  await expect(secondEmployeeCard.getByRole("button", { name: "Mark Tuesday as reviewed" }).first()).toBeVisible();

  const firstReviewedDraft = await fetchEmployeeTimesheet(
    firstEmployeeSession.accessToken,
    firstEmployeeSession.user.id,
    firstEmployeeSession.client,
  );
  const secondReviewedDraft = await fetchEmployeeTimesheet(
    secondEmployeeSession.accessToken,
    secondEmployeeSession.user.id,
    secondEmployeeSession.client,
  );

  expect(firstReviewedDraft?.dailyReviewStatus?.mon).toBe("reviewed");
  expect(firstReviewedDraft?.dailyReviewStatus?.tue).toBe("reviewed");
  expect(secondReviewedDraft?.dailyReviewStatus?.mon).toBe("reviewed");
  expect(secondReviewedDraft?.dailyReviewStatus?.tue).toBeUndefined();

  expect(adminBrowserSession.pageErrors).toEqual([]);
  await adminBrowserSession.context.close();

  adminBrowserSession = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
  await adminBrowserSession.page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminBrowserSession.page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminBrowserSession.page.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);

  const firstEmployeeCardAfterRestart = employeeCardFor(adminBrowserSession.page, firstEmployee.name);
  const secondEmployeeCardAfterRestart = employeeCardFor(adminBrowserSession.page, secondEmployee.name);
  await expect(firstEmployeeCardAfterRestart).toBeVisible({ timeout: 15000 });
  await expect(secondEmployeeCardAfterRestart).toBeVisible({ timeout: 15000 });

  await expect(firstEmployeeCardAfterRestart.getByRole("button", { name: "Undo review" }).first()).toBeVisible();
  await expect(firstEmployeeCardAfterRestart.getByRole("button", { name: "Undo review" }).nth(1)).toBeVisible();
  await expect(secondEmployeeCardAfterRestart.getByRole("button", { name: "Undo review" }).first()).toBeVisible();
  await expect(secondEmployeeCardAfterRestart.getByRole("button", { name: "Mark Tuesday as reviewed" }).first()).toBeVisible();

  await toggleDailyReview(
    adminBrowserSession.page,
    firstEmployeeCardAfterRestart.getByRole("button", { name: "Return to employee with note" }).first(),
    "mon",
    `Please update Monday work for ${firstEmployee.name} ${suffix}.`,
  );

  const firstEmployeeAfterUndo = await fetchEmployeeTimesheet(
    firstEmployeeSession.accessToken,
    firstEmployeeSession.user.id,
    firstEmployeeSession.client,
  );
  expect(firstEmployeeAfterUndo?.dailyReviewStatus?.mon).toBe("reverted");
  expect(firstEmployeeAfterUndo?.dailyReviewStatus?.tue).toBe("reviewed");
  expect(firstEmployeeAfterUndo?.dailyReviewNotes?.mon).toContain("Please update Monday work");

  expect(adminBrowserSession.pageErrors).toEqual([]);

  await adminBrowserSession.context.close();
  await firstEmployeeSession.client.dispose();
  await secondEmployeeSession.client.dispose();
  await adminSession.client.dispose();
});

test("live daily review filters by department, employee, and date and preserves long note previews", async ({ browser }) => {
  test.setTimeout(300_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const longNote = `Filter review ${suffix}: coordinated project updates, captured blockers, aligned task ownership, and wrote a deliberately long note for hover-preview verification. `
    .repeat(3)
    .trim();
  const employees = [
    {
      name: `Filter Review Eng A ${suffix}`,
      email: `employee.filter.eng.a.${suffix}@reforix.test`,
      phone: `5${suffix.padStart(9, "0").slice(0, 9)}`,
      department: "Engineering",
      hours: { mon: 4.5 },
      note: longNote,
    },
    {
      name: `Filter Review Eng B ${suffix}`,
      email: `employee.filter.eng.b.${suffix}@reforix.test`,
      phone: `4${suffix.padStart(9, "0").slice(0, 9)}`,
      department: "Engineering",
      hours: { mon: 2 },
      note: `Filter review ${suffix}: engineering employee B saved a shorter Monday draft.`,
    },
    {
      name: `Filter Review Ops ${suffix}`,
      email: `employee.filter.ops.${suffix}@reforix.test`,
      phone: `3${suffix.padStart(9, "0").slice(0, 9)}`,
      department: "Operations",
      hours: { mon: 3.5 },
      note: `Filter review ${suffix}: operations employee saved a draft for the same date.`,
    },
  ] as const;

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const provisionedEmployees = [] as Array<{
    name: string;
    email: string;
    department: string;
    password: string;
    session: Awaited<ReturnType<typeof loginApi>>;
  }>;

  for (const [index, employee] of employees.entries()) {
    const createEmployeeResponse = await adminSession.client.post("/api/admin/employees", {
      data: {
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        position: "QA Engineer",
        salary: 600000,
        payType: "monthly",
        department: employee.department,
        status: "active",
      },
      headers: authHeaders(adminSession, {
        "x-idempotency-key": `daily-review-filter-${suffix}-${index}`,
      }),
    });
    expect(createEmployeeResponse.ok()).toBeTruthy();
    const createEmployeePayload = (await createEmployeeResponse.json()) as {
      temporaryPassword?: string;
    };
    expect(createEmployeePayload.temporaryPassword).toBeTruthy();

    const password = createEmployeePayload.temporaryPassword as string;
    const session = await loginApi(employee.email, password);

    const saveDraftResponse = await session.client.post("/api/business/timesheets", {
      data: {
        employeeId: session.user.id,
        employeeNameSnapshot: employee.name,
        weekStart,
        lines: [
          {
            project: "Custom project",
            task: "Custom task",
            notes: "",
            workNotes: { mon: employee.note },
            hours: blankHours(employee.hours),
          },
        ],
      },
      headers: authHeaders(session, {
        "x-idempotency-key": `daily-review-filter-seed-${suffix}-${index}`,
      }),
    });
    expect(saveDraftResponse.ok()).toBeTruthy();

    provisionedEmployees.push({
      name: employee.name,
      email: employee.email,
      department: employee.department,
      password,
      session,
    });
  }

  const adminBrowserSession = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
  await adminBrowserSession.page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminBrowserSession.page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminBrowserSession.page.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);

  const engineeringACard = employeeCardFor(adminBrowserSession.page, employees[0].name);
  const engineeringBCard = employeeCardFor(adminBrowserSession.page, employees[1].name);
  const operationsCard = employeeCardFor(adminBrowserSession.page, employees[2].name);
  const departmentSelect = adminBrowserSession.page.getByRole("combobox").first();
  const employeeSelect = adminBrowserSession.page.getByRole("combobox").nth(1);
  await expect(engineeringACard).toBeVisible({ timeout: 15000 });
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });
  await expect(operationsCard).toBeVisible({ timeout: 15000 });

  const mondayHourCell = engineeringACard.locator("tbody tr").first().locator("td").nth(2).locator("div").first();
  await mondayHourCell.hover();
  await expect(adminBrowserSession.page.getByText("Work Note", { exact: true })).toBeVisible();
  await expect(adminBrowserSession.page.getByText(longNote.slice(0, 80), { exact: false })).toBeVisible();

  await chooseSelectOption(adminBrowserSession.page, departmentSelect, "Engineering");
  await expect(engineeringACard).toBeVisible({ timeout: 15000 });
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });
  await expect(operationsCard).toHaveCount(0);

  await chooseSelectOption(adminBrowserSession.page, employeeSelect, employees[1].name);
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });
  await expect(engineeringACard).toHaveCount(0);
  await expect(operationsCard).toHaveCount(0);

  await adminBrowserSession.page.locator('input[type="date"]').first().fill("2026-05-15");
  await expect(adminBrowserSession.page.getByText("No saved employee timesheets match the selected date and filters yet.")).toBeVisible();

  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });

  await chooseSelectOption(adminBrowserSession.page, employeeSelect, "All employees");
  await expect(engineeringACard).toBeVisible({ timeout: 15000 });
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });

  await chooseSelectOption(adminBrowserSession.page, departmentSelect, "All departments");
  await expect(engineeringACard).toBeVisible({ timeout: 15000 });
  await expect(engineeringBCard).toBeVisible({ timeout: 15000 });
  await expect(operationsCard).toBeVisible({ timeout: 15000 });

  expect(adminBrowserSession.pageErrors).toEqual([]);

  await adminBrowserSession.context.close();
  await Promise.all(provisionedEmployees.map((employee) => employee.session.client.dispose()));
  await adminSession.client.dispose();
});

test("live daily review scales to many employee cards and keeps department filters stable", async ({ browser }) => {
  test.setTimeout(360_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const seededEmployees: SeededEmployeeSession[] = [];
  for (let index = 0; index < 10; index += 1) {
    const employee = {
      name: `Daily Review Scale ${suffix} ${index + 1}`,
      email: `employee.scale.${suffix}.${index + 1}@reforix.test`,
      phone: `${suffix}${index + 1}`.slice(-10),
      department: index % 3 === 0 ? "Operations" : "Engineering",
      note: `Scale review ${suffix} item ${index + 1}: saved a daily draft to stress test the review list.`,
      hours: { mon: 1 + (index % 4) * 0.5 },
      mode: index < 4 ? "submitted" : "draft",
    } as const;

    seededEmployees.push(await provisionEmployeeTimesheet(adminSession, employee, suffix, index));
  }

  const adminBrowserSession = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
  await adminBrowserSession.page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminBrowserSession.page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await adminBrowserSession.page.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);

  const visibleCards = seededEmployees.map((employee) => employeeCardFor(adminBrowserSession.page, employee.name));
  for (const card of visibleCards) {
    await expect(card).toBeVisible({ timeout: 15000 });
  }

  const operationsEmployees = seededEmployees.filter((employee) => employee.department === "Operations");
  const engineeringEmployees = seededEmployees.filter((employee) => employee.department === "Engineering");

  await chooseSelectOption(adminBrowserSession.page, adminBrowserSession.page.getByRole("combobox").first(), "Operations");
  for (const employee of operationsEmployees) {
    await expect(employeeCardFor(adminBrowserSession.page, employee.name)).toBeVisible({ timeout: 15000 });
  }
  for (const employee of engineeringEmployees) {
    await expect(employeeCardFor(adminBrowserSession.page, employee.name)).toHaveCount(0);
  }

  await chooseSelectOption(adminBrowserSession.page, adminBrowserSession.page.getByRole("combobox").first(), "All departments");
  await chooseSelectOption(adminBrowserSession.page, adminBrowserSession.page.getByRole("combobox").nth(1), "All employees");
  for (const employee of visibleCards) {
    await expect(employee).toBeVisible({ timeout: 15000 });
  }

  expect(adminBrowserSession.pageErrors).toEqual([]);

  await adminBrowserSession.context.close();
  await Promise.all(seededEmployees.map((employee) => employee.session.client.dispose()));
  await adminSession.client.dispose();
});

test("live admin visibility rules distinguish submitted weekly sheets from draft daily review sheets", async ({ browser }) => {
  test.setTimeout(240_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const draftEmployee = {
    name: `Visibility Draft ${suffix}`,
    email: `employee.visibility.draft.${suffix}@reforix.test`,
    phone: `9${suffix.padStart(9, "0").slice(0, 9)}`,
    department: "Engineering",
    note: `Visibility draft ${suffix}: saved work but intentionally left as draft.`,
    hours: { mon: 2 },
  } as const;
  const submittedEmployee = {
    name: `Visibility Submitted ${suffix}`,
    email: `employee.visibility.submitted.${suffix}@reforix.test`,
    phone: `8${suffix.padStart(9, "0").slice(0, 9)}`,
    department: "Operations",
    note: `Visibility submitted ${suffix}: saved work and then submitted for review.`,
    hours: { mon: 3 },
  } as const;

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const draftSession = await provisionEmployeeTimesheet(
    adminSession,
    {
      ...draftEmployee,
      mode: "draft",
    },
    suffix,
    0,
  );
  const submittedSession = await provisionEmployeeTimesheet(
    adminSession,
    {
      ...submittedEmployee,
      mode: "submitted",
    },
    suffix,
    1,
  );

  const adminBrowserSession = await createAuthenticatedContext(browser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  await adminBrowserSession.page.goto(`${FRONTEND_ORIGIN}/admin/timesheets`);
  await expect(adminBrowserSession.page.getByRole("heading", { name: "Timesheets" })).toBeVisible();

  await expect(adminBrowserSession.page.getByRole("button", { name: submittedEmployee.name })).toBeVisible();
  await expect(adminBrowserSession.page.getByRole("button", { name: draftEmployee.name })).toHaveCount(0);

  await adminBrowserSession.page.getByRole("button", { name: "Daily Review", exact: true }).click();
  await adminBrowserSession.page.locator('input[type="date"]').first().fill(weekStartDate);

  const draftCard = employeeCardFor(adminBrowserSession.page, draftEmployee.name);
  const submittedCard = employeeCardFor(adminBrowserSession.page, submittedEmployee.name);
  await expect(draftCard).toBeVisible({ timeout: 15000 });
  await expect(submittedCard).toBeVisible({ timeout: 15000 });
  await expect(draftCard.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(submittedCard.getByText("Submitted", { exact: true }).first()).toBeVisible();

  await adminBrowserSession.page.getByRole("button", { name: "Weekly Timesheet", exact: true }).click();
  await expect(adminBrowserSession.page.getByRole("button", { name: submittedEmployee.name })).toBeVisible();
  await expect(adminBrowserSession.page.getByRole("button", { name: draftEmployee.name })).toHaveCount(0);

  const draftTimesheet = await fetchEmployeeTimesheet(draftSession.session.accessToken, draftSession.session.user.id, draftSession.session.client);
  const submittedTimesheet = await fetchEmployeeTimesheet(
    submittedSession.session.accessToken,
    submittedSession.session.user.id,
    submittedSession.session.client,
  );

  expect(draftTimesheet?.status).toBe("draft");
  expect(submittedTimesheet?.status).toBe("submitted");

  expect(adminBrowserSession.pageErrors).toEqual([]);

  await adminBrowserSession.context.close();
  await draftSession.session.client.dispose();
  await submittedSession.session.client.dispose();
  await adminSession.client.dispose();
});
