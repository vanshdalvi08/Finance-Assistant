import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getApiOriginCandidates, isProduction, optionalEnv } from "./lib/env";
import { recordPlatformEvent, recordPlatformEventSafe } from "./lib/platform";

const app: Express = express();
const REQUEST_BODY_LIMIT = "4mb";
const slowRequestThresholdMs = Math.max(200, Number(optionalEnv("PLATFORM_SLOW_REQUEST_THRESHOLD_MS") ?? 1500) || 1500);
const allowedOrigins = new Set(getApiOriginCandidates());

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

app.disable("x-powered-by");
if (isProduction()) {
  app.set("trust proxy", 1);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalized = normalizeOrigin(origin);
      if (normalized && allowedOrigins.has(normalized)) {
        callback(null, true);
        return;
      }

      logger.warn({ origin }, "Blocked request from disallowed CORS origin");
      void recordPlatformEventSafe({
        severity: "warning",
        category: "request",
        title: "CORS origin blocked",
        message: "Request blocked because origin is not in CORS allowlist.",
        path: null,
        method: null,
        statusCode: 403,
        metadata: {
          origin,
        },
      });
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-File-Name", "X-CSRF-Token"],
    exposedHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
    maxAge: 60 * 60 * 24,
    optionsSuccessStatus: 204,
  }),
);
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Origin-Agent-Cluster", "?1");
  if (isProduction()) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use((request, response, next) => {
  response.setHeader("X-Request-Id", String(request.id ?? ""));
  response.setHeader("Cache-Control", "no-store, private, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  const startedAt = Date.now();
  response.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const tenantId = request.auth?.user.tenantId ?? null;
    const actorUserId = request.auth?.user.id ?? null;
    const statusCode = response.statusCode;
    const severity = statusCode >= 500 ? "error" : durationMs >= slowRequestThresholdMs ? "warning" : null;

    if (!severity) {
      return;
    }

    void recordPlatformEvent({
      severity,
      category: statusCode >= 500 ? "system" : "request",
      title: statusCode >= 500 ? "Request failed" : "Slow request",
      message: `${request.method} ${request.originalUrl?.split("?")[0] ?? request.url} finished with ${statusCode} in ${durationMs}ms.`,
      path: request.originalUrl?.split("?")[0] ?? request.url,
      method: request.method,
      statusCode,
      durationMs,
      tenantId,
      actorUserId,
      requestId: String(request.id),
      metadata: {
        requestId: String(request.id ?? ""),
      },
    }).catch((error) => {
      logger.error({ err: error }, "Failed to record platform event");
    });
  });

  next();
});
app.use(cookieParser());
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));

app.use("/api", router);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.too.large"
  ) {
    response.status(413).json({
      message: "Uploaded payload is too large. Please use a smaller file.",
    });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.parse.failed"
  ) {
    response.status(400).json({
        message: "Request body is not valid JSON.",
        requestId: String(_request.id ?? ""),
      });
    return;
  }

  logger.error({ err: error, requestId: String(_request.id ?? "") }, "Unhandled error");
  void recordPlatformEventSafe({
    severity: "error",
    category: "system",
    title: "Unhandled API exception",
    message: `${_request.method} ${_request.originalUrl?.split("?")[0] ?? _request.url} failed with an unhandled exception.`,
    path: _request.originalUrl?.split("?")[0] ?? _request.url,
    method: _request.method,
    statusCode: 500,
    tenantId: _request.auth?.user.tenantId ?? null,
    actorUserId: _request.auth?.user.id ?? null,
    requestId: String(_request.id ?? ""),
    metadata: {
      requestId: String(_request.id ?? ""),
      errorName: error instanceof Error ? error.name : "UnknownError",
      ...(isProduction() ? {} : { errorMessage: error instanceof Error ? error.message : String(error ?? "Unknown error") }),
    },
  });
  response.status(500).json({
    message: isProduction() ? "Internal server error" : error instanceof Error ? error.message : "Internal server error",
    requestId: String(_request.id ?? ""),
  });
});

export default app;
