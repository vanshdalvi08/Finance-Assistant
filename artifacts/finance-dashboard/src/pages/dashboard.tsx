import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api, type FinancialAccountBalance } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, IndianRupee, Wallet, Receipt } from "lucide-react";
import { format } from "date-fns";

function formatK(value: number) {
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (value >= 1_000) return `₹${Math.round(value / 1_000)}k`;
  return `₹${value}`;
}

const TOOLTIP_CLS = "rounded-xl border border-border/60 bg-card/95 p-3 shadow-xl backdrop-blur-sm text-sm min-w-[160px]";

function FundsExpensesTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={TOOLTIP_CLS}>
      <p className="mb-2 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-8 py-0.5">
          <span className="flex items-center gap-2 text-muted-foreground capitalize">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            {entry.dataKey}
          </span>
          <span className="font-semibold tabular-nums">
            {Number(entry.value).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
    </div>
  );
}

function SalaryTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={TOOLTIP_CLS}>
      <p className="mb-1 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">
        {Number(payload[0]?.value ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}
      </p>
    </div>
  );
}

function HoursTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={TOOLTIP_CLS}>
      <p className="mb-1 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Week of {label}</p>
      <p className="font-semibold tabular-nums">{payload[0]?.value ?? 0} hrs logged</p>
    </div>
  );
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: { fullLabel: string } }> }) {
  if (!active || !payload?.length) return null;
  const fullLabel = payload[0]?.payload?.fullLabel ?? "";
  const hours = payload[0]?.value ?? 0;
  return (
    <div className={TOOLTIP_CLS}>
      <p className="mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{fullLabel}</p>
      <p className="text-base font-bold tabular-nums leading-none">{hours}h</p>
      <p className="text-[10px] text-muted-foreground mt-1">approved hours</p>
    </div>
  );
}

function heatmapColor(hours: number) {
  if (hours === 0) return "rgba(186,230,253,0.06)";
  if (hours < 3) return "#0c4a6e";
  if (hours < 6) return "#0369a1";
  if (hours < 9) return "#0ea5e9";
  return "#7dd3fc";
}

function getMonthWindow(offset: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

function isSameMonth(date: string, target: Date) {
  const value = new Date(date);
  return value.getFullYear() === target.getFullYear() && value.getMonth() === target.getMonth();
}

function sumForMonth<T extends { amount: number; date: string }>(items: T[], month: Date) {
  return items
    .filter((item) => isSameMonth(item.date, month))
    .reduce((sum, item) => sum + item.amount, 0);
}

function calculatePercentChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function formatMonthLabel(value: string) {
  return format(new Date(`${value}-01T00:00:00`), "MMMM yyyy");
}

function accountScopeLabel(account: FinancialAccountBalance) {
  switch (account.accountType) {
    case "personal":
      return "Personal";
    case "mixed_use":
      return "Mixed";
    case "reserve":
      return "Reserve";
    case "cash":
      return "Cash";
    default:
      return "Main";
  }
}

function buildFinanceChartData(
  funds: Array<{ amount: number; date: string }>,
  expenses: Array<{ amount: number; date: string }>,
  salaries: Array<{ amount: number; date: string }>,
  selectedPeriod: string,
) {
  const explicitMonths = new Set<string>();
  for (const fund of funds) explicitMonths.add(monthKey(fund.date));
  for (const expense of expenses) explicitMonths.add(monthKey(expense.date));
  for (const salary of salaries) explicitMonths.add(monthKey(salary.date));

  const monthDates =
    selectedPeriod === "all"
      ? (() => {
          const sorted = Array.from(explicitMonths)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
            .map((value) => new Date(`${value}-01T00:00:00`));
          const anchor = sorted.at(-1) ?? getMonthWindow(0);
          return Array.from({ length: 6 }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth() - (5 - index), 1));
        })()
      : Array.from({ length: 6 }, (_, index) => {
          const anchor = new Date(`${selectedPeriod}-01T00:00:00`);
          return new Date(anchor.getFullYear(), anchor.getMonth() - (5 - index), 1);
        });

  const months = monthDates.length > 0 ? monthDates : Array.from({ length: 6 }, (_, index) => getMonthWindow(index - 5));
  const labelFormat = selectedPeriod === "all" ? "MMM yy" : "MMM";

  return months.map((date) => ({
    key: format(date, "yyyy-MM"),
    month: format(date, labelFormat),
    funds: funds.filter((item) => isSameMonth(item.date, date)).reduce((sum, item) => sum + item.amount, 0),
    expenses: expenses.filter((item) => isSameMonth(item.date, date)).reduce((sum, item) => sum + item.amount, 0),
    salary: salaries.filter((item) => isSameMonth(item.date, date)).reduce((sum, item) => sum + item.amount, 0),
  }));
}

