import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { CalendarDays, CheckCircle2, ClipboardList, RefreshCcw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function weekLabel(weekStart: string) {
  const start = new Date(weekStart);
  return `${format(start, "dd MMM")} - ${format(addDays(start, 6), "dd MMM yyyy")}`;
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

export default function AdminTimesheetValidationPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTimesheetId, setSelectedTimesheetId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [reviewNote, setReviewNote] = useState("");

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });

  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const pendingTimesheets = useMemo(
    () => timesheets.filter((entry) => entry.status === "submitted").sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()),
    [timesheets],
  );

  useEffect(() => {
    const firstSubmitted = pendingTimesheets[0];
    if (!selectedTimesheetId && firstSubmitted) {
      setSelectedTimesheetId(firstSubmitted.id);
    } else if (selectedTimesheetId && !pendingTimesheets.some((entry) => entry.id === selectedTimesheetId)) {
      setSelectedTimesheetId(firstSubmitted?.id ?? "");
    }
  }, [pendingTimesheets, selectedTimesheetId]);

  const selectedTimesheet = pendingTimesheets.find((entry) => entry.id === selectedTimesheetId) ?? pendingTimesheets[0] ?? null;

  const { data: monthCalendar } = useQuery({
    queryKey: ["employee-month-calendar", selectedEmployeeId, selectedMonth],
    queryFn: () => api.getEmployeeMonthCalendar({ employeeId: selectedEmployeeId, month: selectedMonth }),
    enabled: Boolean(selectedEmployeeId),
  });

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!selectedTimesheet) {
        throw new Error("Select a submitted timesheet.");
      }
      return api.approveTimesheet(selectedTimesheet.id, selectedTimesheet.employeeNameSnapshot, reviewNote.trim() || undefined);
    },
    onSuccess: () => {
      setReviewNote("");
      toast({ title: "Timesheet approved", description: "Payroll has been queued." });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClient.invalidateQueries({ queryKey: ["salaries"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => {
      if (!selectedTimesheet) {
        throw new Error("Select a submitted timesheet.");
      }
      return api.rejectTimesheet(selectedTimesheet.id, selectedTimesheet.employeeNameSnapshot, reviewNote.trim() || "Please revise the sheet.");
    },
    onSuccess: () => {
      setReviewNote("");
      toast({ title: "Timesheet reverted", description: "The employee can now edit and resubmit the week." });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });

  const selectedHours = useMemo(() => {
    if (!selectedTimesheet) {
      return 0;
    }
    return selectedTimesheet.lines.reduce(
      (sum, line) => sum + DAYS.reduce((lineSum, day) => lineSum + Number(line.hours[day] ?? 0), 0),
      0,
    );
  }, [selectedTimesheet]);

  const dailyTotals = useMemo(() => {
    if (!selectedTimesheet) {
      return DAYS.map((day) => ({ day, total: 0 }));
    }
    return DAYS.map((day) => ({
      day,
      total: selectedTimesheet.lines.reduce((sum, line) => sum + Number(line.hours[day] ?? 0), 0),
    }));
  }, [selectedTimesheet]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
            <p className="text-sm text-muted-foreground">
              Review submitted work weeks, keep payroll moving, and use the month calendar for context only.
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

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Pending Sheets</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{pendingTimesheets.length}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Approved This Month</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {timesheets.filter((entry) => entry.status === "approved" && entry.weekStart.slice(0, 7) === selectedMonth).length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Calendar Context</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{monthCalendar?.summary.leaveDays ?? 0} leave</p>
              <p className="mt-1 text-xs text-muted-foreground">{monthCalendar?.summary.holidayDays ?? 0} holidays this month</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Submission Queue</CardTitle>
              <CardDescription>Pick one submitted week to review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingTimesheets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  No submitted timesheets yet.
                </div>
              ) : (
                pendingTimesheets.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedTimesheetId(entry.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-background/70 px-4 py-3 text-left transition-colors hover:bg-secondary/15",
                      selectedTimesheet?.id === entry.id && "border-primary/20 bg-primary/5",
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium text-foreground">{entry.employeeNameSnapshot}</p>
                      <p className="text-xs text-muted-foreground">{weekLabel(entry.weekStart)}</p>
                    </div>
                    <Badge className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 shadow-none">
                      Submitted
                    </Badge>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Review Workspace</CardTitle>
              <CardDescription>A cleaner breakdown of one submitted week before approval.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedTimesheet ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  Select a submitted sheet to review.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Employee</p>
                      <p className="mt-1 font-medium">{selectedTimesheet.employeeNameSnapshot}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Week</p>
                      <p className="mt-1 font-medium">{weekLabel(selectedTimesheet.weekStart)}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Hours</p>
                      <p className="mt-1 font-medium">{selectedHours.toFixed(1)}h</p>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
                    {dailyTotals.map((day) => (
                      <div key={day.day} className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{day.day}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{day.total.toFixed(1)}h</p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_96px] border-b border-border/50 bg-secondary/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      <span>Project</span>
                      <span>Task</span>
                      <span className="text-right">Total</span>
                    </div>
                    {selectedTimesheet.lines.map((line, index) => {
                      const total = DAYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
                      return (
                        <div
                          key={line.id}
                          className={cn(
                            "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_96px] gap-3 px-4 py-3",
                            index !== 0 && "border-t border-border/40",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{line.project || "Custom project"}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{line.task || "Custom task"}</p>
                          </div>
                          <div className="text-right text-sm font-semibold text-foreground">{total.toFixed(1)}h</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Review Note</p>
                    <Textarea
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      placeholder="Add a short note for approval or requested changes."
                      className="min-h-[110px] rounded-xl"
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-3">
                    <Button
                      variant="outline"
                      className="rounded-xl border-border/60"
                      disabled={rejectMutation.isPending}
                      onClick={() => void rejectMutation.mutateAsync()}
                    >
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Revert For Changes
                    </Button>
                    <Button
                      className="rounded-xl border border-emerald-500/20 bg-emerald-500 text-white hover:bg-emerald-500/90"
                      disabled={approveMutation.isPending}
                      onClick={() => void approveMutation.mutateAsync()}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Approve & Queue Payroll
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium">Month Calendar</CardTitle>
            <CardDescription>
              Context for worked days, approved leave, pending leave, and holidays. Leave actions now live in Leave Management.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedEmployeeId || !monthCalendar ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                Select an employee to view the month calendar.
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
