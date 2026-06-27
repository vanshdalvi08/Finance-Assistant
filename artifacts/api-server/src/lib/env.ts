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

function findRepoRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }
    currentDir = parentDir;
  }
}

function loadEnvCandidates(baseDir: string) {
  const repoRoot = findRepoRoot(baseDir);
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

export function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

export function getAppUrl(): string {
  return optionalEnv("FRONTEND_URL") ?? optionalEnv("APP_URL") ?? "http://localhost:5173";
}

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return null;
  }
}

function readOriginListEnv(name: string): string[] {
  const value = optionalEnv(name);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => Boolean(item));
}

export function getApiOriginCandidates(): string[] {
  return Array.from(
    new Set([
      ...readOriginListEnv("CORS_ALLOWED_ORIGINS"),
      optionalEnv("FRONTEND_URL"),
      optionalEnv("APP_URL"),
      ...(!isProduction() ? ["http://localhost:5173", "http://localhost:3000"] : []),
    ]
      .map((value) => (typeof value === "string" ? normalizeOrigin(value) : null))
      .filter((value): value is string => Boolean(value))),
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

export function getSupabaseStorageConfig() {
  const url = optionalEnv("SUPABASE_URL");
  const serviceRoleKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    serviceRoleKey,
    avatarsBucket: optionalEnv("SUPABASE_STORAGE_AVATARS_BUCKET") ?? "yojak-avatars",
    expenseAttachmentsBucket:
      optionalEnv("SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET") ?? "yojak-expense-attachments",
    fundReceiptsBucket:
      optionalEnv("SUPABASE_STORAGE_FUND_RECEIPTS_BUCKET") ?? "yojak-fund-receipts",
    salarySlipsBucket:
      optionalEnv("SUPABASE_STORAGE_SALARY_SLIPS_BUCKET")
      ?? optionalEnv("SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET")
      ?? "yojak-expense-attachments",
  };
}
