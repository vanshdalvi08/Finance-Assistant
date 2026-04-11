import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
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
import { logger } from "./logger";

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
  requestId?: string | null;
  fingerprint?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PlatformMonitoringFilters = {
  limit?: number;
  severity?: "info" | "warning" | "error";
  category?: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  tenantId?: string;
  state?: "open" | "acknowledged" | "resolved" | "all";
  search?: string;
  from?: string;
  to?: string;
};

export class PlatformConflictError extends Error {
  constructor(
    message: string,
    public readonly conflictCode: "slug_taken" | "email_taken" | "phone_taken",
  ) {
    super(message);
  }
}

export class PlatformFeatureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type PlatformEventRow = Pick<
  PlatformEvent,
  | "id"
  | "tenantId"
  | "actorUserId"
  | "severity"
  | "category"
  | "title"
  | "message"
  | "path"
  | "method"
  | "statusCode"
  | "durationMs"
  | "metadata"
  | "createdAt"
> & {
  fingerprint: string | null;
  acknowledgedAt: Date | string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: Date | string | null;
  resolvedByUserId: string | null;
  createdAt: Date | string;
};

let platformEventSchemaMode: "unknown" | "modern" | "legacy" = "unknown";
let platformEventSchemaModePromise: Promise<"modern" | "legacy"> | null = null;
const externalAlertCooldowns = new Map<string, number>();

function collectErrorMessages(error: unknown, messages: string[] = []) {
  if (!error || typeof error !== "object") {
    if (error) {
      messages.push(String(error));
    }
    return messages;
  }

  if ("message" in error && typeof error.message === "string") {
    messages.push(error.message);
  }

  if ("detail" in error && typeof error.detail === "string") {
    messages.push(error.detail);
  }

  if ("cause" in error && error.cause) {
    collectErrorMessages(error.cause, messages);
  }

  return messages;
}

function isMissingPlatformEventWorkflowColumn(error: unknown) {
  const messages = collectErrorMessages(error);
  return messages.some(
    (message) =>
      message.includes('column "fingerprint"') ||
      message.includes('column "acknowledged_at"') ||
      message.includes('column "acknowledged_by_user_id"') ||
      message.includes('column "resolved_at"') ||
      message.includes('column "resolved_by_user_id"'),
  );
}

async function withPlatformEventSchemaFallback<T>(callbacks: {
  modern: () => Promise<T>;
  legacy: () => Promise<T>;
}) {
  const schemaMode = await ensurePlatformEventSchemaMode();

  if (schemaMode === "legacy") {
    return callbacks.legacy();
  }

  try {
    const result = await callbacks.modern();
    platformEventSchemaMode = "modern";
    return result;
  } catch (error) {
    if (!isMissingPlatformEventWorkflowColumn(error)) {
      throw error;
    }

    platformEventSchemaMode = "legacy";
    return callbacks.legacy();
  }
}

function supportsPlatformIncidentWorkflow() {
  return platformEventSchemaMode !== "legacy";
}

