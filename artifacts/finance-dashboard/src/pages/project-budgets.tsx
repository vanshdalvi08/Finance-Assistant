import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BriefcaseBusiness,
  BarChart3,
  FolderKanban,
  Layers3,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProjectRecord = Awaited<ReturnType<typeof api.getProjectBudgets>>[number];
type TimesheetRecord = Awaited<ReturnType<typeof api.getTimesheets>>[number];
type EmployeeRecord = Awaited<ReturnType<typeof api.getEmployees>>[number];
const PROJECT_BUDGET_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type TaskDraft = {
  id?: string;
  name: string;
  description: string;
  maxHours: string;
  startDate: string;
  endDate: string;
  hourLimitScope: "overall" | "per_employee";
  subTasks: string;
  status: "active" | "archived";
};

type ProjectForm = {
  id?: string;
  project: string;
  client: string;
  note: string;
  tasks: TaskDraft[];
};

const EMPTY_TASK: TaskDraft = {
  name: "",
  description: "",
  maxHours: "",
  startDate: "",
  endDate: "",
  hourLimitScope: "overall",
  subTasks: "",
  status: "active",
};

function cloneEmptyTask(): TaskDraft {
  return { ...EMPTY_TASK };
}

function normalizeTaskHourLimitScope(value: string): TaskDraft["hourLimitScope"] {
  return value === "per_employee" ? "per_employee" : "overall";
}

function formatCapacityHours(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `${Number(value.toFixed(1)).toString()}h`;
}

function formatTaskWindowLabel(task: { startDate?: string; endDate?: string; durationDays?: number }) {
  if (task.startDate && task.endDate) {
    return `${format(new Date(`${task.startDate}T12:00:00`), "dd MMM yyyy")} - ${format(new Date(`${task.endDate}T12:00:00`), "dd MMM yyyy")}`;
  }

  return task.durationDays ? `${task.durationDays}d window` : null;
}

function lineTotal(line: TimesheetRecord["lines"][number]) {
  return PROJECT_BUDGET_DAY_KEYS.reduce(
    (sum, day) => sum + Number(line.hours[day] ?? 0),
    0,
  );
}

function lineHoursWithinTaskWindow(
  weekStart: string,
  line: TimesheetRecord["lines"][number],
  task?: { startDate?: string; endDate?: string },
) {
  const startDate = task?.startDate;
  const endDate = task?.endDate;
  if (!startDate || !endDate) {
    return lineTotal(line);
  }

  return PROJECT_BUDGET_DAY_KEYS.reduce((sum, day, index) => {
    const hours = Number(line.hours[day] ?? 0);
    if (hours <= 0) {
      return sum;
    }

    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const dateIso = format(date, "yyyy-MM-dd");
    return dateIso >= startDate && dateIso <= endDate ? sum + hours : sum;
  }, 0);
}


function toForm(project?: ProjectRecord | null): ProjectForm {
  if (!project) {
    return {
      project: "",
      client: "",
      note: "",
      tasks: [cloneEmptyTask()],
    };
  }

  return {
    id: project.id,
    project: project.project,
    client: project.client ?? "",
    note: project.note ?? "",
        tasks: project.tasks.length
          ? project.tasks.map((task) => ({
          id: task.id,
          name: task.name,
          description: task.description ?? "",
          maxHours: task.maxHours ? String(task.maxHours) : "",
          startDate: task.startDate ?? "",
          endDate: task.endDate ?? "",
          hourLimitScope: task.hourLimitScope === "per_employee" ? "per_employee" : "overall",
          subTasks: task.subTasks?.join("\n") ?? "",
          status: task.status === "archived" ? "archived" : "active",
        }))
      : [cloneEmptyTask()],
  };
}

