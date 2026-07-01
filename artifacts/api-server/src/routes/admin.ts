import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditTrailTable, idempotencyKeysTable } from "@workspace/db/schema";
import {
  createAdminAccount,
  createClientAccount,
  createEmployeeAccount,
  deactivateAdminAccount,
  deactivateClientAccount,
  deactivateEmployeeAccount,
  listAdmins,
  listClients,
  listEmployees,
  updateAdminAccount,
  updateClientAccount,
  updateEmployeeAccount,
} from "../lib/auth-service";
import { createId, invalidateBusinessStoreCache } from "../lib/business-store";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../lib/notifications";
import { hashSha256 } from "../lib/security";
import { logger } from "../lib/logger";
import { recordPlatformEventSafe } from "../lib/platform";
import { requireAuth, requireTenantRole } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const mutationLimiter = rateLimit({
  name: "admin-mutations",
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: "Too many admin changes in a short period. Please try again later.",
});

const createEmployeeSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2),
  salary: z.coerce.number().min(0),
  payType: z.enum(["monthly", "hourly"]).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  joiningDate: z.string().date().nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  bankAccountNumber: z.string().trim().max(80).nullable().optional(),
  ifscCode: z.string().trim().max(20).nullable().optional(),
  bankBranch: z.string().trim().max(120).nullable().optional(),
  uan: z.string().trim().max(40).nullable().optional(),
  pfNumber: z.string().trim().max(60).nullable().optional(),
  esiNumber: z.string().trim().max(60).nullable().optional(),
  profilePhotoUrl: z.string().trim().max(2_500_000).nullable().optional(),
  department: z.string().trim().min(2).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().trim().uuid(),
});

const createAdminSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2).optional(),
  department: z.string().trim().min(2).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateAdminSchema = createAdminSchema.extend({
  id: z.string().trim().uuid(),
});

const createClientSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  company: z.string().trim().min(2).optional(),
  address: z.string().trim().optional(),
  website: z.string().trim().optional(),
  billingEmail: z.string().trim().email().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateClientSchema = createClientSchema.extend({
  id: z.string().trim().uuid(),
});

type AdminIdempotencyScope =
  | "admin_admin_create"
  | "admin_admin_update"
  | "admin_admin_delete"
  | "admin_employee_create"
  | "admin_employee_update"
  | "admin_employee_delete"
  | "admin_client_create"
  | "admin_client_update"
  | "admin_client_delete";

class AdminIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

function firstValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid request payload";
}

function classifyAdminRouteError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const normalized = message.toLowerCase();

  if (
    normalized.includes("already exists")
    || normalized.includes("already being processed")
    || normalized.includes("last admin")
    || normalized.includes("cannot remove your own")
    || normalized.includes("already used")
  ) {
    return { status: 409, message };
  }

  if (
    normalized.includes("not found")
    || normalized.includes("no employee found")
    || normalized.includes("no admin found")
    || normalized.includes("no client found")
  ) {
    return { status: 404, message };
  }

  return { status: 400, message };
}

function notificationActor(request: Parameters<typeof requireAuth>[0]) {
  return {
    id: request.auth?.user.id,
    name: request.auth?.user.name ?? "System",
    role: request.auth?.user.role ?? "system",
    tenantId: request.auth?.user.tenantId,
  } as const;
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    logger.warn({ err: error }, "Failed to deliver notification");
  });
  return Promise.resolve();
}

type AuditableUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  employeeId: string | null;
  position: string | null;
  department: string | null;
  salary: number;
  payType: "monthly" | "hourly";
  hourlyRate: number;
  status: "active" | "inactive";
};

function employeeAuditSnapshot(user: AuditableUser | null) {
  if (!user) {
    return null;
  }
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    employeeId: user.employeeId,
    position: user.position,
    department: user.department,
    salary: user.salary,
    payType: user.payType,
    hourlyRate: user.hourlyRate,
    status: user.status,
  };
}

