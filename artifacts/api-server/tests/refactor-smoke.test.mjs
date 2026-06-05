import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import {
  api,
  createEmployee,
  initializeSecuritySeed,
  login,
  randomSuffix,
  startApiServer,
  stopApiServer,
  waitForHealth,
} from "./security-fixtures.mjs";

let serverProcess;
let seed;

before(async () => {
  serverProcess = startApiServer();
  await waitForHealth(90000);
  seed = await initializeSecuritySeed();
});

after(async () => {
  try {
    if (seed?.platformSession?.accessToken) {
      await api(`/platform/tenants/${seed.tenantA.tenant.id}/status`, {
        method: "PATCH",
        token: seed.platformSession.accessToken,
        body: { status: "inactive" },
      });
      await api(`/platform/tenants/${seed.tenantB.tenant.id}/status`, {
        method: "PATCH",
        token: seed.platformSession.accessToken,
        body: { status: "inactive" },
      });
    }
  } catch {
    // Best-effort cleanup for seeded tenants.
  }

  await stopApiServer(serverProcess);
});

test("deep smoke: admin can create employee and employee can log in", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const createdEmployee = await createEmployee(adminToken, randomSuffix("refactor-smoke-login"));

  try {
    const employeeSession = await login(createdEmployee.user.email, createdEmployee.temporaryPassword);
    assert.ok(employeeSession.accessToken);
    assert.equal(employeeSession.user.email, createdEmployee.user.email);
    assert.equal(employeeSession.user.role, "employee");
  } finally {
    await api(`/admin/employees/${createdEmployee.user.id}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: project create/list/catalog/summary/names stay wired", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const suffix = randomSuffix("refactor-smoke-project");
  const projectName = `Smoke Project ${suffix}`;
  const taskName = "Piping";
  const taskDescription = "Equipment";

  const createResponse = await api("/business/projects", {
    method: "POST",
    token: adminToken,
    body: {
      project: projectName,
      totalBudget: 5000,
      client: "Smoke Client",
      note: "refactor smoke",
      tasks: [
        {
          name: taskName,
          description: taskDescription,
          maxHours: 40,
          durationDays: 14,
          status: "active",
        },
      ],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const projectId = createResponse.json.project.id;

  try {
    const listResponse = await api("/business/projects", { token: adminToken });
    const catalogResponse = await api("/business/projects/catalog", { token: adminToken });
    const summaryResponse = await api("/business/projects/summary", { token: adminToken });
    const namesResponse = await api("/business/projects/names", { token: adminToken });

    assert.equal(listResponse.status, 200, JSON.stringify(listResponse.json));
    assert.equal(catalogResponse.status, 200, JSON.stringify(catalogResponse.json));
    assert.equal(summaryResponse.status, 200, JSON.stringify(summaryResponse.json));
    assert.equal(namesResponse.status, 200, JSON.stringify(namesResponse.json));

    assert.ok(JSON.stringify(listResponse.json).includes(projectName));
    assert.ok(JSON.stringify(catalogResponse.json).includes(taskDescription));
    assert.ok(JSON.stringify(summaryResponse.json).includes(projectName));
    assert.ok(JSON.stringify(namesResponse.json).includes(projectName));
  } finally {
    await api(`/business/projects/${projectId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: employee can access project reference data", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const employeeToken = seed.tenantA.employeeSession.accessToken;
  const suffix = randomSuffix("refactor-smoke-project-employee");
  const projectName = `Employee Project ${suffix}`;

  const createResponse = await api("/business/projects", {
    method: "POST",
    token: adminToken,
    body: {
      project: projectName,
      totalBudget: 3200,
      client: "Employee Smoke Client",
      note: "employee access smoke",
      tasks: [
        {
          name: "Drafting",
          description: "Isometric",
          maxHours: 24,
          durationDays: 10,
          status: "active",
        },
      ],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const projectId = createResponse.json.project.id;

  try {
    const summaryResponse = await api("/business/projects/summary", { token: employeeToken });
    const namesResponse = await api("/business/projects/names", { token: employeeToken });
    const catalogResponse = await api("/business/projects/catalog", { token: employeeToken });

    assert.equal(summaryResponse.status, 200, JSON.stringify(summaryResponse.json));
    assert.equal(namesResponse.status, 200, JSON.stringify(namesResponse.json));
    assert.equal(catalogResponse.status, 200, JSON.stringify(catalogResponse.json));
    assert.ok(JSON.stringify(summaryResponse.json).includes(projectName));
    assert.ok(JSON.stringify(namesResponse.json).includes(projectName));
    assert.ok(JSON.stringify(catalogResponse.json).includes("Isometric"));
  } finally {
    await api(`/business/projects/${projectId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: funds add/list/detail keep working", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const suffix = randomSuffix("refactor-smoke-fund");
  const source = `Smoke Fund ${suffix}`;

  const createResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      source,
      amount: 2500,
      date: "2026-04-20",
      note: "fund smoke",
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const fundId = createResponse.json.fund.id;

  try {
    const listResponse = await api("/business/funds", { token: adminToken });
    const detailResponse = await api(`/business/funds/${fundId}`, { token: adminToken });

    assert.equal(listResponse.status, 200, JSON.stringify(listResponse.json));
    assert.equal(detailResponse.status, 200, JSON.stringify(detailResponse.json));
    assert.ok(listResponse.json.funds.some((fund) => fund.id === fundId && fund.source === source));
    assert.equal(detailResponse.json.fund.id, fundId);
    assert.equal(detailResponse.json.fund.source, source);
  } finally {
    await api(`/business/funds/${fundId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: employee office expense is visible to admin", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const employeeToken = seed.tenantA.employeeSession.accessToken;
  const employee = seed.tenantA.employee.user;
  const category = `Smoke Expense ${randomSuffix("refactor-smoke-expense")}`;

  const createResponse = await api("/business/expenses", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      category,
      group: "office",
      amount: 125,
      date: "2026-04-20",
      description: "employee office expense smoke",
      note: "expense smoke",
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const expenseId = createResponse.json.expense.id;

  try {
    const adminListResponse = await api("/business/expenses", { token: adminToken });
    const employeeDetailResponse = await api(`/business/expenses/${expenseId}`, { token: employeeToken });

    assert.equal(adminListResponse.status, 200, JSON.stringify(adminListResponse.json));
    assert.equal(employeeDetailResponse.status, 200, JSON.stringify(employeeDetailResponse.json));
    assert.ok(adminListResponse.json.expenses.some((expense) => expense.id === expenseId));
    assert.equal(employeeDetailResponse.json.expense.employeeId, employee.id);
  } finally {
    await api(`/business/expenses/${expenseId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: employee cannot submit personal expense", { concurrency: false }, async () => {
  const employeeToken = seed.tenantA.employeeSession.accessToken;
  const employee = seed.tenantA.employee.user;

  const response = await api("/business/expenses", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      category: "Personal Smoke Expense",
      group: "personal",
      amount: 50,
      date: "2026-04-20",
      description: "personal expense should be blocked",
    },
  });

  assert.equal(response.status, 403, JSON.stringify(response.json));
});

test("deep smoke: admin can approve employee expense and status reflects", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const employeeToken = seed.tenantA.employeeSession.accessToken;
  const employee = seed.tenantA.employee.user;
  const fundResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      source: `Expense Approval Fund ${randomSuffix("refactor-smoke-fund-expense-approve")}`,
      amount: 2000,
      date: "2026-04-20",
      note: "expense approval backing fund",
    },
  });
  assert.equal(fundResponse.status, 201, JSON.stringify(fundResponse.json));
  const fundId = fundResponse.json.fund.id;

  const createResponse = await api("/business/expenses", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      category: `Approval Smoke ${randomSuffix("refactor-smoke-expense-approve")}`,
      group: "office",
      amount: 80,
      date: "2026-04-20",
      description: "expense approval smoke",
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const expenseId = createResponse.json.expense.id;

  try {
    const approveResponse = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "approved", reviewerNote: "approved in smoke test" },
    });
    const detailResponse = await api(`/business/expenses/${expenseId}`, { token: adminToken });

    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));
    assert.equal(detailResponse.status, 200, JSON.stringify(detailResponse.json));
    assert.equal(approveResponse.json.expense.status, "approved");
    assert.equal(detailResponse.json.expense.status, "approved");
  } finally {
    await api(`/business/expenses/${expenseId}`, {
      method: "DELETE",
      token: adminToken,
    });
    await api(`/business/funds/${fundId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: purchase order create, task add, and pay stay working", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const suffix = randomSuffix("refactor-smoke-po");
  const fundResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      source: `PO Payment Fund ${randomSuffix("refactor-smoke-fund-po")}`,
      amount: 3000,
      date: "2026-04-20",
      note: "po payment backing fund",
    },
  });
  assert.equal(fundResponse.status, 201, JSON.stringify(fundResponse.json));
  const fundId = fundResponse.json.fund.id;

  const createResponse = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Smoke PO ${suffix}`,
      totalAmount: 500,
      vendor: "Smoke Vendor",
      date: "2026-04-20",
      notes: "purchase order smoke",
      tasks: [],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const purchaseOrderId = createResponse.json.purchaseOrder.id;

  try {
    const taskResponse = await api(`/business/purchase-orders/${purchaseOrderId}/tasks`, {
      method: "POST",
      token: adminToken,
      body: {
        taskName: "Smoke task",
        description: "payable task",
        hours: 2,
        rate: 50,
      },
    });
    assert.equal(taskResponse.status, 201, JSON.stringify(taskResponse.json));
    const taskId = taskResponse.json.task.id;

    const payResponse = await api(`/business/purchase-orders/${purchaseOrderId}/tasks/${taskId}/pay`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    const detailResponse = await api(`/business/purchase-orders/${purchaseOrderId}`, {
      token: adminToken,
    });

    assert.equal(payResponse.status, 200, JSON.stringify(payResponse.json));
    assert.equal(detailResponse.status, 200, JSON.stringify(detailResponse.json));
    assert.equal(
      detailResponse.json.purchaseOrder.tasks.find((task) => task.id === taskId)?.status,
      "paid",
    );
  } finally {
    await api(`/business/purchase-orders/${purchaseOrderId}`, {
      method: "DELETE",
      token: adminToken,
    });
    await api(`/business/funds/${fundId}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: employee draft timesheet is visible to admin", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const createdEmployee = await createEmployee(adminToken, randomSuffix("refactor-smoke-timesheet-draft"));
  const employee = createdEmployee.user;
  const employeeSession = await login(employee.email, createdEmployee.temporaryPassword);

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeSession.accessToken,
    body: {
      employeeId: employee.id,
      weekStart: "2026-05-18",
      lines: [{ project: "Smoke Draft Project", task: "Draft task", hours: { mon: 2 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const adminListResponse = await api("/business/timesheets", {
      token: adminToken,
    });
    const adminDetailResponse = await api(`/business/timesheets/${timesheetId}`, {
      token: adminToken,
    });

    assert.equal(adminListResponse.status, 200, JSON.stringify(adminListResponse.json));
    assert.equal(adminDetailResponse.status, 200, JSON.stringify(adminDetailResponse.json));
    assert.ok(adminListResponse.json.timesheets.some((timesheet) => timesheet.id === timesheetId));
    assert.equal(adminDetailResponse.json.timesheet.status, "draft");
  } finally {
    await api(`/business/timesheets/${timesheetId}`, {
      method: "DELETE",
      token: adminToken,
    });
    await api(`/admin/employees/${employee.id}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: employee can submit timesheet and admin can approve it", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const createdEmployee = await createEmployee(adminToken, randomSuffix("refactor-smoke-timesheet-approve"));
  const employee = createdEmployee.user;
  const employeeSession = await login(employee.email, createdEmployee.temporaryPassword);

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeSession.accessToken,
    body: {
      employeeId: employee.id,
      weekStart: "2026-05-25",
      lines: [{ project: "Smoke Approval Project", task: "Approval task", hours: { mon: 3, tue: 2 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const submitResponse = await api(`/business/timesheets/${timesheetId}/submit`, {
      method: "POST",
      token: employeeSession.accessToken,
      body: {},
    });
    const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "approved in smoke suite" },
    });
    const detailResponse = await api(`/business/timesheets/${timesheetId}`, {
      token: adminToken,
    });

    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));
    assert.equal(detailResponse.status, 200, JSON.stringify(detailResponse.json));
    assert.equal(approveResponse.json.timesheet.status, "approved");
    assert.equal(detailResponse.json.timesheet.status, "approved");
  } finally {
    await api(`/business/timesheets/${timesheetId}`, {
      method: "DELETE",
      token: adminToken,
    });
    await api(`/admin/employees/${employee.id}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: approved hourly timesheet creates salary reflection", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const createdEmployee = await createEmployee(adminToken, randomSuffix("refactor-smoke-salary-reflection"));
  const employee = createdEmployee.user;
  const employeeSession = await login(employee.email, createdEmployee.temporaryPassword);

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeSession.accessToken,
    body: {
      employeeId: employee.id,
      weekStart: "2026-06-01",
      lines: [{ project: "Smoke Salary Project", task: "Salary task", hours: { mon: 4, tue: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
  const timesheetId = createResponse.json.timesheet.id;

  let reflectedSalaryId = null;
  try {
    const submitResponse = await api(`/business/timesheets/${timesheetId}/submit`, {
      method: "POST",
      token: employeeSession.accessToken,
      body: {},
    });
    const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "salary reflection smoke" },
    });
    const salariesResponse = await api("/business/salaries", {
      token: adminToken,
    });

    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const reflectedSalary = salariesResponse.json.salaries.find((salary) => salary.timesheetId === timesheetId);
    assert.ok(reflectedSalary, JSON.stringify(salariesResponse.json));
    assert.equal(reflectedSalary.employeeId, employee.id);
    assert.equal(reflectedSalary.source, "timesheet");
    assert.equal(reflectedSalary.hours, 5);
    assert.equal(reflectedSalary.rate, 100);
    assert.equal(reflectedSalary.amount, 500);
    reflectedSalaryId = reflectedSalary.id;

    const deleteSalaryResponse = await api(`/business/salaries/${reflectedSalaryId}`, {
      method: "DELETE",
      token: adminToken,
    });
    assert.equal(deleteSalaryResponse.status, 204, JSON.stringify(deleteSalaryResponse.json));
    reflectedSalaryId = null;

    const reconciledResponse = await api("/business/salaries", {
      token: adminToken,
    });
    assert.equal(reconciledResponse.status, 200, JSON.stringify(reconciledResponse.json));
    const reconciledSalary = reconciledResponse.json.salaries.find(
      (salary) => salary.timesheetId === timesheetId,
    );
    assert.ok(reconciledSalary, JSON.stringify(reconciledResponse.json));
    assert.equal(reconciledSalary.employeeId, employee.id);
    assert.equal(reconciledSalary.hours, 5);
    assert.equal(reconciledSalary.rate, 100);
    assert.equal(reconciledSalary.amount, 500);
    reflectedSalaryId = reconciledSalary.id;
  } finally {
    if (reflectedSalaryId) {
      await api(`/business/salaries/${reflectedSalaryId}`, {
        method: "DELETE",
        token: adminToken,
      });
    }
    await api(`/business/timesheets/${timesheetId}`, {
      method: "DELETE",
      token: adminToken,
    });
    await api(`/admin/employees/${employee.id}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});

test("deep smoke: monthly employee receives one monthly payout across approved weeks", { concurrency: false }, async () => {
  const adminToken = seed.tenantA.ownerSession.accessToken;
  const suffix = randomSuffix("refactor-smoke-monthly-salary");
  const createEmployeeResponse = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Monthly Employee ${suffix}`,
      email: `${suffix}@example.com`,
      phone: `${Math.floor(9000000000 + Math.random() * 99999999)}`,
      position: "Monthly Engineer",
      salary: 180000,
      payType: "monthly",
      hourlyRate: 0,
      department: "Engineering",
    },
  });
  assert.equal(createEmployeeResponse.status, 201, JSON.stringify(createEmployeeResponse.json));

  const employee = createEmployeeResponse.json.user;
  const employeeSession = await login(employee.email, createEmployeeResponse.json.temporaryPassword);
  const timesheetIds = [];
  let monthlySalaryId = null;

  try {
    for (const [weekStart, hours] of [
      ["2026-06-01", { mon: 5, tue: 3 }],
      ["2026-06-08", { mon: 4, wed: 2 }],
    ]) {
      const createResponse = await api("/business/timesheets", {
        method: "POST",
        token: employeeSession.accessToken,
        body: {
          employeeId: employee.id,
          weekStart,
          lines: [{ project: "Monthly Salary Project", task: "Monthly task", hours }],
        },
      });
      assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
      const timesheetId = createResponse.json.timesheet.id;
      timesheetIds.push(timesheetId);

      const submitResponse = await api(`/business/timesheets/${timesheetId}/submit`, {
        method: "POST",
        token: employeeSession.accessToken,
        body: {},
      });
      const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
        method: "POST",
        token: adminToken,
        body: { note: "monthly salary smoke" },
      });
      assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));
      assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));
    }

    const salariesResponse = await api("/business/salaries", { token: adminToken });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const monthlySalaries = salariesResponse.json.salaries.filter(
      (salary) =>
        salary.employeeId === employee.id &&
        salary.source === "timesheet" &&
        salary.rate == null &&
        salary.weekStart?.startsWith("2026-06"),
    );
    assert.equal(monthlySalaries.length, 1, JSON.stringify(monthlySalaries));
    assert.equal(monthlySalaries[0].amount, 15000);
    assert.equal(monthlySalaries[0].hours, 14);
    monthlySalaryId = monthlySalaries[0].id;

    const deleteSalaryResponse = await api(`/business/salaries/${monthlySalaryId}`, {
      method: "DELETE",
      token: adminToken,
    });
    assert.equal(deleteSalaryResponse.status, 204, JSON.stringify(deleteSalaryResponse.json));
    monthlySalaryId = null;

    const reconciledResponse = await api("/business/salaries", { token: adminToken });
    assert.equal(reconciledResponse.status, 200, JSON.stringify(reconciledResponse.json));
    const reconciledSalary = reconciledResponse.json.salaries.find(
      (salary) =>
        salary.employeeId === employee.id &&
        salary.source === "timesheet" &&
        salary.rate == null &&
        salary.weekStart?.startsWith("2026-06"),
    );
    assert.ok(reconciledSalary, JSON.stringify(reconciledResponse.json));
    assert.equal(reconciledSalary.amount, 15000);
    assert.equal(reconciledSalary.hours, 14);
    monthlySalaryId = reconciledSalary.id;
  } finally {
    if (monthlySalaryId) {
      await api(`/business/salaries/${monthlySalaryId}`, {
        method: "DELETE",
        token: adminToken,
      });
    }
    for (const timesheetId of timesheetIds) {
      await api(`/business/timesheets/${timesheetId}`, {
        method: "DELETE",
        token: adminToken,
      });
    }
    await api(`/admin/employees/${employee.id}`, {
      method: "DELETE",
      token: adminToken,
    });
  }
});
