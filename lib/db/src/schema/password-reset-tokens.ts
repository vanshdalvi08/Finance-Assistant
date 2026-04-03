import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("password_reset_tokens_user_index").on(table.userId),
    tokenHashUnique: uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    expiresIndex: index("password_reset_tokens_expires_index").on(table.expiresAt),
  }),
);

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokensTable).omit({
  id: true,
  createdAt: true,
});

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokensTable.$inferInsert;
