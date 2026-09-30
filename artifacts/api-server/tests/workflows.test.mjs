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
let testFinancialAccountId;

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

async function createMonthlyEmployee(adminToken, suffix, salary) {
  const response = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Phase Two ${suffix}`,
      email: `${suffix}@example.com`,
      phone: `${Math.floor(9000000000 + Math.random() * 99999999)}`,
      position: "QA Analyst",
      salary,
      payType: "monthly",
      department: "QA",
    },
  });
  assert.equal(response.status, 201, `Employee creation failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

function payrollMonthKey(record) {
  const scopedMonth = String(record.timesheetId ?? "").match(/:(\d{4}-\d{2})$/)?.[1];
  if (scopedMonth) {
    return scopedMonth;
  }

  return String(record.weekStart ?? record.date).slice(0, 7);
}

function salaryBelongsToTimesheetMonth(record, timesheetId) {
  return record.timesheetId === timesheetId || String(record.timesheetId ?? "").startsWith(`${timesheetId}:`);
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

async function getTestFinancialAccountId(adminToken) {
  if (testFinancialAccountId) {
    return testFinancialAccountId;
  }

  const response = await api("/business/financial-accounts", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Workflow account ${randomSuffix("account")}`,
      accountType: "operational",
      category: "bank",
      openingBalance: 0,
      description: "Isolated integration-test account",
      includeInOperationalReporting: true,
      isActive: true,
    },
  });
  assert.equal(response.status, 201, `Financial account creation failed: ${JSON.stringify(response.json)}`);
  testFinancialAccountId = response.json.account.id;
  assert.ok(testFinancialAccountId, "Expected an id from financial account creation");
  return testFinancialAccountId;
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

test("salary slip preview uses worked days, fixed address, and basic-only earnings", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("salary-slip-preview");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const weekStart = "2026-07-06";
  const accountId = await getTestFinancialAccountId(adminToken);
  let generatedSlipId = null;
  let generatedSalaryId = null;
  let fundId = null;

  const createResponse = await api("/business/timesheets", {
    method: "POST",
    token: adminToken,
    body: {
      employeeId: employee.id,
      weekStart,
      lines: [
        {
          project: "Payroll QA",
          task: "Slip preview",
          hours: { mon: 4, tue: 0, wed: 3, thu: 0, fri: 2, sat: 0, sun: 0 },
        },
      ],
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

    const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "salary slip preview regression" },
    });
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));

    const salariesResponse = await api(`/business/salaries?employeeId=${employee.id}`, {
      method: "GET",
      token: adminToken,
    });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));
    const salary = salariesResponse.json.salaries.find((item) => salaryBelongsToTimesheetMonth(item, timesheetId) && item.status === "pending");
    assert.ok(salary, `Expected pending salary for approved timesheet: ${JSON.stringify(salariesResponse.json.salaries)}`);
    assert.equal(salary.amount, 900);
    generatedSalaryId = salary.id;

    const adjustedSalaryResponse = await api(`/business/salaries/${salary.id}`, {
      method: "PATCH",
      token: adminToken,
      body: {
        ...salary,
        days: 6,
        amount: 1800,
        note: `${salary.note ?? ""} (+3 admin days)`,
      },
    });
    assert.equal(adjustedSalaryResponse.status, 200, JSON.stringify(adjustedSalaryResponse.json));

    const previewResponse = await api("/business/salary-slips/preview", {
      method: "POST",
      token: adminToken,
      body: { salaryIds: [salary.id], accountId },
    });
    assert.equal(previewResponse.status, 200, JSON.stringify(previewResponse.json));
    const draft = previewResponse.json.draft;
    assert.equal(draft.companyAddress, "Vastu Anand, Building No. 16, Parsik Nagar, Thane, Maharashtra, India");
    assert.equal(draft.totalWorkingDays, 6);
    assert.equal(draft.paidDays, 6);
    assert.deepEqual(draft.earnings, [
      { label: "Basic", amount: 1800 },
      { label: "HRA", amount: 0 },
      { label: "Conveyance Allowance", amount: 0 },
      { label: "Medical Allowance", amount: 0 },
      { label: "Other Allowances", amount: 0 },
    ]);
    assert.equal(draft.totalEarnings, 1800);
    assert.equal(draft.netSalary, 1800);

    const fundResponse = await api("/business/funds", {
      method: "POST",
      token: adminToken,
      body: {
        accountId,
        source: `Salary slip fund ${suffix}`,
        amount: 2000,
        date: "2026-07-06",
        note: "salary-slip-confirm-idempotency",
      },
    });
    assert.equal(fundResponse.status, 201, JSON.stringify(fundResponse.json));
    fundId = fundResponse.json.fund.id;

    const idempotencyKey = randomSuffix("salary-slip-confirm");
    const confirmResponse = await api("/business/salary-slips/confirm", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: draft,
    });
    assert.equal(confirmResponse.status, 201, JSON.stringify(confirmResponse.json));
    assert.equal(confirmResponse.json.duplicate, false);
    assert.equal(confirmResponse.json.salaries[0].status, "paid");
    assert.ok(confirmResponse.json.slip.id);
    assert.equal(confirmResponse.json.slip.emailStatus, "queued");
    generatedSlipId = confirmResponse.json.slip.id;

    const retryResponse = await api("/business/salary-slips/confirm", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: draft,
    });
    assert.equal(retryResponse.status, 200, JSON.stringify(retryResponse.json));
    assert.equal(retryResponse.json.duplicate, true);
    assert.equal(retryResponse.json.slip.id, generatedSlipId);
  } finally {
    if (generatedSalaryId) {
      await api(`/business/salaries/${generatedSalaryId}`, { method: "DELETE", token: adminToken });
    }
    if (fundId) {
      await api(`/business/funds/${fundId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    if (!generatedSlipId) {
      await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
    }
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

test("approved split-month timesheets create exact calendar-month payroll records", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-payroll-split-month");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const createdSalaryIds = [];
  let timesheetId = null;

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart: "2026-04-27",
        lines: [
          {
            project: "Phase 2",
            task: "Split month payroll",
            hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 4, sun: 4 },
            workNotes: {
              mon: "April work",
              tue: "April work",
              wed: "April work",
              thu: "April work",
              fri: "May work",
              sat: "May work",
              sun: "May work",
            },
          },
        ],
      },
    });
    assert.ok([200, 201].includes(createResponse.status), `Timesheet create failed: ${JSON.stringify(createResponse.json)}`);
    timesheetId = createResponse.json.timesheet.id;

    const submitResponse = await api(`/business/timesheets/${timesheetId}/submit`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(submitResponse.status, 200, JSON.stringify(submitResponse.json));

    const approveResponse = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "approved split month payroll" },
    });
    assert.equal(approveResponse.status, 200, JSON.stringify(approveResponse.json));

    const salariesResponse = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, {
      token: adminToken,
    });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const splitPayroll = salariesResponse.json.salaries.filter(
      (salary) =>
        salary.source === "timesheet" &&
        salaryBelongsToTimesheetMonth(salary, timesheetId) &&
        salary.status === "pending",
    );
    createdSalaryIds.push(...splitPayroll.map((salary) => salary.id));

    assert.equal(splitPayroll.length, 2, JSON.stringify(splitPayroll));

    const byMonth = new Map(splitPayroll.map((salary) => [payrollMonthKey(salary), salary]));
    const april = byMonth.get("2026-04");
    const may = byMonth.get("2026-05");
    assert.ok(april, JSON.stringify(splitPayroll));
    assert.ok(may, JSON.stringify(splitPayroll));

    assert.equal(april.hours, 32);
    assert.equal(april.rate, 100);
    assert.equal(april.amount, 3200);
    assert.equal(april.weekStart.slice(0, 10), "2026-04-27");

    assert.equal(may.hours, 16);
    assert.equal(may.rate, 100);
    assert.equal(may.amount, 1600);
    assert.equal(may.timesheetId, `${timesheetId}:2026-05`);
  } finally {
    for (const salaryId of createdSalaryIds) {
      await api(`/business/salaries/${salaryId}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("split-month week with hours only in the non-weekStart month creates no phantom earlier-month record", { concurrency: false }, async () => {
  // Regression: week Apr 27–May 3 where all hours fall on Sunday May 3 only.
  // weekStart is in April, but the work is entirely in May.
  // The reconciler must produce exactly one May record and zero April records.
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-may-only");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const salaryIds = [];
  let timesheetId = null;

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart: "2026-04-27",
        lines: [
          {
            project: "May Only",
            task: "Sunday work",
            hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 3 },
          },
        ],
      },
    });
    assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
    timesheetId = createResponse.json.timesheet.id;

    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: { note: "ok" } });

    // GET salaries triggers reconcileTimesheetPayroll
    const salariesResponse = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, {
      token: adminToken,
    });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const timesheetSalaries = salariesResponse.json.salaries.filter(
      (s) => salaryBelongsToTimesheetMonth(s, timesheetId) && s.status === "pending",
    );
    salaryIds.push(...timesheetSalaries.map((s) => s.id));

    assert.equal(timesheetSalaries.length, 1, `Expected 1 record, got ${timesheetSalaries.length}: ${JSON.stringify(timesheetSalaries.map((s) => payrollMonthKey(s)))}`);
    const record = timesheetSalaries[0];
    assert.equal(payrollMonthKey(record), "2026-05", `Expected May record, got ${payrollMonthKey(record)}`);
    assert.equal(record.hours, 3);
    assert.equal(record.amount, 300);
    assert.ok(String(record.timesheetId ?? "").includes(":2026-05"), `Expected scoped timesheetId, got ${record.timesheetId}`);
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("month-end submission locks the earlier month, pays it on approval, and full approval adds only the new month", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-month-end");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  // Week of Mon 28 Sep – Sun 4 Oct 2026: Mon–Wed are September, Thu–Sun are October.
  const weekStart = "2026-09-28";
  const salaryIds = [];
  let timesheetId = null;
  const linesWith = (hours) => [{ project: "Month End", task: "Split week", hours }];

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 8, wed: 8, thu: 8 }) },
    });
    assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
    timesheetId = createResponse.json.timesheet.id;

    const partialSubmit = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: employeeToken,
      body: { id: timesheetId, employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 8, wed: 8, thu: 8 }) },
    });
    assert.equal(partialSubmit.status, 200, JSON.stringify(partialSubmit.json));
    assert.equal(partialSubmit.json.timesheet.status, "draft");
    assert.equal(partialSubmit.json.timesheet.partialSubmission.status, "submitted");
    assert.equal(partialSubmit.json.timesheet.partialSubmission.throughDate, "2026-09-30");

    const editSeptember = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 5, wed: 8, thu: 8 }) },
    });
    assert.equal(editSeptember.status, 409, JSON.stringify(editSeptember.json));
    assert.match(String(editSeptember.json.message), /protected day/i);

    const editOctober = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 8, wed: 8, thu: 8, fri: 8 }) },
    });
    assert.equal(editOctober.status, 200, JSON.stringify(editOctober.json));
    assert.equal(editOctober.json.timesheet.partialSubmission.status, "submitted", "A regular save must not clear the month-end submission");

    const duplicatePartial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: employeeToken,
      body: { id: timesheetId, employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 8, wed: 8, thu: 8, fri: 8 }) },
    });
    assert.equal(duplicatePartial.status, 409, JSON.stringify(duplicatePartial.json));

    const rejectWithoutNote = await api(`/business/timesheets/${timesheetId}/month-end/reject`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(rejectWithoutNote.status, 400, JSON.stringify(rejectWithoutNote.json));

    const rejectPartial = await api(`/business/timesheets/${timesheetId}/month-end/reject`, {
      method: "POST",
      token: adminToken,
      body: { note: "Tuesday should be 6 hours" },
    });
    assert.equal(rejectPartial.status, 200, JSON.stringify(rejectPartial.json));
    assert.equal(rejectPartial.json.timesheet.partialSubmission.status, "rejected");

    const fixTuesday = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 6, wed: 8, thu: 8, fri: 8 }) },
    });
    assert.equal(fixTuesday.status, 200, `Returned days should be editable again: ${JSON.stringify(fixTuesday.json)}`);

    const resubmitPartial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: employeeToken,
      body: { id: timesheetId, employeeId: employee.id, weekStart, lines: linesWith({ mon: 8, tue: 6, wed: 8, thu: 8, fri: 8 }) },
    });
    assert.equal(resubmitPartial.status, 200, JSON.stringify(resubmitPartial.json));
    assert.equal(resubmitPartial.json.timesheet.partialSubmission.status, "submitted");

    const approvePartial = await api(`/business/timesheets/${timesheetId}/month-end/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "September closed" },
    });
    assert.equal(approvePartial.status, 200, JSON.stringify(approvePartial.json));
    assert.equal(approvePartial.json.timesheet.partialSubmission.status, "approved");
    assert.equal(approvePartial.json.timesheet.status, "draft", "The rest of the week stays open");

    const approveAgain = await api(`/business/timesheets/${timesheetId}/month-end/approve`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(approveAgain.status, 409, JSON.stringify(approveAgain.json));

    const afterPartial = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    assert.equal(afterPartial.status, 200, JSON.stringify(afterPartial.json));
    const septemberOnly = afterPartial.json.salaries.filter((s) => salaryBelongsToTimesheetMonth(s, timesheetId));
    salaryIds.push(...septemberOnly.map((s) => s.id));
    assert.equal(septemberOnly.length, 1, JSON.stringify(septemberOnly));
    const september = septemberOnly[0];
    assert.equal(september.timesheetId, `${timesheetId}:2026-09`);
    assert.equal(september.hours, 22);
    assert.equal(september.amount, 2200);

    const employeeDelete = await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: employeeToken });
    assert.equal(employeeDelete.status, 409, JSON.stringify(employeeDelete.json));

    const submitWeek = await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: employeeToken, body: {} });
    assert.equal(submitWeek.status, 200, JSON.stringify(submitWeek.json));
    assert.equal(submitWeek.json.timesheet.partialSubmission.status, "approved", "Approved month-end days stay approved");

    const approveWeek = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "week approved" },
    });
    assert.equal(approveWeek.status, 200, JSON.stringify(approveWeek.json));

    const afterFull = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const weekSalaries = afterFull.json.salaries.filter((s) => salaryBelongsToTimesheetMonth(s, timesheetId));
    salaryIds.push(...weekSalaries.map((s) => s.id).filter((id) => !salaryIds.includes(id)));
    assert.equal(weekSalaries.length, 2, JSON.stringify(weekSalaries));
    const byMonth = new Map(weekSalaries.map((s) => [payrollMonthKey(s), s]));
    assert.equal(byMonth.get("2026-09").id, september.id, "September's record is reused, not duplicated");
    assert.equal(byMonth.get("2026-09").amount, 2200);
    assert.equal(byMonth.get("2026-10").hours, 16);
    assert.equal(byMonth.get("2026-10").amount, 1600);
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("approving the full week never modifies an already-paid month-end salary", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-month-end-paid");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const weekStart = "2026-09-28";
  const lines = [{ project: "Month End", task: "Paid block", hours: { mon: 4, tue: 4, wed: 4, thu: 4 } }];
  const salaryIds = [];
  let timesheetId = null;
  let fundId = null;

  try {
    const partialSubmit = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart, lines },
    });
    assert.equal(partialSubmit.status, 201, JSON.stringify(partialSubmit.json));
    timesheetId = partialSubmit.json.timesheet.id;

    const approvePartial = await api(`/business/timesheets/${timesheetId}/month-end/approve`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(approvePartial.status, 200, JSON.stringify(approvePartial.json));

    const salaries = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const september = salaries.json.salaries.find((s) => s.timesheetId === `${timesheetId}:2026-09`);
    assert.ok(september, JSON.stringify(salaries.json.salaries));
    salaryIds.push(september.id);
    assert.equal(september.amount, 1200);

    const accountId = await getTestFinancialAccountId(adminToken);
    const fund = await api("/business/funds", {
      method: "POST",
      token: adminToken,
      body: { accountId, source: `Month-end fund ${randomSuffix("fund")}`, amount: 5000, date: "2026-09-30", note: "month-end" },
    });
    assert.equal(fund.status, 201, JSON.stringify(fund.json));
    fundId = fund.json.fund.id;

    const pay = await api(`/business/salaries/${september.id}/pay`, {
      method: "POST",
      token: adminToken,
      body: { note: "September payroll", accountId },
    });
    assert.equal(pay.status, 200, JSON.stringify(pay.json));

    const beforeFull = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const paidSeptember = beforeFull.json.salaries.find((s) => s.id === september.id);
    assert.equal(paidSeptember.status, "paid");

    const submitWeek = await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    assert.equal(submitWeek.status, 200, JSON.stringify(submitWeek.json));
    const approveWeek = await api(`/business/timesheets/${timesheetId}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "October approved" },
    });
    assert.equal(approveWeek.status, 200, JSON.stringify(approveWeek.json));

    const afterFull = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const weekSalaries = afterFull.json.salaries.filter((s) => salaryBelongsToTimesheetMonth(s, timesheetId));
    salaryIds.push(...weekSalaries.map((s) => s.id).filter((id) => !salaryIds.includes(id)));
    assert.equal(weekSalaries.length, 2, JSON.stringify(weekSalaries));

    const septemberAfter = weekSalaries.find((s) => s.id === september.id);
    assert.equal(septemberAfter.status, "paid");
    assert.equal(septemberAfter.amount, paidSeptember.amount);
    assert.equal(septemberAfter.date, paidSeptember.date);
    assert.equal(septemberAfter.paidAt, paidSeptember.paidAt);
    assert.equal(septemberAfter.note, paidSeptember.note);

    const october = weekSalaries.find((s) => payrollMonthKey(s) === "2026-10");
    assert.equal(october.status, "pending");
    assert.equal(october.hours, 4);
    assert.equal(october.amount, 400);
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    if (fundId) {
      await api(`/business/funds/${fundId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("month-end approval prorates a monthly employee's earlier month, and full approval adds the new month", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-month-end-monthly");
  // 360000 a year -> 30000 a month. September has 30 days (1000/day), October 31.
  const createdEmployee = await createMonthlyEmployee(adminToken, suffix, 360000);
  const employee = createdEmployee.user;
  const weekStart = "2026-09-28";
  const lines = [{ project: "Month End", task: "Monthly split", hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8 } }];
  const salaryIds = [];
  let timesheetId = null;

  try {
    const partialSubmit = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart, lines },
    });
    assert.equal(partialSubmit.status, 201, JSON.stringify(partialSubmit.json));
    timesheetId = partialSubmit.json.timesheet.id;

    const approvePartial = await api(`/business/timesheets/${timesheetId}/month-end/approve`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(approvePartial.status, 200, JSON.stringify(approvePartial.json));

    const afterPartial = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const partialRecords = afterPartial.json.salaries.filter((s) => s.source === "timesheet" && s.employeeId === employee.id);
    salaryIds.push(...partialRecords.map((s) => s.id));
    assert.equal(partialRecords.length, 1, JSON.stringify(partialRecords));
    assert.equal(payrollMonthKey(partialRecords[0]), "2026-09");
    assert.equal(partialRecords[0].days, 3, JSON.stringify(partialRecords[0]));
    assert.equal(partialRecords[0].amount, 3000, JSON.stringify(partialRecords[0]));

    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    const approveWeek = await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: {} });
    assert.equal(approveWeek.status, 200, JSON.stringify(approveWeek.json));

    const afterFull = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const records = afterFull.json.salaries.filter((s) => s.source === "timesheet" && s.employeeId === employee.id);
    salaryIds.push(...records.map((s) => s.id).filter((id) => !salaryIds.includes(id)));
    assert.equal(records.length, 2, JSON.stringify(records));
    const byMonth = new Map(records.map((s) => [payrollMonthKey(s), s]));
    assert.equal(byMonth.get("2026-09").days, 3);
    assert.equal(byMonth.get("2026-09").amount, 3000);
    assert.equal(byMonth.get("2026-10").days, 2);
    assert.equal(byMonth.get("2026-10").amount, Math.round((30000 / 31) * 2));
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("a pending month-end block is folded into the week when daily review auto-submits it", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-month-end-autosubmit");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const weekStart = "2026-09-28";
  const salaryIds = [];
  let timesheetId = null;

  try {
    const partialSubmit = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart,
        lines: [{ project: "Month End", task: "Auto submit", hours: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 } }],
      },
    });
    assert.equal(partialSubmit.status, 201, JSON.stringify(partialSubmit.json));
    timesheetId = partialSubmit.json.timesheet.id;

    let lastReview = null;
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      lastReview = await api(`/business/timesheets/${timesheetId}/daily-review/${day}`, {
        method: "PATCH",
        token: adminToken,
        body: { reviewed: true },
      });
      assert.equal(lastReview.status, 200, JSON.stringify(lastReview.json));
    }
    assert.equal(lastReview.json.timesheet.status, "submitted");
    assert.equal(lastReview.json.timesheet.partialSubmission ?? null, null, "The pending block is folded into the full-week review");

    const approveWeek = await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: {} });
    assert.equal(approveWeek.status, 200, JSON.stringify(approveWeek.json));

    const salaries = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    const weekSalaries = salaries.json.salaries.filter((s) => salaryBelongsToTimesheetMonth(s, timesheetId));
    salaryIds.push(...weekSalaries.map((s) => s.id));
    assert.equal(weekSalaries.length, 2, JSON.stringify(weekSalaries));
    const byMonth = new Map(weekSalaries.map((s) => [payrollMonthKey(s), s]));
    assert.equal(byMonth.get("2026-09").hours, 3);
    assert.equal(byMonth.get("2026-10").hours, 4);
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

