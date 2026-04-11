import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const apiPort = 3102;
const baseUrl = `http://127.0.0.1:${apiPort}/api`;
const cwd = path.resolve("C:/Users/vansh/Desktop/Finance-Assistant/artifacts/api-server");

let serverProcess;

function randomSuffix(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/healthz`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("Timed out waiting for API test server health.");
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: typeof options.body === "string" ? options.body : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  return { status: response.status, json, headers: response.headers };
}

async function login(email, password) {
  const response = await api("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(response.json)}`);
  return response.json.accessToken;
}

async function createEmployee(adminToken, suffix) {
  const response = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Phase Two ${suffix}`,
      email: `${suffix}@example.com`,
      phone: `${Math.floor(9000000000 + Math.random() * 99999999)}`,
      position: "QA Analyst",
      salary: 1000,
      payType: "hourly",
      hourlyRate: 100,
      department: "QA",
    },
  });
  assert.equal(response.status, 201, `Employee creation failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

async function createClient(adminToken, suffix) {
  const response = await api("/admin/clients", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Phase Client ${suffix}`,
      email: `${suffix}.client@example.com`,
      phone: `${Math.floor(8000000000 + Math.random() * 99999999)}`,
      company: `Phase Co ${suffix}`,
      billingEmail: `${suffix}.billing@example.com`,
      address: "Phase Test Address",
      website: "https://example.com",
    },
  });
  assert.equal(response.status, 201, `Client creation failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

before(async () => {
  serverProcess = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd,
    env: { ...process.env, PORT: String(apiPort), NODE_ENV: "development" },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForHealth();
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

test("timesheet draft cannot be approved before submission", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;

  const weekStart = "2026-04-13";
  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Draft", hours: { mon: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "should fail" },
    });
    assert.equal(approveResponse.status, 409, JSON.stringify(approveResponse.json));
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("approved expense cannot be rejected afterward", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employeesResponse = await api("/admin/employees", { token: adminToken });
  const employee = employeesResponse.json.employees[0];
  const today = "2026-04-11";

  const createResponse = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      category: "Phase2",
      group: "office",
      amount: 1,
      date: today,
      description: "Phase 2 workflow expense",
      note: "workflow",
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const expenseId = createResponse.json.expense.id;

  try {
    const approveResponse = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "approved", reviewerNote: "approved" },
    });
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));

    const rejectResponse = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "rejected", reviewerNote: "should fail" },
    });
    assert.equal(rejectResponse.status, 409, JSON.stringify(rejectResponse.json));
  } finally {
    await api(`/business/expenses/${expenseId}`, { method: "DELETE", token: adminToken });
  }
});

test("leave request cannot be reviewed twice", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employeeId = createdEmployee.user.id;
  const employeeToken = await login(createdEmployee.user.email, createdEmployee.temporaryPassword);

  const leaveCreate = await api("/business/leave-requests", {
    method: "POST",
    token: employeeToken,
    body: {
      startDate: "2026-05-11",
      endDate: "2026-05-11",
      reason: "Phase 2 leave",
    },
  });
  assert.equal(leaveCreate.status, 201, JSON.stringify(leaveCreate.json));
  const leaveId = leaveCreate.json.leaveRequest.id;

  try {
    const approveResponse = await api(`/business/leave-requests/${leaveId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "approved", reviewNote: "approved" },
    });
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));

    const rejectResponse = await api(`/business/leave-requests/${leaveId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "rejected", reviewNote: "should fail" },
    });
    assert.equal(rejectResponse.status, 409, JSON.stringify(rejectResponse.json));
  } finally {
    await api(`/business/leave-requests/${leaveId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employeeId}`, { method: "DELETE", token: adminToken });
  }
});

