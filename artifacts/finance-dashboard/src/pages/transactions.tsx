import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  ChevronDown,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type Transaction } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TYPE_CONFIG = {
  fund: {
    label: "Fund",
    badge: "border-primary/20 bg-primary/10 text-primary",
  },
  salary: {
    label: "Payroll",
    badge: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  },
  expense: {
    label: "Expense",
    badge: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  },
} as const;

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
  });
}

export default function Transactions() {
  const initialType =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
  const [filterType, setFilterType] = useState<string>(
    initialType && ["fund", "expense", "salary"].includes(initialType) ? initialType : "all",
  );
  const [filterAccountId, setFilterAccountId] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: api.getTransactions,
  });
  const { data: overview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
  });

  const accountOptions = useMemo(() => overview?.financialAccounts ?? [], [overview?.financialAccounts]);

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions],
  );

  const filtered = useMemo(() => {
    return sorted.filter((transaction) => {
      if (filterType !== "all" && transaction.type !== filterType) return false;
      if (filterAccountId !== "all" && transaction.accountId !== filterAccountId) return false;
      if (filterDateFrom && transaction.date < filterDateFrom) return false;
      if (filterDateTo && transaction.date > `${filterDateTo}T23:59:59Z`) return false;

      const amount = Math.abs(transaction.amount);
      if (filterAmountMin && amount < Number(filterAmountMin)) return false;
      if (filterAmountMax && amount > Number(filterAmountMax)) return false;

      if (
        search.trim() &&
        !`${transaction.description} ${transaction.category} ${transaction.project ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [sorted, filterType, filterAccountId, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, search]);

  const monthGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; transactions: Transaction[]; inflow: number; outflow: number }
    >();

    for (const transaction of filtered) {
      const key = format(new Date(transaction.date), "yyyy-MM");
      const existing =
        groups.get(key) ?? {
          key,
          label: format(new Date(transaction.date), "MMMM yyyy"),
          transactions: [],
          inflow: 0,
          outflow: 0,
        };

      existing.transactions.push(transaction);
      if (transaction.amount > 0) {
        existing.inflow += transaction.amount;
      } else {
        existing.outflow += Math.abs(transaction.amount);
      }
      groups.set(key, existing);
    }

    return Array.from(groups.values()).sort((left, right) => right.key.localeCompare(left.key));
  }, [filtered]);

  const activeMonthKey =
    openMonthKey && monthGroups.some((group) => group.key === openMonthKey)
      ? openMonthKey
      : monthGroups[0]?.key ?? null;

  const hasFilter = Boolean(
    filterType !== "all" ||
      filterAccountId !== "all" ||
      filterDateFrom ||
      filterDateTo ||
      filterAmountMin ||
      filterAmountMax ||
      search,
  );

  const totalInflow = filtered
    .filter((transaction) => transaction.type === "fund")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const totalOutflow = filtered
    .filter((transaction) => transaction.type !== "fund")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  const availableFunds = overview?.currentBalance ?? totalInflow - totalOutflow;
  const netMovement = totalInflow - totalOutflow;
  const recordsInView = filtered.length;
  const accountsInView = useMemo(
    () => new Set(filtered.map((transaction) => transaction.accountId).filter((value): value is string => Boolean(value))).size,
    [filtered],
  );

  function clearFilters() {
    setFilterType("all");
    setFilterAccountId("all");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterAmountMin("");
    setFilterAmountMax("");
    setSearch("");
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Operations ledger</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Transactions</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              A single admin ledger for every fund inflow, expense outflow, and salary payment recorded across the company.
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search description, category, or project"
              className="h-10 rounded-xl border-border/60 bg-card/70 pl-9"
            />
          </div>
        </div>

        <Card className="border-border/50 bg-card/70 shadow-sm">
          <CardContent className="p-0">
            <div className="grid gap-px md:grid-cols-4">
              <div className="flex min-h-[126px] flex-col justify-between gap-3 bg-card/80 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ledger balance</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">{formatCurrency(availableFunds)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                    <Wallet className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Current balance across all active financial accounts.</p>
              </div>

              <div className="flex min-h-[126px] flex-col justify-between gap-3 bg-card/80 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Inflow</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-emerald-300">+{formatCurrency(totalInflow)}</p>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-2 text-primary">
                    <BanknoteArrowUp className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Funds added to the ledger in the current view.</p>
              </div>

              <div className="flex min-h-[126px] flex-col justify-between gap-3 bg-card/80 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Outflow</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-rose-300">-{formatCurrency(totalOutflow)}</p>
                  </div>
                  <div className="rounded-xl bg-rose-500/10 p-2 text-rose-300">
                    <BanknoteArrowDown className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Expenses and payroll entries in the current view.</p>
              </div>

              <div className="flex min-h-[126px] flex-col justify-between gap-3 bg-card/80 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Net movement</p>
                    <p className={cn("mt-2 text-3xl font-semibold tracking-tight", netMovement >= 0 ? "text-primary" : "text-rose-300")}>
                      {netMovement >= 0 ? "+" : "-"}
                      {formatCurrency(Math.abs(netMovement))}
                    </p>
                  </div>
                  <div className="rounded-xl bg-secondary/70 p-2 text-muted-foreground">
                    <Wallet className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {recordsInView} record{recordsInView === 1 ? "" : "s"} across {accountsInView} account{accountsInView === 1 ? "" : "s"}.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
            <div>
              <CardTitle className="text-base">Ledger filters</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Narrow the ledger by type, account, date, or amount.</p>
            </div>
            <div className="flex items-center gap-2">
              {hasFilter ? (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs">
                  <X className="h-3 w-3" /> Clear
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-xl"
                onClick={() => setShowFilters((current) => !current)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {showFilters ? "Hide Filters" : "Filters"}
              </Button>
            </div>
          </CardHeader>
          {showFilters ? (
            <CardContent className="space-y-4 px-5 pb-5 pt-0">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="h-10 rounded-xl border-border/60 bg-card/70 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="fund">Fund</SelectItem>
                      <SelectItem value="expense">Expenses</SelectItem>
                      <SelectItem value="salary">Payroll</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Account</Label>
                  <Select value={filterAccountId} onValueChange={setFilterAccountId}>
                    <SelectTrigger className="h-10 rounded-xl border-border/60 bg-card/70 text-xs">
                      <SelectValue placeholder="All Accounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Accounts</SelectItem>
                      {accountOptions.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From Date</Label>
                  <Input
                    type="date"
                    className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                    value={filterDateFrom}
                    onChange={(event) => setFilterDateFrom(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To Date</Label>
                  <Input
                    type="date"
                    className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                    value={filterDateTo}
                    onChange={(event) => setFilterDateTo(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min Amount (INR)</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                    value={filterAmountMin}
                    onChange={(event) => setFilterAmountMin(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Max Amount (INR)</Label>
                  <Input
                    type="number"
                    placeholder="Any"
                    className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                    value={filterAmountMax}
                    onChange={(event) => setFilterAmountMax(event.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          ) : null}
        </Card>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading transactions...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No records match your filters.</div>
        ) : (
          <div className="space-y-4">
            {monthGroups.map((group) => {
              const isOpen = group.key === activeMonthKey;
              const groupAccounts = new Set(
                group.transactions.map((transaction) => transaction.accountId).filter((value): value is string => Boolean(value)),
              ).size;
              const groupNet = group.inflow - group.outflow;

              return (
                <Card key={group.key} className="overflow-hidden border-border/50 bg-card/70 shadow-sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 border-b border-border/50 px-5 py-4 text-left transition-colors hover:bg-card/70"
                    onClick={() => setOpenMonthKey((current) => (current === group.key ? null : group.key))}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <p className="font-medium text-foreground">{group.label}</p>
                        <Badge variant="outline" className="border-border/60 bg-secondary/40 text-xs text-muted-foreground">
                          {group.transactions.length} record{group.transactions.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {groupAccounts} account{groupAccounts === 1 ? "" : "s"} in this month · {formatCurrency(groupNet)} net movement
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-5 text-sm">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Inflow</p>
                        <p className="mt-1 font-medium text-emerald-300">{formatCurrency(group.inflow)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Outflow</p>
                        <p className="mt-1 font-medium text-rose-300">{formatCurrency(group.outflow)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Net</p>
                        <p className={cn("mt-1 font-medium", groupNet >= 0 ? "text-primary" : "text-rose-300")}>
                          {groupNet >= 0 ? "+" : "-"}
                          {formatCurrency(Math.abs(groupNet))}
                        </p>
                      </div>
                    </div>
                  </button>

                  {isOpen ? (
                    <CardContent className="px-0 pb-0 pt-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border/50 bg-muted/20 hover:bg-transparent">
                            <TableHead className="pl-5">Entry</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="pr-5 text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.transactions.map((transaction) => {
                            const config = TYPE_CONFIG[transaction.type];
                            const isPositive = transaction.amount > 0;

                            return (
                              <TableRow key={transaction.id} className="border-border/50 hover:bg-card/40">
                                <TableCell className="pl-5">
                                  <div className="space-y-2">
                                    <p className="font-medium text-foreground">{transaction.description}</p>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="outline" className={cn("h-6 border px-2 text-[11px]", config.badge)}>
                                        {config.label}
                                      </Badge>
                                      {transaction.project ? (
                                        <span className="rounded-full border border-border/60 bg-secondary/40 px-2 py-1">
                                          {transaction.project}
                                        </span>
                                      ) : null}
                                      <span>{format(new Date(transaction.date), "MMM dd, yyyy • HH:mm")}</span>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {transaction.accountName ? (
                                    <Badge variant="outline" className="border-border/60 bg-secondary/40 text-muted-foreground">
                                      {transaction.accountName}
                                    </Badge>
                                  ) : (
                                    <span>-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{transaction.category}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {format(new Date(transaction.date), "dd MMM yyyy")}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "pr-5 text-right font-semibold tabular-nums",
                                    isPositive ? "text-primary" : "text-foreground",
                                  )}
                                >
                                  {isPositive ? "+" : ""}
                                  {transaction.amount.toLocaleString("en-IN", {
                                    style: "currency",
                                    currency: "INR",
                                  })}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
