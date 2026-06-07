import test from "node:test";
import assert from "node:assert/strict";

import { applyApiSecurityHeaders } from "../src/lib/http-security.ts";
import {
  rateLimit,
  rateLimitKeyByField,
  rateLimitKeyByRemoteAddressAndField,
} from "../src/middlewares/rate-limit.ts";

function headerCollector() {
  const headers = new Map();
  return {
    headers,
    response: {
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
    },
  };
}

function rateLimitHarness(name, options = {}) {
  const headers = new Map();
  let statusCode = null;
  let payload = null;
  let nextCalls = 0;
  const middleware = rateLimit({
    name,
    windowMs: 60_000,
    max: options.max ?? 2,
    message: "Rate limited",
    keyFn: options.keyFn,
  });
  const response = {
    setHeader(key, value) {
      headers.set(String(key).toLowerCase(), String(value));
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  const invoke = (request) => {
    middleware(request, response, () => {
      nextCalls += 1;
    });
    return { headers, statusCode, payload, nextCalls };
  };
  return { invoke };
}

test("production API headers include HSTS and browser hardening controls", () => {
  const { headers, response } = headerCollector();
  applyApiSecurityHeaders(response, true);

  assert.equal(headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(headers.get("content-security-policy"), "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
});

test("non-production API headers do not advertise HSTS over local HTTP", () => {
  const { headers, response } = headerCollector();
  applyApiSecurityHeaders(response, false);
  assert.equal(headers.has("strict-transport-security"), false);
});

test("rate limiter allows the configured quota and then returns 429", () => {
  const harness = rateLimitHarness(`unit-rate-${Date.now()}`);
  const request = {
    auth: undefined,
    ip: "203.0.113.10",
    socket: { remoteAddress: "203.0.113.10" },
    body: {},
    query: {},
    header() {
      return undefined;
    },
  };

  assert.equal(harness.invoke(request).nextCalls, 1);
  assert.equal(harness.invoke(request).nextCalls, 2);
  const rejected = harness.invoke(request);

  assert.equal(rejected.statusCode, 429);
  assert.deepEqual(rejected.payload, { message: "Rate limited" });
  assert.equal(rejected.headers.get("x-ratelimit-remaining"), "0");
  assert.ok(Number(rejected.headers.get("retry-after")) >= 1);
});

test("rate-limit field keys hash account identifiers", () => {
  const request = {
    auth: undefined,
    ip: "203.0.113.11",
    socket: { remoteAddress: "203.0.113.11" },
    body: { email: "Employee@Example.com" },
    query: {},
  };
  const fieldKey = rateLimitKeyByField("email")(request);
  const combinedKey = rateLimitKeyByRemoteAddressAndField("email")(request);

  assert.equal(fieldKey.includes("employee@example.com"), false);
  assert.equal(combinedKey.includes("employee@example.com"), false);
  assert.match(fieldKey, /^[a-f0-9]{64}$/);
});