test("pre-approval cannot be approved from draft and cannot be edited once submitted", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-client");
  const createdClient = await createClient(adminToken, suffix);
  const clientToken = await login(createdClient.user.email, createdClient.temporaryPassword);

  const createResponse = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Phase 2 Pre Approval ${suffix}`,
      project: `Phase Project ${suffix}`,
      clientId: createdClient.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Planning", description: "Draft task", hours: 1, rate: 100 }],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const preApprovalId = createResponse.json.preApproval.id;

  try {
    const clientDraftApprove = await api(`/business/pre-approvals/${preApprovalId}/approve`, {
      method: "POST",
      token: clientToken,
      body: {},
    });
    assert.equal(clientDraftApprove.status, 400, JSON.stringify(clientDraftApprove.json));

    const submitResponse = await api(`/business/pre-approvals/${preApprovalId}/submit`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));

    const updateWhileSubmitted = await api(`/business/pre-approvals/${preApprovalId}`, {
      method: "PATCH",
      token: adminToken,
      body: {
        title: `Phase 2 Pre Approval ${suffix} Updated`,
        project: `Phase Project ${suffix}`,
        clientId: createdClient.user.id,
        date: "2026-04-11",
        tasks: [{ taskName: "Planning", description: "Updated", hours: 1, rate: 100 }],
      },
    });
    assert.equal(updateWhileSubmitted.status, 400, JSON.stringify(updateWhileSubmitted.json));

    const requestChanges = await api(`/business/pre-approvals/${preApprovalId}/request-changes`, {
      method: "POST",
      token: clientToken,
      body: { message: "Please revise." },
    });
    assert.equal(requestChanges.status, 200, JSON.stringify(requestChanges.json));
  } finally {
    await api(`/business/pre-approvals/${preApprovalId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/clients/${createdClient.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("salary and PO payment retries stay idempotent", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employeesResponse = await api("/admin/employees", { token: adminToken });
  const employee = employeesResponse.json.employees[0];

  const salaryCreate = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    body: { employeeId: employee.id, amount: 1, date: "2026-04-11", note: "salary retry" },
  });
  assert.equal(salaryCreate.status, 201, JSON.stringify(salaryCreate.json));
  const salaryId = salaryCreate.json.salary.id;

  const poCreate = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    body: { title: `Phase 2 PO ${randomSuffix("po")}`, totalAmount: 5, date: "2026-04-11", tasks: [] },
  });
  assert.equal(poCreate.status, 201, JSON.stringify(poCreate.json));
  const poId = poCreate.json.purchaseOrder.id;

  try {
    const salaryPay1 = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      body: { note: "first pay" },
    });
    const salaryPay2 = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      body: { note: "second pay" },
    });
    assert.equal(salaryPay1.status, 200, JSON.stringify(salaryPay1.json));
    assert.equal(salaryPay2.status, 200, JSON.stringify(salaryPay2.json));
    assert.equal(salaryPay2.json.duplicate, true);

    const taskCreate = await api(`/business/purchase-orders/${poId}/tasks`, {
      method: "POST",
      token: adminToken,
      body: { taskName: "Payable row", hours: 1, rate: 1, description: "phase2" },
    });
    assert.equal(taskCreate.status, 201, JSON.stringify(taskCreate.json));
    const taskId = taskCreate.json.task.id;

    const pay1 = await api(`/business/purchase-orders/${poId}/tasks/${taskId}/pay`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    const pay2 = await api(`/business/purchase-orders/${poId}/tasks/${taskId}/pay`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(pay1.status, 200, JSON.stringify(pay1.json));
    assert.equal(pay2.status, 200, JSON.stringify(pay2.json));
    const paidTask = pay2.json.purchaseOrder.tasks.find((task) => task.id === taskId);
    assert.equal(paidTask.status, "paid");
  } finally {
    await api(`/business/salaries/${salaryId}`, { method: "DELETE", token: adminToken });
    await api(`/business/purchase-orders/${poId}`, { method: "DELETE", token: adminToken });
  }
});

test("tenant isolation and unauthorized access stay enforced", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const platformToken = await login("platform@yojak.in", "platform123");

  const suffix = randomSuffix("phase2-tenant");
  const createTenant = await api("/platform/tenants", {
    method: "POST",
    token: platformToken,
    body: {
      name: `Phase Two ${suffix}`,
      slug: suffix.toLowerCase(),
      ownerName: "Phase Tenant Owner",
      ownerEmail: `${suffix}@tenant.example.com`,
      ownerPhone: `${Math.floor(7000000000 + Math.random() * 99999999)}`,
      ownerPassword: "tenantpass123",
    },
  });
  assert.equal(createTenant.status, 201, JSON.stringify(createTenant.json));
  const tenantOwnerToken = await login(createTenant.json.owner.email, "tenantpass123");

  const employeeSeed = await createEmployee(adminToken, randomSuffix("phase2-isolation-employee"));
  const employeeToken = await login(employeeSeed.user.email, employeeSeed.temporaryPassword);
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": randomSuffix("fund-key") },
    body: { source: `Isolation Fund ${suffix}`, amount: 1, date: "2026-04-11", note: "tenant isolation" },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));
  const fundId = fundCreate.json.fund.id;

  try {
    const crossTenantRead = await api(`/business/funds/${fundId}`, {
      method: "GET",
      token: tenantOwnerToken,
    });
    assert.equal(crossTenantRead.status, 403, JSON.stringify(crossTenantRead.json));

    const employeeBlocked = await api("/business/funds", {
      method: "POST",
      token: employeeToken,
      body: { source: "Blocked", amount: 1, date: "2026-04-11" },
    });
    assert.equal(employeeBlocked.status, 403, JSON.stringify(employeeBlocked.json));
  } finally {
    await api(`/business/funds/${fundId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employeeSeed.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("finance constraints reject zero amounts", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");

  const fundResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": randomSuffix("fund-zero") },
    body: { source: "Zero fund", amount: 0, date: "2026-04-11", note: "should fail" },
  });
  assert.equal(fundResponse.status, 400, JSON.stringify(fundResponse.json));

  const salaryResponse = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    body: { employeeId: "00000000-0000-0000-0000-000000000000", amount: 0, date: "2026-04-11" },
  });
  assert.equal(salaryResponse.status, 400, JSON.stringify(salaryResponse.json));
});

test("audit trail includes structured details for finance actions", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const source = `Audit Detail Fund ${randomSuffix("fund")}`;

  const createResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": randomSuffix("audit-fund-key") },
    body: { source, amount: 5, date: "2026-04-11", note: "audit details" },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const fundId = createResponse.json.fund.id;

  try {
    const auditResponse = await api("/business/audit-trail", {
      method: "GET",
      token: adminToken,
    });
    assert.equal(auditResponse.status, 200, JSON.stringify(auditResponse.json));
    const matchingEntry = auditResponse.json.auditTrail.find((entry) => entry.entityType === "fund" && entry.entityId === fundId);
    assert.ok(matchingEntry, "Expected a matching fund audit entry.");
    assert.equal(matchingEntry.details?.after?.amount, 5);
    assert.equal(matchingEntry.details?.entityLabel, source);
    assert.ok(matchingEntry.requestId);
  } finally {
    await api(`/business/funds/${fundId}`, { method: "DELETE", token: adminToken });
  }
});
