import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db/schema";

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000101";
export const DEFAULT_TENANT_SLUG = "yojak";

export async function ensureDefaultTenant() {
  const rows = await db
    .select()
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, DEFAULT_TENANT_ID), eq(tenantsTable.slug, DEFAULT_TENANT_SLUG)))
    .limit(1);

  if (rows[0]) {
    return rows[0];
  }

  const now = new Date();
  const inserted = await db
    .insert(tenantsTable)
    .values({
      id: DEFAULT_TENANT_ID,
      name: "Yojak",
      slug: DEFAULT_TENANT_SLUG,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  return inserted[0] ?? rows[0] ?? null;
}
