import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleDollarSign, Landmark, Receipt, ShieldCheck, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/app/status-pill";
import { formatCurrency } from "@/lib/utils";
import { yojakData } from "@/lib/yojak-data";

export default function AdminDashboardPage() {
  const { data: overview } = useQuery({ queryKey: ["yojak-admin-overview"], queryFn: yojakData.getAdminOverview });
  const { data: series = [] } = useQuery({ queryKey: ["yojak-finance-series"], queryFn: yojakData.getFinanceChartSeries });
  const { data: transactions = [] } = useQuery({ queryKey: ["yojak-transactions"], queryFn: yojakData.getTransactions });
  const { data: timesheetSummary } = useQuery({ queryKey: ["yojak-timesheet-summary"], queryFn: yojakData.getTimesheetSummary });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin command center"
        title="Financial command"
        description="Monitor funds, expenses, payroll, and weekly operations with a clear ledger-first view."
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <MetricCard label="Total Funds" value={formatCurrency(overview?.totalFunds ?? 0)} icon={<Wallet className="h-5 w-5" />} />
        <MetricCard label="Salary Paid" value={formatCurrency(overview?.totalSalaryPaid ?? 0)} icon={<CircleDollarSign className="h-5 w-5" />} />
        <MetricCard label="Total Expenses" value={formatCurrency(overview?.totalExpenses ?? 0)} icon={<Receipt className="h-5 w-5" />} />
        <MetricCard label="Active Employees" value={`${overview?.activeEmployees ?? 0}`} icon={<Users className="h-5 w-5" />} />
        <MetricCard label="Current Balance" value={formatCurrency(overview?.currentBalance ?? 0)} icon={<Landmark className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.8fr_1fr]">
        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Month-to-date flow</CardTitle>
          </CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="funds-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d8b26a" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#d8b26a" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="expenses-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9a5a5e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#9a5a5e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" stroke="rgba(201,197,190,0.7)" />
                <YAxis stroke="rgba(201,197,190,0.7)" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15,14,14,0.96)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 18,
                  }}
                />
                <Area dataKey="funds" stroke="#d8b26a" fill="url(#funds-fill)" strokeWidth={2} />
                <Area dataKey="expenses" stroke="#9a5a5e" fill="url(#expenses-fill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Operations pulse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Month to date</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(overview?.monthToDateFunds ?? 0)}</p>
              <p className="text-sm text-muted-foreground">Funds received this month</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Year to date</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(overview?.yearToDateFunds ?? 0)}</p>
              <p className="text-sm text-muted-foreground">Revenue and capital inflow</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-foreground">Pending expenses</p>
                  <StatusPill status="submitted" />
                </div>
                <p className="mt-3 text-3xl font-semibold text-foreground">{overview?.pendingExpenseApprovals ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-foreground">Timesheet approvals</p>
                  <ShieldCheck className="h-4 w-4 text-[#d8b26a]" />
                </div>
                <p className="mt-3 text-3xl font-semibold text-foreground">{timesheetSummary?.pending ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Year-to-date allocation</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" stroke="rgba(201,197,190,0.7)" />
                <YAxis stroke="rgba(201,197,190,0.7)" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15,14,14,0.96)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 18,
                  }}
                />
                <Bar dataKey="payroll" fill="#6b7cbd" radius={[10, 10, 0, 0]} />
                <Bar dataKey="expenses" fill="#3d9f87" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Recent transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.slice(0, 6).map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{transaction.title}</p>
                        <p className="text-xs text-muted-foreground">{transaction.actor}</p>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{transaction.category}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(transaction.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
