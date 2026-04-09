import { useState } from "react";
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
import type { AdminOverview, ChartPoint, Transaction } from "@/lib/api";

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

function upsertSalaryRecord(current: SalaryRecord[] | undefined, nextRecord: SalaryRecord) {
  if (!current) {
    return [nextRecord];
  }

  const existingIndex = current.findIndex((record) => record.id === nextRecord.id);
  if (existingIndex === -1) {
    return [nextRecord, ...current];
  }

  return current.map((record) => (record.id === nextRecord.id ? nextRecord : record));
}

function patchChartData(current: ChartPoint[] | undefined, nextRecord: SalaryRecord) {
  if (!current) {
    return current;
  }

  const monthKey = getPayrollDate(nextRecord).slice(0, 7);
  const next = current.map((point) =>
    point.month === monthKey ? { ...point, salary: point.salary + nextRecord.amount } : point,
  );

  if (next.some((point) => point.month === monthKey)) {
    return next;
  }

  return [...current, { month: monthKey, funds: 0, expenses: 0, salary: nextRecord.amount }].sort((left, right) =>
    left.month.localeCompare(right.month),
  );
}

function patchOverview(current: AdminOverview | undefined, nextRecord: SalaryRecord, previousStatus?: PayrollStatus) {
  if (!current) {
    return current;
  }

  const amount = getPayrollAmount(nextRecord);
  const previousWasPaid = previousStatus === "paid";
  const nextIsPaid = getPayrollStatus(nextRecord) === "paid";
  const delta = nextIsPaid && !previousWasPaid ? amount : 0;

  return {
    ...current,
    totalSalaryPaid: current.totalSalaryPaid + delta,
    currentBalance: current.currentBalance - delta,
  };
}

function patchTransactions(current: Transaction[] | undefined, nextRecord: SalaryRecord, employeeName: string) {
  if (!current) {
    return current;
  }

  const nextTransaction: Transaction = {
    id: `txn_${nextRecord.id}`,
    type: "salary",
    amount: -getPayrollAmount(nextRecord),
    date: getPayrollDate(nextRecord),
    description: `${employeeName} salary`,
    category: "payroll",
  };

  return [nextTransaction, ...current.filter((transaction) => transaction.id !== nextTransaction.id)];
}

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaidHistory, setShowPaidHistory] = useState(false);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaryData = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: adminOverview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const salaries = salaryData as SalaryRecord[];

  const pendingPayroll = salaries.filter((record) => getPayrollStatus(record) === "pending");
  const paidPayroll = salaries.filter((record) => getPayrollStatus(record) === "paid");

  const pendingAmount = pendingPayroll.reduce((sum, record) => sum + getPayrollAmount(record), 0);
  const paidThisMonth = paidPayroll
    .filter((record) => getPayrollDate(record).slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, record) => sum + getPayrollAmount(record), 0);

  const paySalaryRecord = (api as any).paySalaryRecord as
    | undefined
    | ((id: string) => Promise<SalaryRecord>);

  const payMutation = useMutation({
    mutationFn: async (record: SalaryRecord): Promise<{ persisted: boolean; record: SalaryRecord }> => {
      if (typeof paySalaryRecord === "function") {
        const updatedRecord = await paySalaryRecord(record.id);
        return { persisted: true, record: updatedRecord ?? record };
      }

      const updatedRecord = {
        ...record,
        status: "paid" as const,
        paidAt: new Date().toISOString(),
        date: record.date ?? new Date().toISOString(),
      };

      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, updatedRecord));
      queryClient.setQueryData<SalaryRecord[]>(["employee-salaries", record.employeeId], (current) =>
        upsertSalaryRecord(current, updatedRecord),
      );

      return { persisted: false, record: updatedRecord };
    },
    onSuccess: (_result, record) => {
      const updatedRecord =
        _result.record ??
        ({
          ...record,
          status: "paid" as const,
          paidAt: new Date().toISOString(),
          date: record.date ?? new Date().toISOString(),
        } satisfies SalaryRecord);
      const previousStatus = getPayrollStatus(record);

      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, updatedRecord));
      queryClient.setQueryData<SalaryRecord[]>(["employee-salaries", record.employeeId], (current) =>
        upsertSalaryRecord(current, updatedRecord),
      );
      queryClient.setQueryData<ChartPoint[]>(["chartData"], (current) => patchChartData(current, updatedRecord));
      queryClient.setQueryData<AdminOverview>(["adminOverview"], (current) =>
        patchOverview(current, updatedRecord, previousStatus),
      );
      queryClient.setQueryData<Transaction[]>(["transactions"], (current) =>
        patchTransactions(current, updatedRecord, updatedRecord.employeeNameSnapshot ?? record.employeeNameSnapshot ?? "Employee"),
      );

      toast({
        title: "Salary paid",
        description: "The payroll record has been moved to paid history.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not pay salary",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
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

        <div className="space-y-4">
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
                        const insufficientFunds = typeof adminOverview?.currentBalance === "number" && amount > adminOverview.currentBalance;

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
                                disabled={payMutation.isPending || insufficientFunds}
                                title={insufficientFunds ? "Not enough available funds to pay this salary yet." : undefined}
                              >
                                {insufficientFunds ? "Insufficient Funds" : "Pay Salary"}
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

          {paidPayroll.length > 0 ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                onClick={() => setShowPaidHistory((current) => !current)}
              >
                {showPaidHistory ? "Hide Paid History" : `Previous Paid Payroll (${paidPayroll.length})`}
              </Button>
            </div>
          ) : null}

          {showPaidHistory ? (
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
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
