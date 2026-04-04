import { db, businessStateTable, usersTable } from "@workspace/db";

export async function assertDatabaseSchemaReady(): Promise<void> {
  try {
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
