import test from "node:test";
import assert from "node:assert/strict";

const rowsModuleUrl = new URL("../dist/integrations/googleSheets/sheets.rows.mjs", import.meta.url).href;
const { buildDailyReviewRowFromReviewedDay, buildWeeklyApprovalRows } = await import(rowsModuleUrl);

function makeReviewedDayEvent() {
  return {
    tenantId: "tenant-test",
    employee: {
      name: "Alex Johnson",
      department: "Engineering",
    },
    reviewedBy: {
      name: "Admin User",
    },
    reviewedAt: "2026-05-13T10:15:00.000Z",
    day: "mon",
    timesheet: {
      id: "ts-1",
      employeeId: "emp-1",
      weekStart: "2026-05-11",
      employeeNameSnapshot: "Alex Johnson",
      lines: [
        {
          project: "Project Alpha",
          task: "Implementation",
          hours: { mon: 3, tue: 1, wed: 0, thu: 0, fri: 2, sat: 0, sun: 0 },
          workNotes: {
            mon: "API integration",
            tue: "Bug fixes",
            fri: "Weekly handoff",
          },
        },
        {
          project: "Project Beta",
          task: "QA",
          hours: { mon: 2, tue: 0, wed: 4, thu: 0, fri: 0, sat: 1, sun: 0 },
          workNotes: {
            mon: "API integration",
            wed: "Regression testing",
            sat: "Release checks",
          },
        },
      ],
    },
  };
}

function makeApprovedEvent() {
  return {
    tenantId: "tenant-test",
    employee: {
      name: "Alex Johnson",
      department: "Engineering",
    },
    approvedBy: {
      name: "Admin User",
    },
    timesheet: {
      id: "ts-1",
      status: "approved",
      weekStart: "2026-05-11",
      reviewedAt: "2026-05-13T10:15:00.000Z",
      employeeNameSnapshot: "Alex Johnson",
      lines: [
        {
          project: "Project Alpha",
          task: "Implementation",
          hours: { mon: 3, tue: 1, wed: 0, thu: 0, fri: 2, sat: 0, sun: 0 },
          workNotes: {
            mon: "API integration",
            tue: "Bug fixes",
            fri: "Weekly handoff",
          },
        },
        {
          project: "Project Beta",
          task: "QA",
          hours: { mon: 2, tue: 0, wed: 4, thu: 0, fri: 0, sat: 1, sun: 0 },
          workNotes: {
            mon: "API integration",
            wed: "Regression testing",
            sat: "Release checks",
          },
        },
        {
          project: "Project Gamma",
          task: "",
          hours: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
          workNotes: {},
        },
      ],
    },
  };
}

test("daily review builds one row for the reviewed day", () => {
  const row = buildDailyReviewRowFromReviewedDay(makeReviewedDayEvent());

  assert.ok(row);
  assert.equal(row?.tabName, "Daily Reviews");
  assert.equal(row?.task, "Monday verification");
  assert.equal(row?.totalHours, 5);
  assert.equal(row?.workNote, "API integration");
});

test("daily review still builds a row for an empty reviewed day", () => {
  const row = buildDailyReviewRowFromReviewedDay({
    ...makeReviewedDayEvent(),
    day: "thu",
  });

  assert.ok(row);
  assert.equal(row?.tabName, "Daily Reviews");
  assert.equal(row?.task, "Thursday verification");
  assert.equal(row?.totalHours, 0);
  assert.equal(row?.workNote, "");
});

test("weekly approval summary rows stay line-based and skip incomplete tasks", () => {
  const rows = buildWeeklyApprovalRows(makeApprovedEvent());

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => ({
      project: row.project,
      task: row.task,
      totalHours: row.totalHours,
      tabName: row.tabName,
    })),
    [
      {
        project: "Project Alpha",
        task: "Implementation",
        totalHours: 6,
        tabName: "Weekly Approvals",
      },
      {
        project: "Project Beta",
        task: "QA",
        totalHours: 7,
        tabName: "Weekly Approvals",
      },
    ],
  );
});