async function timesheetSalaries(adminToken, employeeId, timesheetId) {
  const response = await api(`/business/salaries?employeeId=${encodeURIComponent(employeeId)}`, { token: adminToken });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.salaries.filter((s) => salaryBelongsToTimesheetMonth(s, timesheetId));
}

async function cleanupTimesheetTest(adminToken, { salaryIds = [], timesheetId, fundId, employeeId }) {
  for (const id of salaryIds) {
    await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
  }
  if (timesheetId) {
    await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
  }
  if (fundId) {
    await api(`/business/funds/${fundId}`, { method: "DELETE", token: adminToken });
  }
  await api(`/admin/employees/${employeeId}`, { method: "DELETE", token: adminToken });
}

async function payTestSalary(adminToken, salaryId, amount) {
  const accountId = await getTestFinancialAccountId(adminToken);
  const fund = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: { accountId, source: `Recall fund ${randomSuffix("fund")}`, amount, date: "2026-09-30", note: "recall test" },
  });
  assert.equal(fund.status, 201, JSON.stringify(fund.json));
  const pay = await api(`/business/salaries/${salaryId}/pay`, {
    method: "POST",
    token: adminToken,
    body: { note: "paid", accountId },
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  return fund.json.fund.id;
}

test("recalling an approved split-month week returns it to review and removes every pending month's salary", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employee = (await createEmployee(adminToken, randomSuffix("phase2-recall-week"))).user;
  let timesheetId = null;
  const salaryIds = [];

  try {
    const created = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart: "2026-04-27", lines: [{ project: "Recall", task: "Split", hours: { mon: 2, fri: 3 } }] },
    });
    timesheetId = created.json.timesheet.id;
    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: {} });
    const before = await timesheetSalaries(adminToken, employee.id, timesheetId);
    assert.equal(before.length, 2, JSON.stringify(before));

    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 200, JSON.stringify(recall.json));
    assert.equal(recall.json.scope, "week");
    assert.equal(recall.json.timesheet.status, "submitted");
    const after = await timesheetSalaries(adminToken, employee.id, timesheetId);
    assert.equal(after.length, 0, `Both April and May pending salaries should be removed: ${JSON.stringify(after)}`);

    const reapprove = await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: {} });
    assert.equal(reapprove.status, 200, JSON.stringify(reapprove.json));
    const recreated = await timesheetSalaries(adminToken, employee.id, timesheetId);
    salaryIds.push(...recreated.map((s) => s.id));
    assert.equal(recreated.length, 2, JSON.stringify(recreated));
  } finally {
    await cleanupTimesheetTest(adminToken, { salaryIds, timesheetId, employeeId: employee.id });
  }
});

