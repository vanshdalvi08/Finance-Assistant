import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const apiPort = 3103;
const baseUrl = `http://127.0.0.1:${apiPort}/api`;
const cwd = path.resolve("C:/Users/vansh/Desktop/Finance-Assistant/artifacts/api-server");

const loginCache = new Map();
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
  headers.set("X-Test-Bypass-Rate-Limit", "1");
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
  const cacheKey = `${email}::${password}`;
  const cached = loginCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await api("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(response.json)}`);
  loginCache.set(cacheKey, response.json.accessToken);
  return response.json.accessToken;
}

async function createEmployee(adminToken, suffix) {
  const response = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      name: `RBAC Employee ${suffix}`,
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
      name: `RBAC Client ${suffix}`,
      email: `${suffix}.client@example.com`,
      phone: `${Math.floor(8000000000 + Math.random() * 99999999)}`,
      company: `RBAC Co ${suffix}`,
      billingEmail: `${suffix}.billing@example.com`,
      address: "RBAC Test Address",
      website: "https://example.com",
    },
  });
  assert.equal(response.status, 201, `Client creation failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

async function createTimesheet(adminToken, employeeId, weekStart, suffix) {
  const response = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId,
      weekStart,
      lines: [{ project: `RBAC ${suffix}`, task: "Access test", hours: { mon: 1 } }],
    },
  });
  assert.ok([200, 201].includes(response.status), `Timesheet creation failed: ${JSON.stringify(response.json)}`);
  return response.json.timesheet;
}

async function createPreApproval(adminToken, clientId, suffix) {
  const response = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title: `RBAC Pre-Approval ${suffix}`,
      project: `RBAC Project ${suffix}`,
      clientId,
      date: "2026-04-12",
      notes: "RBAC access test",
      tasks: [
        {
          taskName: "Design",
          description: "Access test task",
          hours: 2,
          rate: 100,
        },
      ],
    },
  });
  assert.equal(response.status, 201, `Pre-approval creation failed: ${JSON.stringify(response.json)}`);
  return response.json.preApproval;
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

test("employee cannot access admin, platform, or client-only routes", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("rbac-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employeeToken = await login(createdEmployee.user.email, createdEmployee.temporaryPassword);

  try {
    const adminResponse = await api("/admin/employees", { token: employeeToken });
    const platformResponse = await api("/platform/overview", { token: employeeToken });
    const clientResponse = await api("/business/pre-approvals", { token: employeeToken });

    assert.equal(adminResponse.status, 403, JSON.stringify(adminResponse.json));
    assert.equal(platformResponse.status, 403, JSON.stringify(platformResponse.json));
    assert.equal(clientResponse.status, 403, JSON.stringify(clientResponse.json));
  } finally {
    await api(`/admin/employees/${createdEmployee.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("employee cannot access another employee's timesheet", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("rbac-timesheet");
  const employeeA = await createEmployee(adminToken, `${suffix}-a`);
  const employeeB = await createEmployee(adminToken, `${suffix}-b`);
  const tokenA = await login(employeeA.user.email, employeeA.temporaryPassword);
  const tokenB = await login(employeeB.user.email, employeeB.temporaryPassword);
  const weekStart = "2026-04-13";
  const timesheet = await createTimesheet(adminToken, employeeA.user.id, weekStart, suffix);

  try {
    const ownResponse = await api(`/business/timesheets/${timesheet.id}`, { token: tokenA });
    const otherResponse = await api(`/business/timesheets/${timesheet.id}`, { token: tokenB });

    assert.equal(ownResponse.status, 200, JSON.stringify(ownResponse.json));
    assert.equal(otherResponse.status, 403, JSON.stringify(otherResponse.json));
  } finally {
    await api(`/business/timesheets/${timesheet.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employeeA.user.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employeeB.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("client can only access their own pre-approvals", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("rbac-preapproval");
  const clientA = await createClient(adminToken, `${suffix}-a`);
  const clientB = await createClient(adminToken, `${suffix}-b`);
  const tokenA = await login(clientA.user.email, clientA.temporaryPassword);
  const tokenB = await login(clientB.user.email, clientB.temporaryPassword);
  const preApproval = await createPreApproval(adminToken, clientA.user.id, suffix);

  try {
    const listResponse = await api("/business/pre-approvals", { token: tokenA });
    assert.equal(listResponse.status, 200, JSON.stringify(listResponse.json));
    assert.ok(listResponse.json.preApprovals.some((item) => item.id === preApproval.id), "Client should see their own pre-approval");

    const otherListResponse = await api("/business/pre-approvals", { token: tokenB });
    assert.equal(otherListResponse.status, 200, JSON.stringify(otherListResponse.json));
    assert.ok(!otherListResponse.json.preApprovals.some((item) => item.id === preApproval.id), "Other client must not see this pre-approval");

    const directResponse = await api(`/business/pre-approvals/${preApproval.id}`, { token: tokenB });
    assert.equal(directResponse.status, 403, JSON.stringify(directResponse.json));
  } finally {
    await api(`/business/pre-approvals/${preApproval.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/clients/${clientA.user.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/clients/${clientB.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("platform super admin cannot enter tenant admin routes", { concurrency: false }, async () => {
  const platformToken = await login("platform@yojak.in", "platform123");

  const overviewResponse = await api("/platform/overview", { token: platformToken });
  const adminResponse = await api("/admin/employees", { token: platformToken });

  assert.equal(overviewResponse.status, 200, JSON.stringify(overviewResponse.json));
  assert.equal(adminResponse.status, 403, JSON.stringify(adminResponse.json));
});
