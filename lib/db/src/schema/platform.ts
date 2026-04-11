import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const platformEventSeverityEnum = pgEnum("platform_event_severity", ["info", "warning", "error"]);
export const platformEventCategoryEnum = pgEnum("platform_event_category", [
  "request",
  "auth",
  "database",
  "upload",
  "tenant",
  "system",
]);

export const platformEventsTable = pgTable(
  "platform_events",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    severity: platformEventSeverityEnum("severity").notNull().default("info"),
    category: platformEventCategoryEnum("category").notNull().default("system"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    path: text("path"),
    method: text("method"),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    fingerprint: text("fingerprint"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIndex: index("platform_events_tenant_index").on(table.tenantId),
    severityIndex: index("platform_events_severity_index").on(table.severity),
    categoryIndex: index("platform_events_category_index").on(table.category),
    createdIndex: index("platform_events_created_index").on(table.createdAt),
    fingerprintIndex: index("platform_events_fingerprint_index").on(table.fingerprint),
    unresolvedIndex: index("platform_events_unresolved_index").on(table.resolvedAt, table.createdAt),
  }),
);

export const insertPlatformEventSchema = createInsertSchema(platformEventsTable).omit({
  id: true,
  createdAt: true,
});

export type PlatformEvent = typeof platformEventsTable.$inferSelect;
export type InsertPlatformEvent = typeof platformEventsTable.$inferInsert;
