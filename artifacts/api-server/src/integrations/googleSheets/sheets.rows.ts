import { DAY_KEYS, type DayKey, type TimesheetTaskLine } from "../../lib/business-store";
import type { TimesheetApprovedEvent, TimesheetDayReviewedEvent } from "../../lib/events";
import type { DailyReviewRowInput, WeeklyApprovalRowInput } from "./sheets.service";

const DAY_OFFSETS: Record<DayKey, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

function weekRangeLabel(weekStart: string): string {
  const start = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };
  return `${start.toLocaleDateString("en-IN", opts)} - ${end.toLocaleDateString("en-IN", opts)}`;
}

function dayDateLabel(weekStart: string, day: DayKey): string {
  const d = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DAY_OFFSETS[day]);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatApprovedAt(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function lineHoursForDay(line: TimesheetTaskLine, day: DayKey): number {
  return Number(line.hours[day] ?? 0);
}

function lineWorkNoteForDay(line: TimesheetTaskLine, day: DayKey): string {
  return line.workNotes?.[day]?.trim() ?? "";
}

function weeklyLineWorkNote(line: TimesheetTaskLine): string {
  return Array.from(
    new Set(
      DAY_KEYS.map((day) => line.workNotes?.[day]?.trim()).filter((n): n is string => Boolean(n)),
    ),
  ).join("\n");
}

type EventBase =
  | Pick<TimesheetApprovedEvent, "employee" | "approvedBy" | "timesheet">
  | Pick<TimesheetDayReviewedEvent, "employee" | "reviewedBy" | "timesheet" | "reviewedAt">;

function buildBase(event: EventBase) {
  const employeeName = event.employee?.name?.trim() || event.timesheet.employeeNameSnapshot?.trim();
  const department = event.employee?.department?.trim() || "Unassigned";
  const approvedBy = "approvedBy" in event ? event.approvedBy.name.trim() : event.reviewedBy.name.trim();
  const rawApprovedAt =
    "approvedBy" in event
      ? event.timesheet.reviewedAt?.trim() || new Date().toISOString()
      : event.reviewedAt.trim();
  const approvedAt = formatApprovedAt(rawApprovedAt);
  const week = weekRangeLabel(event.timesheet.weekStart);

  if (!employeeName || !approvedBy || !week) {
    return null;
  }

  return { employeeName, department, approvedBy, approvedAt, week };
}

export function buildDailyReviewRowsFromReviewedDay(event: TimesheetDayReviewedEvent): DailyReviewRowInput[] {
  const base = buildBase(event);
  if (!base) {
    return [];
  }

  const date = dayDateLabel(event.timesheet.weekStart, event.day);

  const taskRows: DailyReviewRowInput[] = event.timesheet.lines
    .filter((line) => lineHoursForDay(line, event.day) > 0 || lineWorkNoteForDay(line, event.day))
    .map((line) => ({
      tabName: "Daily Reviews" as const,
      ...base,
      date,
      project: line.project?.trim() || "—",
      task: line.task?.trim() || "—",
      description: line.notes?.trim() || "",
      hours: lineHoursForDay(line, event.day),
      workNote: lineWorkNoteForDay(line, event.day),
    }));

  if (taskRows.length === 0) {
    return [
      {
        tabName: "Daily Reviews" as const,
        ...base,
        date,
        project: "—",
        task: "—",
        description: "",
        hours: 0,
        workNote: "",
      },
    ];
  }

  return taskRows;
}

export function buildWeeklyApprovalRows(event: TimesheetApprovedEvent): WeeklyApprovalRowInput[] {
  if (event.timesheet.status !== "approved") {
    return [];
  }

  const base = buildBase(event);
  if (!base) {
    return [];
  }

  const rows: WeeklyApprovalRowInput[] = [];

  for (const line of event.timesheet.lines) {
    const project = line.project?.trim();
    const task = line.task?.trim();
    const totalHours = DAY_KEYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);

    if (!project || !task || totalHours <= 0) {
      continue;
    }

    rows.push({
      tabName: "Weekly Approvals" as const,
      ...base,
      project,
      task,
      totalHours,
      workNote: weeklyLineWorkNote(line),
    });
  }

  return rows;
}
