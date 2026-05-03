import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { companySettingsTable } from "@workspace/db/schema";
import { logger } from "../../lib/logger";
import { optionalEnv } from "../../lib/env";

export interface AppendTimesheetRowInput {
  employeeName: string;
  department: string;
  project: string;
  task: string;
  workNote: string;
  week: string;
  totalHours: number;
  approvedBy: string;
  approvedAt: string;
}

interface GoogleServiceAccountCredentials {
  client_email?: string;
  private_key?: string;
}

function readGoogleSheetsEnv() {
  const credentialsJson = optionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON")?.trim();
  const spreadsheetId = optionalEnv("GOOGLE_SHEET_ID")?.trim();

  if (!credentialsJson || !spreadsheetId) {
    return null;
  }

  let parsed: GoogleServiceAccountCredentials;
  try {
    parsed = JSON.parse(credentialsJson) as GoogleServiceAccountCredentials;
  } catch (error) {
    logger.error({ err: error }, "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON");
    return null;
  }

  if (!parsed.client_email || !parsed.private_key) {
    logger.error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
    return null;
  }

  return {
    spreadsheetId,
    credentials: {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    },
  };
}

export async function isGoogleSheetsEnabledForTenant(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ data: companySettingsTable.data })
    .from(companySettingsTable)
    .where(eq(companySettingsTable.tenantId, tenantId))
    .limit(1);

  const settings = rows[0]?.data as { googleSheetsEnabled?: unknown } | undefined;
  return settings?.googleSheetsEnabled === true;
}

function normalizeAppendPayload(input: AppendTimesheetRowInput) {
  const employeeName = input.employeeName.trim();
  const department = input.department.trim();
  const project = input.project.trim();
  const task = input.task.trim();
  const workNote = input.workNote.trim();
  const week = input.week.trim();
  const approvedBy = input.approvedBy.trim();
  const approvedAt = input.approvedAt.trim();
  const totalHours = Number(input.totalHours ?? 0);

  if (!employeeName || !department || !project || !task || !week || !approvedBy || !approvedAt || !Number.isFinite(totalHours)) {
    return null;
  }

  return {
    employeeName,
    department,
    project,
    task,
    workNote,
    week,
    totalHours: Number(totalHours.toFixed(2)),
    approvedBy,
    approvedAt,
  };
}

export async function appendTimesheetRow(input: AppendTimesheetRowInput): Promise<boolean> {
  const env = readGoogleSheetsEnv();
  if (!env) {
    logger.warn("Skipping Google Sheets append because Google Sheets credentials are not configured");
    return false;
  }

  const row = normalizeAppendPayload(input);
  if (!row) {
    logger.warn({ payload: input }, "Skipping Google Sheets append because timesheet row payload is incomplete");
    return false;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: env.credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.spreadsheetId,
    range: "Sheet1!A:I",
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          row.employeeName,
          row.department,
          row.project,
          row.task,
          row.workNote,
          row.week,
          row.totalHours,
          row.approvedBy,
          row.approvedAt,
        ],
      ],
    },
  });

  return true;
}
