import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  CalendarDays,
  ChevronDown,
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
import {
  api,
  type DayKey,
  type TimesheetDailyReviewHolidays,
  type TimesheetDailyReviewLocks,
  type TimesheetDailyReviewNotes,
  type TimesheetDailyReviewStatus,
  type TimesheetEntry,
  type TimesheetTaskLine,
  type TimesheetWorkNotes,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  dayKeysThrough,
  formatMonthEndDate,
  formatMonthEndRange,
  formatRemainingDays,
  formatWeekSpan,
  locksWithMonthEnd,
  monthEndLockedDays,
  timesheetMonthEndCutoff,
} from "@/lib/timesheet-month-end";

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
    workNotes: {},
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

function lineHoursWithinTaskWindow(
  weekStart: string,
  line: TimesheetTaskLine,
  task?: { startDate?: string; endDate?: string },
) {
  const startDate = task?.startDate;
  const endDate = task?.endDate;
  if (!startDate || !endDate) {
    return lineTotal(line);
  }

  return DAYS.reduce((sum, day, index) => {
    const hours = Number(line.hours[day.key] ?? 0);
    if (hours <= 0) {
      return sum;
    }

    const date = addDays(new Date(weekStart), index);
    const dateIso = format(date, "yyyy-MM-dd");
    return dateIso >= startDate && dateIso <= endDate ? sum + hours : sum;
  }, 0);
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

function formatTaskWindowLabel(task?: { startDate?: string; endDate?: string; durationDays?: number }) {
  if (task?.startDate && task.endDate) {
    return `${task.startDate} to ${task.endDate}`;
  }

  return task?.durationDays ? `${task.durationDays} day window` : null;
}

function isTaskWindowDay(task: { startDate?: string; endDate?: string } | undefined, date: Date) {
  if (!task?.startDate || !task.endDate) {
    return true;
  }

  const dayIso = format(date, "yyyy-MM-dd");
  return dayIso >= task.startDate && dayIso <= task.endDate;
}


function SubmitChoiceOption({
  label,
  range,
  disabled,
  title,
  onSelect,
}: {
  label: string;
  range: string;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-5 text-foreground">{label}</span>
        <span className="block text-[11px] leading-4 tabular-nums text-muted-foreground">{range}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:hidden" />
    </button>
  );
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

function isHourInputDraft(value: string) {
  return /^\d{0,2}(\.\d{0,1})?$/.test(value.trim()) || value.trim() === "";
}

function normalizeWorkNotes(input?: TimesheetWorkNotes | null) {
  const normalized = Object.fromEntries(
    DAYS.map(({ key }) => [key, String(input?.[key] ?? "").trim()]).filter(([, value]) => value.length > 0),
  ) as TimesheetWorkNotes;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeDailyReviewStatus(input?: TimesheetDailyReviewStatus | null) {
  return Object.fromEntries(
    DAYS.map(({ key }) => [key, input?.[key] === "reviewed" || input?.[key] === "reverted" ? input?.[key] : ""]).filter(([, value]) => value === "reviewed" || value === "reverted"),
  ) as TimesheetDailyReviewStatus;
}

function normalizeDayFlags<T extends Partial<Record<DayKey, true>>>(input?: T | null) {
  return Object.fromEntries(
    DAYS.map(({ key }) => [key, input?.[key] === true ? true : undefined]).filter(([, value]) => value === true),
  ) as T;
}

function normalizeDailyReviewNotes(input?: TimesheetDailyReviewNotes | null) {
  return Object.fromEntries(
    DAYS.map(({ key }) => [key, input?.[key]?.trim() ?? ""]).filter(([, value]) => value.length > 0),
  ) as TimesheetDailyReviewNotes;
}

function clearEditableDayReviewState(
  status: TimesheetDailyReviewStatus | undefined,
  notes: TimesheetDailyReviewNotes | undefined,
  day: DayKey,
) {
  const nextStatus = { ...(status ?? {}) };
  const nextNotes = { ...(notes ?? {}) };
  delete nextStatus[day];
  delete nextNotes[day];
  const normalizedStatus = normalizeDailyReviewStatus(nextStatus);
  const normalizedNotes = normalizeDailyReviewNotes(nextNotes);
  return {
    status: normalizedStatus && Object.keys(normalizedStatus).length > 0 ? normalizedStatus : undefined,
    notes: normalizedNotes && Object.keys(normalizedNotes).length > 0 ? normalizedNotes : undefined,
  };
}

function isProtectedDayLocked(
  status: TimesheetDailyReviewStatus | undefined,
  holidays: TimesheetDailyReviewHolidays | undefined,
  locks: TimesheetDailyReviewLocks | undefined,
  day: DayKey,
) {
  return status?.[day] === "reviewed" || holidays?.[day] === true || locks?.[day] === true;
}

function lineHasProtectedDayContent(
  line: TimesheetTaskLine,
  status: TimesheetDailyReviewStatus | undefined,
  holidays: TimesheetDailyReviewHolidays | undefined,
  locks: TimesheetDailyReviewLocks | undefined,
) {
  return DAYS.some(
    ({ key }) =>
      isProtectedDayLocked(status, holidays, locks, key) &&
      (Number(line.hours[key] ?? 0) > 0 || Boolean(line.workNotes?.[key]?.trim())),
  );
}

function summarizeWorkNotes(workNotes?: TimesheetWorkNotes | null) {
  const normalized = normalizeWorkNotes(workNotes);
  if (!normalized) {
    return undefined;
  }

  return DAYS.map(({ key, label }) => {
    const note = normalized[key]?.trim();
    return note ? `${label}: ${note}` : null;
  })
    .filter((value): value is string => Boolean(value))
    .join(" • ");
}

function updateLineDayWorkNote(line: TimesheetTaskLine, day: DayKey, note: string) {
  const nextWorkNotes: TimesheetWorkNotes = { ...(line.workNotes ?? {}) };
  const trimmedNote = note.trim();

  if (trimmedNote) {
    nextWorkNotes[day] = trimmedNote;
  } else {
    delete nextWorkNotes[day];
  }

  const normalized = normalizeWorkNotes(nextWorkNotes);
  return {
    ...line,
    workNotes: normalized ?? {},
    notes: summarizeWorkNotes(normalized),
  };
}

function hasDraftContent(entry: TimesheetEntry | null) {
  if (!entry) {
    return false;
  }

  return entry.lines.some(
    (line) =>
      Boolean(line.project.trim() || line.task.trim() || line.notes?.trim()) ||
      DAYS.some((day) => Boolean(line.workNotes?.[day.key]?.trim())) ||
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
  const [hoveredCell, setHoveredCell] = useState<{ lineId: string; day: DayKey } | null>(null);
  const [activeNoteCell, setActiveNoteCell] = useState<{ lineId: string; day: DayKey } | null>(null);
  const [submitChoiceOpen, setSubmitChoiceOpen] = useState(false);
  const [cellWorkNoteDraft, setCellWorkNoteDraft] = useState("");
  const [cellHoursDraft, setCellHoursDraft] = useState("");

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
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
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
  const taskWindowLookup = useMemo(
    () =>
      new Map(
        projectOptions.flatMap((project) =>
          project.tasks.map((task) => [task.id, { startDate: task.startDate, endDate: task.endDate }] as const),
        ),
      ),
    [projectOptions],
  );
  const summaryTaskLookup = useMemo(() => {
    const lookup = new Map<string, (typeof projectBudgetSummary)[number]["tasks"][number]>();

    for (const project of projectBudgetSummary) {
      for (const task of project.tasks ?? []) {
        lookup.set(task.id, task);
      }
    }

    return lookup;
  }, [projectBudgetSummary]);

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

  function getCurrentDraftTaskHours(
    taskId: string,
    taskWindow?: { startDate?: string; endDate?: string },
    excludeLineId?: string,
  ) {
    if (!draft) {
      return 0;
    }

    return draft.lines.reduce((sum, line) => {
      if (line.projectTaskId !== taskId || line.id === excludeLineId) {
        return sum;
      }

      return sum + lineHoursWithinTaskWindow(draft.weekStart, line, taskWindow);
    }, 0);
  }

  const persistedEmployeeTaskHours = useMemo(() => {
    const lookup = new Map<string, number>();

    for (const entry of timesheets) {
      if (entry.status === "rejected") {
        continue;
      }

      for (const line of entry.lines) {
        if (!line.projectTaskId) {
          continue;
        }

        lookup.set(
          line.projectTaskId,
          (lookup.get(line.projectTaskId) ?? 0) + lineHoursWithinTaskWindow(entry.weekStart, line, taskWindowLookup.get(line.projectTaskId)),
        );
      }
    }

    return lookup;
  }, [taskWindowLookup, timesheets]);

  function getTaskCapacitySnapshot(task?: ProjectCatalogTask) {
    if (!task || Number(task.maxHours ?? 0) <= 0) {
      return null;
    }

    const maxHours = Number(task.maxHours ?? 0);
    const summaryTask = summaryTaskLookup.get(task.id);
    const hourLimitScope = summaryTask?.hourLimitScope ?? task.hourLimitScope ?? "overall";
    const persistedCurrentEntryTaskHours =
      current?.lines.reduce((sum, line) => {
        if (line.projectTaskId !== task.id) {
          return sum;
        }

        return sum + lineHoursWithinTaskWindow(current.weekStart, line, task);
      }, 0) ?? 0;
    const overallUsed =
      typeof summaryTask?.usedHours === "number"
        ? summaryTask.usedHours
        : typeof summaryTask?.remainingHours === "number"
          ? Math.max(0, maxHours - summaryTask.remainingHours)
          : 0;
    const employeeUsed = persistedEmployeeTaskHours.get(task.id) ?? 0;
    const currentDraftHours = getCurrentDraftTaskHours(task.id, task);
    const baselineUsed = hourLimitScope === "per_employee" ? employeeUsed : overallUsed;
    const used = Number((baselineUsed - persistedCurrentEntryTaskHours + currentDraftHours).toFixed(2));
    const remaining = Math.max(0, Number((maxHours - used).toFixed(2)));

    return {
      maxHours,
      hourLimitScope,
      used,
      remaining,
      currentDraftHours: Number(currentDraftHours.toFixed(2)),
      startDate: summaryTask?.startDate ?? task.startDate,
      endDate: summaryTask?.endDate ?? task.endDate,
      durationDays: summaryTask?.durationDays ?? task.durationDays,
    };
  }

  const fieldControlClass =
    "h-10 w-full appearance-none rounded-[18px] border border-slate-200 bg-white px-4 pr-10 text-[15px] font-medium text-slate-700 shadow-none outline-none transition focus:border-sky-300/80 focus:ring-2 focus:ring-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100 dark:focus:border-sky-400/70";

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

  const monthEndMutation = useMutation({
    mutationFn: (entry: TimesheetEntry) => api.submitTimesheetMonthEnd(entry),
    onSuccess: (submittedEntry) => {
      setDraft(submittedEntry);
      syncTimesheetCache(submittedEntry);
      setSubmitChoiceOpen(false);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      const throughDate = submittedEntry.partialSubmission?.throughDate;
      toast({
        title: "Month-end days submitted",
        description: throughDate
          ? `Days through ${formatMonthEndDate(throughDate)} were sent for review. The rest of the week stays open.`
          : "Your month-end days were sent for review.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not submit month-end days",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const readOnly = draft?.status === "submitted" || draft?.status === "approved";
  const isRejected = draft?.status === "rejected";
  const canPersistDraft = hasDraftContent(draft);
  // Days in a pending or approved month-end submission are locked just like admin-locked days.
  const draftLocks = locksWithMonthEnd(draft);
  const monthEndCutoff = draft ? timesheetMonthEndCutoff(draft.weekStart) : null;
  const monthEndPartial = draft?.partialSubmission;
  const monthEndDays = new Set(monthEndLockedDays(draft));
  const monthEndHours =
    draft && monthEndCutoff
      ? dayKeysThrough(draft.weekStart, monthEndCutoff).reduce(
          (sum, day) => sum + draft.lines.reduce((lineSum, line) => lineSum + Number(line.hours[day] ?? 0), 0),
          0,
        )
      : 0;
  const canSubmitMonthEnd =
    Boolean(monthEndCutoff) && !readOnly && monthEndPartial?.status !== "submitted" && monthEndPartial?.status !== "approved";
  const submitPending = submitMutation.isPending || monthEndMutation.isPending;
  const submitButtonLabel =
    monthEndCutoff && monthEndPartial && monthEndPartial.status !== "rejected" && draft
      ? `Submit remaining days (${formatRemainingDays(draft.weekStart, monthEndCutoff)})`
      : "Submit for Review";
  const activeDayLocked = activeNoteCell
    ? isProtectedDayLocked(draft?.dailyReviewStatus, draft?.dailyReviewHolidays, draftLocks, activeNoteCell.day)
    : false;

  function lockedDayDescription(day: DayKey) {
    if (monthEndDays.has(day)) {
      return monthEndPartial?.status === "approved"
        ? "This day was approved for month-end payroll and can't be changed."
        : "This day is waiting for month-end review. You can change it only if your admin returns it.";
    }
    return "This day is protected by admin and cannot be edited.";
  }

  function goToWeek(date: Date) {
    setSelectedWeek(weekStartIso(date));
  }

  function updateLine(
    lineId: string,
    updater: (line: TimesheetTaskLine) => TimesheetTaskLine,
    options?: { resetReviewedDay?: DayKey },
  ) {
    setDraft((currentEntry) =>
      currentEntry
        ? {
            ...currentEntry,
            ...(options?.resetReviewedDay
              ? (() => {
                  const cleared = clearEditableDayReviewState(currentEntry.dailyReviewStatus, currentEntry.dailyReviewNotes, options.resetReviewedDay);
                  return {
                    dailyReviewStatus: cleared.status,
                    dailyReviewNotes: cleared.notes,
                  };
                })()
              : {
                  dailyReviewStatus: currentEntry.dailyReviewStatus,
                  dailyReviewNotes: currentEntry.dailyReviewNotes,
                }),
            lines: currentEntry.lines.map((line) => (line.id === lineId ? updater(line) : line)),
          }
        : currentEntry,
    );
  }

  const activeWorkNoteLine = useMemo(
    () => draft?.lines.find((line) => line.id === activeNoteCell?.lineId) ?? null,
    [activeNoteCell?.lineId, draft?.lines],
  );

  const activeWorkNoteDay = useMemo(
    () => weekDates.find((day) => day.key === activeNoteCell?.day) ?? null,
    [activeNoteCell?.day, weekDates],
  );

  function openWorkNoteDialog(line: TimesheetTaskLine, day: DayKey) {
    if (isProtectedDayLocked(draft?.dailyReviewStatus, draft?.dailyReviewHolidays, draftLocks, day)) {
      toast({
        title: "Day locked",
        description: lockedDayDescription(day),
      });
      return;
    }

    const hasDayScopedNotes = Boolean(normalizeWorkNotes(line.workNotes));
    setActiveNoteCell({ lineId: line.id, day });
    setCellHoursDraft(hourInputValue(Number(line.hours[day] ?? 0)));
    setCellWorkNoteDraft(line.workNotes?.[day]?.trim() ?? (!hasDayScopedNotes ? line.notes?.trim() ?? "" : ""));
  }

  function closeWorkNoteDialog() {
    setActiveNoteCell(null);
    setCellWorkNoteDraft("");
    setCellHoursDraft("");
  }

  function resolveHourValue(lineId: string, day: DayKey, rawValue: string, options?: { notify?: boolean }) {
    const requestedValue = rawValue === "" ? 0 : Math.max(0, Math.min(24, Number(rawValue || 0)));
    const targetLine = draft?.lines.find((line) => line.id === lineId);
    if (!targetLine) {
      return null;
    }
    const currentValue = Number(targetLine?.hours[day] ?? 0);
    const selectedTask =
      targetLine?.projectTaskId && targetLine.project.trim()
        ? getProjectTaskOptions(targetLine.project).find((option) => option.id === targetLine.projectTaskId)
        : undefined;
    const claimDate = weekDates.find((weekDay) => weekDay.key === day)?.date;
    if (requestedValue > 0 && claimDate && selectedTask && !isTaskWindowDay(selectedTask, claimDate)) {
      if (options?.notify !== false) {
        toast({
          title: "Task window closed for this day",
          description: `${selectedTask.name} can only be claimed ${formatTaskWindowLabel(selectedTask) ?? "inside its allowed date window"}.`,
          variant: "destructive",
        });
      }
      return null;
    }
    const taskSnapshot = getTaskCapacitySnapshot(selectedTask);
    const maxAvailableForCell = taskSnapshot ? Math.max(0, Number((taskSnapshot.remaining + currentValue).toFixed(2))) : 24;
    const nextValue = Math.max(0, Math.min(requestedValue, maxAvailableForCell, 24));

    if (requestedValue > nextValue && taskSnapshot && options?.notify !== false) {
      toast({
        title: "Task hour limit reached",
        description: `${targetLine?.task || "This task"} has ${formatHourValue(taskSnapshot.remaining)} remaining in its allocation window.`,
        variant: "destructive",
      });
    }

    return nextValue;
  }

  function saveWorkNote() {
    if (!activeWorkNoteLine || !activeNoteCell) {
      return;
    }

    if (isProtectedDayLocked(draft?.dailyReviewStatus, draft?.dailyReviewHolidays, draftLocks, activeNoteCell.day)) {
      toast({
        title: "Day locked",
        description: lockedDayDescription(activeNoteCell.day),
      });
      closeWorkNoteDialog();
      return;
    }

    const nextValue = resolveHourValue(activeWorkNoteLine.id, activeNoteCell.day, cellHoursDraft);
    if (nextValue === null) {
      return;
    }

    updateLine(
      activeWorkNoteLine.id,
      (line) =>
        updateLineDayWorkNote(
          {
            ...line,
            hours: {
              ...line.hours,
              [activeNoteCell.day]: nextValue,
            },
          },
          activeNoteCell.day,
          cellWorkNoteDraft,
        ),
      { resetReviewedDay: activeNoteCell.day },
    );
    closeWorkNoteDialog();
  }

  function changeHour(lineId: string, day: DayKey, rawValue: string) {
    if (isProtectedDayLocked(draft?.dailyReviewStatus, draft?.dailyReviewHolidays, draftLocks, day)) {
      toast({
        title: "Day locked",
        description: lockedDayDescription(day),
      });
      return;
    }

    const nextValue = resolveHourValue(lineId, day, rawValue);
    if (nextValue === null) {
      return;
    }

    updateLine(lineId, (line) => ({
      ...line,
      hours: {
        ...line.hours,
        [day]: nextValue,
      },
    }), { resetReviewedDay: day });
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
                {draft && monthEndPartial ? (
                  <Badge
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none",
                      statusBadgeClass(monthEndPartial.status),
                    )}
                  >
                    {formatMonthEndRange(draft.weekStart, monthEndPartial.throughDate)} · {statusLabel(monthEndPartial.status)}
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
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-sm shadow-sm dark:border-amber-500/15 dark:bg-amber-500/5">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-amber-200/70 bg-white/80 text-amber-500 shadow-none dark:border-amber-500/15 dark:bg-slate-950/70 dark:text-amber-300">
              <FilePenLine className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Changes requested</p>
              <p className="text-muted-foreground">{draft.reviewNotes}</p>
            </div>
          </div>
        ) : null}

        {draft && monthEndPartial?.status === "rejected" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-sm shadow-sm dark:border-amber-500/15 dark:bg-amber-500/5">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-amber-200/70 bg-white/80 text-amber-500 shadow-none dark:border-amber-500/15 dark:bg-slate-950/70 dark:text-amber-300">
              <FilePenLine className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Changes requested for {formatMonthEndRange(draft.weekStart, monthEndPartial.throughDate)}
              </p>
              {monthEndPartial.reviewNotes ? <p className="text-muted-foreground">{monthEndPartial.reviewNotes}</p> : null}
              <p className="text-xs text-muted-foreground">Update those days, then submit them again.</p>
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
                <table className="w-full min-w-[1120px] table-fixed border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-secondary/10 text-left text-sm text-muted-foreground">
                      <th className="sticky left-0 z-30 w-[206px] min-w-[206px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                        Project
                      </th>
                      <th className="sticky left-[206px] z-30 w-[252px] min-w-[252px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                        Task
                      </th>
                      {weekDates.map((day) => {
                        const calendarDay = weekCalendarLookup.get(day.date.toISOString().slice(0, 10));
                        const isCalendarHoliday = Boolean(calendarDay?.holiday);
                        const isAdminHoliday = draft?.dailyReviewHolidays?.[day.key] === true;
                        const isAdminLocked = draft?.dailyReviewLocks?.[day.key] === true;
                        const isLeave = Boolean(calendarDay?.leave);
                        const isPending = calendarDay?.leaveStatus === "pending";
                        const dayReviewState = draft?.dailyReviewStatus?.[day.key];
                        const dayReviewNote = draft?.dailyReviewNotes?.[day.key]?.trim() ?? "";
                        const isDayReviewed = dayReviewState === "reviewed";
                        const isDayReverted = dayReviewState === "reverted";
                        const monthEndState = monthEndDays.has(day.key) ? monthEndPartial?.status : undefined;
                        const dayStatus = isAdminHoliday
                          ? "Holiday"
                          : isDayReviewed
                            ? "Verified"
                            : isDayReverted
                              ? "Returned"
                              : monthEndState === "approved"
                                ? "Approved"
                                : monthEndState === "submitted"
                                  ? "Submitted"
                                  : isAdminLocked
                                    ? "Locked"
                                    : "Work";
                        const dayStatusClass = isAdminHoliday
                          ? "text-emerald-300"
                          : isDayReviewed
                          ? "text-emerald-400"
                          : isDayReverted
                            ? "text-rose-300/80"
                            : monthEndState === "approved"
                              ? "text-emerald-400"
                              : monthEndState === "submitted"
                                ? "text-sky-300"
                                : isAdminLocked
                                  ? "text-slate-400"
                                  : "text-muted-foreground";

                        return (
                          <th
                            key={day.key}
                            className={cn(
                              "relative w-[76px] min-w-[76px] border-b border-r border-border/50 px-2 py-2 text-center font-medium last:border-r-0",
                              (isCalendarHoliday || isAdminHoliday) && "bg-emerald-500/5",
                              isLeave && "bg-amber-500/5",
                              isPending && "bg-sky-500/5",
                            )}
                          >
                            {isAdminHoliday ? <span className="absolute inset-x-0 top-0 h-1 bg-emerald-500/85" /> : null}
                            {!isAdminHoliday && isDayReviewed ? <span className="absolute inset-x-0 top-0 h-1 bg-emerald-400/80" /> : null}
                            {!isAdminHoliday && isDayReverted ? <span className="absolute inset-x-0 top-0 h-1 bg-rose-400/70" /> : null}
                            {isAdminHoliday || isDayReviewed || isDayReverted || isAdminLocked ? (
                              <HoverCard openDelay={120} closeDelay={80}>
                                <HoverCardTrigger asChild>
                                  <div className="space-y-0.5 pt-0.5">
                                    <p className="text-[15px] font-medium leading-tight">{day.label}</p>
                                    <p className="text-[11px] font-normal leading-tight text-muted-foreground">{format(day.date, "dd MMM")}</p>
                                    <p className={cn("text-[10px] font-medium", dayStatusClass)}>{dayStatus}</p>
                                  </div>
                                </HoverCardTrigger>
                                <HoverCardContent
                                  side="top"
                                  sideOffset={8}
                                  className={cn(
                                    "w-[240px] rounded-xl border px-3 py-2 text-left text-xs shadow-sm",
                                    isAdminHoliday
                                      ? "border-emerald-200/70 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100"
                                      : isDayReviewed
                                      ? "border-emerald-200/70 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100"
                                      : isAdminLocked
                                        ? "border-slate-300/70 bg-slate-50 text-slate-900 dark:border-slate-500/20 dark:bg-slate-900 dark:text-slate-100"
                                        : "border-rose-200/50 bg-background/95 text-foreground dark:border-rose-500/15 dark:bg-slate-950/95 dark:text-slate-100",
                                  )}
                                >
                                  <p
                                    className={cn(
                                      "text-[11px] font-semibold uppercase tracking-[0.16em]",
                                      isAdminHoliday
                                        ? "text-emerald-600 dark:text-emerald-300"
                                        : isDayReviewed
                                          ? "text-emerald-600 dark:text-emerald-300"
                                          : isAdminLocked
                                            ? "text-slate-600 dark:text-slate-300"
                                            : "text-rose-500 dark:text-rose-300",
                                    )}
                                  >
                                    {isAdminHoliday
                                      ? "Day marked as holiday"
                                      : isDayReviewed
                                        ? "Day verified by admin"
                                        : isAdminLocked
                                          ? "Day locked by admin"
                                          : "Returned for changes"}
                                  </p>
                                  <p className="mt-1 whitespace-pre-line leading-5 text-muted-foreground dark:text-slate-300">
                                    {isAdminHoliday
                                      ? "This day is treated as a holiday. It shows as H and cannot be edited."
                                      : isDayReviewed
                                      ? "This day was verified by the admin and is ready for the employee to continue working from."
                                      : isAdminLocked
                                        ? "This day was locked by the admin and cannot be edited."
                                        : dayReviewNote || "The admin returned this day for changes."}
                                  </p>
                                </HoverCardContent>
                              </HoverCard>
                            ) : (
                              <div className="space-y-0.5 pt-0.5">
                                <p className="text-[15px] font-medium leading-tight">{day.label}</p>
                                <p className="text-[11px] font-normal leading-tight text-muted-foreground">{format(day.date, "dd MMM")}</p>
                                {isCalendarHoliday ? (
                                  <p className="text-[10px] font-medium text-emerald-300">{calendarDay?.holidayName ?? "Holiday"}</p>
                                ) : isPending ? (
                                  <p className="text-[10px] font-medium text-sky-300">Pending</p>
                                ) : isLeave ? (
                                  <p className="text-[10px] font-medium text-amber-300">Leave</p>
                                ) : (
                                  <p className="text-[10px] font-medium text-muted-foreground">Work</p>
                                )}
                              </div>
                            )}
                          </th>
                        );
                      })}
                      <th className="w-[88px] min-w-[88px] border-b border-r border-border/50 px-2 py-3 text-center font-medium text-foreground">
                        Total
                      </th>
                      <th className="w-[88px] min-w-[88px] border-b border-border/50 px-2 py-3 text-right font-medium text-foreground">
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
                      const rowHasProtectedContent = lineHasProtectedDayContent(
                        line,
                        draft.dailyReviewStatus,
                        draft.dailyReviewHolidays,
                        draftLocks,
                      );
                      const rowEditDisabled = readOnly || rowHasProtectedContent;

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
                                <div className="relative">
                                  <select
                                    value={projectSelectionValue}
                                    disabled={rowEditDisabled}
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
                                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                </div>
                              ) : null}
                              {showProjectInput ? (
                                <Input
                                  value={line.project}
                                  placeholder="Project name"
                                  disabled={rowEditDisabled}
                                  className="h-10 rounded-[18px] border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-700 shadow-none dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100"
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
                          <td className="sticky left-[206px] z-20 border-b border-r border-border/50 bg-card px-4 py-3 align-top">
                            <div className="space-y-2">
                              {hasProjectValue ? (
                                projectTaskOptions.length > 0 ? (
                                  <>
                                    <div className="min-w-0 flex-1 space-y-2">
                                      <div className="relative">
                                        <select
                                          value={taskSelectionValue}
                                          disabled={rowEditDisabled}
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
                                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                      </div>
                                      {showTaskInput ? (
                                        <Input
                                          value={line.task}
                                          placeholder="Custom task name"
                                          disabled={rowEditDisabled}
                                          className="h-10 rounded-[18px] border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-700 shadow-none dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100"
                                          onChange={(event) =>
                                            updateLine(line.id, (currentLine) => ({
                                              ...currentLine,
                                              task: event.target.value,
                                              projectTaskId: undefined,
                                            }))
                                          }
                                        />
                                      ) : null}
                                    </div>
                                    {taskCapacity ? (
                                      <div className="rounded-xl border border-border/45 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">
                                          Remaining: {formatHourValue(taskCapacity.remaining)}
                                        </span>
                                        {" | "}
                                        <span>
                                          Used: {formatHourValue(taskCapacity.currentDraftHours)}
                                        </span>
                                      </div>
                                    ) : null}
                                    {selectedTaskSubTasks.length > 0 ? (
                                      <div className="space-y-1.5">
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sub task</p>
                                        <div className="relative">
                                          <select
                                            value={line.subTask ?? ""}
                                            disabled={rowEditDisabled}
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
                                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        </div>
                                      </div>
                                    ) : null}
                                  </>
                              ) : (
                                <Input
                                  value={line.task}
                                  placeholder="Custom task name"
                                  disabled={rowEditDisabled}
                                          className="h-10 rounded-[18px] border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-700 shadow-none dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100"
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
                                        <div className="flex h-10 items-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 text-[15px] font-medium text-slate-500 dark:border-slate-700/90 dark:bg-slate-950/90 dark:text-slate-400">
                                          Choose a project first
                                        </div>
                              )}
                            </div>
                          </td>
                          {weekDates.map((day) => (
                        (() => {
                          const calendarDay = weekCalendarLookup.get(day.date.toISOString().slice(0, 10));
                          const isAdminHoliday = draft.dailyReviewHolidays?.[day.key] === true;
                          const isHoliday = Boolean(calendarDay?.holiday || isAdminHoliday);
                          const isOffDay = Boolean(isHoliday || calendarDay?.leave || calendarDay?.leaveStatus === "pending");
                          const outsideTaskWindow = selectedTask ? !isTaskWindowDay(selectedTask, day.date) : false;
                          const hasExistingHours = Number(line.hours[day.key] ?? 0) > 0;
                          const workNotePreview = line.workNotes?.[day.key]?.trim() ?? "";
                          const blockTaskWindowDay = outsideTaskWindow && !hasExistingHours;
                          const dayLocked = isProtectedDayLocked(
                            draft.dailyReviewStatus,
                            draft.dailyReviewHolidays,
                            draftLocks,
                            day.key,
                          );
                          const placeholder = isHoliday
                            ? "H"
                            : calendarDay?.holiday
                            ? calendarDay.holidayName ?? "Holiday"
                            : calendarDay?.leaveStatus === "pending"
                              ? "Pending"
                              : calendarDay?.leave
                                ? "Leave"
                                : outsideTaskWindow
                                  ? "Window"
                                : "0";
                          return (
                            <td
                              key={day.key}
                              className={cn(
                                "border-b border-r border-border/50 px-3 py-3 align-top transition-colors",
                                day.key === "sat" || day.key === "sun" ? "bg-secondary/5" : "",
                                isOffDay && "bg-secondary/10",
                                outsideTaskWindow && "bg-secondary/10",
                                dayLocked && "bg-emerald-50/70 dark:bg-emerald-500/5",
                              )}
                              onMouseEnter={() => setHoveredCell({ lineId: line.id, day: day.key })}
                              onMouseLeave={() =>
                                setHoveredCell((currentCell) =>
                                  currentCell?.lineId === line.id && currentCell.day === day.key ? null : currentCell,
                                )
                              }
                            >
                              <div className="mx-auto flex h-[40px] w-full items-center justify-center">
                                {isHoliday ? (
                                  <div className="flex h-[40px] w-[58px] items-center justify-center rounded-[16px] border border-emerald-200/80 bg-emerald-50 text-sm font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                                    H
                                  </div>
                                ) : workNotePreview ? (
                                  <HoverCard openDelay={120} closeDelay={80}>
                                    <HoverCardTrigger asChild>
                                      <div className="relative">
                                        <Input
                                          type="text"
                                          inputMode="decimal"
                                          disabled={readOnly || dayLocked || isOffDay || blockTaskWindowDay}
                                          className={cn(
                                            "h-[40px] w-[58px] rounded-[16px] border border-slate-200/90 bg-white px-2 pb-[5px] pt-0 text-center text-[0.95rem] font-medium leading-none text-slate-700 shadow-none transition focus-visible:border-sky-400/50 focus-visible:ring-4 focus-visible:ring-sky-500/10 dark:border-[#1a1f2e] dark:bg-slate-950/90 dark:text-slate-100 dark:focus-visible:border-sky-400/70",
                                            (readOnly || dayLocked || isOffDay || blockTaskWindowDay) && "bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500",
                                            workNotePreview && "border-sky-200 dark:border-sky-500/40",
                                          )}
                                          placeholder={placeholder}
                                          value={hourInputValue(line.hours[day.key])}
                                          onChange={(event) => {
                                            if (!isHourInputDraft(event.target.value)) {
                                              return;
                                            }
                                            changeHour(line.id, day.key, event.target.value);
                                          }}
                                        />
                                        <button
                                          type="button"
                                          className="absolute inset-x-0 bottom-[4px] flex h-3 items-center justify-center"
                                          onClick={() => openWorkNoteDialog(line, day.key)}
                                          aria-label={`Edit work note for ${day.label}`}
                                          disabled={readOnly || dayLocked}
                                        >
                                          <span className="block aspect-square h-[6px] rounded-full bg-[#2F80FF]" />
                                        </button>
                                      </div>
                                    </HoverCardTrigger>
                                    <HoverCardContent
                                      side="bottom"
                                      sideOffset={10}
                                      className="pointer-events-none relative w-[248px] rounded-[18px] border border-slate-800/90 bg-slate-900 px-4 py-3 text-white shadow-[0_18px_36px_rgba(15,23,42,0.35)]"
                                    >
                                      <span className="absolute -top-[5px] left-1/2 h-[10px] w-[10px] -translate-x-1/2 rotate-45 border-l border-t border-slate-800/90 bg-slate-900" />
                                      <p className="text-[13px] font-semibold tracking-[0.01em] text-white">Work Note</p>
                                      <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-slate-200">
                                        {workNotePreview}
                                      </p>
                                    </HoverCardContent>
                                  </HoverCard>
                                ) : blockTaskWindowDay ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="relative">
                                        <Input
                                          type="text"
                                          inputMode="decimal"
                                          disabled
                                          className="h-[40px] w-[58px] rounded-[16px] border border-slate-200/90 bg-slate-50 px-2 pb-[5px] pt-0 text-center text-[0.95rem] font-medium leading-none text-slate-400 shadow-none dark:border-[#1a1f2e] dark:bg-slate-900 dark:text-slate-500"
                                          placeholder={placeholder}
                                          value={hourInputValue(line.hours[day.key])}
                                          readOnly
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" sideOffset={8} className="max-w-[220px] text-center">
                                      {selectedTask?.startDate && selectedTask?.endDate
                                        ? `Task window: ${format(new Date(`${selectedTask.startDate}T12:00:00Z`), "MMM d, yyyy")} – ${format(new Date(`${selectedTask.endDate}T12:00:00Z`), "MMM d, yyyy")}`
                                        : "Outside task window"}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <div className="relative">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      disabled={readOnly || dayLocked || isOffDay}
                                      className={cn(
                                        "h-[40px] w-[58px] rounded-[16px] border border-slate-200/90 bg-white px-2 pb-[5px] pt-0 text-center text-[0.95rem] font-medium leading-none text-slate-700 shadow-none transition focus-visible:border-sky-400/50 focus-visible:ring-4 focus-visible:ring-sky-500/10 dark:border-[#1a1f2e] dark:bg-slate-950/90 dark:text-slate-100 dark:focus-visible:border-sky-400/70",
                                        (readOnly || dayLocked || isOffDay) && "bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500",
                                      )}
                                      placeholder={placeholder}
                                      value={hourInputValue(line.hours[day.key])}
                                      onChange={(event) => {
                                        if (!isHourInputDraft(event.target.value)) {
                                          return;
                                        }
                                        changeHour(line.id, day.key, event.target.value);
                                      }}
                                    />
                                    {hoveredCell?.lineId === line.id && hoveredCell.day === day.key && !readOnly && !dayLocked && !isOffDay ? (
                                      <button
                                        type="button"
                                        className="absolute inset-x-0 bottom-[4px] flex h-3 items-center justify-center text-slate-200 transition hover:text-slate-400"
                                        onClick={() => openWorkNoteDialog(line, day.key)}
                                        aria-label={`Add work note for ${day.label}`}
                                      >
                                        <Plus className="h-2.5 w-2.5" />
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
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
                                disabled={rowEditDisabled}
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
                                disabled={rowEditDisabled}
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
                          className="border-r border-border/50 px-3 py-4 text-center text-sm font-medium text-foreground"
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
          <Popover
            open={submitChoiceOpen && canSubmitMonthEnd}
            onOpenChange={(open) => {
              if (!submitPending) setSubmitChoiceOpen(open && canSubmitMonthEnd);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                size="sm"
                className="h-9 rounded-xl border border-sky-400/20 bg-sky-500 text-white shadow-sm hover:bg-sky-500/90"
                disabled={!draft || readOnly || draftHours <= 0 || submitPending}
                onClick={() => {
                  // On a week that runs into a new month the popover handles the choice instead.
                  if (draft && !canSubmitMonthEnd) submitMutation.mutate(draft);
                }}
              >
                {isRejected ? <FilePenLine className="mr-2 h-4 w-4" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
                {submitButtonLabel}
              </Button>
            </PopoverTrigger>
            {draft && monthEndCutoff ? (
              <PopoverContent
                side="top"
                align="end"
                sideOffset={12}
                className="w-[224px] rounded-2xl border-border/50 bg-card p-1.5 shadow-2xl shadow-black/30"
              >
                <SubmitChoiceOption
                  label="Submit full week"
                  range={formatWeekSpan(draft.weekStart)}
                  disabled={submitPending}
                  onSelect={() => {
                    setSubmitChoiceOpen(false);
                    submitMutation.mutate(draft);
                  }}
                />
                <SubmitChoiceOption
                  label="Submit till month end"
                  range={formatMonthEndRange(draft.weekStart, monthEndCutoff)}
                  disabled={submitPending || monthEndHours <= 0}
                  title={monthEndHours <= 0 ? `Log hours through ${formatMonthEndDate(monthEndCutoff)} first` : undefined}
                  onSelect={() => monthEndMutation.mutate(draft)}
                />
              </PopoverContent>
            ) : null}
          </Popover>
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

      <Dialog open={Boolean(activeNoteCell)} onOpenChange={(open) => !open && closeWorkNoteDialog()}>
        <DialogContent
          overlayClassName="bg-slate-950/24 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
          className="max-w-[456px] rounded-[24px] border border-slate-200 bg-white p-0 shadow-[0_22px_58px_rgba(15,23,42,0.14)] [&>button]:hidden"
        >
          <div className="space-y-5 p-6 sm:p-7">
            <DialogHeader className="space-y-0 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-sky-50 text-[#2F80FF]">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <div className="space-y-3 pt-0.5">
                    <DialogTitle className="text-[1.25rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[1.45rem]">
                      {activeWorkNoteDay ? format(activeWorkNoteDay.date, "EEE, dd MMM yyyy") : "Work Note"}
                    </DialogTitle>
                    <div className="grid gap-x-4 gap-y-1.5 text-[15px] text-slate-700 sm:grid-cols-[64px_minmax(0,1fr)]">
                      <span className="font-medium text-slate-500">Project</span>
                      <span className="truncate font-semibold text-slate-800">{activeWorkNoteLine?.project?.trim() || "Custom project"}</span>
                      <span className="font-medium text-slate-500">Task</span>
                      <span className="font-semibold text-slate-800">
                        {activeWorkNoteLine?.task?.trim() || "Custom task"}
                        {activeWorkNoteLine?.subTask ? ` - ${activeWorkNoteLine.subTask}` : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  onClick={closeWorkNoteDialog}
                >
                  <X className="h-5 w-5" />
                  <span className="sr-only">Close work note</span>
                </Button>
              </div>
            </DialogHeader>

            <div className="space-y-2.5">
              <label className="text-[15px] font-semibold text-slate-700">
                Hours <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={cellHoursDraft}
                  onChange={(event) => {
                    if (!isHourInputDraft(event.target.value)) {
                      return;
                    }
                    setCellHoursDraft(event.target.value);
                  }}
                  disabled={readOnly || activeDayLocked}
                  className="h-11 rounded-[16px] border-slate-200 bg-white pr-11 text-[15px] font-medium text-slate-800 shadow-none focus-visible:border-sky-400/50 focus-visible:ring-4 focus-visible:ring-sky-500/10"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base font-medium text-slate-400">h</span>
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="text-[15px] font-semibold text-slate-700">
                Work Note <span className="text-rose-400">*</span>
              </label>
              <Textarea
                value={cellWorkNoteDraft}
                onChange={(event) => setCellWorkNoteDraft(event.target.value.slice(0, 500))}
                placeholder="Describe the work completed, key update, or specific output for this task."
                className="min-h-[136px] rounded-[16px] border-slate-200 bg-white px-4 py-3 text-[15px] leading-7 text-slate-700 shadow-none placeholder:text-slate-400 focus-visible:border-sky-400/50 focus-visible:ring-4 focus-visible:ring-sky-500/10"
                disabled={readOnly || activeDayLocked}
              />
              <p className="text-right text-sm font-medium text-slate-400">{cellWorkNoteDraft.length} / 500</p>
            </div>

            <DialogFooter className="flex-row justify-end gap-3 pt-1 space-x-0">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-w-[132px] rounded-[16px] border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-none hover:bg-slate-50"
                onClick={closeWorkNoteDialog}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-11 min-w-[164px] rounded-[16px] border border-[#1667ff]/10 bg-[linear-gradient(135deg,#2f80ff_0%,#1667ff_100%)] px-6 text-base font-semibold text-white shadow-[0_14px_26px_rgba(22,103,255,0.24)] hover:brightness-[1.02]"
                onClick={saveWorkNote}
                disabled={readOnly || activeDayLocked}
              >
                Save
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