test("approved month-end days can be recalled, returned, and re-approved", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const createdEmployee = await createEmployee(adminToken, randomSuffix("phase2-recall-month-end"));
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);
  const weekStart = "2026-09-28";
  const lines = (tue) => [{ project: "Recall", task: "Month end", hours: { mon: 8, tue, wed: 8, thu: 8 } }];
  let timesheetId = null;
  const salaryIds = [];

  try {
    const partial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: lines(8) },
    });
    assert.equal(partial.status, 201, JSON.stringify(partial.json));
    timesheetId = partial.json.timesheet.id;
    await api(`/business/timesheets/${timesheetId}/month-end/approve`, { method: "POST", token: adminToken, body: {} });
    const approved = await timesheetSalaries(adminToken, employee.id, timesheetId);
    assert.equal(approved.length, 1, JSON.stringify(approved));
    assert.equal(approved[0].amount, 2400);

    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 200, JSON.stringify(recall.json));
    assert.equal(recall.json.scope, "month_end");
    assert.equal(recall.json.timesheet.status, "draft", "The rest of the week is untouched");
    assert.equal(recall.json.timesheet.partialSubmission.status, "submitted", "Recalled days go back to pending review");
    assert.equal((await timesheetSalaries(adminToken, employee.id, timesheetId)).length, 0, "September's pending salary is removed");

    const stillLocked = await api(`/business/timesheets/${timesheetId}`, {
      method: "PATCH",
      token: employeeToken,
      body: { employeeId: employee.id, weekStart, lines: lines(6) },
    });
    assert.equal(stillLocked.status, 409, "Recalled days stay locked until the admin returns them");

    const returned = await api(`/business/timesheets/${timesheetId}/month-end/reject`, {
      method: "POST",
      token: adminToken,
      body: { note: "Tuesday should be 6 hours" },
    });
    assert.equal(returned.status, 200, JSON.stringify(returned.json));

    const fixed = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: employeeToken,
      body: { id: timesheetId, employeeId: employee.id, weekStart, lines: lines(6) },
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    await api(`/business/timesheets/${timesheetId}/month-end/approve`, { method: "POST", token: adminToken, body: {} });

    const corrected = await timesheetSalaries(adminToken, employee.id, timesheetId);
    salaryIds.push(...corrected.map((s) => s.id));
    assert.equal(corrected.length, 1, JSON.stringify(corrected));
    assert.equal(corrected[0].hours, 22);
    assert.equal(corrected[0].amount, 2200);
  } finally {
    await cleanupTimesheetTest(adminToken, { salaryIds, timesheetId, employeeId: employee.id });
  }
});

