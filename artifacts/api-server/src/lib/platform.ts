import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  platformEventsTable,
  tenantsTable,
  usersTable,
  type PlatformEvent,
  type Tenant,
  type User,
} from "@workspace/db/schema";
import { hashPassword, generateTemporaryPassword } from "./security";
import { PLATFORM_TENANT_ID, ensurePlatformTenant } from "./tenants";
import { isProduction, optionalEnv } from "./env";

export type PlatformEventInput = {
  severity?: "info" | "warning" | "error";
  category?: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  title: string;
  message: string;
  path?: string | null;
  method?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  tenantId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordPlatformEvent(input: PlatformEventInput) {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  await db.insert(platformEventsTable).values({
    id: `evt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    severity: input.severity ?? "info",
    category: input.category ?? "request",
    title: input.title,
    message: input.message,
    path: input.path ?? null,
    method: input.method ?? null,
    statusCode: input.statusCode ?? null,
    durationMs: input.durationMs ?? null,
    tenantId: input.tenantId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata,
    createdAt: new Date(),
  });
}

export async function ensureInitialPlatformAdmin() {
  await ensurePlatformTenant();

  const email = optionalEnv("PLATFORM_ADMIN_EMAIL")?.trim().toLowerCase() ?? (!isProduction() ? "platform@yojak.in" : undefined);
  const password = optionalEnv("PLATFORM_ADMIN_PASSWORD") ?? (!isProduction() ? "platform123" : undefined);

  if (!email || !password) {
    return null;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), eq(usersTable.tenantId, PLATFORM_TENANT_ID)))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date();

  const rows = await db
    .insert(usersTable)
    .values({
      tenantId: PLATFORM_TENANT_ID,
      name: optionalEnv("PLATFORM_ADMIN_NAME")?.trim() || "Platform Super Admin",
      email,
      phone: optionalEnv("PLATFORM_ADMIN_PHONE")?.trim() || "8888888888",
      role: "platform_super_admin",
      employeeId: null,
      position: optionalEnv("PLATFORM_ADMIN_POSITION")?.trim() || "Platform Owner",
      department: optionalEnv("PLATFORM_ADMIN_DEPARTMENT")?.trim() || "Platform",
      salary: 0,
      payType: "monthly",
      hourlyRate: 0,
      profilePhotoUrl: null,
      clientInfo: {},
      hashedPassword,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return rows[0] ?? null;
}

export async function listPlatformOverview() {
  await ensurePlatformTenant();

  const [tenants, users, events] = await Promise.all([
    db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt)),
    db.select().from(usersTable).orderBy(desc(usersTable.createdAt)),
    db.select().from(platformEventsTable).orderBy(desc(platformEventsTable.createdAt)).limit(12),
  ]);

  const tenantSummaries = tenants
    .filter((tenant) => tenant.id !== PLATFORM_TENANT_ID)
    .map((tenant) => {
      const tenantUsers = users.filter((user) => user.tenantId === tenant.id);
      const lastActivityAt = tenantUsers.reduce<Date | null>((latest, user) => {
        if (!latest || user.updatedAt > latest) {
          return user.updatedAt;
        }
        return latest;
      }, null);

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        isPlatformTenant: tenant.id === PLATFORM_TENANT_ID,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        userCount: tenantUsers.length,
        adminCount: tenantUsers.filter((user) => user.role === "admin").length,
        employeeCount: tenantUsers.filter((user) => user.role === "employee").length,
        clientCount: tenantUsers.filter((user) => user.role === "client").length,
        platformAdminCount: tenantUsers.filter((user) => user.role === "platform_super_admin").length,
        lastActivityAt: lastActivityAt?.toISOString() ?? tenant.updatedAt.toISOString(),
      };
    });

  const totalTenants = tenantSummaries.length;
  const activeTenants = tenantSummaries.filter((tenant) => tenant.status === "active").length;
  const inactiveTenants = totalTenants - activeTenants;
  const totalUsers = users.length;
  const errorCount = events.filter((event) => event.severity === "error").length;
  const slowRequestCount = events.filter((event) => typeof event.durationMs === "number" && event.durationMs >= 1500).length;

  return {
    totalTenants,
    activeTenants,
    inactiveTenants,
    totalUsers,
    platformAdmins: users.filter((user) => user.role === "platform_super_admin").length,
    tenantUsers: users.filter((user) => user.role !== "platform_super_admin").length,
    errorCount,
    slowRequestCount,
    recentEvents: events.map((event) => serializePlatformEvent(event)),
    tenants: tenantSummaries,
  };
}

export async function listPlatformMonitoring(limit = 40) {
  await ensurePlatformTenant();

  const rows = await db.select().from(platformEventsTable).orderBy(desc(platformEventsTable.createdAt)).limit(limit);
  const summaryRows = await db
    .select({
      severity: platformEventsTable.severity,
      count: sql<number>`count(*)`,
    })
    .from(platformEventsTable)
    .groupBy(platformEventsTable.severity);

  return {
    events: rows.map(serializePlatformEvent),
    summary: summaryRows.reduce(
      (accumulator, row) => ({
        ...accumulator,
        [row.severity]: Number(row.count ?? 0),
      }),
      { info: 0, warning: 0, error: 0 } as Record<"info" | "warning" | "error", number>,
    ),
  };
}

export async function listPlatformTenants() {
  const overview = await listPlatformOverview();
  return overview.tenants;
}

export async function listPlatformSettings() {
  await ensurePlatformTenant();

  const [platformTenant, platformAdmins] = await Promise.all([
    db.select().from(tenantsTable).where(eq(tenantsTable.id, PLATFORM_TENANT_ID)).limit(1),
    db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, PLATFORM_TENANT_ID), eq(usersTable.role, "platform_super_admin")))
      .orderBy(desc(usersTable.updatedAt)),
  ]);

  return {
    platformTenant: platformTenant[0] ? serializeTenant(platformTenant[0]) : null,
    platformAdmins: platformAdmins.map(serializeUser),
  };
}

export async function setTenantStatus(tenantId: string, status: "active" | "inactive") {
  if (tenantId === PLATFORM_TENANT_ID) {
    return null;
  }

  const rows = await db
    .update(tenantsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId))
    .returning();

  return rows[0] ?? null;
}

export async function createTenantWithOwner(input: {
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerPosition?: string;
  ownerDepartment?: string;
  ownerPassword?: string;
}) {
  const tenantId = randomUUID();
  const temporaryPassword = input.ownerPassword?.trim() || generateTemporaryPassword();
  const now = new Date();
  const [tenantRows, ownerRows] = await db.transaction(async (transaction) => {
    const insertedTenantRows = await transaction
      .insert(tenantsTable)
      .values({
        id: tenantId,
        name: input.name.trim(),
        slug: input.slug.trim().toLowerCase(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const insertedOwnerRows = await transaction
      .insert(usersTable)
      .values({
        tenantId,
        name: input.ownerName.trim(),
        email: input.ownerEmail.trim().toLowerCase(),
        phone: input.ownerPhone.trim(),
        role: "admin",
        employeeId: null,
        position: input.ownerPosition?.trim() || "Administrator",
        department: input.ownerDepartment?.trim() || "Operations",
        salary: 0,
        payType: "monthly",
        hourlyRate: 0,
        profilePhotoUrl: null,
        clientInfo: {},
        hashedPassword: await hashPassword(temporaryPassword),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return [insertedTenantRows, insertedOwnerRows] as const;
  });

  return {
    tenant: tenantRows[0] ?? null,
    owner: ownerRows[0] ?? null,
    temporaryPassword,
  };
}

function serializePlatformEvent(event: PlatformEvent) {
  return {
    id: event.id,
    tenantId: event.tenantId ?? undefined,
    actorUserId: event.actorUserId ?? undefined,
    severity: event.severity,
    category: event.category,
    title: event.title,
    message: event.message,
    path: event.path ?? undefined,
    method: event.method ?? undefined,
    statusCode: event.statusCode ?? undefined,
    durationMs: event.durationMs ?? undefined,
    metadata: event.metadata ? safeParseMetadata(event.metadata) : undefined,
    createdAt: event.createdAt.toISOString(),
  };
}

function serializeTenant(tenant: Tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    isPlatformTenant: tenant.id === PLATFORM_TENANT_ID,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

function serializeUser(user: User) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function safeParseMetadata(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
