import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BriefcaseBusiness,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProjectRecord = Awaited<ReturnType<typeof api.getProjectBudgets>>[number];

type TaskDraft = {
  id?: string;
  name: string;
  description: string;
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
  status: "active",
};

function cloneEmptyTask(): TaskDraft {
  return { ...EMPTY_TASK };
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
  const [form, setForm] = useState<ProjectForm>(() => toForm(null));

  const { data: projects = [] } = useQuery({
    queryKey: ["projectBudgets"],
    queryFn: () => api.getProjectBudgets(),
  });

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return projects;
    }

    return projects.filter((project) => {
      const taskText = project.tasks.map((task) => `${task.name} ${task.description ?? ""}`).join(" ");
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
          status: task.status,
        }))
        .filter((task) => task.name.length > 0);

      await api.saveProjectBudget({
        id: form.id,
        project,
        totalBudget: 0,
        client: form.client.trim(),
        note: form.note.trim(),
        tasks,
        actorName: "Admin",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectBudgets"] }),
        queryClient.invalidateQueries({ queryKey: ["projectCatalog"] }),
        queryClient.invalidateQueries({ queryKey: ["projectNames"] }),
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectBudgets"] }),
        queryClient.invalidateQueries({ queryKey: ["projectCatalog"] }),
        queryClient.invalidateQueries({ queryKey: ["projectNames"] }),
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

        <Card className="border-border/60 bg-card/80 shadow-sm">
          <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base font-medium">Project & Task Catalog</CardTitle>
              <CardDescription>
                Keep this section lightweight for admin: make the project once, add the task list underneath, and let employees pick from the same list in timesheets.
              </CardDescription>
            </div>
            <div className="rounded-xl border border-border/60 bg-secondary/15 px-3 py-2 text-xs text-muted-foreground">
              Employees can still write a custom one-off task if needed.
            </div>
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
                        {" · "}
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
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {project.tasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 px-4 py-4 text-sm text-muted-foreground">
                        No tasks added yet. Edit this project to add work items for employees.
                      </div>
                    ) : (
                      project.tasks.map((task) => (
                        <div key={task.id} className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{task.name}</p>
                              {task.description ? (
                                <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
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

            <div className="space-y-3">
              {form.tasks.map((task, index) => (
                <div key={task.id ?? `task-${index}`} className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_160px_auto]">
                    <Input
                      value={task.name}
                      onChange={(event) => updateTask(index, "name", event.target.value)}
                      placeholder="Task name"
                    />
                    <Input
                      value={task.description}
                      onChange={(event) => updateTask(index, "description", event.target.value)}
                      placeholder="Short task description"
                    />
                    <Select value={task.status} onValueChange={(value) => updateTask(index, "status", value)}>
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
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
