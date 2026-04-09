import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requirePlatformRole } from "../middlewares/auth";
import {
  createTenantWithOwner,
  listPlatformMonitoring,
  listPlatformOverview,
  listPlatformSettings,
  listPlatformTenants,
  recordPlatformEvent,
  setTenantStatus,
} from "../lib/platform";

const router: IRouter = Router();

const createTenantSchema = z.object({
  name: z.string().trim().min(2),
  slug: z.string().trim().min(2),
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

  const result = await createTenantWithOwner(parsed.data);
  if (!result.tenant || !result.owner) {
    response.status(409).json({ message: "Could not create tenant" });
    return;
  }

  await recordPlatformEvent({
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

  await recordPlatformEvent({
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
  const limit = Math.min(100, Math.max(20, Number(request.query.limit ?? 50) || 50));
  response.json(await listPlatformMonitoring(limit));
});

router.get("/settings", async (_request, response) => {
  response.json(await listPlatformSettings());
});

export default router;
