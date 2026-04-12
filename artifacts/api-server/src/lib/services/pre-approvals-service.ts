import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  fundsTable,
  idempotencyKeysTable,
  preApprovalsTable,
  usersTable,
  type ActorRole,
  type PreApproval as DbPreApproval,
  type PreApprovalCommentRecord,
  type PreApprovalProjectInfoRecord,
  type PreApprovalTaskRecord,
} from "@workspace/db/schema";
import { auditTrailTable } from "../../../../../lib/db/src/schema/business";
import { type AuditTrailDetailsRecord, createId, invalidateBusinessStoreCache, normalizeDate, nowIso } from "../business-store";
import { assertActorRoleAccess, assertClientSelfAccess, assertTenantAccess } from "../policies";
import { hashSha256 } from "../security";
import { DEFAULT_TENANT_ID } from "../tenants";
import { assertWorkflowTransition } from "../workflow-state";

export type PreApprovalActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type PreApprovalPartyInfoInput = {
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
};

export type PreApprovalTaskInput = {
  id?: string;
  taskName: string;
  description?: string;
  hours: number;
  rate: number;
};

export type PreApprovalInput = {
  title: string;
  project: string;
  clientId: string;
  date: string;
  notes?: string;
  companyInfo?: PreApprovalPartyInfoInput;
  clientInfo?: PreApprovalPartyInfoInput;
  projectInfo?: PreApprovalProjectInfoRecord;
  tasks?: PreApprovalTaskInput[];
};

export class PreApprovalsServiceError extends Error {
  code: "not_found" | "forbidden" | "invalid_state" | "invalid_input" | "conflict";

  constructor(code: "not_found" | "forbidden" | "invalid_state" | "invalid_input" | "conflict", message: string) {
    super(message);
    this.code = code;
  }
}

function calculateTaskAmount(hours: number, rate: number) {
  return Math.round(Math.max(0, Number(hours ?? 0)) * Math.max(0, Number(rate ?? 0)));
}

function normalizeTask(task: PreApprovalTaskInput): PreApprovalTaskRecord {
  const hours = Math.max(0, Number(task.hours ?? 0));
  const rate = Math.max(0, Number(task.rate ?? 0));
  return {
    id: task.id ?? createId("pa_task"),
    taskName: task.taskName.trim(),
    description: task.description?.trim() || "",
    hours,
    rate,
    amount: calculateTaskAmount(hours, rate),
  };
}

function computeTotals(row: Pick<DbPreApproval, "tasks">) {
  const tasks = Array.isArray(row.tasks) ? row.tasks : [];
  return {
    totalHours: tasks.reduce((sum, task) => sum + Math.max(0, Number(task.hours ?? 0)), 0),
    totalAmount: tasks.reduce((sum, task) => sum + Math.max(0, Number(task.amount ?? 0)), 0),
  };
}

async function insertPreApprovalAudit(input: {
  tenantId: string;
  actorUserId?: string;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  entityType: "pre-approval" | "pre-approval-comment";
  entityId: string;
  summary: string;
  requestId?: string;
  details?: AuditTrailDetailsRecord;
}) {
  await db.insert(auditTrailTable).values({
    id: createId("audit"),
    tenantId: input.tenantId.trim() || DEFAULT_TENANT_ID,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    requestId: input.requestId ?? null,
    details: input.details ?? null,
    createdAt: new Date(),
  });
}

function summarizePreApproval(row: Pick<DbPreApproval, "title" | "project" | "clientId" | "clientNameSnapshot" | "status" | "receivedFundId" | "submittedAt" | "approvedAt" | "receivedAt" | "tasks">) {
  return {
    title: row.title,
    project: row.project,
    clientId: row.clientId,
    clientNameSnapshot: row.clientNameSnapshot,
    status: row.status,
    totalRows: Array.isArray(row.tasks) ? row.tasks.length : 0,
    totalAmount: computeTotals(row).totalAmount,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    receivedFundId: row.receivedFundId ?? null,
  };
}

