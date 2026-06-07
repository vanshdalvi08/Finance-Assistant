import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configUrl = new URL("../vercel.json", import.meta.url);

function parseDirectives(value) {
  return new Map(
    value
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );
}

test("Vercel applies hardening headers to every frontend route", async () => {
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  const globalRule = config.headers?.find((rule) => rule.source === "/(.*)");

  assert.ok(globalRule, "Expected a global Vercel header rule");

  const headers = new Map(
    globalRule.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );

  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("strict-transport-security"), "max-age=63072000");
  assert.equal(headers.get("x-xss-protection"), "0");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(headers.get("permissions-policy") ?? "", /microphone=\(\)/);
  assert.match(headers.get("permissions-policy") ?? "", /geolocation=\(\)/);
  assert.equal(headers.has("content-security-policy"), false, "CSP must remain non-enforcing during rollout");

  const policy = headers.get("content-security-policy-report-only");
  assert.ok(policy, "Expected Content-Security-Policy-Report-Only");
  assert.equal(
    headers.get("reporting-endpoints"),
    'csp-endpoint="https://api.payroll.reforix.com/api/security/csp-report"',
  );

  const directives = parseDirectives(policy);
  assert.deepEqual(directives.get("default-src"), ["'none'"]);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("script-src-attr"), ["'none'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("frame-src"), ["'none'"]);
  assert.deepEqual(directives.get("worker-src"), ["'none'"]);
  assert.ok(directives.has("upgrade-insecure-requests"));
  assert.deepEqual(directives.get("report-to"), ["csp-endpoint"]);
  assert.deepEqual(directives.get("report-uri"), ["https://api.payroll.reforix.com/api/security/csp-report"]);
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!directives.get("script-src")?.includes("'unsafe-inline'"));
});
