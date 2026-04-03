import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Landmark, Receipt, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { yojakData } from "@/lib/yojak-data";

type TransactionType = "all" | "fund" | "expense" | "salary";

function getTypeMeta(type: "fund" | "expense" | "salary") {
  if (type === "fund") {
    return {
      label: "Fund",
      tone: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
      icon: ArrowUpRight,
      accent: "text-emerald-300",
    };
  }

  if (type === "salary") {
    return {
      label: "Payroll",
      tone: "border-indigo-400/20 bg-indigo-400/10 text-indigo-200",
      icon: CircleDollarSign,
      accent: "text-indigo-300",
    };
  }

  return {
    label: "Expense",
    tone: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    icon: ArrowDownRight,
    accent: "text-rose-300",
  };
}

export default function AdminTransactionsPage() {
  const [typeFilter, setTypeFilter] = useState<TransactionType>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const { data: transactions = [] } = useQuery({ queryKey: ["yojak-transactions"], queryFn: yojakData.getTransactions });

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((transaction) => transaction.category))).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    [transactions],
  );

  const filtered = useMemo(() => {
    return transactions.filter((transaction) => {
      if (typeFilter !== "all" && transaction.type !== typeFilter) return false;
      if (categoryFilter !== "all" && transaction.category !== categoryFilter) return false;
      if (dateFrom && transaction.date < dateFrom) return false;
      if (dateTo && transaction.date > `${dateTo}T23:59:59Z`) return false;
      if (minAmount && Math.abs(transaction.amount) < Number(minAmount)) return false;
      if (maxAmount && Math.abs(transaction.amount) > Number(maxAmount)) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = [transaction.title, transaction.actor, transaction.category, transaction.type]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [categoryFilter, dateFrom, dateTo, maxAmount, minAmount, search, transactions, typeFilter]);

  const inflow = filtered.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const outflow = filtered.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const net = inflow - outflow;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance ledger"
        title="Transaction history"
        description="Review inflows, payroll outflow, and expense movements in a structured ledger view."
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard label="Records" value={`${filtered.length}`} icon={<Receipt className="h-5 w-5" />} />
        <MetricCard label="Total inflow" value={formatCurrency(inflow)} icon={<ArrowUpRight className="h-5 w-5" />} />
        <MetricCard label="Total outflow" value={formatCurrency(outflow)} icon={<ArrowDownRight className="h-5 w-5" />} />
        <MetricCard label="Net movement" value={formatCurrency(net)} icon={<Landmark className="h-5 w-5" />} />
      </div>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="font-serif text-2xl">Ledger filters</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTypeFilter("all");
                setCategoryFilter("all");
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setMinAmount("");
                setMaxAmount("");
              }}
            >
              Reset
            </Button>
          </div>
          <div className="grid gap-3 xl:grid-cols-[1.4fr_repeat(5,1fr)]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title, actor, or category"
                className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TransactionType)}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="fund">Funds</SelectItem>
                <SelectItem value="expense">Expenses</SelectItem>
                <SelectItem value="salary">Payroll</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Min" />
              <Input type="number" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Max" />
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Card className="border-white/8 bg-white/[0.03]">
          <CardContent className="p-0">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_0.8fr] border-b border-white/8 bg-white/[0.02] px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span>Entry</span>
              <span>Actor</span>
              <span>Category</span>
              <span>Date</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="divide-y divide-white/6">
              {filtered.length === 0 ? (
                <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                  No transactions match the current filters.
                </div>
              ) : (
                filtered.map((transaction) => {
                  const meta = getTypeMeta(transaction.type);
                  const Icon = meta.icon;
                  return (
                    <div key={transaction.id} className="grid grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_0.8fr] items-center gap-3 px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn("rounded-2xl border p-2.5", meta.tone)}>
                          <Icon className={cn("h-4 w-4", meta.accent)} />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{transaction.title}</p>
                          <p className="text-xs text-muted-foreground capitalize">{meta.label}</p>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">{transaction.actor}</span>
                      <span className="text-sm text-muted-foreground">{transaction.category}</span>
                      <span className="text-sm text-muted-foreground">{format(new Date(transaction.date), "dd MMM yyyy")}</span>
                      <div className="text-right">
                        <span className={cn("font-semibold tabular-nums", transaction.amount > 0 ? "text-emerald-300" : "text-foreground")}>
                          {transaction.amount > 0 ? "+" : ""}
                          {formatCurrency(transaction.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">Type distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(["fund", "expense", "salary"] as const).map((type) => {
                const count = filtered.filter((transaction) => transaction.type === type).length;
                const amount = filtered
                  .filter((transaction) => transaction.type === type)
                  .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
                const meta = getTypeMeta(type);
                return (
                  <div key={type} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{meta.label}</span>
                      <span className="text-muted-foreground">
                        {count} entries, {formatCurrency(amount)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#d8b26a,#6b7cbd)]"
                        style={{ width: `${Math.max(10, Math.min(100, (count / Math.max(1, filtered.length)) * 100))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">Ledger notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Funds are recorded as positive movement, while expenses and salary entries are stored as outflow.</p>
              <p>All entries are sorted newest first and reflect local browser state, so the table updates as soon as the underlying forms are submitted.</p>
              <Separator className="bg-white/8" />
              <div className="flex items-center justify-between">
                <span>Filtered categories</span>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-foreground">
                  {categoryFilter === "all" ? categories.length : 1}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
