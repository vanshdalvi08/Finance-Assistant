import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const apiPort = 3102;
const baseUrl = `http://127.0.0.1:${apiPort}/api`;
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryFile = path.join(cwd, "dist", "index.mjs");

let serverProcess;
const loginCache = new Map();

function randomSuffix(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 90000) {
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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `Timed out waiting for API test server health. Last status=${String(lastStatus)} last body=${lastBody ?? "<none>"}`,
  );
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
  const normalizedEmail = email === "admin@yojak.in" ? "admin@reforix.com" : email;
  const normalizedPassword = email === "admin@yojak.in" ? "reforix123" : password;
  const cacheKey = `${normalizedEmail}::${normalizedPassword}`;
  const cached = loginCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const deadline = Date.now() + 5000;
  let lastResponse = null;

  while (Date.now() <= deadline) {
    lastResponse = await api("/auth/login", {
      method: "POST",
      body: { email: normalizedEmail, password: normalizedPassword },
    });

    if (lastResponse.status === 200) {
      loginCache.set(cacheKey, lastResponse.json.accessToken);
      return lastResponse.json.accessToken;
    }

    if (lastResponse.status !== 503) {
      break;
    }

    await sleep(250);
  }

  assert.equal(
    lastResponse?.status,
    200,
    `Login failed for ${normalizedEmail}: ${JSON.stringify(lastResponse?.json)}`,
  );
  return lastResponse.json.accessToken;
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
  serverProcess = spawn(process.execPath, ["--enable-source-maps", entryFile], {
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
  await waitForHealth(90000);
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

test("healthz reports runtime dependency checks", { concurrency: false }, async () => {
  const response = await api("/healthz");
  assert.equal(response.status, 200);
  assert.ok(response.json);
  assert.ok(["ok", "degraded", "error"].includes(response.json.status));
  assert.equal(response.json.service, "api-server");
  assert.equal(typeof response.json.timestamp, "string");
  assert.equal(typeof response.json.uptimeSeconds, "number");
  assert.ok(["ok", "degraded", "error"].includes(response.json.checks.configuration.status));
  assert.equal(response.json.checks.database.status, "ok");
  assert.ok(["ok", "degraded", "error"].includes(response.json.checks.storage.status));
  assert.ok(["ok", "degraded", "error"].includes(response.json.checks.externalMonitoring.status));
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

test("timesheet approve retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-idem");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const weekStart = "2026-04-13";
  const key = randomSuffix("timesheet-review");

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Idempotent approve", hours: { mon: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const submitResponse = await api(`/business/timesheets/${timesheetId}/submit`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));

    const approve1 = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": key },
      body: { note: "approved-once" },
    });
    assert.equal(approve1.status, 200, JSON.stringify(approve1.json));
    assert.equal(approve1.json.duplicate, false);
    assert.equal(approve1.json.timesheet.status, "approved");

    const approve2 = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": key },
      body: { note: "approved-once" },
    });
    assert.equal(approve2.status, 200, JSON.stringify(approve2.json));
    assert.equal(approve2.json.duplicate, true);
    assert.equal(approve2.json.timesheet.status, "approved");

    const approveConflict = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": key },
      body: { note: "changed-note" },
    });
    assert.equal(approveConflict.status, 409, JSON.stringify(approveConflict.json));
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("employee timesheet edits preserve reviewed days that were not changed", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-daily-review");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-04-13";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Initial row", hours: { mon: 1, tue: 2 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const reviewMon = await api(`/business/timesheets/${timesheetId}/daily-review/mon`, {
      method: "PATCH",
      token: adminToken,
      body: { reviewed: true },
    });
    assert.equal(reviewMon.status, 200, JSON.stringify(reviewMon.json));

    const reviewTue = await api(`/business/timesheets/${timesheetId}/daily-review/tue`, {
      method: "PATCH",
      token: adminToken,
      body: { reviewed: true },
    });
    assert.equal(reviewTue.status, 200, JSON.stringify(reviewTue.json));

    const saveResponse = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [
          { project: "Phase 2", task: "Initial row", hours: { mon: 1, tue: 2 } },
          { project: "Phase 2", task: "New row", hours: { wed: 3 } },
        ],
      },
    });
    assert.equal(saveResponse.status, 200, JSON.stringify(saveResponse.json));
    assert.deepEqual(saveResponse.json.timesheet.dailyReviewStatus, {
      mon: "reviewed",
      tue: "reviewed",
    });
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("employee cannot change an admin-protected day", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-locked-day");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-04-20";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Locked row", hours: { mon: 2, wed: 1 }, workNotes: { mon: "Initial note" } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const reviewResponse = await api(`/business/timesheets/${timesheetId}/daily-review/mon`, {
      method: "PATCH",
      token: adminToken,
      body: { reviewed: true },
    });
    assert.equal(reviewResponse.status, 200, JSON.stringify(reviewResponse.json));

    const lockedPatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [{ project: "Phase 2", task: "Locked row", hours: { mon: 4, wed: 1 }, workNotes: { mon: "Changed note" } }],
      },
    });
    assert.equal(lockedPatch.status, 409, JSON.stringify(lockedPatch.json));
    assert.match(String(lockedPatch.json.message), /protected day/i);

    const unlockedPatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [
          { project: "Phase 2", task: "Locked row", hours: { mon: 2, wed: 1 }, workNotes: { mon: "Initial note" } },
          { project: "Phase 2", task: "Open row", hours: { thu: 3 }, workNotes: { thu: "Allowed change" } },
        ],
      },
    });
    assert.equal(unlockedPatch.status, 200, JSON.stringify(unlockedPatch.json));
    assert.equal(unlockedPatch.json.timesheet.dailyReviewStatus.mon, "reviewed");
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("admin can lock a day and the employee cannot change it", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-day-lock");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-05-04";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Day lock", hours: { tue: 2, thu: 1 }, workNotes: { tue: "Locked day note" } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const lockResponse = await api(`/business/timesheets/${timesheetId}/daily-review/tue`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "locked" },
    });
    assert.equal(lockResponse.status, 200, JSON.stringify(lockResponse.json));
    assert.equal(lockResponse.json.timesheet.dailyReviewLocks.tue, true);

    const lockedPatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [{ project: "Phase 2", task: "Day lock", hours: { tue: 4, thu: 1 }, workNotes: { tue: "Changed" } }],
      },
    });
    assert.equal(lockedPatch.status, 409, JSON.stringify(lockedPatch.json));
    assert.match(String(lockedPatch.json.message), /protected day/i);

    const openPatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [
          { project: "Phase 2", task: "Day lock", hours: { tue: 2, thu: 1 }, workNotes: { tue: "Locked day note" } },
          { project: "Phase 2", task: "Open row", hours: { fri: 3 }, workNotes: { fri: "Allowed edit" } },
        ],
      },
    });
    assert.equal(openPatch.status, 200, JSON.stringify(openPatch.json));
    assert.equal(openPatch.json.timesheet.dailyReviewLocks.tue, true);
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("admin can mark an empty day as holiday and the employee cannot edit it", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-day-holiday");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-05-11";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Holiday row", hours: { tue: 2, wed: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const holidayResponse = await api(`/business/timesheets/${timesheetId}/daily-review/mon`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "holiday" },
    });
    assert.equal(holidayResponse.status, 200, JSON.stringify(holidayResponse.json));
    assert.equal(holidayResponse.json.timesheet.dailyReviewHolidays.mon, true);

    const lockedPatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [{ project: "Phase 2", task: "Holiday row", hours: { mon: 8, tue: 2, wed: 1 }, workNotes: { mon: "Should fail" } }],
      },
    });
    assert.equal(lockedPatch.status, 409, JSON.stringify(lockedPatch.json));
    assert.match(String(lockedPatch.json.message), /protected day/i);
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("admin cannot mark a worked day as holiday", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-holiday-safety");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-05-18";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Worked day", hours: { wed: 4 }, workNotes: { wed: "Already logged" } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const holidayResponse = await api(`/business/timesheets/${timesheetId}/daily-review/wed`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "holiday" },
    });
    assert.equal(holidayResponse.status, 409, JSON.stringify(holidayResponse.json));
    assert.match(String(holidayResponse.json.message), /cannot mark.*holiday/i);
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("admin holiday shows up in the employee month calendar", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-month-calendar-holiday");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-05-11";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [{ project: "Phase 2", task: "Month calendar holiday", hours: { tue: 2, wed: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    const holidayResponse = await api(`/business/timesheets/${timesheetId}/daily-review/mon`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "holiday" },
    });
    assert.equal(holidayResponse.status, 200, JSON.stringify(holidayResponse.json));

    const calendarResponse = await api(`/business/month-calendar?employeeId=${employee.id}&month=2026-05`, {
      method: "GET",
      token: employeeToken,
    });
    assert.equal(calendarResponse.status, 200, JSON.stringify(calendarResponse.json));

    const holidayDay = calendarResponse.json.monthCalendar.days.find((day) => day.date.startsWith("2026-05-11"));
    assert.ok(holidayDay, "Expected the month calendar to include 2026-05-11");
    assert.equal(holidayDay.holiday, true);
    assert.equal(holidayDay.holidaySource, "admin");
    assert.equal(holidayDay.holidayName, "Holiday");
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("reviewing all 7 days auto-submits the week to the admin queue", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-auto-submit");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-04-27";

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: employeeToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [
        {
          project: "Phase 2",
          task: "Full week",
          hours: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
        },
      ],
    },
  });
  assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
  const timesheetId = createResponse.json.timesheet.id;

  try {
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat"]) {
      const response = await api(`/business/timesheets/${timesheetId}/daily-review/${day}`, {
        method: "PATCH",
        token: adminToken,
        body: { reviewed: true },
      });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(response.json.timesheet.status, "draft");
    }

    const finalReviewResponse = await api(`/business/timesheets/${timesheetId}/daily-review/sun`, {
      method: "PATCH",
      token: adminToken,
      body: { reviewed: true },
    });
    assert.equal(finalReviewResponse.status, 200, JSON.stringify(finalReviewResponse.json));
    assert.equal(finalReviewResponse.json.timesheet.status, "submitted");
    assert.equal(typeof finalReviewResponse.json.timesheet.submittedAt, "string");

    const listResponse = await api("/business/timesheets", {
      token: adminToken,
    });
    assert.equal(listResponse.status, 200, JSON.stringify(listResponse.json));
    const saved = listResponse.json.timesheets.find((entry) => entry.id === timesheetId);
    assert.equal(saved?.status, "submitted");
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("timesheet submit retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-submit-idem");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const submitByIdKey = randomSuffix("timesheet-submit-id");
  const submitPayloadKey = randomSuffix("timesheet-submit-payload");

  const createA = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      weekStart: "2026-04-20",
      lines: [{ project: "Phase 2", task: "Submit Idempotency A", hours: { mon: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createA.status), `Timesheet create failed: ${JSON.stringify(createA.json)}`);
  const timesheetAId = createA.json.timesheet.id;

  const createB = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      weekStart: "2026-04-27",
      lines: [{ project: "Phase 2", task: "Submit Idempotency B", hours: { tue: 1 } }],
    },
  });
  assert.ok([200, 201].includes(createB.status), `Timesheet create failed: ${JSON.stringify(createB.json)}`);
  const timesheetBId = createB.json.timesheet.id;

  try {
    const submitA1 = await api(`/business/timesheets/${timesheetAId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitByIdKey },
      body: {},
    });
    assert.equal(submitA1.status, 200, JSON.stringify(submitA1.json));
    assert.equal(submitA1.json.duplicate, false);
    assert.equal(submitA1.json.timesheet.status, "submitted");

    const submitA2 = await api(`/business/timesheets/${timesheetAId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitByIdKey },
      body: {},
    });
    assert.equal(submitA2.status, 200, JSON.stringify(submitA2.json));
    assert.equal(submitA2.json.duplicate, true);
    assert.equal(submitA2.json.timesheet.status, "submitted");

    const submitByIdConflict = await api(`/business/timesheets/${timesheetBId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitByIdKey },
      body: {},
    });
    assert.equal(submitByIdConflict.status, 409, JSON.stringify(submitByIdConflict.json));

    const payloadSubmit1 = await api("/business/timesheets/submit", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitPayloadKey },
      body: {
        employeeId: employee.id,
        weekStart: "2026-05-04",
        lines: [{ project: "Phase 2", task: "Payload submit", hours: { wed: 1 } }],
      },
    });
    assert.ok([200, 201].includes(payloadSubmit1.status), JSON.stringify(payloadSubmit1.json));
    assert.equal(payloadSubmit1.json.duplicate, false);
    const payloadTimesheetId = payloadSubmit1.json.timesheet.id;

    const payloadSubmit2 = await api("/business/timesheets/submit", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitPayloadKey },
      body: {
        employeeId: employee.id,
        weekStart: "2026-05-04",
        lines: [{ project: "Phase 2", task: "Payload submit", hours: { wed: 1 } }],
      },
    });
    assert.equal(payloadSubmit2.status, 200, JSON.stringify(payloadSubmit2.json));
    assert.equal(payloadSubmit2.json.duplicate, true);
    assert.equal(payloadSubmit2.json.timesheet.id, payloadTimesheetId);

    const payloadConflict = await api("/business/timesheets/submit", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitPayloadKey },
      body: {
        employeeId: employee.id,
        weekStart: "2026-05-11",
        lines: [{ project: "Phase 2", task: "Different payload", hours: { thu: 1 } }],
      },
    });
    assert.equal(payloadConflict.status, 409, JSON.stringify(payloadConflict.json));
  } finally {
    await api(`/business/timesheets/${timesheetAId}`, { method: "DELETE", token: adminToken });
    await api(`/business/timesheets/${timesheetBId}`, { method: "DELETE", token: adminToken });
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

test("expense review retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
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
      description: "Phase 2 expense idempotency check",
      note: "workflow",
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const expenseId = createResponse.json.expense.id;
  const idempotencyKey = randomSuffix("expense-review");

  try {
    const approveFirst = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewerNote: "approved" },
    });
    assert.equal(approveFirst.status, 200, JSON.stringify(approveFirst.json));
    assert.equal(approveFirst.json.duplicate, false);

    const approveRetry = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewerNote: "approved" },
    });
    assert.ok([403, 409].includes(approveRetry.status), JSON.stringify(approveRetry.json));

    const approveConflict = await api(`/business/expenses/${expenseId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewerNote: "different-note" },
    });
    assert.ok([403, 409].includes(approveConflict.status), JSON.stringify(approveConflict.json));
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

