import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { createId, type PurchaseOrder } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyAdmins, notifyUsersByIds } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { hashSha256 } from "../../lib/security";
import { rateLimit } from "../../middlewares/rate-limit";
import {
  addPurchaseOrderTask,
  deletePurchaseOrder,
  getPurchaseOrderForTenant,
  listPurchaseOrdersForTenant,
  payPurchaseOrderTask,
  PurchaseOrdersServiceError,
  savePurchaseOrder,
} from "./purchase-orders.service";

const router: IRouter = Router();
const purchaseOrderPaymentLimiter = rateLimit({
  name: "purchase-order-task-pay",
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many purchase order payment actions. Please wait before retrying.",
});

const businessIdSchema = z.string().trim().min(1);
const dateSchema = z.string().min(1);

const poTaskSchema = z.object({
  id: businessIdSchema.optional(),
  taskName: z.string().trim().min(2),
  description: z.string().trim().optional(),
  hours: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0.01),
});

const poSchema = z.object({
  id: businessIdSchema.optional(),
  title: z.string().trim().min(2),
  totalAmount: z.coerce.number().min(1),
  vendor: z.string().trim().optional(),
  date: dateSchema,
  notes: z.string().trim().optional(),
  tasks: z.array(poTaskSchema).optional(),
});

type PurchaseOrderCrudIdempotencyScope = "po_create" | "po_update" | "po_archive" | "po_task_create";

class PurchaseOrderCrudIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function idempotencyKeyFrom(request: Request) {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  return header?.trim() || undefined;
}

function requestHashForPoMutation(input: z.infer<typeof poSchema> & { id?: string }) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      title: input.title.trim(),
      totalAmount: Number(input.totalAmount),
      vendor: input.vendor?.trim() ?? "",
      date: input.date.trim(),
      notes: input.notes?.trim() ?? "",
      tasks: (input.tasks ?? []).map((task) => ({
        id: task.id?.trim() ?? "",
        taskName: task.taskName.trim(),
        description: task.description?.trim() ?? "",
        hours: Number(task.hours),
        rate: Number(task.rate),
      })),
    }),
  );
}

function requestHashForPoDelete(input: { purchaseOrderId: string }) {
  return hashSha256(JSON.stringify({ purchaseOrderId: input.purchaseOrderId.trim() }));
}

function requestHashForPoTaskCreate(input: { purchaseOrderId: string; task: z.infer<typeof poTaskSchema> }) {
  return hashSha256(
    JSON.stringify({
      purchaseOrderId: input.purchaseOrderId.trim(),
      task: {
        id: input.task.id?.trim() ?? "",
        taskName: input.task.taskName.trim(),
        description: input.task.description?.trim() ?? "",
        hours: Number(input.task.hours),
        rate: Number(input.task.rate),
      },
    }),
  );
}

async function claimPurchaseOrderCrudIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: PurchaseOrderCrudIdempotencyScope,
  key: string,
  requestHash: string,
) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
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
        eq(idempotencyKeysTable.tenantId, actor.tenantId),
        eq(idempotencyKeysTable.scope, scope),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new PurchaseOrderCrudIdempotencyError("Unable to acquire idempotency lock for this purchase-order request.");
  }
  if (row.requestHash !== requestHash) {
    throw new PurchaseOrderCrudIdempotencyError("This idempotency key is already used for a different purchase-order payload.");
  }

  return { row, created: false };
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    logger.warn({ err: error }, "Failed to deliver notification");
  });
  return Promise.resolve();
}

function recordActor(request: Request): { userId?: string; requestId?: string; tenantId: string; actorName: string; actorRole: ActorRole } {
  return {
    userId: request.auth?.user.id,
    requestId: String(request.id),
    tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  };
}

function notificationActor(request: Request) {
  return {
    id: request.auth?.user.id,
    name: request.auth?.user.name ?? "System",
    role: request.auth?.user.role ?? "system",
    tenantId: request.auth?.user.tenantId,
  } as const;
}

function handleServiceError(error: unknown, response: Response) {
  if (!(error instanceof PurchaseOrdersServiceError)) {
    throw error;
  }

  if (error.code === "not_found") {
    respondNotFound(response, error.message);
    return true;
  }

  if (error.code === "forbidden") {
    response.status(403).json({ message: error.message });
    return true;
  }

  if (error.code === "archived") {
    response.status(409).json({ message: error.message });
    return true;
  }

  if (error.code === "conflict") {
    response.status(409).json({ message: error.message });
    return true;
  }

  if (error.code === "already_paid") {
    response.json({ purchaseOrder: null, duplicate: true });
    return true;
  }

  response.status(400).json({ message: error.message });
  return true;
}

function handlePurchaseOrderCrudIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof PurchaseOrderCrudIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

router.get("/purchase-orders", requireTenantRole("admin"), async (request, response) => {
  const includeArchived = request.query.includeArchived === "true";
  const purchaseOrders = await listPurchaseOrdersForTenant(request.auth?.user.tenantId ?? DEFAULT_TENANT_ID, {
    includeArchived,
  });
  response.json({ purchaseOrders });
});

