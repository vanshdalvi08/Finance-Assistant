import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { CalendarDays, CheckCircle2, ClipboardList, Eye, FileText, RefreshCcw, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;


function lineTotal(line: { hours: Partial<Record<(typeof DAYS)[number], number>> }) {
  return DAYS.reduce((sum, day) => sum + Number(line.hours[day] ?? 0), 0);
}

function weekLabel(weekStart: string) {
  const start = new Date(weekStart);
  return `${format(start, "dd MMM")} - ${format(addDays(start, 6), "dd MMM yyyy")}`;
}

function taskLineLabel(line: { task?: string; subTask?: string }) {
  const task = line.task?.trim() || "Custom task";
  return line.subTask ? `${task} - ${line.subTask}` : task;
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
  const [showReviewedHistory, setShowReviewedHistory] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [workNoteLineId, setWorkNoteLineId] = useState<string | null>(null);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: projectBudgetSummary = [] } = useQuery({ queryKey: ["project-budget-summary"], queryFn: api.getProjectBudgetSummary });

  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const pendingTimesheets = useMemo(
    () => timesheets.filter((entry) => entry.status === "submitted").sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()),
    [timesheets],
  );
  const reviewedTimesheets = useMemo(
    () =>
      timesheets
        .filter((entry) => entry.status === "approved" || entry.status === "rejected")
        .sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()),
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

  const detailDays = useMemo(() => {
    if (!selectedTimesheet) {
      return [];
    }

    return DAYS.map((day, index) => {
      const date = addDays(new Date(selectedTimesheet.weekStart), index);
      return {
        key: day,
        shortLabel: format(date, "EEE"),
        dateLabel: format(date, "dd MMM"),
      };
    });
  }, [selectedTimesheet]);

  const activeWorkNoteLine = useMemo(
    () => selectedTimesheet?.lines.find((line) => line.id === workNoteLineId) ?? null,
    [selectedTimesheet, workNoteLineId],
  );


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
          <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="w-[220px] rounded-xl" />
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

        <div className="grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="self-start border-border/60 bg-card/80 shadow-sm">
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
                <div className="max-h-[540px] space-y-3 overflow-y-auto pr-1">
                  {pendingTimesheets.map((entry) => (
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
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="self-start border-border/60 bg-card/80 shadow-sm">
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
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-2">
                                <p className="truncate pr-2 text-sm text-foreground">{taskLineLabel(line)}</p>
                                {line.notes?.trim() ? (
                                  <div className="rounded-xl border border-border/45 bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                    {line.notes.trim()}
                                  </div>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-8 shrink-0 rounded-full border border-border/60 bg-background/70 px-3 text-[11px] shadow-none",
                                  line.notes?.trim()
                                    ? "border-primary/20 text-primary hover:bg-primary/10 hover:text-primary"
                                    : "text-muted-foreground hover:bg-secondary/20 hover:text-foreground",
                                )}
                                onClick={() => setDetailOpen(true)}
                              >
                                <FileText className="mr-1.5 h-3.5 w-3.5" />
                                Work Note
                              </Button>
                            </div>
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
                      variant="secondary"
                      className="rounded-xl"
                      disabled={!selectedTimesheet}
                      onClick={() => setDetailOpen(true)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View in detail
                    </Button>
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-medium">Month Calendar</CardTitle>
                <CardDescription>
                  Context for worked days, approved leave, pending leave, and holidays. Leave actions now live in Leave Management.
                </CardDescription>
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

        {reviewedTimesheets.length > 0 ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              onClick={() => setShowReviewedHistory((current) => !current)}
            >
              {showReviewedHistory ? "Hide Reviewed History" : `Previous Reviewed Sheets (${reviewedTimesheets.length})`}
            </Button>
          </div>
        ) : null}

        {showReviewedHistory && reviewedTimesheets.length > 0 ? (
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Reviewed Timesheet History</CardTitle>
              <CardDescription>Previously approved or reverted sheets for audit and reference.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviewedTimesheets.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{entry.employeeNameSnapshot}</p>
                        <Badge
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none",
                            entry.status === "approved"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : "border-amber-500/20 bg-amber-500/10 text-amber-300",
                          )}
                        >
                          {entry.status === "approved" ? "Approved" : "Reverted"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{weekLabel(entry.weekStart)}</p>
                      {entry.reviewNotes ? <p className="text-sm text-muted-foreground">{entry.reviewNotes}</p> : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {entry.reviewedAt ? format(new Date(entry.reviewedAt), "dd MMM yyyy") : "-"}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto rounded-2xl border-border/60 bg-card/95 p-0 shadow-2xl">
          <div className="space-y-6 p-6">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight">Timesheet detail</DialogTitle>
              <DialogDescription>
                A simple full-week breakdown for the currently selected submission.
              </DialogDescription>
            </DialogHeader>

            {!selectedTimesheet ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                Select a submitted sheet to view its full details.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Employee</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{selectedTimesheet.employeeNameSnapshot}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Week</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{weekLabel(selectedTimesheet.weekStart)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Status</p>
                    <p className="mt-1 text-sm font-medium text-foreground">Submitted for review</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Total hours</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{selectedHours.toFixed(1)}h</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                  {detailDays.map((day, index) => (
                    <div key={day.key} className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{day.shortLabel}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{day.dateLabel}</p>
                      <p className="mt-2 text-lg font-semibold text-foreground">{dailyTotals[index]?.total.toFixed(1) ?? "0.0"}h</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  {selectedTimesheet.lines.map((line) => {
                    const total = lineTotal(line);
                    return (
                      <div key={line.id} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                        <div className="flex flex-col gap-3 border-b border-border/50 pb-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-3">
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Project</p>
                              <p className="text-sm font-medium text-foreground">{line.project || "Custom project"}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Task</p>
                              <p className="text-sm text-foreground">{taskLineLabel(line)}</p>
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Work note</p>
                              <div className="rounded-2xl border border-border/50 bg-background/90 px-4 py-3 text-sm leading-6 text-foreground">
                                {line.notes?.trim() || (
                                  <span className="text-muted-foreground">No work note was added for this task.</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-start lg:pl-4">
                            <div className="rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-sm font-semibold text-foreground">
                              {total.toFixed(1)}h
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
                          {detailDays.map((day) => (
                            <div key={day.key} className="rounded-xl border border-border/50 bg-background/90 px-3 py-2.5">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{day.shortLabel}</p>
                              <p className="mt-1 text-sm font-medium text-foreground">{Number(line.hours[day.key] ?? 0).toFixed(1)}h</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid gap-4">
                  <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Review summary</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/80 px-3 py-2.5">
                        <span className="text-sm text-muted-foreground">Lines submitted</span>
                        <span className="text-sm font-semibold text-foreground">{selectedTimesheet.lines.length}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/80 px-3 py-2.5">
                        <span className="text-sm text-muted-foreground">Total hours</span>
                        <span className="text-sm font-semibold text-foreground">{selectedHours.toFixed(1)}h</span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-border/50 bg-background/80 px-3 py-3">
                      <p className="text-sm text-muted-foreground">Current review note</p>
                      <p className="mt-1 text-sm text-foreground">
                        {reviewNote.trim() || "No review note has been written yet for this submission."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {workNoteLineId ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/35 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Work Note"
            className="relative w-full max-w-md rounded-[28px] border border-border/60 bg-card/95 p-6 shadow-2xl"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-8 w-8 rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              onClick={() => setWorkNoteLineId(null)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close work note</span>
            </Button>

            <div className="space-y-4 pr-8">
              <div className="space-y-1 text-left">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Work Note</h2>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Task</p>
                  <p className="text-sm font-medium text-foreground">{taskLineLabel(activeWorkNoteLine ?? {})}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm leading-6 text-foreground">
                  {activeWorkNoteLine?.notes?.trim() || (
                    <span className="text-muted-foreground">No work note was added for this task.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {false ? (
      <Dialog open={Boolean(workNoteLineId)} onOpenChange={(open) => !open && setWorkNoteLineId(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border/60 bg-card/95 p-0 shadow-2xl">
          <div className="space-y-5 p-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-lg font-semibold tracking-tight">Work Note</DialogTitle>
              <DialogDescription>
                Review the employee’s submitted work summary for this task.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/60 p-4">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Task</p>
                <p className="text-sm font-medium text-foreground">
                  {activeWorkNoteLine?.task?.trim() || "Custom task"}
                  {activeWorkNoteLine?.subTask ? (
                    <span className="font-normal text-muted-foreground"> - {activeWorkNoteLine?.subTask}</span>
                  ) : null}
                </p>
              </div>
              <div className="min-h-[150px] rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-sm leading-6 text-foreground">
                {activeWorkNoteLine?.notes?.trim() || (
                  <span className="text-muted-foreground">No work note was added for this task.</span>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      ) : null}
    </DashboardLayout>
  );
}
