import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import {
  type ApprovalStatus,
  type BusinessStore,
  type ExpenseRecord,
  createId,
  loadEmployeeProfile,
  normalizeDate,
  nowIso,
  pushAuditEvent,
  readStore,
  updateStore,
} from "../../lib/business-store";
import { assertEmployeeSelfAccess, assertTenantAccess } from "../../lib/policies";
import { hashSha256 } from "../../lib/security";
import { assertWorkflowTransition } from "../../lib/workflow-state";
import { assertActorRoleAccess } from "../../lib/policies";
import { assertFinancialAccount, availableFundsByAccount } from "../../lib/financial-accounts";

export type ExpenseActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type ExpenseInput = {
  id?: string;
  accountId?: string;
  employeeId?: string;
  employeeNameSnapshot?: string;
  project?: string;
  category: string;
  group: "personal" | "office";
  amount: number;
  date: string;
  description: string;
  note?: string;
  attachmentName?: string;
  attachmentPath?: string;
  reimbursable?: boolean;
  status?: ApprovalStatus;
  reviewerNote?: string;
};

export class ExpensesServiceError extends Error {
  code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_state" | "invalid_input" | "conflict";

  constructor(code: "not_found" | "forbidden" | "insufficient_funds" | "invalid_state" | "invalid_input" | "conflict", message: string) {
    super(message);
    this.code = code;
  }
}

function ensureFunds(store: BusinessStore, amount: number, label: string, tenantId: string, accountId: string) {
  const required = Math.abs(Number(amount ?? 0));
  const available = availableFundsByAccount(store, tenantId, accountId);
  if (required > available) {
    throw new ExpensesServiceError(
      "insufficient_funds",
      `Insufficient funds in the selected account for ${label}. Available balance is ${available.toLocaleString("en-IN")} INR.`,
    );
  }
}

function summarizeExpense(expense: Pick<ExpenseRecord, "accountId" | "employeeId" | "employeeNameSnapshot" | "category" | "group" | "amount" | "date" | "status" | "project" | "description" | "note" | "reviewerNote">) {
  return {
    accountId: expense.accountId ?? null,
    employeeId: expense.employeeId ?? null,
    employeeNameSnapshot: expense.employeeNameSnapshot ?? null,
    category: expense.category,
    group: expense.group,
    amount: expense.amount,
    date: expense.date,
    project: expense.project ?? null,
    description: expense.description,
    note: expense.note ?? "",
    status: expense.status,
    reviewerNote: expense.reviewerNote ?? null,
  };
}

function changedExpenseFields(previous: ExpenseRecord | null, next: ExpenseRecord) {
  const candidates: Array<keyof ReturnType<typeof summarizeExpense>> = [
    "accountId",
    "employeeId",
    "employeeNameSnapshot",
    "category",
    "group",
    "amount",
    "date",
    "project",
    "description",
    "note",
    "status",
    "reviewerNote",
  ];
  if (!previous) {
    return candidates;
  }
  const before = summarizeExpense(previous);
  const after = summarizeExpense(next);
  return candidates.filter((key) => before[key] !== after[key]);
}

function requestHashForExpenseReview(input: { expenseId: string; status: ApprovalStatus; reviewerNote?: string }) {
  return hashSha256(
    JSON.stringify({
      expenseId: input.expenseId.trim(),
      status: input.status,
      reviewerNote: input.reviewerNote?.trim() ?? "",
    }),
  );
}

async function claimExpenseReviewIdempotency(actor: ExpenseActor, key: string, requestHash: string) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
      scope: "expense_review",
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
        eq(idempotencyKeysTable.scope, "expense_review"),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new ExpensesServiceError("conflict", "Unable to acquire idempotency lock for this expense review request.");
  }
  if (row.requestHash !== requestHash) {
    throw new ExpensesServiceError("conflict", "This idempotency key is already used for a different expense review payload.");
  }

  return { row, created: false };
}

export async function getExpenseForTenant(id: string, tenantId: string, requesterUserId?: string, requesterRole?: string) {
  const store = await readStore();
  const expense = store.expenses.find((item) => item.id === id);
  if (!expense) {
    throw new ExpensesServiceError("not_found", "Expense not found");
  }

  assertActorRoleAccess(requesterRole, ["admin", "employee"], () => new ExpensesServiceError("forbidden", "Forbidden"));
  assertTenantAccess(expense.tenantId, tenantId, () => new ExpensesServiceError("forbidden", "Forbidden"));
  assertEmployeeSelfAccess(expense.employeeId, requesterRole, requesterUserId, () => new ExpensesServiceError("forbidden", "Forbidden"));

  return expense;
}

