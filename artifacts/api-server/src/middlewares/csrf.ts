import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getApiOriginCandidates, isProduction, optionalEnv } from "../lib/env";
import { CSRF_COOKIE_NAME } from "../lib/cookies";
import { recordPlatformEventSafe } from "../lib/platform";

export const CSRF_HEADER_NAME = "x-csrf-token";

const ENFORCE_CSRF = (() => {
  const override = optionalEnv("AUTH_CSRF_ENFORCE");
  if (override === undefined) {
    return isProduction();
  }
  return String(override).toLowerCase() === "true";
})();

const ENFORCE_ORIGIN_CHECK = (() => {
  const override = optionalEnv("AUTH_STRICT_ORIGIN_CHECK");
  if (override === undefined) {
    return isProduction();
  }
  return String(override).toLowerCase() === "true";
})();

const allowedOrigins = new Set(getApiOriginCandidates());

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function equalsSafe(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function requireSameOriginAuthMutation(request: Request, response: Response, next: NextFunction) {
  if (!ENFORCE_ORIGIN_CHECK) {
    next();
    return;
  }

  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  const originHeader = request.header("origin");
  const refererHeader = request.header("referer");
  const origin = originHeader ? normalizeOrigin(originHeader) : refererHeader ? normalizeOrigin(refererHeader) : null;
  const isTrustedOrigin = Boolean(origin && allowedOrigins.has(origin));
  const secFetchSite = request.header("sec-fetch-site")?.toLowerCase();

  // Browsers may report cross-site for split frontend/API domains. We still allow the request
  // when the caller origin is explicitly trusted via CORS_ALLOWED_ORIGINS/APP_URL/FRONTEND_URL.
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "same-site" && secFetchSite !== "none" && !isTrustedOrigin) {
    void recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Cross-site auth mutation blocked",
      message: "Auth mutation request was blocked due to cross-site context from an untrusted origin.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      statusCode: 403,
      tenantId: request.auth?.user.tenantId ?? null,
      actorUserId: request.auth?.user.id ?? null,
      requestId: String(request.id ?? ""),
      metadata: {
        secFetchSite: secFetchSite ?? null,
        origin: origin ?? null,
      },
    });
    response.status(403).json({ message: "Cross-site request blocked." });
    return;
  }

  if (!isTrustedOrigin) {
    void recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Untrusted auth origin blocked",
      message: "Auth mutation request origin was not in the trusted origin allowlist.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      statusCode: 403,
      tenantId: request.auth?.user.tenantId ?? null,
      actorUserId: request.auth?.user.id ?? null,
      requestId: String(request.id ?? ""),
      metadata: {
        origin: origin ?? null,
      },
    });
    response.status(403).json({ message: "Untrusted request origin." });
    return;
  }

  next();
}

export function requireCsrfToken(request: Request, response: Response, next: NextFunction) {
  if (!ENFORCE_CSRF) {
    next();
    return;
  }

  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = request.header(CSRF_HEADER_NAME);

  if (typeof cookieToken !== "string" || typeof headerToken !== "string") {
    void recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "CSRF token missing",
      message: "Auth mutation request is missing CSRF cookie or header.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      statusCode: 403,
      tenantId: request.auth?.user.tenantId ?? null,
      actorUserId: request.auth?.user.id ?? null,
      requestId: String(request.id ?? ""),
      metadata: {
        hasCookieToken: typeof cookieToken === "string",
        hasHeaderToken: typeof headerToken === "string",
      },
    });
    response.status(403).json({ message: "Missing CSRF token." });
    return;
  }

  if (!equalsSafe(cookieToken, headerToken)) {
    void recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "CSRF token mismatch",
      message: "Auth mutation request was blocked due to CSRF token mismatch.",
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      statusCode: 403,
      tenantId: request.auth?.user.tenantId ?? null,
      actorUserId: request.auth?.user.id ?? null,
      requestId: String(request.id ?? ""),
    });
    response.status(403).json({ message: "Invalid CSRF token." });
    return;
  }

  next();
}
