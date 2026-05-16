import { appEvents, type TimesheetApprovedEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { appendTimesheetRow, isGoogleSheetsEnabledForTenant } from "./sheets.service";
import { buildDailyReviewRowsFromApprovedTimesheet, buildWeeklyApprovalRows } from "./sheets.rows";

async function handleTimesheetApproved(event: TimesheetApprovedEvent) {
  if (!(await isGoogleSheetsEnabledForTenant(event.tenantId))) {
    return;
  }

  const weeklyRows = buildWeeklyApprovalRows(event);
  const dailyRows = buildDailyReviewRowsFromApprovedTimesheet(event);

  if (weeklyRows.length === 0 && dailyRows.length === 0) {
    logger.warn({ timesheetId: event.timesheet.id, tenantId: event.tenantId }, "Skipping Google Sheets sync for empty approved timesheet");
    return;
  }

  try {
    for (const row of [...weeklyRows, ...dailyRows]) {
      await appendTimesheetRow(row);
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
