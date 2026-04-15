import { pool } from "@workspace/db";
import { getSupabaseStorageConfig, optionalEnv } from "./env";
import { getDeploymentConfigReport } from "./deployment-config";
import { getStartupState } from "./startup-state";

export type RuntimeHealthStatus = "ok" | "degraded" | "error";

type RuntimeDependencyCheck = {
  status: RuntimeHealthStatus;
  detail: string;
  latencyMs?: number;
};

export type RuntimeHealthReport = {
  status: RuntimeHealthStatus;
  service: "api-server";
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    startup: RuntimeDependencyCheck;
    configuration: RuntimeDependencyCheck;
    database: RuntimeDependencyCheck;
    storage: RuntimeDependencyCheck;
    externalMonitoring: RuntimeDependencyCheck;
  };
};

function parseMonitoringMinSeverity(value?: string): "info" | "warning" | "error" {
  if (value === "info" || value === "warning" || value === "error") {
    return value;
  }

  return "error";
}

function summarizeOverallStatus(checks: RuntimeHealthReport["checks"]): RuntimeHealthStatus {
  if (Object.values(checks).some((check) => check.status === "error")) {
    return "error";
  }

  if (Object.values(checks).some((check) => check.status === "degraded")) {
    return "degraded";
  }

  return "ok";
}

async function checkDatabaseHealth(): Promise<RuntimeDependencyCheck> {
  const startedAt = Date.now();

  try {
    await pool.query("select 1");
    return {
      status: "ok",
      detail: "Database query succeeded.",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database query failed.",
      latencyMs: Date.now() - startedAt,
    };
  }
}

function checkStorageHealth(): RuntimeDependencyCheck {
  const storage = getSupabaseStorageConfig();
  if (!storage) {
    return {
      status: "degraded",
      detail: "Supabase storage is not configured.",
    };
  }

  return {
    status: "ok",
    detail: `Supabase storage configured for buckets ${storage.avatarsBucket} and ${storage.expenseAttachmentsBucket}.`,
  };
}

function checkExternalMonitoringHealth(): RuntimeDependencyCheck {
  const webhookUrl = optionalEnv("PLATFORM_MONITORING_WEBHOOK_URL")?.trim();
  if (!webhookUrl) {
    return {
      status: "degraded",
      detail: "External monitoring webhook is not configured.",
    };
  }

  const minSeverity = parseMonitoringMinSeverity(optionalEnv("PLATFORM_MONITORING_MIN_SEVERITY")?.trim());
  return {
    status: "ok",
    detail: `External monitoring webhook configured with minimum severity ${minSeverity}.`,
  };
}

export async function getRuntimeHealthReport(): Promise<RuntimeHealthReport> {
  const configuration = getDeploymentConfigReport();
  const startup = getStartupState();
  const startupCheck: RuntimeDependencyCheck = {
    status: startup.status === "ready" ? "ok" : "degraded",
    detail: startup.detail,
  };
  const checks = {
    startup: startupCheck,
    configuration: {
      status: configuration.status,
      detail:
        configuration.status === "ok"
          ? "Deployment configuration is ready."
          : configuration.issues
              .filter((issue) => issue.status !== "ok")
              .map((issue) => issue.detail)
              .join(" "),
    },
    database: await checkDatabaseHealth(),
    storage: checkStorageHealth(),
    externalMonitoring: checkExternalMonitoringHealth(),
  };

  return {
    status: summarizeOverallStatus(checks),
    service: "api-server",
    environment: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  };
}
