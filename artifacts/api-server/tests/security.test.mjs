import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import {
  api,
  createExpense,
  createEmployee,
  createSalary,
  createTimesheet,
  initializeSecuritySeed,
  login,
  randomSuffix,
  startApiServer,
  stopApiServer,
  waitForHealth,
} from "./security-fixtures.mjs";

let serverProcess;
let seed;
let tenantAFinancialAccountId;

async function getTenantAFinancialAccountId() {
  if (tenantAFinancialAccountId) {
    return tenantAFinancialAccountId;
  }

  const response = await api("/business/financial-accounts", {
    method: "POST",
    token: seed.tenantA.ownerSession.accessToken,
    body: {
      name: `Security account ${randomSuffix("account")}`,
      accountType: "operational",
      category: "bank",
      openingBalance: 0,
      description: "Isolated security-test account",
      includeInOperationalReporting: true,
      isActive: true,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  tenantAFinancialAccountId = response.json.account.id;
  assert.ok(tenantAFinancialAccountId, "Expected a financial account id");
  return tenantAFinancialAccountId;
}

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
    // Best-effort cleanup for the seeded tenants.
  }

  await stopApiServer(serverProcess);
});

test("API responses include security headers", { concurrency: false }, async () => {
  const response = await api("/auth/csrf");

  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-xss-protection"), "0");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
});

test("public OAuth diagnostics are not exposed", { concurrency: false }, async () => {
  const response = await api("/auth/oauth-debug");
  assert.equal(response.status, 404, JSON.stringify(response.json));
});

test("CSP report collector accepts sanitized browser reports without authentication", { concurrency: false }, async () => {
  const response = await api("/security/csp-report", {
    method: "POST",
    body: {
      "csp-report": {
        "document-uri": "https://payroll.reforix.com/salary?employee=secret",
        "blocked-uri": "https://unexpected.example/script.js?token=secret",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src 'self'",
        disposition: "report",
        "status-code": 200,
      },
    },
  });

  assert.equal(response.status, 204, JSON.stringify(response.json));
});

test("password reset rejects weak passwords before token processing", { concurrency: false }, async () => {
  const response = await api("/auth/reset", {
    method: "POST",
    body: {
      token: "invalid-reset-token",
      password: "too-short",
    },
  });

  assert.equal(response.status, 400, JSON.stringify(response.json));
});

