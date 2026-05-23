import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, Clock3, Plus, Settings2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type LeavePolicy, type LeaveRequest } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function leaveDays(request: LeaveRequest) {
  const start = new Date(request.startDate);
  const end = new Date(request.endDate);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function formatDate(value: string) {
  return format(new Date(value), "dd MMM yyyy");
}

function statusClass(status: LeaveRequest["status"]) {
  if (status === "approved") return "border-emerald-500/20 bg-emerald-500/8 text-emerald-300";
  if (status === "rejected") return "border-rose-500/20 bg-rose-500/8 text-rose-300";
  return "border-sky-500/20 bg-sky-500/8 text-sky-300";
}

function calendarCardClass(day: {
  worked: boolean;
  leave: boolean;
  pendingLeave?: boolean;
  holiday: boolean;
  isWeekend: boolean;
}) {
  if (day.holiday) return "border-emerald-500/15 bg-emerald-500/5";
  if (day.leave) return "border-amber-500/20 bg-amber-500/8";
  if (day.pendingLeave) return "border-sky-500/20 bg-sky-500/8";
  if (day.worked) return "border-border/60 bg-secondary/10";
  return day.isWeekend ? "border-border/40 bg-background/60" : "border-border/60 bg-background/80";
}

function normalizeLeavePolicy(policy?: LeavePolicy | null): LeavePolicy {
  return {
    annualLimit: Math.max(0, Math.round(Number(policy?.annualLimit ?? 10))),
    period: policy?.period === "monthly" || policy?.period === "quarterly" || policy?.period === "yearly" ? policy.period : "yearly",
    appliesTo: policy?.appliesTo === "selected" ? "selected" : "all",
    employeeIds:
      policy?.appliesTo === "selected"
        ? Array.from(new Set((policy.employeeIds ?? []).map((employeeId) => employeeId.trim()).filter(Boolean)))
        : [],
    updatedAt: policy?.updatedAt ?? new Date().toISOString(),
    updatedBy: policy?.updatedBy,
  };
}

function leavePolicyAppliesToEmployee(policy: LeavePolicy, employeeId?: string) {
  if (policy.appliesTo !== "selected") {
    return true;
  }

  return Boolean(employeeId && policy.employeeIds?.includes(employeeId));
}

function effectiveLeavePolicy(policy: LeavePolicy | null | undefined, employeeId?: string) {
  const normalized = normalizeLeavePolicy(policy);
  return leavePolicyAppliesToEmployee(normalized, employeeId) ? normalized : normalizeLeavePolicy();
}

function leavePolicyPeriodLabel(period?: LeavePolicy["period"]) {
  if (period === "monthly") return "month";
  if (period === "quarterly") return "quarter";
  return "year";
}

function leavePolicyPeriodTitle(period?: LeavePolicy["period"]) {
  if (period === "monthly") return "Monthly";
  if (period === "quarterly") return "Quarterly";
  return "Yearly";
}

function leavePolicyWindowForDate(date: string, period?: LeavePolicy["period"]) {
  const target = new Date(`${date.slice(0, 10)}T12:00:00.000Z`);
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();

  if (period === "monthly") {
    const startDate = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0)).toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)).toISOString().slice(0, 10);
    return {
      startDate,
      endDate,
      label: format(new Date(`${startDate}T12:00:00.000Z`), "MMMM yyyy"),
    };
  }

  if (period === "quarterly") {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const startDate = new Date(Date.UTC(year, quarterStartMonth, 1, 12, 0, 0, 0)).toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(year, quarterStartMonth + 3, 0, 12, 0, 0, 0)).toISOString().slice(0, 10);
    return {
      startDate,
      endDate,
      label: `${format(new Date(`${startDate}T12:00:00.000Z`), "MMM")} - ${format(new Date(`${endDate}T12:00:00.000Z`), "MMM yyyy")}`,
    };
  }

  const startDate = new Date(Date.UTC(year, 0, 1, 12, 0, 0, 0)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, 12, 0, 12, 0, 0, 0)).toISOString().slice(0, 10);
  return {
    startDate,
    endDate,
    label: `${year}`,
  };
}