export default function Dashboard() {
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: api.getTransactions });
  const { data: funds = [] } = useQuery({ queryKey: ["funds"], queryFn: api.getFunds });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => api.getExpenses() });
  const { data: salaries = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: overview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedBalanceView, setSelectedBalanceView] = useState("");
  const [workView, setWorkView] = useState<"weekly" | "daily">("weekly");
  const [workEmployee, setWorkEmployee] = useState("all");
  const [heatmapEmployee, setHeatmapEmployee] = useState("all");
  const [heatmapMonth, setHeatmapMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [workMonth, setWorkMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const approvedExpenses = expenses.filter((expense) => expense.status === "approved");
  const paidSalaries = salaries.filter((salary) => salary.status === "paid");

  const monthOptions = useMemo(() => {
    const values = new Set<string>();
    for (const fund of funds) values.add(monthKey(fund.date));
    for (const expense of approvedExpenses) values.add(monthKey(expense.date));
    for (const salary of paidSalaries) values.add(monthKey(salary.paidAt ?? salary.date));
    for (const transaction of transactions) values.add(monthKey(transaction.date));
    return Array.from(values)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left));
  }, [approvedExpenses, funds, paidSalaries, transactions]);

  useEffect(() => {
    if (selectedBalanceView || !overview) {
      return;
    }

    setSelectedBalanceView(overview.financialAccounts[0]?.id ?? "all");
  }, [overview, selectedBalanceView]);

  const selectedMonth = selectedPeriod === "all" ? null : new Date(`${selectedPeriod}-01T00:00:00`);
  const comparisonMonth = selectedMonth
    ? new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)
    : null;
  const chartData = useMemo(
    () =>
      buildFinanceChartData(
        funds,
        approvedExpenses,
        paidSalaries.map((salary) => ({
          amount: salary.amount,
          date: salary.paidAt ?? salary.date,
        })),
        selectedPeriod,
      ),
    [approvedExpenses, funds, paidSalaries, selectedPeriod],
  );

  const avgSalary = useMemo(() => {
    const nonZero = chartData.filter((d) => d.salary > 0);
    return nonZero.length > 0 ? Math.round(nonZero.reduce((sum, d) => sum + d.salary, 0) / nonZero.length) : 0;
  }, [chartData]);

  const trendTimesheets = useMemo(() => {
    const approved = timesheets.filter((t) => t.status === "approved");
    return workEmployee === "all" ? approved : approved.filter((t) => t.employeeId === workEmployee);
  }, [timesheets, workEmployee]);

  const weeklyWorkData = useMemo(() => {
    const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const weekMap = new Map<string, number>();
    for (const entry of trendTimesheets) {
      const key = entry.weekStart?.slice(0, 10) ?? "";
      if (!key) continue;
      const hours = (entry.lines ?? []).reduce(
        (sum: number, line) =>
          sum + WEEK_KEYS.reduce((d, k) => d + Number((line.hours as Record<string, number>)?.[k] ?? 0), 0),
        0,
      );
      weekMap.set(key, (weekMap.get(key) ?? 0) + hours);
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-10)
      .map(([weekStart, hours]) => ({
        weekLabel: format(new Date(`${weekStart}T00:00:00`), "MMM d"),
        hours: Math.round(hours),
      }));
  }, [trendTimesheets]);

  const dailyWorkData = useMemo(() => {
    const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const dayMap = new Map<string, number>();
    for (const entry of trendTimesheets) {
      const ws = entry.weekStart?.slice(0, 10);
      if (!ws) continue;
      const weekStart = new Date(`${ws}T00:00:00`);
      for (const line of entry.lines ?? []) {
        WEEK_KEYS.forEach((k, i) => {
          const h = Number((line.hours as Record<string, number>)?.[k] ?? 0);
          if (h <= 0) return;
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if (!key.startsWith(workMonth)) return;
          dayMap.set(key, (dayMap.get(key) ?? 0) + h);
        });
      }
    }
    const [y, m] = workMonth.split("-").map(Number);
    const daysInMonth = new Date(y!, m!, 0).getDate();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const result = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${workMonth}-${String(d).padStart(2, "0")}`;
      if (date > today) break;
      result.push({
        date,
        dayLabel: String(d),
        fullLabel: format(new Date(`${date}T00:00:00`), "MMM d, yyyy"),
        hours: Math.round(dayMap.get(date) ?? 0),
      });
    }
    return result;
  }, [trendTimesheets, workMonth]);

  const heatmapMonths = useMemo(() => {
    const months = new Set<string>();
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    for (const t of timesheets) {
      const ws = t.weekStart?.slice(0, 7);
      if (ws) months.add(ws);
    }
    return Array.from(months).sort();
  }, [timesheets]);

  const heatmapCalendarData = useMemo(() => {
    const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const dayMap = new Map<string, number>();
    const filtered = timesheets.filter(
      (t) => (t.status === "approved" || t.status === "submitted") && (heatmapEmployee === "all" || t.employeeId === heatmapEmployee),
    );
    for (const entry of filtered) {
      const ws = entry.weekStart?.slice(0, 10);
      if (!ws) continue;
      const weekStart = new Date(`${ws}T00:00:00`);
      for (const line of entry.lines ?? []) {
        WEEK_KEYS.forEach((k, i) => {
          const h = Number((line.hours as Record<string, number>)?.[k] ?? 0);
          if (h <= 0) return;
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          dayMap.set(key, (dayMap.get(key) ?? 0) + h);
        });
      }
    }
    const [y, mo] = heatmapMonth.split("-").map(Number) as [number, number];
    const firstDay = new Date(y, mo - 1, 1);
    const totalDays = new Date(y, mo, 0).getDate();
    const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    const cells: Array<{ date: string; day: number; hours: number; inMonth: boolean }> = [];
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(y, mo - 1, 1 - (startOffset - i));
      cells.push({ date: d.toISOString().slice(0, 10), day: d.getDate(), hours: 0, inMonth: false });
    }
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(y, mo - 1, day);
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: key, day, hours: Math.round(dayMap.get(key) ?? 0), inMonth: true });
    }
    const tail = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
      const d = new Date(y, mo, i);
      cells.push({ date: d.toISOString().slice(0, 10), day: i, hours: 0, inMonth: false });
    }
    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [timesheets, heatmapEmployee, heatmapMonth]);

  const heatmapTaskRows = useMemo(() => {
    const KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    const filtered = timesheets.filter(
      (t) => (t.status === "approved" || t.status === "submitted") && (heatmapEmployee === "all" || t.employeeId === heatmapEmployee),
    );
    const lookup = new Map<string, { project: string; task: string; hours: number }>();
    for (const entry of filtered) {
      const ws = entry.weekStart?.slice(0, 10);
      if (!ws) continue;
      const weekStart = new Date(`${ws}T00:00:00`);
      for (const line of entry.lines) {
        let monthHours = 0;
        KEYS.forEach((k, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          const localMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (localMonth === heatmapMonth) monthHours += Number(line.hours[k] ?? 0);
        });
        if (monthHours <= 0) continue;
        const project = line.project?.trim() || "Custom project";
        const task = line.task?.trim() || "Custom task";
        const key = `${project}::${task}`;
        const row = lookup.get(key) ?? { project, task, hours: 0 };
        row.hours += monthHours;
        lookup.set(key, row);
      }
    }
    const rows = Array.from(lookup.values()).sort((a, b) => b.hours - a.hours);
    const total = rows.reduce((s, r) => s + r.hours, 0);
    return rows.map((r) => ({ ...r, share: total > 0 ? (r.hours / total) * 100 : 0 }));
  }, [timesheets, heatmapEmployee, heatmapMonth]);

  const totalFunds = selectedMonth
    ? sumForMonth(funds, selectedMonth)
    : overview?.totalFunds ?? funds.reduce((sum, fund) => sum + fund.amount, 0);
  const totalExpenses = selectedMonth
    ? sumForMonth(approvedExpenses, selectedMonth)
    : overview?.totalExpenses ?? approvedExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalSalaryPaid = selectedMonth
    ? paidSalaries
        .filter((salary) => isSameMonth(salary.paidAt ?? salary.date, selectedMonth))
        .reduce((sum, salary) => sum + salary.amount, 0)
    : overview?.totalSalaryPaid ?? paidSalaries.reduce((sum, salary) => sum + salary.amount, 0);
  const availableFunds = useMemo(() => {
    if (!overview) {
      return selectedMonth ? totalFunds - totalExpenses - totalSalaryPaid : 0;
    }

    if (selectedBalanceView === "all") {
      return overview.allAccountsBalance ?? overview.currentBalance;
    }

    return overview.financialAccounts.find((account) => account.id === selectedBalanceView)?.balance ?? 0;
  }, [overview, selectedBalanceView, selectedMonth, totalExpenses, totalFunds, totalSalaryPaid]);
  const recentTransactions = (
    selectedMonth
      ? transactions.filter((transaction) => isSameMonth(transaction.date, selectedMonth))
      : transactions
  ).slice(0, 6);
  const currentMonth = getMonthWindow(0);
  const previousMonth = getMonthWindow(-1);

  const trendBaseMonth = selectedMonth ?? currentMonth;
  const trendCompareMonth = comparisonMonth ?? previousMonth;

  const currentMonthFunds = sumForMonth(funds, trendBaseMonth);
  const previousMonthFunds = sumForMonth(funds, trendCompareMonth);
  const currentMonthExpenses = sumForMonth(approvedExpenses, trendBaseMonth);
  const previousMonthExpenses = sumForMonth(approvedExpenses, trendCompareMonth);
  const currentMonthSalaries = paidSalaries
    .filter((salary) => isSameMonth(salary.paidAt ?? salary.date, trendBaseMonth))
    .reduce((sum, salary) => sum + salary.amount, 0);
  const previousMonthSalaries = paidSalaries
    .filter((salary) => isSameMonth(salary.paidAt ?? salary.date, trendCompareMonth))
    .reduce((sum, salary) => sum + salary.amount, 0);
  const currentMonthAvailableFunds = currentMonthFunds - currentMonthExpenses - currentMonthSalaries;
  const previousMonthAvailableFunds = previousMonthFunds - previousMonthExpenses - previousMonthSalaries;

  const fundsTrend = calculatePercentChange(currentMonthFunds, previousMonthFunds);
  const expensesTrend = calculatePercentChange(previousMonthExpenses, currentMonthExpenses);
  const salaryTrend = calculatePercentChange(currentMonthSalaries, previousMonthSalaries);
  const periodLabel = selectedMonth ? formatMonthLabel(selectedPeriod) : "All Time";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
            <p className="text-muted-foreground text-sm mt-1">Your institutional financial summary.</p>
          </div>
          <div className="w-full max-w-[220px] space-y-1">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Period</p>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="rounded-xl border-border/60 bg-card/70">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                {monthOptions.map((month) => (
                  <SelectItem key={month} value={month}>
                    {formatMonthLabel(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <Card className="relative overflow-hidden border-emerald-500/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_34%),hsl(var(--card))] shadow-[0_0_0_1px_rgba(16,185,129,0.05),0_6px_18px_rgba(0,0,0,0.08)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.45)]" />
                    <p className="text-sm font-medium text-muted-foreground">Available Funds</p>
                  </div>
                  <p className="text-3xl font-bold tracking-tight">
                    {availableFunds.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                  </p>
                  <Select value={selectedBalanceView} onValueChange={setSelectedBalanceView}>
                    <SelectTrigger className="h-8 w-[170px] rounded-full border-emerald-500/15 bg-emerald-500/6 px-3 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Accounts</SelectItem>
                      {(overview?.financialAccounts ?? []).map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name} - {accountScopeLabel(account)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="shrink-0 rounded-lg bg-emerald-500/8 p-2 text-emerald-300">
                  <Wallet className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <DashboardCard
            label={selectedMonth ? "Funds Added" : "Total Funds Added"}
            value={totalFunds.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={fundsTrend}
            trendLabel="vs last month"
            icon={<Wallet className="w-5 h-5" />}
          />
          <DashboardCard
            label={selectedMonth ? "Miscellaneous Expenditure" : "Miscellaneous Expenditure"}
            value={totalExpenses.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={expensesTrend}
            trendLabel="vs last month"
            icon={<IndianRupee className="w-5 h-5" />}
          />
          <DashboardCard
            label={selectedMonth ? "Salary Paid" : "Total Salary Paid"}
            value={totalSalaryPaid.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={salaryTrend}
            trendLabel="vs last month"
            icon={<IndianRupee className="w-5 h-5" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Funds vs Expenses</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Monthly flow comparison</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Funds
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Expenses
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradFunds" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<FundsExpensesTooltip />} />
                    <Area type="monotone" dataKey="funds" stroke="#34d399" strokeWidth={2} fill="url(#gradFunds)" dot={false} activeDot={{ r: 4, fill: "#34d399", strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="expenses" stroke="#f87171" strokeWidth={2} fill="url(#gradExpenses)" dot={false} activeDot={{ r: 4, fill: "#f87171", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Salary Trend</CardTitle>
              <p className="text-xs text-muted-foreground">Monthly payout history</p>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 24, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSalary" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<SalaryTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} />
                    {avgSalary > 0 && (
                      <ReferenceLine
                        y={avgSalary}
                        stroke="hsl(var(--muted-foreground))"
                        strokeOpacity={0.35}
                        strokeDasharray="4 4"
                        label={{ value: `Avg ${formatK(avgSalary)}`, position: "insideTopLeft", offset: 6, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      />
                    )}
                    <Bar dataKey="salary" fill="url(#gradSalary)" radius={[5, 5, 0, 0]}>
                      <LabelList
                        dataKey="salary"
                        position="top"
                        formatter={(v: number) => (v > 0 ? formatK(v) : "")}
                        style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Work Trend</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Approved hours —{" "}
                {workView === "weekly"
                  ? "by week"
                  : format(new Date(`${workMonth}-01T00:00:00`), "MMMM yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Select value={workEmployee} onValueChange={setWorkEmployee}>
                <SelectTrigger className="h-7 w-[150px] text-xs rounded-lg border-border/60 bg-card/70">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workView === "daily" && (
                <Select value={workMonth} onValueChange={setWorkMonth}>
                  <SelectTrigger className="h-7 w-[110px] text-xs rounded-lg border-border/60 bg-card/70">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {heatmapMonths.map((m) => (
                      <SelectItem key={m} value={m}>
                        {format(new Date(`${m}-01T00:00:00`), "MMM yyyy")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex rounded-lg border border-border/60 overflow-hidden text-xs">
                <button
                  className={`px-3 py-1 transition-colors ${workView === "weekly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setWorkView("weekly")}
                >
                  Weekly
                </button>
                <button
                  className={`px-3 py-1 transition-colors ${workView === "daily" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setWorkView("daily")}
                >
                  Daily
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(workView === "weekly" ? weeklyWorkData : dailyWorkData).length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                No approved timesheets yet.
              </div>
            ) : (
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={workView === "weekly" ? weeklyWorkData : dailyWorkData}
                    margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="gradHours" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={workView === "daily" ? 0.45 : 0.3} />
                        <stop offset="85%" stopColor="#a78bfa" stopOpacity={workView === "daily" ? 0.08 : 0} />
                        <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="2 6"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey={workView === "weekly" ? "weekLabel" : "dayLabel"}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      interval={workView === "daily" ? 6 : 0}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}h`}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip
                      cursor={
                        workView === "daily"
                          ? { stroke: "rgba(167,139,250,0.35)", strokeWidth: 1, strokeDasharray: "3 3" }
                          : false
                      }
                      content={workView === "weekly" ? <HoursTooltip /> : <DayTooltip />}
                    />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke={workView === "daily" ? "#c4b5fd" : "#a78bfa"}
                      strokeWidth={workView === "daily" ? 1.5 : 2}
                      fill="url(#gradHours)"
                      dot={false}
                      activeDot={
                        workView === "daily"
                          ? { r: 4, fill: "#c4b5fd", stroke: "rgba(196,181,253,0.4)", strokeWidth: 4 }
                          : { r: 5, fill: "#a78bfa", strokeWidth: 0 }
                      }
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex gap-8">
              {/* Left: Heatmap calendar */}
              <div style={{ width: 540, flexShrink: 0 }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-base font-semibold">Work Hours Heatmap</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(`${heatmapMonth}-01T00:00:00`), "MMMM yyyy")} — daily hour intensity
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select value={heatmapMonth} onValueChange={setHeatmapMonth}>
                      <SelectTrigger className="h-7 w-[110px] text-xs rounded-lg border-border/60 bg-card/70">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {heatmapMonths.map((m) => (
                          <SelectItem key={m} value={m}>
                            {format(new Date(`${m}-01T00:00:00`), "MMM yyyy")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={heatmapEmployee} onValueChange={setHeatmapEmployee}>
                      <SelectTrigger className="h-7 w-[130px] text-xs rounded-lg border-border/60 bg-card/70">
                        <SelectValue placeholder="All Employees" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        {employees.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                      {d}
                    </div>
                  ))}
                </div>
                {heatmapCalendarData.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
                    {week.map((cell, ci) =>
                      cell.inMonth ? (
                        <div
                          key={ci}
                          title={cell.hours > 0 ? `${cell.date} — ${cell.hours}h logged` : cell.date}
                          className="aspect-square rounded-sm relative overflow-hidden cursor-default transition-all hover:brightness-115 hover:ring-1 hover:ring-sky-400/50"
                          style={{ backgroundColor: heatmapColor(cell.hours) }}
                        >
                          <div className="absolute inset-0 flex flex-col justify-between p-1.5">
                            <span
                              className="text-[10px] font-semibold leading-none"
                              style={{ color: cell.hours > 0 ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.22)" }}
                            >
                              {cell.day}
                            </span>
                            {cell.hours > 0 && (
                              <span className="text-[9px] font-bold leading-none self-end" style={{ color: "rgba(255,255,255,0.55)" }}>
                                {cell.hours}h
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div key={ci} className="aspect-square" />
                      ),
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[10px] text-muted-foreground">No work</span>
                  {[0, 2, 5, 7, 10].map((h) => (
                    <div key={h} className="rounded-sm" style={{ width: 11, height: 11, backgroundColor: heatmapColor(h) }} />
                  ))}
                  <span className="text-[10px] text-muted-foreground">Heavy</span>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px bg-border/40 self-stretch shrink-0" />

              {/* Right: Project & Task Hours */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <p className="text-base font-semibold">Project & Task Hours</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(`${heatmapMonth}-01T00:00:00`), "MMMM yyyy")}
                      {heatmapEmployee !== "all" && employees.find((e) => e.id === heatmapEmployee)
                        ? ` · ${employees.find((e) => e.id === heatmapEmployee)!.name}`
                        : " · All Employees"}
                    </p>
                  </div>
                  {heatmapTaskRows.length > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold tabular-nums leading-none">
                        {heatmapTaskRows.reduce((s, r) => s + r.hours, 0) % 1 === 0
                          ? heatmapTaskRows.reduce((s, r) => s + r.hours, 0)
                          : heatmapTaskRows.reduce((s, r) => s + r.hours, 0).toFixed(1)}h
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {heatmapTaskRows.length} task{heatmapTaskRows.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                </div>

                {heatmapTaskRows.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground min-h-[180px]">
                    No task hours logged for this period.
                  </div>
                ) : (
                  <div
                    className="overflow-y-auto pr-1"
                    style={{ maxHeight: 420, scrollbarWidth: "thin", scrollbarColor: "hsl(var(--border)) transparent" }}
                  >
                    {heatmapTaskRows.map((row, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 py-3 ${i < heatmapTaskRows.length - 1 ? "border-b border-border/25" : ""}`}
                      >
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary/60 text-[9px] font-semibold text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400/80 truncate leading-none mb-1">
                                {row.project}
                              </p>
                              <p className="text-sm font-medium truncate leading-snug">{row.task}</p>
                            </div>
                            <span className="shrink-0 text-sm font-bold tabular-nums">
                              {Number.isInteger(row.hours) ? row.hours : row.hours.toFixed(1)}h
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1 rounded-full bg-secondary/50 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-sky-500/70"
                                style={{ width: `${Math.min(100, row.share)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">
                              {row.share.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Transactions · {periodLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>Transaction</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.length === 0 ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No transactions yet. Start by adding funds, expenses, or salary payments.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentTransactions.map((transaction) => (
                    <TableRow key={transaction.id} className="border-border/50">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-2 rounded-full ${
                              transaction.amount > 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {transaction.amount > 0 ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                          </div>
                          {transaction.description}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-secondary/50 font-normal">
                          {transaction.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(transaction.date), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${transaction.amount > 0 ? "text-primary" : "text-foreground"}`}>
                        {transaction.amount > 0 ? "+" : ""}
                        {transaction.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
