import {
  createDefaultFinancialAccount,
  createId,
  type ActorRole,
  type FinancialAccountCategory,
  type FinancialAccountRecord,
  type FinancialAccountType,
  normalizeFinancialAccountCategory,
  normalizeFinancialAccountType,
  nowIso,
  pushAuditEvent,
  readStore,
  updateStore,
} from "../../lib/business-store";
import { assertTenantAccess } from "../../lib/policies";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";

export type FinancialAccountActor = {
  userId?: string;
  requestId?: string;
  tenantId: string;
  actorName: string;
  actorRole: ActorRole;
};

export type FinancialAccountInput = {
  id?: string;
  name: string;
  accountType: FinancialAccountType;
  category: FinancialAccountCategory;
  openingBalance: number;
  description?: string;
  includeInOperationalReporting?: boolean;
  isActive?: boolean;
};

export class FinancialAccountsServiceError extends Error {
  code: "not_found" | "forbidden" | "invalid_input";

  constructor(code: "not_found" | "forbidden" | "invalid_input", message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeTenantId(value?: string | null) {
  return value?.trim() || DEFAULT_TENANT_ID;
}

function summarizeFinancialAccount(account: FinancialAccountRecord) {
  return {
    name: account.name,
    accountType: account.accountType,
    category: account.category,
    openingBalance: account.openingBalance,
    description: account.description ?? "",
    includeInOperationalReporting: account.includeInOperationalReporting,
    isActive: account.isActive,
  };
}

function changedFinancialAccountFields(previous: FinancialAccountRecord | null, next: FinancialAccountRecord) {
  const candidates: Array<keyof ReturnType<typeof summarizeFinancialAccount>> = [
    "name",
    "accountType",
    "category",
    "openingBalance",
    "description",
    "includeInOperationalReporting",
    "isActive",
  ];
  if (!previous) {
    return candidates;
  }

  const before = summarizeFinancialAccount(previous);
  const after = summarizeFinancialAccount(next);
  return candidates.filter((key) => before[key] !== after[key]);
}

export async function listFinancialAccountsForTenant(tenantId: string) {
  const store = await readStore();
  return store.financialAccounts
    .filter((account) => normalizeTenantId(account.tenantId) === tenantId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getFinancialAccountForTenant(id: string, tenantId: string) {
  const store = await readStore();
  const account = store.financialAccounts.find((item) => item.id === id);
  if (!account) {
    throw new FinancialAccountsServiceError("not_found", "Financial account not found.");
  }

  assertTenantAccess(account.tenantId, tenantId, () => new FinancialAccountsServiceError("forbidden", "Forbidden"));
  return account;
}

export async function saveFinancialAccount(input: FinancialAccountInput, actor: FinancialAccountActor) {
  let account: FinancialAccountRecord | null = null;
  let created = false;

  await updateStore((current) => {
    const existing = input.id ? current.financialAccounts.find((item) => item.id === input.id) ?? null : null;
    if (existing) {
      assertTenantAccess(existing.tenantId, actor.tenantId, () => new FinancialAccountsServiceError("forbidden", "Forbidden"));
    }

    const name = input.name.trim();
    if (name.length < 2) {
      throw new FinancialAccountsServiceError("invalid_input", "Account name must be at least 2 characters.");
    }

    const openingBalance = Math.abs(Math.round(Number(input.openingBalance ?? 0)));
    if (!Number.isFinite(openingBalance)) {
      throw new FinancialAccountsServiceError("invalid_input", "Opening balance must be a valid number.");
    }

    const duplicateName = current.financialAccounts.find(
      (item) =>
        item.id !== existing?.id
        && normalizeTenantId(item.tenantId) === actor.tenantId
        && item.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      throw new FinancialAccountsServiceError("invalid_input", "An account with this name already exists.");
    }

    const accountType = normalizeFinancialAccountType(input.accountType);
    const includeInOperationalReporting = input.includeInOperationalReporting ?? accountType === "operational";
    account = {
      id: input.id ?? existing?.id ?? createId("acct"),
      tenantId: actor.tenantId,
      name,
      accountType,
      category: normalizeFinancialAccountCategory(input.category),
      openingBalance,
      description: input.description?.trim() || undefined,
      includeInOperationalReporting,
      isActive: input.isActive ?? existing?.isActive ?? true,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    created = !existing;

    return pushAuditEvent(
      {
        ...current,
        financialAccounts: existing
          ? current.financialAccounts.map((item) => (item.id === account!.id ? account! : item))
          : [account, ...current.financialAccounts],
      },
      {
        ...actor,
        action: existing ? "updated" : "created",
        entityType: "financial-account",
        entityId: account.id,
        summary: existing ? `Updated financial account ${account.name}.` : `Created financial account ${account.name}.`,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        details: {
          entityLabel: account.name,
          requestId: actor.requestId,
          changedFields: changedFinancialAccountFields(existing, account),
          before: existing ? summarizeFinancialAccount(existing) : null,
          after: summarizeFinancialAccount(account),
          context: existing ? { operation: "financial_account_update" } : { operation: "financial_account_create" },
        },
      },
    );
  });

  return { account: account!, created };
}

export function defaultFinancialAccountTemplate(tenantId: string) {
  return createDefaultFinancialAccount(tenantId);
}
