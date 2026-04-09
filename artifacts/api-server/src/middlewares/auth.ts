import { type NextFunction, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { tenantsTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "../lib/jwt";
import { type PublicUser } from "../lib/auth-service";

export type TenantRole = "admin" | "employee" | "client";
export type PlatformRole = "platform_super_admin";
export type AppRole = TenantRole | PlatformRole;

function extractBearerToken(request: Request): string | null {
  const authorization = request.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return null;
}

async function loadUser(userId: string): Promise<PublicUser | null> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = rows[0];
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    employeeId: user.employeeId ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    salary: user.salary,
    payType: user.payType,
    hourlyRate: user.hourlyRate,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    clientInfo: user.clientInfo ?? {},
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

async function loadTenant(tenantId: string) {
  const rows = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = extractBearerToken(request);
  if (!token) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await loadUser(payload.sub);
    const tenant = user ? await loadTenant(user.tenantId) : null;
    if (!user || user.status !== "active" || user.tenantId !== payload.tenantId || !tenant || tenant.status !== "active") {
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    request.auth = {
      user,
      sessionId: payload.sessionId,
    };
    next();
  } catch {
    response.status(401).json({ message: "Unauthorized" });
  }
}

export function requireRole(...roles: Array<AppRole>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const role = request.auth?.user.role;
    if (!role || !roles.includes(role)) {
      response.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}

export function requireTenantRole(...roles: TenantRole[]) {
  return requireRole(...roles);
}

export function requirePlatformRole() {
  return requireRole("platform_super_admin");
}
