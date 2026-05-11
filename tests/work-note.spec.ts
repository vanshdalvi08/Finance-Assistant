import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const weekStart = "2026-05-04T12:00:00.000Z";
const weekStartDate = weekStart.slice(0, 10);
const workNoteText =
  "Completed API reconciliation, verified submission edge cases, and prepared the rollout notes.";
const updatedWorkNoteText =
  "Adjusted the reconciliation totals, updated the rollout summary, and validated the revised submission payload.";

const employeeUser = {
  id: "emp-work-note-1",
  tenantId: "tenant-1",
  name: "Work Note Employee",
  email: "employee@example.com",
  phone: "9999999999",
  role: "employee",
  employeeId: "YOJ-TEST-01",
  position: "QA Engineer",
  department: "Engineering",
  salary: 600000,
  payType: "monthly",
  hourlyRate: null,
  profilePhotoUrl: null,
  clientInfo: {},
  mfaEnabled: false,
  status: "active",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  lastLoginAt: null,
} as const;

const adminUser = {
  id: "admin-work-note-1",
  tenantId: "tenant-1",
  name: "Admin Reviewer",
  email: "admin@example.com",
  phone: "8888888888",
  role: "admin",
  employeeId: null,
  position: "Administrator",
  department: "Operations",
  salary: 0,
  payType: "monthly",
  hourlyRate: null,
  profilePhotoUrl: null,
  clientInfo: {},
  mfaEnabled: false,
  status: "active",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  lastLoginAt: null,
} as const;

function employeeDraft() {
  return {
    id: "ts-work-note-1",
    employeeId: employeeUser.id,
    employeeNameSnapshot: employeeUser.name,
    weekStart,
    status: "draft",
    lines: [
      {
        id: "line-work-note-1",
        project: "",
        task: "",
        projectBudgetId: undefined,
        projectTaskId: undefined,
        subTask: "",
        notes: "",
        workNotes: {},
        hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
      },
    ],
  };
}

function projectCatalog() {
  return [
    {
      id: "project-budget-1",
      project: "Work Note Project",
      totalBudget: 10000,
      client: "Mock Client",
      note: "",
      tasks: [
        {
          id: "project-task-1",
          name: "Work Note Task",
          description: "Mock task for work note verification",
          maxHours: 40,
          startDate: "2026-04-27",
          endDate: "2026-05-10",
          hourLimitScope: "overall",
          subTasks: [],
          status: "active",
        },
      ],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
}

function projectSummary() {
  return [
    {
      id: "project-budget-1",
      project: "Work Note Project",
      labourHours: 0,
      labourCost: 0,
      expenseCost: 0,
      totalBudget: 10000,
      client: "Mock Client",
      note: "",
      spent: 0,
      remainingBudget: 10000,
      utilisation: 0,
      tasks: [
        {
          id: "project-task-1",
          name: "Work Note Task",
          description: "Mock task for work note verification",
          maxHours: 40,
          startDate: "2026-04-27",
          endDate: "2026-05-10",
          hourLimitScope: "overall",
          subTasks: [],
          status: "active",
          usedHours: 0,
          remainingHours: 40,
          utilisation: 0,
          hoursPerDay: 2.86,
        },
      ],
    },
  ];
}

function monthCalendar() {
  return {
    month: "2026-04",
    monthLabel: "April 2026",
    summary: {
      annualLeaveLimit: 10,
      approvedLeaveDaysYear: 0,
      pendingLeaveDaysYear: 0,
      remainingLeaveDaysYear: 10,
      daysWorked: 1,
      hoursLogged: 1,
      leaveDays: 0,
      holidayDays: 0,
      companyHolidayDays: 0,
      requestedHolidayDays: 0,
      pendingLeaveDays: 0,
      pendingHolidayDays: 0,
      expenseSubmissions: 0,
    },
    days: [
      { date: "2026-05-04T12:00:00.000Z", day: 4, isWeekend: false, worked: true, leave: false, holiday: false, hours: 1, expenseCount: 0 },
      { date: "2026-05-05T12:00:00.000Z", day: 5, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-06T12:00:00.000Z", day: 6, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-07T12:00:00.000Z", day: 7, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-08T12:00:00.000Z", day: 8, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-09T12:00:00.000Z", day: 9, isWeekend: true, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-10T12:00:00.000Z", day: 10, isWeekend: true, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
    ],
  };
}

async function mockBaseSession(context: BrowserContext, user: typeof employeeUser | typeof adminUser) {
  await context.route("**/api/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "mock-csrf-token" }),
    });
  });

  await context.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "mock-access-token",
        csrfToken: "mock-csrf-token",
        user,
      }),
    });
  });

  await context.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user }),
    });
  });

  await context.route("**/api/notifications/read-all", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await context.route("**/api/notifications/*/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        notification: {
          id: "notif-1",
          kind: "system",
          title: "Mock",
          message: "Mock",
          createdAt: new Date().toISOString(),
          readAt: new Date().toISOString(),
        },
      }),
    });
  });

  await context.route("**/api/notifications", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ notifications: [], unreadCount: 0 }),
    });
  });
}

function trackPageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

