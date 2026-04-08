import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..", "..", "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const text = fs.readFileSync(filePath, "utf8");
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

const env = {
  ...loadEnvFile(path.join(workspaceRoot, "artifacts/api-server/.env")),
  ...loadEnvFile(path.join(workspaceRoot, "lib/db/.env")),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.");
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const avatarsBucket = env.SUPABASE_STORAGE_AVATARS_BUCKET || "yojak-avatars";
const attachmentsBucket =
  env.SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET || "yojak-expense-attachments";

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function listAllObjectPaths(bucket, prefix = "") {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return [];
  }

  const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to list bucket "${bucket}": ${response.status} ${await response.text()}`);
  }

  const items = await response.json();
  const filePaths = [];

  for (const item of items) {
    const childPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      filePaths.push(childPath);
      continue;
    }

    const nested = await listAllObjectPaths(bucket, childPath);
    filePaths.push(...nested);
  }

  return filePaths;
}

async function clearBucket(bucket) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    log(`Skipping bucket "${bucket}" because Supabase storage env is not fully configured.`);
    return;
  }

  const paths = await listAllObjectPaths(bucket);
  if (paths.length === 0) {
    log(`Bucket "${bucket}" is already empty.`);
    return;
  }

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });

  if (!response.ok) {
    throw new Error(`Failed to clear bucket "${bucket}": ${response.status} ${await response.text()}`);
  }

  log(`Cleared ${paths.length} object(s) from bucket "${bucket}".`);
}

async function clearLocalLogs() {
  const localDir = path.join(workspaceRoot, ".local");
  if (!fs.existsSync(localDir)) {
    return;
  }

  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }

    fs.writeFileSync(path.join(localDir, entry.name), "", "utf8");
  }
}

async function resetDatabase() {
  await client.connect();

  try {
    await client.query("begin");

    await client.query('delete from "notifications"');
    await client.query('delete from "refresh_sessions"');
    await client.query('delete from "password_reset_tokens"');

    await client.query('delete from "timesheet_lines"');
    await client.query('delete from "timesheets"');
    await client.query('delete from "salaries"');
    await client.query('delete from "expenses"');
    await client.query('delete from "funds"');
    await client.query('delete from "purchase_orders"');
    await client.query('delete from "project_tasks"');
    await client.query('delete from "projects"');
    await client.query('delete from "project_budgets"');
    await client.query('delete from "audit_trail"');
    await client.query('delete from "expense_categories"');

    await client.query(
      'insert into "business_state" ("id", "data", "updated_at") values ($1, $2::jsonb, now()) ' +
        'on conflict ("id") do update set "data" = excluded."data", "updated_at" = now()',
      ["default", "{}"],
    );

    await client.query('delete from "users" where "role" = $1', ["employee"]);
    await client.query('delete from "users" where "role" = $1', ["admin"]);

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  log("Resetting database tables...");
  await resetDatabase();

  log("Clearing Supabase storage buckets...");
  await clearBucket(avatarsBucket);
  await clearBucket(attachmentsBucket);

  log("Clearing local log files...");
  await clearLocalLogs();

  log("Reset complete.");
}

await main();
