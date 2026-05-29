import { DEFAULT_TENANT_ID } from "./tenants";
import {
  type BusinessStore,
  type ExpenseRecord,
  type FinancialAccountRecord,
  type FundRecord,
  type SalaryRecord,
  isLegacyDefaultFinancialAccount,
} from "./business-store";

export type FinancialAccountSummary = FinancialAccountRecord & {
  balance: number;
};

function normalizeAccountId(accountId?: string | null) {
  return accountId?.trim() || "";
}

function normalizeTenantId(tenantId?: string | null) {
  return tenantId?.trim() || DEFAULT_TENANT_ID;
}

function tenantMatches(tenantId: string | undefined, expectedTenantId: string) {
  return normalizeTenantId(tenantId) === normalizeTenantId(expectedTenantId);
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return tenantMatches(fund.tenantId, tenantId);
}

function tenantExpenseFilter(expense: ExpenseRecord, tenantId: string) {
  return tenantMatches(expense.tenantId, tenantId);
}

function tenantSalaryFilter(salary: SalaryRecord, tenantId: string) {
  return tenantMatches(salary.tenantId, tenantId);
}

export function listFinancialAccounts(store: BusinessStore, tenantId: string) {
  return store.financialAccounts
    .filter((account) => tenantMatches(account.tenantId, tenantId))
    .sort((left, right) => {
      const leftIsLegacy = isLegacyDefaultFinancialAccount(left);
      const rightIsLegacy = isLegacyDefaultFinancialAccount(right);
      if (leftIsLegacy !== rightIsLegacy) {
        return leftIsLegacy ? 1 : -1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function findFinancialAccount(store: BusinessStore, tenantId: string, accountId?: string | null) {
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

export function preferredFinancialAccount(store: BusinessStore, tenantId: string) {
  const accounts = listFinancialAccounts(store, tenantId);
  return (
    accounts.find((account) => account.accountType === "operational" && account.isActive && !isLegacyDefaultFinancialAccount(account))
    ?? accounts.find((account) => account.isActive && !isLegacyDefaultFinancialAccount(account))
    ?? accounts.find((account) => !isLegacyDefaultFinancialAccount(account))
    ?? accounts.find((account) => account.accountType === "operational" && account.isActive)
    ?? accounts.find((account) => account.isActive)
    ?? accounts[0]
    ?? null
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

export function financialAccountBalance(store: BusinessStore, tenantId: string, accountId: string) {
  const account = findFinancialAccount(store, tenantId, accountId);
  if (!account) {
    return 0;
  }

  const accountKey = account.id;
  const openingBalance = Math.abs(Number(account.openingBalance ?? 0));
  const totalFunds = store.funds
    .filter((fund) => tenantFundFilter(fund, tenantId) && normalizeAccountId(fund.accountId) === accountKey)
    .reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const totalExpenses = store.expenses
    .filter(
      (expense) =>
        tenantExpenseFilter(expense, tenantId) &&
        expense.status === "approved" &&
        normalizeAccountId(expense.accountId) === accountKey,
    )
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const totalSalaries = store.salaries
    .filter(
      (salary) =>
        tenantSalaryFilter(salary, tenantId) &&
        salary.status === "paid" &&
        normalizeAccountId(salary.accountId) === accountKey,
    )
    .reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);

  return Math.max(0, Number((openingBalance + totalFunds - totalExpenses - totalSalaries).toFixed(2)));
}

export function summarizeFinancialAccounts(store: BusinessStore, tenantId: string): {
  accounts: FinancialAccountSummary[];
  allAccountsBalance: number;
  operationalBalance: number;
} {
  const accounts = listFinancialAccounts(store, tenantId).map((account) => ({
    ...account,
    balance: financialAccountBalance(store, tenantId, account.id),
  }));

  return {
    accounts,
    allAccountsBalance: Number(accounts.reduce((sum, account) => sum + account.balance, 0).toFixed(2)),
    operationalBalance: Number(
      accounts
        .filter((account) => account.includeInOperationalReporting)
        .reduce((sum, account) => sum + account.balance, 0)
        .toFixed(2),
    ),
  };
}

export function availableFundsByAccount(store: BusinessStore, tenantId: string, accountId?: string | null) {
  if (!accountId || accountId === "all") {
    return summarizeFinancialAccounts(store, tenantId).allAccountsBalance;
  }

  if (accountId === "operational") {
    return summarizeFinancialAccounts(store, tenantId).operationalBalance;
  }

  return financialAccountBalance(store, tenantId, accountId);
}
