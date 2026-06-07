import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  platformEventsTable,
  tenantsTable,
  usersTable,
  type PlatformEvent,
  type Tenant,
  type User,
} from "@workspace/db/schema";
import { assertStrongPassword, hashPassword, generateTemporaryPassword } from "./security";
import { PLATFORM_TENANT_ID, ensurePlatformTenant } from "./tenants";
import { getAppUrl, getSmtpConfig, isProduction, isTest, optionalEnv } from "./env";
import { sendMail } from "./mailer";
import { tenantOwnerEmailTemplate } from "./email-templates";
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
  suppressExternalDispatch?: boolean;
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

export type RecoveryDrillStatus = "passed" | "failed" | "partial";
export type RecoveryDrillType = "tabletop" | "restore" | "failover" | "backup-validation" | "other";
export type RecoveryDrillScope = "platform" | "tenant" | "database" | "storage" | "service";

export type RecoveryDrillHistoryFilters = {
  limit?: number;
  status?: RecoveryDrillStatus;
  tenantId?: string;
};

export type RecoveryDrillRecord = {
  id: string;
  type: RecoveryDrillType;
  status: RecoveryDrillStatus;
  title: string;
  summary: string;
  scope: RecoveryDrillScope;
  notes?: string;
  tenantId?: string;
  actorUserId?: string;
  performedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMinutes?: number;
  createdAt: string;
};

export type PlatformRetentionPreview = {
  supported: boolean;
  mode: "manual";
  unresolvedRetention: "indefinite";
  excludedSources: string[];
  resolvedRetentionDays: Record<"info" | "warning" | "error", number>;
  stats: {
    totalEvents: number;
    openEvents: number;
    acknowledgedEvents: number;
    resolvedEvents: number;
    pruneEligibleTotal: number;
    pruneEligibleBySeverity: Record<"info" | "warning" | "error", number>;
    oldestEventAt: string | null;
    newestEventAt: string | null;
  };
  latestPruneRun: {
    at: string;
    deletedCount: number;
    limit: number;
    actorUserId?: string;
  } | null;
};

export type AuditRetentionPreview = {
  mode: "protected";
  destructivePruningEnabled: boolean;
  defaultRetentionDays: number;
  stats: {
    totalEntries: number;
    oldestEntryAt: string | null;
    newestEntryAt: string | null;
    estimatedEligibleEntries: number;
  };
  note: string;
};

export type PlatformRetentionSummary = {
  platformEvents: PlatformRetentionPreview;
  auditTrail: AuditRetentionPreview;
};

export type RunPlatformRetentionPruneInput = {
  actorUserId?: string | null;
  requestId?: string | null;
  dryRun?: boolean;
  limit?: number;
};

export type PlatformRetentionPruneResult = {
  supported: boolean;
  dryRun: boolean;
  limit: number;
  deletedCount: number;
  eligibleCount: number;
  retainedAuditEntries: number;
  preview: PlatformRetentionSummary;
};

export type RetryPlatformExternalAlertInput = {
  actorUserId?: string | null;
  requestId?: string | null;
};

export type PlatformExternalAlertRetryResult = {
  eventId: string;
  status: "retried" | "skipped" | "not_found";
  reason?:
    | "event_not_found"
    | "legacy_mode_unsupported"
    | "not_failed"
    | "internal_failure_event"
    | "dispatch_error";
  previousState?: "delivered" | "failed" | "suppressed" | "pending" | "unknown";
  nextState?: "delivered" | "failed" | "suppressed" | "pending" | "unknown";
  title?: string;
};

export type RetryFailedPlatformExternalAlertsInput = RetryPlatformExternalAlertInput & {
  dryRun?: boolean;
  limit?: number;
};

export type RetryFailedPlatformExternalAlertsResult = {
  dryRun: boolean;
  limit: number;
  candidateCount: number;
  retried: number;
  delivered: number;
  failed: number;
  suppressed: number;
  skipped: number;
  results: PlatformExternalAlertRetryResult[];
};

