import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable } from "@workspace/db/schema";
import { appEvents, type TimesheetApprovedEvent, type TimesheetDayReviewedEvent } from "../../lib/events";
import { readStore } from "../../lib/business-store";
import { logger } from "../../lib/logger";
import { hashSha256 } from "../../lib/security";
import { appendTimesheetRow, isGoogleSheetsEnabledForTenant } from "./sheets.service";
import { buildDailyReviewRowsFromReviewedDay, buildWeeklyApprovalRows } from "./sheets.rows";

async function buildTaskDescriptionLookup(): Promise<Map<string, string>> {
  const store = await readStore();
  const map = new Map<string, string>();
  for (const budget of store.projectBudgets) {
    for (const task of budget.tasks) {
      if (task.description?.trim()) {
        map.set(task.id, task.description.trim());
      }
    }
  }
  return map;
}

async function claimDailyReviewExportIdempotency(event: TimesheetDayReviewedEvent, requestHash: string) {
  // Include reviewedAt in the key so each distinct review action (including re-reviews after a revert)
  // gets its own idempotency slot, while retries of the same action are still deduplicated.
  const key = `timesheet-daily-review-sheet:${event.timesheet.id}:${event.day}:${event.reviewedAt}`;
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: `idem_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
      tenantId: event.tenantId,
      scope: "timesheet_daily_review_sheet",
      keyHash,
      requestHash,
      status: "processing",
      createdById: event.reviewedBy.userId ?? null,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .returning();

  if (insertedRows[0]) {
    return { row: insertedRows[0], created: true };
  }

  const existingRows = await db
    .select()
    .from(idempotencyKeysTable)
    .where(
      and(
        eq(idempotencyKeysTable.tenantId, event.tenantId),
        eq(idempotencyKeysTable.scope, "timesheet_daily_review_sheet"),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new Error("Unable to acquire idempotency lock for this timesheet day review export.");
  }
  if (row.requestHash !== requestHash) {
    throw new Error("This idempotency key is already used for a different timesheet day review export payload.");
  }

  return { row, created: false };
}

async function handleTimesheetApproved(event: TimesheetApprovedEvent) {
  if (!(await isGoogleSheetsEnabledForTenant(event.tenantId))) {
    return;
  }

  const weeklyRows = buildWeeklyApprovalRows(event);

  if (weeklyRows.length === 0) {
    logger.warn({ timesheetId: event.timesheet.id, tenantId: event.tenantId }, "Skipping Google Sheets sync for empty approved timesheet");
    return;
  }

  try {
    for (const row of weeklyRows) {
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

async function handleTimesheetDayReviewed(event: TimesheetDayReviewedEvent) {
  if (!(await isGoogleSheetsEnabledForTenant(event.tenantId))) {
    return;
  }

  const taskDescriptions = await buildTaskDescriptionLookup();
  const rows = buildDailyReviewRowsFromReviewedDay(event, taskDescriptions);
  if (rows.length === 0) {
    return;
  }

  const requestHash = hashSha256(
    JSON.stringify({
      timesheetId: event.timesheet.id,
      day: event.day,
      reviewedAt: event.reviewedAt,
      employeeId: event.timesheet.employeeId,
      rowCount: rows.length,
      projects: rows.map((r) => r.project),
    }),
  );

  const idempotencyClaim = await claimDailyReviewExportIdempotency(event, requestHash);
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      return;
    }
    logger.warn(
      { timesheetId: event.timesheet.id, tenantId: event.tenantId, day: event.day },
      "Skipping Google Sheets sync because a daily review export is already in progress",
    );
    return;
  }

  try {
    for (const row of rows) {
      await appendTimesheetRow(row);
    }
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: event.timesheet.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    logger.error(
      {
        err: error,
        tenantId: event.tenantId,
        timesheetId: event.timesheet.id,
        day: event.day,
      },
      "Google Sheets daily review append failed",
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
  appEvents.on("timesheet_day_reviewed", (event) => {
    void handleTimesheetDayReviewed(event);
  });
}

export {};
