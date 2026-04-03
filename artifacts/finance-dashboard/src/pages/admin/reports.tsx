import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR" });
}

export default function AdminReportsPage() {
  const { data: overview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
  });

  const { data: chartData = [] } = useQuery({
    queryKey: ["chartData"],
    queryFn: api.getChartData,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["expenseCategories"],
    queryFn: api.getExpenseCategories,
  });

  const { data: timesheetSummary } = useQuery({
    queryKey: ["timesheet-summary"],
    queryFn: () => api.getTimesheetSummary(),
  });

  const reportRows = useMemo(
    () =>
      chartData.map((item) => ({
        ...item,
        net: item.funds - item.expenses - item.salary,
      })),
    [chartData],
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">A minimal management view across finance, payroll, and timesheet operations.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard label="Current Balance" value={formatCurrency(overview?.currentBalance ?? 0)} />
          <DashboardCard label="MTD Funds" value={formatCurrency(overview?.monthToDateFunds ?? 0)} />
          <DashboardCard label="MTD Expenses" value={formatCurrency(overview?.monthToDateExpenses ?? 0)} />
          <DashboardCard label="Pending Timesheets" value={`${timesheetSummary?.pending ?? 0}`} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Funds vs Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="reportFunds" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="reportExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.28} />
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
                    />
                    <Area type="monotone" dataKey="funds" stroke="hsl(var(--primary))" fill="url(#reportFunds)" />
                    <Area type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))" fill="url(#reportExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Payroll & Expense Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
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
                    />
                    <Bar dataKey="salary" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Six-Month Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Funds</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportRows.map((row) => (
                    <TableRow key={row.month} className="border-border/50">
                      <TableCell className="font-medium">{row.month}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.funds)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.expenses)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salary)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(row.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Operational Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active employees</span>
                <span className="font-medium">{overview?.activeEmployees ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Year-to-date funds</span>
                <span className="font-medium">{formatCurrency(overview?.yearToDateFunds ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Year-to-date expenses</span>
                <span className="font-medium">{formatCurrency(overview?.yearToDateExpenses ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending expense approvals</span>
                <span className="font-medium">{overview?.pendingExpenses ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending timesheets</span>
                <span className="font-medium">{overview?.pendingTimesheets ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tracked hours</span>
                <span className="font-medium">{timesheetSummary?.totalHours ?? 0}h</span>
              </div>
              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-2">Expense category mix</p>
                <div className="space-y-2">
                  {categories.slice(0, 5).map((category) => (
                    <div key={category.name} className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm">
                      <span>{category.name}</span>
                      <Badge variant="outline">{formatCurrency(category.value)}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
