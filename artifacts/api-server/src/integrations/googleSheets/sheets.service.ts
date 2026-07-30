import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { companySettingsTable } from "@workspace/db/schema";
import { logger } from "../../lib/logger";
import { optionalEnv } from "../../lib/env";

export interface DailyReviewRowInput {
  tabName: string; // e.g. "Daily Reviews - Jul 2026"
  employeeName: string;
  department: string;
  date: string;
  week: string;
  project: string;
  task: string;
  description: string;
  hours: number;
  workNote: string;
  approvedBy: string;
  approvedAt: string;
}

export type AppendTimesheetRowInput = DailyReviewRowInput;

const TAB_HEADERS: Record<string, string[]> = {
  "Daily Reviews": [
    "Employee Name",
    "Department",
    "Date",
    "Week",
    "Project",
    "Task",
    "Description",
    "Hours",
    "Work Note",
    "Approved By",
    "Approved At",
  ],
};

function buildRowValues(input: AppendTimesheetRowInput): unknown[] {
  return [
    input.employeeName,
    input.department,
    input.date,
    input.week,
    input.project,
    input.task,
    input.description,
    input.hours,
    input.workNote,
    input.approvedBy,
    input.approvedAt,
  ];
}

function getHeadersForTab(tabName: string): string[] | undefined {
  for (const key of Object.keys(TAB_HEADERS)) {
    if (tabName.startsWith(key)) return TAB_HEADERS[key];
  }
  return undefined;
}

function tabRange(tabName: string): string {
  const headers = getHeadersForTab(tabName);
  if (!headers || headers.length === 0) return "A:J";
  return `A:${String.fromCharCode(64 + headers.length)}`;
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
  // If credentials are not configured, there is nothing to enable.
  if (!readGoogleSheetsEnv()) {
    return false;
  }

  const rows = await db
    .select({ data: companySettingsTable.data })
    .from(companySettingsTable)
    .where(eq(companySettingsTable.tenantId, tenantId))
    .limit(1);

  const settings = rows[0]?.data as { googleSheetsEnabled?: unknown } | undefined;
  // Opt-out model: enabled by default when credentials are present unless explicitly disabled in DB.
  return settings?.googleSheetsEnabled !== false;
}

function escapeSheetName(sheetName: string) {
  const trimmed = sheetName.trim();
  return `'${trimmed.replace(/'/g, "''")}'`;
}

async function ensureWorksheetExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const trimmedSheetName = sheetName.trim();
  if (!trimmedSheetName || trimmedSheetName === "Sheet1") {
    return;
  }

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const existingSheet = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === trimmedSheetName);

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: trimmedSheetName,
              },
            },
          },
        ],
      },
    });
  }

  // Always write the correct header row (row 1), whether the sheet was just created or
  // already existed with stale headers from a previous schema version.
  const headers = getHeadersForTab(trimmedSheetName);
  if (headers && headers.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetName(trimmedSheetName)}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });
  }
}

export async function appendTimesheetRow(input: AppendTimesheetRowInput): Promise<boolean> {
  const env = readGoogleSheetsEnv();
  if (!env) {
    logger.warn("Skipping Google Sheets append because Google Sheets credentials are not configured");
    return false;
  }

  const employeeName = input.employeeName.trim();
  const approvedBy = input.approvedBy.trim();
  const week = input.week.trim();

  if (!employeeName || !approvedBy || !week) {
    logger.warn({ payload: input }, "Skipping Google Sheets append because required fields are missing");
    return false;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: env.credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const tabName = input.tabName;

  await ensureWorksheetExists(sheets, env.spreadsheetId, tabName);

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.spreadsheetId,
    range: `${escapeSheetName(tabName)}!${tabRange(tabName)}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [buildRowValues(input)],
    },
  });

  return true;
}
