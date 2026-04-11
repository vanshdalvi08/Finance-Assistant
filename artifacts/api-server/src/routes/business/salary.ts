import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { type SalaryRecord } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyEmployee, notifyUsersByIds } from "../../lib/notifications";
import {
  deleteSalary,
  getSalaryForActor,
  listSalariesForActor,
  paySalary,
  SalaryServiceError,
  saveSalary,
} from "../../lib/services/salary-service";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);
const dateSchema = z.string().min(1);

const salarySchema = z.object({
  id: businessIdSchema.optional(),
  employeeId: z.string().uuid(),
  employeeNameSnapshot: z.string().trim().optional(),
  amount: z.coerce.number().min(1),
  date: dateSchema.optional(),
  note: z.string().trim().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  source: z.enum(["manual", "timesheet"]).optional(),
  paidAt: dateSchema.optional(),
  weekStart: dateSchema.optional(),
  hours: z.coerce.number().optional(),
  rate: z.coerce.number().optional(),
  timesheetId: businessIdSchema.optional(),
});

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    console.error("Failed to deliver notification", error);
  });
  return Promise.resolve();
}

function scopedEmployeeId(request: Request, fallback?: string) {
  if (request.auth?.user.role === "employee") {
    return request.auth.user.id;
  }

  return fallback?.trim() || null;
}

function recordActor(request: Request): { userId?: string; requestId?: string; tenantId: string; actorName: string; actorRole: ActorRole } {
  return {
    userId: request.auth?.user.id,
    requestId: String(request.id),
    tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
    actorName: request.auth?.user.name ?? "System",
    actorRole: request.auth?.user.role ?? "system",
  };
}

function notificationActor(request: Request) {
  return {
    id: request.auth?.user.id,
    name: request.auth?.user.name ?? "System",
    role: request.auth?.user.role ?? "system",
    tenantId: request.auth?.user.tenantId,
  } as const;
}

function handleServiceError(error: unknown, response: Response) {
  if (!(error instanceof SalaryServiceError)) {
    throw error;
  }

  if (error.code === "not_found") {
    respondNotFound(response, error.message);
    return true;
  }

  if (error.code === "forbidden") {
    response.status(403).json({ message: error.message });
    return true;
  }

  if (error.code === "insufficient_funds") {
    response.status(400).json({ message: error.message });
    return true;
  }

  if (error.code === "invalid_input") {
    response.status(400).json({ message: error.message });
    return true;
  }

  return false;
}

router.get("/salaries", async (request, response) => {
  try {
    const salaries = await listSalariesForActor(
      request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      request.auth?.user.role,
      request.auth?.user.id,
      scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId),
    );
    response.json({ salaries });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.post("/salaries", requireTenantRole("admin"), async (request, response) => {
  const parsed = salarySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payload" });
    return;
  }

  let salary: SalaryRecord;
  let created = false;
  try {
    const result = await saveSalary(parsed.data, recordActor(request));
    salary = result.salary;
    created = result.created;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(created ? 201 : 200).json({ salary });
});

router.route("/salaries/:id").get(async (request, response) => {
  try {
    const salary = await getSalaryForActor(
      routeParam(request.params.id),
      request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      request.auth?.user.role,
      request.auth?.user.id,
    );
    response.json({ salary });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = salarySchema.safeParse({ ...request.body, id: routeParam(request.params.id) });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payload" });
    return;
  }

  let salary: SalaryRecord;
  let action: "created" | "updated" | "paid";
  let existingStatus: "pending" | "paid" | undefined;
  try {
    const result = await saveSalary(parsed.data, recordActor(request));
    salary = result.salary;
    action = result.action;
    existingStatus = result.existing?.status;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (salary.employeeId && action === "paid" && existingStatus !== "paid") {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "salary_paid",
          title: "Salary updated",
          body: `Salary record for ${salary.employeeNameSnapshot ?? "an employee"} was marked as paid.`,
          link: "/salary",
          email: false,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        salary.employeeId,
        actor,
        {
          type: "salary_paid",
          title: "Salary paid",
          body: `Your salary payment of ${salary.amount.toLocaleString("en-IN")} INR has been marked as paid.`,
          link: "/employee/salary-slips",
          email: true,
          metadata: { salaryId: salary.id, amount: salary.amount },
        },
      ),
    );
  }

  response.json({ salary });
}).delete(requireTenantRole("admin"), async (request, response) => {
  try {
    await deleteSalary(routeParam(request.params.id), recordActor(request));
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  response.status(204).send();
});

router.post("/salaries/:id/pay", requireTenantRole("admin"), async (request, response) => {
  const parsed = z.object({ note: z.string().trim().optional() }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payment payload" });
    return;
  }

  let salary: SalaryRecord;
  let wasAlreadyPaid = false;
  try {
    const result = await paySalary(routeParam(request.params.id), parsed.data.note, recordActor(request));
    salary = result.salary;
    wasAlreadyPaid = result.wasAlreadyPaid;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!wasAlreadyPaid) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "salary_paid",
          title: "Salary payment completed",
          body: `Marked salary payment of ${salary.amount.toLocaleString("en-IN")} INR as paid.`,
          link: "/salary",
          email: false,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        salary.employeeId,
        actor,
        {
          type: "salary_paid",
          title: "Salary paid",
          body: `Your salary payment of ${salary.amount.toLocaleString("en-IN")} INR has been marked as paid.`,
          link: "/employee/salary-slips",
          email: true,
          metadata: { salaryId: salary.id, employeeId: salary.employeeId, amount: salary.amount },
        },
      ),
    );
  }
  response.json({ salary, duplicate: wasAlreadyPaid });
});

export default router;