async function loadClientUser(clientId: string, tenantId: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, clientId),
        eq(usersTable.role, "client"),
        eq(usersTable.status, "active"),
        eq(usersTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function assertActorCanAccess(actor: PreApprovalActor, preApproval: DbPreApproval) {
  assertTenantAccess(preApproval.tenantId ?? DEFAULT_TENANT_ID, actor.tenantId, () => new PreApprovalsServiceError("forbidden", "Forbidden"));
  assertClientSelfAccess(preApproval.clientId, actor.actorRole, actor.userId, () => new PreApprovalsServiceError("forbidden", "Forbidden"));
}

function requestHashForReceiveFunds(input: { preApprovalId: string }) {
  return hashSha256(JSON.stringify({ preApprovalId: input.preApprovalId.trim() }));
}

function requestHashForSubmit(input: { preApprovalId: string }) {
  return hashSha256(JSON.stringify({ preApprovalId: input.preApprovalId.trim() }));
}

function requestHashForApprove(input: { preApprovalId: string }) {
  return hashSha256(JSON.stringify({ preApprovalId: input.preApprovalId.trim() }));
}

function requestHashForRequestChanges(input: { preApprovalId: string; message: string }) {
  return hashSha256(
    JSON.stringify({
      preApprovalId: input.preApprovalId.trim(),
      message: input.message.trim(),
    }),
  );
}

function requestHashForComment(input: { preApprovalId: string; message: string }) {
  return hashSha256(
    JSON.stringify({
      preApprovalId: input.preApprovalId.trim(),
      message: input.message.trim(),
    }),
  );
}

async function claimPreApprovalIdempotency(
  actor: PreApprovalActor,
  scope:
    | "pre_approval_receive_funds"
    | "pre_approval_submit"
    | "pre_approval_approve"
    | "pre_approval_request_changes"
    | "pre_approval_comment",
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

  const existingRows = await db
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

  const row = existingRows[0];
  if (!row) {
    throw new PreApprovalsServiceError("conflict", "Unable to acquire idempotency lock for this request.");
  }
  if (row.requestHash !== requestHash) {
    throw new PreApprovalsServiceError("conflict", "This idempotency key is already used for a different request payload.");
  }

  return { row, created: false };
}

async function claimReceiveFundsIdempotency(actor: PreApprovalActor, key: string, requestHash: string) {
  return claimPreApprovalIdempotency(actor, "pre_approval_receive_funds", key, requestHash);
}

export async function listPreApprovalsForActor(actor: PreApprovalActor) {
  const rows = await db
    .select()
    .from(preApprovalsTable)
    .where(
      actor.actorRole === "client"
        ? and(eq(preApprovalsTable.tenantId, actor.tenantId), eq(preApprovalsTable.clientId, actor.userId ?? ""))
        : eq(preApprovalsTable.tenantId, actor.tenantId),
    )
    .orderBy(desc(preApprovalsTable.updatedAt));

  return rows;
}

export async function getPreApprovalForActor(id: string, actor: PreApprovalActor) {
  const rows = await db.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, id)).limit(1);
  const preApproval = rows[0];
  if (!preApproval) {
    throw new PreApprovalsServiceError("not_found", "Pre-approval not found");
  }
  assertActorCanAccess(actor, preApproval);
  return preApproval;
}

