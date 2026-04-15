import { getApiOriginCandidates, getSmtpConfig, getSupabaseStorageConfig, isProduction, isTest, optionalEnv } from "./env";

export type DeploymentConfigStatus = "ok" | "degraded" | "error";

export type DeploymentConfigIssue = {
  key: string;
  required: boolean;
  status: DeploymentConfigStatus;
  detail: string;
};

export type DeploymentConfigReport = {
  status: DeploymentConfigStatus;
  environment: string;
  issues: DeploymentConfigIssue[];
};

function hasValue(name: string): boolean {
  return Boolean(optionalEnv(name)?.trim());
}

function issue(key: string, required: boolean, status: DeploymentConfigStatus, detail: string): DeploymentConfigIssue {
  return { key, required, status, detail };
}

function summarizeStatus(issues: DeploymentConfigIssue[]): DeploymentConfigStatus {
  if (issues.some((current) => current.status === "error")) {
    return "error";
  }

  if (issues.some((current) => current.status === "degraded")) {
    return "degraded";
  }

  return "ok";
}

export function getDeploymentConfigReport(): DeploymentConfigReport {
  const environment = process.env.NODE_ENV ?? "development";
  if (!isProduction() || isTest()) {
    return {
      status: "ok",
      environment,
      issues: [
        issue(
          "production-config",
          false,
          "ok",
          isTest()
            ? "Strict production configuration checks are skipped in test mode."
            : "Production configuration checks are skipped outside production.",
        ),
      ],
    };
  }

  const issues: DeploymentConfigIssue[] = [];

  if (!hasValue("DATABASE_URL")) {
    issues.push(issue("DATABASE_URL", true, "error", "Database URL is required for production."));
  } else {
    issues.push(issue("DATABASE_URL", true, "ok", "Database URL is configured."));
  }

  if (!hasValue("JWT_ACCESS_SECRET")) {
    issues.push(issue("JWT_ACCESS_SECRET", true, "error", "JWT access secret is required for production."));
  } else {
    issues.push(issue("JWT_ACCESS_SECRET", true, "ok", "JWT access secret is configured."));
  }

  if (!hasValue("JWT_REFRESH_SECRET")) {
    issues.push(issue("JWT_REFRESH_SECRET", true, "error", "JWT refresh secret is required for production."));
  } else {
    issues.push(issue("JWT_REFRESH_SECRET", true, "ok", "JWT refresh secret is configured."));
  }

  const apiOrigins = getApiOriginCandidates();
  if (apiOrigins.length === 0) {
    issues.push(
      issue(
        "CORS_ALLOWED_ORIGINS",
        true,
        "error",
        "At least one public frontend origin must be configured for production CORS.",
      ),
    );
  } else {
    issues.push(
      issue(
        "CORS_ALLOWED_ORIGINS",
        true,
        "ok",
        `CORS allows ${apiOrigins.length} origin${apiOrigins.length === 1 ? "" : "s"}.`,
      ),
    );
  }

  const storage = getSupabaseStorageConfig();
  if (!storage) {
    issues.push(
      issue(
        "SUPABASE_STORAGE",
        true,
        "error",
        "Supabase storage URL and service role key are required for production uploads.",
      ),
    );
  } else {
    issues.push(issue("SUPABASE_STORAGE", true, "ok", "Supabase storage is configured."));
  }

  const smtp = getSmtpConfig();
  if (!smtp) {
    issues.push(issue("SMTP", true, "error", "SMTP host, user, and password are required for production email delivery."));
  } else {
    issues.push(issue("SMTP", true, "ok", "SMTP is configured."));
  }

  const monitoringWebhook = optionalEnv("PLATFORM_MONITORING_WEBHOOK_URL")?.trim();
  if (!monitoringWebhook) {
    issues.push(
      issue(
        "PLATFORM_MONITORING_WEBHOOK_URL",
        false,
        "degraded",
        "External monitoring webhook is optional and not configured.",
      ),
    );
  } else {
    issues.push(issue("PLATFORM_MONITORING_WEBHOOK_URL", false, "ok", "External monitoring webhook is configured."));
  }

  return {
    status: summarizeStatus(issues),
    environment,
    issues,
  };
}

export function assertProductionConfigReady(): void {
  const report = getDeploymentConfigReport();
  if (report.status !== "error") {
    return;
  }

  const missing = report.issues
    .filter((current) => current.status === "error")
    .map((current) => `- ${current.detail}`)
    .join("\n");

  throw new Error(
    `Production configuration is incomplete. Fix the following before starting the API server:\n${missing}`,
  );
}
