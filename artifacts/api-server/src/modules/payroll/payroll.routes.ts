import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable, salarySlipsTable, type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { createId, type SalaryRecord } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyEmployee, notifyUsersByIds } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { hashSha256 } from "../../lib/security";
import { rateLimit } from "../../middlewares/rate-limit";
import { readLocalSalarySlipByToken } from "../../lib/storage";
import {
  deleteSalary,
  getSalaryForActor,
  listSalariesForActor,
  paySalary,
  SalaryServiceError,
  saveSalary,
} from "./payroll.service";
import {
  buildSalarySlipDraft,
  confirmSalarySlip,
  listSalarySlipsForActor,
} from "./salary-slip.service";
import { generateSalarySlipPdf } from "./salary-slip.pdf";

const router: IRouter = Router();
const salaryPaymentLimiter = rateLimit({
  name: "salary-pay",
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many salary payment actions. Please wait and retry.",
});

const businessIdSchema = z.string().trim().min(1);
const dateSchema = z.string().min(1);

const salarySchema = z.object({
  id: businessIdSchema.optional(),
  accountId: businessIdSchema.optional(),
  employeeId: z.string().uuid().optional(),
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
  days: z.coerce.number().int().min(0).optional(),
  timesheetId: businessIdSchema.optional(),
});

const historicalSalarySchema = salarySchema.omit({
  id: true,
  status: true,
  source: true,
  paidAt: true,
  weekStart: true,
  hours: true,
  rate: true,
  timesheetId: true,
}).extend({
  accountId: businessIdSchema,
  date: dateSchema,
}).superRefine((input, ctx) => {
  if (!input.employeeId && !input.employeeNameSnapshot?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["employeeNameSnapshot"],
      message: "Provide either an employee or a former employee name.",
    });
  }
});

const salarySlipLineItemSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount: z.coerce.number().min(0).max(100_000_000),
});

const salarySlipDraftSchema = z.object({
  salaryIds: z.array(businessIdSchema).min(1).max(52),
  accountId: businessIdSchema,
  companyName: z.string().trim().min(1).max(200),
  companyAddress: z.string().trim().max(500),
  payPeriod: z.string().trim().min(1).max(100),
  paymentDate: z.string().date(),
  employeeId: z.string().trim().min(1).max(100),
  employeeName: z.string().trim().min(1).max(200),
  designation: z.string().trim().max(150),
  department: z.string().trim().max(150),
  joiningDate: z.string().max(20),
  uan: z.string().trim().max(100),
  pfNumber: z.string().trim().max(100),
  esiNumber: z.string().trim().max(100),
  bankName: z.string().trim().max(150),
  bankAccountNumber: z.string().trim().max(100),
  grossWages: z.coerce.number().min(0).max(100_000_000),
  totalWorkingDays: z.coerce.number().min(0).max(366),
  leaveDays: z.coerce.number().min(0).max(366),
  lopDays: z.coerce.number().min(0).max(366),
  paidDays: z.coerce.number().min(0).max(366),
  earnings: z.array(salarySlipLineItemSchema).min(1).max(8),
  deductions: z.array(salarySlipLineItemSchema).max(8),
  totalEarnings: z.coerce.number().min(0).max(100_000_000),
  totalDeductions: z.coerce.number().min(0).max(100_000_000),
  netSalary: z.coerce.number().min(0).max(100_000_000),
  note: z.string().trim().max(1_000),
});

type SalaryCrudIdempotencyScope = "salary_create" | "salary_historical_create" | "salary_update" | "salary_delete";

class SalaryCrudIdempotencyError extends Error {
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

function requestHashForSalaryMutation(input: z.infer<typeof salarySchema> & { id?: string }) {
  return hashSha256(
    JSON.stringify({
      id: input.id?.trim() ?? "",
      accountId: input.accountId?.trim() ?? "",
      employeeId: input.employeeId?.trim() ?? "",
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() ?? "",
      amount: Number(input.amount),
      date: input.date?.trim() ?? "",
      note: input.note?.trim() ?? "",
      status: input.status ?? "",
      source: input.source ?? "",
      paidAt: input.paidAt?.trim() ?? "",
      weekStart: input.weekStart?.trim() ?? "",
      hours: Number(input.hours ?? 0),
      rate: Number(input.rate ?? 0),
      timesheetId: input.timesheetId?.trim() ?? "",
    }),
  );
}

function requestHashForSalaryHistoricalMutation(input: z.infer<typeof historicalSalarySchema>) {
  return hashSha256(
    JSON.stringify({
      accountId: input.accountId.trim(),
      employeeId: input.employeeId?.trim() ?? "",
      employeeNameSnapshot: input.employeeNameSnapshot?.trim() ?? "",
      amount: Number(input.amount),
      date: input.date.trim(),
      note: input.note?.trim() ?? "",
    }),
  );
}

function requestHashForSalaryDelete(input: { salaryId: string }) {
  return hashSha256(JSON.stringify({ salaryId: input.salaryId.trim() }));
}

async function claimSalaryCrudIdempotency(
  actor: { tenantId: string; userId?: string },
  scope: SalaryCrudIdempotencyScope,
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
    throw new SalaryCrudIdempotencyError("Unable to acquire idempotency lock for this salary request.");
  }
  if (row.requestHash !== requestHash) {
    throw new SalaryCrudIdempotencyError("This idempotency key is already used for a different salary payload.");
  }

