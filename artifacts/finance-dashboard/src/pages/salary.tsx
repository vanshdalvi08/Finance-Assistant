import { useEffect, useMemo, useState } from "react";
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
import type { FinancialAccount } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PayrollStatus = "pending" | "paid";

type SalaryRecord = {
  id: string;
  accountId?: string;
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

function accountDisplayName(account: FinancialAccount) {
  const typeLabel =
    account.accountType === "mixed_use"
      ? "Mixed Use"
      : account.accountType === "operational"
        ? "Operational"
        : account.accountType === "reserve"
          ? "Reserve"
          : account.accountType === "cash"
            ? "Cash"
            : "Personal";

  return `${account.name} • ${typeLabel}`;
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

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaidHistory, setShowPaidHistory] = useState(false);
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaryData = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: adminOverview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const { data: financialAccounts = [] } = useQuery({ queryKey: ["financialAccounts"], queryFn: api.getFinancialAccounts });
  const salaries = salaryData as SalaryRecord[];

  useEffect(() => {
    if (financialAccounts.length === 0) {
      return;
    }

    setAccountSelections((current) => {
      const next = { ...current };
      const preferred =
        financialAccounts.find((account) => account.accountType === "operational" && account.isActive)
        ?? financialAccounts.find((account) => account.isActive)
        ?? financialAccounts[0];

      for (const record of salaries.filter((item) => getPayrollStatus(item) === "pending")) {
        if (next[record.id] || record.accountId) {
          continue;
        }
        if (preferred) {
          next[record.id] = preferred.id;
        }
      }

      return next;
    });
  }, [financialAccounts, salaries]);

  const accountBalances = useMemo(
    () => new Map((adminOverview?.financialAccounts ?? []).map((account) => [account.id, account.balance])),
    [adminOverview?.financialAccounts],
  );

  const pendingPayroll = salaries.filter((record) => getPayrollStatus(record) === "pending");
  const paidPayroll = salaries.filter((record) => getPayrollStatus(record) === "paid");

  const pendingAmount = pendingPayroll.reduce((sum, record) => sum + getPayrollAmount(record), 0);
  const paidThisMonth = paidPayroll
    .filter((record) => getPayrollDate(record).slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, record) => sum + getPayrollAmount(record), 0);

  const paySalaryRecord = (api as any).paySalaryRecord as
    | undefined
    | ((id: string, input?: { note?: string; accountId?: string }) => Promise<SalaryRecord>);

  const payMutation = useMutation({
    mutationFn: async (record: SalaryRecord): Promise<{ persisted: boolean; record: SalaryRecord }> => {
      const accountId = accountSelections[record.id] ?? record.accountId;
      if (typeof paySalaryRecord === "function") {
        const updatedRecord = await paySalaryRecord(record.id, { accountId });
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
      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, updatedRecord));
      queryClient.setQueryData<SalaryRecord[]>(["employee-salaries", record.employeeId], (current) =>
        upsertSalaryRecord(current, updatedRecord),
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["chartData"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      ]);

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
                      <TableHead>Paid Through</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayroll.length === 0 ? (
                      <TableRow className="border-border/50">
                        <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                          No pending payroll records.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingPayroll.map((record) => {
                        const employee = employees.find((item) => item.id === record.employeeId);
                        const employeeName = record.employeeNameSnapshot ?? employee?.name ?? "Unknown";
                        const amount = getPayrollAmount(record);
                        const selectedAccountId = accountSelections[record.id] ?? record.accountId;
                        const availableBalance = selectedAccountId ? accountBalances.get(selectedAccountId) ?? 0 : 0;
                        const insufficientFunds = Boolean(selectedAccountId) && amount > availableBalance;

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
                              <Select
                                value={selectedAccountId ?? ""}
                                onValueChange={(value) =>
                                  setAccountSelections((current) => ({ ...current, [record.id]: value }))
                                }
                              >
                                <SelectTrigger className="h-8 w-[190px] rounded-full border-border/60 bg-background/70 text-xs">
                                  <SelectValue placeholder="Select account" />
                                </SelectTrigger>
                                <SelectContent>
                                  {financialAccounts.filter((account) => account.isActive).map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                      {accountDisplayName(account)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
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
                                disabled={payMutation.isPending || !selectedAccountId || insufficientFunds}
                                title={
                                  !selectedAccountId
                                    ? "Select the financial account used for this payout."
                                    : insufficientFunds
                                      ? "Not enough available funds in the selected account."
                                      : undefined
                                }
                              >
                                {!selectedAccountId ? "Select Account" : insufficientFunds ? "Insufficient Funds" : "Pay Salary"}
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
