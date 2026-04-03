import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const refreshSessionsTable = pgTable(
  "refresh_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    jtiHash: text("jti_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("refresh_sessions_user_index").on(table.userId),
    jtiHashUnique: uniqueIndex("refresh_sessions_jti_hash_unique").on(table.jtiHash),
    expiresIndex: index("refresh_sessions_expires_index").on(table.expiresAt),
  }),
);

export const insertRefreshSessionSchema = createInsertSchema(refreshSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RefreshSession = typeof refreshSessionsTable.$inferSelect;
export type InsertRefreshSession = typeof refreshSessionsTable.$inferInsert;
