import type { Response } from "express";

export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function applyApiSecurityHeaders(response: Pick<Response, "setHeader">, production: boolean) {
  response.setHeader("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-XSS-Protection", "0");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Origin-Agent-Cluster", "?1");
  if (production) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
