import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, Clock3, Plus, Settings2, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type LeaveRequest } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export default function AdminLeaveManagementPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [holidayDate, setHolidayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [holidayName, setHolidayName] = useState("");
  const [annualLimitInput, setAnnualLimitInput] = useState("10");
  const [showPreviousApprovedLeaves, setShowPreviousApprovedLeaves] = useState(false);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["leave-requests", selectedMonth],
    queryFn: () => api.getLeaveRequests({ month: selectedMonth, status: "all" }),
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays", selectedMonth],
    queryFn: () => api.getHolidays({ month: selectedMonth }),
  });
  const { data: leavePolicy } = useQuery({
    queryKey: ["leave-policy"],
    queryFn: api.getLeavePolicy,
  });

  useEffect(() => {
    if (leavePolicy) {
      setAnnualLimitInput(String(leavePolicy.annualLimit));
    }
  }, [leavePolicy]);

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
  const activeRequests = leaveRequests.filter((request) => request.status !== "approved");
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;

  const stats = useMemo(
    () => ({
      pendingCount: pendingRequests.length,
      approvedDays: approvedRequests.reduce((sum, request) => sum + leaveDays(request), 0),
      holidayCount: holidays.length,
      annualLimit: leavePolicy?.annualLimit ?? 10,
    }),
    [approvedRequests, holidays.length, leavePolicy?.annualLimit, pendingRequests.length],
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
        description: updated.status === "approved" ? "The approved leave now reflects across the employee and admin views." : "The employee can see the rejection note now.",
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
    mutationFn: () => api.updateLeavePolicy({ annualLimit: Number(annualLimitInput || 0) }),
    onSuccess: () => {
      toast({ title: "Leave allowance updated" });
      void queryClient.invalidateQueries({ queryKey: ["leave-policy"] });
    },
    onError: (error) => {
      toast({
        title: "Could not update leave allowance",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Leave Management</h1>
            <p className="text-sm text-muted-foreground">
              Approve employee leave, set the annual allowance, and plan holidays from one focused workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="w-[220px] rounded-xl" />
            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className="w-[220px] rounded-xl">
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
                <p className="text-[11px] uppercase tracking-[0.16em]">Annual Leave Limit</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stats.annualLimit}d</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Leave Approval Desk</CardTitle>
              <CardDescription>Approve or reject leave requests with a short note for the employee.</CardDescription>
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

              {approvedRequests.length > 0 ? (
                <div className="pt-2">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                      onClick={() => setShowPreviousApprovedLeaves((current) => !current)}
                    >
                      {showPreviousApprovedLeaves
                        ? "Hide Approved Leaves"
                        : `Previous Approved Leaves (${approvedRequests.length})`}
                    </Button>
                  </div>

                  {showPreviousApprovedLeaves ? (
                    <Card className="mt-3 border-border/60 bg-background/70 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium">Previous Approved Leaves</CardTitle>
                        <CardDescription>
                          Approved leave requests that are already reflected in the employee calendar.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {approvedRequests.map((request) => (
                          <div
                            key={request.id}
                            className="flex flex-col gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-4 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">{request.employeeNameSnapshot}</p>
                                <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none", statusClass(request.status))}>
                                  Approved
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
                <CardDescription>Set the total number of leave days employees can request each year.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Input type="number" min={0} max={365} value={annualLimitInput} onChange={(event) => setAnnualLimitInput(event.target.value)} className="rounded-xl" />
                  <Button className="rounded-xl" disabled={updateLimitMutation.isPending} onClick={() => void updateLimitMutation.mutateAsync()}>
                    Save
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  This limit is checked when employees apply for leave. Approved holidays do not count against it.
                </p>
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

                <div className="space-y-2">
                  {holidays.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                      No holidays added for this month.
                    </div>
                  ) : (
                    holidays.map((holiday) => (
                      <div key={holiday.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                        <div>
                          <p className="font-medium text-foreground">{holiday.name}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(holiday.date)}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-xl px-3 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                          onClick={() => {
                            if (window.confirm(`Delete holiday "${holiday.name}"?`)) {
                              void deleteHolidayMutation.mutateAsync(holiday.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium">Employee Month Calendar</CardTitle>
            <CardDescription>
              Approved leave and holidays reflect here and also flow into the employee timesheet automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedEmployee || !monthCalendar ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                Select an employee to see the month view.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                        {day.leave ? <Badge className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 shadow-none">Leave</Badge> : null}
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
