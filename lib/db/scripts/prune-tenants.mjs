import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..", "..", "..");

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000101";
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000102";
const DEFAULT_TENANT_SLUG = "yojak";
const PLATFORM_TENANT_SLUG = "platform";

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

const useLocalOverrides = process.env.USE_LOCAL_DATABASE === "true";

const env = {
  ...loadEnvFile(path.join(workspaceRoot, "artifacts", "api-server", ".env")),
  ...(useLocalOverrides ? loadEnvFile(path.join(workspaceRoot, "artifacts", "api-server", ".env.local")) : {}),
  ...(useLocalOverrides ? loadEnvFile(path.join(workspaceRoot, ".env.local")) : {}),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.");
}

const keepTenantInput = (env.KEEP_TENANT ?? env.KEEP_TENANT_NAME ?? "").trim();
if (!keepTenantInput) {
  throw new Error("Set KEEP_TENANT or KEEP_TENANT_NAME to the tenant you want to preserve.");
}

const apply = process.argv.includes("--apply");
const purgeOrphanEvents = process.argv.includes("--purge-orphan-events");

const storageConfig = {
  url: env.SUPABASE_URL?.trim() || "",
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "",
  avatarsBucket: env.SUPABASE_STORAGE_AVATARS_BUCKET?.trim() || "yojak-avatars",
  expenseAttachmentsBucket:
    env.SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET?.trim() || "yojak-expense-attachments",
  fundReceiptsBucket:
    env.SUPABASE_STORAGE_FUND_RECEIPTS_BUCKET?.trim() || "yojak-fund-receipts",
  salarySlipsBucket:
    env.SUPABASE_STORAGE_SALARY_SLIPS_BUCKET?.trim()
    || env.SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET?.trim()
    || "yojak-expense-attachments",
};

const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
});

function log(message) {
  process.stdout.write(`${message}\n`);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function parseSupabaseObjectPath(url, bucket) {
  if (!url || !bucket) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) {
      return null;
    }
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

async function deleteStorageObjects(bucket, paths) {
  const deduped = unique(paths);
  if (!storageConfig.url || !storageConfig.serviceRoleKey || deduped.length === 0) {
    return 0;
  }

  const response = await fetch(`${storageConfig.url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      apikey: storageConfig.serviceRoleKey,
      Authorization: `Bearer ${storageConfig.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: deduped }),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete ${bucket} objects: ${response.status} ${await response.text()}`);
  }

  return deduped.length;
}

async function main() {
  await client.connect();

  try {
    const tenantsResult = await client.query(`
      select id, name, slug, status, created_at
      from tenants
      order by created_at asc
    `);

    const tenants = tenantsResult.rows;
    const keepTenant = tenants.find((tenant) =>
      normalize(tenant.id) === normalize(keepTenantInput)
      || normalize(tenant.name) === normalize(keepTenantInput)
      || normalize(tenant.slug) === normalize(keepTenantInput),
    );

    if (!keepTenant) {
      throw new Error(`Could not find tenant "${keepTenantInput}".`);
    }

    const keepIds = new Set([
      keepTenant.id,
      DEFAULT_TENANT_ID,
      PLATFORM_TENANT_ID,
    ]);

    const deleteTenants = tenants.filter((tenant) => !keepIds.has(tenant.id));
    const deleteTenantIds = deleteTenants.map((tenant) => tenant.id);

    const usersResult = deleteTenantIds.length === 0
      ? { rows: [] }
      : await client.query(
          `
            select tenant_id, profile_photo_url
            from users
            where tenant_id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );

    const expensesResult = deleteTenantIds.length === 0
      ? { rows: [] }
      : await client.query(
          `
            select tenant_id, attachment_path
            from expenses
            where tenant_id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );

    const fundsResult = deleteTenantIds.length === 0
      ? { rows: [] }
      : await client.query(
          `
            select tenant_id, receipt_path
            from funds
            where tenant_id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );

    const slipsResult = deleteTenantIds.length === 0
      ? { rows: [] }
      : await client.query(
          `
            select tenant_id, file_path
            from salary_slips
            where tenant_id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );

    const avatarsToDelete = usersResult.rows
      .map((row) => parseSupabaseObjectPath(row.profile_photo_url, storageConfig.avatarsBucket))
      .filter(Boolean);
    const expenseAttachmentsToDelete = expensesResult.rows
      .map((row) => row.attachment_path)
      .filter(Boolean);
    const fundReceiptsToDelete = fundsResult.rows
      .map((row) => row.receipt_path)
      .filter(Boolean);
    const salarySlipsToDelete = slipsResult.rows
      .map((row) => row.file_path)
      .filter(Boolean);

    log(`Keeping tenant: ${keepTenant.name} (${keepTenant.id})`);
    log(`System tenants preserved: ${DEFAULT_TENANT_SLUG}, ${PLATFORM_TENANT_SLUG}`);
    log(`Tenants to delete: ${deleteTenants.length}`);
    for (const tenant of deleteTenants) {
      log(` - ${tenant.name} (${tenant.slug})`);
    }
    log(`Storage objects queued: avatars=${unique(avatarsToDelete).length}, expense_attachments=${unique(expenseAttachmentsToDelete).length}, fund_receipts=${unique(fundReceiptsToDelete).length}, salary_slips=${unique(salarySlipsToDelete).length}`);

    if (!apply) {
      log("Dry run complete. Re-run with --apply to execute.");
      return;
    }

    await client.query("begin");
    try {
      if (deleteTenantIds.length > 0) {
        await client.query(
          `
            delete from platform_events
            where tenant_id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );

        await client.query(
          `
            delete from tenants
            where id = any($1::uuid[])
          `,
          [deleteTenantIds],
        );
      }

      if (purgeOrphanEvents) {
        await client.query(`
          delete from platform_events
          where tenant_id is null
            and actor_user_id is null
        `);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    const deletedAvatars = await deleteStorageObjects(storageConfig.avatarsBucket, avatarsToDelete);
    const deletedExpenseAttachments = await deleteStorageObjects(
      storageConfig.expenseAttachmentsBucket,
      expenseAttachmentsToDelete,
    );
    const deletedFundReceipts = await deleteStorageObjects(
      storageConfig.fundReceiptsBucket,
      fundReceiptsToDelete,
    );
    const deletedSalarySlips = await deleteStorageObjects(
      storageConfig.salarySlipsBucket,
      salarySlipsToDelete,
    );

    const remainingTenants = await client.query(`
      select id, name, slug
      from tenants
      order by created_at asc
    `);

    log(`Deleted tenants: ${deleteTenants.length}`);
    log(`Deleted storage objects: avatars=${deletedAvatars}, expense_attachments=${deletedExpenseAttachments}, fund_receipts=${deletedFundReceipts}, salary_slips=${deletedSalarySlips}`);
    log("Remaining tenants:");
    for (const tenant of remainingTenants.rows) {
      log(` - ${tenant.name} (${tenant.slug})`);
    }
  } finally {
    await client.end();
  }
}

await main();
