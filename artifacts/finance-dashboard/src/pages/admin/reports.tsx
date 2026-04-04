import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3, Download, Receipt, Wallet, WalletCards, Clock3 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function isInMonth(date: string, month: string) {
  return date.slice(0, 7) === month;
}

export default function AdminReportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: salaries = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => api.getExpenses() });
  const { data: funds = [] } = useQuery({ queryKey: ["funds"], queryFn: api.getFunds });
  const { data: projectSummary = [] } = useQuery({
    queryKey: ["projectBudgetSummary"],
    queryFn: api.getProjectBudgetSummary,
  });

  const report = useMemo(() => {
    const monthTimesheets = timesheets.filter((entry) => isInMonth(entry.weekStart, selectedMonth));
    const monthSalaries = salaries.filter((salary) => isInMonth(salary.date, selectedMonth));
    const monthExpenses = expenses.filter((expense) => isInMonth(expense.date, selectedMonth));
    const monthFunds = funds.filter((fund) => isInMonth(fund.date, selectedMonth));

    const totalHours = monthTimesheets.reduce(
      (sum, entry) =>
        sum +
        entry.lines.reduce(
          (lineSum, line) =>
            lineSum + Object.values(line.hours).reduce((hoursSum, value) => hoursSum + Number(value ?? 0), 0),
          0,
        ),
      0,
    );

    const salariesPayable = monthSalaries
      .filter((salary) => salary.status === "pending")
      .reduce((sum, salary) => sum + salary.amount, 0);
    const approvedExpenses = monthExpenses
      .filter((expense) => expense.status === "approved")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const pendingExpenses = monthExpenses
      .filter((expense) => expense.status === "submitted" || expense.status === "draft")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const totalFunds = monthFunds.reduce((sum, fund) => sum + fund.amount, 0);

    const employeeRows = employees
      .map((employee) => {
        const employeeHours = monthTimesheets
          .filter((entry) => entry.employeeId === employee.id)
          .reduce(
            (sum, entry) =>
              sum +
              entry.lines.reduce(
                (lineSum, line) =>
                  lineSum + Object.values(line.hours).reduce((hoursSum, value) => hoursSum + Number(value ?? 0), 0),
                0,
              ),
            0,
          );
        return {
          id: employee.id,
          name: employee.name,
          department: employee.department,
          hours: employeeHours,
        };
      })
      .filter((row) => row.hours > 0)
      .sort((left, right) => right.hours - left.hours);

    return {
      totalHours,
      salariesPayable,
      approvedExpenses,
      pendingExpenses,
      totalFunds,
      employeeRows,
      projectRows: projectSummary,
    };
  }, [employees, expenses, funds, projectSummary, salaries, selectedMonth, timesheets]);

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1120,height=820");
    if (!popup) {
      return;
    }

    const monthLabel = format(new Date(`${selectedMonth}-01T00:00:00`), "MMMM yyyy");
    popup.document.write(`
      <html>
        <head>
          <title>Monthly Summary - ${monthLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
            h1 { margin-bottom: 4px; }
            p { color: #475569; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
            .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
            .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .08em; }
            .value { font-size: 24px; font-weight: 700; margin-top: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Monthly Summary Report</h1>
          <p>${monthLabel}</p>
          <div class="grid">
            <div class="card"><div class="label">Total Hours</div><div class="value">${report.totalHours.toFixed(1)}h</div></div>
            <div class="card"><div class="label">Salaries Payable</div><div class="value">${formatCurrency(report.salariesPayable)}</div></div>
            <div class="card"><div class="label">Approved Expenses</div><div class="value">${formatCurrency(report.approvedExpenses)}</div></div>
            <div class="card"><div class="label">Pending Expenses</div><div class="value">${formatCurrency(report.pendingExpenses)}</div></div>
          </div>
          <h2>Employee Summary</h2>
          <table>
            <thead><tr><th>Employee</th><th>Department</th><th>Hours</th></tr></thead>
            <tbody>
              ${report.employeeRows.map((row) => `<tr><td>${row.name}</td><td>${row.department}</td><td>${row.hours.toFixed(1)}h</td></tr>`).join("")}
            </tbody>
          </table>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Month-wise summary of hours, salary liability, expenses, and project budget usage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="w-[220px]"
            />
            <Button className="rounded-xl" variant="outline" onClick={exportPdf}>
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <DashboardCard label="Total Hours Logged" value={`${report.totalHours.toFixed(1)}h`} icon={<Clock3 className="h-5 w-5" />} />
          <DashboardCard label="Salaries Payable" value={formatCurrency(report.salariesPayable)} icon={<WalletCards className="h-5 w-5" />} />
          <DashboardCard label="Approved Expenses" value={formatCurrency(report.approvedExpenses)} icon={<Receipt className="h-5 w-5" />} />
          <DashboardCard label="Pending Expenses" value={formatCurrency(report.pendingExpenses)} icon={<BarChart3 className="h-5 w-5" />} />
          <DashboardCard label="Funds Added" value={formatCurrency(report.totalFunds)} icon={<Wallet className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Employee-wise Summary</CardTitle>
              <CardDescription>Top contributors for the selected month.</CardDescription>
            </CardHeader>
            <CardContent>
              {report.employeeRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  No employee hours logged for this month yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {report.employeeRows.map((row) => {
                    const width = report.totalHours > 0 ? (row.hours / report.totalHours) * 100 : 0;
                    return (
                      <div key={row.id} className="space-y-2 rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{row.name}</p>
                            <p className="text-xs text-muted-foreground">{row.department}</p>
                          </div>
                          <p className="text-sm font-medium">{row.hours.toFixed(1)}h</p>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-secondary/60">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, width)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Project-wise Budget Summary</CardTitle>
              <CardDescription>Live spent versus remaining by project.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.projectRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No project budgets created yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.projectRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.project}</TableCell>
                        <TableCell>{row.client || "—"}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalBudget)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.spent)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.remainingBudget)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
