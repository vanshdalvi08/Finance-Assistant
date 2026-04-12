import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  name: string;
  message: string;
  keyFn?: (request: Request) => string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 10 * 60 * 1000);

cleanupInterval.unref?.();

function defaultKey(request: Request) {
  const forwardedFor = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  return request.auth?.user.id ?? forwardedFor ?? request.ip ?? request.socket.remoteAddress ?? "unknown";
}

export function rateLimitKeyByRemoteAddress(request: Request) {
  return defaultKey(request);
}

export function rateLimitKeyByRemoteAddressAndField(field: string) {
  return (request: Request) => {
    const base = defaultKey(request);
    const rawValue =
      typeof request.body?.[field] === "string"
        ? request.body[field]
        : typeof request.query?.[field] === "string"
          ? request.query[field]
          : "";
    return `${base}:${rawValue.trim().toLowerCase() || "unknown"}`;
  };
}

export function rateLimit(options: RateLimitOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    const bypassForAutomatedTests =
      process.env.NODE_ENV !== "production" && request.header("X-Test-Bypass-Rate-Limit")?.trim() === "1";
    if (bypassForAutomatedTests) {
      next();
      return;
    }

    const key = `${options.name}:${options.keyFn?.(request) ?? defaultKey(request)}`;
    const now = Date.now();
    const existing = buckets.get(key);
    const bucket =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + options.windowMs,
          };
    const remaining = Math.max(0, options.max - bucket.count - 1);
    response.setHeader("X-RateLimit-Limit", String(options.max));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      response.setHeader("X-RateLimit-Remaining", "0");
      response.status(429).json({
        message: options.message,
      });
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    next();
  };
}
