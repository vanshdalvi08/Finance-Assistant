import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, Transaction } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { DollarSign, Receipt, Wallet, TrendingUp, TrendingDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_CONFIG = {
  fund: {
    label: "Fund Inflow",
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    dot: "bg-primary",
    icon: Wallet,
  },
  salary: {
    label: "Salary",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    dot: "bg-orange-400",
    icon: DollarSign,
  },
  expense: {
    label: "Expense",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    dot: "bg-rose-400",
    icon: Receipt,
  },
  "purchase-order": {
    label: "Budget Sheet",
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    dot: "bg-primary",
    icon: Wallet,
  },
};

export default function Transactions() {
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: api.getTransactions,
  });

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions]
  );

  const filtered = useMemo(() => {
    return sorted.filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;
      if (filterDateFrom && t.date < filterDateFrom) return false;
      if (filterDateTo && t.date > filterDateTo + "T23:59:59Z") return false;
      const abs = Math.abs(t.amount);
      if (filterAmountMin && abs < Number(filterAmountMin)) return false;
      if (filterAmountMax && abs > Number(filterAmountMax)) return false;
      return true;
    });
  }, [sorted, filterType, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax]);

  const hasFilter =
    filterType !== "all" || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax;

  function clearFilters() {
    setFilterType("all");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterAmountMin("");
    setFilterAmountMax("");
  }

  const totalInflow = filtered
    .filter((t) => t.type === "fund")
    .reduce((s, t) => s + t.amount, 0);
  const totalOutflow = filtered
    .filter((t) => t.type !== "fund")
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Complete chronological record of all financial movements.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-muted-foreground mb-1">Total Records</p>
              <p className="text-2xl font-bold">{filtered.length}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                <p className="text-xs text-muted-foreground">Total Inflow</p>
              </div>
              <p className="text-2xl font-bold text-primary">
                +{totalInflow.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                <p className="text-xs text-muted-foreground">Total Outflow</p>
              </div>
              <p className="text-2xl font-bold text-rose-400">
                -{totalOutflow.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 px-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
              <div className="sm:col-span-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-8 text-xs">
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
                  className="h-8 text-xs"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Min Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  className="h-8 text-xs"
                  value={filterAmountMin}
                  onChange={(e) => setFilterAmountMin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="Any"
                  className="h-8 text-xs"
                  value={filterAmountMax}
                  onChange={(e) => setFilterAmountMax(e.target.value)}
                />
              </div>
            </div>
            {hasFilter && (
              <div className="mt-3 pt-3 border-t border-border/50 flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs gap-1">
                  <X className="w-3 h-3" /> Clear filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading history...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No records match your filters.</div>
        ) : (
          <div className="relative">
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border/60" />
            <div className="space-y-0">
              {filtered.map((tx, i) => {
                const cfg = TYPE_CONFIG[tx.type];
                const Icon = cfg.icon;
                const isPositive = tx.amount > 0;

                return (
                  <div key={tx.id} className="relative flex gap-4 pb-0">
                    <div className="relative z-10 mt-4 flex-shrink-0">
                      <div
                        className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center border-2",
                          cfg.bg,
                          cfg.border.replace("border-", "border-")
                        )}
                        style={{ borderColor: "hsl(var(--border))" }}
                      >
                        <Icon className={cn("w-4 h-4", cfg.color)} />
                      </div>
                    </div>

                    <div
                      className={cn(
                        "flex-1 mb-3 rounded-xl border border-border/50 bg-card/40 px-4 py-3 hover:bg-card/70 transition-colors",
                        i === 0 && "mt-0"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">
                            {tx.description}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-xs font-normal", cfg.color, cfg.border)}
                            style={{}}
                          >
                            <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5 inline-block", cfg.dot)} />
                            {tx.category}
                          </Badge>
                        </div>
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            isPositive ? "text-primary" : "text-foreground"
                          )}
                        >
                          {isPositive ? "+" : ""}
                          {tx.amount.toLocaleString("en-IN", {
                            style: "currency",
                            currency: "INR",
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono tracking-tight">
                        {format(new Date(tx.date), "MMM dd, yyyy — HH:mm")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
