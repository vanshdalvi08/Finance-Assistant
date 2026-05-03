import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const weekStart = "2026-04-27T12:00:00.000Z";

const employeeUser = {
  id: "emp-work-note-ux",
  tenantId: "tenant-1",
  name: "Employee UX",
  email: "employee-ux@example.com",
  phone: "9999999999",
  role: "employee",
  employeeId: "YOJ-UX-01",
  position: "Engineer",
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
  id: "admin-work-note-ux",
  tenantId: "tenant-1",
  name: "Admin UX",
  email: "admin-ux@example.com",
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
    id: "ts-work-note-ux",
    employeeId: employeeUser.id,
    employeeNameSnapshot: employeeUser.name,
    weekStart,
    status: "draft",
    lines: [
      {
        id: "line-work-note-ux",
        project: "Work Note Project",
        task: "Work Note Task",
        projectBudgetId: "project-budget-1",
        projectTaskId: "project-task-1",
        subTask: "",
        notes: "",
        hours: { mon: 2, tue: 1, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
      },
    ],
  };
}

function submittedTimesheet() {
  return {
    id: "ts-work-note-admin-ux",
    employeeId: employeeUser.id,
    employeeNameSnapshot: "vansh Dalvi",
    weekStart,
    status: "submitted",
    lines: [
      {
        id: "line-work-note-admin-ux",
        project: "qwerty",
        task: "cascascsacascsacsc",
        subTask: "",
        notes: "xcx xcvvsdv",
        hours: { mon: 3, tue: 3, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
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
      { date: "2026-04-27T12:00:00.000Z", day: 27, isWeekend: false, worked: true, leave: false, holiday: false, hours: 1, expenseCount: 0 },
      { date: "2026-04-28T12:00:00.000Z", day: 28, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-04-29T12:00:00.000Z", day: 29, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-04-30T12:00:00.000Z", day: 30, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-01T12:00:00.000Z", day: 1, isWeekend: false, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-02T12:00:00.000Z", day: 2, isWeekend: true, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
      { date: "2026-05-03T12:00:00.000Z", day: 3, isWeekend: true, worked: false, leave: false, holiday: false, hours: 0, expenseCount: 0 },
    ],
  };
}

async function mockBaseSession(context: BrowserContext, user: typeof employeeUser | typeof adminUser) {
  await context.route("**/api/auth/csrf", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "mock-csrf-token" }) });
  });
  await context.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: "mock-access-token", csrfToken: "mock-csrf-token", user }),
    });
  });
  await context.route("**/api/auth/me", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
  });
  await context.route("**/api/notifications", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await context.route("**/api/notifications/*/read", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notification: null }) });
  });
  await context.route("**/api/notifications/read-all", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
}

function trackPageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return pageErrors;
}

test("employee work note dialog shows one close button", async ({ browser }) => {
  const context = await browser.newContext();
  await mockBaseSession(context, employeeUser);
  let currentDraft = employeeDraft();

  await context.route("**/api/business/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/business/timesheets" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timesheets: [currentDraft] }) });
      return;
    }
    if (path === "/api/business/projects/catalog") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: projectCatalog() }) });
      return;
    }
    if (path === "/api/business/projects/summary") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: projectSummary() }) });
      return;
    }
    if (path === "/api/business/employee-month-calendar") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(monthCalendar()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  const page = await context.newPage();
  const pageErrors = trackPageErrors(page);

  await page.goto("/employee/timesheet");
  await page.getByRole("button", { name: "Work Note" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Work Note" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button").filter({ has: page.locator("svg") })).toHaveCount(1);
  expect(pageErrors).toEqual([]);

  await context.close();
});

test("admin detail view shows work note inline without extra work-note action", async ({ browser }) => {
  const context = await browser.newContext();
  await mockBaseSession(context, adminUser);
  const timesheet = submittedTimesheet();

  await context.route("**/api/business/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/business/timesheets" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timesheets: [timesheet] }) });
      return;
    }
    if (path === "/api/business/projects/summary") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: projectSummary() }) });
      return;
    }
    if (path === "/api/business/employee-month-calendar") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(monthCalendar()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await context.route("**/api/admin/employees", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employees: [{ id: employeeUser.id, name: employeeUser.name }],
      }),
    });
  });

  const page = await context.newPage();
  const pageErrors = trackPageErrors(page);

  await page.goto("/timesheets");
  await page.getByRole("button", { name: "View in detail" }).click();

  const detailDialog = page.getByRole("dialog", { name: /Timesheet detail/i });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByText("Work note", { exact: false })).toBeVisible();
  await expect(detailDialog.getByText("xcx xcvvsdv")).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Work Note" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  await context.close();
});
