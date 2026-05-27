import { expect, test, type Page } from "@playwright/test";
import {
  authHeaders,
  createAuthenticatedContext,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  ensureDefaultAdminCredentials,
  FRONTEND_ORIGIN,
  loginApi,
} from "./live-test-helpers";

const weekStart = "2026-05-11T12:00:00.000Z";

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

async function readTaskOptions(page: Page) {
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator("select").nth(1)).toBeVisible();
  return firstRow.locator("select").nth(1).locator("option").allTextContents();
}

test("live per-employee project tasks stay visible only for assigned employees and enforce custom caps", async ({ browser }) => {
  test.setTimeout(240_000);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const projectName = `Allocation Project ${suffix}`;
  const targetedTaskName = `Assigned Task ${suffix}`;
  const sharedTaskName = `Shared Task ${suffix}`;

  await ensureDefaultAdminCredentials();
  const adminSession = await loginApi(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);

  const createEmployee = async (name: string, emailPrefix: string, phonePrefix: string, keyPrefix: string) => {
    const email = `${emailPrefix}.${suffix}@reforix.test`;
    const response = await adminSession.client.post("/api/admin/employees", {
      data: {
        name,
        email,
        phone: `${phonePrefix}${suffix.padStart(9, "0").slice(0, 9)}`,
        position: "QA Engineer",
        salary: 600000,
        payType: "monthly",
        department: "Engineering",
        status: "active",
      },
      headers: authHeaders(adminSession, {
        "x-idempotency-key": `${keyPrefix}-${suffix}`,
      }),
    });
    expect(response.ok()).toBeTruthy();

    const payload = (await response.json()) as {
      user: { id: string };
      temporaryPassword?: string;
    };
    expect(payload.temporaryPassword).toBeTruthy();

    const password = payload.temporaryPassword as string;
    const session = await loginApi(email, password);

    return {
      id: payload.user.id,
      name,
      email,
      password,
      session,
    };
  };

  const assignedEmployee = await createEmployee(`Alloc A ${suffix}`, "employee.alloc.a", "7", "project-assigned");
  const otherEmployee = await createEmployee(`Alloc B ${suffix}`, "employee.alloc.b", "6", "project-other");

  const createProjectResponse = await adminSession.client.post("/api/business/projects", {
    data: {
      project: projectName,
      totalBudget: 0,
      client: "Allocation QA",
      note: "Playwright coverage for targeted project task allocation.",
      tasks: [
        {
          name: targetedTaskName,
          description: "Only visible to the assigned employee.",
          maxHours: 8,
          hourLimitScope: "per_employee",
          employeeHourLimits: [
            {
              employeeId: assignedEmployee.id,
              hours: 4,
            },
          ],
          subTasks: ["Assigned work"],
          status: "active",
        },
        {
          name: sharedTaskName,
          description: "Visible to everyone.",
          maxHours: 6,
          hourLimitScope: "overall",
          subTasks: ["Shared work"],
          status: "active",
        },
      ],
      actorName: "Admin",
    },
    headers: authHeaders(adminSession, {
      "x-idempotency-key": `project-allocation-create-${suffix}`,
    }),
  });
  expect(createProjectResponse.ok()).toBeTruthy();

  const createProjectPayload = (await createProjectResponse.json()) as {
    project: {
      id: string;
      tasks: Array<{ id: string; name: string }>;
    };
  };
  const project = createProjectPayload.project;
  const targetedTask = project.tasks.find((task) => task.name === targetedTaskName);
  const sharedTask = project.tasks.find((task) => task.name === sharedTaskName);
  expect(targetedTask?.id).toBeTruthy();
  expect(sharedTask?.id).toBeTruthy();

  const { context: adminContext, page: adminPage, pageErrors: adminPageErrors } = await createAuthenticatedContext(
    browser,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
  );
  const { context: assignedContext, page: assignedPage, pageErrors: assignedPageErrors } = await createAuthenticatedContext(
    browser,
    assignedEmployee.email,
    assignedEmployee.password,
  );
  const { context: otherContext, page: otherPage, pageErrors: otherPageErrors } = await createAuthenticatedContext(
    browser,
    otherEmployee.email,
    otherEmployee.password,
  );

  await adminPage.goto(`${FRONTEND_ORIGIN}/project-budgets`);
  await expect(adminPage.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(adminPage.getByText(projectName, { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText(targetedTaskName, { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText(sharedTaskName, { exact: true }).first()).toBeVisible();

  await assignedPage.goto(`${FRONTEND_ORIGIN}/employee/timesheet`);
  await expect(assignedPage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  const assignedFirstRow = assignedPage.locator("tbody tr").first();
  await assignedFirstRow.locator("select").first().selectOption(projectName);
  await expect
    .poll(
      async () =>
        (await readTaskOptions(assignedPage))
          .map((value) => value.trim())
          .some((value) => value.includes(targetedTaskName)),
      { timeout: 15000 },
    )
    .toBeTruthy();
  await expect
    .poll(
      async () =>
        (await readTaskOptions(assignedPage))
          .map((value) => value.trim())
          .some((value) => value.includes(sharedTaskName)),
      { timeout: 15000 },
    )
    .toBeTruthy();

  await otherPage.goto(`${FRONTEND_ORIGIN}/employee/timesheet`);
  await expect(otherPage.getByRole("heading", { name: "My Timesheet" })).toBeVisible();
  const otherFirstRow = otherPage.locator("tbody tr").first();
  await otherFirstRow.locator("select").first().selectOption(projectName);
  await expect
    .poll(
      async () =>
        (await readTaskOptions(otherPage))
          .map((value) => value.trim())
          .some((value) => value.includes(sharedTaskName)),
      { timeout: 15000 },
    )
    .toBeTruthy();
  const otherTaskOptions = (await readTaskOptions(otherPage)).map((value) => value.trim());
  expect(otherTaskOptions.some((value) => value.includes(targetedTaskName))).toBeFalsy();

  const withinCapResponse = await assignedEmployee.session.client.post("/api/business/timesheets", {
    data: {
      employeeId: assignedEmployee.session.user.id,
      employeeNameSnapshot: assignedEmployee.name,
      weekStart,
      lines: [
        {
          project: projectName,
          projectBudgetId: project.id,
          task: targetedTaskName,
          projectTaskId: targetedTask?.id,
          subTask: "Assigned work",
          notes: "",
          workNotes: {
            mon: `Assigned employee valid claim ${suffix}.`,
          },
          hours: blankHours({ mon: 3 }),
        },
      ],
    },
    headers: authHeaders(assignedEmployee.session, {
      "x-idempotency-key": `project-allocation-valid-${suffix}`,
    }),
  });
  expect(withinCapResponse.ok()).toBeTruthy();
  const withinCapPayload = (await withinCapResponse.json()) as {
    timesheet?: { id: string };
  };
  expect(withinCapPayload.timesheet?.id).toBeTruthy();

  const overCapResponse = await assignedEmployee.session.client.patch(`/api/business/timesheets/${withinCapPayload.timesheet?.id}`, {
    data: {
      employeeId: assignedEmployee.session.user.id,
      employeeNameSnapshot: assignedEmployee.name,
      weekStart,
      lines: [
        {
          project: projectName,
          projectBudgetId: project.id,
          task: targetedTaskName,
          projectTaskId: targetedTask?.id,
          subTask: "Assigned work",
          notes: "",
          workNotes: {
            mon: `Assigned employee over-cap claim ${suffix}.`,
          },
          hours: blankHours({ mon: 5 }),
        },
      ],
    },
    headers: authHeaders(assignedEmployee.session, {
      "x-idempotency-key": `project-allocation-overcap-${suffix}`,
    }),
  });
  expect(overCapResponse.ok()).toBeFalsy();
  expect(overCapResponse.status()).toBe(400);
  const overCapPayload = (await overCapResponse.json()) as { message?: string };
  expect(overCapPayload.message).toContain("allows a maximum of 4 hours per employee");

  const unauthorizedResponse = await otherEmployee.session.client.post("/api/business/timesheets", {
    data: {
      employeeId: otherEmployee.session.user.id,
      employeeNameSnapshot: otherEmployee.name,
      weekStart,
      lines: [
        {
          project: projectName,
          projectBudgetId: project.id,
          task: targetedTaskName,
          projectTaskId: targetedTask?.id,
          subTask: "Assigned work",
          notes: "",
          workNotes: {
            mon: `Unauthorized employee claim ${suffix}.`,
          },
          hours: blankHours({ mon: 1 }),
        },
      ],
    },
    headers: authHeaders(otherEmployee.session, {
      "x-idempotency-key": `project-allocation-unauthorized-${suffix}`,
    }),
  });
  expect(unauthorizedResponse.ok()).toBeFalsy();
  expect(unauthorizedResponse.status()).toBe(400);
  const unauthorizedPayload = (await unauthorizedResponse.json()) as { message?: string };
  expect(unauthorizedPayload.message).toContain("assigned to selected employees only");

  expect(adminPageErrors).toEqual([]);
  expect(assignedPageErrors).toEqual([]);
  expect(otherPageErrors).toEqual([]);

  await adminContext.close();
  await assignedContext.close();
  await otherContext.close();
  await assignedEmployee.session.client.dispose();
  await otherEmployee.session.client.dispose();
  await adminSession.client.dispose();
});
