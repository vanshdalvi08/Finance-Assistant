import jwt from "jsonwebtoken";
import { getJwtSecret } from "./env";

const ACCESS_TOKEN_SECRET = getJwtSecret("JWT_ACCESS_SECRET", "yojak-dev-access-secret");
const REFRESH_TOKEN_SECRET = getJwtSecret("JWT_REFRESH_SECRET", "yojak-dev-refresh-secret");

export const ACCESS_TOKEN_TTL = "20m";
export const REFRESH_TOKEN_TTL = "14d";

export interface AccessTokenPayload {
  sub: string;
  role: "admin" | "employee" | "client";
  email: string;
  name: string;
  sessionId: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  typ: "refresh";
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
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
