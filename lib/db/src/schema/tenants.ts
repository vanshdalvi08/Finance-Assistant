import { index, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "inactive"]);

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000101";
export const DEFAULT_TENANT_SLUG = "yojak";
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000102";
export const PLATFORM_TENANT_SLUG = "platform";

export const tenantsTable = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: tenantStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("tenants_slug_unique").on(table.slug),
    statusIndex: index("tenants_status_index").on(table.status),
  }),
);

export type Tenant = typeof tenantsTable.$inferSelect;
export type InsertTenant = typeof tenantsTable.$inferInsert;