export type RecordRecoveryDrillInput = {
  type?: RecoveryDrillType;
  status: RecoveryDrillStatus;
  title?: string;
  summary?: string;
  scope?: RecoveryDrillScope;
  notes?: string;
  performedAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMinutes?: number;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  requestId?: string | null;
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

type UniqueViolationDetails = {
  constraint?: string;
  detail?: string;
  message?: string;
  cause?: unknown;
};

function extractUniqueViolationInfo(error: unknown): UniqueViolationDetails {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const candidate = error as UniqueViolationDetails & { cause?: unknown };
  const cause = typeof candidate.cause === "object" && candidate.cause !== null ? (candidate.cause as UniqueViolationDetails) : {};
  return {
    constraint: candidate.constraint ?? cause.constraint,
    detail: candidate.detail ?? cause.detail,
    message: candidate.message ?? cause.message,
    cause: candidate.cause,
  };
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

type RecordedPlatformEvent = {
  id: string;
  severity: "info" | "warning" | "error";
  category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  title: string;
  message: string;
  path?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  tenantId?: string;
  actorUserId?: string;
  fingerprint: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

let platformEventSchemaMode: "unknown" | "modern" | "legacy" = "unknown";
let platformEventSchemaModePromise: Promise<"modern" | "legacy"> | null = null;
const externalAlertCooldowns = new Map<string, number>();

type ExternalAlertSkipReason = "webhook_not_configured" | "below_min_severity" | "cooldown_active";
type ExternalAlertFailureReason = "non_success_status" | "timeout" | "network_error";

type ExternalAlertOutcome =
  | {
      status: "delivered";
      attemptedAt: string;
      deliveredAt: string;
      endpoint: string | null;
      httpStatus: number;
    }
  | {
      status: "skipped";
      attemptedAt: string;
      reason: ExternalAlertSkipReason;
      endpoint: string | null;
    }
  | {
      status: "failed";
      attemptedAt: string;
      failedAt: string;
      reason: ExternalAlertFailureReason;
      endpoint: string | null;
      httpStatus?: number;
      errorMessage?: string;
    };
const PLATFORM_RECOVERY_DRILL_SOURCE = "platform_recovery_drill";
const PLATFORM_EXTERNAL_ALERT_FAILURE_SOURCE = "platform_external_alert_delivery_failure";
const PLATFORM_RETENTION_PRUNE_SOURCE = "platform_retention_prune";

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

function buildMetadataSourcePattern(source: string) {
  return `%\"source\":\"${source}\"%`;
}

async function selectLegacyPlatformEventsByMetadataSource(limit: number, source: string) {
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
    where coalesce(metadata, '') ilike ${buildMetadataSourcePattern(source)}
    order by created_at desc
    limit ${limit}
  `);

  return result.rows;
}

async function selectPlatformEventsByMetadataSource(limit: number, source: string) {
  return withPlatformEventSchemaFallback({
    modern: () =>
      db
        .select(getPlatformEventSelectShape(false))
        .from(platformEventsTable)
        .where(sql`coalesce(${platformEventsTable.metadata}, '') ilike ${buildMetadataSourcePattern(source)}`)
        .orderBy(desc(platformEventsTable.createdAt))
        .limit(limit),
    legacy: () => selectLegacyPlatformEventsByMetadataSource(limit, source),
  });
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

function parseRetentionDaysEnv(name: string, fallback: number, minimum = 1) {
  const numeric = Number(optionalEnv(name) ?? fallback);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(minimum, Math.round(numeric));
}

function getPlatformRetentionConfig() {
  return {
    platformEvents: {
      resolvedRetentionDays: {
        info: parseRetentionDaysEnv("PLATFORM_MONITORING_INFO_RETENTION_DAYS", 30),
        warning: parseRetentionDaysEnv("PLATFORM_MONITORING_WARNING_RETENTION_DAYS", 90),
        error: parseRetentionDaysEnv("PLATFORM_MONITORING_ERROR_RETENTION_DAYS", 180),
      },
      excludedSources: [PLATFORM_RECOVERY_DRILL_SOURCE],
    },
    auditTrail: {
      defaultRetentionDays: parseRetentionDaysEnv("PLATFORM_AUDIT_RETENTION_DAYS", 2555),
      destructivePruningEnabled: String(optionalEnv("PLATFORM_AUDIT_PRUNE_ENABLED") ?? "false").toLowerCase() === "true",
    },
  };
}

function retentionCutoffIso(retentionDays: number) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function buildPlatformRetentionEligibleWhere(config = getPlatformRetentionConfig()) {
  const excludedSourceClauses = config.platformEvents.excludedSources.map(
    (source) => sql`coalesce(${platformEventsTable.metadata}, '') not ilike ${buildMetadataSourcePattern(source)}`,
  );

  return and(
    isNotNull(platformEventsTable.resolvedAt),
    ...excludedSourceClauses,
    or(
      and(
        eq(platformEventsTable.severity, "info"),
        lte(platformEventsTable.resolvedAt, new Date(retentionCutoffIso(config.platformEvents.resolvedRetentionDays.info))),
      ),
      and(
        eq(platformEventsTable.severity, "warning"),
        lte(platformEventsTable.resolvedAt, new Date(retentionCutoffIso(config.platformEvents.resolvedRetentionDays.warning))),
      ),
      and(
        eq(platformEventsTable.severity, "error"),
        lte(platformEventsTable.resolvedAt, new Date(retentionCutoffIso(config.platformEvents.resolvedRetentionDays.error))),
      ),
    )!,
  );
}

function evaluateExternalAlertDispatch(params: {
  severity: "info" | "warning" | "error";
  fingerprint: string;
  tenantId?: string | null;
  cooldownMs: number;
  minSeverity: "info" | "warning" | "error";
}) {
  if (severityRank(params.severity) < severityRank(params.minSeverity)) {
    return { shouldDispatch: false as const, reason: "below_min_severity" as const };
  }

  if (params.cooldownMs <= 0) {
    return { shouldDispatch: true as const };
  }

  const scope = params.tenantId?.trim() || "platform";
  const key = `${scope}:${params.fingerprint}`;
  const now = Date.now();
  const previous = externalAlertCooldowns.get(key);
  if (typeof previous === "number" && now - previous < params.cooldownMs) {
    return { shouldDispatch: false as const, reason: "cooldown_active" as const };
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

  return { shouldDispatch: true as const };
}

function serializePlatformEventMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return null;
  }

  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

async function persistExternalAlertOutcome(eventId: string, metadata: Record<string, unknown> | null, outcome: ExternalAlertOutcome) {
  const nextMetadata: Record<string, unknown> = {
    ...(metadata ?? {}),
    externalAlert: outcome,
  };

  try {
    await db
      .update(platformEventsTable)
      .set({
        metadata: serializePlatformEventMetadata(nextMetadata),
      })
      .where(eq(platformEventsTable.id, eventId));
  } catch (error) {
    logger.warn({ err: error, eventId }, "Unable to persist external alert delivery outcome");
  }
}

async function recordExternalAlertFailureEvent(params: {
  eventId: string;
  title: string;
  severity: "info" | "warning" | "error";
  category: "request" | "auth" | "database" | "upload" | "tenant" | "system";
  tenantId: string | null;
  actorUserId: string | null;
  requestId?: string | null;
  outcome: Extract<ExternalAlertOutcome, { status: "failed" }>;
}) {
  await recordPlatformEventSafe({
    severity: "error",
    category: "system",
    title: "External alert delivery failed",
    message: `Webhook delivery failed for platform event ${params.eventId} (${params.title}).`,
    path: "/api/platform/monitoring/test-alert",
    method: "POST",
    statusCode: 502,
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
    requestId: params.requestId ?? null,
    suppressExternalDispatch: true,
    metadata: {
      source: PLATFORM_EXTERNAL_ALERT_FAILURE_SOURCE,
      originalEventId: params.eventId,
      originalSeverity: params.severity,
      originalCategory: params.category,
      originalTitle: params.title,
      deliveryFailure: params.outcome,
    },
  });
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
  forceDispatch?: boolean;
}): Promise<ExternalAlertOutcome> {
  const config = getExternalMonitoringConfig();
  const attemptedAt = new Date().toISOString();
  const endpoint = config.webhookUrl ? maskWebhookUrl(config.webhookUrl) : null;

  if (!config.enabled || !config.webhookUrl) {
    const outcome: ExternalAlertOutcome = {
      status: "skipped",
      attemptedAt,
      reason: "webhook_not_configured",
      endpoint,
    };
    await persistExternalAlertOutcome(input.id, input.metadata ?? null, outcome);
    return outcome;
  }

  if (!input.forceDispatch) {
    const decision = evaluateExternalAlertDispatch({
      severity: input.severity,
      fingerprint: input.fingerprint,
      tenantId: input.tenantId,
      cooldownMs: config.cooldownMs,
      minSeverity: config.minSeverity,
    });
    if (!decision.shouldDispatch) {
      const outcome: ExternalAlertOutcome = {
        status: "skipped",
        attemptedAt,
        reason: decision.reason,
        endpoint,
      };
      await persistExternalAlertOutcome(input.id, input.metadata ?? null, outcome);
      return outcome;
    }
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  let outcome: ExternalAlertOutcome = {
    status: "failed",
    attemptedAt,
    failedAt: new Date().toISOString(),
    reason: "network_error",
    endpoint,
  };
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
      outcome = {
        status: "failed",
        attemptedAt,
        failedAt: new Date().toISOString(),
        reason: "non_success_status",
        endpoint,
        httpStatus: response.status,
      };
      logger.warn(
        {
          statusCode: response.status,
          eventId: input.id,
          severity: input.severity,
          category: input.category,
        },
        "External monitoring webhook responded with non-success status",
      );
    } else {
      outcome = {
        status: "delivered",
        attemptedAt,
        deliveredAt: new Date().toISOString(),
        endpoint,
        httpStatus: response.status,
      };
    }
  } catch (error) {
    const isTimeout = typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "AbortError";
    outcome = {
      status: "failed",
      attemptedAt,
      failedAt: new Date().toISOString(),
      reason: isTimeout ? "timeout" : "network_error",
      endpoint,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    logger.warn({ err: error, eventId: input.id, severity: input.severity }, "External monitoring dispatch failed");
  } finally {
    clearTimeout(timeout);
  }

  await persistExternalAlertOutcome(input.id, input.metadata ?? null, outcome);
  if (outcome.status === "failed") {
    await recordExternalAlertFailureEvent({
      eventId: input.id,
      title: input.title,
      severity: input.severity,
      category: input.category,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      requestId: input.requestId ?? null,
      outcome,
    });
  }

  return outcome;
}

export async function recordPlatformEvent(input: PlatformEventInput) {
  const fingerprint = input.fingerprint?.trim() || buildPlatformEventFingerprint(input);
  const metadataObject = {
    ...(input.metadata ?? {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
  const metadata = serializePlatformEventMetadata(metadataObject);
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

  if (!input.suppressExternalDispatch) {
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

  return baseValues.id;
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

  const email = optionalEnv("PLATFORM_ADMIN_EMAIL")?.trim().toLowerCase() ?? (isTest() ? "platform@yojak.in" : undefined);
  const password = optionalEnv("PLATFORM_ADMIN_PASSWORD") ?? (isTest() ? "platform123" : undefined);

  if (!email || !password) {
    return null;
  }

  const adminIdentity = {
    name: optionalEnv("PLATFORM_ADMIN_NAME")?.trim() || "Platform Super Admin",
    email,
    phone: optionalEnv("PLATFORM_ADMIN_PHONE")?.trim() || "8888888888",
    position: optionalEnv("PLATFORM_ADMIN_POSITION")?.trim() || "Platform Owner",
    department: optionalEnv("PLATFORM_ADMIN_DEPARTMENT")?.trim() || "Platform",
  };

  const existing = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, PLATFORM_TENANT_ID), eq(usersTable.role, "platform_super_admin")))
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
      name: adminIdentity.name,
      email: adminIdentity.email,
      phone: adminIdentity.phone,
      role: "platform_super_admin",
      employeeId: null,
      position: adminIdentity.position,
      department: adminIdentity.department,
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

function summarizePlatformEventStates(events: Array<ReturnType<typeof serializePlatformEvent>>) {
  return events.reduce(
    (accumulator, event) => {
      if (event.resolvedAt) {
        accumulator.resolved += 1;
        return accumulator;
      }

      if (event.acknowledgedAt) {
        accumulator.acknowledged += 1;
        return accumulator;
      }

      accumulator.open += 1;
      return accumulator;
    },
    { open: 0, acknowledged: 0, resolved: 0 },
  );
}

function summarizeExternalAlertOutcomes(events: Array<ReturnType<typeof serializePlatformEvent>>) {
  return events.reduce(
    (accumulator, event) => {
      const metadata = event.metadata;
      const externalAlert =
        metadata && typeof metadata === "object" && "externalAlert" in metadata
          ? (metadata.externalAlert as { status?: unknown; reason?: unknown } | undefined)
          : undefined;

      if (!externalAlert || typeof externalAlert !== "object") {
        accumulator.unknown += 1;
        return accumulator;
      }

      if (externalAlert.status === "delivered") {
        accumulator.delivered += 1;
        return accumulator;
      }

      if (externalAlert.status === "failed") {
        accumulator.failed += 1;
        return accumulator;
      }

      if (externalAlert.status === "skipped") {
        accumulator.skipped += 1;
        if (externalAlert.reason === "webhook_not_configured") {
          accumulator.notConfigured += 1;
        } else if (externalAlert.reason === "below_min_severity") {
          accumulator.belowMinSeverity += 1;
        } else if (externalAlert.reason === "cooldown_active") {
          accumulator.cooldownActive += 1;
        }
        return accumulator;
      }

      accumulator.unknown += 1;
      return accumulator;
    },
    {
      delivered: 0,
      failed: 0,
      skipped: 0,
      notConfigured: 0,
      belowMinSeverity: 0,
      cooldownActive: 0,
      unknown: 0,
    },
  );
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

  const events = rows.map(serializePlatformEvent);
  const monitoringConfig = getExternalMonitoringConfig();

  return {
    events,
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
    stateSummary: summarizePlatformEventStates(events),
    externalAlertSummary: summarizeExternalAlertOutcomes(events),
    externalAlerting: {
      enabled: monitoringConfig.enabled,
      provider: "webhook" as const,
      endpoint: monitoringConfig.webhookUrl ? maskWebhookUrl(monitoringConfig.webhookUrl) : null,
      minSeverity: monitoringConfig.minSeverity,
      cooldownMs: monitoringConfig.cooldownMs,
    },
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

async function getLatestRetentionPruneRun() {
  const rows = await selectPlatformEventsByMetadataSource(5, PLATFORM_RETENTION_PRUNE_SOURCE);
  for (const row of rows) {
    const metadata = row.metadata ? safeParseMetadata(row.metadata) : undefined;
    const pruneRun = metadata?.retentionPrune;
    if (!pruneRun || typeof pruneRun !== "object") {
      continue;
    }

    const candidate = pruneRun as {
      deletedCount?: unknown;
      limit?: unknown;
    };

    return {
      at: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      deletedCount: Math.max(0, Number(candidate.deletedCount ?? 0) || 0),
      limit: Math.max(0, Number(candidate.limit ?? 0) || 0),
      actorUserId: row.actorUserId ?? undefined,
    };
  }

  return null;
}

async function buildPlatformEventRetentionPreview(config = getPlatformRetentionConfig()): Promise<PlatformRetentionPreview> {
  const baseStats = await withPlatformEventSchemaFallback({
    modern: () =>
      db.execute<{
        total_events: string | number;
        open_events: string | number;
        acknowledged_events: string | number;
        resolved_events: string | number;
        oldest_event_at: Date | string | null;
        newest_event_at: Date | string | null;
      }>(sql`
        select
          count(*)::int as total_events,
          count(*) filter (where acknowledged_at is null and resolved_at is null)::int as open_events,
          count(*) filter (where acknowledged_at is not null and resolved_at is null)::int as acknowledged_events,
          count(*) filter (where resolved_at is not null)::int as resolved_events,
          min(created_at) as oldest_event_at,
          max(created_at) as newest_event_at
        from platform_events
      `),
    legacy: () =>
      db.execute<{
        total_events: string | number;
        open_events: string | number;
        acknowledged_events: string | number;
        resolved_events: string | number;
        oldest_event_at: Date | string | null;
        newest_event_at: Date | string | null;
      }>(sql`
        select
          count(*)::int as total_events,
          count(*)::int as open_events,
          0::int as acknowledged_events,
          0::int as resolved_events,
          min(created_at) as oldest_event_at,
          max(created_at) as newest_event_at
        from platform_events
      `),
  });

  const latestPruneRun = await getLatestRetentionPruneRun();

  if (!supportsPlatformIncidentWorkflow()) {
    const summaryRow = baseStats.rows[0];
    return {
      supported: false,
      mode: "manual",
      unresolvedRetention: "indefinite",
      excludedSources: config.platformEvents.excludedSources,
      resolvedRetentionDays: config.platformEvents.resolvedRetentionDays,
      stats: {
        totalEvents: Number(summaryRow?.total_events ?? 0),
        openEvents: Number(summaryRow?.open_events ?? 0),
        acknowledgedEvents: Number(summaryRow?.acknowledged_events ?? 0),
        resolvedEvents: Number(summaryRow?.resolved_events ?? 0),
        pruneEligibleTotal: 0,
        pruneEligibleBySeverity: { info: 0, warning: 0, error: 0 },
        oldestEventAt: summaryRow?.oldest_event_at ? new Date(summaryRow.oldest_event_at).toISOString() : null,
        newestEventAt: summaryRow?.newest_event_at ? new Date(summaryRow.newest_event_at).toISOString() : null,
      },
      latestPruneRun,
    };
  }

  const eligibleWhere = buildPlatformRetentionEligibleWhere(config);
  const eligibleRows = await db
    .select({
      severity: platformEventsTable.severity,
      count: sql<number>`count(*)`,
    })
    .from(platformEventsTable)
    .where(eligibleWhere)
    .groupBy(platformEventsTable.severity);

  const summaryRow = baseStats.rows[0];
  const pruneEligibleBySeverity = eligibleRows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row.severity]: Number(row.count ?? 0),
    }),
    { info: 0, warning: 0, error: 0 } as Record<"info" | "warning" | "error", number>,
  );

  return {
    supported: true,
    mode: "manual",
    unresolvedRetention: "indefinite",
    excludedSources: config.platformEvents.excludedSources,
    resolvedRetentionDays: config.platformEvents.resolvedRetentionDays,
    stats: {
      totalEvents: Number(summaryRow?.total_events ?? 0),
      openEvents: Number(summaryRow?.open_events ?? 0),
      acknowledgedEvents: Number(summaryRow?.acknowledged_events ?? 0),
      resolvedEvents: Number(summaryRow?.resolved_events ?? 0),
      pruneEligibleTotal: pruneEligibleBySeverity.info + pruneEligibleBySeverity.warning + pruneEligibleBySeverity.error,
      pruneEligibleBySeverity,
      oldestEventAt: summaryRow?.oldest_event_at ? new Date(summaryRow.oldest_event_at).toISOString() : null,
      newestEventAt: summaryRow?.newest_event_at ? new Date(summaryRow.newest_event_at).toISOString() : null,
    },
    latestPruneRun,
  };
}

async function buildAuditRetentionPreview(config = getPlatformRetentionConfig()): Promise<AuditRetentionPreview> {
  const summary = await db.execute<{
    total_entries: string | number;
    oldest_entry_at: Date | string | null;
    newest_entry_at: Date | string | null;
    estimated_eligible_entries: string | number;
  }>(sql`
    select
      count(*)::int as total_entries,
      min(created_at) as oldest_entry_at,
      max(created_at) as newest_entry_at,
      count(*) filter (where created_at <= ${new Date(retentionCutoffIso(config.auditTrail.defaultRetentionDays))})::int as estimated_eligible_entries
    from audit_trail
  `);

  const row = summary.rows[0];
  return {
    mode: "protected",
    destructivePruningEnabled: config.auditTrail.destructivePruningEnabled,
    defaultRetentionDays: config.auditTrail.defaultRetentionDays,
    stats: {
      totalEntries: Number(row?.total_entries ?? 0),
      oldestEntryAt: row?.oldest_entry_at ? new Date(row.oldest_entry_at).toISOString() : null,
      newestEntryAt: row?.newest_entry_at ? new Date(row.newest_entry_at).toISOString() : null,
      estimatedEligibleEntries: config.auditTrail.destructivePruningEnabled ? Number(row?.estimated_eligible_entries ?? 0) : 0,
    },
    note: config.auditTrail.destructivePruningEnabled
      ? "Audit pruning is enabled by configuration. Review retention and backup posture before destructive cleanup."
      : "Audit and finance history remain protected by default. Long-term archival is preferred over destructive pruning.",
  };
}

export async function listPlatformRetentionSummary(): Promise<PlatformRetentionSummary> {
  await ensurePlatformTenant();

  const config = getPlatformRetentionConfig();
  const [platformEvents, auditTrail] = await Promise.all([
    buildPlatformEventRetentionPreview(config),
    buildAuditRetentionPreview(config),
  ]);

  return {
    platformEvents,
    auditTrail,
  };
}

export async function runPlatformRetentionPrune(input: RunPlatformRetentionPruneInput = {}): Promise<PlatformRetentionPruneResult> {
  await ensurePlatformTenant();

  const config = getPlatformRetentionConfig();
  const limit = Math.min(2000, Math.max(1, Number(input.limit ?? 500) || 500));
  const preview = await listPlatformRetentionSummary();
  const retainedAuditEntries = preview.auditTrail.stats.totalEntries;

  if (!preview.platformEvents.supported) {
    return {
      supported: false,
      dryRun: Boolean(input.dryRun),
      limit,
      deletedCount: 0,
      eligibleCount: 0,
      retainedAuditEntries,
      preview,
    };
  }

  const eligibleWhere = buildPlatformRetentionEligibleWhere(config);
  const eligibleRows = await db
    .select({
      id: platformEventsTable.id,
    })
    .from(platformEventsTable)
    .where(eligibleWhere)
    .orderBy(desc(platformEventsTable.resolvedAt), desc(platformEventsTable.createdAt))
    .limit(limit);

  const eligibleIds = eligibleRows.map((row) => row.id);
  const eligibleCount = eligibleIds.length;

  if (input.dryRun || !eligibleIds.length) {
    return {
      supported: true,
      dryRun: Boolean(input.dryRun),
      limit,
      deletedCount: 0,
      eligibleCount,
      retainedAuditEntries,
      preview,
    };
  }

  await db.delete(platformEventsTable).where(inArray(platformEventsTable.id, eligibleIds));

  await recordPlatformEventSafe({
    severity: "info",
    category: "system",
    title: "Platform retention prune completed",
    message: `Pruned ${eligibleIds.length} resolved platform monitoring events older than retention targets.`,
    path: "/api/platform/retention/prune",
    method: "POST",
    statusCode: 202,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId ?? null,
    suppressExternalDispatch: true,
    metadata: {
      source: PLATFORM_RETENTION_PRUNE_SOURCE,
      retentionPrune: {
        deletedCount: eligibleIds.length,
        limit,
        resolvedRetentionDays: config.platformEvents.resolvedRetentionDays,
        excludedSources: config.platformEvents.excludedSources,
      },
    },
  });

  const nextPreview = await listPlatformRetentionSummary();
  return {
    supported: true,
    dryRun: false,
    limit,
    deletedCount: eligibleIds.length,
    eligibleCount,
    retainedAuditEntries,
    preview: nextPreview,
  };
}

function normalizeDeliveryStateFromMetadata(metadata: Record<string, unknown> | undefined) {
  const externalAlert = metadata?.externalAlert;
  if (!externalAlert || typeof externalAlert !== "object" || Array.isArray(externalAlert)) {
    return "unknown" as const;
  }

  const status = (externalAlert as { status?: unknown }).status;
  if (status === "delivered") {
    return "delivered" as const;
  }
  if (status === "failed") {
    return "failed" as const;
  }
  if (status === "skipped") {
    return "suppressed" as const;
  }
  return "unknown" as const;
}

function eventSourceFromMetadata(metadata: Record<string, unknown> | undefined) {
  const source = metadata?.source;
  return typeof source === "string" && source.trim() ? source.trim() : null;
}

async function getPlatformEventById(eventId: string) {
  return withPlatformEventSchemaFallback({
    modern: async () => {
      const rows = await db.select(getPlatformEventSelectShape(false)).from(platformEventsTable).where(eq(platformEventsTable.id, eventId)).limit(1);
      return rows[0] ?? null;
    },
    legacy: async () => {
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
        where id = ${eventId}
        limit 1
      `);
      return result.rows[0] ?? null;
    },
  });
}

