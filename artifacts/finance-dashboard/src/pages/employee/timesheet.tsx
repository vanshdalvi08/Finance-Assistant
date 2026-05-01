import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  ClipboardCheck,
  FilePenLine,
  Plus,
  Save,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useAuthStore } from "@/store/auth";
import { api, type DayKey, type MonthCalendarDay, type TimesheetEntry, type TimesheetTaskLine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type ProjectCatalogProject = Awaited<ReturnType<typeof api.getProjectCatalog>>[number];
type ProjectCatalogTask = ProjectCatalogProject["tasks"][number];

function normalizeLookup(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function weekStartIso(base = new Date()) {
  const date = new Date(base);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function sameWeek(left: string, right: string) {
  return format(new Date(left), "yyyy-MM-dd") === format(new Date(right), "yyyy-MM-dd");
}

function createLine(): TimesheetTaskLine {
  return {
    id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    project: "",
    task: "",
    subTask: "",
    notes: "",
    hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
  };
}

function createDraftEntry(input: {
  employeeId: string;
  employeeNameSnapshot: string;
  weekStart: string;
}): TimesheetEntry {
  return {
    id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    employeeId: input.employeeId,
    employeeNameSnapshot: input.employeeNameSnapshot,
    weekStart: input.weekStart,
    status: "draft",
    lines: [createLine()],
  };
}

function lineTotal(line: TimesheetTaskLine) {
  return DAYS.reduce((sum, day) => sum + (line.hours[day.key] ?? 0), 0);
}

function positiveTaskLimit(task?: { maxHours?: number; remainingHours?: number }) {
  if (typeof task?.remainingHours === "number") {
    return task.remainingHours;
  }

  return Number(task?.maxHours ?? 0) > 0 ? Number(task?.maxHours) : undefined;
}

function entryTotal(entry: TimesheetEntry | null) {
  if (!entry) {
    return 0;
  }

  return entry.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

function formatHourValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0h";
  }

  return `${Number(value.toFixed(1)).toString()}h`;
}

function formatTaskOptionLabel(task: ProjectCatalogTask) {
  return task.description?.trim() ? `${task.name} - ${task.description.trim()}` : task.name;
}


function toDateInputValue(weekStart: string) {
  return format(new Date(weekStart), "yyyy-MM-dd");
}

function statusLabel(status: TimesheetEntry["status"]) {
  if (status === "rejected") return "Returned";
  if (status === "submitted") return "Pending Review";
  if (status === "approved") return "Approved";
  return "Draft";
}

function statusBadgeClass(status: TimesheetEntry["status"]) {
  if (status === "approved") {
    return "border-emerald-500/20 bg-emerald-500/8 text-emerald-300";
  }

  if (status === "submitted") {
    return "border-sky-500/20 bg-sky-500/8 text-sky-300";
  }

  if (status === "rejected") {
    return "border-amber-500/20 bg-amber-500/8 text-amber-300";
  }

  return "border-border/60 bg-secondary/40 text-muted-foreground";
}

function hourInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function hasDraftContent(entry: TimesheetEntry | null) {
  if (!entry) {
    return false;
  }

  return entry.lines.some(
    (line) =>
      Boolean(line.project.trim() || line.task.trim() || line.notes?.trim()) ||
      DAYS.some((day) => Number(line.hours[day.key] ?? 0) > 0),
  );
}

export default function EmployeeTimesheetPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const [selectedWeek, setSelectedWeek] = useState(() => weekStartIso());
  const [draft, setDraft] = useState<TimesheetEntry | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<DayKey | null>(null);

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
          profilePhotoUrl: user.profilePhotoUrl ?? undefined,
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

  const { data: timesheets = [] } = useQuery({
    queryKey: ["employee-timesheets", employee?.id],
    queryFn: () => api.getTimesheets({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  const { data: catalogProjects = [] } = useQuery({
    queryKey: ["projectCatalog"],
    queryFn: () => api.getProjectCatalog(),
  });

  const { data: projectBudgetSummary = [] } = useQuery({
    queryKey: ["project-budget-summary"],
    queryFn: api.getProjectBudgetSummary,
  });

  const selectedMonth = selectedWeek.slice(0, 7);

  const { data: monthCalendar } = useQuery({
    queryKey: ["employee-month-calendar", employee?.id, selectedMonth],
    queryFn: () => api.getEmployeeMonthCalendar({ employeeId: employee?.id ?? "", month: selectedMonth }),
    enabled: Boolean(employee?.id),
  });

  const [projectSelections, setProjectSelections] = useState<Record<string, string>>({});
  const [taskSelections, setTaskSelections] = useState<Record<string, string>>({});

  const projectOptions = useMemo(
    () =>
      [...catalogProjects].sort((left, right) => left.project.localeCompare(right.project)),
    [catalogProjects],
  );

  const projectLookup = useMemo(
    () => new Map(projectOptions.map((project) => [normalizeLookup(project.project), project])),
    [projectOptions],
  );

  const current = useMemo(
    () => timesheets.find((entry) => sameWeek(entry.weekStart, selectedWeek)) ?? null,
    [selectedWeek, timesheets],
  );

  const payrollProfile = (employee ?? {}) as {
    payType?: string;
    hourlyRate?: number;
  };
  const isHourly = String(payrollProfile.payType ?? "").toLowerCase() === "hourly";
  const draftHours = entryTotal(draft);

  const weekDates = useMemo(
    () => DAYS.map((day, index) => ({ ...day, date: addDays(new Date(selectedWeek), index) })),
    [selectedWeek],
  );

  const dayTotals = useMemo(
    () =>
      weekDates.map((day) => ({
        ...day,
        total: draft?.lines.reduce((sum, line) => sum + Number(line.hours[day.key] ?? 0), 0) ?? 0,
      })),
    [draft, weekDates],
  );

  const weekRangeLabel = `${format(new Date(selectedWeek), "dd MMM")} - ${format(addDays(new Date(selectedWeek), 6), "dd MMM yyyy")}`;
  const isCurrentWeek = sameWeek(selectedWeek, weekStartIso());
  const weekCalendarLookup = useMemo(
    () =>
      new Map(
        (monthCalendar?.days ?? []).map((day) => [day.date.slice(0, 10), day]),
      ),
    [monthCalendar?.days],
  );
  const weekStatuses = useMemo(
    () =>
      weekDates.map((day) => ({
        ...day,
        calendar: weekCalendarLookup.get(day.date.toISOString().slice(0, 10)),
      })),
    [weekCalendarLookup, weekDates],
  );

  const summary = useMemo(() => {
    const pending = timesheets.filter((entry) => entry.status === "submitted").length;
    const approved = timesheets.filter((entry) => entry.status === "approved").length;
    const activeTasks = draft?.lines.filter(
      (line) =>
        line.project.trim() ||
        line.task.trim() ||
        DAYS.some((day) => Number(line.hours[day.key] ?? 0) > 0),
    ).length ?? 0;

    return {
      pending,
      approved,
      activeTasks,
      holidayDays: weekStatuses.filter((day) => day.calendar?.holiday).length,
      leaveDays: weekStatuses.filter((day) => day.calendar?.leave).length,
    };
  }, [draft, timesheets, weekStatuses]);

  function getProjectTaskOptions(projectName: string) {
    const record = projectLookup.get(normalizeLookup(projectName));
    if (!record) {
      return [];
    }

    return record.tasks.filter((task) => task.status === "active" && task.name.trim().length > 0);
  }

  function getProjectSelectionValue(line: TimesheetTaskLine) {
    const known = projectLookup.get(normalizeLookup(line.project));
    if (projectSelections[line.id]) {
      return projectSelections[line.id];
    }

    return known ? known.project : line.project.trim() ? "__custom__" : "";
  }

  function getTaskSelectionValue(line: TimesheetTaskLine) {
    const taskOptions = getProjectTaskOptions(line.project);
    if (taskSelections[line.id]) {
      return taskSelections[line.id];
    }

    if (line.projectTaskId && taskOptions.some((task) => task.id === line.projectTaskId)) {
      return line.projectTaskId;
    }

    const matchedTasks = taskOptions.filter((task) => normalizeLookup(task.name) === normalizeLookup(line.task));
    if (matchedTasks.length === 1) {
      return matchedTasks[0].id;
    }

    return line.task.trim() ? "__custom__" : "";
  }

  function setProjectChoice(lineId: string, value: string) {
    setProjectSelections((currentSelection) => ({ ...currentSelection, [lineId]: value }));

    if (value === "__custom__") {
      setTaskSelections((currentSelection) => ({ ...currentSelection, [lineId]: "__custom__" }));
      updateLine(lineId, (line) => ({
        ...line,
        project: "",
        projectBudgetId: undefined,
        task: "",
        projectTaskId: undefined,
        subTask: "",
      }));
      return;
    }

    setTaskSelections((currentSelection) => {
      const next = { ...currentSelection };
      delete next[lineId];
      return next;
    });

    updateLine(lineId, (line) => {
      return {
        ...line,
        project: value,
        projectBudgetId: projectLookup.get(normalizeLookup(value))?.id,
        task: "",
        projectTaskId: undefined,
        subTask: "",
      };
    });
  }

  function setTaskChoice(lineId: string, value: string) {
    setTaskSelections((currentSelection) => ({ ...currentSelection, [lineId]: value }));

    if (value === "__custom__") {
      updateLine(lineId, (line) => ({ ...line, task: "", projectTaskId: undefined, subTask: "" }));
      return;
    }

    updateLine(lineId, (line) => {
      const taskOptions = getProjectTaskOptions(line.project);
      const selectedTask = taskOptions.find((task) => task.id === value);
      return {
        ...line,
        task: selectedTask?.name ?? "",
        projectTaskId: selectedTask?.id,
        subTask: selectedTask?.subTasks?.some((subTask) => normalizeLookup(subTask) === normalizeLookup(line.subTask))
          ? line.subTask
          : "",
      };
    });
  }

  function setSubTaskChoice(lineId: string, value: string) {
    updateLine(lineId, (line) => ({ ...line, subTask: value }));
  }

  function getCurrentDraftTaskHours(taskId: string, excludeLineId?: string) {
    if (!draft) {
      return 0;
    }

    return draft.lines.reduce((sum, line) => {
      if (line.projectTaskId !== taskId || line.id === excludeLineId) {
        return sum;
      }

      return sum + lineTotal(line);
    }, 0);
  }

  function getTaskCapacitySnapshot(task?: ProjectCatalogTask) {
    if (!task || Number(task.maxHours ?? 0) <= 0) {
      return null;
    }

    const maxHours = Number(task.maxHours ?? 0);
    const persistedCurrentEntryTaskHours =
      current?.lines.reduce((sum, line) => {
        if (line.projectTaskId !== task.id) {
          return sum;
        }

        return sum + lineTotal(line);
      }, 0) ?? 0;
    const summaryUsed =
      typeof task.usedHours === "number"
        ? task.usedHours
        : typeof task.remainingHours === "number"
          ? Math.max(0, maxHours - task.remainingHours)
          : 0;
    const currentDraftHours = getCurrentDraftTaskHours(task.id);
    const used = Number((summaryUsed - persistedCurrentEntryTaskHours + currentDraftHours).toFixed(2));
    const remaining = Math.max(0, Number((maxHours - used).toFixed(2)));

    return {
      maxHours,
      used,
      remaining,
      currentDraftHours: Number(currentDraftHours.toFixed(2)),
    };
  }

  const fieldControlClass =
    "h-9 w-full rounded-xl border border-border/55 bg-background/80 px-3 text-sm shadow-none outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";

  useEffect(() => {
    if (current) {
      setDraft(current);
      return;
    }

    if (!employee?.id && !user?.id) {
      setDraft(null);
      return;
    }

    setDraft(
      createDraftEntry({
        employeeId: employee?.id ?? user?.id ?? "",
        employeeNameSnapshot: employee?.name ?? user?.name ?? user?.email ?? "Employee",
        weekStart: selectedWeek,
      }),
    );
  }, [current, employee?.id, employee?.name, selectedWeek, user?.email, user?.id, user?.name]);

  function syncTimesheetCache(nextEntry: TimesheetEntry) {
    if (!employee?.id) {
      return;
    }

    queryClient.setQueryData<TimesheetEntry[]>(["employee-timesheets", employee.id], (currentEntries = []) => {
      const otherEntries = currentEntries.filter((entry) => entry.id !== nextEntry.id);
      return [nextEntry, ...otherEntries].sort(
        (left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime(),
      );
    });
  }

  const saveMutation = useMutation({
    mutationFn: (entry: TimesheetEntry) => api.saveTimesheet(entry),
    onSuccess: (savedEntry) => {
      setDraft(savedEntry);
      syncTimesheetCache(savedEntry);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-budget-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["projectBudgetSummary"] }),
      ]);
      toast({
        title: "Draft saved",
        description: "Your timesheet draft has been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save draft",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (entry: TimesheetEntry) => api.submitTimesheetEntry(entry),
    onSuccess: (submittedEntry) => {
      setDraft(submittedEntry);
      syncTimesheetCache(submittedEntry);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["project-budget-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["projectBudgetSummary"] }),
      ]);
      toast({
        title: "Timesheet submitted",
        description: "Your week has been sent for review.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not submit timesheet",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const readOnly = draft?.status === "submitted" || draft?.status === "approved";
  const isRejected = draft?.status === "rejected";
  const canPersistDraft = hasDraftContent(draft);

  function goToWeek(date: Date) {
    setSelectedWeek(weekStartIso(date));
  }

  function updateLine(lineId: string, updater: (line: TimesheetTaskLine) => TimesheetTaskLine) {
    setDraft((currentEntry) =>
      currentEntry
        ? {
            ...currentEntry,
            lines: currentEntry.lines.map((line) => (line.id === lineId ? updater(line) : line)),
          }
        : currentEntry,
    );
  }

  function changeHour(lineId: string, day: DayKey, rawValue: string) {
    const requestedValue = rawValue === "" ? 0 : Math.max(0, Math.min(24, Number(rawValue || 0)));
    const targetLine = draft?.lines.find((line) => line.id === lineId);
    const currentValue = Number(targetLine?.hours[day] ?? 0);
    const selectedTask =
      targetLine?.projectTaskId && targetLine.project.trim()
        ? getProjectTaskOptions(targetLine.project).find((option) => option.id === targetLine.projectTaskId)
        : undefined;
    const taskSnapshot = getTaskCapacitySnapshot(selectedTask);
    const maxAvailableForCell = taskSnapshot ? Math.max(0, Number((taskSnapshot.remaining + currentValue).toFixed(2))) : 24;
    const nextValue = Math.max(0, Math.min(requestedValue, maxAvailableForCell, 24));

    if (requestedValue > nextValue && taskSnapshot) {
      toast({
        title: "Task hour limit reached",
        description: `${targetLine?.task || "This task"} has ${formatHourValue(taskSnapshot.remaining)} remaining in its allocation window.`,
        variant: "destructive",
      });
    }

    updateLine(lineId, (line) => ({
      ...line,
      hours: {
        ...line.hours,
        [day]: nextValue,
      },
    }));
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">My Timesheet</h1>
          <p className="text-sm text-muted-foreground">Track weekly work with a clean, minimal grid.</p>
        </div>

        <section className="rounded-2xl border border-border/60 bg-card/80 px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Week Range</p>
              <div className="flex items-center gap-3">
                <p className="text-lg font-medium">{weekRangeLabel}</p>
                {isCurrentWeek ? (
                  <Badge className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary shadow-none">
                    This Week
                  </Badge>
                ) : null}
                {draft ? (
                  <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none", statusBadgeClass(draft.status))}>
                    {statusLabel(draft.status)}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[168px]">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  className="h-9 rounded-xl border-border/60 bg-background pl-9 shadow-none"
                  value={toDateInputValue(selectedWeek)}
                  onChange={(event) => {
                    if (!event.target.value) {
                      return;
                    }

                    goToWeek(new Date(`${event.target.value}T12:00:00`));
                  }}
                />
              </div>
              <Button variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => goToWeek(addDays(new Date(selectedWeek), -7))}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Previous Week
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl border-border/60" disabled={isCurrentWeek} onClick={() => goToWeek(new Date())}>
                This Week
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => goToWeek(addDays(new Date(selectedWeek), 7))}>
                Next Week
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>

        </section>

        {isRejected && draft?.reviewNotes ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm shadow-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Returned for changes</p>
              <p className="text-muted-foreground">{draft.reviewNotes}</p>
            </div>
          </div>
        ) : null}

        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-medium">Weekly Grid</CardTitle>
                <CardDescription>Enter hours day by day. Project and task columns stay fixed while you scroll.</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-border/60"
                disabled={readOnly}
                onClick={() =>
                  setDraft((currentEntry) =>
                    currentEntry
                      ? { ...currentEntry, lines: [...currentEntry.lines, createLine()] }
                      : currentEntry,
                  )
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Task
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {!draft ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Preparing your timesheet workspace...</div>
            ) : (
              <div className="timesheet-scroll overflow-x-auto">
                <table className="w-full min-w-[1200px] table-fixed border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-secondary/10 text-left text-sm text-muted-foreground">
                      <th className="sticky left-0 z-30 w-[180px] min-w-[180px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                        Project
                      </th>
                      <th className="sticky left-[180px] z-30 w-[300px] min-w-[300px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                        Task
                      </th>
                      {weekDates.map((day) => {
                        const calendarDay = weekCalendarLookup.get(day.date.toISOString().slice(0, 10));
                        const isHoliday = Boolean(calendarDay?.holiday);
                        const isLeave = Boolean(calendarDay?.leave);
                        const isPending = calendarDay?.leaveStatus === "pending";

                        return (
                          <th
                            key={day.key}
                              className={cn(
                                "w-[78px] min-w-[78px] border-b border-r border-border/50 px-2 py-3 text-center font-medium last:border-r-0",
                                hoveredDay === day.key && "bg-secondary/35 text-foreground",
                                isHoliday && "bg-emerald-500/5",
                                isLeave && "bg-amber-500/5",
                                isPending && "bg-sky-500/5",
                              )}
                          >
                            <div className="space-y-1">
                              <p>{day.label}</p>
                              <p className="text-[11px] font-normal text-muted-foreground">{format(day.date, "dd MMM")}</p>
                              {isHoliday ? (
                                <p className="text-[10px] font-medium text-emerald-300">{calendarDay?.holidayName ?? "Holiday"}</p>
                              ) : isPending ? (
                                <p className="text-[10px] font-medium text-sky-300">Pending</p>
                              ) : isLeave ? (
                                <p className="text-[10px] font-medium text-amber-300">Leave</p>
                              ) : (
                                <p className="text-[10px] font-medium text-muted-foreground">Work</p>
                              )}
                            </div>
                          </th>
                        );
                      })}
                      <th className="w-[92px] min-w-[92px] border-b border-r border-border/50 px-2 py-3 text-center font-medium text-foreground">
                        Total
                      </th>
                      <th className="w-[96px] min-w-[96px] border-b border-border/50 px-2 py-3 text-right font-medium text-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {draft.lines.map((line) => {
                      const projectSelectionValue = getProjectSelectionValue(line);
                      const taskSelectionValue = getTaskSelectionValue(line);
                      const projectTaskOptions = getProjectTaskOptions(line.project);
                      const selectedTask = line.projectTaskId
                        ? projectTaskOptions.find((task) => task.id === line.projectTaskId)
                        : projectTaskOptions.find((task) => normalizeLookup(task.name) === normalizeLookup(line.task));
                      const taskCapacity = getTaskCapacitySnapshot(selectedTask);
                      const selectedTaskSubTasks = selectedTask?.subTasks ?? [];
                      const showProjectInput = projectSelectionValue === "__custom__" || projectOptions.length === 0;
                      const hasProjectValue = Boolean(line.project.trim());
                      const showTaskInput = hasProjectValue && (taskSelectionValue === "__custom__" || projectTaskOptions.length === 0);

                      return (
                        <tr
                          key={line.id}
                          className={cn(hoveredRowId === line.id && "bg-secondary/8")}
                          onMouseEnter={() => setHoveredRowId(line.id)}
                          onMouseLeave={() => setHoveredRowId((currentRow) => (currentRow === line.id ? null : currentRow))}
                        >
                          <td className="sticky left-0 z-20 border-b border-r border-border/50 bg-card px-4 py-3 align-top">
                            <div className="space-y-2">
                              {projectOptions.length > 0 ? (
                                <select
                                  value={projectSelectionValue}
                                  disabled={readOnly}
                                  className={fieldControlClass}
                                  onChange={(event) => setProjectChoice(line.id, event.target.value)}
                                >
                                  <option value="">Select project</option>
                                  {projectOptions.map((project) => (
                                    <option key={project.id} value={project.project}>
                                      {project.project}
                                    </option>
                                  ))}
                                  <option value="__custom__">Custom project</option>
                                </select>
                              ) : null}
                              {showProjectInput ? (
                                <Input
                                  value={line.project}
                                  placeholder="Project name"
                                  disabled={readOnly}
                                  className="h-9 rounded-xl border-border/55 bg-background/80 text-sm shadow-none"
                                  onChange={(event) =>
                                    updateLine(line.id, (currentLine) => ({
                                      ...currentLine,
                                      project: event.target.value,
                                      projectBudgetId: undefined,
                                    }))
                                  }
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="sticky left-[180px] z-20 border-b border-r border-border/50 bg-card px-4 py-3 align-top">
                            <div className="space-y-2">
                              {hasProjectValue ? (
                                projectTaskOptions.length > 0 ? (
                                  <>
                                    <select
                                      value={taskSelectionValue}
                                      disabled={readOnly}
                                      className={fieldControlClass}
                                      onChange={(event) => setTaskChoice(line.id, event.target.value)}
                                    >
                                      <option value="">Select task</option>
                                      {projectTaskOptions.map((task) => (
                                        <option key={task.id} value={task.id}>
                                          {formatTaskOptionLabel(task)}
                                        </option>
                                      ))}
                                      <option value="__custom__">Custom task</option>
                                    </select>
                                    {showTaskInput ? (
                                      <Input
                                        value={line.task}
                                        placeholder="Custom task name"
                                        disabled={readOnly}
                                        className="h-9 rounded-xl border-border/55 bg-background/80 text-sm shadow-none"
                                        onChange={(event) =>
                                          updateLine(line.id, (currentLine) => ({
                                            ...currentLine,
                                            task: event.target.value,
                                            projectTaskId: undefined,
                                          }))
                                        }
                                      />
                                    ) : null}
                                    {taskCapacity ? (
                                      <div className="rounded-xl border border-border/45 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">
                                          Remaining task capacity: {formatHourValue(taskCapacity.remaining)}
                                        </span>
                                        {" · "}
                                        <span>
                                          Being used: {formatHourValue(taskCapacity.currentDraftHours)}
                                        </span>
                                      </div>
                                    ) : null}
                                    {selectedTaskSubTasks.length > 0 ? (
                                      <div className="space-y-1.5">
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sub task</p>
                                        <select
                                          value={line.subTask ?? ""}
                                          disabled={readOnly}
                                          className={fieldControlClass}
                                          onChange={(event) => setSubTaskChoice(line.id, event.target.value)}
                                        >
                                          <option value="">Select sub task</option>
                                          {selectedTaskSubTasks.map((subTask) => (
                                            <option key={subTask} value={subTask}>
                                              {subTask}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : null}
                                  </>
                              ) : (
                                <Input
                                  value={line.task}
                                  placeholder="Custom task name"
                                  disabled={readOnly}
                                  className="h-9 rounded-xl border-border/55 bg-background/80 text-sm shadow-none"
                                  onChange={(event) =>
                                    updateLine(line.id, (currentLine) => ({
                                        ...currentLine,
                                        task: event.target.value,
                                        projectTaskId: undefined,
                                      }))
                                    }
                                  />
                                )
                              ) : (
                                <div className="flex h-9 items-center rounded-xl border border-dashed border-border/50 bg-background/50 px-3 text-xs text-muted-foreground">
                                  Choose a project first
                                </div>
                              )}
                            </div>
                          </td>
                          {weekDates.map((day) => (
                        (() => {
                          const calendarDay = weekCalendarLookup.get(day.date.toISOString().slice(0, 10));
                          const isOffDay = Boolean(calendarDay?.holiday || calendarDay?.leave || calendarDay?.leaveStatus === "pending");
                          const placeholder = calendarDay?.holiday
                            ? calendarDay.holidayName ?? "Holiday"
                            : calendarDay?.leaveStatus === "pending"
                              ? "Pending"
                              : calendarDay?.leave
                                ? "Leave"
                                : "0";
                          return (
                            <td
                              key={day.key}
                              className={cn(
                                "border-b border-r border-border/50 px-3 py-3 align-top transition-colors",
                                hoveredDay === day.key && "bg-secondary/15",
                                day.key === "sat" || day.key === "sun" ? "bg-secondary/5" : "",
                                isOffDay && "bg-secondary/10",
                              )}
                              onMouseEnter={() => setHoveredDay(day.key)}
                              onMouseLeave={() => setHoveredDay((currentDay) => (currentDay === day.key ? null : currentDay))}
                            >
                              <Input
                                type="number"
                                min={0}
                                max={24}
                                step={0.5}
                                disabled={readOnly || isOffDay}
                                className="h-9 rounded-xl border-border/55 bg-background/80 px-2 text-center text-sm shadow-none"
                                placeholder={placeholder}
                                value={hourInputValue(line.hours[day.key])}
                                onChange={(event) => changeHour(line.id, day.key, event.target.value)}
                              />
                            </td>
                              );
                            })()
                          ))}
                          <td className="border-b border-r border-border/50 px-3 py-3 text-center align-middle font-medium text-foreground">
                            {formatHourValue(lineTotal(line))}
                          </td>
                          <td className="border-b border-border/50 px-3 py-3 text-right align-middle">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-xl px-2 text-muted-foreground hover:bg-secondary/25 hover:text-foreground"
                                disabled={readOnly}
                                onClick={() =>
                                  setDraft((currentEntry) =>
                                    currentEntry
                                      ? {
                                          ...currentEntry,
                                          lines: [...currentEntry.lines, { ...line, id: createLine().id }],
                                        }
                                      : currentEntry,
                                  )
                                }
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-xl px-2 text-muted-foreground hover:bg-secondary/25 hover:text-foreground"
                                disabled={readOnly}
                                onClick={() =>
                                  setDraft((currentEntry) =>
                                    currentEntry
                                      ? {
                                          ...currentEntry,
                                          lines:
                                            currentEntry.lines.length === 1
                                              ? [createLine()]
                                              : currentEntry.lines.filter((item) => item.id !== line.id),
                                        }
                                      : currentEntry,
                                  )
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="bg-secondary/10">
                      <td className="sticky left-0 z-10 border-r border-border/50 bg-card px-4 py-4 text-sm font-medium text-foreground">
                        Day Totals
                      </td>
                      <td className="sticky left-[160px] z-10 border-r border-border/50 bg-card px-4 py-4 text-sm text-muted-foreground">
                        Weekly rollup
                      </td>
                      {dayTotals.map((day) => (
                        <td
                          key={day.key}
                          className={cn(
                            "border-r border-border/50 px-3 py-4 text-center text-sm font-medium text-foreground",
                            hoveredDay === day.key && "bg-secondary/20",
                          )}
                        >
                          {formatHourValue(day.total)}
                        </td>
                      ))}
                      <td className="border-r border-border/50 px-3 py-4 text-center text-sm font-semibold text-foreground">
                        {formatHourValue(draftHours)}
                      </td>
                      <td className="px-3 py-4" />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-xl px-4 text-muted-foreground hover:bg-secondary/20 hover:text-foreground"
            disabled={!draft || !canPersistDraft || readOnly || saveMutation.isPending}
            onClick={() => draft && saveMutation.mutate(draft)}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Draft
          </Button>
          <Button
            size="sm"
            className="h-9 rounded-xl border border-sky-400/20 bg-sky-500 text-white shadow-sm hover:bg-sky-500/90"
            disabled={!draft || readOnly || draftHours <= 0 || submitMutation.isPending}
            onClick={() => draft && submitMutation.mutate(draft)}
          >
            {isRejected ? (
              <>
                <FilePenLine className="mr-2 h-4 w-4" />
                Submit for Review
              </>
            ) : (
              <>
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Submit for Review
              </>
            )}
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Recent Weeks</CardTitle>
              <CardDescription>Previous entries with quiet status markers and quick navigation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {timesheets.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No timesheet history yet.</div>
              ) : (
                timesheets.slice(0, 6).map((entry, index) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedWeek(entry.weekStart)}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-secondary/15",
                      sameWeek(entry.weekStart, weekStartIso()) && "bg-primary/5",
                      index !== 0 && "border-t border-border/40",
                    )}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {format(new Date(entry.weekStart), "dd MMM")} - {format(addDays(new Date(entry.weekStart), 6), "dd MMM yyyy")}
                        </p>
                        {sameWeek(entry.weekStart, weekStartIso()) ? (
                          <Badge className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                            This Week
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{formatHourValue(entryTotal(entry))} logged</p>
                    </div>
                    <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none", statusBadgeClass(entry.status))}>
                      {statusLabel(entry.status)}
                    </Badge>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 shadow-sm self-start">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Week Snapshot</CardTitle>
              <CardDescription>Keep the weekly totals visible without distracting from the grid.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Weekly Hours</span>
                <span className="text-sm font-semibold text-foreground">{formatHourValue(draftHours)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Active Tasks</span>
                <span className="text-sm font-semibold text-foreground">{summary.activeTasks}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Pending Review</span>
                <span className="text-sm font-semibold text-foreground">{summary.pending}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Approved Sheets</span>
                <span className="text-sm font-semibold text-foreground">{summary.approved}</span>
              </div>
              {summary.leaveDays > 0 || summary.holidayDays > 0 ? (
                <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-sm text-muted-foreground">
                  {summary.leaveDays > 0 ? `${summary.leaveDays} leave day${summary.leaveDays > 1 ? "s" : ""}` : null}
                  {summary.leaveDays > 0 && summary.holidayDays > 0 ? " Ã‚Â· " : null}
                  {summary.holidayDays > 0 ? `${summary.holidayDays} holiday${summary.holidayDays > 1 ? "s" : ""}` : null} in this week.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

