import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  createClientAccount,
  createEmployeeAccount,
  deactivateClientAccount,
  deactivateEmployeeAccount,
  listClients,
  listEmployees,
  updateClientAccount,
  updateEmployeeAccount,
} from "../lib/auth-service";
import { requireAuth, requireRole } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { notifyAdmins, notifyEmployee, notifyUsersByIds } from "../lib/notifications";

const router: IRouter = Router();
const mutationLimiter = rateLimit({
  name: "admin-mutations",
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: "Too many admin changes in a short period. Please try again later.",
});

const createEmployeeSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2),
  salary: z.coerce.number().min(0),
  payType: z.enum(["monthly", "hourly"]).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  profilePhotoUrl: z.string().trim().max(2_500_000).nullable().optional(),
  department: z.string().trim().min(2).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().trim().uuid(),
});

const createClientSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  company: z.string().trim().min(2).optional(),
  address: z.string().trim().optional(),
  website: z.string().trim().optional(),
  billingEmail: z.string().trim().email().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateClientSchema = createClientSchema.extend({
  id: z.string().trim().uuid(),
});

function notificationActor(request: Parameters<typeof requireAuth>[0]) {
  return {
    id: request.auth?.user.id,
    name: request.auth?.user.name ?? "System",
    role: request.auth?.user.role ?? "system",
    tenantId: request.auth?.user.tenantId,
  } as const;
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    console.error("Failed to deliver notification", error);
  });
  return Promise.resolve();
}

router.use(requireAuth, requireRole("admin"));
router.use((request, response, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return mutationLimiter(request, response, next);
  }

  next();
});

router.get("/employees", async (_request, response) => {
  const employees = await listEmployees(_request.auth?.user.tenantId);
  response.json({ employees });
});

router.get("/clients", async (_request, response) => {
  const clients = await listClients(_request.auth?.user.tenantId);
  response.json({ clients });
});

router.post("/employees", async (request, response) => {
  const parsed = createEmployeeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee payload" });
    return;
  }

  try {
    const result = await createEmployeeAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_onboarded",
          title: "Employee account created",
          body: `${result.user.name} was added to the team.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_onboarded",
          title: "Your Yojak account is ready",
          body: "Your employee profile has been created and your onboarding email has been sent.",
          link: "/login",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "employee_onboarded",
          title: "New employee added",
          body: `${result.user.name} joined the team.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
        actor.id ? [actor.id] : [],
      ),
    );
    response.status(201).json({
      user: result.user,
      employeeId: result.user.employeeId,
      onboardingEmailSent: result.onboardingEmailSent,
      ...(process.env.NODE_ENV !== "production" ? { temporaryPassword: result.temporaryPassword } : {}),
    });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Failed to create employee" });
  }
});

router.post("/clients", async (request, response) => {
  const parsed = createClientSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid client payload" });
    return;
  }

  try {
    const result = await createClientAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_onboarded",
          title: "Client account created",
          body: `${result.user.name} was added as a client contact.`,
          link: "/clients",
          email: false,
          metadata: {
            userId: result.user.id,
            entityType: "client",
          },
        },
      ),
    );
    response.status(201).json({
      user: result.user,
      onboardingEmailSent: result.onboardingEmailSent,
      ...(process.env.NODE_ENV !== "production" ? { temporaryPassword: result.temporaryPassword } : {}),
    });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Failed to create client" });
  }
});

router.patch("/employees/:id", async (request, response) => {
  const parsed = updateEmployeeSchema.safeParse({
    ...request.body,
    id: request.params.id,
  });

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee payload" });
    return;
  }

  try {
    const result = await updateEmployeeAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_updated",
          title: "Employee updated",
          body: `${result.user.name}'s profile was updated.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_updated",
          title: "Your employee profile was updated",
          body: "An admin updated your employee record. Please review it when convenient.",
          link: "/employee/profile",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    response.json({
      user: result.user,
    });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Failed to update employee" });
  }
});

router.patch("/clients/:id", async (request, response) => {
  const parsed = updateClientSchema.safeParse({
    ...request.body,
    id: request.params.id,
  });

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid client payload" });
    return;
  }

  try {
    const result = await updateClientAccount({
      ...parsed.data,
      tenantId: request.auth?.user.tenantId,
    });
    response.json({ user: result.user });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Failed to update client" });
  }
});

router.delete("/employees/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee id" });
    return;
  }

  try {
    const result = await deactivateEmployeeAccount(parsed.data, request.auth?.user.tenantId);
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "employee_deactivated",
          title: "Employee deactivated",
          body: `${result.user.name} was removed from active access.`,
          link: "/employees",
          email: false,
          metadata: {
            employeeId: result.user.employeeId,
            userId: result.user.id,
          },
        },
      ),
    );
    await deliverNotification(
      notifyEmployee(
        result.user.id,
        actor,
        {
          type: "employee_deactivated",
          title: "Your account has been deactivated",
          body: "Your Yojak access has been removed. Please contact the administrator if you need help.",
          link: "/login",
          email: true,
          metadata: {
            employeeId: result.user.employeeId,
          },
        },
      ),
    );
    response.json({
      user: result.user,
      message: "Employee deactivated",
    });
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Failed to deactivate employee" });
  }
});

router.delete("/clients/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid client id" });
    return;
  }

  try {
    const result = await deactivateClientAccount(parsed.data, request.auth?.user.tenantId);
    response.json({
      user: result.user,
      message: "Client removed",
    });
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Failed to remove client" });
  }
});

export default router;
