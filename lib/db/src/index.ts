import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { loadDatabaseEnv } from "./env";

const { Pool } = pg;

loadDatabaseEnv(path.resolve(import.meta.dirname));

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "test") {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/finance_assistant?sslmode=disable";
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (process.env.NODE_ENV !== "production" && process.env.ALLOW_REMOTE_DEV_DATABASE !== "true") {
  const databaseHost = new URL(process.env.DATABASE_URL).hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(databaseHost)) {
    throw new Error(
      `Blocked non-production connection to remote database host "${databaseHost}". `
      + "Use a local database or explicitly set ALLOW_REMOTE_DEV_DATABASE=true.",
    );
  }
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
