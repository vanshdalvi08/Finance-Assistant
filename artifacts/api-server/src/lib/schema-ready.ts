import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, businessStateTable, usersTable } from "@workspace/db";

let migrationsApplied = false;

function resolveMigrationsFolder() {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "lib", "db", "drizzle"),
    path.resolve(process.cwd(), "lib", "db", "drizzle"),
    path.resolve(process.cwd(), "..", "..", "lib", "db", "drizzle"),
  ];

  for (const candidate of candidates) {
    const journalPath = path.join(candidate, "meta", "_journal.json");
    if (fs.existsSync(journalPath)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function applyPendingMigrations() {
  if (migrationsApplied) {
    return;
  }

  const migrationsFolder = resolveMigrationsFolder();
  await migrate(db, { migrationsFolder });
  migrationsApplied = true;
}

export async function assertDatabaseSchemaReady(): Promise<void> {
  try {
    await applyPendingMigrations();
    await Promise.all([
      db.select({ id: usersTable.id }).from(usersTable).limit(1),
      db.select({ id: businessStateTable.id }).from(businessStateTable).limit(1),
    ]);
  } catch (error) {
    throw new Error(
      "Database schema is missing or outdated. Run `corepack pnpm db:migrate` before starting the API server.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