export async function createPreApproval(input: PreApprovalInput, actor: PreApprovalActor) {
  const client = await loadClientUser(input.clientId, actor.tenantId);
  if (!client) {
    throw new PreApprovalsServiceError("invalid_input", "Select a valid active client.");
  }

  const now = new Date();
  const tasks = (input.tasks ?? []).map(normalizeTask).filter((task) => task.taskName && task.amount > 0);
  const rows = await db
    .insert(preApprovalsTable)
    .values({
      id: createId("pa"),
      tenantId: actor.tenantId,
      title: input.title.trim(),
      project: input.project.trim(),
      clientId: client.id,
      clientNameSnapshot: client.name,
      date: new Date(normalizeDate(input.date)),
      notes: input.notes?.trim() || "",
      companyInfo: input.companyInfo ?? {},
      clientInfo: input.clientInfo ?? {},
      projectInfo: input.projectInfo ?? {},
      status: "draft",
      createdById: actor.userId ?? null,
      tasks,
      comments: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "created",
    entityType: "pre-approval",
    entityId: rows[0]!.id,
    summary: `Created pre-approval ${rows[0]!.title} for ${client.name}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: rows[0]!.title,
      requestId: actor.requestId,
      changedFields: ["title", "project", "clientId", "status", "tasks"],
      before: null,
      after: summarizePreApproval(rows[0]!),
      context: { operation: "pre_approval_create" },
    },
  });

  return rows[0]!;
}

export async function updatePreApproval(id: string, input: PreApprovalInput, actor: PreApprovalActor) {
  const existing = await getPreApprovalForActor(id, actor);
  if (existing.status !== "draft" && existing.status !== "changes_requested") {
    throw new PreApprovalsServiceError("invalid_state", "Only draft or change-requested pre-approvals can be edited.");
  }

  const client = await loadClientUser(input.clientId, actor.tenantId);
  if (!client) {
    throw new PreApprovalsServiceError("invalid_input", "Select a valid active client.");
  }

  const tasks = (input.tasks ?? []).map(normalizeTask).filter((task) => task.taskName && task.amount > 0);
  const rows = await db
    .update(preApprovalsTable)
    .set({
      title: input.title.trim(),
      project: input.project.trim(),
      tenantId: actor.tenantId,
      clientId: client.id,
      clientNameSnapshot: client.name,
      date: new Date(normalizeDate(input.date)),
      notes: input.notes?.trim() || "",
      companyInfo: input.companyInfo ?? {},
      clientInfo: input.clientInfo ?? {},
      projectInfo: input.projectInfo ?? {},
      tasks,
      status: existing.status === "changes_requested" ? "draft" : existing.status,
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "updated",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Updated pre-approval ${input.title.trim()}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: rows[0]!.title,
      requestId: actor.requestId,
      changedFields: ["title", "project", "clientId", "tasks"],
      before: summarizePreApproval(existing),
      after: summarizePreApproval(rows[0]!),
      context: { operation: "pre_approval_update" },
    },
  });

  return rows[0]!;
}

export async function deletePreApproval(id: string, actor: PreApprovalActor) {
  const existing = await getPreApprovalForActor(id, actor);
  if (existing.status !== "draft" && existing.status !== "changes_requested") {
    throw new PreApprovalsServiceError("invalid_state", "Only draft or change-requested pre-approvals can be deleted.");
  }

  await db.delete(preApprovalsTable).where(eq(preApprovalsTable.id, existing.id));
  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "deleted",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Deleted pre-approval ${existing.title}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: existing.title,
      requestId: actor.requestId,
      changedFields: ["deleted"],
      before: summarizePreApproval(existing),
      after: null,
      context: { operation: "pre_approval_delete" },
    },
  });
}

export async function submitPreApproval(id: string, actor: PreApprovalActor, options?: { idempotencyKey?: string | null }) {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForSubmit({ preApprovalId: id }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash ? await claimPreApprovalIdempotency(actor, "pre_approval_submit", idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await getPreApprovalForActor(id, actor);
      return { preApproval: latest, wasAlreadySubmitted: true };
    }
    throw new PreApprovalsServiceError("conflict", "This submit request is already being processed. Please retry shortly.");
  }

  try {
  const existing = await getPreApprovalForActor(id, actor);
  if (existing.status === "submitted") {
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
    return { preApproval: existing, wasAlreadySubmitted: true };
  }
  if (existing.tasks.length === 0) {
    throw new PreApprovalsServiceError("invalid_state", "Add at least one work row before sending for client approval.");
  }
  try {
    assertWorkflowTransition("preApprovalSubmission", existing.status, "submitted");
  } catch (error) {
    throw new PreApprovalsServiceError("invalid_state", error instanceof Error ? error.message : "Invalid pre-approval transition.");
  }

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "submitted",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `Sent pre-approval ${existing.title} to ${existing.clientNameSnapshot}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: updatedRows[0]!.title,
      requestId: actor.requestId,
      changedFields: ["status", "submittedAt"],
      before: summarizePreApproval(existing),
      after: summarizePreApproval(updatedRows[0]!),
      context: { operation: "pre_approval_submit" },
    },
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

    return { preApproval: updatedRows[0]!, wasAlreadySubmitted: false };
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
}

export async function addPreApprovalComment(
  id: string,
  message: string,
  actor: PreApprovalActor,
  options?: { idempotencyKey?: string | null },
) {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForComment({ preApprovalId: id, message }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash
      ? await claimPreApprovalIdempotency(actor, "pre_approval_comment", idempotencyKey, requestHash)
      : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await getPreApprovalForActor(id, actor);
      const replayedComment = idempotencyClaim.row.responseEntityId
        ? latest.comments.find((item) => item.id === idempotencyClaim.row.responseEntityId)
        : latest.comments.at(-1);
      return { preApproval: latest, comment: replayedComment, wasDuplicate: true };
    }
    throw new PreApprovalsServiceError("conflict", "This comment request is already being processed. Please retry shortly.");
  }

  try {
    const existing = await getPreApprovalForActor(id, actor);
    assertActorRoleAccess(actor.actorRole, ["admin", "client"], () => new PreApprovalsServiceError("forbidden", "Forbidden"));

    const comment: PreApprovalCommentRecord = {
      id: createId("pa_comment"),
      authorId: actor.userId,
      authorName: actor.actorName,
      authorRole: actor.actorRole === "client" ? "client" : "admin",
      message,
      createdAt: nowIso(),
    };

    const updatedRows = await db
      .update(preApprovalsTable)
      .set({
        comments: [...existing.comments, comment],
        updatedAt: new Date(),
      })
      .where(eq(preApprovalsTable.id, existing.id))
      .returning();

    await insertPreApprovalAudit({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      action: "commented",
      entityType: "pre-approval-comment",
      entityId: comment.id,
      summary: `${comment.authorName} commented on ${existing.title}.`,
      requestId: actor.requestId,
      details: {
        entityLabel: existing.title,
        requestId: actor.requestId,
        changedFields: ["comment"],
        before: null,
        after: { authorName: comment.authorName, authorRole: comment.authorRole, message: comment.message },
        context: { operation: "pre_approval_comment", preApprovalId: existing.id },
      },
    });

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: comment.id,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }

    return { preApproval: updatedRows[0]!, comment, wasDuplicate: false };
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
}