async function listFailedExternalAlertCandidateRows(limit: number) {
  const scanLimit = Math.min(500, Math.max(limit * 5, 80));
  return withPlatformEventSchemaFallback({
    modern: () =>
      db
        .select(getPlatformEventSelectShape(false))
        .from(platformEventsTable)
        .where(sql`coalesce(${platformEventsTable.metadata}, '') ilike '%"externalAlert":{"status":"failed"%'`)
        .orderBy(desc(platformEventsTable.createdAt))
        .limit(scanLimit),
    legacy: async () => {
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
        where coalesce(metadata, '') ilike '%"externalAlert":{"status":"failed"%'
        order by created_at desc
        limit ${scanLimit}
      `);
      return result.rows;
    },
  });
}

export async function retryPlatformExternalAlert(
  eventId: string,
  input: RetryPlatformExternalAlertInput = {},
): Promise<PlatformExternalAlertRetryResult> {
  await ensurePlatformTenant();

  if (!supportsPlatformIncidentWorkflow()) {
    return {
      eventId,
      status: "skipped",
      reason: "legacy_mode_unsupported",
      previousState: "unknown",
      nextState: "unknown",
    };
  }

  const row = await getPlatformEventById(eventId.trim());
  if (!row) {
    return { eventId, status: "not_found", reason: "event_not_found" };
  }

  const parsedMetadata = row.metadata ? safeParseMetadata(row.metadata) : undefined;
  const source = eventSourceFromMetadata(parsedMetadata);
  const previousState = normalizeDeliveryStateFromMetadata(parsedMetadata);

  if (source === PLATFORM_EXTERNAL_ALERT_FAILURE_SOURCE) {
    return {
      eventId: row.id,
      status: "skipped",
      reason: "internal_failure_event",
      previousState,
      nextState: previousState,
      title: row.title,
    };
  }

  if (previousState !== "failed") {
    return {
      eventId: row.id,
      status: "skipped",
      reason: "not_failed",
      previousState,
      nextState: previousState,
      title: row.title,
    };
  }

  const retryDetails = parsedMetadata?.externalAlertRetry;
  const previousRetryCount =
    retryDetails && typeof retryDetails === "object" && !Array.isArray(retryDetails)
      ? Number((retryDetails as { totalRetries?: unknown }).totalRetries ?? 0) || 0
      : 0;

  const metadataForRetry: Record<string, unknown> = {
    ...(parsedMetadata ?? {}),
    externalAlertRetry: {
      totalRetries: previousRetryCount + 1,
      lastRetriedAt: new Date().toISOString(),
      lastRetriedByUserId: input.actorUserId ?? null,
      lastRetryRequestId: input.requestId ?? null,
    },
  };

  try {
    const outcome = await dispatchExternalAlert({
      id: row.id,
      severity: row.severity,
      category: row.category,
      title: row.title,
      message: row.message,
      path: row.path ?? null,
      method: row.method ?? null,
      statusCode: row.statusCode ?? null,
      durationMs: row.durationMs ?? null,
      tenantId: row.tenantId ?? null,
      actorUserId: input.actorUserId ?? row.actorUserId ?? null,
      requestId: input.requestId ?? null,
      fingerprint: row.fingerprint ?? buildPlatformEventFingerprint(row),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      metadata: metadataForRetry,
      forceDispatch: true,
    });

    const nextState =
      outcome.status === "delivered" ? "delivered" : outcome.status === "failed" ? "failed" : outcome.status === "skipped" ? "suppressed" : "unknown";
    return {
      eventId: row.id,
      status: "retried",
      previousState,
      nextState,
      title: row.title,
    };
  } catch (error) {
    logger.warn({ err: error, eventId: row.id }, "Manual external alert retry failed");
    return {
      eventId: row.id,
      status: "skipped",
      reason: "dispatch_error",
      previousState,
      nextState: "failed",
      title: row.title,
    };
  }
}

export async function retryFailedPlatformExternalAlerts(
  input: RetryFailedPlatformExternalAlertsInput = {},
): Promise<RetryFailedPlatformExternalAlertsResult> {
  await ensurePlatformTenant();

  const dryRun = Boolean(input.dryRun);
  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 25) || 25));

  if (!supportsPlatformIncidentWorkflow()) {
    return {
      dryRun,
      limit,
      candidateCount: 0,
      retried: 0,
      delivered: 0,
      failed: 0,
      suppressed: 0,
      skipped: 0,
      results: [],
    };
  }

  const candidates = await listFailedExternalAlertCandidateRows(limit);
  const filtered = candidates
    .map((row) => {
      const metadata = row.metadata ? safeParseMetadata(row.metadata) : undefined;
      const source = eventSourceFromMetadata(metadata);
      const state = normalizeDeliveryStateFromMetadata(metadata);
      return { row, source, state };
    })
    .filter((entry) => entry.state === "failed" && entry.source !== PLATFORM_EXTERNAL_ALERT_FAILURE_SOURCE)
    .slice(0, limit);

  if (dryRun) {
    const results = filtered.map<PlatformExternalAlertRetryResult>((entry) => ({
      eventId: entry.row.id,
      status: "skipped",
      previousState: "failed",
      nextState: "failed",
      title: entry.row.title,
    }));

    return {
      dryRun: true,
      limit,
      candidateCount: filtered.length,
      retried: 0,
      delivered: 0,
      failed: 0,
      suppressed: 0,
      skipped: filtered.length,
      results,
    };
  }

  const results: PlatformExternalAlertRetryResult[] = [];
  for (const entry of filtered) {
    const retryResult = await retryPlatformExternalAlert(entry.row.id, {
      actorUserId: input.actorUserId ?? null,
      requestId: input.requestId ?? null,
    });
    results.push(retryResult);
  }

  const delivered = results.filter((result) => result.status === "retried" && result.nextState === "delivered").length;
  const failed = results.filter((result) => result.status === "retried" && result.nextState === "failed").length;
  const suppressed = results.filter((result) => result.status === "retried" && result.nextState === "suppressed").length;
  const retried = results.filter((result) => result.status === "retried").length;
  const skipped = results.length - retried;

  await recordPlatformEventSafe({
    severity: failed > 0 ? "warning" : "info",
    category: "system",
    title: "External alert retry batch completed",
    message: `Retried ${retried} failed delivery events (${delivered} delivered, ${failed} failed, ${suppressed} suppressed).`,
    path: "/api/platform/monitoring/retry-failed",
    method: "POST",
    statusCode: 202,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId ?? null,
    suppressExternalDispatch: true,
    metadata: {
      source: "platform_external_alert_retry_batch",
      deliveryRetryBatch: {
        limit,
        candidateCount: filtered.length,
        retried,
        delivered,
        failed,
        suppressed,
        skipped,
      },
    },
  });

  return {
    dryRun: false,
    limit,
    candidateCount: filtered.length,
    retried,
    delivered,
    failed,
    suppressed,
    skipped,
    results,
  };
}

function normalizeRecoveryDrillStatus(value: unknown): RecoveryDrillStatus | null {
  if (value === "passed" || value === "failed" || value === "partial") {
    return value;
  }

  return null;
}

function normalizeRecoveryDrillType(value: unknown): RecoveryDrillType | null {
  if (value === "tabletop" || value === "restore" || value === "failover" || value === "backup-validation" || value === "other") {
    return value;
  }

  return null;
}

function normalizeRecoveryDrillScope(value: unknown): RecoveryDrillScope | null {
  if (value === "platform" || value === "tenant" || value === "database" || value === "storage" || value === "service") {
    return value;
  }

  return null;
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function normalizeDurationMinutes(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return undefined;
  }

  return Math.round(numericValue * 100) / 100;
}

function parseRecoveryDrillMetadata(metadata: Record<string, unknown> | undefined) {
  const container = metadata?.recoveryDrill;
  if (!container || typeof container !== "object") {
    return null;
  }

  const status = normalizeRecoveryDrillStatus((container as { status?: unknown }).status);
  if (!status) {
    return null;
  }

  const type = normalizeRecoveryDrillType((container as { type?: unknown }).type) ?? "other";
  const scope = normalizeRecoveryDrillScope((container as { scope?: unknown }).scope) ?? "platform";
  const summaryValue = (container as { summary?: unknown }).summary;
  const notesValue = (container as { notes?: unknown }).notes;

  return {
    type,
    status,
    summary: typeof summaryValue === "string" && summaryValue.trim() ? summaryValue.trim() : undefined,
    scope,
    notes: typeof notesValue === "string" && notesValue.trim() ? notesValue.trim() : undefined,
    performedAt: normalizeIsoDate((container as { performedAt?: unknown }).performedAt),
    startedAt: normalizeIsoDate((container as { startedAt?: unknown }).startedAt),
    completedAt: normalizeIsoDate((container as { completedAt?: unknown }).completedAt),
    durationMinutes: normalizeDurationMinutes((container as { durationMinutes?: unknown }).durationMinutes),
  };
}

function serializeRecoveryDrill(event: PlatformEventRow): RecoveryDrillRecord | null {
  const metadata = event.metadata ? safeParseMetadata(event.metadata) : undefined;
  const drill = parseRecoveryDrillMetadata(metadata);
  if (!drill) {
    return null;
  }

  const createdAt = event.createdAt instanceof Date ? event.createdAt.toISOString() : new Date(event.createdAt).toISOString();

  return {
    id: event.id,
    type: drill.type,
    status: drill.status,
    title: event.title,
    summary: drill.summary ?? event.message,
    scope: drill.scope,
    notes: drill.notes,
    tenantId: event.tenantId ?? undefined,
    actorUserId: event.actorUserId ?? undefined,
    performedAt: drill.performedAt ?? drill.completedAt ?? createdAt,
    startedAt: drill.startedAt,
    completedAt: drill.completedAt,
    durationMinutes: drill.durationMinutes,
    createdAt,
  };
}

async function listRecoveryDrillEventRows(limit: number, tenantId?: string) {
  const normalizedTenantId = tenantId?.trim();
  const metadataQuery = `%\"recoveryDrill\"%`;
  const whereWithTenant = normalizedTenantId
    ? and(
        eq(platformEventsTable.category, "system"),
        ilike(platformEventsTable.metadata, metadataQuery),
        eq(platformEventsTable.tenantId, normalizedTenantId),
      )
    : and(eq(platformEventsTable.category, "system"), ilike(platformEventsTable.metadata, metadataQuery));

  return withPlatformEventSchemaFallback({
    modern: () =>
      db
        .select(getPlatformEventSelectShape(false))
        .from(platformEventsTable)
        .where(whereWithTenant)
        .orderBy(desc(platformEventsTable.createdAt))
        .limit(limit),
    legacy: () =>
      db
        .select(getPlatformEventSelectShape(true))
        .from(platformEventsTable)
        .where(whereWithTenant)
        .orderBy(desc(platformEventsTable.createdAt))
        .limit(limit),
  });
}

async function getLatestRecoveryDrillDateFromEvents() {
  const rows = await listRecoveryDrillEventRows(40);
  for (const row of rows) {
    const parsed = serializeRecoveryDrill(row);
    if (!parsed) {
      continue;
    }
    return parsed.performedAt ?? parsed.completedAt ?? parsed.createdAt;
  }

  return null;
}

export async function listRecoveryDrillHistory(filters: RecoveryDrillHistoryFilters = {}) {
  await ensurePlatformTenant();

  const limit = Math.min(100, Math.max(1, Number(filters.limit ?? 30) || 30));
  const scanLimit = Math.min(500, Math.max(limit * 6, 120));
  const rows = await listRecoveryDrillEventRows(scanLimit, filters.tenantId);

  const statusFilter = filters.status ? normalizeRecoveryDrillStatus(filters.status) : null;
  const drills = rows
    .map((row) => serializeRecoveryDrill(row))
    .filter((row): row is RecoveryDrillRecord => Boolean(row))
    .filter((row) => (statusFilter ? row.status === statusFilter : true))
    .slice(0, limit);

  return {
    drills,
    summary: drills.reduce(
      (accumulator, drill) => ({
        ...accumulator,
        [drill.status]: accumulator[drill.status] + 1,
      }),
      { passed: 0, failed: 0, partial: 0 } as Record<RecoveryDrillStatus, number>,
    ),
    appliedFilters: {
      limit,
      status: statusFilter,
      tenantId: filters.tenantId?.trim() || null,
    },
  };
}

export async function recordRecoveryDrill(input: RecordRecoveryDrillInput) {
  await ensurePlatformTenant();

  const nowIso = new Date().toISOString();
  const type = normalizeRecoveryDrillType(input.type) ?? "other";
  const status = normalizeRecoveryDrillStatus(input.status) ?? "partial";
  const scope = normalizeRecoveryDrillScope(input.scope) ?? "platform";
  const normalizedPerformedAt = normalizeIsoDate(input.performedAt) ?? normalizeIsoDate(input.completedAt) ?? nowIso;
  const normalizedStartedAt = normalizeIsoDate(input.startedAt);
  const normalizedCompletedAt = normalizeIsoDate(input.completedAt) ?? normalizedPerformedAt;
  const normalizedDurationMinutes = normalizeDurationMinutes(input.durationMinutes);
  const title = input.title?.trim() || `Recovery drill ${status}`;
  const summary =
    input.summary?.trim() ||
    (status === "passed"
      ? "Recovery drill completed successfully."
      : status === "failed"
        ? "Recovery drill failed and needs follow-up."
        : "Recovery drill completed with partial success.");

  const eventId = await recordPlatformEvent({
    severity: status === "failed" ? "error" : status === "partial" ? "warning" : "info",
    category: "system",
    title,
    message: summary,
    path: "/api/platform/recovery/drills",
    method: "POST",
    statusCode: 201,
    tenantId: input.tenantId ?? null,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId ?? null,
    metadata: {
      source: "platform_recovery_drill",
      recoveryDrill: {
        type,
        status,
        summary,
        scope,
        notes: input.notes?.trim() || undefined,
        performedAt: normalizedPerformedAt,
        startedAt: normalizedStartedAt,
        completedAt: normalizedCompletedAt,
        durationMinutes: normalizedDurationMinutes,
        actorRole: input.actorRole ?? undefined,
        actorEmail: input.actorEmail ?? undefined,
      },
    },
  });

  return {
    id: eventId,
    type,
    status,
    title,
    summary,
    scope,
    notes: input.notes?.trim() || undefined,
    tenantId: input.tenantId ?? undefined,
    actorUserId: input.actorUserId ?? undefined,
    performedAt: normalizedPerformedAt,
    startedAt: normalizedStartedAt,
    completedAt: normalizedCompletedAt,
    durationMinutes: normalizedDurationMinutes,
    createdAt: nowIso,
  } satisfies RecoveryDrillRecord;
}

export async function listPlatformTenants() {
  const overview = await listPlatformOverview();
  return overview.tenants;
}

export async function listPlatformSettings() {
  await ensurePlatformTenant();

  const [platformTenant, platformAdmins, latestRecoveryDrillDate, retention] = await Promise.all([
    db.select().from(tenantsTable).where(eq(tenantsTable.id, PLATFORM_TENANT_ID)).limit(1),
    db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, PLATFORM_TENANT_ID), eq(usersTable.role, "platform_super_admin")))
      .orderBy(desc(usersTable.updatedAt)),
    getLatestRecoveryDrillDateFromEvents(),
    listPlatformRetentionSummary(),
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
      hardeningTier: "ops-hardened",
      auditRetention: retention.auditTrail.note,
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
        lastRecoveryDrillDate: (latestRecoveryDrillDate ?? optionalEnv("PLATFORM_LAST_RECOVERY_DRILL_DATE")?.trim()) || null,
      },
      retention,
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
  assertStrongPassword(temporaryPassword);
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
    const violation = extractUniqueViolationInfo(error);
    const errorText = [
      violation.constraint,
      violation.detail,
      violation.message,
      typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message ?? "") : "",
      typeof error === "object" && error !== null && "cause" in error && error.cause && typeof error.cause === "object" && "message" in error.cause
        ? String((error.cause as { message?: unknown }).message ?? "")
        : "",
      typeof error === "string" ? error : "",
      (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return "";
        }
      })(),
    ]
      .join(" ")
      .toLowerCase();
    const isUniqueViolation =
      (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") ||
      errorText.includes("duplicate key value violates unique constraint") ||
      errorText.includes("unique constraint") ||
      errorText.includes("23505");

    if (isUniqueViolation) {
      if (errorText.includes("slug")) {
        throw new PlatformConflictError("Tenant slug already exists", "slug_taken");
      }
      if (errorText.includes("email")) {
        throw new PlatformConflictError("Owner email already exists", "email_taken");
      }
      if (errorText.includes("phone")) {
        throw new PlatformConflictError("Owner phone already exists in this workspace", "phone_taken");
      }
      throw new PlatformConflictError("Tenant identity is already in use", "slug_taken");
    }

    throw error;
  }

  const onboardingEmailSent = Boolean(getSmtpConfig());
  if (onboardingEmailSent) {
    const portalUrl = getAppUrl();
    const onboarding = tenantOwnerEmailTemplate({
      name: ownerRows[0]!.name,
      loginEmail: ownerRows[0]!.email,
      temporaryPassword,
      portalUrl,
    });

    void sendMail({
      to: ownerRows[0]!.email,
      subject: onboarding.subject,
      text: onboarding.text,
      html: onboarding.html,
    }).catch((error) => {
      logger.warn({ err: error, tenantId, ownerEmail: ownerRows[0]!.email }, "Failed to send tenant onboarding email");
    });
  }

  return {
    tenant: tenantRows[0] ?? null,
    owner: ownerRows[0] ?? null,
    temporaryPassword: passwordWasGenerated ? temporaryPassword : null,
    passwordWasGenerated,
  };
}

