import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
} from "@workspace/db";
import {
  notificationsTable,
  usersTable,
  type ActorRole,
  type Notification,
  type NotificationDeliveryChannel,
  type NotificationType,
} from "@workspace/db/schema";
import { getAppUrl } from "./env";
import { notificationEmailTemplate } from "./email-templates";
import { sendMail } from "./mailer";
import { logger } from "./logger";

type NotificationKind = "timesheet" | "expense" | "salary" | "purchase-order" | "employee" | "system";

interface NotificationRecipient {
  id: string;
  name: string;
  email: string;
}

export interface NotificationActor {
  id?: string;
  name: string;
  role: ActorRole;
  tenantId?: string;
}

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  email?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  readAt?: string | null;
  emailSentAt?: string | null;
  createdAt: string;
}

function mapTypeToKind(type: NotificationType): NotificationKind {
  if (type.startsWith("timesheet_")) {
    return "timesheet";
  }

  if (type.startsWith("expense_")) {
    return "expense";
  }

  if (type.startsWith("purchase_order_")) {
    return "purchase-order";
  }

  if (type.startsWith("employee_")) {
    return "employee";
  }

  if (type === "salary_paid") {
    return "salary";
  }

  return "system";
}

function toNotificationItem(row: Notification): NotificationItem {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    kind: mapTypeToKind(row.type),
    title: row.title,
    message: row.body,
    entityType: typeof metadata.entityType === "string" ? metadata.entityType : undefined,
    entityId: typeof metadata.entityId === "string" ? metadata.entityId : undefined,
    link: row.link ?? undefined,
    readAt: row.readAt?.toISOString() ?? null,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function getUsersByIds(userIds: string[], tenantId?: string): Promise<Map<string, NotificationRecipient>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      tenantId
        ? and(inArray(usersTable.id, Array.from(new Set(userIds))), eq(usersTable.tenantId, tenantId.trim()))
        : inArray(usersTable.id, Array.from(new Set(userIds))),
    );

  return new Map(rows.map((row) => [row.id, row]));
}

async function insertNotifications(recipientIds: string[], actor: NotificationActor, payload: NotificationPayload) {
  const recipients = await getUsersByIds(recipientIds, actor.tenantId);
  if (recipients.size === 0) {
    return [] as Array<{ id: string; recipientId: string; title: string; body: string; link: string | null }>;
  }

  const now = new Date();
  const channel: NotificationDeliveryChannel = payload.email ? "both" : "in_app";

  return db.insert(notificationsTable).values(
    Array.from(recipients.keys()).map((recipientId) => ({
      id: randomUUID(),
      recipientId,
      actorId: actor.id?.trim() || null,
      actorName: actor.name.trim() || "Yojak",
      actorRole: actor.role,
      type: payload.type,
      title: payload.title.trim(),
      body: payload.body.trim(),
      link: payload.link?.trim() || null,
      metadata: payload.metadata ?? {},
      deliveryChannel: channel,
      createdAt: now,
      updatedAt: now,
    })),
  ).returning({
    id: notificationsTable.id,
    recipientId: notificationsTable.recipientId,
    title: notificationsTable.title,
    body: notificationsTable.body,
    link: notificationsTable.link,
  });
}

async function sendNotificationEmails(
  inserted: Array<{ id: string; recipientId: string; title: string; body: string; link: string | null }>,
  payload: NotificationPayload,
) {
  if (!payload.email || inserted.length === 0) {
    return;
  }

  const recipientMap = await getUsersByIds(inserted.map((entry) => entry.recipientId));
  for (const entry of inserted) {
    const recipient = recipientMap.get(entry.recipientId);
    if (!recipient) {
      continue;
    }

    try {
      const email = notificationEmailTemplate({
        recipientName: recipient.name,
        title: payload.title,
        body: payload.body,
        link: entry.link,
        appUrl: getAppUrl(),
      });

      const sent = await sendMail({
        to: recipient.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      await db
        .update(notificationsTable)
        .set({
          emailSentAt: sent ? new Date() : null,
          emailError: sent ? null : "SMTP delivery skipped",
          updatedAt: new Date(),
        })
        .where(eq(notificationsTable.id, entry.id));
    } catch (error) {
      await db
        .update(notificationsTable)
        .set({
          emailError: error instanceof Error ? error.message.slice(0, 500) : "Unknown notification email error",
          updatedAt: new Date(),
        })
        .where(eq(notificationsTable.id, entry.id));

      logger.warn(
        { notificationId: entry.id, error: error instanceof Error ? error.message : String(error) },
        "Failed to send notification email",
      );
    }
  }
}

export async function notifyUsersByIds(recipientIds: string[], actor: NotificationActor, payload: NotificationPayload) {
  const inserted = await insertNotifications(recipientIds, actor, payload);
  await sendNotificationEmails(inserted, payload);
  return inserted.length;
}

export async function notifyAdmins(actor: NotificationActor, payload: NotificationPayload, excludeUserIds: string[] = []) {
  const rows = await db
    .select({
      id: usersTable.id,
    })
    .from(usersTable)
    .where(
      actor.tenantId
        ? and(eq(usersTable.role, "admin"), eq(usersTable.status, "active"), eq(usersTable.tenantId, actor.tenantId.trim()))
        : and(eq(usersTable.role, "admin"), eq(usersTable.status, "active")),
    );

  const recipients = rows.map((row) => row.id).filter((id) => !excludeUserIds.includes(id));
  return notifyUsersByIds(recipients, actor, payload);
}

export async function notifyEmployee(employeeId: string | undefined, actor: NotificationActor, payload: NotificationPayload) {
  if (!employeeId?.trim()) {
    return 0;
  }

  return notifyUsersByIds([employeeId.trim()], actor, payload);
}

export async function listNotificationsForUser(userId: string, limit = 20) {
  const [rows, unreadRows] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.recipientId, userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(Math.max(1, Math.min(limit, 100))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.recipientId, userId), isNull(notificationsTable.readAt))),
  ]);

  return {
    notifications: rows.map(toNotificationItem),
    unreadCount: Number(unreadRows[0]?.count ?? 0),
  };
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const rows = await db
    .update(notificationsTable)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.recipientId, userId)))
    .returning();

  return rows[0] ? toNotificationItem(rows[0]) : null;
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(notificationsTable)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notificationsTable.recipientId, userId), isNull(notificationsTable.readAt)));
}

export async function createWelcomeNotification(userId: string) {
  await notifyEmployee(
    userId,
    { name: "Yojak", role: "system" },
    {
      type: "employee_onboarded",
      title: "Your Yojak workspace is ready",
      body: "Your account has been created. Sign in to submit timesheets, track expenses, and manage your profile.",
      link: "/employee/profile",
      email: false,
      metadata: { entityType: "employee", entityId: userId },
    },
  );
}