async function recordEmployeeAudit(
  request: Request,
  action: "created" | "updated" | "deactivated",
  target: AuditableUser,
  before: AuditableUser | null,
) {
  const tenantId = request.auth?.user.tenantId;
  if (!tenantId) {
    return;
  }
  const beforeSnapshot = employeeAuditSnapshot(before);
  const afterSnapshot = employeeAuditSnapshot(target);
  const changedFields = afterSnapshot
    ? Object.keys(afterSnapshot).filter(
        (key) =>
          JSON.stringify(beforeSnapshot?.[key as keyof typeof beforeSnapshot])
          !== JSON.stringify(afterSnapshot[key as keyof typeof afterSnapshot]),
      )
    : [];

  try {
    await db.insert(auditTrailTable).values({
      id: createId("audit"),
      tenantId,
      actorUserId: request.auth?.user.id ?? null,
      actorName: request.auth?.user.name ?? "Administrator",
      actorRole: request.auth?.user.role ?? "admin",
      action,
      entityType: "employee",
      entityId: target.id,
      summary: `${action === "created" ? "Created" : action === "updated" ? "Updated" : "Deactivated"} employee record.`,
      requestId: String(request.id ?? ""),
      details: {
        entityLabel: target.name,
        requestId: String(request.id ?? ""),
        changedFields,
        before: beforeSnapshot,
        after: afterSnapshot,
        context: { operation: `employee_${action}` },
      },
    });
    invalidateBusinessStoreCache();
  } catch (error) {
    logger.error({ err: error, targetUserId: target.id }, "Failed to record employee audit event");
  }
}

async function recordPrivilegedAccountEvent(
  request: Request,
  action: "created" | "updated" | "deactivated",
  target: AuditableUser,
) {
  await recordPlatformEventSafe({
    severity: "warning",
    category: "auth",
    title: `Administrator account ${action}`,
    message: `A tenant administrator account was ${action}.`,
    path: request.originalUrl?.split("?")[0] ?? request.url,
    method: request.method,
    statusCode: action === "created" ? 201 : 200,
    tenantId: request.auth?.user.tenantId ?? null,
    actorUserId: request.auth?.user.id ?? null,
    requestId: String(request.id ?? ""),
    metadata: {
      targetUserId: target.id,
      targetRole: target.role,
      action,
    },
  });
}

function idempotencyKeyFrom(request: Request) {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  return header?.trim() || undefined;
}

function handleAdminIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof AdminIdempotencyError)) {
    throw error;
  }

  response.status(409).json({ message: error.message });
  return true;
}