  return { row, created: false };
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    logger.warn({ err: error }, "Failed to deliver notification");
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

function salaryResponse(salary: SalaryRecord, role?: string) {
  const shared = {
    id: salary.id,
    employeeId: salary.employeeId,
    employeeNameSnapshot: salary.employeeNameSnapshot,
    amount: salary.amount,
    date: salary.date,
    status: salary.status,
    source: salary.source,
    paidAt: salary.paidAt,
    weekStart: salary.weekStart,
    hours: salary.hours,
    rate: salary.rate,
    days: salary.days ?? null,
  };

  if (role === "employee") {
    return shared;
  }

  return {
    ...shared,
    accountId: salary.accountId,
    note: salary.note,
    timesheetId: salary.timesheetId,
    createdAt: salary.createdAt,
    updatedAt: salary.updatedAt,
  };
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

  if (error.code === "conflict") {
    response.status(409).json({ message: error.message });
    return true;
  }

  return false;
}

function handleSalaryCrudIdempotencyError(error: unknown, response: Response) {
  if (!(error instanceof SalaryCrudIdempotencyError)) {
    throw error;
  }
  response.status(409).json({ message: error.message });
  return true;
}

router.get("/salaries", requireTenantRole("admin", "employee"), async (request, response) => {
  try {
    const salaries = await listSalariesForActor(
      request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      request.auth?.user.role,
      request.auth?.user.id,
      scopedEmployeeId(request, (request.query as { employeeId?: string }).employeeId),
    );
    response.json({
      salaries: salaries.map((salary) => salaryResponse(salary, request.auth?.user.role)),
    });
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

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForSalaryMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimSalaryCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimSalaryCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "salary_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleSalaryCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getSalaryForActor(
        idempotencyClaim.row.responseEntityId,
        tenantId,
        request.auth?.user.role,
        request.auth?.user.id,
      );
      response.json({ salary: salaryResponse(replayed, request.auth?.user.role), duplicate: true });
      return;
    }
    response.status(409).json({ message: "This salary request is already being processed. Please retry shortly." });
    return;
  }

  let salary: SalaryRecord;
  let created = false;
  try {
    const result = await saveSalary(parsed.data, recordActor(request));
    salary = result.salary;
    created = result.created;
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: salary.id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(created ? 201 : 200).json({
    salary: salaryResponse(salary, request.auth?.user.role),
    duplicate: false,
  });
});

router.post("/salaries/historical", requireTenantRole("admin"), async (request, response) => {
  const parsed = historicalSalarySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid historical salary payload" });
    return;
  }

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForSalaryHistoricalMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimSalaryCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimSalaryCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "salary_historical_create",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleSalaryCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getSalaryForActor(
        idempotencyClaim.row.responseEntityId,
        tenantId,
        request.auth?.user.role,
        request.auth?.user.id,
      );
      response.json({ salary: salaryResponse(replayed, request.auth?.user.role), duplicate: true });
      return;
    }
    response.status(409).json({ message: "This historical salary request is already being processed. Please retry shortly." });
    return;
  }

  let salary: SalaryRecord;
  let created = false;
  try {
    const result = await saveSalary(
      {
        ...parsed.data,
        accountId: parsed.data.accountId.trim(),
        employeeId: parsed.data.employeeId?.trim() || undefined,
        employeeNameSnapshot: parsed.data.employeeNameSnapshot?.trim() || undefined,
        status: "paid",
        source: "manual",
        paidAt: parsed.data.date,
      },
      recordActor(request),
    );
    salary = result.salary;
    created = result.created;
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: salary.id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(created ? 201 : 200).json({
    salary: salaryResponse(salary, request.auth?.user.role),
    duplicate: false,
  });
});

