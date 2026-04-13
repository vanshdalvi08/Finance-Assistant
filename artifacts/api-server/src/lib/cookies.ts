import { isProduction } from "./env";

export const REFRESH_COOKIE_NAME = "yojak_refresh_token";
export const REFRESH_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const MFA_TRUSTED_COOKIE_NAME = "yojak_mfa_trusted";
export const MFA_TRUSTED_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? ("none" as const) : ("lax" as const),
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

export function mfaTrustedCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? ("none" as const) : ("lax" as const),
    path: "/api/auth",
    maxAge: MFA_TRUSTED_COOKIE_MAX_AGE_MS,
  };
}
