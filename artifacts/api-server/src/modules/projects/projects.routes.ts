import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, type ActorRole } from "@workspace/db/schema";
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
import { hashSha256 } from "../../lib/security";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);

const projectTaskSchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  maxHours: z.coerce.number().min(0).optional(),
  durationDays: z.coerce.number().int().min(0).optional(),
  hourLimitScope: z.enum(["overall", "per_employee"]).optional(),
  subTasks: z.array(z.string().trim().min(1)).optional(),
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

type ProjectCrudIdempotencyScope = "project_create" | "project_update" | "project_archive" | "project_task_create";

class ProjectCrudIdempotencyError extends Error {
  code: "conflict";

  constructor(message: string) {
    super(message);
    this.code = "conflict";
  }
}

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function idempotencyKeyFrom(request: Request) {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  return header?.trim() || undefined;
}

function requestHashForProjectMutation(input: z.infer<typeof projectSchema> & { id?: string }) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      project: input.project.trim(),
      totalBudget: Number(input.totalBudget),
      client: input.client?.trim() ?? "",
      note: input.note?.trim() ?? "",
      tasks: (input.tasks ?? []).map((task) => ({
        id: task.id?.trim() ?? "",
        name: task.name.trim(),
        description: task.description?.trim() ?? "",
        maxHours: Number(task.maxHours ?? 0),
        durationDays: Number(task.durationDays ?? 0),
        hourLimitScope: task.hourLimitScope ?? "overall",
        subTasks: (task.subTasks ?? []).map((subTask) => subTask.trim()),
        status: task.status ?? "active",
      })),
    }),
  );
}

function requestHashForProjectDelete(input: { projectId: string }) {
  return hashSha256(JSON.stringify({ projectId: input.projectId.trim() }));
}

function requestHashForProjectTask(input: { projectId: string; task: z.infer<typeof projectTaskSchema> }) {
  return hashSha256(
    JSON.stringify({
      projectId: input.projectId.trim(),
      task: {
        id: input.task.id?.trim() ?? "",
        name: input.task.name.trim(),
        description: input.task.description?.trim() ?? "",
        maxHours: Number(input.task.maxHours ?? 0),
        durationDays: Number(input.task.durationDays ?? 0),
        hourLimitScope: input.task.hourLimitScope ?? "overall",
        subTasks: (input.task.subTasks ?? []).map((subTask) => subTask.trim()),
        status: input.task.status ?? "active",
      },
    }),
  );
}

function normalizeSubTasks(subTasks?: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      (subTasks ?? [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => Boolean(item)),
    ),
  );
}

async function claimProjectCrudIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: ProjectCrudIdempotencyScope,
  key: string,
  requestHash: string,
) {
  const keyHash = hashSha256(key);
  const createdAt = new Date();
  const insertedRows = await db
    .insert(idempotencyKeysTable)
    .values({
      id: createId("idem"),
      tenantId: actor.tenantId,
      scope,
      keyHash,
      requestHash,
      status: "processing",
      createdById: actor.userId ?? null,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .returning();

  if (insertedRows[0]) {
    return { row: insertedRows[0], created: true };
  }

  const rows = await db
    .select()
    .from(idempotencyKeysTable)
    .where(
      and(
        eq(idempotencyKeysTable.tenantId, actor.tenantId),
        eq(idempotencyKeysTable.scope, scope),
        eq(idempotencyKeysTable.keyHash, keyHash),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new ProjectCrudIdempotencyError("Unable to acquire idempotency lock for this project request.");
  }
  if (row.requestHash !== requestHash) {
    throw new ProjectCrudIdempotencyError("This idempotency key is already used for a different project payload.");
  }

  return { row, created: false };
}

function handleProjectCrudIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof ProjectCrudIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
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
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForProjectMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimProjectCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimProjectCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "project_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleProjectCrudIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const replayed = idempotencyClaim.row.responseEntityId ? latest.projectBudgets.find((item) => item.id === idempotencyClaim.row.responseEntityId) : null;
      response.json({ projectBudget: replayed ?? null, project: replayed ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This project request is already being processed. Please retry shortly." });
    return;
  }
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
      durationDays: Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : undefined,
      hourLimitScope: task.hourLimitScope === "per_employee" ? "per_employee" : "overall",
      subTasks: normalizeSubTasks(task.subTasks),
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
  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: budget.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }
  response.status(existing ? 200 : 201).json({ projectBudget: budget, project: budget, duplicate: false });
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
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForProjectMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimProjectCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimProjectCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "project_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleProjectCrudIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const replayed = latest.projectBudgets.find((item) => item.id === request.params.id);
      response.json({ projectBudget: replayed ?? null, project: replayed ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This project update request is already being processed. Please retry shortly." });
    return;
  }
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

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
      durationDays: Number(task.durationDays ?? 0) > 0 ? Number(task.durationDays) : undefined,
      hourLimitScope: task.hourLimitScope === "per_employee" ? "per_employee" : "overall",
      subTasks: normalizeSubTasks(task.subTasks),
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
  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: budget.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }
  response.json({ projectBudget: budget, project: budget, duplicate: false });
}).delete(requireTenantRole("admin"), async (request, response) => {
  const store = await readStore();
  const existing = store.projectBudgets.find((budget) => budget.id === request.params.id);
  if (!existing) {
    respondNotFound(response, "Project not found");
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForProjectDelete({ projectId: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimProjectCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimProjectCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "project_archive",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleProjectCrudIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This project archive request is already being processed. Please retry shortly." });
    return;
  }
  if (!tenantProjectFilter(existing, tenantId)) {
    response.status(403).json({ message: "Forbidden" });
    return;
  }

  if (existing.status === "archived") {
    if (idempotencyClaim?.created) {
      await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: existing.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
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
  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: existing.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }
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
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForProjectTask({ projectId: routeParam(request.params.id), task: parsed.data }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimProjectCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimProjectCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "project_task_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleProjectCrudIdempotencyError(error, response)) return;
    throw error;
  }
  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      const latest = await readStore();
      const project = latest.projectBudgets.find((item) => item.id === request.params.id);
      const task = idempotencyClaim.row.responseEntityId ? project?.tasks.find((item) => item.id === idempotencyClaim.row.responseEntityId) : null;
      response.json({ task: task ?? null, duplicate: true });
      return;
    }
    response.status(409).json({ message: "This project task request is already being processed. Please retry shortly." });
    return;
  }
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
    durationDays: Number(parsed.data.durationDays ?? 0) > 0 ? Number(parsed.data.durationDays) : undefined,
    hourLimitScope: parsed.data.hourLimitScope === "per_employee" ? "per_employee" : "overall",
    subTasks: normalizeSubTasks(parsed.data.subTasks),
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
  if (idempotencyClaim?.created) {
    await db.update(idempotencyKeysTable).set({ status: "completed", responseEntityId: task.id, updatedAt: new Date() }).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }
  response.status(201).json({ task, duplicate: false });
});

export default router;
