import test from "node:test";
import assert from "node:assert/strict";

const rowsModuleUrl = new URL("../dist/integrations/googleSheets/sheets.rows.mjs", import.meta.url).href;
const { buildDailyReviewRowsFromReviewedDay } = await import(rowsModuleUrl);

// weekStart: 2026-05-11 (Monday).
//   mon = May 11 → tab "Daily Reviews - May 2026"
//   thu = May 14 → tab "Daily Reviews - May 2026"

function makeReviewedDayEvent() {
  return {
    tenantId: "tenant-test",
    employee: {
      name: "Alex Johnson",
      department: "Engineering",
    },
    reviewedBy: {
      name: "Admin User",
      userId: "admin-1",
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
            mon: "Smoke testing",
            wed: "Regression testing",
            sat: "Release checks",
          },
        },
      ],
    },
  };
}

test("daily review routes to the month-specific tab", () => {
  const rows = buildDailyReviewRowsFromReviewedDay(makeReviewedDayEvent());
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.tabName, "Daily Reviews - May 2026");
  }
});

test("daily review builds one row per task line with hours on that day", () => {
  const rows = buildDailyReviewRowsFromReviewedDay(makeReviewedDayEvent());

  // Monday: Alpha 3h, Beta 2h → 2 rows
  assert.equal(rows.length, 2);

  assert.equal(rows[0].project, "Project Alpha");
  assert.equal(rows[0].task, "Implementation");
  assert.equal(rows[0].hours, 3);
  assert.equal(rows[0].workNote, "API integration");
  assert.equal(rows[0].employeeName, "Alex Johnson");
  assert.equal(rows[0].department, "Engineering");
  assert.equal(rows[0].approvedBy, "Admin User");

  assert.equal(rows[1].project, "Project Beta");
  assert.equal(rows[1].task, "QA");
  assert.equal(rows[1].hours, 2);
  assert.equal(rows[1].workNote, "Smoke testing");
});

test("daily review falls back to a single placeholder row for a day with no hours", () => {
  const rows = buildDailyReviewRowsFromReviewedDay({
    ...makeReviewedDayEvent(),
    day: "thu",
  });

  // Thursday: Alpha 0h, Beta 0h, no work notes → fallback row
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tabName, "Daily Reviews - May 2026");
  assert.equal(rows[0].hours, 0);
  assert.equal(rows[0].project, "—");
  assert.equal(rows[0].task, "—");
  assert.equal(rows[0].workNote, "");
});

test("cross-month week: Saturday routes to the July tab", () => {
  // Week starting June 29 (Mon) — Saturday July 4 falls in July
  const event = {
    ...makeReviewedDayEvent(),
    day: "sat",
    timesheet: {
      ...makeReviewedDayEvent().timesheet,
      weekStart: "2026-06-29",
      lines: [
        {
          project: "Cross-Month",
          task: "Work",
          hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 4, sun: 0 },
          workNotes: { sat: "Saturday work" },
        },
      ],
    },
  };
  const rows = buildDailyReviewRowsFromReviewedDay(event);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].tabName, "Daily Reviews - Jul 2026");
});

test("cross-month week: Monday routes to the June tab", () => {
  const event = {
    ...makeReviewedDayEvent(),
    day: "mon",
    timesheet: {
      ...makeReviewedDayEvent().timesheet,
      weekStart: "2026-06-29",
      lines: [
        {
          project: "Cross-Month",
          task: "Work",
          hours: { mon: 3, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
          workNotes: { mon: "Monday work" },
        },
      ],
    },
  };
  const rows = buildDailyReviewRowsFromReviewedDay(event);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].tabName, "Daily Reviews - Jun 2026");
});

test("daily review returns empty array when reviewer name is missing", () => {
  const event = {
    ...makeReviewedDayEvent(),
    employee: null,
    reviewedBy: { name: "" },
    timesheet: { ...makeReviewedDayEvent().timesheet, employeeNameSnapshot: "" },
  };
  const rows = buildDailyReviewRowsFromReviewedDay(event);
  assert.equal(rows.length, 0);
});
