import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { type ApprovalStatus, type ExpenseRecord } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { resolveExpenseAttachmentUrl } from "../../lib/storage";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../../lib/notifications";
import {
  deleteExpense,
  ExpensesServiceError,
  getExpenseForTenant,
  saveExpense,
  setExpenseStatus,
} from "../../lib/services/expenses-service";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);
const dateSchema = z.string().min(1);
const approvalStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);

const expenseSchema = z.object({
  id: businessIdSchema.optional(),
  employeeId: z.string().uuid().optional(),
  employeeNameSnapshot: z.string().trim().optional(),
  project: z.string().trim().optional(),
  category: z.string().trim().min(2),
  group: z.enum(["personal", "office"]),
  amount: z.coerce.number().min(1),
  date: dateSchema,
  description: z.string().trim().min(2),
  note: z.string().trim().optional(),
  attachmentName: z.string().trim().optional(),
  attachmentPath: z.string().trim().optional(),
  reimbursable: z.boolean().optional(),
  status: approvalStatusSchema.optional(),
  reviewerNote: z.string().trim().optional(),
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

async function serializeExpense(expense: ExpenseRecord) {
  return {
    ...expense,
    attachmentUrl: await resolveExpenseAttachmentUrl(expense.attachmentPath),
  };
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
  if (!(error instanceof ExpensesServiceError)) {
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

  if (error.code === "insufficient_funds") {
    response.status(400).json({ message: error.message });
    return true;
  }

  if (error.code === "invalid_state") {
    response.status(409).json({ message: error.message });
    return true;
  }

  if (error.code === "invalid_input") {
    response.status(400).json({ message: error.message });
    return true;
  }

  return false;
}

router.post("/expenses", async (request, response) => {
  const parsed = expenseSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense payload" });
    return;
  }

  let expense: ExpenseRecord;
  let created = false;
  try {
    const result = await saveExpense(
      {
        ...parsed.data,
        employeeId: request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId?.trim() || undefined,
        employeeNameSnapshot:
          request.auth?.user.role === "employee" ? request.auth.user.name ?? "Employee" : parsed.data.employeeNameSnapshot,
      },
      recordActor(request),
      request.auth?.user.id,
      request.auth?.user.role,
    );
    expense = result.expense;
    created = result.created;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (request.auth?.user.role === "employee" && created) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "expense_submitted",
          title: "Expense submitted",
          body: `Your ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR is awaiting review.`,
          link: "/employee/expenses",
          email: false,
          metadata: { expenseId: expense.id, category: expense.category },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "expense_submitted",
          title: "New expense needs review",
          body: `${expense.employeeNameSnapshot ?? "An employee"} submitted ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR.`,
          link: "/expenses",
          email: true,
          metadata: { expenseId: expense.id, category: expense.category, employeeId: expense.employeeId },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.status(created ? 201 : 200).json({ expense: await serializeExpense(expense) });
});

router.route("/expenses/:id").get(async (request, response) => {
  try {
    const expense = await getExpenseForTenant(
      routeParam(request.params.id),
      request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      request.auth?.user.id,
      request.auth?.user.role,
    );
    response.json({ expense: await serializeExpense(expense) });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).patch(async (request, response) => {
  const parsed = expenseSchema.safeParse({ ...request.body, id: routeParam(request.params.id) });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense payload" });
    return;
  }

  let expense: ExpenseRecord;
  try {
    expense = (
      await saveExpense(
        {
          ...parsed.data,
          employeeId: request.auth?.user.role === "employee" ? request.auth.user.id : parsed.data.employeeId?.trim() || undefined,
          employeeNameSnapshot:
            request.auth?.user.role === "employee" ? request.auth.user.name ?? "Employee" : parsed.data.employeeNameSnapshot,
        },
        recordActor(request),
        request.auth?.user.id,
        request.auth?.user.role,
      )
    ).expense;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.json({ expense: await serializeExpense(expense) });
}).delete(async (request, response) => {
  try {
    await deleteExpense(
      routeParam(request.params.id),
      recordActor(request),
      request.auth?.user.id,
      request.auth?.user.role,
    );
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(204).send();
});

router.patch("/expenses/:id/status", requireTenantRole("admin"), async (request, response) => {
  const parsed = z.object({
    status: approvalStatusSchema,
    reviewerNote: z.string().trim().optional(),
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid expense status payload" });
    return;
  }

  let expense: ExpenseRecord;
  let previousStatus: ApprovalStatus;
  let wasNoop = false;
  try {
    const result = await setExpenseStatus(
      routeParam(request.params.id),
      parsed.data.status,
      parsed.data.reviewerNote,
      recordActor(request),
    );
    expense = result.expense;
    previousStatus = result.previousStatus;
    wasNoop = result.wasNoop;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!wasNoop && expense.employeeId && expense.status !== previousStatus && (expense.status === "approved" || expense.status === "rejected")) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyEmployee(
        expense.employeeId,
        actor,
        {
          type: expense.status === "approved" ? "expense_approved" : "expense_rejected",
          title: expense.status === "approved" ? "Expense approved" : "Expense returned",
          body:
            expense.status === "approved"
              ? `Your expense for ${expense.amount.toLocaleString("en-IN")} INR was approved.`
              : `Your expense was rejected${expense.reviewerNote ? `: ${expense.reviewerNote}` : "."}`,
          link: "/employee/expenses",
          email: true,
          metadata: { expenseId: expense.id, reviewerNote: expense.reviewerNote },
        },
      ),
    );
  }

  response.json({ expense: await serializeExpense(expense), duplicate: wasNoop });
});

export default router;
