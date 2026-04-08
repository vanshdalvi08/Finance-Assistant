import { createInsertSchema } from "drizzle-zod";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { actorRoleEnum } from "./business";

export const notificationTypeEnum = pgEnum("notification_type", [
  "employee_onboarded",
  "employee_updated",
  "employee_deactivated",
  "timesheet_submitted",
  "timesheet_approved",
  "timesheet_reverted",
  "expense_submitted",
  "expense_approved",
  "expense_rejected",
  "salary_paid",
  "project_created",
  "project_task_added",
  "purchase_order_created",
  "purchase_order_task_added",
  "purchase_order_task_paid",
  "pre_approval_created",
  "pre_approval_submitted",
  "pre_approval_approved",
  "pre_approval_changes_requested",
  "pre_approval_commented",
  "fund_created",
]);

export const notificationDeliveryChannelEnum = pgEnum("notification_delivery_channel", [
  "in_app",
  "email",
  "both",
]);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: uuid("recipient_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    actorRole: actorRoleEnum("actor_role").notNull(),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    deliveryChannel: notificationDeliveryChannelEnum("delivery_channel").notNull().default("in_app"),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailError: text("email_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recipientIndex: index("notifications_recipient_index").on(table.recipientId),
    recipientReadIndex: index("notifications_recipient_read_index").on(table.recipientId, table.readAt),
    createdIndex: index("notifications_created_index").on(table.createdAt),
    typeIndex: index("notifications_type_index").on(table.type),
  }),
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
export type NotificationType = typeof notificationTypeEnum.enumValues[number];
export type NotificationDeliveryChannel = typeof notificationDeliveryChannelEnum.enumValues[number];
export type NotificationKind = NotificationType;