function countLeaveDaysInWindow(requests: LeaveRequest[], startDate: string, endDate: string, status: "approved" | "pending") {
  return requests
    .filter((request) => request.kind !== "holiday" && request.status === status)
    .reduce((sum, request) => {
      const days = [];
      const cursor = new Date(`${request.startDate.slice(0, 10)}T12:00:00.000Z`);
      const requestEnd = new Date(`${request.endDate.slice(0, 10)}T12:00:00.000Z`);
      while (cursor.getTime() <= requestEnd.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        if (iso >= startDate && iso <= endDate) {
          days.push(iso);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return sum + days.length;
    }, 0);
}

export default function AdminLeaveManagementPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [holidayDate, setHolidayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [holidayName, setHolidayName] = useState("");
  const [annualLimitInput, setAnnualLimitInput] = useState("10");
  const [leavePeriod, setLeavePeriod] = useState<NonNullable<LeavePolicy["period"]>>("yearly");
  const [leaveAppliesTo, setLeaveAppliesTo] = useState<NonNullable<LeavePolicy["appliesTo"]>>("all");
  const [selectedPolicyEmployeeIds, setSelectedPolicyEmployeeIds] = useState<string[]>([]);
  const [showPreviousLeaveHistory, setShowPreviousLeaveHistory] = useState(false);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["leave-requests"],
    queryFn: () => api.getLeaveRequests({ status: "all" }),
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays", selectedMonth],
    queryFn: () => api.getHolidays({ month: selectedMonth }),
  });
  const { data: leavePolicy } = useQuery({
    queryKey: ["leave-policy"],
    queryFn: api.getLeavePolicy,
  });

  const normalizedLeavePolicy = useMemo(() => normalizeLeavePolicy(leavePolicy), [leavePolicy]);

  useEffect(() => {
    setAnnualLimitInput(String(normalizedLeavePolicy.annualLimit));
    setLeavePeriod(normalizedLeavePolicy.period ?? "yearly");
    setLeaveAppliesTo(normalizedLeavePolicy.appliesTo ?? "all");
    setSelectedPolicyEmployeeIds(normalizedLeavePolicy.employeeIds ?? []);
  }, [normalizedLeavePolicy]);

  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const { data: monthCalendar } = useQuery({
    queryKey: ["employee-month-calendar", selectedEmployeeId, selectedMonth],
    queryFn: () => api.getEmployeeMonthCalendar({ employeeId: selectedEmployeeId, month: selectedMonth }),
    enabled: Boolean(selectedEmployeeId),
  });

  const pendingRequests = leaveRequests.filter((request) => request.status === "pending");
  const approvedRequests = leaveRequests.filter((request) => request.status === "approved");
  const reviewedRequests = leaveRequests.filter((request) => request.status !== "pending");
  const activeRequests = pendingRequests;
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;

  const selectedEmployeeLeaveBalance = useMemo(() => {
    if (!selectedEmployee) {
      return null;
    }

    const policy = effectiveLeavePolicy(normalizedLeavePolicy, selectedEmployee.id);
    const window = leavePolicyWindowForDate(`${selectedMonth}-01`, policy.period);
    const employeeRequests = leaveRequests.filter((request) => request.employeeId === selectedEmployee.id);
    const approvedDays = countLeaveDaysInWindow(employeeRequests, window.startDate, window.endDate, "approved");
    const pendingDays = countLeaveDaysInWindow(employeeRequests, window.startDate, window.endDate, "pending");

    return {
      annualLimit: policy.annualLimit,
      approvedDaysYear: approvedDays,
      pendingDaysYear: pendingDays,
      remainingDaysYear: Math.max(0, policy.annualLimit - approvedDays - pendingDays),
      period: policy.period,
      windowLabel: window.label,
      usesCustomPolicy: leavePolicyAppliesToEmployee(normalizedLeavePolicy, selectedEmployee.id),
    };
  }, [leaveRequests, normalizedLeavePolicy, selectedEmployee, selectedMonth]);

  const stats = useMemo(
    () => ({
      pendingCount: pendingRequests.length,
      approvedDays: approvedRequests.reduce((sum, request) => sum + leaveDays(request), 0),
      holidayCount: holidays.length,
      annualLimit: normalizedLeavePolicy.annualLimit,
    }),
    [approvedRequests, holidays.length, normalizedLeavePolicy.annualLimit, pendingRequests.length],
  );

  const targetedEmployees = useMemo(
    () => employees.filter((employee) => (normalizedLeavePolicy.employeeIds ?? []).includes(employee.id)),
    [employees, normalizedLeavePolicy.employeeIds],
  );

  const leaveMutation = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "rejected"; reviewNote?: string }) =>
      api.updateLeaveRequestStatus(input.id, { status: input.status, reviewNote: input.reviewNote?.trim() || undefined }),
    onSuccess: (updated) => {
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
      toast({
        title: updated.status === "approved" ? "Leave approved" : "Leave rejected",
        description:
          updated.status === "approved"
            ? "The approved leave now reflects across the employee and admin views."
            : "The employee can see the rejection note now.",
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-month-calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Could not update leave request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const addHolidayMutation = useMutation({
    mutationFn: () => api.addHoliday({ date: holidayDate, name: holidayName.trim() }),
    onSuccess: () => {
      setHolidayName("");
      toast({ title: "Holiday created", description: "It now appears in leave management and the timesheet calendar." });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["holidays"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-month-calendar"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Could not create holiday",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => api.deleteHoliday(id),
    onSuccess: () => {
      toast({ title: "Holiday removed" });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["holidays"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-month-calendar"] }),
      ]);
    },
  });

  const updateLimitMutation = useMutation({
    mutationFn: () =>
      api.updateLeavePolicy({
        annualLimit: Number(annualLimitInput || 0),
        period: leavePeriod,
        appliesTo: leaveAppliesTo,
        employeeIds: leaveAppliesTo === "selected" ? selectedPolicyEmployeeIds : [],
      }),
    onSuccess: () => {
      toast({ title: "Leave allowance updated", description: "The saved rule is now active for leave requests." });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-policy"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-month-calendar"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Could not update leave allowance",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const toggleTargetEmployee = (employeeId: string) => {
    setSelectedPolicyEmployeeIds((current) =>
      current.includes(employeeId) ? current.filter((value) => value !== employeeId) : [...current, employeeId],
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Leave Management</h1>
            <p className="text-sm text-muted-foreground">
              Approve employee leave, set a clear leave rule, and plan holidays from one focused workspace.
            </p>
          </div>
          <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="w-[220px] rounded-xl" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Pending Requests</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stats.pendingCount}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Approved Leave Days</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stats.approvedDays}d</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Holidays</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stats.holidayCount}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Settings2 className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Configured Limit</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stats.annualLimit}d</p>
              <p className="mt-1 text-xs text-muted-foreground">Per {leavePolicyPeriodLabel(normalizedLeavePolicy.period)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Leave Approval Desk</CardTitle>
              <CardDescription>Approve or reject leave requests with a short note for the employee. Pending requests from every month appear here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {leaveRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  No leave requests found for this month.
                </div>
              ) : activeRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  No active leave requests right now.
                </div>
              ) : (
                activeRequests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{request.employeeNameSnapshot}</p>
                          <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none", statusClass(request.status))}>
                            {request.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(request.startDate)} - {formatDate(request.endDate)} · {leaveDays(request)} day{leaveDays(request) > 1 ? "s" : ""}
                        </p>
                        {request.reason ? <p className="text-sm text-muted-foreground">{request.reason}</p> : null}
                      </div>
                    </div>

                    {request.reviewNote ? (
                      <div className="mt-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                        {request.reviewNote}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        value={reviewNotes[request.id] ?? ""}
                        onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Optional note for the employee"
                        className="min-w-[220px] flex-1 rounded-xl"
                      />
                      <Button
                        variant="outline"
                        className="rounded-xl border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/10"
                        disabled={leaveMutation.isPending || request.status === "approved"}
                        onClick={() => void leaveMutation.mutateAsync({ id: request.id, status: "approved", reviewNote: reviewNotes[request.id] })}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl border-rose-500/20 text-rose-300 hover:bg-rose-500/10"
                        disabled={leaveMutation.isPending || request.status === "rejected"}
                        onClick={() => void leaveMutation.mutateAsync({ id: request.id, status: "rejected", reviewNote: reviewNotes[request.id] })}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {reviewedRequests.length > 0 ? (
                <div className="pt-2">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                      onClick={() => setShowPreviousLeaveHistory((current) => !current)}
                    >
                      {showPreviousLeaveHistory ? "Hide Leave History" : `Previous Leaves (${reviewedRequests.length})`}
                    </Button>
                  </div>

                  {showPreviousLeaveHistory ? (
                    <Card className="mt-3 border-border/60 bg-background/70 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium">Previous Leave Decisions</CardTitle>
                        <CardDescription>Reviewed leave requests that are already closed out and no longer need action.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {reviewedRequests.map((request) => (
                          <div
                            key={request.id}
                            className="flex flex-col gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-4 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">{request.employeeNameSnapshot}</p>
                                <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none", statusClass(request.status))}>
                                  {request.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {formatDate(request.startDate)} - {formatDate(request.endDate)} · {leaveDays(request)} day{leaveDays(request) > 1 ? "s" : ""}
                              </p>
                              {request.reason ? <p className="text-sm text-muted-foreground">{request.reason}</p> : null}
                              {request.reviewNote ? (
                                <p className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                                  {request.reviewNote}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium">Leave Allowance</CardTitle>
                <CardDescription>Set the leave days, the reset cycle, and exactly who this rule should apply to.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="leave-limit">Leave days</Label>
                    <Input
                      id="leave-limit"
                      type="number"
                      min={0}
                      max={365}
                      value={annualLimitInput}
                      onChange={(event) => setAnnualLimitInput(event.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="leave-period">Reset cycle</Label>
                    <Select value={leavePeriod} onValueChange={(value) => setLeavePeriod(value as NonNullable<LeavePolicy["period"]>)}>
                      <SelectTrigger id="leave-period" className="rounded-xl">
                        <SelectValue placeholder="Select cycle" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Per month</SelectItem>
                        <SelectItem value="quarterly">Per 3 months</SelectItem>
                        <SelectItem value="yearly">Per year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="leave-audience">Apply rule to</Label>
                  <Select value={leaveAppliesTo} onValueChange={(value) => setLeaveAppliesTo(value as NonNullable<LeavePolicy["appliesTo"]>)}>
                    <SelectTrigger id="leave-audience" className="rounded-xl">
                      <SelectValue placeholder="Choose who gets this rule" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      <SelectItem value="selected">Only selected employees</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {leaveAppliesTo === "selected" ? (
                  <div className="space-y-3 rounded-2xl border border-border/60 bg-background/60 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Choose employees</p>
                      <p className="text-sm text-muted-foreground">Pick one or more employees who should follow this leave rule.</p>
                    </div>
                    {employees.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                        Add employees first to target a custom leave rule.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {employees.map((employee) => {
                          const checked = selectedPolicyEmployeeIds.includes(employee.id);
                          return (
                            <label
                              key={employee.id}
                              className={cn(
                                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                                checked ? "border-primary/30 bg-primary/5" : "border-border/60 bg-secondary/10",
                              )}
                            >
                              <Checkbox checked={checked} onCheckedChange={() => toggleTargetEmployee(employee.id)} className="mt-0.5" />
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">{employee.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{employee.email}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Saved policy</p>
                      <p className="text-sm text-muted-foreground">
                        {normalizedLeavePolicy.annualLimit} day(s) per {leavePolicyPeriodLabel(normalizedLeavePolicy.period)}
                      </p>
                    </div>
                    <Badge className="w-fit rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-none">
                      {normalizedLeavePolicy.appliesTo === "all" ? "All employees" : `${targetedEmployees.length} selected employee${targetedEmployees.length === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                  {normalizedLeavePolicy.appliesTo === "selected" && targetedEmployees.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {targetedEmployees.map((employee) => (
                        <Badge key={employee.id} className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-foreground shadow-none">
                          {employee.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {normalizedLeavePolicy.updatedAt === "1970-01-01T00:00:00.000Z"
                      ? "Save a rule once and it will appear here with who updated it."
                      : `Last saved by ${normalizedLeavePolicy.updatedBy ?? "Admin"} on ${formatDate(normalizedLeavePolicy.updatedAt)}`}
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button className="rounded-xl" disabled={updateLimitMutation.isPending} onClick={() => void updateLimitMutation.mutateAsync()}>
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium">Holiday Planner</CardTitle>
                <CardDescription>Create company holidays that appear automatically in leave management and timesheets.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                  <Input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} className="rounded-xl" />
                  <Input value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Holiday name" className="rounded-xl" />
                  <Button className="rounded-xl" disabled={addHolidayMutation.isPending || !holidayName.trim()} onClick={() => void addHolidayMutation.mutateAsync()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    <span>Saved Holidays</span>
                    <span>{holidays.length}</span>
                  </div>
                  {holidays.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                      No holidays added for this month.
                    </div>
                  ) : (
                    <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                      {holidays.map((holiday) => (
                        <div key={holiday.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{holiday.name}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(holiday.date)}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 rounded-xl px-3 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                            onClick={() => {
                              if (window.confirm(`Delete holiday "${holiday.name}"?`)) {
                                void deleteHolidayMutation.mutateAsync(holiday.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-medium">Employee Month Calendar</CardTitle>
                <CardDescription>Approved leave and holidays reflect here and also flow into the employee timesheet automatically.</CardDescription>
              </div>
              <div className="w-full max-w-[240px] space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Calendar Employee</p>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger className="rounded-xl">
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedEmployee || !monthCalendar ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                Select an employee to see the month view.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-none">
                    {selectedEmployeeLeaveBalance?.usesCustomPolicy ? `${leavePolicyPeriodTitle(selectedEmployeeLeaveBalance?.period)} rule` : "Default yearly rule"}
                  </Badge>
                  <Badge className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-none">
                    Cycle: {selectedEmployeeLeaveBalance?.windowLabel ?? selectedMonth}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Policy Limit</p>
                    <p className="mt-2 text-2xl font-semibold">{selectedEmployeeLeaveBalance?.annualLimit ?? 0}d</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Approved In Cycle</p>
                    <p className="mt-2 text-2xl font-semibold">{selectedEmployeeLeaveBalance?.approvedDaysYear ?? 0}d</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pending In Cycle</p>
                    <p className="mt-2 text-2xl font-semibold">{selectedEmployeeLeaveBalance?.pendingDaysYear ?? 0}d</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Leave Left</p>
                    <p className="mt-2 text-2xl font-semibold">{selectedEmployeeLeaveBalance?.remainingDaysYear ?? 0}d</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Hours Logged</p>
                    <p className="mt-2 text-2xl font-semibold">{monthCalendar.summary.hoursLogged.toFixed(1)}h</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Working Days</p>
                    <p className="mt-2 text-2xl font-semibold">{monthCalendar.summary.daysWorked}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Leave Days</p>
                    <p className="mt-2 text-2xl font-semibold">{monthCalendar.summary.leaveDays}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holiday Days</p>
                    <p className="mt-2 text-2xl font-semibold">{monthCalendar.summary.holidayDays}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pending Leave</p>
                    <p className="mt-2 text-2xl font-semibold">{monthCalendar.summary.pendingLeaveDays}</p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
                  {monthCalendar.days.map((day) => (
                    <div key={day.date} className={cn("rounded-xl border px-3 py-3", calendarCardClass(day))}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{format(new Date(day.date), "EEE")}</p>
                          <p className="mt-1 text-lg font-semibold">{format(new Date(day.date), "dd")}</p>
                        </div>
                        <p className="text-sm font-medium">{day.hours > 0 ? `${day.hours.toFixed(1)}h` : "0h"}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {day.worked ? <Badge className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary shadow-none">Worked</Badge> : null}
                        {day.holiday ? <Badge className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 shadow-none">{day.holidayName ?? "Holiday"}</Badge> : null}
                        {day.leave && !day.holiday ? <Badge className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 shadow-none">Leave</Badge> : null}
                        {day.pendingLeave ? <Badge className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300 shadow-none">Pending leave</Badge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
