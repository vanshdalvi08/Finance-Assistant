import type {
  BusinessStore,
  ExpenseRecord,
  FinancialAccountRecord,
  FundRecord,
  SalaryRecord,
} from "./business-store";
import { DEFAULT_TENANT_ID } from "./tenants";

export type FinancialAccountSummary = FinancialAccountRecord & {
  balance: number;
};

function normalizeTenantId(value?: string | null) {
  return value?.trim() || DEFAULT_TENANT_ID;
}

function tenantFundFilter(fund: FundRecord, tenantId: string) {
  return normalizeTenantId(fund.tenantId) === tenantId;
}

function tenantExpenseFilter(expense: ExpenseRecord, tenantId: string) {
  return normalizeTenantId(expense.tenantId) === tenantId;
}

function tenantSalaryFilter(salary: SalaryRecord, tenantId: string) {
  return normalizeTenantId(salary.tenantId) === tenantId;
}

export function listFinancialAccounts(store: BusinessStore, tenantId: string) {
  return store.financialAccounts
    .filter((account) => normalizeTenantId(account.tenantId) === tenantId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findFinancialAccount(store: BusinessStore, tenantId: string, accountId?: string | null) {
  const normalizedId = accountId?.trim();
  if (!normalizedId) {
    return null;
  }

  return listFinancialAccounts(store, tenantId).find((account) => account.id === normalizedId) ?? null;
}

export function preferredFinancialAccount(store: BusinessStore, tenantId: string) {
  const accounts = listFinancialAccounts(store, tenantId);
  return accounts.find((account) => account.accountType === "operational" && account.isActive)
    ?? accounts.find((account) => account.isActive)
    ?? accounts[0]
    ?? null;
}

export function assertFinancialAccount(store: BusinessStore, tenantId: string, accountId?: string | null) {
  const account = findFinancialAccount(store, tenantId, accountId);
  if (!account) {
    throw new Error("Select a valid financial account.");
  }
  return account;
}

export function financialAccountBalance(store: BusinessStore, tenantId: string, accountId: string) {
  const account = findFinancialAccount(store, tenantId, accountId);
  if (!account) {
    return 0;
  }

  const inflows = store.funds
    .filter((fund) => tenantFundFilter(fund, tenantId) && fund.accountId === accountId)
    .reduce((sum, fund) => sum + Math.abs(Number(fund.amount ?? 0)), 0);
  const approvedExpenses = store.expenses
    .filter((expense) => tenantExpenseFilter(expense, tenantId) && expense.status === "approved" && expense.accountId === accountId)
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount ?? 0)), 0);
  const paidSalaries = store.salaries
    .filter((salary) => tenantSalaryFilter(salary, tenantId) && salary.status === "paid" && salary.accountId === accountId)
    .reduce((sum, salary) => sum + Math.abs(Number(salary.amount ?? 0)), 0);

  return Number((Math.abs(Number(account.openingBalance ?? 0)) + inflows - approvedExpenses - paidSalaries).toFixed(2));
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