function serializePlatformEventDelivery(metadata: Record<string, unknown> | undefined) {
  const candidate = metadata?.externalAlert;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const delivery = candidate as {
    status?: unknown;
    attemptedAt?: unknown;
    deliveredAt?: unknown;
    failedAt?: unknown;
    endpoint?: unknown;
    httpStatus?: unknown;
    reason?: unknown;
    errorMessage?: unknown;
  };

  const state =
    delivery.status === "delivered"
      ? "delivered"
      : delivery.status === "failed"
        ? "failed"
        : delivery.status === "skipped"
          ? "suppressed"
          : "unknown";

  return {
    state,
    provider: "webhook",
    destination: typeof delivery.endpoint === "string" ? delivery.endpoint : null,
    attemptedAt: typeof delivery.attemptedAt === "string" ? delivery.attemptedAt : null,
    deliveredAt: typeof delivery.deliveredAt === "string" ? delivery.deliveredAt : null,
    failedAt: typeof delivery.failedAt === "string" ? delivery.failedAt : null,
    statusCode: typeof delivery.httpStatus === "number" ? delivery.httpStatus : null,
    attempts: typeof delivery.attemptedAt === "string" ? 1 : null,
    reason: typeof delivery.reason === "string" ? delivery.reason : null,
    error: typeof delivery.errorMessage === "string" ? delivery.errorMessage : null,
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
  const metadata = event.metadata ? safeParseMetadata(event.metadata) : undefined;

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
    delivery: serializePlatformEventDelivery(metadata),
    metadata,
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
