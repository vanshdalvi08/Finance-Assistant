import { type NextFunction, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { refreshSessionsTable, tenantsTable, usersTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { verifyAccessToken } from "../lib/jwt";
import { type PublicUser } from "../lib/auth-service";
import { hashSha256 } from "../lib/security";
import { recordPlatformEventSafe } from "../lib/platform";

export type TenantRole = "admin" | "employee" | "client";
export type PlatformRole = "platform_super_admin";
export type AppRole = TenantRole | PlatformRole;

function recordAuthSecurityEvent(input: {
  title: string;
  message: string;
  path?: string | null;
  method?: string | null;
  requestId?: string | null;
  tenantId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  void recordPlatformEventSafe({
    severity: "warning",
    category: "auth",
    title: input.title,
    message: input.message,
    path: input.path ?? null,
    method: input.method ?? null,
    statusCode: 401,
    tenantId: input.tenantId ?? null,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? null,
  });
}

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
    mfaEnabled: Boolean(user.mfaEnabled),
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

async function loadRefreshSession(jtiHash: string) {
  const rows = await db.select().from(refreshSessionsTable).where(eq(refreshSessionsTable.jtiHash, jtiHash)).limit(1);
  return rows[0] ?? null;
}

async function revokeAllSessions(userId: string) {
  await db
    .update(refreshSessionsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(refreshSessionsTable.userId, userId), isNull(refreshSessionsTable.revokedAt)));
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = extractBearerToken(request);
  if (!token) {
    recordAuthSecurityEvent({
      title: "Auth rejected",
      message: "Request missing bearer token.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      requestId: String(request.id ?? ""),
      metadata: { reason: "missing_bearer_token" },
    });
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await loadUser(payload.sub);
    if (!user) {
      recordAuthSecurityEvent({
        title: "Auth rejected",
        message: "Bearer token references a user that does not exist.",
        path: request.originalUrl?.split("?")[0] ?? request.url,
        method: request.method,
        requestId: String(request.id ?? ""),
        metadata: { reason: "user_not_found", userId: payload.sub },
      });
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (payload.role !== user.role) {
      await revokeAllSessions(user.id);
      recordAuthSecurityEvent({
        title: "Auth rejected",
        message: "Bearer token role mismatch detected.",
        path: request.originalUrl?.split("?")[0] ?? request.url,
        method: request.method,
        requestId: String(request.id ?? ""),
        tenantId: user.tenantId,
        actorUserId: user.id,
        metadata: { reason: "role_mismatch", tokenRole: payload.role, currentRole: user.role },
      });
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    const session = await loadRefreshSession(hashSha256(payload.sessionId));
    if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      recordAuthSecurityEvent({
        title: "Auth rejected",
        message: "Bearer token session is invalid, revoked, or expired.",
        path: request.originalUrl?.split("?")[0] ?? request.url,
        method: request.method,
        requestId: String(request.id ?? ""),
        tenantId: user.tenantId,
        actorUserId: user.id,
        metadata: {
          reason: "invalid_session",
          sessionFound: Boolean(session),
          sessionOwnerMismatch: Boolean(session && session.userId !== user.id),
          sessionRevoked: Boolean(session?.revokedAt),
          sessionExpired: Boolean(session && session.expiresAt.getTime() <= Date.now()),
        },
      });
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    const tenant = user ? await loadTenant(user.tenantId) : null;
    if (user.status !== "active" || user.tenantId !== payload.tenantId || !tenant || tenant.status !== "active") {
      recordAuthSecurityEvent({
        title: "Auth rejected",
        message: "User or tenant status validation failed during authentication.",
        path: request.originalUrl?.split("?")[0] ?? request.url,
        method: request.method,
        requestId: String(request.id ?? ""),
        tenantId: user.tenantId,
        actorUserId: user.id,
        metadata: {
          reason: "tenant_or_user_inactive",
          userStatus: user.status,
          tenantExists: Boolean(tenant),
          tenantStatus: tenant?.status ?? null,
          tokenTenantId: payload.tenantId,
          userTenantId: user.tenantId,
        },
      });
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    request.auth = {
      user,
      sessionId: payload.sessionId,
    };
    next();
  } catch {
    recordAuthSecurityEvent({
      title: "Auth rejected",
      message: "Bearer token verification failed.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      requestId: String(request.id ?? ""),
      metadata: { reason: "token_verification_failed" },
    });
    response.status(401).json({ message: "Unauthorized" });
  }
}

export function requireRole(...roles: Array<AppRole>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const role = request.auth?.user.role;
    if (!role || !roles.includes(role)) {
      void recordPlatformEventSafe({
        severity: "warning",
        category: "auth",
        title: "RBAC forbidden",
        message: `Role ${role ?? "anonymous"} attempted to access a protected route without required permissions.`,
        path: request.originalUrl?.split("?")[0] ?? request.url,
        method: request.method,
        statusCode: 403,
        tenantId: request.auth?.user.tenantId ?? null,
        actorUserId: request.auth?.user.id ?? null,
        requestId: String(request.id ?? ""),
        metadata: {
          role: role ?? null,
          requiredRoles: roles,
        },
      });
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
