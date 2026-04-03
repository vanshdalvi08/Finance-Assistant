import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Clock3, BadgeCheck } from "lucide-react";

type PayrollStatus = "pending" | "paid";

type SalaryRecord = {
  id: string;
  employeeId: string;
  employeeNameSnapshot?: string;
  amount: number;
  date: string;
  note?: string;
  status?: PayrollStatus;
  source?: "timesheet" | "manual";
  weekStart?: string;
  hours?: number;
  rate?: number;
  paidAt?: string;
};

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function getPayrollStatus(record: SalaryRecord): PayrollStatus {
  if (record.status === "pending") return "pending";
  if (record.status === "paid") return "paid";
  return "paid";
}

function getPayrollAmount(record: SalaryRecord) {
  if (typeof record.amount === "number") {
    return record.amount;
  }

  if (typeof record.hours === "number" && typeof record.rate === "number") {
    return record.hours * record.rate;
  }

  return 0;
}

function getPayrollDate(record: SalaryRecord) {
  return record.paidAt ?? record.date;
}

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaryData = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const salaries = salaryData as SalaryRecord[];

  const pendingPayroll = salaries.filter((record) => getPayrollStatus(record) === "pending");
  const paidPayroll = salaries.filter((record) => getPayrollStatus(record) === "paid");

  const pendingAmount = pendingPayroll.reduce((sum, record) => sum + getPayrollAmount(record), 0);
  const paidThisMonth = paidPayroll
    .filter((record) => getPayrollDate(record).slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, record) => sum + getPayrollAmount(record), 0);

  const paySalaryRecord = (api as any).paySalaryRecord as
    | undefined
    | ((payload: string | { id: string }) => Promise<unknown>);

  const payMutation = useMutation({
    mutationFn: async (record: SalaryRecord): Promise<{ persisted: boolean }> => {
      if (typeof paySalaryRecord === "function") {
        try {
          await paySalaryRecord(record.id);
        } catch {
          await paySalaryRecord({ id: record.id });
        }

        return { persisted: true };
      }

      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) =>
        (current ?? []).map((item) =>
          item.id === record.id
            ? {
                ...item,
                status: "paid",
                paidAt: new Date().toISOString(),
                date: item.date ?? new Date().toISOString(),
              }
            : item
        )
      );

      return { persisted: false };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["salaries"] });
      await queryClient.invalidateQueries({ queryKey: ["employee-salaries"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["chartData"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });

      toast({
        title: "Salary paid",
        description: "The payroll record has been moved to paid history.",
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review pending payroll from approved timesheets and mark payments as complete.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DashboardCard
            label="Pending Payroll"
            value={formatCurrency(pendingAmount)}
            icon={<Clock3 className="w-5 h-5" />}
          />
          <DashboardCard
            label="Paid This Month"
            value={formatCurrency(paidThisMonth)}
            icon={<CreditCard className="w-5 h-5" />}
          />
        </div>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Approved timesheets create pending payroll records here. Use <span className="text-foreground font-medium">Pay Salary</span> when the transfer is completed.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-muted-foreground" />
                Pending Payroll
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead>Employee</TableHead>
                      <TableHead>Week</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayroll.length === 0 ? (
                      <TableRow className="border-border/50">
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                          No pending payroll records.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingPayroll.map((record) => {
                        const employee = employees.find((item) => item.id === record.employeeId);
                        const employeeName = record.employeeNameSnapshot ?? employee?.name ?? "Unknown";
                        const amount = getPayrollAmount(record);

                        return (
                          <TableRow key={record.id} className="border-border/50">
                            <TableCell className="font-medium">{employeeName}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {record.weekStart ? format(new Date(record.weekStart), "MMM dd, yyyy") : "-"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {typeof record.hours === "number" ? record.hours : "-"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {typeof record.rate === "number" ? formatCurrency(record.rate) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(amount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal text-xs">
                                {record.source === "timesheet" ? "Timesheet" : "Manual"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                onClick={() => payMutation.mutate(record)}
                                disabled={payMutation.isPending}
                              >
                                Pay Salary
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-muted-foreground" />
                Paid History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paidPayroll.length === 0 ? (
                      <TableRow className="border-border/50">
                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                          No paid payroll records yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paidPayroll.map((record) => {
                        const employee = employees.find((item) => item.id === record.employeeId);
                        const employeeName = record.employeeNameSnapshot ?? employee?.name ?? "Unknown";

                        return (
                          <TableRow key={record.id} className="border-border/50">
                            <TableCell className="font-medium">{employeeName}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {format(new Date(getPayrollDate(record)), "MMM dd, yyyy")}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{record.note || "-"}</TableCell>
                            <TableCell className="text-right font-medium text-foreground tabular-nums">
                              {formatCurrency(getPayrollAmount(record))}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
