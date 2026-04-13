import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const mfaTrustedDevicesTable = pgTable(
  "mfa_trusted_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("mfa_trusted_devices_token_hash_unique").on(table.tokenHash),
    userIndex: index("mfa_trusted_devices_user_index").on(table.userId),
    expiresIndex: index("mfa_trusted_devices_expires_index").on(table.expiresAt),
  }),
);