async function detectPlatformEventSchemaMode() {
  const result = await db.execute<{ column_name: string }>(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_events'
      and column_name in ('fingerprint', 'acknowledged_at', 'acknowledged_by_user_id', 'resolved_at', 'resolved_by_user_id')
  `);

  const columns = new Set(result.rows.map((row) => row.column_name));
  return columns.size === 5 ? "modern" : "legacy";
}

async function ensurePlatformEventSchemaMode() {
  if (platformEventSchemaMode !== "unknown") {
    return platformEventSchemaMode;
  }

  if (!platformEventSchemaModePromise) {
    platformEventSchemaModePromise = detectPlatformEventSchemaMode()
      .then((mode) => {
        platformEventSchemaMode = mode;
        return mode;
      })
      .catch((error) => {
        logger.warn({ err: error }, "Falling back to legacy platform monitoring mode");
        platformEventSchemaMode = "legacy";
        return "legacy" as const;
      })
      .finally(() => {
        platformEventSchemaModePromise = null;
      });
  }

  return platformEventSchemaModePromise;
}

function getPlatformEventSelectShape(legacy: boolean) {
  return {
    id: platformEventsTable.id,
    tenantId: platformEventsTable.tenantId,
    actorUserId: platformEventsTable.actorUserId,
    severity: platformEventsTable.severity,
    category: platformEventsTable.category,
    title: platformEventsTable.title,
    message: platformEventsTable.message,
    path: platformEventsTable.path,
    method: platformEventsTable.method,
    statusCode: platformEventsTable.statusCode,
    durationMs: platformEventsTable.durationMs,
    fingerprint: legacy ? sql<string | null>`null` : platformEventsTable.fingerprint,
    acknowledgedAt: legacy ? sql<Date | null>`null` : platformEventsTable.acknowledgedAt,
    acknowledgedByUserId: legacy ? sql<string | null>`null` : platformEventsTable.acknowledgedByUserId,
    resolvedAt: legacy ? sql<Date | null>`null` : platformEventsTable.resolvedAt,
    resolvedByUserId: legacy ? sql<string | null>`null` : platformEventsTable.resolvedByUserId,
    metadata: platformEventsTable.metadata,
    createdAt: platformEventsTable.createdAt,
  };
}

function buildLegacyPlatformEventWhereSql(filters: PlatformMonitoringFilters) {
  const where = [];

  if (filters.severity) {
    where.push(sql`severity = ${filters.severity}`);
  }

  if (filters.category) {
    where.push(sql`category = ${filters.category}`);
  }

  if (filters.tenantId?.trim()) {
    where.push(sql`tenant_id = ${filters.tenantId.trim()}::uuid`);
  }

  if (filters.state === "acknowledged" || filters.state === "resolved") {
    where.push(sql`1 = 0`);
  }

  if (filters.search?.trim()) {
    const query = `%${filters.search.trim()}%`;
    where.push(
      sql`(title ilike ${query} or message ilike ${query} or coalesce(path, '') ilike ${query} or coalesce(method, '') ilike ${query})`,
    );
  }

  if (filters.from) {
    where.push(sql`created_at >= ${new Date(filters.from)}`);
  }

  if (filters.to) {
    where.push(sql`created_at <= ${new Date(filters.to)}`);
  }

  return where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
}

async function selectLegacyPlatformEvents(limit: number, filters: PlatformMonitoringFilters = {}) {
  const whereSql = buildLegacyPlatformEventWhereSql(filters);
  const result = await db.execute<PlatformEventRow>(sql`
    select
      id,
      tenant_id as "tenantId",
      actor_user_id as "actorUserId",
      severity,
      category,
      title,
      message,
      path,
      method,
      status_code as "statusCode",
      duration_ms as "durationMs",
      null::text as "fingerprint",
      null::timestamptz as "acknowledgedAt",
      null::uuid as "acknowledgedByUserId",
      null::timestamptz as "resolvedAt",
      null::uuid as "resolvedByUserId",
      metadata,
      created_at as "createdAt"
    from platform_events
    ${whereSql}
    order by created_at desc
    limit ${limit}
  `);

  return result.rows;
}

async function summarizeLegacyPlatformEvents(filters: PlatformMonitoringFilters = {}) {
  const whereSql = buildLegacyPlatformEventWhereSql(filters);
  const [severityResult, categoryResult] = await Promise.all([
    db.execute<{ severity: "info" | "warning" | "error"; count: string | number }>(sql`
      select severity, count(*)::int as "count"
      from platform_events
      ${whereSql}
      group by severity
    `),
    db.execute<{ category: "request" | "auth" | "database" | "upload" | "tenant" | "system"; count: string | number }>(sql`
      select category, count(*)::int as "count"
      from platform_events
      ${whereSql}
      group by category
    `),
  ]);

  return {
    summaryRows: severityResult.rows,
    categoryRows: categoryResult.rows,
  };
}

async function insertLegacyPlatformEvent(values: {
  id: string;
  severity: "info" | "warning" | "error";
  category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  title: string;
  message: string;
  path: string | null;
  method: string | null;
  statusCode: number | null;
  durationMs: number | null;
  tenantId: string | null;
  actorUserId: string | null;
  metadata: string | null;
  createdAt: Date;
}) {
  await db.execute(sql`
    insert into platform_events (
      id,
      tenant_id,
      actor_user_id,
      severity,
      category,
      title,
      message,
      path,
      method,
      status_code,
      duration_ms,
      metadata,
      created_at
    ) values (
      ${values.id},
      ${values.tenantId}::uuid,
      ${values.actorUserId}::uuid,
      ${values.severity},
      ${values.category},
      ${values.title},
      ${values.message},
      ${values.path},
      ${values.method},
      ${values.statusCode},
      ${values.durationMs},
      ${values.metadata},
      ${values.createdAt}
    )
  `);
}

function buildPlatformMonitoringWhere(filters: PlatformMonitoringFilters, legacy: boolean) {
  const where = [];

  if (filters.severity) {
    where.push(eq(platformEventsTable.severity, filters.severity));
  }

  if (filters.category) {
    where.push(eq(platformEventsTable.category, filters.category));
  }

  if (filters.tenantId?.trim()) {
    where.push(eq(platformEventsTable.tenantId, filters.tenantId.trim()));
  }

  if (filters.state === "open") {
    if (!legacy) {
      where.push(sql`${platformEventsTable.acknowledgedAt} is null and ${platformEventsTable.resolvedAt} is null`);
    }
  } else if (filters.state === "acknowledged") {
    if (legacy) {
      where.push(sql`1 = 0`);
    } else {
      where.push(sql`${platformEventsTable.acknowledgedAt} is not null and ${platformEventsTable.resolvedAt} is null`);
    }
  } else if (filters.state === "resolved") {
    if (legacy) {
      where.push(sql`1 = 0`);
    } else {
      where.push(sql`${platformEventsTable.resolvedAt} is not null`);
    }
  }

  if (filters.search?.trim()) {
    const query = `%${filters.search.trim()}%`;
    const clauses = [
      ilike(platformEventsTable.title, query),
      ilike(platformEventsTable.message, query),
      ilike(platformEventsTable.path, query),
      ilike(platformEventsTable.method, query),
    ];

    if (!legacy) {
      clauses.push(ilike(platformEventsTable.fingerprint, query));
    }

    where.push(or(...clauses)!);
  }

  if (filters.from) {
    where.push(gte(platformEventsTable.createdAt, new Date(filters.from)));
  }

  if (filters.to) {
    where.push(lte(platformEventsTable.createdAt, new Date(filters.to)));
  }

  return where;
}

function buildPlatformEventFingerprint(input: Pick<PlatformEventInput, "category" | "title" | "path" | "method" | "statusCode">) {
  return [
    input.category ?? "system",
    input.title.trim().toLowerCase(),
    (input.path ?? "").trim().toLowerCase(),
    (input.method ?? "").trim().toUpperCase(),
    String(input.statusCode ?? ""),
  ].join("|");
}

function severityRank(severity: "info" | "warning" | "error") {
  if (severity === "error") {
    return 3;
  }

  if (severity === "warning") {
    return 2;
  }

  return 1;
}

function parseMonitoringMinSeverity(value?: string): "info" | "warning" | "error" {
  if (value === "info" || value === "warning" || value === "error") {
    return value;
  }

  return "error" as const;
}

function maskWebhookUrl(url: string) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/$/, "");
    const redactedPath = pathname.length > 12 ? `...${pathname.slice(-12)}` : pathname || "/";
    return `${parsed.origin}${redactedPath}`;
  } catch {
    return "configured";
  }
}

function getExternalMonitoringConfig() {
  const webhookUrl = optionalEnv("PLATFORM_MONITORING_WEBHOOK_URL")?.trim();
  const webhookToken = optionalEnv("PLATFORM_MONITORING_WEBHOOK_TOKEN")?.trim() || null;
  const minSeverity = parseMonitoringMinSeverity(optionalEnv("PLATFORM_MONITORING_MIN_SEVERITY")?.trim());
  const cooldownMs = Math.max(0, Number(optionalEnv("PLATFORM_MONITORING_ALERT_COOLDOWN_MS") ?? 90_000) || 90_000);
  const timeoutMs = Math.max(1500, Number(optionalEnv("PLATFORM_MONITORING_WEBHOOK_TIMEOUT_MS") ?? 6000) || 6000);

  return {
    enabled: Boolean(webhookUrl),
    webhookUrl: webhookUrl || null,
    webhookToken,
    minSeverity,
    cooldownMs,
    timeoutMs,
  };
}

function canDispatchExternalAlert(params: {
  severity: "info" | "warning" | "error";
  fingerprint: string;
  tenantId?: string | null;
  cooldownMs: number;
  minSeverity: "info" | "warning" | "error";
}) {
  if (severityRank(params.severity) < severityRank(params.minSeverity)) {
    return false;
  }

  if (params.cooldownMs <= 0) {
    return true;
  }

  const scope = params.tenantId?.trim() || "platform";
  const key = `${scope}:${params.fingerprint}`;
  const now = Date.now();
  const previous = externalAlertCooldowns.get(key);
  if (typeof previous === "number" && now - previous < params.cooldownMs) {
    return false;
  }

  externalAlertCooldowns.set(key, now);
  if (externalAlertCooldowns.size > 1200) {
    const staleBefore = now - Math.max(params.cooldownMs * 4, 600_000);
    for (const [entryKey, createdAt] of externalAlertCooldowns.entries()) {
      if (createdAt < staleBefore) {
        externalAlertCooldowns.delete(entryKey);
      }
      if (externalAlertCooldowns.size <= 900) {
        break;
      }
    }
  }

  return true;
}

async function dispatchExternalAlert(input: {
  id: string;
  severity: "info" | "warning" | "error";
  category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  title: string;
  message: string;
  path: string | null;
  method: string | null;
  statusCode: number | null;
  durationMs: number | null;
  tenantId: string | null;
  actorUserId: string | null;
  requestId?: string | null;
  fingerprint: string;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
}) {
  const config = getExternalMonitoringConfig();
  if (!config.enabled || !config.webhookUrl) {
    return;
  }

  if (
    !canDispatchExternalAlert({
      severity: input.severity,
      fingerprint: input.fingerprint,
      tenantId: input.tenantId,
      cooldownMs: config.cooldownMs,
      minSeverity: config.minSeverity,
    })
  ) {
    return;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.webhookToken ? { authorization: `Bearer ${config.webhookToken}` } : {}),
      },
      body: JSON.stringify({
        source: "finance-assistant-api",
        environment: process.env.NODE_ENV ?? "development",
        event: {
          id: input.id,
          severity: input.severity,
          category: input.category,
          title: input.title,
          message: input.message,
          path: input.path ?? undefined,
          method: input.method ?? undefined,
          statusCode: input.statusCode ?? undefined,
          durationMs: input.durationMs ?? undefined,
          tenantId: input.tenantId ?? undefined,
          actorUserId: input.actorUserId ?? undefined,
          requestId: input.requestId ?? undefined,
          fingerprint: input.fingerprint,
          createdAt: input.createdAt.toISOString(),
          metadata: input.metadata ?? undefined,
        },
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      logger.warn(
        {
          statusCode: response.status,
          eventId: input.id,
          severity: input.severity,
          category: input.category,
        },
        "External monitoring webhook responded with non-success status",
      );
    }
  } catch (error) {
    logger.warn({ err: error, eventId: input.id, severity: input.severity }, "External monitoring dispatch failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function recordPlatformEvent(input: PlatformEventInput) {
  const fingerprint = input.fingerprint?.trim() || buildPlatformEventFingerprint(input);
  const metadataForRow = {
    ...(input.metadata ?? {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
  const metadataObject = Object.keys(metadataForRow).length > 0 ? metadataForRow : null;
  const metadataValue = {
    ...metadataForRow,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
  const metadata = Object.keys(metadataValue).length > 0 ? JSON.stringify(metadataValue) : null;
  const baseValues = {
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
  };

  await withPlatformEventSchemaFallback({
    modern: async () => {
      await db.insert(platformEventsTable).values({
        ...baseValues,
        fingerprint,
      });
    },
    legacy: async () => {
      await insertLegacyPlatformEvent(baseValues);
    },
  });

  void dispatchExternalAlert({
    id: baseValues.id,
    severity: baseValues.severity,
    category: baseValues.category,
    title: baseValues.title,
    message: baseValues.message,
    path: baseValues.path,
    method: baseValues.method,
    statusCode: baseValues.statusCode,
    durationMs: baseValues.durationMs,
    tenantId: baseValues.tenantId,
    actorUserId: baseValues.actorUserId,
    requestId: input.requestId ?? null,
    fingerprint,
    createdAt: baseValues.createdAt,
    metadata: metadataObject,
  });
}

export async function recordPlatformEventSafe(input: PlatformEventInput) {
  try {
    await recordPlatformEvent(input);
  } catch (error) {
    logger.error({ err: error, title: input.title, category: input.category }, "Failed to record platform event");
  }
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
    withPlatformEventSchemaFallback({
      modern: () =>
        db
          .select(getPlatformEventSelectShape(false))
          .from(platformEventsTable)
          .orderBy(desc(platformEventsTable.createdAt))
          .limit(12),
      legacy: () =>
        selectLegacyPlatformEvents(12),
    }),
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
    incidentWorkflowSupported: supportsPlatformIncidentWorkflow(),
    recentEvents: events.map((event) => serializePlatformEvent(event)),
    tenants: tenantSummaries,
  };
}

export async function listPlatformMonitoring(filters: PlatformMonitoringFilters = {}) {
  await ensurePlatformTenant();

  const limit = Math.min(200, Math.max(20, Number(filters.limit ?? 50) || 50));
  const { rows, summaryRows, categoryRows } = await withPlatformEventSchemaFallback({
    modern: async () => {
      const where = buildPlatformMonitoringWhere(filters, false);
      const [rows, summaryRows, categoryRows] = await Promise.all([
        db
          .select(getPlatformEventSelectShape(false))
          .from(platformEventsTable)
          .where(where.length ? and(...where) : undefined)
          .orderBy(desc(platformEventsTable.createdAt))
          .limit(limit),
        db
          .select({
            severity: platformEventsTable.severity,
            count: sql<number>`count(*)`,
          })
          .from(platformEventsTable)
          .where(where.length ? and(...where) : undefined)
          .groupBy(platformEventsTable.severity),
        db
          .select({
            category: platformEventsTable.category,
            count: sql<number>`count(*)`,
          })
          .from(platformEventsTable)
          .where(where.length ? and(...where) : undefined)
          .groupBy(platformEventsTable.category),
      ]);

      return { rows, summaryRows, categoryRows };
    },
    legacy: async () => {
      const [rows, summaries] = await Promise.all([selectLegacyPlatformEvents(limit, filters), summarizeLegacyPlatformEvents(filters)]);

      return { rows, summaryRows: summaries.summaryRows, categoryRows: summaries.categoryRows };
    },
  });

  return {
    events: rows.map(serializePlatformEvent),
    summary: summaryRows.reduce(
      (accumulator, row) => ({
        ...accumulator,
        [row.severity]: Number(row.count ?? 0),
      }),
      { info: 0, warning: 0, error: 0 } as Record<"info" | "warning" | "error", number>,
    ),
    categorySummary: categoryRows.reduce(
      (accumulator, row) => ({
        ...accumulator,
        [row.category]: Number(row.count ?? 0),
      }),
      { request: 0, auth: 0, database: 0, upload: 0, tenant: 0, system: 0 } as Record<
        "request" | "auth" | "database" | "upload" | "tenant" | "system",
        number
      >,
    ),
    workflowSupported: supportsPlatformIncidentWorkflow(),
    appliedFilters: {
      severity: filters.severity ?? null,
      category: filters.category ?? null,
      tenantId: filters.tenantId ?? null,
      state: filters.state ?? "all",
      search: filters.search?.trim() || null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      limit,
    },
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

  const monitoringConfig = getExternalMonitoringConfig();
  const backupRetentionDays = Math.max(1, Number(optionalEnv("PLATFORM_BACKUP_RETENTION_DAYS") ?? 30) || 30);
  return {
    platformTenant: platformTenant[0] ? serializeTenant(platformTenant[0]) : null,
    platformAdmins: platformAdmins.map(serializeUser),
    operationalDefaults: {
      supportEmail: optionalEnv("PLATFORM_SUPPORT_EMAIL")?.trim() || optionalEnv("PLATFORM_ADMIN_EMAIL")?.trim() || "platform@yojak.in",
      incidentLatencyThresholdMs: Number(optionalEnv("PLATFORM_SLOW_REQUEST_THRESHOLD_MS") ?? 1500),
      monitoringWindowSize: 80,
      hardeningTier: "baseline",
      auditRetention: "Database-backed platform event history",
      externalMonitoring: {
        enabled: monitoringConfig.enabled,
        provider: "webhook",
        endpoint: monitoringConfig.webhookUrl ? maskWebhookUrl(monitoringConfig.webhookUrl) : null,
        minSeverity: monitoringConfig.minSeverity,
        cooldownMs: monitoringConfig.cooldownMs,
      },
      backupRecovery: {
        strategy: optionalEnv("PLATFORM_BACKUP_STRATEGY")?.trim() || "managed-postgres-pitr",
        frequency: optionalEnv("PLATFORM_BACKUP_FREQUENCY")?.trim() || "daily + wal/pitr",
        retentionDays: backupRetentionDays,
        storage: optionalEnv("PLATFORM_BACKUP_STORAGE")?.trim() || "managed-provider",
        runbookUrl: optionalEnv("PLATFORM_RECOVERY_RUNBOOK_URL")?.trim() || "/platform/recovery",
        lastRecoveryDrillDate: optionalEnv("PLATFORM_LAST_RECOVERY_DRILL_DATE")?.trim() || null,
      },
    },
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

export async function acknowledgePlatformEvent(eventId: string, actorUserId: string) {
  const rows = await withPlatformEventSchemaFallback({
    modern: () =>
      db
        .update(platformEventsTable)
        .set({
          acknowledgedAt: new Date(),
          acknowledgedByUserId: actorUserId,
        })
        .where(eq(platformEventsTable.id, eventId))
        .returning(),
    legacy: async () => {
      throw new PlatformFeatureUnavailableError(
        "Incident workflow actions are unavailable until platform monitoring migrations are applied.",
      );
    },
  });

  return rows[0] ?? null;
}

export async function resolvePlatformEvent(eventId: string, actorUserId: string) {
  const now = new Date();
  const rows = await withPlatformEventSchemaFallback({
    modern: () =>
      db
        .update(platformEventsTable)
        .set({
          acknowledgedAt: now,
          acknowledgedByUserId: actorUserId,
          resolvedAt: now,
          resolvedByUserId: actorUserId,
        })
        .where(eq(platformEventsTable.id, eventId))
        .returning(),
    legacy: async () => {
      throw new PlatformFeatureUnavailableError(
        "Incident workflow actions are unavailable until platform monitoring migrations are applied.",
      );
    },
  });

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
  const ownerPassword = input.ownerPassword?.trim();
  const passwordWasGenerated = !ownerPassword;
  const temporaryPassword = ownerPassword || generateTemporaryPassword();
  const now = new Date();
  let tenantRows: Tenant[];
  let ownerRows: User[];

  try {
    [tenantRows, ownerRows] = await db.transaction(async (transaction) => {
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
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      const detail = typeof (error as { detail?: string }).detail === "string" ? (error as { detail?: string }).detail! : "";
      if (detail.includes("slug")) {
        throw new PlatformConflictError("Tenant slug already exists", "slug_taken");
      }
      if (detail.includes("email")) {
        throw new PlatformConflictError("Owner email already exists", "email_taken");
      }
      if (detail.includes("phone")) {
        throw new PlatformConflictError("Owner phone already exists in this workspace", "phone_taken");
      }
      throw new PlatformConflictError("Tenant identity is already in use", "slug_taken");
    }

    throw error;
  }

  return {
    tenant: tenantRows[0] ?? null,
    owner: ownerRows[0] ?? null,
    temporaryPassword: passwordWasGenerated ? temporaryPassword : null,
    passwordWasGenerated,
  };
}

function serializePlatformEvent(event: PlatformEventRow) {
  const toIsoOrUndefined = (value: Date | string | null | undefined) => {
    if (!value) {
      return undefined;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toISOString();
  };

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
    fingerprint: event.fingerprint ?? undefined,
    acknowledgedAt: toIsoOrUndefined(event.acknowledgedAt),
    acknowledgedByUserId: event.acknowledgedByUserId ?? undefined,
    resolvedAt: toIsoOrUndefined(event.resolvedAt),
    resolvedByUserId: event.resolvedByUserId ?? undefined,
    metadata: event.metadata ? safeParseMetadata(event.metadata) : undefined,
    createdAt: toIsoOrUndefined(event.createdAt) ?? new Date().toISOString(),
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
