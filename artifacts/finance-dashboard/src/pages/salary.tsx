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
import { CreditCard, Clock3, BadgeCheck, Plus, ChevronRight, CalendarDays, RotateCcw } from "lucide-react";
import type { FinancialAccount, GeneratedSalarySlip, TimesheetEntry } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SalarySlipDialog } from "@/components/salary-slip-dialog";
import type { SalarySlipDraft } from "@/lib/api";

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
  days?: number;
  paidAt?: string;
  timesheetId?: string;
};

type PendingPayrollGroup = {
  key: string;
  monthKey: string;
  employeeId?: string;
  employeeName: string;
  records: SalaryRecord[];
  approvedTimesheets: TimesheetEntry[];
  totalHours: number;
  totalDays: number;
  totalAmount: number;
  hourlyRate?: number;
  monthLabels: string[];
};

type WorklogDay = {
  key: string;
  dateKey: string;
  dayLabel: string;
  dateLabel: string;
  monthLabel: string;
  hours: number;
  workNote: string;
};

type PayrollWorklogEntry = {
  key: string;
  source: "timesheet" | "manual";
  weekStart?: string;
  date: string;
  hours?: number;
  timesheet?: TimesheetEntry;
};

type PaidHistoryRow = {
  id: string;
  employeeName: string;
  date: string;
  note: string;
  amount: number;
  downloadUrl?: string;
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function isLegacyDefaultAccount(account: FinancialAccount) {
  return account.id.startsWith("acct_operational_");
}

function createIdempotencyKey(prefix: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

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

function scopedMonthKeyFromTimesheetId(value?: string) {
  const match = value?.match(/:(\d{4}-\d{2})$/);
  return match?.[1];
}

function monthLabelFromRecord(record: SalaryRecord) {
  const sourceDate = scopedMonthKeyFromTimesheetId(record.timesheetId) ?? record.weekStart ?? record.date;
  return sourceDate ? format(new Date(sourceDate), "MMMM yyyy") : "Unknown month";
}

function monthKeyFromRecord(record: SalaryRecord) {
  const sourceDate = scopedMonthKeyFromTimesheetId(record.timesheetId) ?? record.weekStart ?? record.date;
  return sourceDate ? format(new Date(sourceDate), "yyyy-MM") : "unknown";
}

function timesheetTotalHours(timesheet: TimesheetEntry) {
  return timesheet.lines.reduce(
    (total, line) =>
      total + DAY_KEYS.reduce((lineTotal, dayKey) => lineTotal + Number(line.hours?.[dayKey] ?? 0), 0),
    0,
  );
}

function baseTimesheetId(value?: string) {
  if (!value) {
    return undefined;
  }

  return value.replace(/:\d{4}-\d{2}$/, "");
}

function weekRangeLabel(sourceDate: string) {
  const weekStart = new Date(sourceDate);
  const weekEnd = addDays(weekStart, 6);
  return `${format(weekStart, "dd MMM yyyy")} - ${format(weekEnd, "dd MMM yyyy")}`;
}

function timesheetLineTaskLabel(line: { task?: string; subTask?: string; notes?: string }) {
  const task = line.task?.trim() || line.notes?.trim() || "Custom task";
  const subTask = line.subTask?.trim();
  return subTask ? `${task} - ${subTask}` : task;
}

function buildWorklogDays(timesheet: TimesheetEntry): WorklogDay[] {
  const rows = DAY_KEYS.map((dayKey, offset) => {
    const date = addDays(new Date(timesheet.weekStart), offset);
    const hours = timesheet.lines.reduce((sum, line) => sum + Number(line.hours?.[dayKey] ?? 0), 0);
    const workNote = timesheet.lines
      .map((line) => {
        const dayHours = Number(line.hours?.[dayKey] ?? 0);
        const note = line.workNotes?.[dayKey]?.trim() ?? "";
        if (dayHours <= 0 && !note) {
          return "";
        }

        const taskLabel = timesheetLineTaskLabel(line);
        return note ? `${taskLabel}: ${note}` : taskLabel;
      })
      .filter((value) => value.length > 0)
      .join(" | ");

    return {
      key: `${timesheet.id}-${dayKey}`,
      dateKey: format(date, "yyyy-MM-dd"),
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
  const [payoutAccountSelections, setPayoutAccountSelections] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<SalaryEntryMode>("historical_paid");
  const [salaryEmployeeMode, setSalaryEmployeeMode] = useState<SalaryEmployeeMode>("existing");
  const [salaryEmployeeId, setSalaryEmployeeId] = useState("");
  const [salaryFormerEmployeeName, setSalaryFormerEmployeeName] = useState("");
  const [salaryDate, setSalaryDate] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryAccountId, setSalaryAccountId] = useState("");
  const [salaryNote, setSalaryNote] = useState("");
  const [salarySlipOpen, setSalarySlipOpen] = useState(false);
  const [salarySlipDraft, setSalarySlipDraft] = useState<SalarySlipDraft | null>(null);
  const [salarySlipExpectedNet, setSalarySlipExpectedNet] = useState(0);
  const [salarySlipIdempotencyKey, setSalarySlipIdempotencyKey] = useState("");
  const [addDayGroupKey, setAddDayGroupKey] = useState<string | null>(null);
  const [addDayDate, setAddDayDate] = useState("");
  const [recallGroupKey, setRecallGroupKey] = useState<string | null>(null);
  const [recallSelectedIds, setRecallSelectedIds] = useState<Set<string>>(new Set());

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaryData = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: adminOverview } = useQuery({ queryKey: ["adminOverview"], queryFn: api.getAdminOverview });
  const { data: financialAccounts = [] } = useQuery({ queryKey: ["financialAccounts"], queryFn: api.getFinancialAccounts });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: salarySlips = [] } = useQuery({ queryKey: ["salary-slips"], queryFn: () => api.getSalarySlips() });
  const salaries = salaryData as SalaryRecord[];
  const timesheetEntries = timesheets as TimesheetEntry[];
  const activeAccounts = useMemo(
    () => financialAccounts.filter((account) => account.isActive),
    [financialAccounts],
  );

  const accountBalances = useMemo(
    () => new Map((adminOverview?.financialAccounts ?? []).map((account) => [account.id, account.balance])),
    [adminOverview?.financialAccounts],
  );
  const selectedDialogAccount = activeAccounts.find((account) => account.id === salaryAccountId) ?? null;
  const selectedDialogAccountBalance = selectedDialogAccount ? accountBalances.get(selectedDialogAccount.id) ?? null : null;

  const pendingPayroll = useMemo(
    () => salaries.filter((record) => getPayrollStatus(record) === "pending"),
    [salaries],
  );
  const paidPayroll = useMemo(
    () => salaries.filter((record) => getPayrollStatus(record) === "paid"),
    [salaries],
  );
  const paidHistory = useMemo<PaidHistoryRow[]>(() => {
    if (salarySlips.length > 0) {
      return [...salarySlips]
        .sort((left, right) => new Date(right.paymentDate).getTime() - new Date(left.paymentDate).getTime())
        .map((slip: GeneratedSalarySlip) => ({
          id: slip.id,
          employeeName: slip.snapshot?.employeeName ?? "Unknown",
          date: slip.paymentDate,
          note: `Salary slip for ${slip.payPeriod}`,
          amount: slip.netAmount,
          downloadUrl: slip.downloadUrl,
        }));
    }

    return paidPayroll.map((record) => {
      const employee = employees.find((item) => item.id === record.employeeId);
      return {
        id: record.id,
        employeeName: record.employeeNameSnapshot ?? employee?.name ?? "Unknown",
        date: getPayrollDate(record),
        note: record.note || "-",
        amount: getPayrollAmount(record),
      };
    });
  }, [employees, paidPayroll, salarySlips]);
  const timesheetById = useMemo(
    () => new Map(timesheetEntries.map((entry) => [entry.id, entry])),
    [timesheetEntries],
  );

  const pendingPayrollGroups = useMemo(() => {
    const groups = new Map<string, PendingPayrollGroup>();

    for (const record of pendingPayroll) {
      const employee = employees.find((item) => item.id === record.employeeId);
      const employeeName = record.employeeNameSnapshot ?? employee?.name ?? "Unknown";
      const employeeKey = record.employeeId?.trim() || employeeName.toLowerCase();
      const monthKey = monthKeyFromRecord(record);
      const key = `${employeeKey}:${monthKey}`;
      const existing =
        groups.get(key) ??
        ({
          key,
          monthKey,
          employeeId: record.employeeId,
          employeeName,
          records: [],
          approvedTimesheets: [],
          totalHours: 0,
          totalDays: 0,
          totalAmount: 0,
          hourlyRate: undefined,
          monthLabels: [],
        } satisfies PendingPayrollGroup);

      existing.records.push(record);
      existing.totalHours += Number(record.hours ?? 0);
      existing.totalDays += Number(record.days ?? 0);
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
      .map((group) => {
        const pendingTimesheetIds = new Set(
          group.records
            .map((record) => record.timesheetId)
            .map((timesheetId) => baseTimesheetId(timesheetId))
            .filter((timesheetId): timesheetId is string => Boolean(timesheetId)),
        );

        const isMonthlyGroup = group.records.some((r) => r.source === "timesheet" && r.rate == null);

        return {
          ...group,
          approvedTimesheets: group.employeeId
            ? timesheetEntries
                .filter((timesheet) => {
                  if (!(timesheet.employeeId === group.employeeId && timesheet.status === "approved")) return false;
                  if (pendingTimesheetIds.has(timesheet.id)) return true;
                  if (isMonthlyGroup) {
                    // Include any timesheet whose week overlaps with the group's month
                    const [year, month] = group.monthKey.split("-").map(Number);
                    const monthStart = new Date(year!, month! - 1, 1);
                    const monthEnd = new Date(year!, month!, 0);
                    const weekStart = new Date(timesheet.weekStart);
                    const weekEnd = addDays(weekStart, 6);
                    return weekStart <= monthEnd && weekEnd >= monthStart;
                  }
                  return false;
                })
                .sort(
                  (left, right) =>
                    new Date(left.weekStart).getTime() - new Date(right.weekStart).getTime(),
                )
            : [],
          records: [...group.records].sort((left, right) => {
          const leftDate = new Date(left.weekStart ?? left.date).getTime();
          const rightDate = new Date(right.weekStart ?? right.date).getTime();
          return leftDate - rightDate;
          }),
          totalAmount:
            typeof group.hourlyRate === "number" && group.hourlyRate > 0
              ? Math.round(group.totalHours * group.hourlyRate)
              : group.totalAmount,
        };
      })
      .sort((left, right) => right.totalAmount - left.totalAmount);
  }, [employees, pendingPayroll, timesheetEntries]);

  useEffect(() => {
    if (pendingPayrollGroups.length === 0 || activeAccounts.length === 0) {
      return;
    }

    setPayoutAccountSelections((current) => {
      const next = { ...current };
      const preferredAccount =
        activeAccounts.find((account) => account.accountType === "operational" && !isLegacyDefaultAccount(account))
        ?? activeAccounts.find((account) => !isLegacyDefaultAccount(account))
        ?? activeAccounts[0];

      for (const group of pendingPayrollGroups) {
        if (next[group.key]) {
          continue;
        }

        const existingAccountId = group.records.find((record) => record.accountId)?.accountId;
        next[group.key] = existingAccountId ?? preferredAccount?.id ?? "";
      }

      return next;
    });
  }, [activeAccounts, pendingPayrollGroups]);

  const pendingAmount = pendingPayroll.reduce((sum, record) => sum + getPayrollAmount(record), 0);
  const paidThisMonth = paidHistory
    .filter((record) => record.date.slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, record) => sum + record.amount, 0);

  const previewSalarySlipMutation = useMutation({
    mutationFn: ({ group, accountId }: { group: PendingPayrollGroup; accountId: string }) =>
      api.previewSalarySlip({ salaryIds: group.records.map((record) => record.id), accountId }),
    onSuccess: (draft) => {
      setSalarySlipDraft(draft);
      setSalarySlipExpectedNet(draft.netSalary);
      setSalarySlipIdempotencyKey(createIdempotencyKey("salary-slip"));
      setSalarySlipOpen(true);
    },
    onError: (error) => {
      toast({
        title: "Could not prepare salary slip",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const payMutation = useMutation({
    mutationFn: (draft: SalarySlipDraft) => api.confirmSalarySlip(draft, salarySlipIdempotencyKey || undefined),
    onSuccess: ({ slip, salaries: records }) => {
      for (const record of records) {
        queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, record));
      }
      queryClient.setQueryData<GeneratedSalarySlip[]>(["salary-slips"], (current = []) => {
        const existing = current.filter((item) => item.id !== slip.id);
        return [slip, ...existing];
      });
      setSalarySlipOpen(false);
      setSalarySlipDraft(null);
      setSalarySlipIdempotencyKey("");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["chartData"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["salary-slips"] }),
      ]);

      toast({
        title: "Salary paid",
        description: "The salary slip was stored and queued for email delivery.",
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
      activeAccounts.find((account) => account.accountType === "operational" && !isLegacyDefaultAccount(account))
      ?? activeAccounts.find((account) => !isLegacyDefaultAccount(account))
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

  const addExtraDayMutation = useMutation({
    mutationFn: async ({ group, date }: { group: PendingPayrollGroup; date: string }) => {
      const employee = employees.find((e) => e.id === group.employeeId);
      const monthlySalary = employee ? Math.max(0, Math.round(Number(employee.salary ?? 0) / 12)) : 0;
      const [year, month] = group.monthKey.split("-").map(Number);
      const daysInMonth = new Date(year!, month!, 0).getDate();
      if (!date) {
        throw new Error("Select a date for the extra day.");
      }
      if (!date.startsWith(group.monthKey)) {
        throw new Error(`Date must be within ${group.monthKey}.`);
      }

      const monthlyRecord = group.records.find((record) => record.source === "timesheet" && record.rate == null);
      const targetRecord =
        monthlyRecord ??
        [...group.records]
          .filter((record) => record.source === "timesheet" && typeof record.rate === "number" && record.rate > 0)
          .sort((left, right) => new Date(left.weekStart ?? left.date).getTime() - new Date(right.weekStart ?? right.date).getTime())
          .at(-1);
      if (!targetRecord) {
        throw new Error("Cannot find the salary record to update.");
      }
      if (!targetRecord.employeeId) {
        throw new Error("Cannot add an extra day without an employee-linked salary record.");
      }

      const existingDays = Number(targetRecord.days ?? 0);
      const existingHours = Number(targetRecord.hours ?? 0);
      const existingRate = Number(targetRecord.rate ?? 0);
      const newDays = existingDays + 1;
      const newHours = monthlyRecord ? existingHours : existingHours + 8;
      const newAmount = monthlyRecord
        ? monthlySalary > 0
          ? Math.round((monthlySalary / daysInMonth) * newDays)
          : getPayrollAmount(targetRecord)
        : existingRate > 0
          ? Math.round(newHours * existingRate)
          : getPayrollAmount(targetRecord);

      if (newAmount <= 0) {
        throw new Error("Cannot calculate daily rate for this employee.");
      }

      return api.patchSalary(targetRecord.id, {
        employeeId: targetRecord.employeeId,
        employeeNameSnapshot: targetRecord.employeeNameSnapshot,
        source: targetRecord.source,
        status: targetRecord.status,
        date: targetRecord.date,
        weekStart: targetRecord.weekStart,
        timesheetId: targetRecord.timesheetId,
        rate: targetRecord.rate,
        hours: newHours,
        days: newDays,
        amount: newAmount,
        note: `${targetRecord.note || `Timesheet payout for ${group.monthKey}`} (+1 day on ${date})`,
      });
    },
    onSuccess: (updatedRecord) => {
      queryClient.setQueryData<SalaryRecord[]>(["salaries"], (current) => upsertSalaryRecord(current, updatedRecord as SalaryRecord));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["salaries"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      toast({ title: "Extra day added", description: "The salary record was updated with one additional day." });
      setAddDayGroupKey(null);
      setAddDayDate("");
    },
    onError: (error) => {
      toast({
        title: "Could not add extra day",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const recallMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Use allSettled so a single failure doesn't abandon the rest.
      const results = await Promise.allSettled(ids.map((id) => api.recallTimesheet(id)));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected");
      if (succeeded === 0) {
        // All failed — surface the first error message so onError can show it.
        const firstMessage = failed[0]?.reason instanceof Error ? failed[0].reason.message : "Please try again.";
        throw new Error(firstMessage);
      }
      return { succeeded, failedCount: failed.length };
    },
    onSuccess: ({ succeeded, failedCount }) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["salaries"] }),
        queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      setRecallGroupKey(null);
      setRecallSelectedIds(new Set());
      if (failedCount > 0) {
        toast({
          title: `${succeeded} recalled, ${failedCount} failed`,
          description: "Some weeks could not be recalled — check the Timesheets tab for their current status.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Timesheets recalled",
          description: `${succeeded} week${succeeded !== 1 ? "s" : ""} moved back to submitted — ready for review in the Timesheets tab.`,
        });
      }
    },
    onError: (error) => {
      // All recalls failed — still refresh so the UI matches server state.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["salaries"] }),
        queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
      ]);
      setRecallGroupKey(null);
      setRecallSelectedIds(new Set());
      toast({
        title: "Recall failed",
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
                        const isTimesheetGroup = group.records.some((record) => record.source === "timesheet");
                        const isMonthlyPayroll = isTimesheetGroup && group.records.some((r) => r.source === "timesheet" && r.rate == null);
                        const displayedEntryCount = isTimesheetGroup
                          ? group.approvedTimesheets.length
                          : group.records.length;
                        const worklogEntries: PayrollWorklogEntry[] =
                          group.approvedTimesheets.length > 0
                            ? group.approvedTimesheets.map((timesheet) => ({
                                key: timesheet.id,
                                source: "timesheet",
                                weekStart: timesheet.weekStart,
                                date: timesheet.weekStart,
                                hours: timesheetTotalHours(timesheet),
                                timesheet,
                              }))
                            : group.records.map((record) => ({
                                key: record.id,
                                source: record.source ?? "manual",
                                weekStart: record.weekStart,
                                date: record.date,
                                hours: record.hours,
                                timesheet: baseTimesheetId(record.timesheetId)
                                  ? timesheetById.get(baseTimesheetId(record.timesheetId)!)
                                  : undefined,
                              }));

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
                              {displayedEntryCount}{" "}
                              {isTimesheetGroup
                                ? displayedEntryCount === 1
                                  ? "approved week"
                                  : "approved weeks"
                                : displayedEntryCount === 1
                                  ? "entry"
                                  : "entries"}
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
                                        <div className="mt-2 text-2xl font-semibold">{displayedEntryCount}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {isTimesheetGroup ? "Approved weeks" : "Payroll records"}
                                        </div>
                                      </CardContent>
                                    </Card>
                                    <Card className="border-border/60">
                                      <CardContent className="pt-5">
                                        {isMonthlyPayroll && group.totalDays > 0 ? (
                                          <>
                                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Days Worked</div>
                                            <div className="mt-2 text-2xl font-semibold">{group.totalDays}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                              {group.totalHours > 0 ? `${group.totalHours}h logged` : "This calendar month"}
                                            </div>
                                          </>
                                        ) : (
                                          <>
                                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Hours</div>
                                            <div className="mt-2 text-2xl font-semibold">{group.totalHours}</div>
                                          </>
                                        )}
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
                                        <CardTitle className="text-sm">Final Payout</CardTitle>
                                      </CardHeader>
                                      <CardContent className="space-y-4">
                                        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                                          <div className="flex items-start justify-between gap-4">
                                            <div>
                                              <div className="font-medium">Combined payroll payout</div>
                                              <div className="mt-1 text-xs text-muted-foreground">
                                                {isTimesheetGroup
                                                  ? `${displayedEntryCount} approved ${
                                                      displayedEntryCount === 1 ? "week" : "weeks"
                                                    } combined into one payment.`
                                                  : `${displayedEntryCount} payroll ${
                                                      displayedEntryCount === 1 ? "entry" : "entries"
                                                    } combined into one payment.`}
                                              </div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-semibold tabular-nums">{formatCurrency(group.totalAmount)}</div>
                                              {isMonthlyPayroll && group.totalDays > 0 ? (
                                                <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                                                  {group.totalDays} days worked
                                                </div>
                                              ) : null}
                                              <Badge variant="outline" className="mt-2 text-[11px] font-normal">
                                                Monthly total
                                              </Badge>
                                            </div>
                                          </div>

                                          <div className="mt-4 space-y-3">
                                            <Select
                                              value={payoutAccountSelections[group.key] ?? ""}
                                              onValueChange={(value) =>
                                                setPayoutAccountSelections((current) => ({ ...current, [group.key]: value }))
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

                                            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                              <span>
                                                {payoutAccountSelections[group.key]
                                                  ? `Available ${formatCurrency(accountBalances.get(payoutAccountSelections[group.key]) ?? 0)}`
                                                  : "Select payout account"}
                                              </span>
                                              <span className="max-w-[220px] truncate">
                                                {worklogEntries
                                                  .map((entry) => weekRangeLabel(entry.weekStart ?? entry.date))
                                                  .join(" • ")}
                                              </span>
                                            </div>

                                            <Button
                                              size="sm"
                                              className="w-full rounded-xl"
                                              onClick={() =>
                                                previewSalarySlipMutation.mutate({
                                                  group,
                                                  accountId: payoutAccountSelections[group.key] ?? "",
                                                })
                                              }
                                              disabled={
                                                previewSalarySlipMutation.isPending ||
                                                payMutation.isPending ||
                                                !payoutAccountSelections[group.key] ||
                                                group.totalAmount > (accountBalances.get(payoutAccountSelections[group.key] ?? "") ?? 0)
                                              }
                                              title={
                                                !payoutAccountSelections[group.key]
                                                  ? "Select the financial account used for this payout."
                                                  : group.totalAmount > (accountBalances.get(payoutAccountSelections[group.key] ?? "") ?? 0)
                                                    ? "Not enough available funds in the selected account."
                                                    : undefined
                                              }
                                            >
                                              {!payoutAccountSelections[group.key]
                                                ? "Select Account"
                                                : group.totalAmount > (accountBalances.get(payoutAccountSelections[group.key] ?? "") ?? 0)
                                                  ? "Insufficient Funds"
                                                  : previewSalarySlipMutation.isPending
                                                    ? "Preparing Salary Slip..."
                                                    : "Pay Final Salary"}
                                            </Button>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>

                                    <Card className="border-border/60">
                                      <CardHeader className="pb-3">
                                        <CardTitle className="text-sm">Month Work Hours & Work Notes</CardTitle>
                                      </CardHeader>
                                      <CardContent className="space-y-4">
                                        {worklogEntries.map((entry) => {
                                          const timesheet = entry.timesheet;
                                          const worklogDays = timesheet
                                            ? buildWorklogDays(timesheet).filter((day) => day.dateKey.slice(0, 7) === group.monthKey)
                                            : [];
                                          const groupedByMonth = worklogDays.reduce<Record<string, WorklogDay[]>>((accumulator, day) => {
                                            accumulator[day.monthLabel] = [...(accumulator[day.monthLabel] ?? []), day];
                                            return accumulator;
                                          }, {});

                                          return (
                                            <div key={`${entry.key}-worklog`} className="rounded-2xl border border-border/60 bg-background/50 p-4">
                                              <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                  <div className="font-medium">
                                                    {entry.weekStart ? weekRangeLabel(entry.weekStart) : format(new Date(entry.date), "dd MMM yyyy")}
                                                  </div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {entry.source === "timesheet" ? "Approved timesheet worklog" : "Manual payroll entry"}
                                                  </div>
                                                </div>
                                                <div className="text-sm font-medium tabular-nums">{typeof entry.hours === "number" ? `${entry.hours}h` : "-"}</div>
                                              </div>

                                              {Object.keys(groupedByMonth).length > 0 ? (
                                                Object.entries(groupedByMonth).map(([monthLabel, monthRows]) => (
                                                  <div key={`${entry.key}-${monthLabel}`} className="mb-4 last:mb-0">
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

                                        {isTimesheetGroup && group.approvedTimesheets.length > 0 ? (
                                          <Dialog
                                            open={recallGroupKey === group.key}
                                            onOpenChange={(open) => {
                                              if (open) {
                                                setRecallGroupKey(group.key);
                                                setRecallSelectedIds(new Set(group.approvedTimesheets.map((t) => t.id)));
                                              } else {
                                                setRecallGroupKey(null);
                                                setRecallSelectedIds(new Set());
                                              }
                                            }}
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full rounded-xl border-border/60 text-muted-foreground hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-700 dark:hover:border-orange-800 dark:hover:bg-orange-950/20 dark:hover:text-orange-400"
                                              >
                                                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                                Recall for Correction
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-md">
                                              <DialogHeader>
                                                <DialogTitle className="flex items-center gap-2">
                                                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                                                  Recall for Correction
                                                </DialogTitle>
                                              </DialogHeader>
                                              <div className="space-y-4">
                                                <p className="text-sm text-muted-foreground">
                                                  Select weeks to recall. Recalled timesheets move back to <strong>Submitted</strong> status so you can revert them to the employee for editing, then re-approve once corrected.
                                                </p>
                                                <div className="space-y-2">
                                                  {group.approvedTimesheets.map((timesheet) => (
                                                    <label
                                                      key={timesheet.id}
                                                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 hover:bg-muted/40"
                                                    >
                                                      <Checkbox
                                                        checked={recallSelectedIds.has(timesheet.id)}
                                                        onCheckedChange={(checked) => {
                                                          setRecallSelectedIds((prev) => {
                                                            const next = new Set(prev);
                                                            if (checked) next.add(timesheet.id);
                                                            else next.delete(timesheet.id);
                                                            return next;
                                                          });
                                                        }}
                                                      />
                                                      <div className="flex-1 text-sm">
                                                        <span className="font-medium">
                                                          Week of {format(new Date(timesheet.weekStart), "dd MMM yyyy")}
                                                        </span>
                                                      </div>
                                                    </label>
                                                  ))}
                                                </div>
                                                <div className="flex gap-2 justify-end pt-1">
                                                  <DialogClose asChild>
                                                    <Button variant="outline" size="sm" className="rounded-xl" disabled={recallMutation.isPending}>
                                                      Cancel
                                                    </Button>
                                                  </DialogClose>
                                                  <Button
                                                    size="sm"
                                                    className="rounded-xl bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600"
                                                    disabled={recallSelectedIds.size === 0 || recallMutation.isPending}
                                                    onClick={() => recallMutation.mutate(Array.from(recallSelectedIds))}
                                                  >
                                                    {recallMutation.isPending
                                                      ? "Recalling…"
                                                      : `Recall ${recallSelectedIds.size} Week${recallSelectedIds.size !== 1 ? "s" : ""}`}
                                                  </Button>
                                                </div>
                                              </div>
                                            </DialogContent>
                                          </Dialog>
                                        ) : null}

                                        {isMonthlyPayroll ? (
                                          <div className="rounded-2xl border border-dashed border-border/60 bg-background/40 p-4">
                                            {addDayGroupKey === group.key ? (
                                              <div className="space-y-3">
                                                <div className="text-sm font-medium">Add Extra Day</div>
                                                <div className="flex gap-2">
                                                  <input
                                                    type="date"
                                                    className="h-9 flex-1 rounded-xl border border-border/60 bg-background px-3 text-sm"
                                                    value={addDayDate}
                                                    min={`${group.monthKey}-01`}
                                                    max={`${group.monthKey}-${new Date(Number(group.monthKey.split("-")[0]), Number(group.monthKey.split("-")[1]), 0).getDate().toString().padStart(2, "0")}`}
                                                    onChange={(e) => setAddDayDate(e.target.value)}
                                                  />
                                                  <Button
                                                    size="sm"
                                                    className="rounded-xl"
                                                    disabled={!addDayDate || addExtraDayMutation.isPending}
                                                    onClick={() => addExtraDayMutation.mutate({ group, date: addDayDate })}
                                                  >
                                                    Add
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="rounded-xl"
                                                    onClick={() => { setAddDayGroupKey(null); setAddDayDate(""); }}
                                                  >
                                                    Cancel
                                                  </Button>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                  Adds one day at the daily rate for {group.monthKey}.
                                                </div>
                                              </div>
                                            ) : (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full rounded-xl"
                                                onClick={() => {
                                                  setAddDayGroupKey(group.key);
                                                  setAddDayDate(`${group.monthKey}-01`);
                                                }}
                                              >
                                                + Add Extra Day
                                              </Button>
                                            )}
                                          </div>
                                        ) : null}
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

          {paidHistory.length > 0 ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                onClick={() => setShowPaidHistory((current) => !current)}
              >
                {showPaidHistory ? "Hide Paid History" : `Previous Paid Payroll (${paidHistory.length})`}
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
                    {paidHistory.length === 0 ? (
                      <TableRow className="border-border/50">
                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                          No paid payroll records yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paidHistory.map((record) => (
                        <TableRow key={record.id} className="border-border/50">
                          <TableCell className="font-medium">{record.employeeName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(record.date), "MMM dd, yyyy")}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{record.note}</TableCell>
                          <TableCell className="text-right font-medium text-foreground tabular-nums">
                            {formatCurrency(record.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          ) : null}
        </div>
      </div>
      <SalarySlipDialog
        open={salarySlipOpen}
        draft={salarySlipDraft}
        expectedNet={salarySlipExpectedNet}
        isConfirming={payMutation.isPending}
        onOpenChange={(open) => {
          if (!payMutation.isPending) {
            setSalarySlipOpen(open);
            if (!open) {
              setSalarySlipIdempotencyKey("");
            }
          }
        }}
        onChange={setSalarySlipDraft}
        onConfirm={() => {
          if (salarySlipDraft) {
            payMutation.mutate(salarySlipDraft);
          }
        }}
      />
    </DashboardLayout>
  );
}
