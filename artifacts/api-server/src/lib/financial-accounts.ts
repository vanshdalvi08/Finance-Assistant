import { type BusinessStore, type FinancialAccountRecord } from "./business-store";

function normalizeAccountId(accountId?: string | null) {
  return accountId?.trim() || "";
}

function tenantMatches(tenantId: string | undefined, expectedTenantId: string) {
  return (tenantId ?? "").trim() === expectedTenantId.trim();
}

function findFinancialAccount(store: BusinessStore, tenantId: string, accountId: string) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  return (
    store.financialAccounts.find(
      (account) =>
        account.id === normalizedAccountId &&
        tenantMatches(account.tenantId, tenantId),
    ) ?? null
  );
}

export function assertFinancialAccount(
  store: BusinessStore,
  tenantId: string,
  accountId: string,
  onError: (message: string) => Error = (message) => new Error(message),
): FinancialAccountRecord {
  const account = findFinancialAccount(store, tenantId, accountId);
  if (!account) {
    throw onError("Select a valid financial account.");
  }

  if (!account.isActive) {
    throw onError("Selected financial account is inactive.");
  }

  return account;
}

export function availableFundsByAccount(store: BusinessStore, tenantId: string, accountId: string) {
  const account = findFinancialAccount(store, tenantId, accountId);
  if (!account) {
    return 0;
  }

  const accountKey = account.id;
  const openingBalance = Math.abs(Number(account.openingBalance ?? 0));
  const totalFunds = store.funds
    .filter((fund) => tenantMatches(fund.tenantId, tenantId) && normalizeAccountId(fund.accountId) === accountKey)
    .reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const totalExpenses = store.expenses
    .filter(
      (expense) =>
        tenantMatches(expense.tenantId, tenantId) &&
        expense.status === "approved" &&
        normalizeAccountId(expense.accountId) === accountKey,
    )
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const totalSalaries = store.salaries
    .filter(
      (salary) =>
        tenantMatches(salary.tenantId, tenantId) &&
        salary.status === "paid" &&
        normalizeAccountId(salary.accountId) === accountKey,
    )
    .reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);

  return Math.max(0, Number((openingBalance + totalFunds - totalExpenses - totalSalaries).toFixed(2)));
}
