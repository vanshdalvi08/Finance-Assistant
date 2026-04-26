import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const apiPort = 3104;
export const baseUrl = `http://127.0.0.1:${apiPort}/api`;
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryFile = path.join(cwd, "dist", "index.mjs");

export function startApiServer() {
  const serverProcess = spawn(process.execPath, ["--enable-source-maps", entryFile], {
    cwd,
    env: { ...process.env, PORT: String(apiPort), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  return serverProcess;
}

export async function stopApiServer(serverProcess) {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}

export function randomSuffix(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCookie(setCookieHeader, cookieName) {
  if (!setCookieHeader) {
    return null;
  }

  const match = new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`).exec(setCookieHeader);
  return match?.[1] ?? null;
}

function buildCookieHeader(...cookies) {
  return cookies.filter(Boolean).join("; ");
}

export async function waitForHealth(timeoutMs = 90000) {
  const started = Date.now();
  let lastStatus = null;
  let lastBody = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/healthz`);
      lastStatus = response.status;
      const text = await response.text();
      lastBody = text || null;
      if (response.ok) {
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }

        if (json?.status === "ok" && json?.checks?.startup?.status === "ok") {
          return;
        }
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }

    await sleep(300);
  }

  throw new Error(
    `Timed out waiting for API test server health. Last status=${String(lastStatus)} last body=${lastBody ?? "<none>"}`,
  );
}

export async function api(pathname, options = {}) {
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
    body:
      typeof options.body === "string"
        ? options.body
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
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

  return {
    status: response.status,
    json,
    headers: response.headers,
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

export async function login(email, password) {
  const deadline = Date.now() + 5000;
  let lastResponse = null;

  while (Date.now() <= deadline) {
    lastResponse = await api("/auth/login", {
      method: "POST",
      body: { email, password },
    });

    if (lastResponse.status === 200) {
      const setCookie = lastResponse.setCookie;
      const refreshToken = extractCookie(setCookie, "yojak_refresh_token");
      const csrfCookie = extractCookie(setCookie, "yojak_csrf_token");
      const csrfToken = lastResponse.json?.csrfToken ?? null;
      return {
        accessToken: lastResponse.json.accessToken,
        user: lastResponse.json.user,
        csrfToken,
        refreshToken,
        csrfCookie,
        cookieHeader: buildCookieHeader(
          refreshToken ? `yojak_refresh_token=${refreshToken}` : null,
          csrfCookie ? `yojak_csrf_token=${csrfCookie}` : null,
        ),
      };
    }

    if (lastResponse.status !== 503) {
      break;
    }

    await sleep(250);
  }

  assert.equal(lastResponse?.status, 200, `Login failed for ${email}: ${JSON.stringify(lastResponse?.json)}`);
  return null;
}

export async function createTenantBundle(platformToken, label) {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ownerPassword = `${label}-Owner-12345`;

  const createResponse = await api("/platform/tenants", {
    method: "POST",
    token: platformToken,
    body: {
      name: `${label} Tenant`,
      slug: `${label.toLowerCase()}-${Math.floor(Math.random() * 100000)}`,
      ownerName: `${label} Admin`,
      ownerEmail: `${suffix}.admin@example.com`,
      ownerPhone: `${Math.floor(9000000000 + Math.random() * 99999999)}`,
      ownerPosition: "Administrator",
      ownerDepartment: "Operations",
      ownerPassword,
    },
  });

  assert.equal(createResponse.status, 201, `Tenant creation failed: ${JSON.stringify(createResponse.json)}`);

  const ownerSession = await login(createResponse.json.owner.email, ownerPassword);
  const employee = await createEmployee(ownerSession.accessToken, `${suffix}-employee`);
  const client = await createClient(ownerSession.accessToken, `${suffix}-client`);
  const employeeSession = await login(employee.user.email, employee.temporaryPassword);
  const clientSession = await login(client.user.email, client.temporaryPassword);

  return {
    tenant: createResponse.json.tenant,
    owner: createResponse.json.owner,
    ownerPassword,
    ownerSession,
    employee,
    employeeSession,
    client,
    clientSession,
  };
}

export async function initializeSecuritySeed() {
  const platformSession = await login("platform@yojak.in", "platform123");
  const tenantA = await createTenantBundle(platformSession.accessToken, "security-a");
  const tenantB = await createTenantBundle(platformSession.accessToken, "security-b");

  return {
    platformSession,
    tenantA,
    tenantB,
  };
}

export async function createEmployee(adminToken, suffix) {
  const response = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Security Employee ${suffix}`,
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

export async function createClient(adminToken, suffix) {
  const response = await api("/admin/clients", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Security Client ${suffix}`,
      email: `${suffix}.client@example.com`,
      phone: `${Math.floor(8000000000 + Math.random() * 99999999)}`,
      company: `Security Co ${suffix}`,
      billingEmail: `${suffix}.billing@example.com`,
      address: "Security Test Address",
      website: "https://example.com",
    },
  });
  assert.equal(response.status, 201, `Client creation failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

export async function createTimesheet(token, employeeId, weekStart, suffix) {
  const response = await api("/business/timesheets", {
    method: "POST",
    token,
    body: {
      employeeId,
      weekStart,
      lines: [{ project: `Security ${suffix}`, task: "Access test", hours: { mon: 1 } }],
    },
  });
  assert.ok([200, 201].includes(response.status), `Timesheet creation failed: ${JSON.stringify(response.json)}`);
  return response.json.timesheet;
}

export async function createExpense(token, employeeId, employeeNameSnapshot, suffix) {
  const response = await api("/business/expenses", {
    method: "POST",
    token,
    body: {
      employeeId,
      employeeNameSnapshot,
      category: "Security",
      group: "office",
      amount: 1,
      date: "2026-04-11",
      description: `Security expense ${suffix}`,
      note: "security",
    },
  });
  assert.equal(response.status, 201, `Expense creation failed: ${JSON.stringify(response.json)}`);
  return response.json.expense;
}

export async function createSalary(token, employeeId, employeeNameSnapshot, suffix) {
  const response = await api("/business/salaries", {
    method: "POST",
    token,
    body: {
      employeeId,
      employeeNameSnapshot,
      amount: 1,
      date: "2026-04-11",
      note: `Security salary ${suffix}`,
    },
  });
  assert.equal(response.status, 201, `Salary creation failed: ${JSON.stringify(response.json)}`);
  return response.json.salary;
}

export async function createPreApproval(token, clientId, suffix) {
  const response = await api("/business/pre-approvals", {
    method: "POST",
    token,
    body: {
      title: `Security Pre-Approval ${suffix}`,
      project: `Security Project ${suffix}`,
      clientId,
      date: "2026-04-11",
      notes: "Security access test",
      tasks: [
        {
          taskName: "Design",
          description: "Security test task",
          hours: 2,
          rate: 100,
        },
      ],
    },
  });
  assert.equal(response.status, 201, `Pre-approval creation failed: ${JSON.stringify(response.json)}`);
  return response.json.preApproval;
}
