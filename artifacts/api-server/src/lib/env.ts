import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value.replace(/\\n/g, "\n");
  }

  return values;
}

function loadEnvFile(filePath: string | null) {
  if (!filePath) {
    return;
  }

  const parsed = parseEnv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnvCandidates(baseDir: string) {
  const repoRoot = path.resolve(baseDir, "..", "..", "..");
  const candidates = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "artifacts", "api-server", ".env.local"),
    path.join(repoRoot, "artifacts", "api-server", ".env"),
    path.join(repoRoot, "lib", "db", ".env.local"),
    path.join(repoRoot, "lib", "db", ".env"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadEnvFile(candidate);
    }
  }
}

loadEnvCandidates(process.cwd());

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value !== undefined) {
    return value;
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getAppUrl(): string {
  return optionalEnv("FRONTEND_URL") ?? optionalEnv("APP_URL") ?? "http://localhost:5173";
}

export function getApiOriginCandidates(): string[] {
  return Array.from(
    new Set([
      optionalEnv("FRONTEND_URL"),
      optionalEnv("APP_URL"),
      "http://localhost:5173",
      "http://localhost:3000",
    ].filter((value): value is string => Boolean(value))),
  );
}

export function getJwtSecret(name: string, fallback: string): string {
  return optionalEnv(name) ?? (isProduction() ? env(name) : fallback);
}

export function getSmtpConfig() {
  const host = optionalEnv("SMTP_HOST");
  const user = optionalEnv("SMTP_USER");
  const pass = optionalEnv("SMTP_PASS");
  const from = optionalEnv("SMTP_FROM") ?? (user ? user : "no-reply@localhost");
  const port = Number(optionalEnv("SMTP_PORT") ?? "587");
  const secure = String(optionalEnv("SMTP_SECURE") ?? "false").toLowerCase() === "true";

  if (!host || !user || !pass) {
    return null;
  }

  return { host, port, secure, user, pass, from };
}
