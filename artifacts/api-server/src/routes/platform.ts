import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePlatformRole } from "../middlewares/auth";
import {
  acknowledgePlatformEvent,
  createTenantWithOwner,
  listRecoveryDrillHistory,
  listPlatformMonitoring,
  listPlatformOverview,
  listPlatformRetentionSummary,
  listPlatformSettings,
  listPlatformTenants,
  PlatformConflictError,
  PlatformFeatureUnavailableError,
  recordRecoveryDrill,
  recordPlatformEventSafe,
  recordPlatformEvent,
  retryFailedPlatformExternalAlerts,
  retryPlatformExternalAlert,
  resolvePlatformEvent,
  runPlatformRetentionPrune,
  setTenantStatus,
} from "../lib/platform";

const router: IRouter = Router();

const createTenantSchema = z.object({
  name: z.string().trim().min(2),
  slug: z
    .string()
    .trim()
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers, and hyphens only.")
    .refine((value) => !["platform", "admin", "api", "system", "root"].includes(value), "Slug is reserved."),
  ownerName: z.string().trim().min(2),
  ownerEmail: z.string().trim().email(),
  ownerPhone: z.string().trim().min(7),
  ownerPosition: z.string().trim().min(2).optional(),
  ownerDepartment: z.string().trim().min(2).optional(),
  ownerPassword: z.string().trim().min(8).optional(),
});

const tenantStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

const monitoringQuerySchema = z.object({
  limit: z.coerce.number().int().min(20).max(200).optional(),
  severity: z.enum(["info", "warning", "error"]).optional(),
  category: z.enum(["request", "auth", "database", "upload", "tenant", "system"]).optional(),
  tenantId: z.string().uuid().optional(),
  state: z.enum(["open", "acknowledged", "resolved", "all"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const monitoringTestAlertSchema = z.object({
  severity: z.enum(["info", "warning", "error"]).optional(),
  category: z.enum(["request", "auth", "database", "upload", "tenant", "system"]).optional(),
  title: z.string().trim().min(4).max(120).optional(),
  message: z.string().trim().min(4).max(600).optional(),
});

const retryFailedMonitoringDeliverySchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const recoveryDrillSchema = z.object({
  type: z.enum(["tabletop", "restore", "failover", "backup-validation", "other"]).optional(),
  status: z.enum(["passed", "failed", "partial"]),
  title: z.string().trim().min(4).max(120).optional(),
  summary: z.string().trim().min(4).max(600).optional(),
  scope: z.enum(["platform", "tenant", "database", "storage", "service"]).optional(),
  notes: z.string().trim().min(2).max(4000).optional(),
  performedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMinutes: z.coerce.number().min(0).max(24 * 60).optional(),
  tenantId: z.string().uuid().optional(),
});

const recoveryDrillQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["passed", "failed", "partial"]).optional(),
  tenantId: z.string().uuid().optional(),
});

const retentionPruneSchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

router.use(requireAuth, requirePlatformRole());

router.get("/overview", async (_request, response) => {
  response.json(await listPlatformOverview());
});

router.get("/tenants", async (_request, response) => {
  response.json({ tenants: await listPlatformTenants() });
});

router.post("/tenants", async (request, response) => {
  const parsed = createTenantSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid tenant payload" });
    return;
  }

  let result;
  try {
    result = await createTenantWithOwner(parsed.data);
  } catch (error) {
    if (error instanceof PlatformConflictError) {
      response.status(409).json({
        message: error.message,
        code: error.conflictCode,
      });
      return;
    }
    throw error;
  }

  if (!result.tenant || !result.owner) {
    response.status(409).json({ message: "Could not create tenant" });
    return;
  }

  await recordPlatformEventSafe({
    severity: "info",
    category: "tenant",
    title: "Tenant created",
    message: `Tenant ${result.tenant.name} created with owner ${result.owner.email}.`,
    tenantId: result.tenant.id,
    actorUserId: request.auth?.user.id ?? null,
    metadata: {
      ownerId: result.owner.id,
      ownerEmail: result.owner.email,
    },
  });

  response.status(201).json({
    tenant: {
      ...result.tenant,
      createdAt: result.tenant.createdAt.toISOString(),
      updatedAt: result.tenant.updatedAt.toISOString(),
    },
    owner: {
      id: result.owner.id,
      tenantId: result.owner.tenantId,
      name: result.owner.name,
      email: result.owner.email,
      role: result.owner.role,
    },
    temporaryPassword: result.temporaryPassword,
    passwordWasGenerated: result.passwordWasGenerated,
  });
});

router.patch("/tenants/:id/status", async (request, response) => {
  const parsed = tenantStatusSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid tenant status payload" });
    return;
  }

  const tenantId = request.params.id.trim();
  const tenant = await setTenantStatus(tenantId, parsed.data.status);
  if (!tenant) {
    response.status(404).json({ message: "Tenant not found" });
    return;
  }

  await recordPlatformEventSafe({
    severity: parsed.data.status === "inactive" ? "warning" : "info",
    category: "tenant",
    title: "Tenant status updated",
    message: `Tenant ${tenant.name} was marked ${tenant.status}.`,
    tenantId: tenant.id,
    actorUserId: request.auth?.user.id ?? null,
  });

  response.json({
    tenant: {
      ...tenant,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    },
  });
});

