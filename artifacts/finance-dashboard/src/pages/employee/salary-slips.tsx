import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR" });
}

function cycleLabel(date: string) {
  return new Date(date).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function EmployeeSalarySlipsPage() {
  const user = useAuthStore((state) => state.user);

  const { data: employee } = useQuery({
    queryKey: ["employee-profile", user?.id, user?.email],
    queryFn: async () => {
      if (!user) {
        return null;
      }

      const existing = await api.getEmployeeProfile({ employeeId: user.id, email: user.email });
      if (existing) {
        return existing;
      }

      return api.ensureEmployeeProfile({
        id: user.id,
        email: user.email,
        name: user.name ?? user.email.split("@")[0],
        phone: user.phone,
        employeeId: user.employeeId,
        role: user.position,
        department: user.department,
        salary: user.salary,
        payType: user.payType,
        hourlyRate: user.hourlyRate,
        status: user.status,
      });
    },
    enabled: Boolean(user),
  });

  const { data: salaries = [] } = useQuery({
    queryKey: ["employee-salaries", employee?.id],
    queryFn: () => api.getSalarySlips({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  const ordered = useMemo(
    () =>
      [...salaries].sort(
        (left, right) => new Date(right.paidAt ?? right.date).getTime() - new Date(left.paidAt ?? left.date).getTime(),
      ),
    [salaries],
  );

  const totalPaid = ordered
    .filter((salary) => salary.status === "paid")
    .reduce((sum, salary) => sum + salary.amount, 0);
  const pendingCount = ordered.filter((salary) => salary.status === "pending").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Salary Slips</h1>
          <p className="mt-1 text-sm text-muted-foreground">A minimal record of payroll cycles and payout history.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DashboardCard label="Total Paid" value={formatCurrency(totalPaid)} />
          <DashboardCard label="Payroll Records" value={ordered.length.toString()} />
          <DashboardCard label="Pending" value={pendingCount.toString()} />
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Payroll History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Cycle</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.length === 0 ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No salary records yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  ordered.map((salary) => (
                    <TableRow key={salary.id} className="border-border/50">
                      <TableCell className="font-medium">{cycleLabel(salary.weekStart ?? salary.date)}</TableCell>
                      <TableCell>{dateLabel(salary.paidAt ?? salary.date)}</TableCell>
                      <TableCell>
                        <Badge variant={salary.status === "pending" ? "outline" : "secondary"} className="capitalize">
                          {salary.status ?? "paid"}
                        </Badge>
                      </TableCell>
                      <TableCell>{salary.note || "-"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(salary.amount)}</TableCell>
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