export async function saveExpense(input: ExpenseInput, actor: ExpenseActor, requesterUserId?: string, requesterRole?: string) {
  assertActorRoleAccess(requesterRole, ["admin", "employee"], () => new ExpensesServiceError("forbidden", "Forbidden"));
  const employee = input.employeeId ? await loadEmployeeProfile(input.employeeId, actor.tenantId) : null;

  assertEmployeeSelfAccess(input.employeeId, requesterRole, requesterUserId, () => new ExpensesServiceError("forbidden", "Forbidden"));
  if (requesterRole === "employee" && input.group !== "office") {
    throw new ExpensesServiceError("forbidden", "Employees can only submit office expenses.");
  }

  let expense: ExpenseRecord | null = null;
  let created = false;
  let existing: ExpenseRecord | null = null;
  let action: "created" | "updated" | "approved" = "updated";

  await updateStore((current) => {
    existing = input.id ? current.expenses.find((item) => item.id === input.id) ?? null : null;
    const status: ApprovalStatus = input.status ?? existing?.status ?? "submitted";

    if (existing) {
      assertTenantAccess(existing.tenantId, actor.tenantId, () => new ExpensesServiceError("forbidden", "Forbidden"));
    }

    if (!existing && (status === "approved" || status === "rejected")) {
      throw new ExpensesServiceError("invalid_state", "Use the expense review action to approve or reject an expense.");
    }

    if (existing?.status === "approved") {
      throw new ExpensesServiceError("invalid_state", "Approved expenses cannot be edited.");
    }

    if (existing?.status === "submitted" && status !== "submitted") {
      throw new ExpensesServiceError("invalid_state", "Use the expense review action to approve or reject an expense.");
    }

    if (existing?.status === "rejected" && status !== "rejected" && status !== "submitted") {
      throw new ExpensesServiceError("invalid_state", "Rejected expenses can only be edited in place or resubmitted.");
    }

    if (existing?.status === "draft" && status !== "draft" && status !== "submitted") {
      throw new ExpensesServiceError("invalid_state", "Draft expenses can only stay draft or be submitted.");
    }

    const nextAmount = Math.abs(input.amount);
    if (nextAmount <= 0) {
      throw new ExpensesServiceError("invalid_input", "Expense amount must be greater than zero.");
    }

    const selectedAccountId =
      requesterRole === "employee"
        ? existing?.accountId
        : input.accountId?.trim() || existing?.accountId;
    if (status === "approved") {
      if (!selectedAccountId) {
        throw new ExpensesServiceError("invalid_input", "Select a Paid Through account before approving this expense.");
      }
      assertFinancialAccount(current, actor.tenantId, selectedAccountId);
      if (!existing || existing.status !== "approved") {
        ensureFunds(current, nextAmount, "this expense", actor.tenantId, selectedAccountId);
      }
    }

    expense = {
      id: input.id ?? existing?.id ?? createId("exp"),
      tenantId: actor.tenantId,
      accountId: status === "approved" ? selectedAccountId : requesterRole === "employee" ? undefined : selectedAccountId,
      employeeId: input.employeeId,
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() || existing?.employeeNameSnapshot || employee?.name,
      project: input.project?.trim() || existing?.project,
      category: input.category.trim(),
      group: input.group,
      amount: nextAmount,
      date: normalizeDate(input.date),
      description: input.description.trim(),
      note: input.note?.trim() || existing?.note,
      attachmentName: input.attachmentName?.trim() || existing?.attachmentName,
      attachmentPath: input.attachmentPath?.trim() || existing?.attachmentPath,
      reimbursable: input.reimbursable ?? existing?.reimbursable ?? input.group === "office",
      status,
      reviewerNote: input.reviewerNote?.trim() || existing?.reviewerNote,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    created = !existing;
    action = existing ? "updated" : "created";

    return pushAuditEvent(
      {
        ...current,
        expenses: existing ? current.expenses.map((item) => (item.id === expense!.id ? expense! : item)) : [expense, ...current.expenses],
      },
        {
          ...actor,
          action,
          entityType: "expense",
          entityId: expense.id,
          summary: existing
            ? "Updated an expense submission."
            : `Submitted ${expense.group} expense for ${expense.amount.toLocaleString("en-IN")} INR.`,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          details: {
            entityLabel: expense.description,
            requestId: actor.requestId,
            changedFields: changedExpenseFields(existing, expense),
            before: existing ? summarizeExpense(existing) : null,
            after: summarizeExpense(expense),
            context: existing ? { operation: "expense_update" } : { operation: "expense_create" },
          },
        },
      );
  });

  return { expense: expense!, created, existing, action };
}

export async function deleteExpense(id: string, actor: ExpenseActor, requesterUserId?: string, requesterRole?: string) {
  assertActorRoleAccess(requesterRole, ["admin", "employee"], () => new ExpensesServiceError("forbidden", "Forbidden"));
  let existing: ExpenseRecord | null = null;
  await updateStore((current) => {
    existing = current.expenses.find((expense) => expense.id === id) ?? null;
    if (!existing) {
      throw new ExpensesServiceError("not_found", "Expense not found");
    }

    assertTenantAccess(existing.tenantId, actor.tenantId, () => new ExpensesServiceError("forbidden", "Forbidden"));
    assertEmployeeSelfAccess(existing.employeeId, requesterRole, requesterUserId, () => new ExpensesServiceError("forbidden", "Forbidden"));

    return pushAuditEvent(
      {
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== id),
      },
      {
        ...actor,
        action: "deleted",
        entityType: "expense",
        entityId: id,
        summary: "Deleted an expense submission.",
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: existing.description,
          requestId: actor.requestId,
          changedFields: ["deleted"],
          before: summarizeExpense(existing),
          after: null,
          context: { operation: "expense_delete" },
        },
      },
    );
  });
  return existing!;
}

