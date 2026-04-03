import { Router, type IRouter } from "express";
import { z } from "zod";
import { createEmployeeAccount, deactivateEmployeeAccount, listEmployees, updateEmployeeAccount } from "../lib/auth-service";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

const createEmployeeSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2),
  salary: z.coerce.number().min(0),
  department: z.string().trim().min(2).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().trim().uuid(),
});

router.use(requireAuth, requireRole("admin"));

router.get("/employees", async (_request, response) => {
  const employees = await listEmployees();
  response.json({ employees });
});

router.post("/employees", async (request, response) => {
  const parsed = createEmployeeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee payload" });
    return;
  }

  try {
    const result = await createEmployeeAccount(parsed.data);
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
    const result = await updateEmployeeAccount(parsed.data);
    response.json({
      user: result.user,
    });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Failed to update employee" });
  }
});

router.delete("/employees/:id", async (request, response) => {
  const parsed = z.string().trim().uuid().safeParse(request.params.id);

  if (!parsed.success) {
    response.status(400).json({ message: "Invalid employee id" });
    return;
  }

  try {
    const result = await deactivateEmployeeAccount(parsed.data);
    response.json({
      user: result.user,
      message: "Employee deactivated",
    });
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Failed to deactivate employee" });
  }
});

export default router;
