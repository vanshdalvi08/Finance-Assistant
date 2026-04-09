import "./lib/env";
import app from "./app";
import { ensureInitialAdmin } from "./lib/auth-service";
import { logger } from "./lib/logger";
import { assertDatabaseSchemaReady } from "./lib/schema-ready";
import { ensureDefaultTenant, ensurePlatformTenant } from "./lib/tenants";
import { ensureInitialPlatformAdmin } from "./lib/platform";

const rawPort = process.env["PORT"] ?? "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  await assertDatabaseSchemaReady();
  await ensureDefaultTenant();
  await ensurePlatformTenant();
  await ensureInitialAdmin();
  await ensureInitialPlatformAdmin();

  app.listen(port, (err) => {
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