test("month-end days can't be recalled once their salary is paid", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employee = (await createEmployee(adminToken, randomSuffix("phase2-recall-paid"))).user;
  let timesheetId = null;
  let fundId = null;
  const salaryIds = [];

  try {
    const partial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart: "2026-09-28", lines: [{ project: "Recall", task: "Paid", hours: { mon: 2, thu: 2 } }] },
    });
    timesheetId = partial.json.timesheet.id;
    await api(`/business/timesheets/${timesheetId}/month-end/approve`, { method: "POST", token: adminToken, body: {} });
    const [september] = await timesheetSalaries(adminToken, employee.id, timesheetId);
    salaryIds.push(september.id);
    fundId = await payTestSalary(adminToken, september.id, 1000);

    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 409, JSON.stringify(recall.json));
    assert.match(String(recall.json.message), /already been paid/i);
    const after = await timesheetSalaries(adminToken, employee.id, timesheetId);
    assert.equal(after.find((s) => s.id === september.id)?.status, "paid");
  } finally {
    await cleanupTimesheetTest(adminToken, { salaryIds, timesheetId, fundId, employeeId: employee.id });
  }
});

test("recalling a full week also sends its approved month-end block back into review", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employee = (await createEmployee(adminToken, randomSuffix("phase2-recall-fold"))).user;
  let timesheetId = null;
  const salaryIds = [];

  try {
    const partial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart: "2026-09-28", lines: [{ project: "Recall", task: "Fold", hours: { mon: 2, thu: 3 } }] },
    });
    timesheetId = partial.json.timesheet.id;
    await api(`/business/timesheets/${timesheetId}/month-end/approve`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: {} });
    assert.equal((await timesheetSalaries(adminToken, employee.id, timesheetId)).length, 2);

    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 200, JSON.stringify(recall.json));
    assert.equal(recall.json.scope, "week");
    assert.equal(recall.json.timesheet.status, "submitted");
    assert.equal(recall.json.timesheet.partialSubmission ?? null, null);
    const after = await timesheetSalaries(adminToken, employee.id, timesheetId);
    assert.equal(after.length, 0, `September must not stay payable while the week is under correction: ${JSON.stringify(after)}`);
  } finally {
    await cleanupTimesheetTest(adminToken, { salaryIds, timesheetId, employeeId: employee.id });
  }
});