test("employee can save a work note and admin can review it", async ({ browser }) => {
  let currentEntry = employeeDraft();
  let savedDraftPayload: Record<string, unknown> | null = null;
  let submittedEntry: Record<string, unknown> | null = null;

  const employeeContext = await browser.newContext();
  await mockBaseSession(employeeContext, employeeUser);

  await employeeContext.route("**/api/business/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/business/timesheets" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timesheets: [currentEntry] }),
      });
      return;
    }

    if (path === "/api/business/projects/catalog") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: projectCatalog() }),
      });
      return;
    }

    if (path === "/api/business/projects/summary") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: projectSummary() }),
      });
      return;
    }

    if (path === "/api/business/month-calendar") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ monthCalendar: monthCalendar() }),
      });
      return;
    }

    if (path === "/api/business/timesheets" && route.request().method() === "POST") {
      savedDraftPayload = JSON.parse(route.request().postData() ?? "{}");
      currentEntry = savedDraftPayload as typeof currentEntry;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timesheet: currentEntry }),
      });
      return;
    }

    if (path === "/api/business/timesheets/submit" && route.request().method() === "POST") {
      submittedEntry = {
        ...JSON.parse(route.request().postData() ?? "{}"),
        status: "submitted",
        submittedAt: "2026-05-03T10:00:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timesheet: submittedEntry }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  const employeePage = await employeeContext.newPage();
  const employeePageErrors = trackPageErrors(employeePage);

  await employeePage.goto("/employee/timesheet");
  await expect(employeePage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  await employeePage.locator('input[type="date"]').first().fill(weekStartDate);

  const taskRow = employeePage.locator("tbody tr").first();
  const mondayCell = taskRow.locator("td").nth(2);
  await taskRow.locator("select").nth(0).selectOption("Work Note Project");
  await expect(taskRow.locator("select").nth(1)).toBeVisible();
  await taskRow.locator("select").nth(1).selectOption("project-task-1");
  await mondayCell.hover();
  await employeePage.getByRole("button", { name: "Add work note for Mon" }).click();
  const workNoteDialog = employeePage.getByRole("dialog");
  await expect(workNoteDialog).toBeVisible();

  await workNoteDialog.locator('input[inputmode="decimal"]').fill("1");
  await employeePage
    .getByPlaceholder("Describe the work completed, key update, or specific output for this task.")
    .fill(workNoteText);
  await employeePage.getByRole("button", { name: "Save" }).click();

  await expect(employeePage.getByRole("dialog")).not.toBeVisible();
  await expect(employeePage.getByRole("button", { name: "Edit work note for Mon" })).toBeVisible();
  await mondayCell.locator("input").hover();
  await expect(employeePage.getByText(workNoteText)).toBeVisible();

  await employeePage.getByRole("button", { name: "Save Draft" }).click();
  await expect(employeePage.getByText("Draft saved", { exact: true }).first()).toBeVisible();
  expect(savedDraftPayload).not.toBeNull();
  expect((savedDraftPayload as { lines: Array<{ workNotes?: { mon?: string }; hours: { mon: number } }> }).lines[0]?.workNotes?.mon).toBe(workNoteText);
  expect((savedDraftPayload as { lines: Array<{ workNotes?: { mon?: string }; hours: { mon: number } }> }).lines[0]?.hours.mon).toBe(1);

  await employeePage.getByRole("button", { name: "Edit work note for Mon" }).click();
  await expect(workNoteDialog).toBeVisible();
  await workNoteDialog.locator('input[inputmode="decimal"]').fill("2");
  await employeePage
    .getByPlaceholder("Describe the work completed, key update, or specific output for this task.")
    .fill(updatedWorkNoteText);
  await employeePage.getByRole("button", { name: "Save" }).click();

  await employeePage.getByRole("button", { name: "Submit for Review" }).click();
  await expect(employeePage.getByText("Timesheet submitted", { exact: true }).first()).toBeVisible();
  expect(submittedEntry).not.toBeNull();
  expect((submittedEntry as { lines: Array<{ workNotes?: { mon?: string }; hours: { mon: number } }> }).lines[0]?.workNotes?.mon).toBe(updatedWorkNoteText);
  expect((submittedEntry as { lines: Array<{ workNotes?: { mon?: string }; hours: { mon: number } }> }).lines[0]?.hours.mon).toBe(2);
  expect(employeePageErrors).toEqual([]);

  await employeeContext.close();

  const adminContext = await browser.newContext();
  await mockBaseSession(adminContext, adminUser);

  await adminContext.route("**/api/admin/employees", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employees: [
          {
            ...employeeUser,
            role: "employee",
          },
        ],
      }),
    });
  });

  await adminContext.route("**/api/business/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/business/timesheets") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timesheets: [submittedEntry] }),
      });
      return;
    }

    if (path === "/api/business/projects/summary") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: projectSummary() }),
      });
      return;
    }

    if (path === "/api/business/month-calendar") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ monthCalendar: monthCalendar() }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  const adminPage = await adminContext.newPage();
  const adminPageErrors = trackPageErrors(adminPage);

  await adminPage.goto("/admin/timesheets");
  await expect(adminPage.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  const detailButton = adminPage.getByRole("button", { name: "View in detail" }).first();
  await expect(detailButton).toBeVisible();
  await detailButton.click();
  const detailDialog = adminPage.getByRole("dialog");
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog).toContainText(updatedWorkNoteText);
  expect(adminPageErrors).toEqual([]);

  await adminContext.close();
});
