import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BanknoteArrowDown, BanknoteArrowUp, Search, Wallet, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, Transaction } from "@/lib/api";
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
    label: "Fund Inflow",
    badge: "border-primary/20 bg-primary/10 text-primary",
  },
  salary: {
    label: "Salary",
    badge: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  },
  expense: {
    label: "Expense",
    badge: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  },
  "purchase-order": {
    label: "Budget Sheet",
    badge: "border-primary/20 bg-primary/10 text-primary",
  },
} as const;

export default function Transactions() {
  const initialType =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
  const [filterType, setFilterType] = useState<string>(
    initialType && ["fund", "expense", "salary"].includes(initialType) ? initialType : "all",
  );
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [search, setSearch] = useState("");

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: api.getTransactions,
  });
  const { data: overview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
  });

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions],
  );

  const filtered = useMemo(() => {
    return sorted.filter((transaction) => {
      if (filterType !== "all" && transaction.type !== filterType) return false;
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
  }, [sorted, filterType, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, search]);

  const hasFilter =
    filterType !== "all" || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax || search;

  const totalInflow = filtered
    .filter((transaction) => transaction.type === "fund")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const totalOutflow = filtered
    .filter((transaction) => transaction.type !== "fund")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  const availableFunds = overview?.currentBalance ?? totalInflow - totalOutflow;

  function clearFilters() {
    setFilterType("all");
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
            <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A clean ledger of inflows, payouts, and approved operating movement.
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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="border-emerald-500/10 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_36%),hsl(var(--card))] shadow-[0_0_0_1px_rgba(16,185,129,0.05),0_6px_18px_rgba(0,0,0,0.08)]">
            <CardContent className="px-5 py-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Available Funds</p>
                <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
                  <Wallet className="h-4 w-4" />
                </div>
              </div>
              <p className="text-3xl font-bold tracking-tight">
                {availableFunds.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Live balance after approved expenses and paid salary.</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60">
            <CardContent className="px-5 py-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Inflow</p>
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <BanknoteArrowUp className="h-4 w-4" />
                </div>
              </div>
              <p className="text-3xl font-bold tracking-tight text-primary">
                +{totalInflow.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{filtered.length} records in the current view.</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60">
            <CardContent className="px-5 py-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Outflow</p>
                <div className="rounded-lg bg-rose-500/10 p-2 text-rose-300">
                  <BanknoteArrowDown className="h-4 w-4" />
                </div>
              </div>
              <p className="text-3xl font-bold tracking-tight text-rose-300">
                -{totalOutflow.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Expenses, payroll, and approved operational deductions.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ledger Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-5 pt-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-10 rounded-xl border-border/60 bg-card/70 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="fund">Fund Inflow</SelectItem>
                    <SelectItem value="expense">Expenses</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                    <SelectItem value="purchase-order">Budget Sheets</SelectItem>
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
                <Label className="text-xs text-muted-foreground">Min Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                  value={filterAmountMin}
                  onChange={(event) => setFilterAmountMin(event.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="Any"
                  className="h-10 rounded-xl border-border/60 bg-card/70 text-xs"
                  value={filterAmountMax}
                  onChange={(event) => setFilterAmountMax(event.target.value)}
                />
              </div>
            </div>

            {hasFilter ? (
              <div className="flex justify-end border-t border-border/50 pt-3">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs">
                  <X className="h-3 w-3" /> Clear filters
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading transactions...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No records match your filters.</div>
        ) : (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Transaction Ledger</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="pl-0">Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="pr-0 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((transaction) => {
                    const config = TYPE_CONFIG[transaction.type];
                    const isPositive = transaction.amount > 0;

                    return (
                      <TableRow key={transaction.id} className="border-border/50 hover:bg-card/40">
                        <TableCell className="pl-0">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{transaction.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(transaction.date), "MMM dd, yyyy • HH:mm")}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={config.badge}>
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{transaction.category}</TableCell>
                        <TableCell className="text-muted-foreground">{transaction.project || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(transaction.date), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "pr-0 text-right font-semibold tabular-nums",
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
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