test("recalling a monthly employee's month-end days removes that month's pending salary", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employee = (await createMonthlyEmployee(adminToken, randomSuffix("phase2-recall-monthly"), 360000)).user;
  let timesheetId = null;
  const salaryIds = [];
  const monthlyRecords = async () => {
    const response = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    return response.json.salaries.filter((s) => s.source === "timesheet" && s.employeeId === employee.id);
  };

  try {
    const partial = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart: "2026-09-28", lines: [{ project: "Recall", task: "Monthly", hours: { mon: 8, tue: 8, thu: 8 } }] },
    });
    timesheetId = partial.json.timesheet.id;
    await api(`/business/timesheets/${timesheetId}/month-end/approve`, { method: "POST", token: adminToken, body: {} });
    const before = await monthlyRecords();
    assert.equal(before.length, 1, JSON.stringify(before));
    assert.equal(before[0].days, 2);

    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 200, JSON.stringify(recall.json));
    assert.equal(recall.json.scope, "month_end");
    const after = await monthlyRecords();
    salaryIds.push(...after.map((s) => s.id));
    assert.equal(after.length, 0, `September's pending monthly salary should be removed: ${JSON.stringify(after)}`);
  } finally {
    await cleanupTimesheetTest(adminToken, { salaryIds, timesheetId, employeeId: employee.id });
  }
});

