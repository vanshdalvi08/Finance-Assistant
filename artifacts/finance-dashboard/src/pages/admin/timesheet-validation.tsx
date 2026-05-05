import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { CalendarDays, Check, CheckCircle2, ClipboardList, Eye, FileText, RefreshCcw, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type DayKey, type Employee, type ProjectBudgetTask, type TimesheetEntry, type TimesheetTaskLine } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const READONLY_FIELD_CLASS =
  "flex h-10 items-center rounded-[18px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-700 shadow-none dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100";
const READONLY_FIELD_STACK_CLASS =
  "rounded-[18px] border border-slate-200 bg-white px-4 py-2 text-[15px] font-medium text-slate-700 shadow-none dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-100";
const READONLY_PLACEHOLDER_CLASS =
  "flex h-10 items-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 text-[15px] font-medium text-slate-500 dark:border-slate-700/90 dark:bg-slate-950/90 dark:text-slate-400";

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

function taskLineDisplayLabel(
  line: { task?: string; subTask?: string; projectTaskId?: string },
  taskCatalogLookup?: Map<string, ProjectBudgetTask>,
) {
  const catalogTask = line.projectTaskId ? taskCatalogLookup?.get(line.projectTaskId) : undefined;
  if (catalogTask) {
    const taskName = catalogTask.name?.trim() || line.task?.trim() || "Custom task";
    const taskDescription = catalogTask.description?.trim() || line.subTask?.trim() || "";
    return taskDescription ? `${taskName} - ${taskDescription}` : taskName;
  }

  return taskLineLabel(line);
}

function taskLineDisplayParts(
  line: { task?: string; subTask?: string; projectTaskId?: string },
  taskCatalogLookup?: Map<string, ProjectBudgetTask>,
) {
  const catalogTask = line.projectTaskId ? taskCatalogLookup?.get(line.projectTaskId) : undefined;
  const taskName = catalogTask?.name?.trim() || line.task?.trim() || "Custom task";
  const taskDescription = catalogTask?.description?.trim() || line.subTask?.trim() || "";

  return { taskName, taskDescription };
}

function formatHourValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0h";
  }

  return `${Number(value.toFixed(1)).toString()}h`;
}

function formatHourCellValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return Number(value.toFixed(1)).toString();
}

function normalizeText(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function lineWorkNoteSummary(line: TimesheetTaskLine) {
  const inlineNote = line.notes?.trim();
  if (inlineNote) {
    return inlineNote;
  }

  const perDayNotes = DAYS.map((day) => {
    const note = line.workNotes?.[day]?.trim();
    return note ? `${DAY_LABELS[day]}: ${note}` : null;
  }).filter((value): value is string => Boolean(value));

  return perDayNotes.join(" | ");
}

function dayWorkNote(line: TimesheetTaskLine, day: DayKey) {
  return line.workNotes?.[day]?.trim() ?? "";
}

function lineHasContent(line: TimesheetTaskLine) {
  return Boolean(
    line.project.trim() ||
      line.task.trim() ||
      lineWorkNoteSummary(line) ||
      DAYS.some((day) => Number(line.hours[day] ?? 0) > 0),
  );
}

function timesheetHasDisplayContent(entry: TimesheetEntry) {
  return entry.lines.some((line) => lineHasContent(line));
}

function includesDateInWeek(weekStart: string, selectedDate: string) {
  const start = format(new Date(weekStart), "yyyy-MM-dd");
  const end = format(addDays(new Date(weekStart), 6), "yyyy-MM-dd");
  return selectedDate >= start && selectedDate <= end;
}

function statusBadgeTone(status: TimesheetEntry["status"]) {
  if (status === "approved") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "submitted") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-300";
  }

  if (status === "rejected") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }

  return "border-border/60 bg-secondary/40 text-muted-foreground";
}

function statusLabel(status: TimesheetEntry["status"]) {
  if (status === "approved") return "Approved";
  if (status === "submitted") return "Submitted";
  if (status === "rejected") return "Returned";
  return "Draft";
}

function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "EM";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
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

