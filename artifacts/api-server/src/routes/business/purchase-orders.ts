import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { type PurchaseOrder } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyAdmins, notifyUsersByIds } from "../../lib/notifications";
import {
  addPurchaseOrderTask,
  deletePurchaseOrder,
  getPurchaseOrderForTenant,
  listPurchaseOrdersForTenant,
  payPurchaseOrderTask,
  PurchaseOrdersServiceError,
  savePurchaseOrder,
} from "../../lib/services/purchase-orders-service";

const router: IRouter = Router();

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

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    console.error("Failed to deliver notification", error);
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

  if (error.code === "already_paid") {
    response.json({ purchaseOrder: null });
    return true;
  }

  response.status(400).json({ message: error.message });
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

  let purchaseOrder: PurchaseOrder;
  let created = false;
  try {
    const result = await savePurchaseOrder(parsed.data, recordActor(request));
    purchaseOrder = result.purchaseOrder;
    created = result.created;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(created ? 201 : 200).json({ purchaseOrder });
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

  let purchaseOrder: PurchaseOrder;
  try {
    purchaseOrder = (await savePurchaseOrder(parsed.data, recordActor(request))).purchaseOrder;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.json({ purchaseOrder });
}).delete(requireTenantRole("admin"), async (request, response) => {
  try {
    await deletePurchaseOrder(routeParam(request.params.id), recordActor(request));
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(204).send();
});

router.post("/purchase-orders/:id/tasks", requireTenantRole("admin"), async (request, response) => {
  const parsed = poTaskSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid purchase order task payload" });
    return;
  }

  try {
    const result = await addPurchaseOrderTask(routeParam(request.params.id), parsed.data, recordActor(request));
    response.status(201).json({ task: result.task });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post("/purchase-orders/:id/tasks/:taskId/pay", requireTenantRole("admin"), async (request, response) => {
  let purchaseOrder: PurchaseOrder;
  let paidTaskAmount = 0;
  let paidTaskName = "";
  try {
    const result = await payPurchaseOrderTask(routeParam(request.params.id), routeParam(request.params.taskId), recordActor(request));
    purchaseOrder = result.purchaseOrder;
    paidTaskAmount = result.task.amount;
    paidTaskName = result.task.taskName;
  } catch (error) {
    if (error instanceof PurchaseOrdersServiceError && error.code === "already_paid") {
      const existing = await getPurchaseOrderForTenant(routeParam(request.params.id), request.auth?.user.tenantId ?? DEFAULT_TENANT_ID);
      response.json({ purchaseOrder: existing });
      return;
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

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

  response.json({ purchaseOrder });
});

export default router;
