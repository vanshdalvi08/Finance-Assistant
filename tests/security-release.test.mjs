import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

const forbiddenEnvironmentFile =
  /(^|\/)\.env(?:$|\.(?:local|development|production|staging|test)(?:\.local)?$)/i;
const textExtensions =
  /\.(?:cjs|css|env|example|html|js|json|jsx|md|mjs|ps1|sh|ts|tsx|txt|yaml|yml)$/i;

const highConfidenceSecretPatterns = [
  {
    name: "private key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?!\\nYOUR_KEY\\n)[\s\S]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "Stripe live key", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

test("release contains no tracked runtime environment files", () => {
  const leaked = trackedFiles().filter((file) => forbiddenEnvironmentFile.test(file.replaceAll("\\", "/")));
  assert.deepEqual(leaked, []);
});

test("tracked text files contain no high-confidence credential signatures", () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (!textExtensions.test(file)) {
      continue;
    }
    const content = readFileSync(path.join(root, file), "utf8");
    for (const check of highConfidenceSecretPatterns) {
      if (check.pattern.test(content)) {
        findings.push(`${file}: ${check.name}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

test("frontend environment variables do not declare credential-like values", () => {
  const findings = [];
  const sensitiveName = /\bVITE_[A-Z0-9_]*(?:SECRET|PASSWORD|PASSCODE|PRIVATE|SERVICE_ROLE|TOKEN|API_KEY)[A-Z0-9_]*\b/g;
  for (const file of trackedFiles().filter((entry) => entry.startsWith("artifacts/finance-dashboard/"))) {
    if (!textExtensions.test(file)) {
      continue;
    }
    const content = readFileSync(path.join(root, file), "utf8");
    for (const match of content.matchAll(sensitiveName)) {
      findings.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(findings, []);
});
