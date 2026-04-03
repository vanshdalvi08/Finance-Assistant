import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDownRight, ArrowUpRight, DollarSign, Users, Wallet, Receipt } from "lucide-react";
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

export default function Dashboard() {
  const { data: chartData = [] } = useQuery({ queryKey: ["chartData"], queryFn: api.getChartData });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: api.getTransactions });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: funds = [] } = useQuery({ queryKey: ["funds"], queryFn: api.getFunds });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => api.getExpenses() });
  const { data: salaries = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: overview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const approvedExpenses = expenses.filter((expense) => expense.status === "approved");

  const activeEmployees = overview?.activeEmployees ?? employees.filter((employee) => employee.status === "Active").length;
  const totalFunds = overview?.totalFunds ?? funds.reduce((sum, fund) => sum + fund.amount, 0);
  const totalExpenses = overview?.totalExpenses ?? expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalSalaryPaid = overview?.totalSalaryPaid ?? salaries.reduce((sum, salary) => sum + salary.amount, 0);
  const recentTransactions = transactions.slice(0, 6);
  const currentMonth = getMonthWindow(0);
  const previousMonth = getMonthWindow(-1);

  const currentMonthFunds = sumForMonth(funds, currentMonth);
  const previousMonthFunds = sumForMonth(funds, previousMonth);
  const currentMonthExpenses = sumForMonth(approvedExpenses, currentMonth);
  const previousMonthExpenses = sumForMonth(approvedExpenses, previousMonth);
  const currentMonthSalaries = sumForMonth(salaries, currentMonth);
  const previousMonthSalaries = sumForMonth(salaries, previousMonth);

  const fundsTrend = calculatePercentChange(currentMonthFunds, previousMonthFunds);
  const expensesTrend = calculatePercentChange(previousMonthExpenses, currentMonthExpenses);
  const salaryTrend = calculatePercentChange(currentMonthSalaries, previousMonthSalaries);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">Your institutional financial summary.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <DashboardCard
            label="Total Funds"
            value={totalFunds.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={fundsTrend}
            trendLabel="vs last month"
            icon={<Wallet className="w-5 h-5" />}
          />
          <DashboardCard
            label="Total Expenses"
            value={totalExpenses.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={expensesTrend}
            trendLabel="vs last month"
            icon={<Receipt className="w-5 h-5" />}
          />
          <DashboardCard
            label="Total Salary Paid"
            value={totalSalaryPaid.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            trend={salaryTrend}
            trendLabel="vs last month"
            icon={<DollarSign className="w-5 h-5" />}
          />
          <DashboardCard
            label="Active Employees"
            value={activeEmployees.toString()}
            icon={<Users className="w-5 h-5" />}
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
            <CardTitle className="text-base">Recent Transactions</CardTitle>
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