test("employee salary access stays scoped to self", { concurrency: false }, async () => {
  const coworker = await createEmployee(seed.tenantA.ownerSession.accessToken, randomSuffix("salary-scope-coworker"));
  const selfSalary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "salary-self-scope",
  );
  const coworkerSalary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    coworker.user.id,
    coworker.user.name,
    "salary-coworker-scope",
  );

  try {
    const scopedList = await api(`/business/salaries?employeeId=${encodeURIComponent(coworker.user.id)}`, {
      token: seed.tenantA.employeeSession.accessToken,
    });
    const crossScopeLookup = await api(`/business/salaries/${coworkerSalary.id}`, {
      token: seed.tenantA.employeeSession.accessToken,
    });
    const selfLookup = await api(`/business/salaries/${selfSalary.id}`, {
      token: seed.tenantA.employeeSession.accessToken,
    });

    assert.equal(scopedList.status, 200, JSON.stringify(scopedList.json));
    assert.ok(
      scopedList.json.salaries.every((salary) => salary.employeeId === seed.tenantA.employee.user.id),
      JSON.stringify(scopedList.json),
    );
    assert.equal(crossScopeLookup.status, 403, JSON.stringify(crossScopeLookup.json));
    assert.equal(selfLookup.status, 200, JSON.stringify(selfLookup.json));
    assert.equal("tenantId" in selfLookup.json.salary, false, JSON.stringify(selfLookup.json));
    assert.equal("accountId" in selfLookup.json.salary, false, JSON.stringify(selfLookup.json));
    assert.equal("note" in selfLookup.json.salary, false, JSON.stringify(selfLookup.json));
    assert.equal("timesheetId" in selfLookup.json.salary, false, JSON.stringify(selfLookup.json));
  } finally {
    await api(`/business/salaries/${coworkerSalary.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/salaries/${selfSalary.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/admin/employees/${coworker.user.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("anonymous requests are rejected on sensitive routes", { concurrency: false }, async () => {
  const routes = [
    { pathname: "/admin/employees", method: "GET" },
    { pathname: "/business/funds", method: "GET" },
    { pathname: "/business/salaries", method: "GET" },
    { pathname: "/uploads/profile-photo", method: "POST", body: "not-an-upload", headers: { "Content-Type": "application/octet-stream" } },
    { pathname: "/auth/logout-all", method: "POST" },
  ];

  for (const route of routes) {
    const response = await api(route.pathname, {
      method: route.method,
      body: route.body,
      headers: route.headers,
    });
    assert.equal(response.status, 401, `${route.method} ${route.pathname} should require authentication`);
  }
});

test("employee and client accounts cannot use admin-only employee endpoints", { concurrency: false }, async () => {
  const employeeList = await api("/admin/employees", {
    token: seed.tenantA.employeeSession.accessToken,
  });
  const clientList = await api("/admin/employees", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const employeeMutation = await api(`/admin/employees/${seed.tenantA.employee.user.id}`, {
    method: "PATCH",
    token: seed.tenantA.employeeSession.accessToken,
    body: {
      name: seed.tenantA.employee.user.name,
      email: seed.tenantA.employee.user.email,
      phone: seed.tenantA.employee.user.phone,
      position: seed.tenantA.employee.user.position,
      salary: 999999,
      payType: seed.tenantA.employee.user.payType,
      hourlyRate: seed.tenantA.employee.user.hourlyRate,
      department: seed.tenantA.employee.user.department,
      status: "active",
    },
  });

  assert.equal(employeeList.status, 403, JSON.stringify(employeeList.json));
  assert.equal(clientList.status, 403, JSON.stringify(clientList.json));
  assert.equal(employeeMutation.status, 403, JSON.stringify(employeeMutation.json));
});

test("salary and employee mutations create tenant audit records", { concurrency: false }, async () => {
  const coworker = await createEmployee(seed.tenantA.ownerSession.accessToken, randomSuffix("audit-employee"));
  const salary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    coworker.user.id,
    coworker.user.name,
    "audit-salary",
  );

  try {
    const update = await api(`/admin/employees/${coworker.user.id}`, {
      method: "PATCH",
      token: seed.tenantA.ownerSession.accessToken,
      body: {
        name: `${coworker.user.name} Updated`,
        email: coworker.user.email,
        phone: coworker.user.phone,
        position: coworker.user.position,
        salary: coworker.user.salary + 25,
        payType: coworker.user.payType,
        hourlyRate: coworker.user.hourlyRate,
        department: coworker.user.department,
        status: "active",
      },
    });
    assert.equal(update.status, 200, JSON.stringify(update.json));

    const audit = await api("/business/audit-trail", {
      token: seed.tenantA.ownerSession.accessToken,
    });
    assert.equal(audit.status, 200, JSON.stringify(audit.json));
    assert.ok(
      audit.json.auditTrail.some(
        (entry) =>
          entry.entityType === "employee"
          && entry.entityId === coworker.user.id
          && entry.action === "updated",
      ),
      JSON.stringify(audit.json),
    );
    assert.ok(
      audit.json.auditTrail.some(
        (entry) =>
          entry.entityType === "salary"
          && entry.entityId === salary.id
          && entry.action === "created",
      ),
      JSON.stringify(audit.json),
    );
  } finally {
    await api(`/business/salaries/${salary.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/admin/employees/${coworker.user.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("tenant A and tenant B stay isolated from each other", { concurrency: false }, async () => {
  const fund = await api("/business/funds", {
    method: "POST",
    token: seed.tenantA.ownerSession.accessToken,
    body: {
      source: `Security fund ${randomSuffix("tenant-a")}`,
      amount: 100,
      date: "2026-04-11",
      note: "tenant A fund",
    },
  });
  assert.equal(fund.status, 201, JSON.stringify(fund.json));

  const salary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "tenant-a",
  );

  const preApproval = await api("/business/pre-approvals", {
    method: "POST",
    token: seed.tenantA.ownerSession.accessToken,
    body: {
      title: `Security PreApproval ${randomSuffix("tenant-a")}`,
      project: "Tenant A Project",
      clientId: seed.tenantA.client.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Task A", description: "Tenant A task", hours: 1, rate: 100 }],
    },
  });
  assert.equal(preApproval.status, 201, JSON.stringify(preApproval.json));

  const employeeTimesheet = await createTimesheet(
    seed.tenantA.employeeSession.accessToken,
    seed.tenantA.employee.user.id,
    "2026-04-13",
    "tenant-a",
  );

  try {
    const tenantBFundLookup = await api(`/business/funds/${fund.json.fund.id}`, {
      token: seed.tenantB.ownerSession.accessToken,
    });
    const tenantBSalaryLookup = await api(`/business/salaries/${salary.id}`, {
      token: seed.tenantB.ownerSession.accessToken,
    });
    const tenantBPreApprovalLookup = await api(`/business/pre-approvals/${preApproval.json.preApproval.id}`, {
      token: seed.tenantB.clientSession.accessToken,
    });
    const tenantBTimesheetLookup = await api(`/business/timesheets/${employeeTimesheet.id}`, {
      token: seed.tenantB.employeeSession.accessToken,
    });

    assert.ok([403, 404].includes(tenantBFundLookup.status), JSON.stringify(tenantBFundLookup.json));
    assert.ok([403, 404].includes(tenantBSalaryLookup.status), JSON.stringify(tenantBSalaryLookup.json));
    assert.ok([403, 404].includes(tenantBPreApprovalLookup.status), JSON.stringify(tenantBPreApprovalLookup.json));
    assert.ok([403, 404].includes(tenantBTimesheetLookup.status), JSON.stringify(tenantBTimesheetLookup.json));
  } finally {
    await api(`/business/timesheets/${employeeTimesheet.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/pre-approvals/${preApproval.json.preApproval.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/salaries/${salary.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/funds/${fund.json.fund.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("client accounts cannot access payroll or funds", { concurrency: false }, async () => {
  const fundsResponse = await api("/business/funds", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const salaryListResponse = await api("/business/salaries", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const salary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "client-access",
  );
  const summaryResponse = await api("/business/projects/summary", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const projectNamesResponse = await api("/business/projects/names", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const salaryDetailResponse = await api(`/business/salaries/${salary.id}`, {
    token: seed.tenantA.clientSession.accessToken,
  });
  const salaryPayResponse = await api(`/business/salaries/${salary.id}/pay`, {
    method: "POST",
    token: seed.tenantA.clientSession.accessToken,
    body: { note: "client should not pay salary" },
  });
  const expenseLedgerResponse = await api("/business/expenses", {
    token: seed.tenantA.clientSession.accessToken,
  });
  const expenseWriteResponse = await api("/business/expenses", {
    method: "POST",
    token: seed.tenantA.clientSession.accessToken,
    body: {
      employeeId: seed.tenantA.client.user.id,
      employeeNameSnapshot: seed.tenantA.client.user.name,
      category: "Client Access",
      group: "office",
      amount: 1,
      date: "2026-04-11",
      description: "Client should not create expenses",
    },
  });

  assert.equal(fundsResponse.status, 403, JSON.stringify(fundsResponse.json));
  assert.equal(salaryListResponse.status, 403, JSON.stringify(salaryListResponse.json));
  assert.ok([403, 404].includes(summaryResponse.status), JSON.stringify(summaryResponse.json));
  assert.ok([403, 404].includes(projectNamesResponse.status), JSON.stringify(projectNamesResponse.json));
  assert.ok([403, 404].includes(salaryDetailResponse.status), JSON.stringify(salaryDetailResponse.json));
  assert.ok([403, 404].includes(salaryPayResponse.status), JSON.stringify(salaryPayResponse.json));
  assert.equal(expenseLedgerResponse.status, 403, JSON.stringify(expenseLedgerResponse.json));
  assert.equal(expenseWriteResponse.status, 403, JSON.stringify(expenseWriteResponse.json));

  await api(`/business/salaries/${salary.id}`, {
    method: "DELETE",
    token: seed.tenantA.ownerSession.accessToken,
  });
});

test("employee expense access stays scoped to self", { concurrency: false }, async () => {
  const coworker = await createEmployee(seed.tenantA.ownerSession.accessToken, randomSuffix("expense-scope-coworker"));
  const selfExpense = await createExpense(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "self-scope",
  );
  const coworkerExpense = await createExpense(
    seed.tenantA.ownerSession.accessToken,
    coworker.user.id,
    coworker.user.name,
    "coworker-scope",
  );

  try {
    const scopedExpenses = await api("/business/expenses", {
      token: seed.tenantA.employeeSession.accessToken,
      headers: { "X-Test-Bypass-Rate-Limit": "1" },
      body: undefined,
    });

    assert.equal(scopedExpenses.status, 200, JSON.stringify(scopedExpenses.json));
    assert.ok(scopedExpenses.json.expenses.every((expense) => expense.employeeId === seed.tenantA.employee.user.id), JSON.stringify(scopedExpenses.json));

    const crossScopeLookup = await api(`/business/expenses/${coworkerExpense.id}`, {
      token: seed.tenantA.employeeSession.accessToken,
    });
    assert.equal(crossScopeLookup.status, 403, JSON.stringify(crossScopeLookup.json));

    const selfLookup = await api(`/business/expenses/${selfExpense.id}`, {
      token: seed.tenantA.employeeSession.accessToken,
    });
    assert.equal(selfLookup.status, 200, JSON.stringify(selfLookup.json));
    assert.equal(selfLookup.json.expense.employeeId, seed.tenantA.employee.user.id);
  } finally {
    await api(`/business/expenses/${coworkerExpense.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/expenses/${selfExpense.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/admin/employees/${coworker.user.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("employee cannot approve own timesheet and cannot edit approved timesheet", { concurrency: false }, async () => {
  const weekStart = "2026-05-18";
  const timesheet = await createTimesheet(
    seed.tenantA.employeeSession.accessToken,
    seed.tenantA.employee.user.id,
    weekStart,
    "self-review",
  );

  try {
    const selfApprove = await api(`/business/timesheets/${timesheet.id}/approve`, {
      method: "POST",
      token: seed.tenantA.employeeSession.accessToken,
      body: { note: "should not approve own timesheet" },
    });
    assert.equal(selfApprove.status, 403, JSON.stringify(selfApprove.json));

    const submitForReview = await api(`/business/timesheets/${timesheet.id}/submit`, {
      method: "POST",
      token: seed.tenantA.employeeSession.accessToken,
      body: {},
    });
    assert.equal(submitForReview.status, 200, JSON.stringify(submitForReview.json));

    const adminApprove = await api(`/business/timesheets/${timesheet.id}/approve`, {
      method: "POST",
      token: seed.tenantA.ownerSession.accessToken,
      body: { note: "approved by admin" },
    });
    assert.equal(adminApprove.status, 200, JSON.stringify(adminApprove.json));

    const editAfterApproval = await api(`/business/timesheets/${timesheet.id}`, {
      method: "PATCH",
      token: seed.tenantA.employeeSession.accessToken,
      body: {
        id: timesheet.id,
        employeeId: seed.tenantA.employee.user.id,
        weekStart,
        lines: [{ project: "Edited Project", task: "Edited", hours: { mon: 2 } }],
      },
    });

    assert.ok([403, 409].includes(editAfterApproval.status), JSON.stringify(editAfterApproval.json));
  } finally {
    await api(`/business/timesheets/${timesheet.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("duplicate salary payment and expense approval stay blocked", { concurrency: false }, async () => {
  const accountId = await getTenantAFinancialAccountId();
  const funding = await api("/business/funds", {
    method: "POST",
    token: seed.tenantA.ownerSession.accessToken,
    body: {
      accountId,
      source: `Security reserve ${randomSuffix("fund")}`,
      amount: 100,
      date: "2026-04-11",
      note: "fund salary payments",
    },
  });
  assert.equal(funding.status, 201, JSON.stringify(funding.json));

  const salary = await createSalary(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "duplicate-payment",
  );
  const expense = await createExpense(
    seed.tenantA.ownerSession.accessToken,
    seed.tenantA.employee.user.id,
    seed.tenantA.employee.user.name,
    "duplicate-review",
  );
  const salaryPayKey = randomSuffix("salary-pay");
  const expenseReviewKey = randomSuffix("expense-review");

  try {
    const salaryPay1 = await api(`/business/salaries/${salary.id}/pay`, {
      method: "POST",
      token: seed.tenantA.ownerSession.accessToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { accountId, note: "first payment" },
    });
    const salaryPay2 = await api(`/business/salaries/${salary.id}/pay`, {
      method: "POST",
      token: seed.tenantA.ownerSession.accessToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { accountId, note: "first payment" },
    });

    assert.equal(salaryPay1.status, 200, JSON.stringify(salaryPay1.json));
    assert.equal(salaryPay2.status, 200, JSON.stringify(salaryPay2.json));
    assert.equal(salaryPay1.json.duplicate, false);
    assert.equal(salaryPay2.json.duplicate, true);

    const expenseApprove1 = await api(`/business/expenses/${expense.id}/status`, {
      method: "PATCH",
      token: seed.tenantA.ownerSession.accessToken,
      headers: { "Idempotency-Key": expenseReviewKey },
      body: { status: "approved", reviewerNote: "approved" },
    });
    const expenseApprove2 = await api(`/business/expenses/${expense.id}/status`, {
      method: "PATCH",
      token: seed.tenantA.ownerSession.accessToken,
      headers: { "Idempotency-Key": expenseReviewKey },
      body: { status: "approved", reviewerNote: "approved" },
    });

    assert.equal(expenseApprove1.status, 200, JSON.stringify(expenseApprove1.json));
    assert.ok([403, 409].includes(expenseApprove2.status), JSON.stringify(expenseApprove2.json));
  } finally {
    await api(`/business/funds/${funding.json.fund.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/expenses/${expense.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
    await api(`/business/salaries/${salary.id}`, {
      method: "DELETE",
      token: seed.tenantA.ownerSession.accessToken,
    });
  }
});

test("refresh and logout revoke sessions correctly", { concurrency: false }, async () => {
  const freshLogin = await login(seed.tenantA.owner.email, seed.tenantA.ownerPassword);
  const refreshHeaders = {
    Cookie: freshLogin.cookieHeader,
    "X-CSRF-Token": String(freshLogin.csrfToken),
  };

  const refresh1 = await api("/auth/refresh", {
    method: "POST",
    headers: refreshHeaders,
  });
  assert.equal(refresh1.status, 200, JSON.stringify(refresh1.json));

  const refresh2 = await api("/auth/refresh", {
    method: "POST",
    headers: refreshHeaders,
  });
  assert.equal(refresh2.status, 401, JSON.stringify(refresh2.json));

  const logoutLogin = await login(seed.tenantB.owner.email, seed.tenantB.ownerPassword);
  const logoutHeaders = {
    Cookie: logoutLogin.cookieHeader,
    "X-CSRF-Token": String(logoutLogin.csrfToken),
  };

  const logoutResponse = await api("/auth/logout", {
    method: "POST",
    headers: logoutHeaders,
  });
  assert.equal(logoutResponse.status, 204, JSON.stringify(logoutResponse.json));

  const refreshAfterLogout = await api("/auth/refresh", {
    method: "POST",
    headers: logoutHeaders,
  });
  assert.equal(refreshAfterLogout.status, 401, JSON.stringify(refreshAfterLogout.json));
});
