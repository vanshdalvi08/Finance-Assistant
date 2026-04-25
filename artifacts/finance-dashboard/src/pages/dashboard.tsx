import { useMemo, useState } from "react";
import { Link } from "wouter";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowRight, ArrowUpRight, IndianRupee, Wallet, Receipt } from "lucide-react";
import { format } from "date-fns";

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
  const [selectedPeriod, setSelectedPeriod] = useState("all");
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
  const availableFunds = selectedMonth
    ? totalFunds - totalExpenses - totalSalaryPaid
    : overview?.currentBalance ?? totalFunds - totalExpenses - totalSalaryPaid;
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
                  <Link href="/transactions?type=fund">
                    <button className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                      View fund transactions
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </Link>
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
            label={selectedMonth ? "Miscellaneous Expenditure" : "Total Miscellaneous Expenditure"}
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
            <CardHeader>
              <CardTitle className="text-base">Funds vs Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorFunds" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Area type="monotone" dataKey="funds" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorFunds)" />
                    <Area type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))" fillOpacity={1} fill="url(#colorExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Salary Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))" }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Bar dataKey="salary" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

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
