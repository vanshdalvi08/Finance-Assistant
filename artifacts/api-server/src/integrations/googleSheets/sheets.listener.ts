import { DAY_KEYS, type TimesheetTaskLine } from "../../lib/business-store";
import { appEvents, type TimesheetApprovedEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { appendTimesheetRow, isGoogleSheetsEnabledForTenant } from "./sheets.service";

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

function hasApprovedWork(event: TimesheetApprovedEvent) {
  return event.timesheet.lines.some((line) => DAY_KEYS.some((day) => Number(line.hours[day] ?? 0) > 0));
}

async function handleTimesheetApproved(event: TimesheetApprovedEvent) {
  if (event.timesheet.status !== "approved") {
    return;
  }

  if (!(await isGoogleSheetsEnabledForTenant(event.tenantId))) {
    return;
  }

  if (!hasApprovedWork(event)) {
    logger.warn({ timesheetId: event.timesheet.id, tenantId: event.tenantId }, "Skipping Google Sheets sync for empty approved timesheet");
    return;
  }

  const employeeName = event.employee?.name?.trim() || event.timesheet.employeeNameSnapshot?.trim();
  const department = event.employee?.department?.trim() || "Unassigned";
  const approvedBy = event.approvedBy.name.trim();
  const week = weekRangeLabel(event.timesheet.weekStart);
  const approvedAt = event.timesheet.reviewedAt?.trim() || new Date().toISOString();

  if (!employeeName || !approvedBy || !week || !approvedAt) {
    logger.warn(
      {
        tenantId: event.tenantId,
        timesheetId: event.timesheet.id,
        employeeName,
        approvedBy,
        week,
        approvedAt,
      },
      "Skipping Google Sheets sync because approved timesheet data is incomplete",
    );
    return;
  }

  try {
    for (const line of event.timesheet.lines) {
      const project = line.project?.trim() || "";
      const task = line.task?.trim() || "";
      const workNote = line.notes?.trim() || "";
      const totalHours = lineHours(line);

      if (!project || !task || totalHours <= 0) {
        continue;
      }

      await appendTimesheetRow({
        employeeName,
        department,
        project,
        task,
        workNote,
        week,
        totalHours,
        approvedBy,
        approvedAt,
      });
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        tenantId: event.tenantId,
        timesheetId: event.timesheet.id,
      },
      "Google Sheets append failed after timesheet approval",
    );
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __timesheetGoogleSheetsListenerRegistered__: boolean | undefined;
}

if (!globalThis.__timesheetGoogleSheetsListenerRegistered__) {
  globalThis.__timesheetGoogleSheetsListenerRegistered__ = true;
  appEvents.on("timesheet_approved", (event) => {
    void handleTimesheetApproved(event);
  });
}

export {};
