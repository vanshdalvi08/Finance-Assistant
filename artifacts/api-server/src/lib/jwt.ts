import jwt from "jsonwebtoken";
import { getJwtSecret, optionalEnv } from "./env";

const ACCESS_TOKEN_SECRET = getJwtSecret("JWT_ACCESS_SECRET", "yojak-dev-access-secret");
const REFRESH_TOKEN_SECRET = getJwtSecret("JWT_REFRESH_SECRET", "yojak-dev-refresh-secret");
const JWT_ISSUER = optionalEnv("AUTH_JWT_ISSUER")?.trim() || "reforix-payroll-api";
const JWT_AUDIENCE = optionalEnv("AUTH_JWT_AUDIENCE")?.trim() || "reforix-payroll";
const JWT_ALGORITHM = "HS256" as const;

export const ACCESS_TOKEN_TTL = "20m";
export const REFRESH_TOKEN_TTL = "14d";
export const MFA_TOKEN_TTL = "5m";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: "admin" | "employee" | "client" | "platform_super_admin";
  email: string;
  name: string;
  sessionId: string;
  typ: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  typ: "refresh";
}

export interface MfaTokenPayload {
  sub: string;
  jti: string;
  typ: "mfa";
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "typ">): string {
  return jwt.sign({ ...payload, typ: "access" }, ACCESS_TOKEN_SECRET, {
    algorithm: JWT_ALGORITHM,
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    algorithm: JWT_ALGORITHM,
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function signMfaToken(payload: MfaTokenPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    algorithm: JWT_ALGORITHM,
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: MFA_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, ACCESS_TOKEN_SECRET, {
    algorithms: [JWT_ALGORITHM],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  }) as AccessTokenPayload;
  if (
    payload.typ !== "access"
    || !payload.sub
    || !payload.tenantId
    || !payload.sessionId
    || !["admin", "employee", "client", "platform_super_admin"].includes(payload.role)
  ) {
    throw new Error("Invalid access token");
  }
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, REFRESH_TOKEN_SECRET, {
    algorithms: [JWT_ALGORITHM],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  }) as RefreshTokenPayload;
  if (payload.typ !== "refresh" || !payload.sub || !payload.jti) {
    throw new Error("Invalid refresh token");
  }
  return payload;
}

export function verifyMfaToken(token: string): MfaTokenPayload {
  const payload = jwt.verify(token, ACCESS_TOKEN_SECRET, {
    algorithms: [JWT_ALGORITHM],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  }) as MfaTokenPayload;
  if (payload.typ !== "mfa" || !payload.sub || !payload.jti) {
    throw new Error("Invalid MFA token");
  }
  return payload;
}

export function decodeExpiryTokenDate(expiresIn: string): Date {
  const now = Date.now();
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match) {
    return new Date(now);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;

  return new Date(now + amount * multiplier);
}