function AdminReadonlyTimesheetCard({
  entry,
  employee,
  selectedDate,
  taskCatalogLookup,
  pendingReviewKey,
  onMarkDayReviewed,
  onRequestDayUnverify,
  onRequestDayRevert,
}: {
  entry: TimesheetEntry;
  employee?: Employee;
  selectedDate: string;
  taskCatalogLookup?: Map<string, ProjectBudgetTask>;
  pendingReviewKey?: string | null;
  onMarkDayReviewed: (day: DayKey) => void;
  onRequestDayUnverify: (day: DayKey) => void;
  onRequestDayRevert: (day: DayKey) => void;
}) {
  const weekDays = DAYS.map((day, index) => {
    const date = addDays(new Date(entry.weekStart), index);
    return {
      key: day,
      label: DAY_LABELS[day],
      date,
    };
  });
  const selectedDayKey = weekDays.find((day) => format(day.date, "yyyy-MM-dd") === selectedDate)?.key ?? null;
  const displayLines = entry.lines.filter((line) => lineHasContent(line));
  const dayTotals = DAYS.map((day) => ({
    key: day,
    total: displayLines.reduce((sum, line) => sum + Number(line.hours[day] ?? 0), 0),
  }));
  const totalHours = displayLines.reduce((sum, line) => sum + lineTotal(line), 0);

  return (
    <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
      <CardHeader className="border-b border-border/50 pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
              {initialsFromName(entry.employeeNameSnapshot)}
            </div>
            <div className="space-y-1">
              <CardTitle className="text-[1.05rem] font-medium tracking-[-0.01em] text-foreground">
                {entry.employeeNameSnapshot}
              </CardTitle>
              <CardDescription className="text-[0.95rem] text-muted-foreground">
                {employee?.department?.trim() || "General"} <span className="px-1.5">-</span> {weekLabel(entry.weekStart)}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Badge className={cn("rounded-full border px-3 py-1 text-[11px] font-medium shadow-none", statusBadgeTone(entry.status))}>
              {statusLabel(entry.status)}
            </Badge>
            <Badge className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium text-foreground shadow-none">
              {formatHourValue(totalHours)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {displayLines.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">No saved timesheet content for this employee on the selected date.</div>
        ) : (
          <div className="timesheet-scroll overflow-x-auto">
            <table className="w-full min-w-[1030px] table-fixed border-separate border-spacing-0">
              <thead>
                <tr className="bg-secondary/10 text-left text-sm text-muted-foreground">
                  <th className="sticky left-0 z-20 w-[222px] min-w-[222px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                    Project
                  </th>
                  <th className="sticky left-[222px] z-20 w-[230px] min-w-[230px] border-b border-r border-border/50 bg-card px-4 py-3 font-medium text-foreground">
                    Task
                  </th>
                  {weekDays.map((day) => {
                    const dayReviewState = entry.dailyReviewStatus?.[day.key];
                    const dayReviewNote = entry.dailyReviewNotes?.[day.key]?.trim() ?? "";
                    const isReviewed = dayReviewState === "reviewed";
                    const isReverted = dayReviewState === "reverted";
                    const toggleKey = `${entry.id}:${day.key}`;
                    const isPending = pendingReviewKey === toggleKey;
                    const fullDayName = format(day.date, "EEEE");

                    return (
                      <th
                        key={day.key}
                        className={cn(
                          "group relative w-[76px] min-w-[76px] border-b border-r border-border/50 px-2 py-3 text-center font-medium last:border-r-0",
                          day.key === selectedDayKey && "bg-sky-500/5",
                        )} 
                      >
                        {isReviewed ? <span className="absolute inset-x-0 top-0 h-1 bg-emerald-400/85" /> : null}
                        {isReverted ? <span className="absolute inset-x-0 top-0 h-1 bg-rose-400/70" /> : null}
                        <div className="space-y-1">
                          <div className="flex justify-center gap-1.5">
                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isReviewed) {
                                      onRequestDayUnverify(day.key);
                                      return;
                                    }

                                    if (!isReviewed) {
                                      onMarkDayReviewed(day.key);
                                    }
                                  }}
                                  disabled={isPending}
                                  aria-label={isReviewed ? "Undo review" : `Mark ${fullDayName} as reviewed`}
                                  className={cn(
                                    "group flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-200 ease-out motion-safe:transform-gpu will-change-transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95",
                                    isReviewed
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                      : "border-slate-200/90 bg-white/90 text-slate-300 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-500 dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-600 dark:hover:border-sky-500/30 dark:hover:bg-sky-500/10 dark:hover:text-sky-300",
                                    isPending && "opacity-60",
                                  )}
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent
                                side="top"
                                sideOffset={8}
                                className={cn(
                                  "w-auto rounded-xl px-3 py-2 text-xs",
                                  isReviewed
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100"
                                    : "",
                                )}
                              >
                                {isReviewed ? "Undo review" : `Mark ${fullDayName} as reviewed`}
                              </HoverCardContent>
                            </HoverCard>

                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRequestDayRevert(day.key);
                                  }}
                                  disabled={isPending}
                                  aria-label="Return to employee with note"
                                  className={cn(
                                    "group flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-200 ease-out motion-safe:transform-gpu will-change-transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95",
                                    isReviewed || isReverted
                                      ? "border-rose-100 bg-rose-50/55 text-rose-400 hover:border-rose-200 hover:bg-rose-50/80 hover:text-rose-500 dark:border-rose-500/15 dark:bg-rose-500/8 dark:text-rose-300 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/12 dark:hover:text-rose-200"
                                      : "border-slate-200/90 bg-white/90 text-slate-300 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-600 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300",
                                    isPending && "opacity-60",
                                  )}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent
                                side="top"
                                sideOffset={8}
                                className={cn(
                                  "w-auto rounded-xl px-3 py-2 text-xs",
                                  isReviewed || isReverted
                                    ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100"
                                    : "",
                                )}
                              >
                                {isReviewed
                                  ? dayReviewNote || "Return to employee with a note"
                                  : isReverted
                                    ? dayReviewNote || "Returned for changes"
                                    : "Return to employee with a note"}
                              </HoverCardContent>
                            </HoverCard>
                          </div>
                          <p>{day.label}</p>
                          <p className="text-[11px] font-normal text-muted-foreground">{format(day.date, "dd MMM")}</p>
                          <p className={cn("text-[10px] font-medium", isReverted ? "text-rose-400" : "text-muted-foreground")}>{isReverted ? "Returned" : "Work"}</p>
                        </div>
                      </th>
                    );
                  })}
                  <th className="w-[88px] min-w-[88px] border-b border-border/50 px-2 py-3 text-center font-medium text-foreground">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {displayLines.map((line) => (
                  <tr key={line.id}>
                    <td className="sticky left-0 z-10 border-b border-r border-border/50 bg-card px-4 py-3 align-top">
                      <div className={line.project.trim() ? READONLY_FIELD_CLASS : READONLY_PLACEHOLDER_CLASS}>
                        {line.project.trim() || "Custom project"}
                      </div>
                    </td>
                    <td className="sticky left-[222px] z-10 border-b border-r border-border/50 bg-card px-4 py-3 align-top">
                      <div className={taskLineDisplayLabel(line, taskCatalogLookup).trim() ? READONLY_FIELD_STACK_CLASS : READONLY_PLACEHOLDER_CLASS}>
                        {(() => {
                          const { taskName, taskDescription } = taskLineDisplayParts(line, taskCatalogLookup);
                          return (
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{taskName}</p>
                              {taskDescription ? <p className="truncate text-xs text-muted-foreground">{taskDescription}</p> : null}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    {weekDays.map((day) => {
                      const workNotePreview = dayWorkNote(line, day.key);
                      const cellContent = (
                        <div
                          className={cn(
                            "relative flex h-[40px] w-[58px] items-center justify-center rounded-[16px] border border-slate-200/90 bg-white px-2 text-center text-[0.95rem] font-medium leading-none text-slate-700 shadow-none dark:border-[#1a1f2e] dark:bg-slate-950/90 dark:text-slate-100",
                            workNotePreview && "border-sky-200 dark:border-sky-500/40",
                          )}
                        >
                          <span className="translate-y-[-1px]">{formatHourCellValue(Number(line.hours[day.key] ?? 0))}</span>
                          {workNotePreview ? (
                            <span className="absolute inset-x-0 bottom-[2px] flex h-3 items-center justify-center">
                              <span className="block aspect-square h-[6px] rounded-full bg-[#2F80FF]" />
                            </span>
                          ) : null}
                        </div>
                      );

                      return (
                        <td
                          key={day.key}
                          className={cn(
                            "border-b border-r border-border/50 px-3 py-3 align-top",
                            day.key === "sat" || day.key === "sun" ? "bg-secondary/5" : "",
                            day.key === selectedDayKey && "bg-sky-500/5",
                          )}
                        >
                          <div className="mx-auto flex h-[40px] w-full items-center justify-center">
                            {workNotePreview ? (
                              <HoverCard openDelay={120} closeDelay={80}>
                                <HoverCardTrigger asChild>{cellContent}</HoverCardTrigger>
                                <HoverCardContent
                                  side="bottom"
                                  sideOffset={10}
                                  className="pointer-events-none relative w-[248px] rounded-[18px] border border-slate-800/90 bg-slate-900 px-4 py-3 text-white shadow-[0_18px_36px_rgba(15,23,42,0.35)]"
                                >
                                  <span className="absolute -top-[5px] left-1/2 h-[10px] w-[10px] -translate-x-1/2 rotate-45 border-l border-t border-slate-800/90 bg-slate-900" />
                                  <p className="text-[13px] font-semibold tracking-[0.01em] text-white">Work Note</p>
                                  <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-slate-200">{workNotePreview}</p>
                                </HoverCardContent>
                              </HoverCard>
                            ) : (
                              cellContent
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-b border-border/50 px-3 py-3 text-center align-middle font-medium text-foreground">
                      {formatHourValue(lineTotal(line))}
                    </td>
                  </tr>
                ))}

                <tr className="bg-secondary/10">
                  <td className="sticky left-0 z-10 border-r border-border/50 bg-card px-4 py-4 text-sm font-medium text-foreground">Day Totals</td>
                  <td className="sticky left-[222px] z-10 border-r border-border/50 bg-card px-4 py-4 text-sm text-muted-foreground">Read-only employee view</td>
                  {dayTotals.map((day) => (
                    <td
                      key={day.key}
                      className={cn(
                        "border-r border-border/50 px-3 py-4 text-center text-sm font-medium text-foreground",
                        day.key === selectedDayKey && "bg-sky-500/5",
                      )}
                    >
                      {formatHourValue(day.total)}
                    </td>
                  ))}
                  <td className="px-3 py-4 text-center text-sm font-semibold text-foreground">{formatHourValue(totalHours)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminTimesheetValidationPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reviewMode, setReviewMode] = useState<"weekly" | "daily">("weekly");
  const [selectedTimesheetId, setSelectedTimesheetId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedReviewDate, setSelectedReviewDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState("all");
  const [selectedReviewEmployeeId, setSelectedReviewEmployeeId] = useState("all");
  const [pendingReviewKey, setPendingReviewKey] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [showReviewedHistory, setShowReviewedHistory] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dayUnverifyTarget, setDayUnverifyTarget] = useState<{ id: string; day: DayKey } | null>(null);
  const [dayRevertTarget, setDayRevertTarget] = useState<{ id: string; day: DayKey; note: string } | null>(null);
  const [workNoteLineId, setWorkNoteLineId] = useState<string | null>(null);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: projectBudgetSummary = [] } = useQuery({ queryKey: ["project-budget-summary"], queryFn: api.getProjectBudgetSummary });
  const { data: projectCatalog = [] } = useQuery({ queryKey: ["project-catalog"], queryFn: api.getProjectCatalog });
  const taskCatalogLookup = useMemo(
    () =>
      new Map(
        projectCatalog.flatMap((project) =>
          project.tasks.map((task) => [task.id, task] as const),
        ),
      ),
    [projectCatalog],
  );

  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const employeeLookup = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const departmentOptions = useMemo(
    () =>
      [...new Set(employees.map((employee) => employee.department?.trim()).filter((department): department is string => Boolean(department)))]
        .sort((left, right) => left.localeCompare(right)),
    [employees],
  );
  const departmentEmployees = useMemo(
    () =>
      selectedDepartmentFilter === "all"
        ? employees
        : employees.filter((employee) => normalizeText(employee.department) === normalizeText(selectedDepartmentFilter)),
    [employees, selectedDepartmentFilter],
  );

  useEffect(() => {
    if (selectedReviewEmployeeId !== "all" && !departmentEmployees.some((employee) => employee.id === selectedReviewEmployeeId)) {
      setSelectedReviewEmployeeId("all");
    }
  }, [departmentEmployees, selectedReviewEmployeeId]);

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

  const dayReviewMutation = useMutation({
    mutationFn: ({ id, day, reviewed, note }: { id: string; day: DayKey; reviewed: boolean; note?: string }) =>
      api.setTimesheetDayReviewStatus(id, day, reviewed, note),
    onMutate: ({ id, day }) => {
      setPendingReviewKey(`${id}:${day}`);
    },
    onSuccess: (updatedEntry, variables) => {
      queryClient.setQueryData<TimesheetEntry[]>(["timesheets"], (currentEntries = []) =>
        currentEntries.map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry)),
      );
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (variables.reviewed) {
        setDayUnverifyTarget(null);
      } else if (variables.note?.trim()) {
        setDayRevertTarget(null);
      } else {
        setDayUnverifyTarget(null);
      }
      toast({
        title: variables.reviewed ? "Day reviewed" : variables.note?.trim() ? "Day returned" : "Review removed",
        description: variables.reviewed
          ? "The daily review marker has been saved."
          : variables.note?.trim()
            ? "The employee has been notified with the return note."
            : "The review mark has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update day review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingReviewKey(null);
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
  const activeWorkNoteSummary = useMemo(() => (activeWorkNoteLine ? lineWorkNoteSummary(activeWorkNoteLine) : ""), [activeWorkNoteLine]);
  const dailyReviewEntries = useMemo(
    () =>
      timesheets
        .filter((entry) => includesDateInWeek(entry.weekStart, selectedReviewDate))
        .filter((entry) => timesheetHasDisplayContent(entry))
        .filter((entry) => {
          const employee = employeeLookup.get(entry.employeeId);
          if (selectedDepartmentFilter !== "all" && normalizeText(employee?.department) !== normalizeText(selectedDepartmentFilter)) {
            return false;
          }

          if (selectedReviewEmployeeId !== "all" && entry.employeeId !== selectedReviewEmployeeId) {
            return false;
          }

          return true;
        })
        .sort((left, right) => {
          const nameCompare = left.employeeNameSnapshot.localeCompare(right.employeeNameSnapshot);
          if (nameCompare !== 0) {
            return nameCompare;
          }

          return new Date(right.submittedAt ?? right.reviewedAt ?? right.weekStart).getTime() - new Date(left.submittedAt ?? left.reviewedAt ?? left.weekStart).getTime();
        }),
    [employeeLookup, selectedDepartmentFilter, selectedReviewDate, selectedReviewEmployeeId, timesheets],
  );
  const dailyReviewSummary = useMemo(
    () => ({
      employees: new Set(dailyReviewEntries.map((entry) => entry.employeeId)).size,
      drafts: dailyReviewEntries.filter((entry) => entry.status === "draft").length,
      submitted: dailyReviewEntries.filter((entry) => entry.status === "submitted").length,
    }),
    [dailyReviewEntries],
  );


  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
            <p className="text-sm text-muted-foreground">
              Switch between weekly approvals and a read-only daily review of saved employee work.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/80 p-1 shadow-sm ring-1 ring-border/30 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setReviewMode("weekly")}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium tracking-[-0.01em] transition-all duration-200 ease-out",
                  reviewMode === "weekly"
                    ? "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(59,130,246,0.22)]"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
                aria-pressed={reviewMode === "weekly"}
              >
                Weekly Timesheet
              </button>
              <button
                type="button"
                onClick={() => setReviewMode("daily")}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium tracking-[-0.01em] transition-all duration-200 ease-out",
                  reviewMode === "daily"
                    ? "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(59,130,246,0.22)]"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
                aria-pressed={reviewMode === "daily"}
              >
                Daily Review
              </button>
            </div>
            {reviewMode === "weekly" ? (
              <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="w-[220px] rounded-xl" />
            ) : (
              <Input type="date" value={selectedReviewDate} onChange={(event) => setSelectedReviewDate(event.target.value)} className="w-[220px] rounded-xl" />
            )}
          </div>
        </div>

        {reviewMode === "weekly" ? (
          <>
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
                      const workNoteSummary = lineWorkNoteSummary(line);
                      const { taskName, taskDescription } = taskLineDisplayParts(line, taskCatalogLookup);
                      return (
                        <div
                          key={line.id}
                          className={cn(
                            "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_96px] gap-4 px-4 py-3",
                            index !== 0 && "border-t border-border/40",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{line.project || "Custom project"}</p>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="break-words text-sm font-medium leading-5 text-foreground">{taskName}</p>
                                {taskDescription ? <p className="break-words text-xs leading-5 text-muted-foreground">{taskDescription}</p> : null}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "mt-0.5 h-8 shrink-0 rounded-full border border-border/60 bg-background/70 px-3 text-[11px] shadow-none",
                                  workNoteSummary
                                    ? "border-primary/20 text-primary hover:bg-primary/10 hover:text-primary"
                                    : "text-muted-foreground hover:bg-secondary/20 hover:text-foreground",
                                )}
                                onClick={() => setWorkNoteLineId(line.id)}
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
                  <SelectContent className="max-h-[320px] overscroll-contain">
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
          </>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-border/60 bg-card/80 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <ClipboardList className="h-4 w-4" />
                    <p className="text-[11px] uppercase tracking-[0.16em]">Employees Visible</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{dailyReviewSummary.employees}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/80 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    <p className="text-[11px] uppercase tracking-[0.16em]">Draft Sheets</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{dailyReviewSummary.drafts}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/80 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" />
                    <p className="text-[11px] uppercase tracking-[0.16em]">Submitted Sheets</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{dailyReviewSummary.submitted}</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/60 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium">Daily Review Filters</CardTitle>
                <CardDescription>
                  Review saved employee work by date, department, and employee. This view mirrors the employee weekly grid without any editing controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Date</p>
                  <Input type="date" value={selectedReviewDate} onChange={(event) => setSelectedReviewDate(event.target.value)} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Department</p>
                  <Select value={selectedDepartmentFilter} onValueChange={setSelectedDepartmentFilter}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="All departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {departmentOptions.map((department) => (
                        <SelectItem key={department} value={department}>
                          {department}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Employee</p>
                  <Select value={selectedReviewEmployeeId} onValueChange={setSelectedReviewEmployeeId}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="All employees" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px] overscroll-contain">
                      <SelectItem value="all">All employees</SelectItem>
                      {departmentEmployees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {dailyReviewEntries.length === 0 ? (
                <Card className="border-border/60 bg-card/80 shadow-sm">
                  <CardContent className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No saved employee timesheets match the selected date and filters yet.
                  </CardContent>
                </Card>
              ) : (
                dailyReviewEntries.map((entry) => (
                  <AdminReadonlyTimesheetCard
                    key={entry.id}
                    entry={entry}
                    employee={employeeLookup.get(entry.employeeId)}
                    selectedDate={selectedReviewDate}
                    taskCatalogLookup={taskCatalogLookup}
                    pendingReviewKey={pendingReviewKey}
                    onMarkDayReviewed={(day) => dayReviewMutation.mutate({ id: entry.id, day, reviewed: true })}
                    onRequestDayUnverify={(day) => setDayUnverifyTarget({ id: entry.id, day })}
                    onRequestDayRevert={(day) =>
                      setDayRevertTarget({
                        id: entry.id,
                        day,
                        note: entry.dailyReviewNotes?.[day]?.trim() ?? "",
                      })
                    }
                  />
                ))
              )}
            </div>
          </>
        )}
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
                      const { taskName, taskDescription } = taskLineDisplayParts(line, taskCatalogLookup);
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
                                <p className="text-sm font-medium leading-5 text-foreground">{taskName}</p>
                                {taskDescription ? <p className="text-xs leading-5 text-muted-foreground">{taskDescription}</p> : null}
                              </div>
                            <div className="space-y-1.5">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Work note</p>
                              <div className="rounded-2xl border border-border/50 bg-background/90 px-4 py-3 text-sm leading-6 text-foreground">
                                {lineWorkNoteSummary(line) || (
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

      <Dialog open={Boolean(dayUnverifyTarget)} onOpenChange={(open) => !open && setDayUnverifyTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border/60 bg-card/95 p-0 shadow-2xl">
          <div className="space-y-5 p-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-lg font-semibold tracking-tight">Undo review?</DialogTitle>
              <DialogDescription>
                This will remove the review mark so the day can be reviewed again.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Day</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {dayUnverifyTarget
                  ? format(
                      addDays(new Date(timesheets.find((entry) => entry.id === dayUnverifyTarget.id)?.weekStart ?? new Date()), DAYS.indexOf(dayUnverifyTarget.day)),
                      "EEE, dd MMM yyyy",
                    )
                  : "-"}
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl border-border/60" onClick={() => setDayUnverifyTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl bg-sky-500 text-white hover:bg-sky-500/90"
                disabled={dayReviewMutation.isPending}
                onClick={() => {
                  if (!dayUnverifyTarget) {
                    return;
                  }

                  dayReviewMutation.mutate({
                    id: dayUnverifyTarget.id,
                    day: dayUnverifyTarget.day,
                    reviewed: false,
                  });
                }}
              >
                Undo review
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dayRevertTarget)} onOpenChange={(open) => !open && setDayRevertTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border/60 bg-card/95 p-0 shadow-2xl">
          <div className="space-y-5 p-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-lg font-semibold tracking-tight">Return day for changes</DialogTitle>
              <DialogDescription>
                Add a short note so the employee knows what to fix before saving the draft again.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/60 p-4">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Day</p>
                <p className="text-sm font-medium text-foreground">
                  {dayRevertTarget ? format(addDays(new Date(timesheets.find((entry) => entry.id === dayRevertTarget.id)?.weekStart ?? new Date()), DAYS.indexOf(dayRevertTarget.day)), "EEE, dd MMM yyyy") : "-"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Note</p>
                <Textarea
                  value={dayRevertTarget?.note ?? ""}
                  onChange={(event) =>
                    setDayRevertTarget((current) => (current ? { ...current, note: event.target.value.slice(0, 1000) } : current))
                  }
                  placeholder="Explain what needs to be updated for this day."
                  className="min-h-[120px] rounded-xl border-border/60 bg-background/80 px-4 py-3 text-sm leading-6 shadow-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl border-border/60" onClick={() => setDayRevertTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl bg-rose-500 text-white hover:bg-rose-500/90"
                disabled={!dayRevertTarget?.note.trim() || dayReviewMutation.isPending}
                onClick={() => {
                  if (!dayRevertTarget) {
                    return;
                  }
                  dayReviewMutation.mutate({
                    id: dayRevertTarget.id,
                    day: dayRevertTarget.day,
                    reviewed: false,
                    note: dayRevertTarget.note.trim(),
                  });
                }}
              >
                Return to employee
              </Button>
            </div>
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
                  {(() => {
                    const { taskName, taskDescription } = taskLineDisplayParts(activeWorkNoteLine ?? {}, taskCatalogLookup);
                    return (
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-5 text-foreground">{taskName}</p>
                        {taskDescription ? <p className="text-xs leading-5 text-muted-foreground">{taskDescription}</p> : null}
                      </div>
                    );
                  })()}
                </div>
                  <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm leading-6 text-foreground">
                    {activeWorkNoteSummary || (
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
                {activeWorkNoteSummary || (
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