test("leave review retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-leave-idem-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employeeId = createdEmployee.user.id;
  const employeeToken = await login(createdEmployee.user.email, createdEmployee.temporaryPassword);
  const idempotencyKey = randomSuffix("leave-review");

  const leaveCreate = await api("/business/leave-requests", {
    method: "POST",
    token: employeeToken,
    body: {
      startDate: "2026-05-12",
      endDate: "2026-05-12",
      reason: "Phase 2 leave idempotency",
    },
  });
  assert.equal(leaveCreate.status, 201, JSON.stringify(leaveCreate.json));
  const leaveId = leaveCreate.json.leaveRequest.id;

  try {
    const approve1 = await api(`/business/leave-requests/${leaveId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewNote: "approve-once" },
    });
    assert.equal(approve1.status, 200, JSON.stringify(approve1.json));
    assert.equal(approve1.json.duplicate, false);
    assert.equal(approve1.json.leaveRequest.status, "approved");

    const approve2 = await api(`/business/leave-requests/${leaveId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewNote: "approve-once" },
    });
    assert.equal(approve2.status, 200, JSON.stringify(approve2.json));
    assert.equal(approve2.json.duplicate, true);
    assert.equal(approve2.json.leaveRequest.status, "approved");

    const approveConflict = await api(`/business/leave-requests/${leaveId}/status`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { status: "approved", reviewNote: "different-note" },
    });
    assert.equal(approveConflict.status, 409, JSON.stringify(approveConflict.json));
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

