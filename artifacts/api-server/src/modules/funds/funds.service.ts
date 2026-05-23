import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
import {
  type FundRecord,
  createId,
  normalizeDate,
  nowIso,
  pushAuditEvent,
  readStore,
  updateStore,
} from "../../lib/business-store";
import { hashSha256 } from "../../lib/security";
import { assertTenantAccess } from "../../lib/policies";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { resolveFundReceiptUrl } from "../../lib/storage";

export type FundActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type FundInput = {
  id?: string;
  source: string;
  amount: number;
  date: string;
  note?: string;
  receiptName?: string;
  receiptPath?: string;
};

export class FundsServiceError extends Error {
  code: "not_found" | "forbidden" | "conflict" | "invalid_input";

  constructor(code: "not_found" | "forbidden" | "conflict" | "invalid_input", message: string) {
    super(message);
    this.code = code;
  }
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return (fund.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function normalizedFundPayload(input: FundInput) {
  return {
    source: input.source.trim(),
    amount: Math.abs(input.amount),
    date: normalizeDate(input.date),
    note: input.note?.trim() ?? "",
    receiptName: input.receiptName?.trim() ?? "",
    receiptPath: input.receiptPath?.trim() ?? "",
  };
}

function requestHashForFund(input: FundInput) {
  return hashSha256(JSON.stringify(normalizedFundPayload(input)));
}

function summarizeFund(fund: Pick<FundRecord, "source" | "amount" | "date" | "note" | "receiptName"> | null | undefined) {
  if (!fund) {
    return null;
  }

  return {
    source: fund.source,
    amount: fund.amount,
    date: fund.date,
    note: fund.note || "",
    receiptName: fund.receiptName || "",
  };
}

function changedFundFields(previous: FundRecord | null | undefined, next: FundRecord) {
  if (!previous) {
    return ["source", "amount", "date", "note", "receiptName", "receiptPath"];
  }

  const fields: string[] = [];
  if (previous.source !== next.source) fields.push("source");
  if (previous.amount !== next.amount) fields.push("amount");
  if (previous.date !== next.date) fields.push("date");
  if ((previous.note || "") !== (next.note || "")) fields.push("note");
  if ((previous.receiptName || "") !== (next.receiptName || "")) fields.push("receiptName");
  if ((previous.receiptPath || "") !== (next.receiptPath || "")) fields.push("receiptPath");
  return fields;
}

async function attachFundReceiptUrl(fund: FundRecord) {
  if (!fund.receiptPath) {
    return fund;
  }

  const receiptUrl = await resolveFundReceiptUrl(fund.receiptPath);
  return {
    ...fund,
    receiptUrl,
  };
}

async function claimFundCreateIdempotency(actor: FundActor, key: string, requestHash: string) {
  return claimFundIdempotency(actor, "fund_create", key, requestHash);
}

async function claimFundIdempotency(
  actor: FundActor,
  scope: "fund_create" | "fund_update" | "fund_delete",
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
    .where(and(eq(idempotencyKeysTable.tenantId, actor.tenantId), eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.keyHash, keyHash)))
    .limit(1);

  const row = existingRows[0];
  if (!row) {
    throw new FundsServiceError("conflict", "Unable to acquire idempotency lock for this fund request.");
  }
  if (row.requestHash !== requestHash) {
    throw new FundsServiceError("conflict", "This idempotency key is already used for a different fund payload.");
  }

  return { row, created: false };
}

export async function listFundsForTenant(tenantId: string) {
  const store = await readStore();
  const funds = store.funds
    .filter((fund) => tenantFundFilter(fund, tenantId))
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

  return Promise.all(funds.map((fund) => attachFundReceiptUrl(fund)));
}

export async function getFundForTenant(id: string, tenantId: string) {
  const store = await readStore();
  const fund = store.funds.find((item) => item.id === id);
  if (!fund) {
    throw new FundsServiceError("not_found", "Fund not found");
  }

  assertTenantAccess(fund.tenantId, tenantId, () => new FundsServiceError("forbidden", "Forbidden"));

  return attachFundReceiptUrl(fund);
}

export async function saveFund(
  input: FundInput,
  actor: FundActor,
  options?: { idempotencyKey?: string | null },
): Promise<{ fund: FundRecord; created: boolean; duplicate: boolean }> {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? requestHashForFund(input) : null;
  const idempotencyScope = input.id ? "fund_update" : "fund_create";
  const idempotencyClaim = idempotencyKey && requestHash
    ? await claimFundIdempotency(actor, idempotencyScope, idempotencyKey, requestHash)
    : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const existingFund = await getFundForTenant(idempotencyClaim.row.responseEntityId, actor.tenantId);
      return { fund: existingFund, created: false, duplicate: true };
    }
    throw new FundsServiceError("conflict", "This fund request is already being processed. Please retry shortly.");
  }

  let fund: FundRecord | null = null;
  let created = false;
  try {
    await updateStore((current) => {
      const existing = input.id ? current.funds.find((item) => item.id === input.id) : null;
      if (existing) {
        assertTenantAccess(existing.tenantId, actor.tenantId, () => new FundsServiceError("forbidden", "Forbidden"));
      }

      const payload = normalizedFundPayload(input);
      if (payload.amount <= 0) {
        throw new FundsServiceError("invalid_input", "Fund amount must be greater than zero.");
      }
      fund = {
        id: input.id ?? existing?.id ?? createId("fund"),
        tenantId: actor.tenantId,
        source: payload.source,
        amount: payload.amount,
        date: payload.date,
        note: payload.note,
        receiptName: payload.receiptName || existing?.receiptName,
        receiptPath: payload.receiptPath || existing?.receiptPath,
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      created = !existing;

      return pushAuditEvent(
        {
          ...current,
          funds: existing ? current.funds.map((item) => (item.id === fund!.id ? fund! : item)) : [fund, ...current.funds],
        },
        {
          ...actor,
          action: existing ? "updated" : "created",
          entityType: "fund",
          entityId: fund.id,
          summary: `${existing ? "Updated" : "Added"} fund inflow from ${fund.source}.`,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          details: {
            entityLabel: fund.source,
            requestId: actor.requestId,
            changedFields: changedFundFields(existing, fund),
            before: existing ? summarizeFund(existing) : null,
            after: summarizeFund(fund),
            context: existing ? { operation: "fund_update" } : { operation: "fund_create" },
          },
        },
      );
    });

    if (idempotencyClaim?.created) {
      await db
        .update(idempotencyKeysTable)
        .set({
          status: "completed",
          responseEntityId: fund!.id,
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

  return { fund: await attachFundReceiptUrl(fund!), created, duplicate: false };
}

export async function deleteFundWithIdempotency(
  id: string,
  actor: FundActor,
  options?: { idempotencyKey?: string | null },
): Promise<{ fund: FundRecord | null; duplicate: boolean }> {
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const requestHash = idempotencyKey ? hashSha256(JSON.stringify({ id: id.trim() })) : null;
  const idempotencyClaim = idempotencyKey && requestHash
    ? await claimFundIdempotency(actor, "fund_delete", idempotencyKey, requestHash)
    : null;

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      return { fund: null, duplicate: true };
    }
    throw new FundsServiceError("conflict", "This fund delete request is already being processed. Please retry shortly.");
  }

  let target: FundRecord | null = null;
  try {
    await updateStore((current) => {
      target = current.funds.find((fund) => fund.id === id) ?? null;
      if (!target) {
        throw new FundsServiceError("not_found", "Fund not found");
      }

      assertTenantAccess(target.tenantId, actor.tenantId, () => new FundsServiceError("forbidden", "Forbidden"));

      return pushAuditEvent(
        {
          ...current,
          funds: current.funds.filter((fund) => fund.id !== id),
        },
        {
          ...actor,
          action: "deleted",
          entityType: "fund",
          entityId: id,
          summary: `Deleted fund inflow from ${target.source}.`,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          details: {
            entityLabel: target.source,
            requestId: actor.requestId,
            changedFields: ["deleted"],
            before: summarizeFund(target),
            after: null,
            context: { operation: "fund_delete" },
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

  return { fund: target, duplicate: false };
}
