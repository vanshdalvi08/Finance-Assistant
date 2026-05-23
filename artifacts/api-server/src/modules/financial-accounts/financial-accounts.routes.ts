import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireTenantRole } from "../../middlewares/auth";
import {
  type ActorRole,
  normalizeFinancialAccountCategory,
  normalizeFinancialAccountType,
} from "../../lib/business-store";
import { DEFAULT_TENANT_ID } from "../../lib/tenants";
import {
  FinancialAccountsServiceError,
  getFinancialAccountForTenant,
  listFinancialAccountsForTenant,
  saveFinancialAccount,
} from "./financial-accounts.service";

const router: IRouter = Router();

const businessIdSchema = z.string().trim().min(1);

const financialAccountSchema = z.object({
  id: businessIdSchema.optional(),
  name: z.string().trim().min(2),
  accountType: z.enum(["operational", "personal", "mixed_use", "reserve", "cash"]),
  category: z.enum(["bank", "cash", "wallet", "other"]),
  openingBalance: z.coerce.number().min(0),
  description: z.string().trim().optional(),
  includeInOperationalReporting: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function respondNotFound(response: Response, message: string) {
  response.status(404).json({ message });
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

function handleServiceError(error: unknown, response: Response) {
  if (!(error instanceof FinancialAccountsServiceError)) {
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

  if (error.code === "invalid_input") {
    response.status(400).json({ message: error.message });
    return true;
  }

  return false;
}

router.get("/financial-accounts", requireTenantRole("admin"), async (request, response) => {
  const tenantId = request.auth?.user.tenantId ?? DEFAULT_TENANT_ID;
  const accounts = await listFinancialAccountsForTenant(tenantId);
  response.json({ accounts });
});

router.post("/financial-accounts", requireTenantRole("admin"), async (request, response) => {
  const parsed = financialAccountSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid financial account payload." });
    return;
  }

  try {
    const result = await saveFinancialAccount(
      {
        ...parsed.data,
        accountType: normalizeFinancialAccountType(parsed.data.accountType),
        category: normalizeFinancialAccountCategory(parsed.data.category),
      },
      recordActor(request),
    );
    response.status(result.created ? 201 : 200).json({ account: result.account });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.get("/financial-accounts/:id", requireTenantRole("admin"), async (request, response) => {
  try {
    const account = await getFinancialAccountForTenant(routeParam(request.params.id), request.auth?.user.tenantId ?? DEFAULT_TENANT_ID);
    response.json({ account });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

router.patch("/financial-accounts/:id", requireTenantRole("admin"), async (request, response) => {
  const parsed = financialAccountSchema.safeParse({ ...request.body, id: routeParam(request.params.id) });
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid financial account payload." });
    return;
  }

  try {
    const result = await saveFinancialAccount(
      {
        ...parsed.data,
        accountType: normalizeFinancialAccountType(parsed.data.accountType),
        category: normalizeFinancialAccountCategory(parsed.data.category),
      },
      recordActor(request),
    );
    response.json({ account: result.account });
  } catch (error) {
    if (handleServiceError(error, response)) {
      return;
    }
    throw error;
  }
});

export default router;