export async function approvePreApproval(id: string, actor: PreApprovalActor, options?: { idempotencyKey?: string | null }) {
  assertActorRoleAccess(actor.actorRole, ["client", "admin"], () => new PreApprovalsServiceError("forbidden", "Forbidden"));
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForApprove({ preApprovalId: id }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash ? await claimPreApprovalIdempotency(actor, "pre_approval_approve", idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await getPreApprovalForActor(id, actor);
      return { preApproval: latest, wasAlreadyApproved: true };
    }
    throw new PreApprovalsServiceError("conflict", "This approve request is already being processed. Please retry shortly.");
  }

  try {
  const existing = await getPreApprovalForActor(id, actor);
  if (existing.status === "approved") {
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
    return { preApproval: existing, wasAlreadyApproved: true };
  }
  try {
    assertWorkflowTransition("preApprovalApproval", existing.status, "approved");
  } catch (error) {
    throw new PreApprovalsServiceError("invalid_state", error instanceof Error ? error.message : "Invalid pre-approval transition.");
  }

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "approved",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `${existing.clientNameSnapshot} approved pre-approval ${existing.title}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: updatedRows[0]!.title,
      requestId: actor.requestId,
      changedFields: ["status", "approvedAt"],
      before: summarizePreApproval(existing),
      after: summarizePreApproval(updatedRows[0]!),
      context: { operation: "pre_approval_approve" },
    },
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

    return { preApproval: updatedRows[0]!, wasAlreadyApproved: false };
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
}

export async function requestPreApprovalChanges(
  id: string,
  message: string,
  actor: PreApprovalActor,
  options?: { idempotencyKey?: string | null },
) {
  assertActorRoleAccess(actor.actorRole, ["client", "admin"], () => new PreApprovalsServiceError("forbidden", "Forbidden"));
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForRequestChanges({ preApprovalId: id, message }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash
      ? await claimPreApprovalIdempotency(actor, "pre_approval_request_changes", idempotencyKey, requestHash)
      : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await getPreApprovalForActor(id, actor);
      const latestComment = latest.comments.at(-1);
      return { preApproval: latest, comment: latestComment, wasAlreadyRequested: true };
    }
    throw new PreApprovalsServiceError("conflict", "This request-changes action is already being processed. Please retry shortly.");
  }

  try {
  const existing = await getPreApprovalForActor(id, actor);
  if (existing.status === "changes_requested") {
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
    const latestComment = existing.comments.at(-1);
    return { preApproval: existing, comment: latestComment, wasAlreadyRequested: true };
  }
  try {
    assertWorkflowTransition("preApprovalApproval", existing.status, "changes_requested");
  } catch (error) {
    throw new PreApprovalsServiceError("invalid_state", error instanceof Error ? error.message : "Invalid pre-approval transition.");
  }

  const comment: PreApprovalCommentRecord = {
    id: createId("pa_comment"),
    authorId: actor.userId,
    authorName: actor.actorName || existing.clientNameSnapshot,
    authorRole: "client",
    message,
    createdAt: nowIso(),
  };

  const updatedRows = await db
    .update(preApprovalsTable)
    .set({
      status: "changes_requested",
      comments: [...existing.comments, comment],
      updatedAt: new Date(),
    })
    .where(eq(preApprovalsTable.id, existing.id))
    .returning();

  await insertPreApprovalAudit({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    action: "changes_requested",
    entityType: "pre-approval",
    entityId: existing.id,
    summary: `${existing.clientNameSnapshot} requested changes for ${existing.title}.`,
    requestId: actor.requestId,
    details: {
      entityLabel: updatedRows[0]!.title,
      requestId: actor.requestId,
      changedFields: ["status", "comments"],
      before: summarizePreApproval(existing),
      after: summarizePreApproval(updatedRows[0]!),
      context: { operation: "pre_approval_request_changes", message },
    },
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

    return { preApproval: updatedRows[0]!, comment, wasAlreadyRequested: false };
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
}

export async function receivePreApprovalFunds(id: string, actor: PreApprovalActor, options?: { idempotencyKey?: string | null }) {
  assertActorRoleAccess(actor.actorRole, ["admin"], () => new PreApprovalsServiceError("forbidden", "Forbidden"));
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForReceiveFunds({ preApprovalId: id }) : null;
  const idempotencyClaim =
    idempotencyKey && requestHash ? await claimReceiveFundsIdempotency(actor, idempotencyKey, requestHash) : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await getPreApprovalForActor(id, actor);
      return { preApproval: latest, wasAlreadyReceived: true };
    }
    throw new PreApprovalsServiceError("conflict", "This receivable request is already being processed. Please retry shortly.");
  }

  try {
    const existing = await getPreApprovalForActor(id, actor);
    if (existing.status !== "approved") {
      throw new PreApprovalsServiceError("invalid_state", "Only client-approved pre-approvals can be marked as received.");
    }

    const totalAmount = computeTotals(existing).totalAmount;
    if (totalAmount <= 0) {
      throw new PreApprovalsServiceError("invalid_state", "This pre-approval does not have a receivable quotation amount.");
    }

    const now = new Date();
    const fundId = createId("fund");
    let updatedPreApproval: DbPreApproval = existing;
    let wasAlreadyReceived = false;

    if (existing.receivedAt || existing.receivedFundId) {
      wasAlreadyReceived = true;
    } else {
      try {
        updatedPreApproval = await db.transaction(async (transaction) => {
          await transaction.insert(fundsTable).values({
            id: fundId,
            tenantId: actor.tenantId,
            source: `Pre Approval - ${existing.title}`,
            amount: totalAmount,
            date: now,
            note: `Received from ${existing.clientNameSnapshot} for ${existing.project}.`,
            createdAt: now,
            updatedAt: now,
          } as never);

          const updatedRows = await transaction
            .update(preApprovalsTable)
            .set({
              receivedAt: now,
              receivedFundId: fundId,
              updatedAt: now,
            })
            .where(and(eq(preApprovalsTable.id, existing.id), eq(preApprovalsTable.status, "approved"), eq(preApprovalsTable.tenantId, actor.tenantId)))
            .returning();

          if (updatedRows.length === 0) {
            const latestRows = await transaction.select().from(preApprovalsTable).where(eq(preApprovalsTable.id, existing.id)).limit(1);
            const latest = latestRows[0];
            if (latest?.receivedFundId || latest?.receivedAt) {
              throw new PreApprovalsServiceError("invalid_state", "Funds for this pre-approval were already marked as received.");
            }
            throw new PreApprovalsServiceError("invalid_state", "Only client-approved pre-approvals can be marked as received.");
          }

          return updatedRows[0]!;
        });
      } catch (error) {
        if (error instanceof PreApprovalsServiceError && error.code === "invalid_state") {
          const latest = await getPreApprovalForActor(id, actor);
          if (latest.receivedFundId || latest.receivedAt) {
            updatedPreApproval = latest;
            wasAlreadyReceived = true;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

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

    if (wasAlreadyReceived) {
      return { preApproval: updatedPreApproval, wasAlreadyReceived: true };
    }

    invalidateBusinessStoreCache();

    await insertPreApprovalAudit({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      action: "funds_received",
      entityType: "pre-approval",
      entityId: existing.id,
      summary: `Marked INR ${totalAmount} received for pre-approval ${existing.title}.`,
      requestId: actor.requestId,
      details: {
        entityLabel: updatedPreApproval.title,
        requestId: actor.requestId,
        changedFields: ["receivedAt", "receivedFundId"],
        before: summarizePreApproval(existing),
        after: summarizePreApproval(updatedPreApproval),
        context: { operation: "pre_approval_receive_funds", totalAmount, fundId },
      },
    });

    return { preApproval: updatedPreApproval, wasAlreadyReceived: false };
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    throw error;
  }
}
