import { type ActorRole } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable } from "@workspace/db/schema";
import {
  type BusinessStore,
  createId,
  normalizeDate,
  nowIso,
  pushAuditEvent,
  readStore,
  type ExpenseRecord,
  type FundRecord,
  type PurchaseOrder,
  type SalaryRecord,
  updateStore,
} from "../business-store";
import { assertTenantAccess } from "../policies";
import { hashSha256 } from "../security";
import { DEFAULT_TENANT_ID } from "../tenants";

export type PurchaseOrderActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type PurchaseOrderInput = {
  id?: string;
  title: string;
  totalAmount: number;
  vendor?: string;
  date: string;
  notes?: string;
  tasks?: Array<{
    id?: string;
    taskName: string;
    description?: string;
    hours: number;
    rate: number;
  }>;
};

export type PurchaseOrderTaskInput = {
  id?: string;
  taskName: string;
  description?: string;
  hours: number;
  rate: number;
};

export class PurchaseOrdersServiceError extends Error {
  code:
    | "not_found"
    | "forbidden"
    | "archived"
    | "insufficient_funds"
    | "invalid_planned_amount"
    | "invalid_total_amount"
    | "already_paid"
    | "conflict";

  constructor(
    code:
      | "not_found"
      | "forbidden"
      | "archived"
      | "insufficient_funds"
      | "invalid_planned_amount"
      | "invalid_total_amount"
      | "already_paid"
      | "conflict",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function calculatePoTaskAmount(hours: number, rate: number) {
  return Math.round(Math.max(0, Number(hours ?? 0)) * Math.max(0, Number(rate ?? 0)));
}

function sumPurchaseOrderTasks(tasks: Array<{ amount: number }>) {
  return tasks.reduce((sum, task) => sum + Math.abs(Number(task.amount ?? 0)), 0);
}

function tenantPurchaseOrderFilter(order: PurchaseOrder, tenantId: string) {
  return (order.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantExpenseFilter(expense: ExpenseRecord, tenantId: string) {
  return (expense.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return (fund.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function tenantSalaryFilter(salary: SalaryRecord, tenantId: string) {
  return (salary.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function availableFunds(store: BusinessStore, tenantId?: string) {
  const totalFunds = store.funds
    .filter((fund) => (tenantId ? tenantFundFilter(fund, tenantId) : true))
    .reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const spentExpenses = store.expenses
    .filter((expense) => expense.status === "approved")
    .filter((expense) => (tenantId ? tenantExpenseFilter(expense, tenantId) : true))
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const spentSalary = store.salaries
    .filter((salary) => salary.status === "paid")
    .filter((salary) => (tenantId ? tenantSalaryFilter(salary, tenantId) : true))
    .reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);
  return Math.max(0, Number((totalFunds - spentExpenses - spentSalary).toFixed(2)));
}

function ensureFunds(store: BusinessStore, amount: number, label: string, tenantId?: string) {
  const required = Math.abs(Number(amount ?? 0));
  const available = availableFunds(store, tenantId);
  if (required > available) {
    throw new PurchaseOrdersServiceError(
      "insufficient_funds",
      `Insufficient total funds for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`,
    );
  }
}

type PurchaseOrderSummary = {
  status: "active" | "archived";
  title: string;
  totalAmount: number;
  usedAmount: number;
  remainingAmount: number;
  vendor: string | null;
  date: string;
  notes: string;
};

function summarizePurchaseOrder(order: Pick<PurchaseOrder, "status" | "title" | "totalAmount" | "usedAmount" | "remainingAmount" | "vendor" | "date" | "notes"> | null | undefined): PurchaseOrderSummary | null {
  if (!order) {
    return null;
  }

  return {
    status: order.status === "archived" ? "archived" : "active",
    title: order.title,
    totalAmount: order.totalAmount,
    usedAmount: order.usedAmount,
    remainingAmount: order.remainingAmount,
    vendor: order.vendor ?? null,
    date: order.date,
    notes: order.notes ?? "",
  };
}

function summarizePurchaseOrderTask(task: PurchaseOrder["tasks"][number]) {
  return {
    taskName: task.taskName,
    description: task.description,
    hours: task.hours,
    rate: task.rate,
    amount: task.amount,
    status: task.status,
    paidAt: task.paidAt ?? null,
  };
}

function changedPurchaseOrderFields(previous: PurchaseOrder | null | undefined, next: PurchaseOrder) {
  const candidates: Array<keyof PurchaseOrderSummary> = [
    "title",
    "totalAmount",
    "usedAmount",
    "remainingAmount",
    "vendor",
    "date",
    "notes",
  ];
  if (!previous) {
    return candidates;
  }
  const before = summarizePurchaseOrder(previous)!;
  const after = summarizePurchaseOrder(next)!;
  return candidates.filter((key) => before[key] !== after[key]);
}

function requestHashForPoTaskPay(input: { orderId: string; taskId: string }) {
  return hashSha256(
    JSON.stringify({
      orderId: input.orderId.trim(),
      taskId: input.taskId.trim(),
    }),
  );
}

async function claimPoTaskPayIdempotency(actor: PurchaseOrderActor, key: string, requestHash: string) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
      scope: "po_task_pay",
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

  const existingRows = await db
    .select()
    .from(idempotencyKeysTable)
    .where(
      and(
        eq(idempotencyKeysTable.tenantId, actor.tenantId),
        eq(idempotencyKeysTable.scope, "po_task_pay"),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new PurchaseOrdersServiceError("conflict", "Unable to acquire idempotency lock for this PO task pay request.");
  }
  if (row.requestHash !== requestHash) {
    throw new PurchaseOrdersServiceError("conflict", "This idempotency key is already used for a different PO task pay payload.");
  }

  return { row, created: false };
}

export async function listPurchaseOrdersForTenant(tenantId: string, options?: { includeArchived?: boolean }) {
  const store = await readStore();
  return store.purchaseOrders
    .filter((order) => tenantPurchaseOrderFilter(order, tenantId))
    .filter((order) => options?.includeArchived || order.status !== "archived")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function getPurchaseOrderForTenant(id: string, tenantId: string) {
  const store = await readStore();
  const purchaseOrder = store.purchaseOrders.find((order) => order.id === id);
  if (!purchaseOrder) {
    throw new PurchaseOrdersServiceError("not_found", "Purchase order not found");
  }
  if (!tenantPurchaseOrderFilter(purchaseOrder, tenantId)) {
    throw new PurchaseOrdersServiceError("forbidden", "Forbidden");
  }
  if (purchaseOrder.status === "archived") {
    throw new PurchaseOrdersServiceError("archived", "This purchase order has been archived.");
  }
  return purchaseOrder;
}

export async function savePurchaseOrder(input: PurchaseOrderInput, actor: PurchaseOrderActor) {
  let purchaseOrder: PurchaseOrder | null = null;
  let created = false;

  await updateStore((current) => {
    const existing = input.id ? current.purchaseOrders.find((order) => order.id === input.id) : null;
    if (existing) {
      assertTenantAccess(existing.tenantId, actor.tenantId, () => new PurchaseOrdersServiceError("forbidden", "Forbidden"));
      if (existing.status === "archived") {
        throw new PurchaseOrdersServiceError("archived", "Archived purchase orders cannot be edited.");
      }
    }

    const existingTaskMap = new Map((existing?.tasks ?? []).map((task) => [task.id, task]));
    const tasks = (input.tasks ?? existing?.tasks ?? [])
      .map((task) => {
        const hours = Math.max(0, Number(task.hours ?? 0));
        const rate = Math.max(0, Number(task.rate ?? 0));
        const matchedExistingTask = task.id ? existingTaskMap.get(task.id) : null;
        return {
          id: task.id ?? createId("po_task"),
          taskName: task.taskName.trim(),
          description: task.description?.trim() || "",
          hours,
          rate,
          amount: calculatePoTaskAmount(hours, rate),
          status: matchedExistingTask?.status ?? ("pending" as const),
          paidAt: matchedExistingTask?.paidAt,
        };
      })
      .filter((task) => task.taskName.trim() && task.amount > 0);

    const totalAmount = Math.abs(input.totalAmount);
    const plannedAmount = sumPurchaseOrderTasks(tasks);
    if (plannedAmount > totalAmount) {
      throw new PurchaseOrdersServiceError("invalid_planned_amount", "Planned work rows cannot exceed the PO cap amount.");
    }
    if (existing && totalAmount < existing.usedAmount) {
      throw new PurchaseOrdersServiceError("invalid_total_amount", "Total fund amount cannot be less than the used amount.");
    }
    if (existing && totalAmount < plannedAmount) {
      throw new PurchaseOrdersServiceError("invalid_total_amount", "PO cap cannot be less than the total of all work rows.");
    }

    purchaseOrder = {
      id: input.id ?? existing?.id ?? createId("po"),
      tenantId: actor.tenantId,
      status: existing?.status ?? "active",
      title: input.title.trim(),
      totalAmount,
      usedAmount: existing?.usedAmount ?? 0,
      remainingAmount: existing ? Math.max(0, totalAmount - existing.usedAmount) : totalAmount,
      vendor: input.vendor?.trim() || existing?.vendor,
      date: normalizeDate(input.date),
      notes: input.notes?.trim() || existing?.notes,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      tasks,
    };
    created = !existing;

    return pushAuditEvent(
      {
        ...current,
        purchaseOrders: existing
          ? current.purchaseOrders.map((item) => (item.id === purchaseOrder!.id ? purchaseOrder! : item))
          : [purchaseOrder, ...current.purchaseOrders],
      },
      {
        ...actor,
        action: existing ? "updated" : "created",
        entityType: "purchase-order",
        entityId: purchaseOrder.id,
        summary: `${existing ? "Updated" : "Created"} budget sheet ${purchaseOrder.title}.`,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: purchaseOrder.title,
          requestId: actor.requestId,
          changedFields: changedPurchaseOrderFields(existing, purchaseOrder),
          before: existing ? summarizePurchaseOrder(existing) : null,
          after: summarizePurchaseOrder(purchaseOrder),
          context: {
            operation: existing ? "purchase_order_update" : "purchase_order_create",
            taskCount: purchaseOrder.tasks.length,
          },
        },
      },
    );
  });

  return { purchaseOrder: purchaseOrder!, created };
}

export async function deletePurchaseOrder(id: string, actor: PurchaseOrderActor) {
  let existing: PurchaseOrder | null = null;
  await updateStore((current) => {
    existing = current.purchaseOrders.find((order) => order.id === id) ?? null;
    if (!existing) {
      throw new PurchaseOrdersServiceError("not_found", "Purchase order not found");
    }
    assertTenantAccess(existing.tenantId, actor.tenantId, () => new PurchaseOrdersServiceError("forbidden", "Forbidden"));
    if (existing.status === "archived") {
      return current;
    }
    if (existing.usedAmount > 0 || existing.tasks.some((task) => task.status === "paid")) {
      throw new PurchaseOrdersServiceError("invalid_total_amount", "Paid purchase orders cannot be deleted. Keep the sheet for record history.");
    }
    const archivedOrder: PurchaseOrder = {
      ...existing,
      status: "archived",
      updatedAt: nowIso(),
    };

    return pushAuditEvent(
      {
        ...current,
        purchaseOrders: current.purchaseOrders.map((order) => (order.id === id ? archivedOrder : order)),
      },
      {
        ...actor,
        action: "archived",
        entityType: "purchase-order",
        entityId: id,
        summary: `Archived budget sheet ${existing.title}.`,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: existing.title,
          requestId: actor.requestId,
          changedFields: ["status"],
          before: summarizePurchaseOrder(existing),
          after: summarizePurchaseOrder(archivedOrder),
          context: { operation: "purchase_order_archive" },
        },
      },
    );
  });
  return existing!;
}

export async function addPurchaseOrderTask(orderId: string, input: PurchaseOrderTaskInput, actor: PurchaseOrderActor) {
  let task: PurchaseOrder["tasks"][number] | null = null;
  await updateStore((current) => {
    const existing = current.purchaseOrders.find((order) => order.id === orderId);
    if (!existing) {
      throw new PurchaseOrdersServiceError("not_found", "Purchase order not found");
    }
    assertTenantAccess(existing.tenantId, actor.tenantId, () => new PurchaseOrdersServiceError("forbidden", "Forbidden"));
    if (existing.status === "archived") {
      throw new PurchaseOrdersServiceError("archived", "Archived purchase orders cannot be modified.");
    }

    const taskHours = Math.max(0, Number(input.hours ?? 0));
    const taskRate = Math.max(0, Number(input.rate ?? 0));
    task = {
      id: input.id ?? createId("po_task"),
      taskName: input.taskName.trim(),
      description: input.description?.trim() || "",
      hours: taskHours,
      rate: taskRate,
      amount: calculatePoTaskAmount(taskHours, taskRate),
      status: "pending" as const,
    };
    if (task.amount <= 0) {
      throw new PurchaseOrdersServiceError("invalid_planned_amount", "Task total must be greater than zero.");
    }

    const plannedAmount = sumPurchaseOrderTasks(existing.tasks) + task.amount;
    if (plannedAmount > existing.totalAmount) {
      throw new PurchaseOrdersServiceError(
        "invalid_planned_amount",
        "This row exceeds the remaining PO cap. Increase the cap or lower the row total.",
      );
    }

    return pushAuditEvent(
      {
        ...current,
        purchaseOrders: current.purchaseOrders.map((order) =>
          order.id === existing.id ? { ...order, tasks: [...order.tasks, task!], updatedAt: nowIso() } : order,
        ),
      },
      {
        ...actor,
        action: "created",
        entityType: "purchase-order-task",
        entityId: task.id,
        summary: `Added task ${task.taskName} to ${existing.title}.`,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: task.taskName,
          requestId: actor.requestId,
          changedFields: ["taskName", "description", "hours", "rate", "amount", "status"],
          before: null,
          after: summarizePurchaseOrderTask(task),
          context: { operation: "purchase_order_task_create", purchaseOrderId: existing.id, purchaseOrderTitle: existing.title },
        },
      },
    );
  });
  return { task: task! };
}

export async function payPurchaseOrderTask(
  orderId: string,
  taskId: string,
  actor: PurchaseOrderActor,
  options?: { idempotencyKey?: string | null },
) {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForPoTaskPay({ orderId, taskId }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash ? await claimPoTaskPayIdempotency(actor, idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const store = await readStore();
      const existingOrder = store.purchaseOrders.find((item) => item.id === orderId);
      const existingTask = existingOrder?.tasks.find((item) => item.id === taskId);
      if (!existingOrder || !existingTask) {
        throw new PurchaseOrdersServiceError("not_found", "Purchase order task not found");
      }
      assertTenantAccess(existingOrder.tenantId, actor.tenantId, () => new PurchaseOrdersServiceError("forbidden", "Forbidden"));
      return { purchaseOrder: existingOrder, task: existingTask, wasAlreadyPaid: true };
    }
    throw new PurchaseOrdersServiceError("conflict", "This PO task pay request is already being processed. Please retry shortly.");
  }

  let purchaseOrder: PurchaseOrder | null = null;
  let task: PurchaseOrder["tasks"][number] | null = null;
  let wasAlreadyPaid = false;

  try {
    await updateStore((current) => {
      const order = current.purchaseOrders.find((item) => item.id === orderId);
      const currentTask = order?.tasks.find((item) => item.id === taskId);
      if (!order || !currentTask) {
        throw new PurchaseOrdersServiceError("not_found", "Purchase order task not found");
      }
      assertTenantAccess(order.tenantId, actor.tenantId, () => new PurchaseOrdersServiceError("forbidden", "Forbidden"));
      if (order.status === "archived") {
        throw new PurchaseOrdersServiceError("archived", "Archived purchase orders cannot be paid.");
      }
      if (currentTask.status === "paid") {
        task = currentTask;
        purchaseOrder = order;
        wasAlreadyPaid = true;
        return current;
      }
      if (currentTask.amount > order.remainingAmount) {
        throw new PurchaseOrdersServiceError("invalid_total_amount", "Insufficient balance in PO fund");
      }

      ensureFunds(current, currentTask.amount, "this PO task payment", actor.tenantId);
      const now = nowIso();
      task = { ...currentTask, status: "paid" as const, paidAt: now };
      purchaseOrder = {
        ...order,
        usedAmount: Number((order.usedAmount + currentTask.amount).toFixed(2)),
        remainingAmount: Math.max(0, Number((order.remainingAmount - currentTask.amount).toFixed(2))),
        tasks: order.tasks.map((row) => (row.id === currentTask.id ? task! : row)),
        updatedAt: now,
      };

      return pushAuditEvent(
        {
          ...current,
          expenses: [
            {
              id: createId("exp"),
              tenantId: actor.tenantId,
              category: "Budget Sheet",
              group: "office",
              amount: currentTask.amount,
              date: now,
              description: `${order.title} - ${currentTask.taskName}`,
              note: currentTask.description,
              reimbursable: true,
              status: "approved",
              createdAt: now,
              updatedAt: now,
            },
            ...current.expenses,
          ],
          purchaseOrders: current.purchaseOrders.map((item) => (item.id === order.id ? purchaseOrder! : item)),
        },
        {
          ...actor,
          action: "paid",
          entityType: "purchase-order-task",
          entityId: currentTask.id,
          summary: `Marked ${currentTask.taskName} as paid in ${order.title}.`,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          details: {
            entityLabel: currentTask.taskName,
            requestId: actor.requestId,
            changedFields: ["status", "paidAt", "usedAmount", "remainingAmount"],
            before: {
              task: summarizePurchaseOrderTask(currentTask),
              purchaseOrder: summarizePurchaseOrder(order),
            },
            after: {
              task: summarizePurchaseOrderTask(task),
              purchaseOrder: summarizePurchaseOrder(purchaseOrder),
            },
            context: { operation: "purchase_order_task_pay", expenseAmount: currentTask.amount },
          },
        },
      );
    });

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: taskId,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }

  return { purchaseOrder: purchaseOrder!, task: task!, wasAlreadyPaid };
}