export async function setExpenseStatus(
  id: string,
  nextStatus: ApprovalStatus,
  reviewerNote: string | undefined,
  actor: ExpenseActor,
  options?: { idempotencyKey?: string | null; accountId?: string | null },
) {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey
    ? requestHashForExpenseReview({ expenseId: id, status: nextStatus, reviewerNote })
    : null;
  const idempotencyClaim =
    idempotencyKey && requestHash ? await claimExpenseReviewIdempotency(actor, idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const existingExpense = await getExpenseForTenant(id, actor.tenantId);
      return { expense: existingExpense, previousStatus: existingExpense.status, wasNoop: true };
    }
    throw new ExpensesServiceError("conflict", "This expense review request is already being processed. Please retry shortly.");
  }

  let expense: ExpenseRecord | null = null;
  let previousStatus: ApprovalStatus = "draft";
  let wasNoop = false;
  try {
    await updateStore((current) => {
      const existing = current.expenses.find((item) => item.id === id);
      if (!existing) {
        throw new ExpensesServiceError("not_found", "Expense not found");
      }

      assertTenantAccess(existing.tenantId, actor.tenantId, () => new ExpensesServiceError("forbidden", "Forbidden"));

      previousStatus = existing.status;
      if (existing.status === nextStatus && (reviewerNote?.trim() || undefined) === (existing.reviewerNote || undefined)) {
        expense = existing;
        wasNoop = true;
        return current;
      }

      try {
        assertWorkflowTransition("expense", existing.status, nextStatus);
      } catch (error) {
        throw new ExpensesServiceError("invalid_state", error instanceof Error ? error.message : "Invalid expense state transition.");
      }

      const selectedAccountId =
        nextStatus === "approved"
          ? options?.accountId?.trim() || existing.accountId
          : existing.accountId;
      if (nextStatus === "approved") {
        if (!selectedAccountId) {
          throw new ExpensesServiceError("invalid_input", "Select a Paid Through account before approving this expense.");
        }
        assertFinancialAccount(current, actor.tenantId, selectedAccountId);
      }

      if (nextStatus === "approved" && existing.status !== "approved") {
        ensureFunds(current, existing.amount, "this expense", actor.tenantId, selectedAccountId!);
      }

      expense = {
        ...existing,
        accountId: nextStatus === "approved" ? selectedAccountId : existing.accountId,
        status: nextStatus,
        reviewerNote: reviewerNote?.trim() || undefined,
        updatedAt: nowIso(),
      };

      return pushAuditEvent(
        {
          ...current,
          expenses: current.expenses.map((item) => (item.id === expense!.id ? expense! : item)),
        },
        {
          ...actor,
          action: nextStatus === "approved" ? "approved" : "rejected",
          entityType: "expense",
          entityId: expense.id,
          summary: `${nextStatus === "approved" ? "Approved" : "Rejected"} an expense submission.`,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          details: {
            entityLabel: expense.description,
            requestId: actor.requestId,
            changedFields: changedExpenseFields(existing, expense),
            before: summarizeExpense(existing),
            after: summarizeExpense(expense),
            context: { operation: "expense_review", previousStatus: existing.status, nextStatus },
          },
        },
      );
    });

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: id,
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

  return { expense: expense!, previousStatus, wasNoop };
}
