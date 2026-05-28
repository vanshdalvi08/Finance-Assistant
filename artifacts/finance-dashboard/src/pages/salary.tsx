import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { addDays, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Clock3, BadgeCheck, Plus, ChevronRight, CalendarDays } from "lucide-react";
import type { FinancialAccount, TimesheetEntry } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type PayrollStatus = "pending" | "paid";
type SalaryEntryMode = "pending_record" | "historical_paid";
type SalaryEmployeeMode = "existing" | "former";

type SalaryRecord = {
  id: string;
  accountId?: string;
  employeeId?: string;
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
  timesheetId?: string;
};

type PendingPayrollGroup = {
  key: string;
  employeeId?: string;
  employeeName: string;
  records: SalaryRecord[];
  totalHours: number;
  totalAmount: number;
  hourlyRate?: number;
  monthLabels: string[];
};

type WorklogDay = {
  key: string;
  dayLabel: string;
  dateLabel: string;
  monthLabel: string;
  hours: number;
  workNote: string;
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

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
        ? "Main"
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

function monthLabelFromRecord(record: SalaryRecord) {
  const sourceDate = record.weekStart ?? record.date;
  return sourceDate ? format(new Date(sourceDate), "MMMM yyyy") : "Unknown month";
}

function weekRangeLabel(sourceDate: string) {
  const weekStart = new Date(sourceDate);
  const weekEnd = addDays(weekStart, 6);
  return `${format(weekStart, "dd MMM yyyy")} - ${format(weekEnd, "dd MMM yyyy")}`;
}

function buildWorklogDays(timesheet: TimesheetEntry): WorklogDay[] {
  const rows = DAY_KEYS.map((dayKey, offset) => {
    const date = addDays(new Date(timesheet.weekStart), offset);
    const hours = timesheet.lines.reduce((sum, line) => sum + Number(line.hours?.[dayKey] ?? 0), 0);
    const workNote = timesheet.lines
      .map((line) => line.workNotes?.[dayKey]?.trim() ?? "")
      .filter((value) => value.length > 0)
      .join(" | ");

    return {
      key: `${timesheet.id}-${dayKey}`,
      dayLabel: format(date, "EEE"),
      dateLabel: format(date, "dd MMM yyyy"),
      monthLabel: format(date, "MMMM yyyy"),
      hours,
      workNote,
    };
  });

  return rows.filter((row) => row.hours > 0 || row.workNote.length > 0);
}

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaidHistory, setShowPaidHistory] = useState(false);
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<SalaryEntryMode>("historical_paid");
  const [salaryEmployeeMode, setSalaryEmployeeMode] = useState<SalaryEmployeeMode>("existing");
  const [salaryEmployeeId, setSalaryEmployeeId] = useState("");
  const [salaryFormerEmployeeName, setSalaryFormerEmployeeName] = useState("");
  const [salaryDate, setSalaryDate] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryAccountId, setSalaryAccountId] = useState("");
  const [salaryNote, setSalaryNote] = useState("");

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaryData = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: adminOverview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const { data: financialAccounts = [] } = useQuery({ queryKey: ["financialAccounts"], queryFn: api.getFinancialAccounts });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const salaries = salaryData as SalaryRecord[];
  const timesheetEntries = timesheets as TimesheetEntry[];
  const activeAccounts = useMemo(
    () => financialAccounts.filter((account) => account.isActive),
    [financialAccounts],
  );

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
  const selectedDialogAccount = activeAccounts.find((account) => account.id === salaryAccountId) ?? null;
  const selectedDialogAccountBalance = selectedDialogAccount ? accountBalances.get(selectedDialogAccount.id) ?? null : null;

  const pendingPayroll = salaries.filter((record) => getPayrollStatus(record) === "pending");
  const paidPayroll = salaries.filter((record) => getPayrollStatus(record) === "paid");
  const timesheetById = useMemo(
    () => new Map(timesheetEntries.map((entry) => [entry.id, entry])),
    [timesheetEntries],
  );

  const pendingPayrollGroups = useMemo(() => {
    const groups = new Map<string, PendingPayrollGroup>();

    for (const record of pendingPayroll) {
      const employee = employees.find((item) => item.id === record.employeeId);
      const employeeName = record.employeeNameSnapshot ?? employee?.name ?? "Unknown";
      const key = record.employeeId?.trim() || employeeName.toLowerCase();
      const existing =
        groups.get(key) ??
        ({
          key,
          employeeId: record.employeeId,
          employeeName,
          records: [],
          totalHours: 0,
          totalAmount: 0,
          hourlyRate: undefined,
          monthLabels: [],
        } satisfies PendingPayrollGroup);

      existing.records.push(record);
      existing.totalHours += Number(record.hours ?? 0);
      existing.totalAmount += getPayrollAmount(record);
      if (!existing.hourlyRate && typeof record.rate === "number" && record.rate > 0) {
        existing.hourlyRate = record.rate;
      }
      const monthLabel = monthLabelFromRecord(record);
      if (!existing.monthLabels.includes(monthLabel)) {
        existing.monthLabels.push(monthLabel);
      }
      groups.set(key, existing);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        records: [...group.records].sort((left, right) => {
          const leftDate = new Date(left.weekStart ?? left.date).getTime();
          const rightDate = new Date(right.weekStart ?? right.date).getTime();
          return leftDate - rightDate;
        }),
        totalAmount:
          typeof group.hourlyRate === "number" && group.hourlyRate > 0
            ? Math.round(group.totalHours * group.hourlyRate)
            : group.totalAmount,
      }))
      .sort((left, right) => right.totalAmount - left.totalAmount);
  }, [employees, pendingPayroll]);

  const pendingAmount = pendingPayroll.reduce((sum, record) => sum + getPayrollAmount(record), 0);
  const paidThisMonth = paidPayroll
    .filter((record) => getPayrollDate(record).slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, record) => sum + getPayrollAmount(record), 0);

  const payMutation = useMutation({
    mutationFn: async (record: SalaryRecord): Promise<{ persisted: boolean; record: SalaryRecord }> => {
      const accountId = accountSelections[record.id] ?? record.accountId;
      const updatedRecord = await api.paySalaryRecord(record.id, { accountId });
      return { persisted: true, record: updatedRecord ?? record };
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
      if (record.employeeId) {
        queryClient.setQueryData<SalaryRecord[]>(["employee-salaries", record.employeeId], (current) =>
          upsertSalaryRecord(current, updatedRecord),
        );
      }
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

  useEffect(() => {
    if (salaryAccountId || activeAccounts.length === 0) {
      return;
    }

    const preferred =
      activeAccounts.find((account) => account.accountType === "operational")
      ?? activeAccounts[0];
    if (preferred) {
      setSalaryAccountId(preferred.id);
    }
  }, [activeAccounts, salaryAccountId]);

  useEffect(() => {
    if (entryMode !== "historical_paid" && salaryEmployeeMode !== "existing") {
      setSalaryEmployeeMode("existing");
    }
  }, [entryMode, salaryEmployeeMode]);

  const createSalaryMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(salaryAmount || 0);
      const useFormerEmployee = entryMode === "historical_paid" && salaryEmployeeMode === "former";
      const formerEmployeeName = salaryFormerEmployeeName.trim();
      if (!useFormerEmployee && !salaryEmployeeId) {
        throw new Error("Select an employee.");
      }
      if (useFormerEmployee && !formerEmployeeName) {
        throw new Error("Enter the former employee name.");
      }
      if (!salaryDate) {
        throw new Error("Select a salary date.");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Salary amount must be greater than zero.");
      }
      if (entryMode === "historical_paid" && !salaryAccountId) {
        throw new Error("Select the account used for this payout.");
      }

      const payload = {
        employeeId: useFormerEmployee ? undefined : salaryEmployeeId,
        employeeNameSnapshot: useFormerEmployee ? formerEmployeeName : undefined,
        amount,
        date: salaryDate,
        note: salaryNote.trim() || undefined,
        accountId: entryMode === "historical_paid" ? salaryAccountId || undefined : undefined,
      };

      return entryMode === "historical_paid"
        ? api.recordHistoricalSalary(payload)
        : api.addSalary({
            ...payload,
            source: "manual",
            status: "pending",
          });
    },
    onSuccess: (createdRecord) => {
      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, createdRecord as SalaryRecord));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["salaries"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["chartData"] }),
      ]);
      toast({
        title: entryMode === "historical_paid" ? "Historical salary recorded" : "Salary record created",
        description:
          entryMode === "historical_paid"
            ? "The older salary payout was added directly to paid history."
            : "The manual salary record is now available in pending payroll.",
      });
      setDialogOpen(false);
      setEntryMode("historical_paid");
      setSalaryEmployeeMode("existing");
      setSalaryEmployeeId("");
      setSalaryFormerEmployeeName("");
      setSalaryDate(new Date().toISOString().split("T")[0] ?? "");
      setSalaryAmount("");
      setSalaryNote("");
    },
    onError: (error) => {
      toast({
        title: "Could not save salary record",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Payroll Management</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Review pending payroll from approved timesheets and add older salary records cleanly.
            </p>
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEntryMode("historical_paid");
                setSalaryEmployeeMode("existing");
                setSalaryFormerEmployeeName("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="rounded-xl">
                <Plus className="mr-2 h-4 w-4" />
                Log Salary
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Log Salary Entry</DialogTitle>
              </DialogHeader>

              <div className="space-y-2.5 pt-1">
                <div className="space-y-1.5">
                  <Label>Entry Mode</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/10 p-1">
                    <button
                      type="button"
                      onClick={() => setEntryMode("pending_record")}
                      className={cn(
                        "rounded-[1.1rem] px-3 py-2 text-left text-xs transition-all",
                        entryMode === "pending_record"
                          ? "bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.12)] ring-1 ring-primary/20"
                          : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                      )}
                    >
                      <div className={cn("font-medium", entryMode === "pending_record" ? "text-primary" : "text-foreground")}>
                        Pending Record
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Current manual payroll</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryMode("historical_paid")}
                      className={cn(
                        "rounded-[1.1rem] px-3 py-2 text-left text-xs transition-all",
                        entryMode === "historical_paid"
                          ? "bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.12)] ring-1 ring-primary/20"
                          : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                      )}
                    >
                      <div className={cn("font-medium", entryMode === "historical_paid" ? "text-primary" : "text-foreground")}>
                        Historical Paid
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Past paid salary</div>
                    </button>
                  </div>
                </div>

                <div className={cn("grid gap-3", entryMode === "historical_paid" ? "grid-cols-[1.3fr_0.9fr]" : "grid-cols-2")}>
                  <div className="space-y-1.5">
                    <Label>Employee</Label>
                    {entryMode === "historical_paid" ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-secondary/10 p-1">
                          <button
                            type="button"
                            onClick={() => setSalaryEmployeeMode("existing")}
                            className={cn(
                              "rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-all",
                              salaryEmployeeMode === "existing"
                                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Current employee
                          </button>
                          <button
                            type="button"
                            onClick={() => setSalaryEmployeeMode("former")}
                            className={cn(
                              "rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-all",
                              salaryEmployeeMode === "former"
                                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Former employee
                          </button>
                        </div>
                        {salaryEmployeeMode === "former" ? (
                          <Input
                            placeholder="Former employee name"
                            value={salaryFormerEmployeeName}
                            onChange={(event) => setSalaryFormerEmployeeName(event.target.value)}
                          />
                        ) : (
                          <Select value={salaryEmployeeId} onValueChange={setSalaryEmployeeId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select employee" />
                            </SelectTrigger>
                            <SelectContent>
                              {employees.map((employee) => (
                                <SelectItem key={employee.id} value={employee.id}>
                                  {employee.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Select value={salaryEmployeeId} onValueChange={setSalaryEmployeeId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((employee) => (
                            <SelectItem key={employee.id} value={employee.id}>
                              {employee.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Date</Label>
                    <Input type="date" value={salaryDate} onChange={(event) => setSalaryDate(event.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={salaryAmount}
                      onChange={(event) => setSalaryAmount(event.target.value)}
                    />
                  </div>

                  {entryMode === "historical_paid" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Paid Through</Label>
                        {selectedDialogAccountBalance !== null ? (
                          <span className="text-[11px] text-muted-foreground">
                            Bal:{" "}
                            <span className="font-semibold text-foreground">
                              {selectedDialogAccountBalance.toLocaleString("en-IN", {
                                style: "currency",
                                currency: "INR",
                              })}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      <Select value={salaryAccountId} onValueChange={setSalaryAccountId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {accountDisplayName(account)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>Mode</Label>
                      <div className="flex h-10 items-center rounded-xl border border-border/60 bg-secondary/10 px-3 text-xs text-muted-foreground">
                        This entry will stay pending until you mark it paid.
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    placeholder={entryMode === "historical_paid" ? "Apr salary payout" : "Manual payroll note"}
                    value={salaryNote}
                    onChange={(event) => setSalaryNote(event.target.value)}
                  />
                </div>

                <Button
                  className="mt-1 w-full"
                  onClick={() => createSalaryMutation.mutate()}
                  disabled={createSalaryMutation.isPending}
                >
                  {entryMode === "historical_paid" ? "Record Paid Salary" : "Create Pending Salary"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
                      <TableHead>Pending Entries</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayrollGroups.length === 0 ? (
                      <TableRow className="border-border/50">
                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                          No pending payroll records.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingPayrollGroups.map((group) => {
                        return (
                          <TableRow key={group.key} className="border-border/50">
                            <TableCell className="font-medium">
                              <div className="space-y-1">
                                <div>{group.employeeName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {group.monthLabels.join(" • ")}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {group.records.length} {group.records.length === 1 ? "entry" : "entries"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {group.totalHours || "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(group.totalAmount)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                {group.records.some((record) => record.source === "timesheet") ? (
                                  <Badge variant="outline" className="font-normal text-xs">
                                    Timesheet
                                  </Badge>
                                ) : null}
                                {group.records.some((record) => record.source === "manual") ? (
                                  <Badge variant="outline" className="font-normal text-xs">
                                    Manual
                                  </Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="outline" className="gap-2 rounded-full">
                                    View Payroll
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden">
                                  <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                      {group.employeeName} Payroll Review
                                    </DialogTitle>
                                  </DialogHeader>

                                  <ScrollArea className="max-h-[calc(88vh-5.5rem)] pr-4">
                                    <div className="space-y-4">
                                      <div className="grid gap-3 md:grid-cols-3">
                                    <Card className="border-border/60">
                                      <CardContent className="pt-5">
                                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pending Entries</div>
                                        <div className="mt-2 text-2xl font-semibold">{group.records.length}</div>
                                      </CardContent>
                                    </Card>
                                    <Card className="border-border/60">
                                      <CardContent className="pt-5">
                                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Hours</div>
                                        <div className="mt-2 text-2xl font-semibold">{group.totalHours}</div>
                                      </CardContent>
                                    </Card>
                                    <Card className="border-border/60">
                                      <CardContent className="pt-5">
                                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Amount</div>
                                        <div className="mt-2 text-2xl font-semibold">{formatCurrency(group.totalAmount)}</div>
                                      </CardContent>
                                    </Card>
                                      </div>

                                      <div className="grid gap-4 lg:grid-cols-[1.1fr,1.3fr]">
                                    <Card className="border-border/60">
                                      <CardHeader className="pb-3">
                                        <CardTitle className="text-sm">Pending Payout Entries</CardTitle>
                                      </CardHeader>
                                      <CardContent className="space-y-3">
                                        {group.records.map((record) => {
                                          const amount = getPayrollAmount(record);
                                          const selectedAccountId = accountSelections[record.id] ?? record.accountId;
                                          const availableBalance = selectedAccountId ? accountBalances.get(selectedAccountId) ?? 0 : 0;
                                          const insufficientFunds = Boolean(selectedAccountId) && amount > availableBalance;

                                          return (
                                            <div key={record.id} className="rounded-2xl border border-border/60 bg-background/60 p-4">
                                              <div className="flex items-start justify-between gap-4">
                                                <div>
                                                  <div className="font-medium">
                                                    {record.weekStart ? format(new Date(record.weekStart), "dd MMM yyyy") : format(new Date(record.date), "dd MMM yyyy")}
                                                  </div>
                                                  <div className="mt-1 text-xs text-muted-foreground">
                                                    {typeof record.hours === "number" ? `${record.hours}h` : "Hours not set"}
                                                    {typeof record.rate === "number" ? ` • ${formatCurrency(record.rate)} rate` : ""}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className="font-semibold tabular-nums">{formatCurrency(amount)}</div>
                                                  <Badge variant="outline" className="mt-2 text-[11px] font-normal">
                                                    {record.source === "timesheet" ? "Timesheet" : "Manual"}
                                                  </Badge>
                                                </div>
                                              </div>

                                              <div className="mt-4 space-y-3">
                                                <Select
                                                  value={selectedAccountId ?? ""}
                                                  onValueChange={(value) =>
                                                    setAccountSelections((current) => ({ ...current, [record.id]: value }))
                                                  }
                                                >
                                                  <SelectTrigger className="h-9 rounded-xl border-border/60 bg-background/70 text-xs">
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

                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                  <span>{selectedAccountId ? `Available ${formatCurrency(availableBalance)}` : "Select payout account"}</span>
                                                  {record.note ? <span className="max-w-[220px] truncate">{record.note}</span> : null}
                                                </div>

                                                <Button
                                                  size="sm"
                                                  className="w-full rounded-xl"
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
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </CardContent>
                                    </Card>

                                    <Card className="border-border/60">
                                      <CardHeader className="pb-3">
                                        <CardTitle className="text-sm">Month Work Hours & Work Notes</CardTitle>
                                      </CardHeader>
                                      <CardContent className="space-y-4">
                                        {group.records.map((record) => {
                                          const timesheet = record.timesheetId ? timesheetById.get(record.timesheetId) : undefined;
                                          const worklogDays = timesheet ? buildWorklogDays(timesheet) : [];
                                          const groupedByMonth = worklogDays.reduce<Record<string, WorklogDay[]>>((accumulator, day) => {
                                            accumulator[day.monthLabel] = [...(accumulator[day.monthLabel] ?? []), day];
                                            return accumulator;
                                          }, {});

                                          return (
                                            <div key={`${record.id}-worklog`} className="rounded-2xl border border-border/60 bg-background/50 p-4">
                                              <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                  <div className="font-medium">
                                                    {record.weekStart ? weekRangeLabel(record.weekStart) : format(new Date(record.date), "dd MMM yyyy")}
                                                  </div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {record.source === "timesheet" ? "Approved timesheet worklog" : "Manual payroll entry"}
                                                  </div>
                                                </div>
                                                <div className="text-sm font-medium tabular-nums">{typeof record.hours === "number" ? `${record.hours}h` : "-"}</div>
                                              </div>

                                              {Object.keys(groupedByMonth).length > 0 ? (
                                                Object.entries(groupedByMonth).map(([monthLabel, monthRows]) => (
                                                  <div key={`${record.id}-${monthLabel}`} className="mb-4 last:mb-0">
                                                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                                      {monthLabel}
                                                    </div>
                                                    <Table>
                                                      <TableHeader>
                                                        <TableRow className="border-border/50">
                                                          <TableHead className="w-[70px]">Day</TableHead>
                                                          <TableHead className="w-[130px]">Date</TableHead>
                                                          <TableHead className="w-[90px] text-right">Hours</TableHead>
                                                          <TableHead>Work Note</TableHead>
                                                        </TableRow>
                                                      </TableHeader>
                                                      <TableBody>
                                                        {monthRows.map((day) => (
                                                          <TableRow key={day.key} className="border-border/50">
                                                            <TableCell className="font-medium">{day.dayLabel}</TableCell>
                                                            <TableCell className="text-muted-foreground">{day.dateLabel}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{day.hours}</TableCell>
                                                            <TableCell className="text-muted-foreground">
                                                              {day.workNote || <span className="text-muted-foreground/70">No work note</span>}
                                                            </TableCell>
                                                          </TableRow>
                                                        ))}
                                                      </TableBody>
                                                    </Table>
                                                  </div>
                                                ))
                                              ) : (
                                                <div className="rounded-xl border border-dashed border-border/60 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                                                  No detailed day-wise worklog found for this payroll entry.
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </CardContent>
                                    </Card>
                                      </div>
                                    </div>
                                  </ScrollArea>
                                </DialogContent>
                              </Dialog>
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
