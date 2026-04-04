import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

function parseEnv(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value.replace(/\\n/g, "\n");
  }

  return values;
}

function loadFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const parsed = parseEnv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadDatabaseEnv(baseDir) {
  const repoRoot = path.resolve(baseDir, "..", "..", "..");
  const candidates = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "artifacts", "api-server", ".env.local"),
    path.join(repoRoot, "artifacts", "api-server", ".env"),
    path.join(repoRoot, "lib", "db", ".env.local"),
    path.join(repoRoot, "lib", "db", ".env"),
  ];

  for (const candidate of candidates) {
    loadFile(candidate);
  }
}

function readMigrationJournal(drizzleDir) {
  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  return JSON.parse(readFileSync(journalPath, "utf8"));
}

function migrationHash(filePath) {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex");
}

async function main() {
  const packageDir = path.resolve(import.meta.dirname, "..");
  const drizzleDir = path.join(packageDir, "drizzle");
  loadDatabaseEnv(import.meta.dirname);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set before baselining migrations.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const requiredTables = ["users", "business_state"];
    const existingTables = await client.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [requiredTables],
    );

    const present = new Set(existingTables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(
        `Cannot baseline migrations because the existing schema is incomplete. Missing tables: ${missing.join(", ")}.`,
      );
    }

    await client.query(`create schema if not exists drizzle`);
    await client.query(`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    const existingMigrations = await client.query(
      `select hash, created_at from drizzle.__drizzle_migrations order by created_at asc`,
    );

    if (existingMigrations.rowCount && existingMigrations.rowCount > 0) {
      console.log(`Drizzle migration history already exists with ${existingMigrations.rowCount} entries. Skipping baseline.`);
      return;
    }

    const journal = readMigrationJournal(drizzleDir);

    await client.query("begin");
    try {
      for (const entry of journal.entries) {
        const migrationFile = path.join(drizzleDir, `${entry.tag}.sql`);
        const hash = migrationHash(migrationFile);
        await client.query(
          `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
          [hash, entry.when],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    console.log(`Baselined ${journal.entries.length} Drizzle migrations for the existing database schema.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
