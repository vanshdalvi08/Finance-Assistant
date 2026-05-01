import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock3, FolderKanban, Layers3 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

type ProjectCatalogProject = Awaited<ReturnType<typeof api.getProjectCatalog>>[number];
type TimesheetRecord = Awaited<ReturnType<typeof api.getTimesheets>>[number];
const TASK_MANAGER_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function formatHours(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0h";
  }

  return `${Number(value.toFixed(1)).toString()}h`;
}

function lineTotal(line: TimesheetRecord["lines"][number]) {
  return TASK_MANAGER_DAY_KEYS.reduce(
    (sum, day) => sum + Number(line.hours[day] ?? 0),
    0,
  );
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase();
}

export default function EmployeeTaskManagerPage() {
  const user = useAuthStore((state) => state.user);

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

  const { data: projectCatalog = [] } = useQuery({
    queryKey: ["projectCatalog"],
    queryFn: () => api.getProjectCatalog(),
  });

  const { data: projectBudgetSummary = [] } = useQuery({
    queryKey: ["project-budget-summary"],
    queryFn: api.getProjectBudgetSummary,
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["employee-timesheets", employee?.id],
    queryFn: () => api.getTimesheets({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  const projectSummaryLookup = useMemo(
    () => new Map(projectBudgetSummary.map((project) => [normalizeLookup(project.project), project])),
    [projectBudgetSummary],
  );

  const taskUsageById = useMemo(() => {
    const usage = new Map<string, number>();

    for (const timesheet of timesheets) {
      if (timesheet.status === "rejected") {
        continue;
      }

      for (const line of timesheet.lines) {
        if (!line.projectTaskId) {
          continue;
        }

        usage.set(line.projectTaskId, (usage.get(line.projectTaskId) ?? 0) + lineTotal(line));
      }
    }

    return usage;
  }, [timesheets]);

  const taskProjects = useMemo(() => {
    const projects = projectCatalog
      .map((project) => {
        const summaryProject = projectSummaryLookup.get(normalizeLookup(project.project));
        const tasks = project.tasks
          .filter((task) => task.status === "active")
          .map((task) => {
            const summaryTask = summaryProject?.tasks.find((item) => item.id === task.id);
            const allocatedHours = summaryTask?.maxHours ?? task.maxHours ?? 0;
            const hourLimitScope = summaryTask?.hourLimitScope ?? task.hourLimitScope ?? "overall";
            const myLoggedHours = Number((taskUsageById.get(task.id) ?? 0).toFixed(2));
            const overallUsedHours =
              typeof summaryTask?.usedHours === "number"
                ? Number(summaryTask.usedHours.toFixed(2))
                : 0;
            const remainingHours =
              allocatedHours > 0
                ? hourLimitScope === "per_employee"
                  ? Math.max(0, Number((allocatedHours - myLoggedHours).toFixed(2)))
                  : typeof summaryTask?.remainingHours === "number"
                    ? Math.max(0, Number(summaryTask.remainingHours.toFixed(2)))
                    : Math.max(0, Number((allocatedHours - overallUsedHours).toFixed(2)))
                : undefined;
            const progressBase = hourLimitScope === "per_employee" ? myLoggedHours : overallUsedHours;
            const progress = allocatedHours > 0 ? Math.min(100, Number(((progressBase / allocatedHours) * 100).toFixed(1))) : 0;

            return {
              id: task.id,
              name: task.name,
              description: task.description ?? "",
              allocatedHours,
              myLoggedHours,
              hourLimitScope,
              remainingHours,
              durationDays: summaryTask?.durationDays ?? task.durationDays,
              progress,
            };
          })
          .filter((task) => task.allocatedHours > 0 || task.myLoggedHours > 0);

        return {
          id: project.id,
          project: project.project,
          client: project.client,
          tasks,
        };
      })
      .filter((project) => project.tasks.length > 0);

    return projects.sort((left, right) => left.project.localeCompare(right.project));
  }, [projectCatalog, projectSummaryLookup, taskUsageById]);

  const totals = useMemo(() => {
    const allTasks = taskProjects.flatMap((project) => project.tasks);

    return {
      projectCount: taskProjects.length,
      taskCount: allTasks.length,
      allocated: allTasks.reduce((sum, task) => sum + task.allocatedHours, 0),
      completed: allTasks.reduce((sum, task) => sum + task.myLoggedHours, 0),
      remaining: allTasks.reduce((sum, task) => sum + (task.remainingHours ?? 0), 0),
    };
  }, [taskProjects]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Task Manager</h1>
          <p className="text-sm text-muted-foreground">
            Review the project tasks created by admin, how many hours are allocated, what you have logged, and what remains.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard label="Projects" value={String(totals.projectCount)} icon={<FolderKanban className="h-5 w-5" />} />
          <DashboardCard label="Tasks Assigned" value={String(totals.taskCount)} icon={<Layers3 className="h-5 w-5" />} />
          <DashboardCard label="Hours Completed" value={formatHours(totals.completed)} icon={<Clock3 className="h-5 w-5" />} />
          <DashboardCard label="Hours Remaining" value={formatHours(totals.remaining)} icon={<BarChart3 className="h-5 w-5" />} />
        </div>

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium">My Project Tasks</CardTitle>
            <CardDescription>Each task shows the admin allocation, the hours you have already used, and the balance left for you to fill.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {taskProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center text-sm text-muted-foreground">
                No active project tasks are available yet.
              </div>
            ) : (
              taskProjects.map((project) => (
                <div key={project.id} className="overflow-hidden rounded-2xl border border-border/60 bg-background/60">
                  <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{project.project}</p>
                        {project.client ? (
                          <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                            {project.client}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {project.tasks.length} active task{project.tasks.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-border/60">
                    {project.tasks.map((task) => (
                      <div key={task.id} className="space-y-4 px-4 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground">{task.name}</p>
                            <p className="text-sm text-muted-foreground">{task.description || "No short description added."}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                              Allocated {formatHours(task.allocatedHours)}
                            </Badge>
                            <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                              {task.hourLimitScope === "per_employee" ? "Per employee cap" : "Overall pool"}
                            </Badge>
                            {task.durationDays ? (
                              <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                                {task.durationDays} day window
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Admin allocated</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{formatHours(task.allocatedHours)}</p>
                          </div>
                          <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Completed by me</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{formatHours(task.myLoggedHours)}</p>
                          </div>
                          <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Remaining</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{formatHours(task.remainingHours)}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {task.hourLimitScope === "per_employee" ? "Your remaining hours" : "Team hours still available"}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{task.hourLimitScope === "per_employee" ? "Progress used" : "Pool used"}</span>
                            <span>{task.progress}%</span>
                          </div>
                          <Progress value={task.progress} className="h-2.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
