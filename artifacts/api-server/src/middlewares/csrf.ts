import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getApiOriginCandidates, isProduction, optionalEnv } from "../lib/env";
import { CSRF_COOKIE_NAME } from "../lib/cookies";

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

  const secFetchSite = request.header("sec-fetch-site")?.toLowerCase();
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "same-site" && secFetchSite !== "none") {
    response.status(403).json({ message: "Cross-site request blocked." });
    return;
  }

  const originHeader = request.header("origin");
  const refererHeader = request.header("referer");
  const origin = originHeader ? normalizeOrigin(originHeader) : refererHeader ? normalizeOrigin(refererHeader) : null;

  if (!origin || !allowedOrigins.has(origin)) {
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
    response.status(403).json({ message: "Missing CSRF token." });
    return;
  }

  if (!equalsSafe(cookieToken, headerToken)) {
    response.status(403).json({ message: "Invalid CSRF token." });
    return;
  }

  next();
}
