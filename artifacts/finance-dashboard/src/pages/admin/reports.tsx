import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { BarChart3, ChevronDown, ChevronRight, Download, Receipt, Wallet, WalletCards, Clock3, CalendarDays } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type DayKey, type MonthCalendarDay, type ProjectBudgetTask, type TimesheetEntry } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function formatHours(value: number) {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}h`;
}

function isInMonth(date: string, month: string) {
  return date.slice(0, 7) === month;
}

function weekDateIso(weekStart: string, dayIndex: number) {
  return format(addDays(new Date(weekStart), dayIndex), "yyyy-MM-dd");
}

function weekTouchesMonth(weekStart: string, month: string) {
  const start = new Date(weekStart);
  const end = addDays(start, 6);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);
  return start <= monthEnd && end >= monthStart;
}

function totalHours(days: MonthCalendarDay[] | undefined) {
  return (days ?? []).reduce((sum, day) => sum + Number(day.hours ?? 0), 0);
}

function lineHoursInMonth(entry: TimesheetEntry, line: TimesheetEntry["lines"][number], month: string) {
  return DAY_KEYS.reduce((sum, day, index) => {
    if (!isInMonth(weekDateIso(entry.weekStart, index), month)) {
      return sum;
    }
    return sum + Number(line.hours?.[day] ?? 0);
  }, 0);
}

function taskLineDisplayParts(
  line: { task?: string; subTask?: string; projectTaskId?: string },
  taskCatalogLookup?: Map<string, ProjectBudgetTask>,
) {
  const catalogTask = line.projectTaskId ? taskCatalogLookup?.get(line.projectTaskId) : undefined;
  const taskName = catalogTask?.name?.trim() || line.task?.trim() || "Custom task";
  const shortDescription = catalogTask?.description?.trim() || "";

  return { taskName, shortDescription };
}

function monthDateRows(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, monthNumber - 1, index + 1);
    return {
      iso: format(date, "yyyy-MM-dd"),
      label: format(date, "dd MMM yyyy"),
      day: format(date, "EEE"),
    };
  });
}

function groupWeeks(days: MonthCalendarDay[] | undefined) {
  const weeks = new Map<
    string,
    {
      start: Date;
      end: Date;
      label: string;
      hours: number;
      leaveDays: number;
      holidayDays: number;
      workedDays: number;
    }
  >();

  for (const day of days ?? []) {
    const date = new Date(day.date);
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    const key = weekStart.toISOString().slice(0, 10);
    const current =
      weeks.get(key) ??
      {
        start: weekStart,
        end: addDays(weekStart, 6),
        label: `${format(weekStart, "dd MMM")} - ${format(addDays(weekStart, 6), "dd MMM")}`,
        hours: 0,
        leaveDays: 0,
        holidayDays: 0,
        workedDays: 0,
      };

    current.hours += Number(day.hours ?? 0);
    current.leaveDays += day.leave ? 1 : 0;
    current.holidayDays += day.holiday ? 1 : 0;
    current.workedDays += day.worked ? 1 : 0;
    weeks.set(key, current);
  }

  return [...weeks.values()].sort((left, right) => left.start.getTime() - right.start.getTime());
}

export default function AdminReportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [taskHoursEmployeeScope, setTaskHoursEmployeeScope] = useState("all");
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [includeProjectTaskSummary, setIncludeProjectTaskSummary] = useState(true);
  const [includeEmployeeDetails, setIncludeEmployeeDetails] = useState(true);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: timesheets = [] } = useQuery({ queryKey: ["timesheets"], queryFn: () => api.getTimesheets() });
  const { data: salaries = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => api.getExpenses() });
  const { data: funds = [] } = useQuery({ queryKey: ["funds"], queryFn: api.getFunds });
  const { data: projectCatalog = [] } = useQuery({ queryKey: ["project-catalog"], queryFn: api.getProjectCatalog });
  const { data: projectSummary = [] } = useQuery({
    queryKey: ["projectBudgetSummary"],
    queryFn: api.getProjectBudgetSummary,
  });
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

  useEffect(() => {
    if (taskHoursEmployeeScope !== "all" && !employees.some((employee) => employee.id === taskHoursEmployeeScope)) {
      setTaskHoursEmployeeScope("all");
    }
  }, [employees, taskHoursEmployeeScope]);

  const report = useMemo(() => {
    const monthTimesheets = timesheets.filter((entry) => weekTouchesMonth(entry.weekStart, selectedMonth));
    const taskScopeTimesheets =
      taskHoursEmployeeScope === "all"
        ? monthTimesheets
        : monthTimesheets.filter((entry) => entry.employeeId === taskHoursEmployeeScope);
    const monthSalaries = salaries.filter((salary) => isInMonth(salary.date, selectedMonth));
    const monthExpenses = expenses.filter((expense) => isInMonth(expense.date, selectedMonth));
    const monthFunds = funds.filter((fund) => isInMonth(fund.date, selectedMonth));

    const totalHoursLogged = monthTimesheets.reduce(
      (sum, entry) =>
        sum +
        entry.lines.reduce((lineSum, line) => lineSum + lineHoursInMonth(entry, line, selectedMonth), 0),
      0,
    );

    const salariesPayable = monthSalaries
      .filter((salary) => salary.status === "pending")
      .reduce((sum, salary) => sum + salary.amount, 0);
    const approvedExpenses = monthExpenses
      .filter((expense) => expense.status === "approved")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const pendingExpenses = monthExpenses
      .filter((expense) => expense.status === "submitted" || expense.status === "draft")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const totalFunds = monthFunds.reduce((sum, fund) => sum + fund.amount, 0);

    const buildTaskHourRows = (sourceTimesheets: TimesheetEntry[], scopeHours: number) => {
      const taskHoursLookup = new Map<
        string,
        {
          id: string;
          project: string;
          task: string;
          description: string;
          subTask: string;
          hours: number;
          employeeIds: Set<string>;
          rows: number;
        }
      >();

      for (const entry of sourceTimesheets) {
        for (const line of entry.lines) {
          const hours = lineHoursInMonth(entry, line, selectedMonth);
          if (hours <= 0) {
            continue;
          }
          const project = line.project?.trim() || "Custom project";
          const { taskName, shortDescription } = taskLineDisplayParts(line, taskCatalogLookup);
          const task = taskName;
          const description = shortDescription;
          const subTask = line.subTask?.trim() || "";
          const key = `${project}::${task}::${description}::${subTask}`;
          const current =
            taskHoursLookup.get(key) ??
            {
              id: key,
              project,
              task,
              description,
              subTask,
              hours: 0,
              employeeIds: new Set<string>(),
              rows: 0,
            };
          current.hours += hours;
          current.employeeIds.add(entry.employeeId);
          current.rows += 1;
          taskHoursLookup.set(key, current);
        }
      }

      return [...taskHoursLookup.values()]
        .map((row) => ({
          ...row,
          employeeCount: row.employeeIds.size,
          share: scopeHours > 0 ? (row.hours / scopeHours) * 100 : 0,
        }))
        .sort((left, right) => right.hours - left.hours);
    };

    const taskScopeHours = taskScopeTimesheets.reduce(
      (sum, entry) =>
        sum +
        entry.lines.reduce((lineSum, line) => lineSum + lineHoursInMonth(entry, line, selectedMonth), 0),
      0,
    );
    const allTaskHourRows = buildTaskHourRows(monthTimesheets, totalHoursLogged);
    const taskHourRows = buildTaskHourRows(taskScopeTimesheets, taskScopeHours);

    const employeeRows = employees
      .map((employee) => {
        const employeeHours = monthTimesheets
          .filter((entry) => entry.employeeId === employee.id)
          .reduce(
            (sum, entry) =>
              sum +
              entry.lines.reduce((lineSum, line) => lineSum + lineHoursInMonth(entry, line, selectedMonth), 0),
            0,
          );
        return {
          id: employee.id,
          name: employee.name,
          department: employee.department,
          hours: employeeHours,
        };
      })
      .filter((row) => row.hours > 0)
      .sort((left, right) => right.hours - left.hours);

    return {
      totalHoursLogged,
      salariesPayable,
      approvedExpenses,
      pendingExpenses,
      totalFunds,
      employeeRows,
      allTaskHourRows,
      taskHourRows,
      projectRows: projectSummary,
    };
  }, [employees, expenses, funds, projectSummary, salaries, selectedMonth, taskCatalogLookup, taskHoursEmployeeScope, timesheets]);

  const { data: employeeMonthCalendar } = useQuery({
    queryKey: ["employee-month-calendar-report", selectedEmployeeId, selectedMonth],
    queryFn: () => api.getEmployeeMonthCalendar({ employeeId: selectedEmployeeId, month: selectedMonth }),
    enabled: Boolean(selectedEmployeeId),
  });

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedTaskHoursEmployee = employees.find((employee) => employee.id === taskHoursEmployeeScope) ?? null;
  const weeklyBreakdown = useMemo(() => groupWeeks(employeeMonthCalendar?.days), [employeeMonthCalendar?.days]);
  const weeklyBreakdownMap = useMemo(
    () =>
      new Map(
        weeklyBreakdown.map((week) => [week.start.toISOString().slice(0, 10), week] as const),
      ),
    [weeklyBreakdown],
  );
  const monthLabel = employeeMonthCalendar?.monthLabel ?? format(new Date(`${selectedMonth}-01T00:00:00`), "MMMM yyyy");
  const employeeWeekReports = useMemo(() => {
    const relevantTimesheets = timesheets
      .filter((entry) => entry.employeeId === selectedEmployeeId && weekTouchesMonth(entry.weekStart, selectedMonth))
      .sort((left, right) => new Date(right.weekStart).getTime() - new Date(left.weekStart).getTime());

    return relevantTimesheets.map((entry) => {
      const taskRows = entry.lines.map((line) => {
        const total = Object.values(line.hours).reduce((sum, value) => sum + Number(value ?? 0), 0);
        return {
          id: line.id,
          project: line.project || "Custom project",
          task: line.task || "Custom task",
          notes: line.notes || "",
          total,
          hours: line.hours,
        };
      });

      return {
        id: entry.id,
        weekStart: entry.weekStart,
        weekLabel: `${format(new Date(entry.weekStart), "dd MMM")} - ${format(addDays(new Date(entry.weekStart), 6), "dd MMM yyyy")}`,
        status: entry.status,
        reviewedAt: entry.reviewedAt,
        reviewNotes: entry.reviewNotes,
        totalHours: taskRows.reduce((sum, row) => sum + row.total, 0),
        totalTasks: taskRows.length,
        taskRows,
      };
    });
  }, [selectedEmployeeId, selectedMonth, timesheets]);
  const activeWeekId =
    openWeekId && employeeWeekReports.some((week) => week.id === openWeekId)
      ? openWeekId
      : employeeWeekReports[0]?.id ?? null;

  const employeeExportReports = useMemo(() => {
    const monthTimesheets = timesheets.filter((entry) => weekTouchesMonth(entry.weekStart, selectedMonth));
    const days = monthDateRows(selectedMonth);

    return employees
      .map((employee) => {
        const taskSummaryLookup = new Map<
          string,
          {
            id: string;
            project: string;
            task: string;
            shortDescription: string;
            subTask: string;
            hours: number;
          }
        >();
        const workByDate = new Map<
          string,
          Array<{
            project: string;
            task: string;
            shortDescription: string;
            subTask: string;
            hours: number;
            workNote: string;
          }>
        >();

        monthTimesheets
          .filter((entry) => entry.employeeId === employee.id)
          .forEach((entry) => {
            entry.lines.forEach((line) => {
              const hours = lineHoursInMonth(entry, line, selectedMonth);
              if (hours <= 0) {
                return;
              }
              const { taskName, shortDescription } = taskLineDisplayParts(line, taskCatalogLookup);
              const project = line.project?.trim() || "Custom project";
              const task = taskName;
              const subTask = line.subTask?.trim() || "";
              const key = `${project}::${task}::${shortDescription}::${subTask}`;
              const currentSummary =
                taskSummaryLookup.get(key) ?? {
                  id: key,
                  project,
                  task,
                  shortDescription,
                  subTask,
                  hours: 0,
                };

              currentSummary.hours += hours;
              taskSummaryLookup.set(key, currentSummary);

              DAY_KEYS.forEach((day, index) => {
                const date = weekDateIso(entry.weekStart, index);
                const dayHours = Number(line.hours?.[day] ?? 0);
                if (!isInMonth(date, selectedMonth) || dayHours <= 0) {
                  return;
                }
                const dateRows = workByDate.get(date) ?? [];
                dateRows.push({
                  project,
                  task,
                  shortDescription,
                  subTask,
                  hours: dayHours,
                  workNote: line.workNotes?.[day]?.trim() || "",
                });
                workByDate.set(date, dateRows);
              });
            });
          });

        const taskSummaryRows = [...taskSummaryLookup.values()].sort(
          (left, right) => right.hours - left.hours || left.project.localeCompare(right.project) || left.task.localeCompare(right.task),
        );
        const dailyRows = days.map((day) => {
          const entries = workByDate.get(day.iso) ?? [];
          return {
            ...day,
            entries,
            hours: entries.reduce((sum, entry) => sum + entry.hours, 0),
          };
        });

        return {
          employee,
          taskSummaryRows,
          dailyRows,
          totalHours: taskSummaryRows.reduce((sum, row) => sum + row.hours, 0),
        };
      })
      .filter((entry) => entry.totalHours > 0)
      .sort((left, right) => left.employee.name.localeCompare(right.employee.name));
  }, [employees, selectedMonth, taskCatalogLookup, timesheets]);

  function exportPdf() {
    if (!includeProjectTaskSummary && !includeEmployeeDetails) {
      return;
    }

    const popup = window.open("", "_blank", "width=1120,height=820");
    if (!popup) {
      return;
    }

    const reportMonthLabel = format(new Date(`${selectedMonth}-01T00:00:00`), "MMMM yyyy");
    const generatedAt = format(new Date(), "dd MMM yyyy, HH:mm");
    const projectRowsHtml =
      report.allTaskHourRows.length > 0
        ? report.allTaskHourRows
            .map(
              (row, index) => `
                <tr>
                  <td class="muted center">${index + 1}</td>
                  <td><strong>${escapeHtml(row.project)}</strong></td>
                  <td><strong>${escapeHtml(row.task)}</strong></td>
                  <td>${escapeHtml(row.description || "-")}</td>
                  <td>${escapeHtml(row.subTask || "-")}</td>
                  <td class="center">${row.employeeCount}</td>
                  <td class="num">${formatHours(row.hours)}</td>
                </tr>
              `,
            )
            .join("")
        : `<tr><td colspan="7" class="empty">No project or task hours logged for ${escapeHtml(reportMonthLabel)}.</td></tr>`;

    const employeeDetailsHtml =
      employeeExportReports.length > 0
        ? employeeExportReports
            .map(
              ({ employee, taskSummaryRows, dailyRows, totalHours }) => `
                <section class="employee-page">
                  <div class="section-heading">
                    <div>
                      <p class="eyebrow">Employee Detail</p>
                      <h2>${escapeHtml(employee.name)}</h2>
                      <p>${escapeHtml(employee.department || "Department not set")}</p>
                    </div>
                    <div class="total-pill">${formatHours(totalHours)}</div>
                  </div>
                  <div class="employee-subsection">
                    <div class="mini-heading">
                      <strong>Task contribution summary</strong>
                      <span>Total contributed hours by task and short description</span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Task</th>
                          <th>Short Description</th>
                          <th>Sub-task</th>
                          <th class="num">Hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${taskSummaryRows
                          .map(
                            (row) => `
                              <tr>
                                <td><strong>${escapeHtml(row.project)}</strong></td>
                                <td><strong>${escapeHtml(row.task)}</strong></td>
                                <td>${escapeHtml(row.shortDescription || "-")}</td>
                                <td>${escapeHtml(row.subTask || "-")}</td>
                                <td class="num">${formatHours(row.hours)}</td>
                              </tr>
                            `,
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                  <div class="employee-subsection">
                    <div class="mini-heading">
                      <strong>Daily work log</strong>
                      <span>One row for every day in ${escapeHtml(reportMonthLabel)}</span>
                    </div>
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 92px;">Date</th>
                        <th style="width: 48px;">Day</th>
                        <th>Task, short description & sub-task</th>
                        <th class="num">Hours</th>
                        <th>Work Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${dailyRows
                        .map(
                          (day) => `
                            <tr>
                              <td>
                                <strong>${escapeHtml(day.label)}</strong>
                              </td>
                              <td>${escapeHtml(day.day)}</td>
                              <td>
                                ${
                                  day.entries.length > 0
                                    ? day.entries
                                        .map(
                                          (entry) => `
                                            <div class="day-task">
                                              <strong>${escapeHtml(entry.project)} / ${escapeHtml(entry.task)}</strong>
                                              ${entry.shortDescription ? `<div class="subtext">Short description: ${escapeHtml(entry.shortDescription)}</div>` : ""}
                                              ${entry.subTask ? `<div class="subtext">Sub-task: ${escapeHtml(entry.subTask)}</div>` : ""}
                                            </div>
                                          `,
                                        )
                                        .join("")
                                    : `<span class="muted">No work logged</span>`
                                }
                              </td>
                              <td class="num">${day.hours > 0 ? formatHours(day.hours) : "-"}</td>
                              <td>
                                ${
                                  day.entries.some((entry) => entry.workNote)
                                    ? day.entries
                                        .filter((entry) => entry.workNote)
                                        .map((entry) => `<div>${escapeHtml(entry.workNote)}</div>`)
                                        .join("")
                                    : `<span class="muted">No work note</span>`
                                }
                              </td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                  </div>
                </section>
              `,
            )
            .join("")
        : `<section class="employee-page"><div class="empty">No employee task detail available for ${escapeHtml(reportMonthLabel)}.</div></section>`;

    popup.document.write(`
      <html>
        <head>
          <title>Monthly Summary - ${reportMonthLabel}</title>
          <style>
            @page { size: A4; margin: 18mm 14mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #0f172a; font-family: "Segoe UI", Arial, sans-serif; background: #ffffff; font-size: 11px; }
            .report-shell { padding: 0; }
            .cover { border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 18px; }
            .topline { display: flex; justify-content: space-between; gap: 24px; color: #64748b; font-size: 11px; }
            h1 { margin: 28px 0 4px; font-size: 28px; line-height: 1.1; letter-spacing: -0.04em; }
            h2 { margin: 0; font-size: 18px; line-height: 1.2; }
            p { margin: 0; color: #475569; }
            .metrics { display: grid; grid-template-columns: minmax(180px, 240px); gap: 10px; margin-top: 20px; }
            .metric { border: 1px solid #dbe4f0; border-radius: 12px; padding: 12px; background: #f8fafc; }
            .label, .eyebrow { color: #64748b; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
            .value { margin-top: 8px; color: #0f172a; font-size: 22px; font-weight: 800; }
            .section { margin-top: 22px; }
            .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
            .total-pill { border: 1px solid #dbe4f0; border-radius: 999px; padding: 8px 12px; font-weight: 800; white-space: nowrap; background: #f8fafc; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #dbe4f0; padding: 7px 8px; vertical-align: top; text-align: left; }
            th { background: #f1f5f9; color: #475569; font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
            td { line-height: 1.42; }
            .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .center { text-align: center; }
            .muted, .subtext { color: #64748b; }
            .subtext { margin-top: 3px; font-size: 11px; }
            .empty { border: 1px dashed #cbd5e1; border-radius: 12px; padding: 24px; color: #64748b; text-align: center; }
            .employee-subsection { margin-top: 14px; }
            .mini-heading { align-items: baseline; display: flex; gap: 10px; justify-content: space-between; margin-bottom: 8px; }
            .mini-heading span { color: #64748b; font-size: 10px; }
            .day-task + .day-task { border-top: 1px solid #e2e8f0; margin-top: 6px; padding-top: 6px; }
            .employee-page { break-before: page; page-break-before: always; }
            .employee-section + .employee-page { break-before: auto; page-break-before: auto; }
            @media print {
              .employee-page { page-break-before: always; }
              .employee-section + .employee-page { page-break-before: auto; }
            }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="cover">
              <div class="topline">
                <span>Generated ${escapeHtml(generatedAt)}</span>
                <span>Monthly Consolidated Report - ${escapeHtml(reportMonthLabel)}</span>
              </div>
              <h1>Monthly Consolidated Report</h1>
              <p>${escapeHtml(reportMonthLabel)} project hours, payroll liability, expenses, and employee work detail.</p>
              <div class="metrics">
                <div class="metric"><div class="label">Total Hours</div><div class="value">${formatHours(report.totalHoursLogged)}</div></div>
              </div>
            </section>
            ${
              includeProjectTaskSummary
                ? `
                  <section class="section">
                    <div class="section-heading">
                      <div>
                        <p class="eyebrow">Section 1</p>
                        <h2>Project, Task & Short Description Hours</h2>
                        <p>Consolidated hours across all employees for ${escapeHtml(reportMonthLabel)}.</p>
                      </div>
                      <div class="total-pill">${formatHours(report.totalHoursLogged)}</div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th style="width: 38px;">#</th>
                          <th>Project</th>
                          <th>Task</th>
                          <th>Short Description</th>
                          <th>Sub-task</th>
                          <th style="width: 70px;">People</th>
                          <th style="width: 76px;" class="num">Hours</th>
                        </tr>
                      </thead>
                      <tbody>${projectRowsHtml}</tbody>
                    </table>
                  </section>
                `
                : ""
            }
            ${
              includeEmployeeDetails
                ? `
                  <section class="section employee-section">
                    <div class="section-heading">
                      <div>
                        <p class="eyebrow">Section 2</p>
                        <h2>Employee-wise Detailed Work</h2>
                        <p>Each employee starts on a new page with project, task, short description, hours, and work notes.</p>
                      </div>
                      <div class="total-pill">${employeeExportReports.length} employee${employeeExportReports.length !== 1 ? "s" : ""}</div>
                    </div>
                  </section>
                  ${employeeDetailsHtml}
                `
                : ""
            }
          </main>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Month-wise summary of hours, leave, holidays, salary liability, expenses, and project budget usage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="w-[220px]"
            />
            <Button className="rounded-xl" variant="outline" onClick={() => setExportOptionsOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <ReportMetricCard
            label="Total Hours"
            value={formatHours(report.totalHoursLogged)}
            helper="Logged this month"
            icon={<Clock3 className="h-4 w-4" />}
          />
          <ReportMetricCard
            label="Salaries Payable"
            value={formatCurrency(report.salariesPayable)}
            helper="Pending payroll"
            icon={<WalletCards className="h-4 w-4" />}
          />
          <ReportMetricCard
            label="Approved Expenses"
            value={formatCurrency(report.approvedExpenses)}
            helper="Cleared expenses"
            icon={<Receipt className="h-4 w-4" />}
          />
          <ReportMetricCard
            label="Pending Expenses"
            value={formatCurrency(report.pendingExpenses)}
            helper="Awaiting action"
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <ReportMetricCard
            label="Funds Added"
            value={formatCurrency(report.totalFunds)}
            helper="Capital inflow"
            icon={<Wallet className="h-4 w-4" />}
          />
        </div>

        <div className="grid gap-6">
          <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Project & Task Hours</CardTitle>
                  <CardDescription>
                    {selectedTaskHoursEmployee
                      ? `Booked hours for ${selectedTaskHoursEmployee.name}, grouped by project, task, and sub-task.`
                      : "Total booked hours by project, task, and sub-task for all employees in the selected month."}
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select value={taskHoursEmployeeScope} onValueChange={setTaskHoursEmployeeScope}>
                    <SelectTrigger className="h-9 w-full rounded-full border-border/70 bg-background/70 text-sm sm:w-[240px]">
                      <SelectValue placeholder="Choose employee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className="w-fit rounded-full border-border/70 px-3 py-1 text-xs">
                    {report.taskHourRows.length} active task{report.taskHourRows.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {report.taskHourRows.length === 0 ? (
                <div className="m-6 rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  {selectedTaskHoursEmployee
                    ? `No project or task hours logged by ${selectedTaskHoursEmployee.name} for this month yet.`
                    : "No project or task hours logged for this month yet."}
                </div>
              ) : (
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/60 bg-secondary/25 hover:bg-secondary/25">
                        <TableHead className="w-[54px] pl-6 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          #
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Project
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Task
                        </TableHead>
                        <TableHead className="w-[24%] text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Short Description
                        </TableHead>
                        <TableHead className="w-[24%] text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Sub-task
                        </TableHead>
                        <TableHead className="w-[72px] text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          People
                        </TableHead>
                        <TableHead className="w-[82px] text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Hours
                        </TableHead>
                        <TableHead className="w-[132px] pr-6 text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          Share
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.taskHourRows.slice(0, 12).map((row, index) => (
                        <TableRow key={row.id} className="border-border/50">
                          <TableCell className="pl-6 align-middle">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/60 text-xs font-semibold text-muted-foreground">
                              {index + 1}
                            </span>
                          </TableCell>
                          <TableCell className="align-middle">
                            <p className="font-semibold text-foreground">{row.project}</p>
                          </TableCell>
                          <TableCell className="align-middle">
                            <p className="font-medium text-foreground">{row.task}</p>
                          </TableCell>
                          <TableCell className="align-middle text-sm leading-6 text-muted-foreground">
                            {row.description || "No short description"}
                          </TableCell>
                          <TableCell className="align-middle text-sm text-muted-foreground">
                            {row.subTask || "No sub-task"}
                          </TableCell>
                          <TableCell className="align-middle text-right font-medium">{row.employeeCount}</TableCell>
                          <TableCell className="align-middle text-right font-semibold">{formatHours(row.hours)}</TableCell>
                          <TableCell className="pr-6 align-middle">
                            <div className="flex items-center justify-end gap-3">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary/70">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.min(100, row.share)}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-xs text-muted-foreground">
                                {row.share.toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-base font-semibold">Project-wise Budget Summary</CardTitle>
              <CardDescription>Live spent versus remaining by project.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 bg-secondary/25 hover:bg-secondary/25">
                    <TableHead className="pl-6 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Project</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Client</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Budget</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Spent</TableHead>
                    <TableHead className="pr-6 text-right text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.projectRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No project budgets created yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.projectRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.project}</TableCell>
                        <TableCell>{row.client || "—"}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalBudget)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.spent)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.remainingBudget)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-base font-medium">Employee Monthly Detail</CardTitle>
              <CardDescription>Detailed employee performance for the selected month with expandable week-by-week task and hour breakdown.</CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="w-[240px]">
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
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                {monthLabel}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {!selectedEmployee || !employeeMonthCalendar ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                Select an employee to see the monthly view.
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Hours Logged</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeMonthCalendar.summary.hoursLogged.toFixed(1)}h</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Working Days</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeMonthCalendar.summary.daysWorked}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Leave Days</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeMonthCalendar.summary.leaveDays}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holiday Days</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeMonthCalendar.summary.holidayDays}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pending Leave</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeMonthCalendar.summary.pendingLeaveDays}</p>
                  </div>
                </div>

                <Card className="border-border/60 bg-background/50 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Weekly Work Breakdown</CardTitle>
                    <CardDescription>Open any week to inspect project tasks, day-wise hours, and review status.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {employeeWeekReports.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                        No timesheet weeks found for this employee in {monthLabel}.
                      </div>
                    ) : (
                      employeeWeekReports.map((week) => {
                        const isOpen = week.id === activeWeekId;
                        const weekSummary = weeklyBreakdownMap.get(new Date(week.weekStart).toISOString().slice(0, 10));

                        return (
                          <Card key={week.id} className="border-border/60 shadow-none">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
                              onClick={() => setOpenWeekId((current) => (current === week.id ? null : week.id))}
                            >
                              <div className="flex items-start gap-3">
                                {isOpen ? (
                                  <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                )}
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-foreground">{week.weekLabel}</p>
                                    <Badge
                                      variant="outline"
                                      className={
                                        week.status === "approved"
                                          ? "border-emerald-500/30 text-emerald-400"
                                          : week.status === "rejected"
                                            ? "border-amber-500/30 text-amber-400"
                                            : week.status === "submitted"
                                              ? "border-sky-500/30 text-sky-400"
                                              : "border-border text-muted-foreground"
                                      }
                                    >
                                      {week.status}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                    <span>{week.totalHours.toFixed(1)}h logged</span>
                                    <span>{week.totalTasks} task row{week.totalTasks !== 1 ? "s" : ""}</span>
                                    <span>{weekSummary?.workedDays ?? 0} worked days</span>
                                    <span>{weekSummary?.leaveDays ?? 0} leave days</span>
                                    <span>{weekSummary?.holidayDays ?? 0} holidays</span>
                                  </div>
                                </div>
                              </div>
                              {week.reviewedAt ? (
                                <div className="text-right text-xs text-muted-foreground">
                                  Reviewed {format(new Date(week.reviewedAt), "dd MMM yyyy")}
                                </div>
                              ) : null}
                            </button>

                            {isOpen ? (
                              <CardContent className="space-y-4 border-t border-border/50 pt-4">
                                {week.reviewNotes ? (
                                  <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3 text-sm text-muted-foreground">
                                    {week.reviewNotes}
                                  </div>
                                ) : null}

                                <div className="overflow-hidden rounded-xl border border-border/60">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Project</TableHead>
                                        <TableHead>Task</TableHead>
                                        <TableHead className="text-right">Mon</TableHead>
                                        <TableHead className="text-right">Tue</TableHead>
                                        <TableHead className="text-right">Wed</TableHead>
                                        <TableHead className="text-right">Thu</TableHead>
                                        <TableHead className="text-right">Fri</TableHead>
                                        <TableHead className="text-right">Sat</TableHead>
                                        <TableHead className="text-right">Sun</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {week.taskRows.map((row) => (
                                        <TableRow key={row.id}>
                                          <TableCell className="font-medium">{row.project}</TableCell>
                                          <TableCell>
                                            <div className="space-y-1">
                                              <p>{row.task}</p>
                                              {row.notes ? (
                                                <p className="text-xs text-muted-foreground">{row.notes}</p>
                                              ) : null}
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right">{row.hours.mon || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.tue || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.wed || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.thu || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.fri || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.sat || "—"}</TableCell>
                                          <TableCell className="text-right">{row.hours.sun || "—"}</TableCell>
                                          <TableCell className="text-right font-medium">{row.total.toFixed(1)}h</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </CardContent>
                            ) : null}
                          </Card>
                        );
                      })
                    )}
                  </CardContent>
                </Card>

                <div className="overflow-hidden rounded-xl border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month View</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Leave</TableHead>
                        <TableHead className="text-right">Holiday</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeMonthCalendar.days.map((day) => (
                        <TableRow key={day.date}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{format(new Date(day.date), "dd MMM")}</p>
                              <p className="text-xs text-muted-foreground">{format(new Date(day.date), "EEEE")}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{day.hours > 0 ? `${day.hours}h` : "—"}</TableCell>
                          <TableCell className="text-right">
                            {day.leave ? "Approved" : day.leaveStatus === "pending" ? "Pending" : "—"}
                          </TableCell>
                          <TableCell className="text-right">{day.holiday ? day.holidayName ?? "Holiday" : "—"}</TableCell>
                          <TableCell className="text-right">
                            {day.worked ? "Worked" : day.holiday ? "Holiday" : day.leave ? "Leave" : "No activity"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={exportOptionsOpen} onOpenChange={setExportOptionsOpen}>
        <DialogContent className="max-w-xl rounded-2xl border-border/70 bg-card p-0 shadow-2xl">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <DialogTitle>Export monthly report</DialogTitle>
            <DialogDescription>
              Choose exactly what should be included in the consolidated PDF for {monthLabel}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-5">
            <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-border/60 bg-secondary/10 p-4 transition hover:bg-secondary/20">
              <Checkbox
                className="mt-1"
                checked={includeProjectTaskSummary}
                onCheckedChange={(checked) => setIncludeProjectTaskSummary(checked === true)}
              />
              <span className="space-y-1">
                <span className="block font-semibold text-foreground">Overall project, task and short description hours</span>
                <span className="block text-sm text-muted-foreground">
                  Prints one consolidated table with project, task, short description, sub-task, people count, and total hours.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-border/60 bg-secondary/10 p-4 transition hover:bg-secondary/20">
              <Checkbox
                className="mt-1"
                checked={includeEmployeeDetails}
                onCheckedChange={(checked) => setIncludeEmployeeDetails(checked === true)}
              />
              <span className="space-y-1">
                <span className="block font-semibold text-foreground">Employee-wise detailed pages</span>
                <span className="block text-sm text-muted-foreground">
                  Adds employee pages with task contribution totals first, then a date-wise monthly work log with work notes.
                </span>
              </span>
            </label>

            {!includeProjectTaskSummary && !includeEmployeeDetails ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Select at least one section before generating the PDF.
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/60 px-6 py-4">
            <Button variant="outline" className="rounded-xl" onClick={() => setExportOptionsOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              disabled={!includeProjectTaskSummary && !includeEmployeeDetails}
              onClick={() => {
                setExportOptionsOpen(false);
                exportPdf();
              }}
            >
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function ReportMetricCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card/85 shadow-sm">
      <CardContent className="flex min-h-[128px] flex-col px-5 py-4">
        <div className="flex min-h-9 items-start justify-between gap-4">
          <p className="max-w-[8.5rem] text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.17em] text-muted-foreground">
            {label}
          </p>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
            {icon}
          </div>
        </div>

        <div className="mt-2">
          <p className="truncate text-[28px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        </div>

        <p className="mt-auto text-xs leading-4 text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}
