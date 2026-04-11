import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import {
  createId,
  nowIso,
  pushAuditEvent,
  readStore,
  type ProjectBudget,
  updateStore,
} from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);

const projectTaskSchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  maxHours: z.coerce.number().min(0).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const projectSchema = z.object({
  id: businessIdSchema.optional(),
  project: z.string().trim().min(2),
  totalBudget: z.coerce.number().min(0),
  client: z.string().trim().optional(),
  note: z.string().trim().optional(),
  tasks: z.array(projectTaskSchema).optional(),
});

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function tenantProjectFilter(project: ProjectBudget, tenantId: string) {
  return (project.tenantId ?? DEFAULT_TENANT_ID) === tenantId;
}

function recordActor(request: Request): { actorUserId?: string; requestId?: string; tenantId: string; actorName: string; actorRole: ActorRole } {
  return {
    actorUserId: request.auth?.user.id,
    requestId: String(request.id),
    tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  };
}

router.get("/projects", requireTenantRole("admin"), async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const includeArchived = request.query.includeArchived === "true";
  const projectBudgets = store.projectBudgets
    .filter((budget) => tenantProjectFilter(budget, tenantId))
    .filter((budget) => includeArchived || budget.status !== "archived");
  response.json({
    projectBudgets: [...projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
    projects: [...projectBudgets].sort((left, right) => left.project.localeCompare(right.project)),
  });
});

router.get("/projects/catalog", async (request, response) => {
  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const includeArchived = request.query.includeArchived === "true";
  const projects = store.projectBudgets
    .filter((budget) => tenantProjectFilter(budget, tenantId))
    .filter((budget) => includeArchived || budget.status !== "archived")
    .sort((left, right) => left.project.localeCompare(right.project))
    .map((budget) => ({
      id: budget.id,
      project: budget.project,
      client: budget.client,
      notes: budget.note,
      totalBudget: budget.totalBudget,
      status: budget.status,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      tasks: [...budget.tasks].filter((task) => task.status !== "archived").sort((left, right) => left.name.localeCompare(right.name)),
    }));

  response.json({ projectCatalog: projects, projects });
});

router.post("/projects", requireTenantRole("admin"), async (request, response) => {
  const parsed = projectSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project payload" });
    return;
  }

  const store = await readStore();
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const existing = parsed.data.id ? store.projectBudgets.find((budget) => budget.id === parsed.data.id) : null;
  if (existing && !tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  const budget: ProjectBudget = {
    id: parsed.data.id ?? existing?.id ?? createId("pb"),
    tenantId,
    status: existing?.status ?? "active",
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing?.client,
    note: parsed.data.note?.trim() || existing?.note,
    tasks: (parsed.data.tasks ?? existing?.tasks ?? []).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
      status: task.status === "archived" ? "archived" : "active",
    })),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: existing ? store.projectBudgets.map((item) => (item.id === budget.id ? budget : item)) : [budget, ...store.projectBudgets],
    },
    {
      ...recordActor(request),
      action: existing ? "updated" : "created",
      entityType: "project-budget",
      entityId: budget.id,
      summary: `${existing ? "Updated" : "Added"} budget for project ${budget.project}.`,
      details: {
        entityLabel: budget.project,
        requestId: String(request.id),
        changedFields: ["project", "totalBudget", "client", "note", "tasks"],
        before: existing
          ? {
              id: existing.id,
              project: existing.project,
              totalBudget: existing.totalBudget,
              client: existing.client ?? null,
              note: existing.note ?? null,
              taskCount: existing.tasks.length,
            }
          : null,
        after: {
          id: budget.id,
          project: budget.project,
          totalBudget: budget.totalBudget,
          client: budget.client ?? null,
          note: budget.note ?? null,
          taskCount: budget.tasks.length,
        },
        context: { operation: existing ? "project_update" : "project_create" },
      },
    },
  );

  await updateStore(() => next);
  response.status(existing ? 200 : 201).json({ projectBudget: budget, project: budget });
});