router.post("/purchase-orders", requireTenantRole("admin"), async (request, response) => {
  const parsed = poSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPoMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPurchaseOrderCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPurchaseOrderCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "po_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePurchaseOrderCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getPurchaseOrderForTenant(idempotencyClaim.row.responseEntityId, tenantId);
      response.json({ purchaseOrder: replayed, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This purchase-order request is already being processed. Please retry shortly." });
    return;
  }

  let purchaseOrder: PurchaseOrder;
  let created = false;
  try {
    const result = await savePurchaseOrder(parsed.data, recordActor(request));
    purchaseOrder = result.purchaseOrder;
    created = result.created;
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: purchaseOrder.id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(created ? 201 : 200).json({ purchaseOrder, duplicate: false });
});

router.route("/purchase-orders/:id").get(async (request, response) => {
  try {
    const purchaseOrder = await getPurchaseOrderForTenant(routeParam(request.params.id), request.auth?.user.tenantId ?? DEFAULT_TENANT_ID);
    response.json({ purchaseOrder });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = poSchema.safeParse({ ...request.body, id: routeParam(request.params.id) });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPoMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPurchaseOrderCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPurchaseOrderCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "po_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePurchaseOrderCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getPurchaseOrderForTenant(idempotencyClaim.row.responseEntityId, tenantId);
      response.json({ purchaseOrder: replayed, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This purchase-order update request is already being processed. Please retry shortly." });
    return;
  }

  let purchaseOrder: PurchaseOrder;
  try {
    purchaseOrder = (await savePurchaseOrder(parsed.data, recordActor(request))).purchaseOrder;
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: purchaseOrder.id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.json({ purchaseOrder, duplicate: false });
}).delete(requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPoDelete({ purchaseOrderId: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPurchaseOrderCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPurchaseOrderCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "po_archive",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePurchaseOrderCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This purchase-order archive request is already being processed. Please retry shortly." });
    return;
  }

  try {
    await deletePurchaseOrder(routeParam(request.params.id), recordActor(request));
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: routeParam(request.params.id),
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(204).send();
});

router.post("/purchase-orders/:id/tasks", requireTenantRole("admin"), async (request, response) => {
  const parsed = poTaskSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order task payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForPoTaskCreate({ purchaseOrderId: routeParam(request.params.id), task: parsed.data }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimPurchaseOrderCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimPurchaseOrderCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "po_task_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handlePurchaseOrderCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const order = await getPurchaseOrderForTenant(routeParam(request.params.id), tenantId);
      const task = idempotencyClaim.row.responseEntityId
        ? order.tasks.find((item) => item.id === idempotencyClaim.row.responseEntityId)
        : null;
      response.json({ task: task ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This purchase-order task request is already being processed. Please retry shortly." });
    return;
  }

  try {
    const result = await addPurchaseOrderTask(routeParam(request.params.id), parsed.data, recordActor(request));
    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: result.task.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    response.status(201).json({ task: result.task, duplicate: false });
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post(
  "/purchase-orders/:id/tasks/:taskId/pay",
  requireTenantRole("admin"),
  purchaseOrderPaymentLimiter,
  async (request, response) => {
  let purchaseOrder: PurchaseOrder;
  let paidTaskAmount = 0;
  let paidTaskName = "";
  let duplicate = false;
  try {
    const result = await payPurchaseOrderTask(routeParam(request.params.id), routeParam(request.params.taskId), recordActor(request), {
      idempotencyKey: idempotencyKeyFrom(request),
    });
    purchaseOrder = result.purchaseOrder;
    paidTaskAmount = result.task.amount;
    paidTaskName = result.task.taskName;
    duplicate = result.wasAlreadyPaid;
  } catch (error) {
    if (error instanceof PurchaseOrdersServiceError && error.code === "already_paid") {
      const existing = await getPurchaseOrderForTenant(routeParam(request.params.id), request.auth?.user.tenantId ?? DEFAULT_TENANT_ID);
      response.json({ purchaseOrder: existing, duplicate: true });
      return;
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!duplicate) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "purchase_order_task_paid",
          title: "PO task paid",
          body: `${paidTaskName} in ${purchaseOrder.title} was marked as paid for ${paidTaskAmount.toLocaleString("en-IN")} INR.`,
          link: "/purchase-orders",
          email: false,
          metadata: { purchaseOrderId: purchaseOrder.id, amount: paidTaskAmount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "purchase_order_task_paid",
          title: "PO task paid",
          body: `${paidTaskName} in ${purchaseOrder.title} was marked as paid for ${paidTaskAmount.toLocaleString("en-IN")} INR.`,
          link: "/purchase-orders",
          email: false,
          metadata: { purchaseOrderId: purchaseOrder.id, amount: paidTaskAmount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.json({ purchaseOrder, duplicate });
  },
);

export default router;
