import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type ActorRole } from "@workspace/db/schema";
import { requireTenantRole } from "../../middlewares/auth";
import { type FundRecord } from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import { notifyAdmins, notifyUsersByIds } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import {
  deleteFundWithIdempotency,
  FundsServiceError,
  getFundForTenant,
  listFundsForTenant,
  saveFund,
} from "./funds.service";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);
const dateSchema = z.string().min(1);

const fundSchema = z.object({
  id: businessIdSchema.optional(),
  accountId: businessIdSchema.optional(),
  source: z.string().trim().min(2),
  amount: z.coerce.number().min(1),
  date: dateSchema,
  note: z.string().trim().optional(),
  receiptName: z.string().trim().optional(),
  receiptPath: z.string().trim().optional(),
});

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function deliverNotification(work: Promise<unknown>) {
  void work.catch((error) => {
    logger.warn({ err: error }, "Failed to deliver notification");
  });
  return Promise.resolve();
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
  if (!(error instanceof FundsServiceError)) {
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

  if (error.code === "conflict") {
    response.status(409).json({ message: error.message });
    return true;
  }

  if (error.code === "invalid_input") {
    response.status(400).json({ message: error.message });
    return true;
  }

  return false;
}

router.route("/funds").get(requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const funds = await listFundsForTenant(tenantId);
  response.json({ funds });
}).post(requireTenantRole("admin"), async (request, response) => {
  const parsed = fundSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid fund payload" });
    return;
  }

  let fund: FundRecord;
  let created = false;
  let duplicate = false;
  try {
    const result = await saveFund(parsed.data, recordActor(request), {
      idempotencyKey: request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key"),
    });
    fund = result.fund;
    created = result.created;
    duplicate = result.duplicate;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!duplicate) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry saved",
          body: `Fund inflow from ${fund.source} was recorded.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund updated",
          body: `A fund inflow from ${fund.source} was recorded.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.status(created ? 201 : 200).json({ fund, duplicate });
});

router.route("/funds/:id").get(requireTenantRole("admin"), async (request, response) => {
  try {
    const fund = await getFundForTenant(routeParam(request.params.id), request.auth?.user.tenantId ?? DEFAULT_TENANT_ID);
    response.json({ fund });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
}).patch(requireTenantRole("admin"), async (request, response) => {
  const parsed = fundSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid fund payload" });
    return;
  }

  let fund: FundRecord;
  let duplicate = false;
  try {
    const result = await saveFund(parsed.data, recordActor(request), {
      idempotencyKey: request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key"),
    });
    fund = result.fund;
    duplicate = result.duplicate;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!duplicate) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry updated",
          body: `Fund inflow from ${fund.source} was updated.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund entry updated",
          body: `A fund inflow from ${fund.source} was updated.`,
          link: "/funds",
          email: false,
          metadata: { fundId: fund.id, amount: fund.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.json({ fund, duplicate });
}).delete(requireTenantRole("admin"), async (request, response) => {
  let target: FundRecord | null = null;
  let duplicate = false;
  try {
    const result = await deleteFundWithIdempotency(routeParam(request.params.id), recordActor(request), {
      idempotencyKey: request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key"),
    });
    target = result.fund;
    duplicate = result.duplicate;
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }

  if (!duplicate && target) {
    const actor = notificationActor(request);
    await deliverNotification(
      notifyUsersByIds(
        actor.id ? [actor.id] : [],
        actor,
        {
          type: "fund_created",
          title: "Fund entry deleted",
          body: `Fund inflow from ${target.source} was removed.`,
          link: "/funds",
          email: false,
          metadata: { fundId: target.id, amount: target.amount },
        },
      ),
    );
    await deliverNotification(
      notifyAdmins(
        actor,
        {
          type: "fund_created",
          title: "Fund entry deleted",
          body: `A fund inflow from ${target.source} was removed.`,
          link: "/funds",
          email: false,
          metadata: { fundId: target.id, amount: target.amount },
        },
        actor.id ? [actor.id] : [],
      ),
    );
  }

  response.status(204).send();
});

export default router;