router.route("/projects/:id").get(async (request, response) => {
  const store = await readStore();
  const project = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!project) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(project, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  response.json({ projectBudget: project, project });
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = projectSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project payload" });
    return;
  }

  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  const budget: ProjectBudget = {
    ...existing,
    tenantId,
    project: parsed.data.project.trim(),
    totalBudget: Math.abs(parsed.data.totalBudget),
    client: parsed.data.client?.trim() || existing.client,
    note: parsed.data.note?.trim() || existing.note,
    tasks: (parsed.data.tasks ?? existing.tasks).filter((task) => task.name.trim()).map((task) => ({
      id: task.id ?? createId("pbt"),
      name: task.name.trim(),
      description: task.description?.trim() || undefined,
      maxHours: Number(task.maxHours ?? 0) > 0 ? Number(task.maxHours) : undefined,
      status: task.status === "archived" ? "archived" : "active",
    })),
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.map((item) => (item.id === budget.id ? budget : item)),
    },
    {
      ...recordActor(request),
      action: "updated",
      entityType: "project-budget",
      entityId: budget.id,
      summary: `Updated budget for project ${budget.project}.`,
      details: {
        entityLabel: budget.project,
        requestId: String(request.id),
        changedFields: ["project", "totalBudget", "client", "note", "tasks"],
        before: {
          id: existing.id,
          project: existing.project,
          totalBudget: existing.totalBudget,
          client: existing.client ?? null,
          note: existing.note ?? null,
          taskCount: existing.tasks.length,
        },
        after: {
          id: budget.id,
          project: budget.project,
          totalBudget: budget.totalBudget,
          client: budget.client ?? null,
          note: budget.note ?? null,
          taskCount: budget.tasks.length,
        },
        context: { operation: "project_update" },
      },
    },
  );

  await updateStore(() => next);
  response.json({ projectBudget: budget, project: budget });
}).delete(requireTenantRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status === "archived") {
    response.status(204).send();
    return;
  }

  const archivedProject: ProjectBudget = {
    ...existing,
    status: "archived",
    updatedAt: nowIso(),
  };

  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.map((budget) => (budget.id === existing.id ? archivedProject : budget)),
    },
    {
      ...recordActor(request),
      action: "archived",
      entityType: "project-budget",
      entityId: String(request.params.id),
      summary: `Archived project budget ${existing.project}.`,
      details: {
        entityLabel: existing.project,
        requestId: String(request.id),
        changedFields: ["status"],
        before: {
          id: existing.id,
          project: existing.project,
          status: existing.status,
          totalBudget: existing.totalBudget,
          client: existing.client ?? null,
          note: existing.note ?? null,
          taskCount: existing.tasks.length,
        },
        after: {
          id: archivedProject.id,
          project: archivedProject.project,
          status: archivedProject.status,
          totalBudget: archivedProject.totalBudget,
          client: archivedProject.client ?? null,
          note: archivedProject.note ?? null,
          taskCount: archivedProject.tasks.length,
        },
        context: { operation: "project_archive" },
      },
    },
  );

  await updateStore(() => next);
  response.status(204).send();
});

router.post("/projects/:id/tasks", requireTenantRole("admin"), async (request, response) => {
  const parsed = projectTaskSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid project task payload" });
    return;
  }

  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }
  if (existing.status === "archived") {
    response.status(409).json({ message: "Archived projects cannot be modified." });
    return;
  }

  const task: ProjectBudget["tasks"][number] = {
    id: parsed.data.id ?? createId("pbt"),
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || undefined,
    maxHours: Number(parsed.data.maxHours ?? 0) > 0 ? Number(parsed.data.maxHours) : undefined,
    status: parsed.data.status === "archived" ? "archived" : "active",
  };
  const next = pushAuditEvent(
    {
      ...store,
      projectBudgets: store.projectBudgets.map((budget) =>
        budget.id === request.params.id ? { ...budget, tasks: [...budget.tasks, task], updatedAt: nowIso() } : budget,
      ),
    },
    {
      ...recordActor(request),
      action: "created",
      entityType: "project-budget",
      entityId: String(request.params.id),
      summary: `Added task ${task.name} to ${existing.project}.`,
      details: {
        entityLabel: task.name,
        requestId: String(request.id),
        changedFields: ["tasks"],
        before: {
          id: existing.id,
          project: existing.project,
          totalBudget: existing.totalBudget,
          taskCount: existing.tasks.length,
        },
        after: {
          id: existing.id,
          project: existing.project,
          totalBudget: existing.totalBudget,
          taskCount: existing.tasks.length + 1,
        },
        context: { operation: "project_task_add" },
      },
    },
  );

  await updateStore(() => next);
  response.status(201).json({ task });
});

export default router;
