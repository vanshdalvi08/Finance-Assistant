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
  return request.auth?.user.id ?? request.ip ?? request.socket.remoteAddress ?? "unknown";
}

export function rateLimit(options: RateLimitOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
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

    if (bucket.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
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
