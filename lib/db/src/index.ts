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

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