export default function ProjectBudgetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [showCapacityInspector, setShowCapacityInspector] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("all");
  const [form, setForm] = useState<ProjectForm>(() => toForm(null));

  const { data: projects = [] } = useQuery({
    queryKey: ["projectBudgets"],
    queryFn: () => api.getProjectBudgets(),
  });

  const { data: projectBudgetSummary = [] } = useQuery({
    queryKey: ["projectBudgetSummary"],
    queryFn: api.getProjectBudgetSummary,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: api.getEmployees,
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["timesheets"],
    queryFn: () => api.getTimesheets(),
  });

  const summaryLookup = useMemo(
    () => new Map(projectBudgetSummary.map((summary) => [summary.id, summary])),
    [projectBudgetSummary],
  );
  const taskWindowLookup = useMemo(
    () =>
      new Map(
        projects.flatMap((project) =>
          project.tasks.map((task) => [task.id, { startDate: task.startDate, endDate: task.endDate }] as const),
        ),
      ),
    [projects],
  );

  const employeeOptions = useMemo(
    () => [{ id: "all", name: "All employees" }, ...employees.map((employee) => ({ id: employee.id, name: employee.name }))],
    [employees],
  );

  const taskUsageLookup = useMemo(() => {
    const lookup = new Map<
      string,
      {
        total: number;
        byEmployee: Map<string, number>;
      }
    >();

    for (const timesheet of timesheets) {
      if (timesheet.status === "rejected") {
        continue;
      }

      for (const line of timesheet.lines) {
        if (!line.projectTaskId) {
          continue;
        }

        const lineHours = lineHoursWithinTaskWindow(timesheet.weekStart, line, taskWindowLookup.get(line.projectTaskId));
        if (lineHours <= 0) {
          continue;
        }

        const current = lookup.get(line.projectTaskId) ?? { total: 0, byEmployee: new Map<string, number>() };
        current.total += lineHours;
        current.byEmployee.set(timesheet.employeeId, (current.byEmployee.get(timesheet.employeeId) ?? 0) + lineHours);
        lookup.set(line.projectTaskId, current);
      }
    }

    return lookup;
  }, [taskWindowLookup, timesheets]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return projects;
    }

    return projects.filter((project) => {
      const taskText = project.tasks
        .map((task) => `${task.name} ${task.description ?? ""} ${(task.subTasks ?? []).join(" ")}`)
        .join(" ");
      return [project.project, project.client ?? "", project.note ?? "", taskText]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [projects, search]);

  const stats = useMemo(() => {
    const totalTasks = projects.reduce((sum, project) => sum + project.tasks.length, 0);
    const activeTasks = projects.reduce(
      (sum, project) => sum + project.tasks.filter((task) => task.status === "active").length,
      0,
    );
    const clients = new Set(projects.map((project) => project.client?.trim()).filter(Boolean));

    return {
      projects: projects.length,
      totalTasks,
      activeTasks,
      clients: clients.size,
    };
  }, [projects]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const project = form.project.trim();
      if (!project) {
        throw new Error("Project name is required.");
      }

      const tasks = form.tasks
        .map((task) => ({
          id: task.id,
          name: task.name.trim(),
          description: task.description.trim(),
          maxHours: Math.max(0, Number(task.maxHours || 0)) || undefined,
          startDate: task.startDate || undefined,
          endDate: task.endDate || undefined,
          hourLimitScope: normalizeTaskHourLimitScope(task.hourLimitScope),
          subTasks: task.subTasks
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean)
            .filter((value, index, array) => array.indexOf(value) === index),
          status: task.status,
        }))
        .filter((task) => task.name.length > 0);

      return api.saveProjectBudget({
        id: form.id,
        project,
        totalBudget: 0,
        client: form.client.trim(),
        note: form.note.trim(),
        tasks,
        actorName: "Admin",
      });
    },
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectRecord[]>(["projectBudgets"], (current = []) => [
        project,
        ...current.filter((item) => item.id !== project.id),
      ]);
      queryClient.setQueryData<ProjectRecord[]>(["projectCatalog"], (current = []) => [
        project,
        ...current.filter((item) => item.id !== project.id),
      ]);
      queryClient.setQueryData<string[]>(["projectNames"], (current = []) => [
        project.project,
        ...current.filter((name) => name !== project.project),
      ]);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectBudgetSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["auditTrail"] }),
      ]);
      toast({
        title: form.id ? "Project updated" : "Project created",
        description: "The project and task list are saved and ready for timesheet use.",
      });
      setEditorOpen(false);
      setForm(toForm(null));
    },
    onError: (error) => {
      toast({
        title: "Could not save project",
        description: error instanceof Error ? error.message : "Please review the form and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProjectBudget(id, "Admin"),
    onSuccess: (_data, deletedId) => {
      const deletedProject = queryClient
        .getQueryData<ProjectRecord[]>(["projectBudgets"])
        ?.find((project) => project.id === deletedId);

      queryClient.setQueryData<ProjectRecord[]>(["projectBudgets"], (current = []) =>
        current.filter((project) => project.id !== deletedId),
      );
      queryClient.setQueryData<ProjectRecord[]>(["projectCatalog"], (current = []) =>
        current.filter((project) => project.id !== deletedId),
      );
      queryClient.setQueryData<string[]>(["projectNames"], (current = []) =>
        deletedProject ? current.filter((name) => name !== deletedProject.project) : current,
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectBudgetSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["auditTrail"] }),
      ]);
      toast({
        title: "Project removed",
        description: "The project and its task list have been deleted.",
      });
    },
  });

  function openCreate() {
    setForm(toForm(null));
    setEditorOpen(true);
  }

  function openEdit(project: ProjectRecord) {
    setForm(toForm(project));
    setEditorOpen(true);
  }

  function updateTask(index: number, field: keyof TaskDraft, value: string) {
    setForm((current) => ({
      ...current,
      tasks: current.tasks.map((task, taskIndex) =>
        taskIndex === index
          ? {
              ...task,
              [field]: field === "status" ? (value as TaskDraft["status"]) : value,
            }
          : task,
      ),
    }));
  }

  function addTaskRow() {
    setForm((current) => ({
      ...current,
      tasks: [...current.tasks, cloneEmptyTask()],
    }));
  }

  function removeTaskRow(index: number) {
    setForm((current) => ({
      ...current,
      tasks:
        current.tasks.length === 1
          ? [cloneEmptyTask()]
          : current.tasks.filter((_, taskIndex) => taskIndex !== index),
    }));
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">
              Create project names, assign optional clients, and maintain a clean admin-owned task catalog for employee timesheets.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search project, client, or task"
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-border/60"
              onClick={() => setShowCapacityInspector((current) => !current)}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              {showCapacityInspector ? "Hide hours" : "View hours"}
            </Button>
            <Button className="rounded-xl" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Project
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard label="Projects" value={String(stats.projects)} icon={<FolderKanban className="h-5 w-5" />} />
          <DashboardCard label="Task Rows" value={String(stats.totalTasks)} icon={<Layers3 className="h-5 w-5" />} />
          <DashboardCard label="Active Tasks" value={String(stats.activeTasks)} icon={<BriefcaseBusiness className="h-5 w-5" />} />
          <DashboardCard label="Clients" value={String(stats.clients)} icon={<Users className="h-5 w-5" />} />
        </div>

        {showCapacityInspector ? (
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-medium">Project Hours Inspector</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Review initialized task hours, what has been claimed, and what remains across the current project budget.
                </p>
              </div>
              <div className="w-full max-w-xs space-y-2">
                <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Employee</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employeeOptions.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {filteredProjects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                  No matching projects found.
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const projectTasks = project.tasks.filter((task) => task.status === "active" || task.status === "archived");

                  if (projectTasks.length === 0) {
                    return null;
                  }

                  return (
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
                            {projectTasks.length} task{projectTasks.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {selectedEmployeeId === "all"
                            ? "Showing team totals"
                            : `Showing ${employeeOptions.find((employee) => employee.id === selectedEmployeeId)?.name ?? "selected employee"}`}
                        </div>
                      </div>

                      <div className="grid grid-cols-[minmax(0,2fr)_minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)] border-b border-border/60 bg-secondary/10 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        <span>Task</span>
                        <span>Initialized</span>
                        <span>Claimed</span>
                        <span>Remaining</span>
                      </div>

                      <div className="divide-y divide-border/60">
                        {projectTasks.map((task) => {
                          const summaryTask = summaryLookup.get(project.id)?.tasks.find((item) => item.id === task.id);
                          const maxHours = summaryTask?.maxHours ?? task.maxHours;
                          const hourLimitScope = summaryTask?.hourLimitScope ?? task.hourLimitScope ?? "overall";
                          const allClaimedHours = taskUsageLookup.get(task.id)?.total ?? 0;
                          const employeeClaimedHours =
                            selectedEmployeeId === "all"
                              ? allClaimedHours
                              : taskUsageLookup.get(task.id)?.byEmployee.get(selectedEmployeeId) ?? 0;
                          const claimedHours = selectedEmployeeId === "all" ? allClaimedHours : employeeClaimedHours;
                          const overallRemainingHours =
                            typeof maxHours === "number"
                              ? Math.max(0, Number((maxHours - allClaimedHours).toFixed(2)))
                              : undefined;
                          const perEmployeeRemainingHours =
                            typeof maxHours === "number"
                              ? Math.max(0, Number((maxHours - employeeClaimedHours).toFixed(2)))
                              : undefined;
                          const remainingHours =
                            hourLimitScope === "per_employee"
                              ? selectedEmployeeId === "all"
                                ? undefined
                                : perEmployeeRemainingHours
                              : overallRemainingHours;
                          const initializedLabel = [
                            typeof maxHours === "number"
                              ? `${formatCapacityHours(maxHours)} max ${hourLimitScope === "per_employee" ? "per employee" : "overall"}`
                              : "No hour cap",
                            formatTaskWindowLabel(task),
                          ]
                            .filter(Boolean)
                            .join(" - ");

                          return (
                            <div key={task.id} className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)] md:items-center">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">{task.name}</p>
                                  {task.subTasks?.length ? (
                                    <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                                      {task.subTasks.length} sub tasks
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="text-sm text-muted-foreground">{task.description || "No short description added."}</p>
                              </div>

                              <div className="text-sm text-muted-foreground">
                                <div className="font-medium text-foreground">{initializedLabel || "-"}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {task.subTasks?.length ? task.subTasks.slice(0, 2).join(", ") : "No sub tasks"}
                                  {task.subTasks && task.subTasks.length > 2 ? ` +${task.subTasks.length - 2} more` : ""}
                                </div>
                              </div>

                              <div className="text-sm text-muted-foreground">
                                <div className="font-medium text-foreground">{formatCapacityHours(claimedHours)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">Used by {selectedEmployeeId === "all" ? "team" : "selected employee"}</div>
                              </div>

                              <div className="text-sm text-muted-foreground">
                                <div className="font-medium text-foreground">{formatCapacityHours(remainingHours)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {hourLimitScope === "per_employee"
                                    ? selectedEmployeeId === "all"
                                      ? "Select an employee to inspect remaining"
                                      : "Remaining for selected employee"
                                    : selectedEmployeeId === "all"
                                      ? "Available to team"
                                      : "Remaining overall pool"}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium">Project & Task Catalog</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center text-sm text-muted-foreground">
                No projects yet. Create one to start assigning tasks for employees.
              </div>
            ) : (
              filteredProjects.map((project) => (
                <div key={project.id} className="rounded-2xl border border-border/60 bg-secondary/10 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-foreground">{project.project}</h2>
                        {project.client ? (
                          <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                            {project.client}
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                          {project.tasks.length} tasks
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Created {format(new Date(project.createdAt), "dd MMM yyyy")}
                        {" - "}
                        Updated {format(new Date(project.updatedAt), "dd MMM yyyy")}
                      </p>
                      {project.note ? (
                        <p className="max-w-3xl text-sm text-muted-foreground">{project.note}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" className="rounded-xl" onClick={() => openEdit(project)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(project.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Task Rows</p>
                      <p className="mt-1 text-base font-semibold">{project.tasks.length}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Active Tasks</p>
                      <p className="mt-1 text-base font-semibold">
                        {project.tasks.filter((task) => task.status === "active").length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Archived Tasks</p>
                      <p className="mt-1 text-base font-semibold">
                        {project.tasks.filter((task) => task.status === "archived").length}
                      </p>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <BriefcaseBusiness className="h-4 w-4 text-muted-foreground" />
                    Admin-defined task list
                  </div>
                  <div className="mt-3 space-y-3">
                    {project.tasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 px-4 py-4 text-sm text-muted-foreground">
                        No tasks added yet. Edit this project to add work items for employees.
                      </div>
                    ) : (
                      project.tasks.map((task) => (
                        <div key={task.id} className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">{task.name}</p>
                                {task.subTasks?.length ? (
                                  <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal">
                                    {task.subTasks.length} sub tasks
                                  </Badge>
                                ) : null}
                              </div>
                              {task.description ? <p className="text-sm text-muted-foreground">{task.description}</p> : null}
                              {task.subTasks?.length ? (
                                <p className="text-xs text-muted-foreground">
                                  {task.subTasks.slice(0, 2).join(", ")}
                                  {task.subTasks.length > 2 ? ` +${task.subTasks.length - 2} more` : ""}
                                </p>
                              ) : null}
                            </div>
                            <Badge variant="outline" className="rounded-full border-border/60 bg-background/50 font-normal capitalize">
                              {task.status}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Project" : "Create Project"}</DialogTitle>
            <DialogDescription>
              Keep this simple for admin: create the project, add the task list, and come back later whenever new tasks need to be added.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input
                  value={form.project}
                  onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))}
                  placeholder="Client website redesign"
                />
              </div>
              <div className="space-y-2">
                <Label>Client Name</Label>
                <Input
                  value={form.client}
                  onChange={(event) => setForm((current) => ({ ...current, client: event.target.value }))}
                  placeholder="Optional client name"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Scope notes, delivery context, or anything the admin should remember"
                  rows={4}
                />
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Project Tasks</p>
                <p className="text-xs text-muted-foreground">
                  These tasks become admin-controlled dropdown items for employees.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={addTaskRow}>
                <Plus className="mr-2 h-4 w-4" />
                Add Task
              </Button>
            </div>

            <div className="space-y-4">
              {form.tasks.map((task, index) => (
                <div key={task.id ?? `task-${index}`} className="rounded-2xl border border-border/60 bg-secondary/10 p-5">
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_160px_auto] md:items-end">
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Task name</Label>
                        <Input
                          value={task.name}
                          onChange={(event) => updateTask(index, "name", event.target.value)}
                          placeholder="Website QA review"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                        <Select value={task.status} onValueChange={(value) => updateTask(index, "status", value)}>
                          <SelectTrigger className="rounded-xl">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-xl text-muted-foreground hover:text-destructive"
                          onClick={() => removeTaskRow(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.95fr)]">
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Short description</Label>
                        <Input
                          value={task.description}
                          onChange={(event) => updateTask(index, "description", event.target.value)}
                          placeholder="Short task description"
                        />
                      </div>

                      <div className="rounded-xl border border-border/60 bg-background/55 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Capacity & window</p>
                            <p className="text-[11px] text-muted-foreground">Set the cap, scope, and active claim period.</p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[110px_minmax(170px,0.9fr)]">
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-muted-foreground">Max hours</Label>
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              value={task.maxHours}
                              onChange={(event) => updateTask(index, "maxHours", event.target.value)}
                              placeholder="0"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-muted-foreground">Hour scope</Label>
                            <Select value={task.hourLimitScope} onValueChange={(value) => updateTask(index, "hourLimitScope", value)}>
                              <SelectTrigger className="rounded-xl">
                                <SelectValue placeholder="Select scope" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="overall">Overall total</SelectItem>
                                <SelectItem value="per_employee">Per employee</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-muted-foreground">Start date</Label>
                            <Input
                              type="date"
                              value={task.startDate}
                              onChange={(event) => updateTask(index, "startDate", event.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-muted-foreground">End date</Label>
                            <Input
                              type="date"
                              value={task.endDate}
                              onChange={(event) => updateTask(index, "endDate", event.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Sub tasks</Label>
                      <Textarea
                        value={task.subTasks}
                        onChange={(event) => updateTask(index, "subTasks", event.target.value)}
                        placeholder="Planning\nReview\nClient handoff"
                        rows={3}
                        className="min-h-20 rounded-xl"
                      />
                      <p className="text-[11px] text-muted-foreground">Add one sub task per line or separate them with commas.</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Admin can always come back later, edit the project, and add more tasks.
              </p>
              <Button className="rounded-xl" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Project
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