test("pre-approval receive-funds retries stay idempotent", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-client-rf");
  const createdClient = await createClient(adminToken, suffix);
  const clientToken = await login(createdClient.user.email, createdClient.temporaryPassword);
  const title = `Phase 2 Receive Funds ${suffix}`;

  const createResponse = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title,
      project: `Phase Project ${suffix}`,
      clientId: createdClient.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Execution", description: "Billable row", hours: 1, rate: 100 }],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const preApprovalId = createResponse.json.preApproval.id;
  const idempotencyKey = randomSuffix("receive-funds");

  try {
    const submitResponse = await api(`/business/pre-approvals/${preApprovalId}/submit`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));

    const approveResponse = await api(`/business/pre-approvals/${preApprovalId}/approve`, {
      method: "POST",
      token: clientToken,
      body: {},
    });
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));

    const receiveFirst = await api(`/business/pre-approvals/${preApprovalId}/receive-funds`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: {},
    });
    assert.equal(receiveFirst.status, 200, JSON.stringify(receiveFirst.json));
    assert.equal(receiveFirst.json.duplicate, false);
    const receivedFundId = receiveFirst.json.preApproval.receivedFundId;
    assert.ok(receivedFundId, "Expected receivedFundId to be set after first receive.");

    const receiveRetry = await api(`/business/pre-approvals/${preApprovalId}/receive-funds`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: {},
    });
    assert.equal(receiveRetry.status, 200, JSON.stringify(receiveRetry.json));
    assert.equal(receiveRetry.json.duplicate, true);
    assert.equal(receiveRetry.json.preApproval.receivedFundId, receivedFundId);

    const fundsResponse = await api("/business/funds", {
      method: "GET",
      token: adminToken,
    });
    assert.equal(fundsResponse.status, 200, JSON.stringify(fundsResponse.json));
    const matchingFunds = fundsResponse.json.funds.filter((fund) => fund.id === receivedFundId);
    assert.equal(matchingFunds.length, 1);
  } finally {
    await api(`/admin/clients/${createdClient.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("pre-approval submit/approve/request-changes retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-client-approval-idem");
  const createdClient = await createClient(adminToken, suffix);
  const clientToken = await login(createdClient.user.email, createdClient.temporaryPassword);
  const submitKey = randomSuffix("pa-submit");
  const approveKey = randomSuffix("pa-approve");
  const requestChangesKey = randomSuffix("pa-request-changes");

  const createA = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Phase 2 Pre Approval A ${suffix}`,
      project: `Phase Project A ${suffix}`,
      clientId: createdClient.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Task A", description: "Row A", hours: 1, rate: 100 }],
    },
  });
  assert.equal(createA.status, 201, JSON.stringify(createA.json));
  const preApprovalAId = createA.json.preApproval.id;

  const createB = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Phase 2 Pre Approval B ${suffix}`,
      project: `Phase Project B ${suffix}`,
      clientId: createdClient.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Task B", description: "Row B", hours: 1, rate: 120 }],
    },
  });
  assert.equal(createB.status, 201, JSON.stringify(createB.json));
  const preApprovalBId = createB.json.preApproval.id;

  try {
    const submitA1 = await api(`/business/pre-approvals/${preApprovalAId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitKey },
      body: {},
    });
    assert.equal(submitA1.status, 200, JSON.stringify(submitA1.json));
    assert.equal(submitA1.json.duplicate, false);

    const submitA2 = await api(`/business/pre-approvals/${preApprovalAId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitKey },
      body: {},
    });
    assert.equal(submitA2.status, 200, JSON.stringify(submitA2.json));
    assert.equal(submitA2.json.duplicate, true);

    const submitConflict = await api(`/business/pre-approvals/${preApprovalBId}/submit`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": submitKey },
      body: {},
    });
    assert.equal(submitConflict.status, 409, JSON.stringify(submitConflict.json));

    const approveA1 = await api(`/business/pre-approvals/${preApprovalAId}/approve`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": approveKey },
      body: {},
    });
    assert.equal(approveA1.status, 200, JSON.stringify(approveA1.json));
    assert.equal(approveA1.json.duplicate, false);

    const approveA2 = await api(`/business/pre-approvals/${preApprovalAId}/approve`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": approveKey },
      body: {},
    });
    assert.equal(approveA2.status, 200, JSON.stringify(approveA2.json));
    assert.equal(approveA2.json.duplicate, true);

    const approveConflict = await api(`/business/pre-approvals/${preApprovalBId}/approve`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": approveKey },
      body: {},
    });
    assert.equal(approveConflict.status, 409, JSON.stringify(approveConflict.json));

    const submitB = await api(`/business/pre-approvals/${preApprovalBId}/submit`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(submitB.status, 200, JSON.stringify(submitB.json));

    const requestChanges1 = await api(`/business/pre-approvals/${preApprovalBId}/request-changes`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": requestChangesKey },
      body: { message: "Please revise totals." },
    });
    assert.equal(requestChanges1.status, 200, JSON.stringify(requestChanges1.json));
    assert.equal(requestChanges1.json.duplicate, false);

    const requestChanges2 = await api(`/business/pre-approvals/${preApprovalBId}/request-changes`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": requestChangesKey },
      body: { message: "Please revise totals." },
    });
    assert.equal(requestChanges2.status, 200, JSON.stringify(requestChanges2.json));
    assert.equal(requestChanges2.json.duplicate, true);

    const requestChangesConflict = await api(`/business/pre-approvals/${preApprovalBId}/request-changes`, {
      method: "POST",
      token: clientToken,
      headers: { "Idempotency-Key": requestChangesKey },
      body: { message: "Different message." },
    });
    assert.equal(requestChangesConflict.status, 409, JSON.stringify(requestChangesConflict.json));
  } finally {
    await api(`/admin/clients/${createdClient.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("pre-approval comment retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-client-comment-idem");
  const createdClient = await createClient(adminToken, suffix);
  const commentKey = randomSuffix("pa-comment");

  const createResponse = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Phase 2 Comment Pre Approval ${suffix}`,
      project: `Phase Project ${suffix}`,
      clientId: createdClient.user.id,
      date: "2026-04-11",
      tasks: [{ taskName: "Comment task", description: "Row", hours: 1, rate: 100 }],
    },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const preApprovalId = createResponse.json.preApproval.id;

  try {
    const comment1 = await api(`/business/pre-approvals/${preApprovalId}/comments`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": commentKey },
      body: { message: "Please verify line items." },
    });
    assert.equal(comment1.status, 201, JSON.stringify(comment1.json));
    assert.equal(comment1.json.duplicate, false);
    assert.equal(comment1.json.comment.message, "Please verify line items.");

    const comment2 = await api(`/business/pre-approvals/${preApprovalId}/comments`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": commentKey },
      body: { message: "Please verify line items." },
    });
    assert.equal(comment2.status, 200, JSON.stringify(comment2.json));
    assert.equal(comment2.json.duplicate, true);
    assert.equal(comment2.json.comment.message, "Please verify line items.");

    const conflict = await api(`/business/pre-approvals/${preApprovalId}/comments`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": commentKey },
      body: { message: "Different comment payload." },
    });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
  } finally {
    await api(`/admin/clients/${createdClient.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("salary and PO payment retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("salary-po-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const salaryPayKey = randomSuffix("salary-pay");
  const poPayKey = randomSuffix("po-pay");

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
      headers: { "Idempotency-Key": salaryPayKey },
      body: { note: "first pay" },
    });
    const salaryPay2 = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { note: "first pay" },
    });
    assert.equal(salaryPay1.status, 200, JSON.stringify(salaryPay1.json));
    assert.equal(salaryPay2.status, 200, JSON.stringify(salaryPay2.json));
    assert.equal(salaryPay1.json.duplicate, false);
    assert.equal(salaryPay2.json.duplicate, true);

    const salaryPayConflict = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { note: "different note" },
    });
    assert.equal(salaryPayConflict.status, 409, JSON.stringify(salaryPayConflict.json));

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
      headers: { "Idempotency-Key": poPayKey },
      body: {},
    });
    const pay2 = await api(`/business/purchase-orders/${poId}/tasks/${taskId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": poPayKey },
      body: {},
    });
    assert.equal(pay1.status, 200, JSON.stringify(pay1.json));
    assert.equal(pay2.status, 200, JSON.stringify(pay2.json));
    assert.equal(pay1.json.duplicate, false);
    assert.equal(pay2.json.duplicate, true);
    const paidTask = pay2.json.purchaseOrder.tasks.find((task) => task.id === taskId);
    assert.equal(paidTask.status, "paid");

    const secondTaskCreate = await api(`/business/purchase-orders/${poId}/tasks`, {
      method: "POST",
      token: adminToken,
      body: { taskName: "Second payable row", hours: 1, rate: 1, description: "phase2 second" },
    });
    assert.equal(secondTaskCreate.status, 201, JSON.stringify(secondTaskCreate.json));
    const secondTaskId = secondTaskCreate.json.task.id;

    const payConflict = await api(`/business/purchase-orders/${poId}/tasks/${secondTaskId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": poPayKey },
      body: {},
    });
    assert.equal(payConflict.status, 409, JSON.stringify(payConflict.json));
  } finally {
    await api(`/business/salaries/${salaryId}`, { method: "DELETE", token: adminToken });
    await api(`/business/purchase-orders/${poId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("timesheet draft create/update/delete workflow stays stable for repeated same-id saves", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("timesheet-draft");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const timesheetId = randomSuffix("timesheet-draft-id");
  const timesheetPayload = {
    id: timesheetId,
    employeeId: employee.id,
    weekStart: "2026-05-18",
    lines: [{ project: "Draft Project", task: "Draft row", hours: { mon: 1 } }],
  };

  try {
    const create1 = await api("/business/timesheets", {
      method: "POST",
      token: employeeToken,
      body: timesheetPayload,
    });
    assert.equal(create1.status, 201, JSON.stringify(create1.json));
    assert.equal(create1.json.timesheet.id, timesheetId);

    const create2 = await api("/business/timesheets", {
      method: "POST",
      token: employeeToken,
      body: timesheetPayload,
    });
    assert.equal(create2.status, 200, JSON.stringify(create2.json));
    assert.equal(create2.json.timesheet.id, timesheetId);

    const updatePayload = {
      ...timesheetPayload,
      lines: [{ project: "Draft Project Updated", task: "Draft row updated", hours: { mon: 2 } }],
    };
    const update1 = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: updatePayload,
    });
    assert.equal(update1.status, 200, JSON.stringify(update1.json));
    assert.equal(update1.json.timesheet.id, timesheetId);

    const update2 = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: updatePayload,
    });
    assert.equal(update2.status, 200, JSON.stringify(update2.json));
    assert.equal(update2.json.timesheet.id, timesheetId);

    const deleteResponse = await api(`/business/timesheets/${timesheetId}`, {
      method: "DELETE",
      token: employeeToken,
    });
    assert.equal(deleteResponse.status, 204, JSON.stringify(deleteResponse.json));

    const deletedLookup = await api(`/business/timesheets/${timesheetId}`, {
      method: "GET",
      token: adminToken,
    });
    assert.equal(deletedLookup.status, 404, JSON.stringify(deletedLookup.json));
  } finally {
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("empty review shells can be shown, locked, and protected before work is entered", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("timesheet-shell");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const timesheetId = randomSuffix("timesheet-shell-id");
  const timesheetPayload = {
    id: timesheetId,
    employeeId: employee.id,
    employeeNameSnapshot: employee.name,
    weekStart: "2026-05-18",
    reviewShell: true,
    lines: [],
  };

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: timesheetPayload,
    });
    assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
    assert.equal(createResponse.json.timesheet.id, timesheetId);
    assert.equal(createResponse.json.timesheet.reviewShell, true);

    const lockResponse = await api(`/business/timesheets/${timesheetId}/daily-review/mon`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "locked" },
    });
    assert.equal(lockResponse.status, 200, JSON.stringify(lockResponse.json));
    assert.equal(lockResponse.json.timesheet.dailyReviewLocks.mon, true);

    const employeePatch = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: {
        id: timesheetId,
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        weekStart: "2026-05-18",
        lines: [{ project: "Shell Project", task: "Shell task", hours: { mon: 1 } }],
      },
    });
    assert.equal(employeePatch.status, 409, JSON.stringify(employeePatch.json));
    assert.match(String(employeePatch.json.message), /protected day/i);
  } finally {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("leave request create/delete workflow rejects duplicate submission and cleans up", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("leave-workflow");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const leavePayload = {
    startDate: "2026-05-25",
    endDate: "2026-05-26",
    reason: "Workflow coverage leave",
  };

  try {
    const createResponse = await api("/business/leave-requests", {
      method: "POST",
      token: employeeToken,
      body: leavePayload,
    });
    assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
    const leaveId = createResponse.json.leaveRequest.id;

    const duplicateResponse = await api("/business/leave-requests", {
      method: "POST",
      token: employeeToken,
      body: leavePayload,
    });
    assert.equal(duplicateResponse.status, 409, JSON.stringify(duplicateResponse.json));

    const deleteResponse = await api(`/business/leave-requests/${leaveId}`, {
      method: "DELETE",
      token: employeeToken,
    });
    assert.equal(deleteResponse.status, 204, JSON.stringify(deleteResponse.json));
  } finally {
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("holiday create/delete workflow keeps the same id on repeated saves", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const holidayId = randomSuffix("holiday-workflow");
  const holidayPayload = {
    id: holidayId,
    date: "2026-05-27",
    name: "Workflow Coverage Holiday",
  };

  const createResponse1 = await api("/business/holidays", {
    method: "POST",
    token: adminToken,
    body: holidayPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.holiday.id, holidayId);

  const createResponse2 = await api("/business/holidays", {
    method: "POST",
    token: adminToken,
    body: holidayPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.holiday.id, holidayId);

  const deleteResponse = await api(`/business/holidays/${holidayId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(deleteResponse.status, 204, JSON.stringify(deleteResponse.json));
});

test("project create/update/delete/task-create workflow stays stable with repeated same-id saves", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const projectId = randomSuffix("project-workflow");
  const taskId = randomSuffix("project-task-workflow");
  const createPayload = {
    id: projectId,
    project: `Workflow Project ${projectId}`,
    totalBudget: 25,
    client: "Workflow Client",
    note: "project-create",
    tasks: [],
  };

  const createResponse1 = await api("/business/projects", {
    method: "POST",
    token: adminToken,
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.project.id, projectId);

  const createResponse2 = await api("/business/projects", {
    method: "POST",
    token: adminToken,
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.project.id, projectId);

  const updatePayload = {
    id: projectId,
    project: `${createPayload.project} Updated`,
    totalBudget: 30,
    client: "Workflow Client Updated",
    note: "project-update",
    tasks: [],
  };
  const updateResponse1 = await api(`/business/projects/${projectId}`, {
    method: "PATCH",
    token: adminToken,
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.project.id, projectId);

  const updateResponse2 = await api(`/business/projects/${projectId}`, {
    method: "PATCH",
    token: adminToken,
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.project.id, projectId);

  const taskCreateResponse = await api(`/business/projects/${projectId}/tasks`, {
    method: "POST",
    token: adminToken,
    body: {
      id: taskId,
      name: "Workflow Project Task",
      description: "task-create",
      maxHours: 4,
      status: "active",
    },
  });
  assert.equal(taskCreateResponse.status, 201, JSON.stringify(taskCreateResponse.json));
  assert.equal(taskCreateResponse.json.task.id, taskId);

  const deleteResponse1 = await api(`/business/projects/${projectId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

  const deleteResponse2 = await api(`/business/projects/${projectId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));
});

test("expense create/update/delete retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createdEmployee = await createEmployee(adminToken, randomSuffix("expense-idem-employee"));
  const employee = createdEmployee.user;
  const createKey = randomSuffix("expense-create");
  const updateKey = randomSuffix("expense-update");
  const deleteKey = randomSuffix("expense-delete");

  const createPayload = {
    employeeId: employee.id,
    employeeNameSnapshot: employee.name,
    category: `Legacy Expense ${randomSuffix("category")}`,
    group: "office",
    amount: 11,
    date: "2026-04-11",
    description: "Legacy expense idempotency check",
    note: "expense-create",
  };
  const createResponse1 = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const expenseId = createResponse1.json.expense.id;

  const createResponse2 = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.expense.id, expenseId);

  const createConflict = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, description: "Different expense description" },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  const updatePayload = {
    employeeId: employee.id,
    employeeNameSnapshot: employee.name,
    category: `${createPayload.category} Updated`,
    group: "office",
    amount: 12,
    date: "2026-04-11",
    description: "Legacy expense updated",
    note: "expense-update",
  };
  const updateResponse1 = await api(`/business/expenses/${expenseId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.duplicate, false);
  assert.equal(updateResponse1.json.expense.description, updatePayload.description);

  const updateResponse2 = await api(`/business/expenses/${expenseId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.duplicate, true);
  assert.equal(updateResponse2.json.expense.description, updatePayload.description);

  const updateConflict = await api(`/business/expenses/${expenseId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, description: "Different expense update" },
  });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));

  const secondExpense = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    body: {
      ...createPayload,
      description: "Legacy expense delete conflict",
      note: "expense-delete-conflict",
    },
  });
  assert.equal(secondExpense.status, 201, JSON.stringify(secondExpense.json));
  const secondExpenseId = secondExpense.json.expense.id;

  try {
    const deleteResponse1 = await api(`/business/expenses/${expenseId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/business/expenses/${expenseId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/business/expenses/${secondExpenseId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/business/expenses/${secondExpenseId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("salary create/update/delete retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createdEmployee = await createEmployee(adminToken, randomSuffix("salary-idem-employee"));
  const employee = createdEmployee.user;
  const createKey = randomSuffix("salary-create");
  const updateKey = randomSuffix("salary-update");
  const deleteKey = randomSuffix("salary-delete");

  const createPayload = {
    employeeId: employee.id,
    amount: 1200,
    date: "2026-04-11",
    note: "salary-create",
  };
  const createResponse1 = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const salaryId = createResponse1.json.salary.id;

  const createResponse2 = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.salary.id, salaryId);

  const createConflict = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, amount: 1300 },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  const updatePayload = {
    employeeId: employee.id,
    amount: 1450,
    date: "2026-04-11",
    note: "salary-update",
  };
  const updateResponse1 = await api(`/business/salaries/${salaryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.duplicate, false);
  assert.equal(updateResponse1.json.salary.amount, 1450);

  const updateResponse2 = await api(`/business/salaries/${salaryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.duplicate, true);
  assert.equal(updateResponse2.json.salary.amount, 1450);

  const updateConflict = await api(`/business/salaries/${salaryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, amount: 1500 },
  });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));

  const secondSalary = await api("/business/salaries", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      amount: 900,
      date: "2026-04-11",
      note: "salary-delete-conflict",
    },
  });
  assert.equal(secondSalary.status, 201, JSON.stringify(secondSalary.json));
  const secondSalaryId = secondSalary.json.salary.id;

  try {
    const deleteResponse1 = await api(`/business/salaries/${salaryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/business/salaries/${salaryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/business/salaries/${secondSalaryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/business/salaries/${secondSalaryId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("purchase order create/update/delete/task-create retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createKey = randomSuffix("po-create");
  const updateKey = randomSuffix("po-update");
  const deleteKey = randomSuffix("po-delete");
  const taskKey = randomSuffix("po-task-create");

  const createPayload = {
    title: `Legacy PO ${randomSuffix("base")}`,
    totalAmount: 10,
    vendor: "Workflow Vendor",
    date: "2026-04-11",
    notes: "po-create",
    tasks: [],
  };
  const createResponse1 = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const purchaseOrderId = createResponse1.json.purchaseOrder.id;

  const createResponse2 = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.purchaseOrder.id, purchaseOrderId);

  const createConflict = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, title: `${createPayload.title} Updated` },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  const updatePayload = {
    title: `${createPayload.title} Updated`,
    totalAmount: 12,
    vendor: "Workflow Vendor Updated",
    date: "2026-04-11",
    notes: "po-update",
    tasks: [],
  };
  const updateResponse1 = await api(`/business/purchase-orders/${purchaseOrderId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.duplicate, false);
  assert.equal(updateResponse1.json.purchaseOrder.title, updatePayload.title);

  const updateResponse2 = await api(`/business/purchase-orders/${purchaseOrderId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.duplicate, true);
  assert.equal(updateResponse2.json.purchaseOrder.title, updatePayload.title);

  const updateConflict = await api(`/business/purchase-orders/${purchaseOrderId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, notes: "po-update-different" },
  });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));

  const taskCreate1 = await api(`/business/purchase-orders/${purchaseOrderId}/tasks`, {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": taskKey },
    body: { taskName: "Legacy PO Task", description: "task-create", hours: 1, rate: 5 },
  });
  assert.equal(taskCreate1.status, 201, JSON.stringify(taskCreate1.json));
  assert.equal(taskCreate1.json.duplicate, false);
  const taskId = taskCreate1.json.task.id;

  const taskCreate2 = await api(`/business/purchase-orders/${purchaseOrderId}/tasks`, {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": taskKey },
    body: { taskName: "Legacy PO Task", description: "task-create", hours: 1, rate: 5 },
  });
  assert.equal(taskCreate2.status, 200, JSON.stringify(taskCreate2.json));
  assert.equal(taskCreate2.json.duplicate, true);
  assert.equal(taskCreate2.json.task.id, taskId);

  const taskCreateConflict = await api(`/business/purchase-orders/${purchaseOrderId}/tasks`, {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": taskKey },
    body: { taskName: "Legacy PO Task", description: "task-create", hours: 1, rate: 6 },
  });
  assert.equal(taskCreateConflict.status, 409, JSON.stringify(taskCreateConflict.json));

  const secondPurchaseOrder = await api("/business/purchase-orders", {
    method: "POST",
    token: adminToken,
    body: {
      title: `Legacy PO Delete ${randomSuffix("secondary")}`,
      totalAmount: 8,
      vendor: "Workflow Vendor",
      date: "2026-04-11",
      notes: "po-delete-conflict",
      tasks: [],
    },
  });
  assert.equal(secondPurchaseOrder.status, 201, JSON.stringify(secondPurchaseOrder.json));
  const secondPurchaseOrderId = secondPurchaseOrder.json.purchaseOrder.id;

  try {
    const deleteResponse1 = await api(`/business/purchase-orders/${purchaseOrderId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/business/purchase-orders/${purchaseOrderId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/business/purchase-orders/${secondPurchaseOrderId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/business/purchase-orders/${secondPurchaseOrderId}`, { method: "DELETE", token: adminToken });
  }
});

test("pre-approval create/update/delete retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createdClient = await createClient(adminToken, randomSuffix("pre-approval-idem-client"));
  const createKey = randomSuffix("pre-approval-create");
  const updateKey = randomSuffix("pre-approval-update");
  const deleteKey = randomSuffix("pre-approval-delete");

  const createPayload = {
    title: `Legacy Pre Approval ${randomSuffix("base")}`,
    project: `Legacy Project ${randomSuffix("project")}`,
    clientId: createdClient.user.id,
    date: "2026-04-11",
    notes: "pre-approval-create",
    tasks: [{ taskName: "Planning", description: "task-create", hours: 1, rate: 100 }],
  };
  const createResponse1 = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const preApprovalId = createResponse1.json.preApproval.id;

  const createResponse2 = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.preApproval.id, preApprovalId);

  const createConflict = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, title: `${createPayload.title} Updated` },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  const updatePayload = {
    title: `${createPayload.title} Updated`,
    project: `${createPayload.project} Updated`,
    clientId: createdClient.user.id,
    date: "2026-04-11",
    notes: "pre-approval-update",
    tasks: [{ taskName: "Planning", description: "task-update", hours: 1, rate: 100 }],
  };
  const updateResponse1 = await api(`/business/pre-approvals/${preApprovalId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.duplicate, false);
  assert.equal(updateResponse1.json.preApproval.title, updatePayload.title);

  const updateResponse2 = await api(`/business/pre-approvals/${preApprovalId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.duplicate, true);
  assert.equal(updateResponse2.json.preApproval.title, updatePayload.title);

  const updateConflict = await api(`/business/pre-approvals/${preApprovalId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, notes: "pre-approval-update-different" },
  });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));

  const secondPreApproval = await api("/business/pre-approvals", {
    method: "POST",
    token: adminToken,
    body: {
      ...createPayload,
      title: `Legacy Pre Approval ${randomSuffix("delete-conflict")}`,
      project: `Legacy Project ${randomSuffix("delete-project")}`,
      notes: "pre-approval-delete-conflict",
    },
  });
  assert.equal(secondPreApproval.status, 201, JSON.stringify(secondPreApproval.json));
  const secondPreApprovalId = secondPreApproval.json.preApproval.id;

  try {
    const deleteResponse1 = await api(`/business/pre-approvals/${preApprovalId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/business/pre-approvals/${preApprovalId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/business/pre-approvals/${secondPreApprovalId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/business/pre-approvals/${secondPreApprovalId}`, { method: "DELETE", token: adminToken });
    await api(`/admin/clients/${createdClient.user.id}`, { method: "DELETE", token: adminToken });
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
  const duplicateTenant = await api("/platform/tenants", {
    method: "POST",
    token: platformToken,
    body: {
      name: `Phase Two Duplicate ${suffix}`,
      slug: `${suffix.toLowerCase()}-duplicate`,
      ownerName: "Phase Tenant Owner Duplicate",
      ownerEmail: createTenant.json.owner.email,
      ownerPhone: `${Math.floor(7000000000 + Math.random() * 99999999)}`,
      ownerPassword: "tenantpass123",
    },
  });
  assert.equal(duplicateTenant.status, 409, JSON.stringify(duplicateTenant.json));
  assert.equal(duplicateTenant.json.code, "email_taken");
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

test("fund update and delete retries stay idempotent", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createKey = randomSuffix("fund-create");
  const updateKey = randomSuffix("fund-update");
  const deleteKey = randomSuffix("fund-delete");

  const createResponse = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { source: "Fund Idem Base", amount: 7, date: "2026-04-11", note: "start" },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const fundId = createResponse.json.fund.id;

  const updatePayload = { source: "Fund Idem Updated", amount: 9, date: "2026-04-11", note: "updated" };
  const firstUpdate = await api(`/business/funds/${fundId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(firstUpdate.status, 200, JSON.stringify(firstUpdate.json));
  assert.equal(firstUpdate.json.duplicate, false);
  assert.equal(firstUpdate.json.fund.amount, 9);

  const retryUpdate = await api(`/business/funds/${fundId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(retryUpdate.status, 200, JSON.stringify(retryUpdate.json));
  assert.equal(retryUpdate.json.duplicate, true);
  assert.equal(retryUpdate.json.fund.amount, 9);

  const conflictUpdate = await api(`/business/funds/${fundId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, note: "different" },
  });
  assert.equal(conflictUpdate.status, 409, JSON.stringify(conflictUpdate.json));

  const firstDelete = await api(`/business/funds/${fundId}`, {
    method: "DELETE",
    token: adminToken,
    headers: { "Idempotency-Key": deleteKey },
  });
  assert.equal(firstDelete.status, 204, JSON.stringify(firstDelete.json));

  const retryDelete = await api(`/business/funds/${fundId}`, {
    method: "DELETE",
    token: adminToken,
    headers: { "Idempotency-Key": deleteKey },
  });
  assert.equal(retryDelete.status, 204, JSON.stringify(retryDelete.json));
});

test("category create/update/delete retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createKey = randomSuffix("category-create");
  const updateKey = randomSuffix("category-update");
  const deleteKey = randomSuffix("category-delete");

  const createPayload = {
    name: `Phase2 Category ${randomSuffix("base")}`,
    color: "#1F2937",
    group: "office",
  };
  const createResponse1 = await api("/business/categories", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const categoryId = createResponse1.json.category.id;

  const createResponse2 = await api("/business/categories", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.category.id, categoryId);

  const createConflict = await api("/business/categories", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, name: `${createPayload.name} changed` },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  const updatePayload = {
    id: categoryId,
    name: `${createPayload.name} Updated`,
    color: "#111827",
    group: "office",
  };
  const updateResponse1 = await api(`/business/categories/${categoryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
  assert.equal(updateResponse1.json.duplicate, false);
  assert.equal(updateResponse1.json.category.name, updatePayload.name);

  const updateResponse2 = await api(`/business/categories/${categoryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: updatePayload,
  });
  assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
  assert.equal(updateResponse2.json.duplicate, true);
  assert.equal(updateResponse2.json.category.name, updatePayload.name);

  const updateConflict = await api(`/business/categories/${categoryId}`, {
    method: "PATCH",
    token: adminToken,
    headers: { "Idempotency-Key": updateKey },
    body: { ...updatePayload, color: "#000000" },
  });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));

  const secondCategory = await api("/business/categories", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Phase2 Category ${randomSuffix("second")}`,
      color: "#0F172A",
      group: "office",
    },
  });
  assert.ok([200, 201].includes(secondCategory.status), JSON.stringify(secondCategory.json));
  const secondCategoryId = secondCategory.json.category.id;

  try {
    const deleteResponse1 = await api(`/business/categories/${categoryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 204, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/business/categories/${categoryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 204, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/business/categories/${secondCategoryId}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/business/categories/${secondCategoryId}`, { method: "DELETE", token: adminToken });
  }
});

test("employee create retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createKey = randomSuffix("employee-create");
  const payload = {
    name: `Admin Employee ${randomSuffix("create")}`,
    email: `${randomSuffix("employee")}@example.com`,
    phone: `${Math.floor(9000000000 + Math.random() * 99999999)}`,
    position: "QA Analyst",
    salary: 1000,
    payType: "hourly",
    hourlyRate: 100,
    department: "QA",
  };

  const createResponse1 = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: payload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const employeeId = createResponse1.json.user.id;

  try {
    const createResponse2 = await api("/admin/employees", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": createKey },
      body: payload,
    });
    assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
    assert.equal(createResponse2.json.duplicate, true);
    assert.equal(createResponse2.json.user.id, employeeId);

    const createConflict = await api("/admin/employees", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": createKey },
      body: { ...payload, position: "Senior QA Analyst" },
    });
    assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));
  } finally {
    await api(`/admin/employees/${employeeId}`, { method: "DELETE", token: adminToken });
  }
});

test("employee update retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const updateKey = randomSuffix("employee-update");
  const suffix = randomSuffix("employee-update-base");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const updatePayload = {
    name: `${employee.name} Updated`,
    email: employee.email,
    phone: employee.phone,
    position: "Senior QA Analyst",
    salary: employee.salary + 250,
    payType: employee.payType,
    hourlyRate: employee.hourlyRate,
    department: employee.department ?? "QA",
  };

  try {
    const updateResponse1 = await api(`/admin/employees/${employee.id}`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": updateKey },
      body: updatePayload,
    });
    assert.equal(updateResponse1.status, 200, JSON.stringify(updateResponse1.json));
    assert.equal(updateResponse1.json.duplicate, false);
    assert.equal(updateResponse1.json.user.name, updatePayload.name);

    const updateResponse2 = await api(`/admin/employees/${employee.id}`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": updateKey },
      body: updatePayload,
    });
    assert.equal(updateResponse2.status, 200, JSON.stringify(updateResponse2.json));
    assert.equal(updateResponse2.json.duplicate, true);
    assert.equal(updateResponse2.json.user.name, updatePayload.name);

    const updateConflict = await api(`/admin/employees/${employee.id}`, {
      method: "PATCH",
      token: adminToken,
      headers: { "Idempotency-Key": updateKey },
      body: { ...updatePayload, salary: updatePayload.salary + 25 },
    });
    assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.json));
  } finally {
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("employee delete retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const deleteKey = randomSuffix("employee-delete");
  const firstEmployee = await createEmployee(adminToken, randomSuffix("employee-delete-a"));
  const secondEmployee = await createEmployee(adminToken, randomSuffix("employee-delete-b"));

  try {
    const deleteResponse1 = await api(`/admin/employees/${firstEmployee.user.id}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse1.status, 200, JSON.stringify(deleteResponse1.json));

    const deleteResponse2 = await api(`/admin/employees/${firstEmployee.user.id}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteResponse2.status, 200, JSON.stringify(deleteResponse2.json));

    const deleteConflict = await api(`/admin/employees/${secondEmployee.user.id}`, {
      method: "DELETE",
      token: adminToken,
      headers: { "Idempotency-Key": deleteKey },
    });
    assert.equal(deleteConflict.status, 409, JSON.stringify(deleteConflict.json));
  } finally {
    await api(`/admin/employees/${secondEmployee.user.id}`, { method: "DELETE", token: adminToken });
  }
});

test("client create retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createKey = randomSuffix("client-create");
  const payload = {
    name: `Admin Client ${randomSuffix("create")}`,
    email: `${randomSuffix("client")}.client@example.com`,
    phone: `${Math.floor(8000000000 + Math.random() * 99999999)}`,
    company: `Client Co ${randomSuffix("co")}`,
    billingEmail: `${randomSuffix("billing")}.billing@example.com`,
    address: "Workflow Test Address",
    website: "https://example.com",
  };

  const createResponse1 = await api("/admin/clients", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: payload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const clientId = createResponse1.json.user.id;

  try {
    const createResponse2 = await api("/admin/clients", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": createKey },
      body: payload,
    });
    assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
    assert.equal(createResponse2.json.duplicate, true);
    assert.equal(createResponse2.json.user.id, clientId);

    const createConflict = await api("/admin/clients", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": createKey },
      body: { ...payload, company: `${payload.company} Updated` },
    });
    assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));
  } finally {
    await api(`/admin/clients/${clientId}`, { method: "DELETE", token: adminToken });
  }
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
