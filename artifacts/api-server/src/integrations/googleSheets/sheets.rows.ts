import { DAY_KEYS, type DayKey, type TimesheetTaskLine } from "../../lib/business-store";
import type { TimesheetApprovedEvent, TimesheetDayReviewedEvent } from "../../lib/events";
import type { AppendTimesheetRowInput } from "./sheets.service";

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function weekRangeLabel(weekStart: string) {
  const start = new Date(weekStart);
  const end = new Date(weekStart);
  end.setUTCDate(start.getUTCDate() + 6);
  const startLabel = start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const endLabel = end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function lineHours(line: TimesheetTaskLine) {
  return DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
}

function summarizeDayWorkNotes(lines: TimesheetTaskLine[], day: DayKey) {
  const notes = lines
    .map((line) => line.workNotes?.[day]?.trim())
    .filter((note): note is string => Boolean(note));

  if (notes.length === 0) {
    return "";
  }

  return Array.from(new Set(notes)).join("\n");
}

function hasApprovedWork(event: TimesheetApprovedEvent) {
  return event.timesheet.lines.some((line) => DAY_KEYS.some((day) => Number(line.hours[day] ?? 0) > 0));
}

function buildApprovalRowBase(event: Pick<TimesheetApprovedEvent, "employee" | "approvedBy" | "timesheet"> | Pick<TimesheetDayReviewedEvent, "employee" | "reviewedBy" | "timesheet" | "reviewedAt">) {
  const employeeName = event.employee?.name?.trim() || event.timesheet.employeeNameSnapshot?.trim();
  const department = event.employee?.department?.trim() || "Unassigned";
  const approvedBy = "approvedBy" in event ? event.approvedBy.name.trim() : event.reviewedBy.name.trim();
  const approvedAt = "approvedBy" in event ? event.timesheet.reviewedAt?.trim() || new Date().toISOString() : event.reviewedAt.trim();
  const week = weekRangeLabel(event.timesheet.weekStart);

  if (!employeeName || !approvedBy || !approvedAt || !week) {
    return null;
  }

  return {
    employeeName,
    department,
    approvedBy,
    approvedAt,
    week,
  };
}

export function buildWeeklyApprovalRows(event: TimesheetApprovedEvent): AppendTimesheetRowInput[] {
  if (event.timesheet.status !== "approved" || !hasApprovedWork(event)) {
    return [];
  }

  const base = buildApprovalRowBase(event);
  if (!base) {
    return [];
  }

  return event.timesheet.lines.flatMap((line) => {
    const project = line.project?.trim() || "";
    const task = line.task?.trim() || "";
    const totalHours = lineHours(line);

    if (!project || !task || totalHours <= 0) {
      return [];
    }

    return [
      {
        ...base,
        project,
        task,
        workNote: "",
        totalHours,
        tabName: "Weekly Approvals",
      },
    ];
  });
}

export function buildDailyReviewRowFromReviewedDay(event: TimesheetDayReviewedEvent): AppendTimesheetRowInput | null {
  const base = buildApprovalRowBase(event);
  if (!base) {
    return null;
  }

  const totalHours = event.timesheet.lines.reduce((sum, line) => sum + Number(line.hours[event.day] ?? 0), 0);
  const workNote = summarizeDayWorkNotes(event.timesheet.lines, event.day);

  return {
    ...base,
    project: "Daily Review",
    task: `${DAY_LABELS[event.day]} verification`,
    workNote,
    totalHours,
    tabName: "Daily Reviews",
  };
}

export function buildDailyReviewRowsFromApprovedTimesheet(event: TimesheetApprovedEvent): AppendTimesheetRowInput[] {
  if (event.timesheet.status !== "approved" || !hasApprovedWork(event)) {
    return [];
  }

  const base = buildApprovalRowBase(event);
  if (!base) {
    return [];
  }

  return DAY_KEYS.map((day) => ({
    ...base,
    project: "Daily Review",
    task: `${DAY_LABELS[day]} verification`,
    workNote: summarizeDayWorkNotes(event.timesheet.lines, day),
    totalHours: event.timesheet.lines.reduce((sum, line) => sum + Number(line.hours[day] ?? 0), 0),
    tabName: "Daily Reviews",
  }));
}
