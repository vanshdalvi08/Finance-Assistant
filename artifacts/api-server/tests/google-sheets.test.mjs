import test from "node:test";
import assert from "node:assert/strict";

const rowsModuleUrl = new URL("../dist/integrations/googleSheets/sheets.rows.mjs", import.meta.url).href;
const {
  buildDailyReviewRowsFromApprovedTimesheet,
  buildWeeklyApprovalRows,
} = await import(rowsModuleUrl);

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

test("weekly approval builds seven daily review rows for one full export", () => {
  const rows = buildDailyReviewRowsFromApprovedTimesheet(makeApprovedEvent());

  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.tabName === "Daily Reviews"));

  assert.deepEqual(
    rows.map((row) => ({ task: row.task, totalHours: row.totalHours })),
    [
      { task: "Monday verification", totalHours: 6 },
      { task: "Tuesday verification", totalHours: 2 },
      { task: "Wednesday verification", totalHours: 5 },
      { task: "Thursday verification", totalHours: 1 },
      { task: "Friday verification", totalHours: 3 },
      { task: "Saturday verification", totalHours: 2 },
      { task: "Sunday verification", totalHours: 1 },
    ],
  );

  assert.equal(rows[0].workNote, "API integration");
  assert.equal(rows[2].workNote, "Regression testing");
  assert.equal(rows[6].workNote, "");
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