router.route("/salaries/:id").get(requireTenantRole("admin", "employee"), async (request, response) => {
  try {
    const salary = await getSalaryForActor(
      routeParam(request.params.id),
      request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      request.auth?.user.role,
      request.auth?.user.id,
    );
    response.json({ salary: salaryResponse(salary, request.auth?.user.role) });
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

  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForSalaryMutation(parsed.data) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimSalaryCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimSalaryCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "salary_update",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleSalaryCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed" && idempotencyClaim.row.responseEntityId) {
      const replayed = await getSalaryForActor(
        idempotencyClaim.row.responseEntityId,
        tenantId,
        request.auth?.user.role,
        request.auth?.user.id,
      );
      response.json({ salary: salaryResponse(replayed, request.auth?.user.role), duplicate: true });
      return;
    }
    response.status(409).json({ message: "This salary update request is already being processed. Please retry shortly." });
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
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
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

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: salary.id,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.json({
    salary: salaryResponse(salary, request.auth?.user.role),
    duplicate: false,
  });
}).delete(requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const idempotencyKey = idempotencyKeyFrom(request);
  const requestHash = idempotencyKey ? requestHashForSalaryDelete({ salaryId: routeParam(request.params.id) }) : null;
  let idempotencyClaim:
    | Awaited<ReturnType<typeof claimSalaryCrudIdempotency>>
    | null = null;
  try {
    idempotencyClaim =
      idempotencyKey && requestHash
        ? await claimSalaryCrudIdempotency(
            { tenantId, userId: request.auth?.user.id },
            "salary_delete",
            idempotencyKey,
            requestHash,
          )
        : null;
  } catch (error) {
    if (handleSalaryCrudIdempotencyError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim && !idempotencyClaim.created) {
    if (idempotencyClaim.row.status === "completed") {
      response.status(204).send();
      return;
    }
    response.status(409).json({ message: "This salary delete request is already being processed. Please retry shortly." });
    return;
  }

  try {
    await deleteSalary(routeParam(request.params.id), recordActor(request));
  } catch (error) {
    if (idempotencyClaim?.created) {
      await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
    }
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (idempotencyClaim?.created) {
    await db
      .update(idempotencyKeysTable)
      .set({
        status: "completed",
        responseEntityId: routeParam(request.params.id),
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeysTable.id, idempotencyClaim.row.id));
  }

  response.status(204).send();
});

router.post("/salaries/:id/pay", requireTenantRole("admin"), salaryPaymentLimiter, async (request, response) => {
  const parsed = z.object({
    note: z.string().trim().optional(),
    accountId: businessIdSchema.optional(),
  }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary payment payload" });
    return;
  }

  let salary: SalaryRecord;
  let wasAlreadyPaid = false;
  try {
    const result = await paySalary(routeParam(request.params.id), parsed.data.note, recordActor(request), {
      accountId: parsed.data.accountId,
      idempotencyKey: idempotencyKeyFrom(request),
    });
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
  response.json({
    salary: salaryResponse(salary, request.auth?.user.role),
    duplicate: wasAlreadyPaid,
  });
});

router.post("/salary-slips/preview", requireTenantRole("admin"), salaryPaymentLimiter, async (request, response) => {
  const parsed = z.object({
    salaryIds: z.array(businessIdSchema).min(1).max(52),
    accountId: businessIdSchema,
  }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Select payroll records and a payout account." });
    return;
  }

  try {
    const draft = await buildSalarySlipDraft({
      tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      salaryIds: Array.from(new Set(parsed.data.salaryIds)),
      accountId: parsed.data.accountId,
    });
    response.json({ draft });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Could not prepare salary slip." });
  }
});

router.post("/salary-slips/confirm", requireTenantRole("admin"), salaryPaymentLimiter, async (request, response) => {
  const parsed = salarySlipDraftSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid salary slip details." });
    return;
  }

  try {
    const result = await confirmSalarySlip({
      tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      actor: recordActor(request),
      draft: parsed.data,
    });
    const actor = notificationActor(request);
    await deliverNotification(
      notifyEmployee(
        result.slip.employeeId,
        actor,
        {
          type: "salary_paid",
          title: "Salary slip available",
          body: `Your ${result.slip.payPeriod} salary slip is ready to download.`,
          link: "/employee/salary-slips",
          email: false,
          metadata: { salarySlipId: result.slip.id, amount: result.slip.netAmount },
        },
      ),
    );
    response.status(201).json(result);
  } catch (error) {
    if (error instanceof SalaryServiceError && handleServiceError(error, response)) {
      return;
    }
    response.status(400).json({ message: error instanceof Error ? error.message : "Could not complete salary payment." });
  }
});

router.get("/salary-slips", requireTenantRole("admin", "employee"), async (request, response) => {
  try {
    const slips = await listSalarySlipsForActor({
      tenantId: request.auth?.user.tenantId ?? DEFAULT_TENANT_ID,
      role: request.auth?.user.role,
      userId: request.auth?.user.id,
      employeeId: typeof request.query.employeeId === "string" ? request.query.employeeId : undefined,
    });
    response.json({ slips });
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : "Could not load salary slips." });
  }
});

router.get("/salary-slips/local/:token", requireTenantRole("admin", "employee"), async (request, response) => {
  try {
    const token = routeParam(request.params.token);
    const objectPath = Buffer.from(token, "base64url").toString("utf8");
    const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
    const rows = await db
      .select()
      .from(salarySlipsTable)
      .where(and(eq(salarySlipsTable.tenantId, tenantId), eq(salarySlipsTable.filePath, objectPath)))
      .limit(1);
    const slip = rows[0];
    if (slip && request.auth?.user.role === "employee" && slip.employeeId !== request.auth.user.id) {
      response.status(403).json({ message: "Forbidden" });
      return;
    }
    const file = slip ? await generateSalarySlipPdf(slip.snapshot) : await readLocalSalarySlipByToken(token);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", "inline; filename=\"salary-slip.pdf\"");
    response.send(Buffer.from(file));
  } catch {
    response.status(404).json({ message: "Salary slip PDF not found." });
  }
});

export default router;