function requestHashForEmployeeCreate(input: z.infer<typeof createEmployeeSchema>) {
  return hashSha256(
    JSON.stringify({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      position: input.position.trim(),
      salary: Number(input.salary),
      payType: input.payType ?? "monthly",
      hourlyRate: Number(input.hourlyRate ?? 0),
      joiningDate: input.joiningDate ?? null,
      bankName: input.bankName?.trim() ?? null,
      bankAccountNumber: input.bankAccountNumber?.trim() ?? null,
      ifscCode: input.ifscCode?.trim() ?? null,
      bankBranch: input.bankBranch?.trim() ?? null,
      uan: input.uan?.trim() ?? null,
      pfNumber: input.pfNumber?.trim() ?? null,
      esiNumber: input.esiNumber?.trim() ?? null,
      profilePhotoUrl: input.profilePhotoUrl?.trim() ?? null,
      department: input.department?.trim() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForAdminCreate(input: z.infer<typeof createAdminSchema>) {
  return hashSha256(
    JSON.stringify({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      position: input.position?.trim() ?? null,
      department: input.department?.trim() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForAdminUpdate(input: z.infer<typeof updateAdminSchema>) {
  return hashSha256(
    JSON.stringify({
      id: input.id.trim(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      position: input.position?.trim() ?? null,
      department: input.department?.trim() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForEmployeeUpdate(input: z.infer<typeof updateEmployeeSchema>) {
  return hashSha256(
    JSON.stringify({
      id: input.id.trim(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      position: input.position.trim(),
      salary: Number(input.salary),
      payType: input.payType ?? "monthly",
      hourlyRate: Number(input.hourlyRate ?? 0),
      joiningDate: input.joiningDate ?? null,
      bankName: input.bankName?.trim() ?? null,
      bankAccountNumber: input.bankAccountNumber?.trim() ?? null,
      ifscCode: input.ifscCode?.trim() ?? null,
      bankBranch: input.bankBranch?.trim() ?? null,
      uan: input.uan?.trim() ?? null,
      pfNumber: input.pfNumber?.trim() ?? null,
      esiNumber: input.esiNumber?.trim() ?? null,
      profilePhotoUrl: input.profilePhotoUrl?.trim() ?? null,
      department: input.department?.trim() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForClientCreate(input: z.infer<typeof createClientSchema>) {
  return hashSha256(
    JSON.stringify({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      company: input.company?.trim() ?? null,
      address: input.address?.trim() ?? null,
      website: input.website?.trim() ?? null,
      billingEmail: input.billingEmail?.trim().toLowerCase() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForClientUpdate(input: z.infer<typeof updateClientSchema>) {
  return hashSha256(
    JSON.stringify({
      id: input.id.trim(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      company: input.company?.trim() ?? null,
      address: input.address?.trim() ?? null,
      website: input.website?.trim() ?? null,
      billingEmail: input.billingEmail?.trim().toLowerCase() ?? null,
      status: input.status ?? "active",
    }),
  );
}

function requestHashForDelete(id: string) {
  return hashSha256(JSON.stringify({ id: id.trim() }));
}

async function claimAdminIdempotency(
  actor: { tenantId?: string; userId?: string },
  scope: AdminIdempotencyScope,
  key: string,
  requestHash: string,
) {
  const tenantId = actor.tenantId?.trim();
  if (!tenantId) {
    throw new AdminIdempotencyError("Unable to acquire idempotency lock without a tenant.");
  }

  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId,
      scope,
      keyHash,
      requestHash,
      status: "processing",
      createdById: actor.userId ?? null,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .returning();

  if (insertedRows[0]) {
    return { row: insertedRows[0], created: true };
  }

  const rows = await db
    .select()
    .from(idempotencyKeysTable)
    .where(
      and(
        eq(idempotencyKeysTable.tenantId, tenantId),
        eq(idempotencyKeysTable.scope, scope),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new AdminIdempotencyError("Unable to acquire idempotency lock for this admin request.");
  }
  if (row.requestHash !== requestHash) {
    throw new AdminIdempotencyError("This idempotency key is already used for a different admin payload.");
  }

  return { row, created: false };
}

async function completeAdminIdempotency(id: string, responseEntityId?: string) {
  await db
    .update(idempotencyKeysTable)
    .set({
      status: "completed",
      responseEntityId: responseEntityId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(idempotencyKeysTable.id, id));
}

async function clearAdminIdempotency(id: string) {
  await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, id));
}

async function findEmployeeById(tenantId?: string, userId?: string | null) {
  if (!tenantId || !userId) {
    return null;
  }
  const employees = await listEmployees(tenantId);
  return employees.find((employee) => employee.id === userId) ?? null;
}

async function findAdminById(tenantId?: string, userId?: string | null) {
  if (!tenantId || !userId) {
    return null;
  }
  const admins = await listAdmins(tenantId);
  return admins.find((admin) => admin.id === userId) ?? null;
}

async function findClientById(tenantId?: string, userId?: string | null) {
  if (!tenantId || !userId) {
    return null;
  }
  const clients = await listClients(tenantId);
  return clients.find((client) => client.id === userId) ?? null;
}

router.use(requireAuth, requireTenantRole("admin"));
router.use((request, response, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return mutationLimiter(request, response, next);
  }

  next();
});

router.get("/employees", async (request, response) => {
  const employees = await listEmployees(request.auth?.user.tenantId);
  response.json({ employees });
});

router.get("/admins", async (request, response) => {
  const admins = await listAdmins(request.auth?.user.tenantId);
  response.json({ admins });
});

router.get("/clients", async (request, response) => {
  const clients = await listClients(request.auth?.user.tenantId);
  response.json({ clients });
});

router.post("/admins", async (request, response) => {
  const parsed = createAdminSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForAdminCreate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_admin_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findAdminById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.status(200).json({
        user,
        onboardingEmailSent: false,
        duplicate: true,
      });
      return;
    }
    response.status(409).json({ message: "This admin create request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await createAdminAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordPrivilegedAccountEvent(request, "created", result.user);
    response.status(201).json({
      user: result.user,
      onboardingEmailSent: result.onboardingEmailSent,
      duplicate: false,
      ...(process.env.NODE_ENV !== "production" ? { temporaryPassword: result.temporaryPassword } : {}),
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to create admin");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.post("/employees", async (request, response) => {
  const parsed = createEmployeeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForEmployeeCreate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_employee_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findEmployeeById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.status(200).json({
        user,
        employeeId: user?.employeeId ?? null,
        onboardingEmailSent: false,
        duplicate: true,
      });
      return;
    }
    response.status(409).json({ message: "This employee create request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await createEmployeeAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_onboarded",
          title: "Employee account created",
          body: `${result.user.name} was added to the team.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_onboarded",
          title: "Your Yojak account is ready",
          body: "Your employee profile has been created and your onboarding email has been sent.",
          link: "/login",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "employee_onboarded",
          title: "New employee added",
          body: `${result.user.name} joined the team.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
        actor.id ? [actor.id] : [],
      ),
    );
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordEmployeeAudit(request, "created", result.user, null);
    response.status(201).json({
      user: result.user,
      employeeId: result.user.employeeId,
      onboardingEmailSent: result.onboardingEmailSent,
      duplicate: false,
      ...(process.env.NODE_ENV !== "production" ? { temporaryPassword: result.temporaryPassword } : {}),
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to create employee");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.post("/clients", async (request, response) => {
  const parsed = createClientSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForClientCreate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_client_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findClientById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.status(200).json({
        user,
        onboardingEmailSent: false,
        duplicate: true,
      });
      return;
    }
    response.status(409).json({ message: "This client create request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await createClientAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_onboarded",
          title: "Client account created",
          body: `${result.user.name} was added as a client contact.`,
          link: "/clients",
          email: false,
          metadata: {
            userId: result.user.id,
            entityType: "client",
          },
        },
      ),
    );
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    response.status(201).json({
      user: result.user,
      onboardingEmailSent: result.onboardingEmailSent,
      duplicate: false,
      ...(process.env.NODE_ENV !== "production" ? { temporaryPassword: result.temporaryPassword } : {}),
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to create client");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.patch("/admins/:id", async (request, response) => {
  const parsed = updateAdminSchema.safeParse({
    ...request.body,
    id: request.params.id,
  });

  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForAdminUpdate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_admin_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findAdminById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.json({ user, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This admin update request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await updateAdminAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordPrivilegedAccountEvent(request, "updated", result.user);
    response.json({ user: result.user, duplicate: false });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to update admin");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.patch("/employees/:id", async (request, response) => {
  const parsed = updateEmployeeSchema.safeParse({
    ...request.body,
    id: request.params.id,
  });

  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForEmployeeUpdate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_employee_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findEmployeeById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.json({ user, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This employee update request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const before = await findEmployeeById(request.auth?.user.tenantId, parsed.data.id);
    const result = await updateEmployeeAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_updated",
          title: "Employee updated",
          body: `${result.user.name}'s profile was updated.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_updated",
          title: "Your employee profile was updated",
          body: "An admin updated your employee record. Please review it when convenient.",
          link: "/employee/profile",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordEmployeeAudit(request, "updated", result.user, before);
    response.json({
      user: result.user,
      duplicate: false,
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to update employee");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.patch("/clients/:id", async (request, response) => {
  const parsed = updateClientSchema.safeParse({
    ...request.body,
    id: request.params.id,
  });

  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForClientUpdate(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_client_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const user = await findClientById(request.auth?.user.tenantId, idempotencyClaim.row.responseEntityId);
      response.json({ user, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This client update request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await updateClientAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    response.json({ user: result.user, duplicate: false });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to update client");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.delete("/employees/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee id" });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForDelete(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_employee_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.json({ user: null, message: "Employee deactivated", duplicate: true });
      return;
    }
    response.status(409).json({ message: "This employee delete request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const before = await findEmployeeById(request.auth?.user.tenantId, parsed.data);
    const result = await deactivateEmployeeAccount(parsed.data, request.auth?.user.tenantId);
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_deactivated",
          title: "Employee deactivated",
          body: `${result.user.name} was removed from active access.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_deactivated",
          title: "Your account has been deactivated",
          body: "Your Yojak access has been removed. Please contact the administrator if you need help.",
          link: "/login",
          email: true,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordEmployeeAudit(request, "deactivated", result.user, before);
    response.json({
      user: result.user,
      message: "Employee deactivated",
      duplicate: false,
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to deactivate employee");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.delete("/admins/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid admin id" });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForDelete(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_admin_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.json({ user: null, message: "Admin removed", duplicate: true });
      return;
    }
    response.status(409).json({ message: "This admin delete request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await deactivateAdminAccount(parsed.data, request.auth?.user.tenantId, request.auth?.user.id);
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    await recordPrivilegedAccountEvent(request, "deactivated", result.user);
    response.json({
      user: result.user,
      message: "Admin removed",
      duplicate: false,
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to remove admin");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

router.delete("/clients/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid client id" });
    return;
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForDelete(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimAdminIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimAdminIdempotency(
            { tenantId: request.auth?.user.tenantId, userId: request.auth?.user.id },
            "admin_client_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleAdminIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.json({ user: null, message: "Client removed", duplicate: true });
      return;
    }
    response.status(409).json({ message: "This client delete request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await deactivateClientAccount(parsed.data, request.auth?.user.tenantId);
    if (idempotencyClaim?.created) {
      await completeAdminIdempotency(idempotencyClaim.row.id, result.user.id);
    }
    response.json({
      user: result.user,
      message: "Client removed",
      duplicate: false,
    });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await clearAdminIdempotency(idempotencyClaim.row.id);
    }
    const resolved = classifyAdminRouteError(error, "Failed to remove client");
    response.status(resolved.status).json({ message: resolved.message });
  }
});

export default router;