router.get("/monitoring", async (request, response) => {
  const parsed = monitoringQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid monitoring query" });
    return;
  }

  response.json(await listPlatformMonitoring(parsed.data));
});

router.post("/monitoring/test-alert", async (request, response) => {
  const parsed = monitoringTestAlertSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid test alert payload" });
    return;
  }

  const now = new Date();
  const actor = request.auth?.user;
  const severity = parsed.data.severity ?? "warning";
  const category = parsed.data.category ?? "system";
  const title = parsed.data.title?.trim() || "Operator test alert";
  const requestPath = "/api/platform/monitoring/test-alert";
  const message =
    parsed.data.message?.trim() ||
    `Manual monitoring test triggered by ${actor?.email ?? actor?.name ?? "platform operator"} at ${now.toISOString()}.`;

  await recordPlatformEvent({
    severity,
    category,
    title,
    message,
    path: requestPath,
    method: "POST",
    statusCode: 202,
    tenantId: actor?.tenantId ?? null,
    actorUserId: actor?.id ?? null,
    requestId: String(request.id),
    metadata: {
      source: "platform_test_alert",
      initiatedByRole: actor?.role ?? "platform_super_admin",
      initiatedByEmail: actor?.email ?? null,
      triggeredAt: now.toISOString(),
      isSynthetic: true,
    },
  });

  response.status(202).json({
    queued: true,
    testAlert: {
      severity,
      category,
      title,
      requestId: String(request.id),
      triggeredAt: now.toISOString(),
    },
  });
});

router.patch("/monitoring/:id/acknowledge", async (request, response) => {
  const actorUserId = request.auth?.user.id;
  if (!actorUserId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const event = await acknowledgePlatformEvent(request.params.id.trim(), actorUserId);
  if (!event) {
    response.status(404).json({ message: "Monitoring event not found" });
    return;
  }

  response.json({ event });
});

router.patch("/monitoring/:id/resolve", async (request, response) => {
  const actorUserId = request.auth?.user.id;
  if (!actorUserId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const event = await resolvePlatformEvent(request.params.id.trim(), actorUserId);
  if (!event) {
    response.status(404).json({ message: "Monitoring event not found" });
    return;
  }

  response.json({ event });
});

router.post("/monitoring/:id/retry-delivery", async (request, response) => {
  const actorUserId = request.auth?.user.id;
  if (!actorUserId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const result = await retryPlatformExternalAlert(request.params.id.trim(), {
    actorUserId,
    requestId: String(request.id),
  });

  if (result.status === "not_found") {
    response.status(404).json({ message: "Monitoring event not found" });
    return;
  }

  response.status(result.status === "retried" ? 202 : 200).json({ result });
});

router.post("/monitoring/retry-failed", async (request, response) => {
  const actorUserId = request.auth?.user.id;
  if (!actorUserId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = retryFailedMonitoringDeliverySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid retry payload" });
    return;
  }

  const result = await retryFailedPlatformExternalAlerts({
    ...parsed.data,
    actorUserId,
    requestId: String(request.id),
  });

  response.status(parsed.data.dryRun ? 200 : 202).json({ result });
});

router.get("/recovery/drills", async (request, response) => {
  const parsed = recoveryDrillQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid recovery drill query" });
    return;
  }

  response.json(await listRecoveryDrillHistory(parsed.data));
});

router.post("/recovery/drills", async (request, response) => {
  const parsed = recoveryDrillSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid recovery drill payload" });
    return;
  }

  const actor = request.auth?.user;
  const drill = await recordRecoveryDrill({
    ...parsed.data,
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    actorEmail: actor?.email ?? null,
    requestId: String(request.id),
  });

  response.status(201).json({ drill });
});

router.get("/retention", async (_request, response) => {
  response.json({ retention: await listPlatformRetentionSummary() });
});

router.post("/retention/prune", async (request, response) => {
  const parsed = retentionPruneSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid retention prune payload" });
    return;
  }

  const actor = request.auth?.user;
  const result = await runPlatformRetentionPrune({
    ...parsed.data,
    actorUserId: actor?.id ?? null,
    requestId: String(request.id),
  });

  response.status(parsed.data.dryRun ? 200 : 202).json({ result });
});

router.get("/settings", async (_request, response) => {
  response.json(await listPlatformSettings());
});

router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (error instanceof PlatformConflictError) {
    response.status(409).json({
      message: error.message,
      code: error.conflictCode,
    });
    return;
  }

  if (error instanceof PlatformFeatureUnavailableError) {
    response.status(409).json({
      message: error.message,
      code: "feature_unavailable",
    });
    return;
  }

  next(error);
});

export default router;