test("a draft week with nothing approved can't be recalled", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const employee = (await createEmployee(adminToken, randomSuffix("phase2-recall-draft"))).user;
  let timesheetId = null;

  try {
    const created = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: { employeeId: employee.id, weekStart: "2026-09-28", lines: [{ project: "Recall", task: "Draft", hours: { mon: 2 } }] },
    });
    timesheetId = created.json.timesheet.id;
    const recall = await api(`/business/timesheets/${timesheetId}/recall`, { method: "POST", token: adminToken, body: {} });
    assert.equal(recall.status, 409, JSON.stringify(recall.json));
  } finally {
    await cleanupTimesheetTest(adminToken, { timesheetId, employeeId: employee.id });
  }
});

test("month-end submission is rejected for weeks that stay within one month", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-month-end-single");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;

  try {
    const response = await api("/business/timesheets/submit-month-end", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart: "2026-09-14",
        lines: [{ project: "Month End", task: "Single month", hours: { mon: 8 } }],
      },
    });
    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.match(String(response.json.message), /doesn't cross into a new month/i);
  } finally {
    const leftover = await api(`/business/timesheets?employeeId=${encodeURIComponent(employee.id)}`, { token: adminToken });
    for (const entry of leftover.json?.timesheets ?? []) {
      await api(`/business/timesheets/${entry.id}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("approved monthly-employee timesheet creates prorated payroll based on days worked", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-monthly-prorate");
  // Annual salary 360000 -> monthly = 30000. April has 30 days -> daily rate = 1000.
  const createdEmployee = await createMonthlyEmployee(adminToken, suffix, 360000);
  const employee = createdEmployee.user;
  const salaryIds = [];
  let timesheetId = null;

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart: "2026-04-06",
        lines: [
          {
            project: "Monthly Prorate",
            task: "Five day week",
            hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
          },
        ],
      },
    });
    assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
    timesheetId = createResponse.json.timesheet.id;

    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: { note: "ok" } });

    const salariesResponse = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, {
      token: adminToken,
    });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const timesheetSalaries = salariesResponse.json.salaries.filter(
      (s) => salaryBelongsToTimesheetMonth(s, timesheetId) && s.status === "pending",
    );
    salaryIds.push(...timesheetSalaries.map((s) => s.id));

    assert.equal(timesheetSalaries.length, 1, JSON.stringify(timesheetSalaries));
    const record = timesheetSalaries[0];
    assert.equal(payrollMonthKey(record), "2026-04");
    assert.equal(record.days, 5, JSON.stringify(record));
    assert.equal(record.amount, 5000, JSON.stringify(record));
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("split-month timesheet for monthly employee creates separate prorated records per calendar month", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-monthly-split");
  // Annual salary 360000 -> monthly = 30000. April daily rate = 1000, May daily rate ~= 967.74.
  const createdEmployee = await createMonthlyEmployee(adminToken, suffix, 360000);
  const employee = createdEmployee.user;
  const salaryIds = [];
  let timesheetId = null;

  try {
    const createResponse = await api("/business/timesheets", {
      method: "POST",
      token: adminToken,
      body: {
        employeeId: employee.id,
        weekStart: "2026-04-27",
        lines: [
          {
            project: "Monthly Split",
            task: "Split month work",
            hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
          },
        ],
      },
    });
    assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.json));
    timesheetId = createResponse.json.timesheet.id;

    await api(`/business/timesheets/${timesheetId}/submit`, { method: "POST", token: adminToken, body: {} });
    await api(`/business/timesheets/${timesheetId}/approve`, { method: "POST", token: adminToken, body: { note: "ok" } });

    const salariesResponse = await api(`/business/salaries?employeeId=${encodeURIComponent(employee.id)}`, {
      token: adminToken,
    });
    assert.equal(salariesResponse.status, 200, JSON.stringify(salariesResponse.json));

    const splitPayroll = salariesResponse.json.salaries.filter(
      (salary) => salaryBelongsToTimesheetMonth(salary, timesheetId) && salary.status === "pending",
    );
    salaryIds.push(...splitPayroll.map((salary) => salary.id));

    assert.equal(splitPayroll.length, 2, JSON.stringify(splitPayroll));

    const byMonth = new Map(splitPayroll.map((salary) => [payrollMonthKey(salary), salary]));
    const april = byMonth.get("2026-04");
    const may = byMonth.get("2026-05");
    assert.ok(april, JSON.stringify(splitPayroll));
    assert.ok(may, JSON.stringify(splitPayroll));

    // Apr 27 (Mon) - Apr 30 (Thu) = 4 days worked in April out of 30 days.
    assert.equal(april.days, 4, JSON.stringify(april));
    assert.equal(april.amount, Math.round((30000 / 30) * 4), JSON.stringify(april));

    // May 1 (Fri) = 1 day worked in May out of 31 days.
    assert.equal(may.days, 1, JSON.stringify(may));
    assert.equal(may.amount, Math.round((30000 / 31) * 1), JSON.stringify(may));
    assert.ok(String(may.timesheetId ?? "").includes(":2026-05"), `Expected scoped timesheetId, got ${may.timesheetId}`);
  } finally {
    for (const id of salaryIds) {
      await api(`/business/salaries/${id}`, { method: "DELETE", token: adminToken });
    }
    if (timesheetId) {
      await api(`/business/timesheets/${timesheetId}`, { method: "DELETE", token: adminToken });
    }
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

test("approved leave shows up as a holiday in the employee month calendar", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const suffix = randomSuffix("phase2-timesheet-approved-leave");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const employeeToken = await login(employee.email, createdEmployee.temporaryPassword);

  const leaveCreate = await api("/business/leave-requests", {
    method: "POST",
    token: employeeToken,
    body: {
      startDate: "2026-05-12",
      endDate: "2026-05-12",
      reason: "Phase 2 approved leave",
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

    const calendarResponse = await api(`/business/month-calendar?employeeId=${employee.id}&month=2026-05`, {
      method: "GET",
      token: employeeToken,
    });
    assert.equal(calendarResponse.status, 200, JSON.stringify(calendarResponse.json));

    const leaveDay = calendarResponse.json.monthCalendar.days.find((day) => day.date.startsWith("2026-05-12"));
    assert.ok(leaveDay, "Expected the month calendar to include 2026-05-12");
    assert.equal(leaveDay.holiday, true);
    assert.equal(leaveDay.holidaySource, "requested");
    assert.equal(leaveDay.timeOffSource, "employee");
    assert.equal(leaveDay.leaveStatus, "approved");
  } finally {
    await api(`/business/leave-requests/${leaveId}`, { method: "DELETE", token: adminToken });
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
  const accountId = await getTestFinancialAccountId(adminToken);
  const createdEmployee = await createEmployee(adminToken, randomSuffix("expense-review-employee"));
  const employee = createdEmployee.user;
  const today = "2026-04-11";
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
      source: `Expense review fund ${randomSuffix("fund")}`,
      amount: 100,
      date: today,
      note: "expense-review-fund",
    },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));

  const createResponse = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
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
    await api(`/business/funds/${fundCreate.json.fund.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
  }
});

test("expense review retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const accountId = await getTestFinancialAccountId(adminToken);
  const createdEmployee = await createEmployee(adminToken, randomSuffix("expense-retry-employee"));
  const employee = createdEmployee.user;
  const today = "2026-04-11";
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
      source: `Expense review fund ${randomSuffix("fund")}`,
      amount: 100,
      date: today,
      note: "expense-review-fund",
    },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));

  const createResponse = await api("/business/expenses", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
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
    await api(`/business/funds/${fundCreate.json.fund.id}`, { method: "DELETE", token: adminToken });
    await api(`/admin/employees/${employee.id}`, { method: "DELETE", token: adminToken });
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
  const accountId = await getTestFinancialAccountId(adminToken);
  const suffix = randomSuffix("salary-po-employee");
  const createdEmployee = await createEmployee(adminToken, suffix);
  const employee = createdEmployee.user;
  const salaryPayKey = randomSuffix("salary-pay");
  const poPayKey = randomSuffix("po-pay");
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
      source: `Salary payment fund ${randomSuffix("fund")}`,
      amount: 1000,
      date: "2026-04-11",
      note: "salary-payment-fund",
    },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));

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
      body: { note: "first pay", accountId },
    });
    const salaryPay2 = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { note: "first pay", accountId },
    });
    assert.equal(salaryPay1.status, 200, JSON.stringify(salaryPay1.json));
    assert.equal(salaryPay2.status, 200, JSON.stringify(salaryPay2.json));
    assert.equal(salaryPay1.json.duplicate, false);
    assert.equal(salaryPay2.json.duplicate, true);

    const salaryPayConflict = await api(`/business/salaries/${salaryId}/pay`, {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": salaryPayKey },
      body: { note: "different note", accountId },
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
    await api(`/business/funds/${fundCreate.json.fund.id}`, { method: "DELETE", token: adminToken });
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

    const holidayResponse = await api(`/business/timesheets/${timesheetId}/daily-review/tue`, {
      method: "PATCH",
      token: adminToken,
      body: { action: "holiday" },
    });
    assert.equal(holidayResponse.status, 200, JSON.stringify(holidayResponse.json));
    assert.equal(holidayResponse.json.timesheet.dailyReviewHolidays.tue, true);

    const listResponse = await api("/business/timesheets", {
      method: "GET",
      token: adminToken,
    });
    assert.equal(listResponse.status, 200, JSON.stringify(listResponse.json));
    const listedShell = listResponse.json.timesheets.find((entry) => entry.id === timesheetId);
    assert.ok(listedShell, "protected empty review shell should stay visible in the timesheet list");
    assert.equal(listedShell.dailyReviewLocks.mon, true);
    assert.equal(listedShell.dailyReviewHolidays.tue, true);

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

test("historical expense create retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const accountId = await getTestFinancialAccountId(adminToken);
  const createdEmployee = await createEmployee(adminToken, randomSuffix("expense-historical-employee"));
  const employee = createdEmployee.user;
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
      source: `Historical expense fund ${randomSuffix("fund")}`,
      amount: 500,
      date: "2026-04-11",
      note: "historical-expense-fund",
    },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));

  const createKey = randomSuffix("historical-expense-create");
  const createPayload = {
    accountId,
    employeeId: employee.id,
    employeeNameSnapshot: employee.name,
    category: `Historical Expense ${randomSuffix("category")}`,
    group: "office",
    amount: 25,
    date: "2026-04-11",
    description: "Historical expense backfill",
    note: "historical-expense-create",
  };
  const createResponse1 = await api("/business/expenses/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const expenseId = createResponse1.json.expense.id;

  const createResponse2 = await api("/business/expenses/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.expense.id, expenseId);

  const createConflict = await api("/business/expenses/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, amount: 26 },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  try {
    await api(`/business/expenses/${expenseId}`, { method: "DELETE", token: adminToken });
  } finally {
    await api(`/business/funds/${fundCreate.json.fund.id}`, { method: "DELETE", token: adminToken });
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

test("historical salary create retries stay idempotent with key reuse protection", { concurrency: false }, async () => {
  const adminToken = await login("admin@yojak.in", "yojak123");
  const accountId = await getTestFinancialAccountId(adminToken);
  const fundCreate = await api("/business/funds", {
    method: "POST",
    token: adminToken,
    body: {
      accountId,
      source: `Historical salary fund ${randomSuffix("fund")}`,
      amount: 1000,
      date: "2026-04-11",
      note: "historical-salary-fund",
    },
  });
  assert.equal(fundCreate.status, 201, JSON.stringify(fundCreate.json));

  const createKey = randomSuffix("historical-salary-create");
  const createPayload = {
    accountId,
    employeeNameSnapshot: `Former Employee ${randomSuffix("salary")}`,
    amount: 320,
    date: "2026-04-11",
    note: "historical-salary-create",
  };
  const createResponse1 = await api("/business/salaries/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse1.status, 201, JSON.stringify(createResponse1.json));
  assert.equal(createResponse1.json.duplicate, false);
  const salaryId = createResponse1.json.salary.id;
  assert.equal(createResponse1.json.salary.status, "paid");
  assert.equal(createResponse1.json.salary.employeeId ?? null, null);

  const createResponse2 = await api("/business/salaries/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: createPayload,
  });
  assert.equal(createResponse2.status, 200, JSON.stringify(createResponse2.json));
  assert.equal(createResponse2.json.duplicate, true);
  assert.equal(createResponse2.json.salary.id, salaryId);

  const createConflict = await api("/business/salaries/historical", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": createKey },
    body: { ...createPayload, amount: 321 },
  });
  assert.equal(createConflict.status, 409, JSON.stringify(createConflict.json));

  try {
    await api(`/business/salaries/${salaryId}`, { method: "DELETE", token: adminToken });
  } finally {
    await api(`/business/funds/${fundCreate.json.fund.id}`, { method: "DELETE", token: adminToken });
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
