import { Router, type IRouter } from "express";
import { rateLimit, rateLimitKeyByRemoteAddress } from "../middlewares/rate-limit";
import { recordPlatformEventSafe } from "../lib/platform";

const router: IRouter = Router();
const cspReportLimiter = rateLimit({
  name: "csp-report",
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many CSP reports.",
  keyFn: rateLimitKeyByRemoteAddress,
});

function safeUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) {
    return null;
  }
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function firstReport(body: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(body) ? body[0] : body;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const legacyReport = record["csp-report"];
  if (legacyReport && typeof legacyReport === "object") {
    return legacyReport as Record<string, unknown>;
  }
  if (record.body && typeof record.body === "object") {
    return record.body as Record<string, unknown>;
  }
  return record;
}

router.post("/csp-report", cspReportLimiter, (request, response) => {
  const report = firstReport(request.body);
  if (!report) {
    response.status(204).send();
    return;
  }

  const effectiveDirective =
    typeof report["effective-directive"] === "string"
      ? report["effective-directive"]
      : typeof report.effectiveDirective === "string"
        ? report.effectiveDirective
        : "unknown";

  void recordPlatformEventSafe({
    severity: "warning",
    category: "request",
    title: "CSP report-only violation",
    message: `Browser reported a ${effectiveDirective.slice(0, 120)} policy violation.`,
    path: "/api/security/csp-report",
    method: "POST",
    statusCode: 204,
    requestId: String(request.id ?? ""),
    metadata: {
      effectiveDirective: effectiveDirective.slice(0, 120),
      violatedDirective:
        typeof report["violated-directive"] === "string"
          ? report["violated-directive"].slice(0, 120)
          : null,
      blockedUrl: safeUrl(report["blocked-uri"] ?? report.blockedURL),
      documentUrl: safeUrl(report["document-uri"] ?? report.documentURL),
      sourceFile: safeUrl(report["source-file"] ?? report.sourceFile),
      disposition: typeof report.disposition === "string" ? report.disposition.slice(0, 40) : "report",
      statusCode: Number(report["status-code"] ?? report.statusCode ?? 0) || null,
    },
  });

  response.status(204).send();
});

export default router;
