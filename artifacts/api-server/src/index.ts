import "./lib/env";
import app from "./app";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { ensureInitialAdmin } from "./lib/auth-service";
import { logger } from "./lib/logger";
import { recordPlatformEventSafe } from "./lib/platform";
import { assertDatabaseSchemaReady } from "./lib/schema-ready";
import { ensureDefaultTenant, ensurePlatformTenant } from "./lib/tenants";
import { ensureInitialPlatformAdmin } from "./lib/platform";
import { assertProductionConfigReady } from "./lib/deployment-config";

const rawPort = process.env["PORT"] ?? "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let server: Server | null = null;
let shuttingDown = false;

async function closeRuntime() {
  const tasks: Array<Promise<unknown>> = [];

  if (server) {
    tasks.push(
      new Promise<void>((resolve) => {
        server?.close(() => resolve());
      }),
    );
  }

  tasks.push(pool.end().catch(() => undefined));
  await Promise.allSettled(tasks);
}

async function shutdownProcess(reason: string, exitCode: number) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.warn({ reason, exitCode }, "Shutting down server");

  const hardExitTimer = setTimeout(() => {
    process.exit(exitCode);
  }, 10_000);
  hardExitTimer.unref?.();

  try {
    await closeRuntime();
  } finally {
    clearTimeout(hardExitTimer);
    process.exit(exitCode);
  }
}

function installProcessHandlers() {
  process.on("SIGINT", () => {
    void shutdownProcess("sigint", 0);
  });

  process.on("SIGTERM", () => {
    void shutdownProcess("sigterm", 0);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
    void recordPlatformEventSafe({
      severity: "error",
      category: "system",
      title: "Unhandled promise rejection",
      message: "A promise rejection reached the process boundary.",
      metadata: {
        source: "process_unhandled_rejection",
        reason: reason instanceof Error ? reason.message : String(reason),
      },
    });
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    const forcedShutdown = setTimeout(() => {
      void shutdownProcess("uncaught_exception_timeout", 1);
    }, 1_500);
    forcedShutdown.unref?.();

    void recordPlatformEventSafe({
      severity: "error",
      category: "system",
      title: "Uncaught exception",
      message: "A fatal exception reached the process boundary and the server is shutting down.",
      suppressExternalDispatch: true,
      metadata: {
        source: "process_uncaught_exception",
        errorName: error.name,
        errorMessage: error.message,
      },
    }).finally(() => {
      clearTimeout(forcedShutdown);
      void shutdownProcess("uncaught_exception", 1);
    });
  });
}

async function startServer() {
  installProcessHandlers();
  assertProductionConfigReady();
  await assertDatabaseSchemaReady();
  await ensureDefaultTenant();
  await ensurePlatformTenant();
  await ensureInitialAdmin();
  await ensureInitialPlatformAdmin();

  server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
