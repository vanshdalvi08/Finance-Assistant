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

function secretLength(name: string): number {
  return optionalEnv(name)?.trim().length ?? 0;
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

  if (secretLength("JWT_ACCESS_SECRET") < 32) {
    issues.push(issue("JWT_ACCESS_SECRET", true, "error", "JWT access secret must contain at least 32 characters."));
  } else {
    issues.push(issue("JWT_ACCESS_SECRET", true, "ok", "JWT access secret is configured."));
  }

  if (secretLength("JWT_REFRESH_SECRET") < 32) {
    issues.push(issue("JWT_REFRESH_SECRET", true, "error", "JWT refresh secret must contain at least 32 characters."));
  } else {
    issues.push(issue("JWT_REFRESH_SECRET", true, "ok", "JWT refresh secret is configured."));
  }

  if (
    hasValue("JWT_ACCESS_SECRET")
    && optionalEnv("JWT_ACCESS_SECRET") === optionalEnv("JWT_REFRESH_SECRET")
  ) {
    issues.push(issue("JWT_SECRET_SEPARATION", true, "error", "JWT access and refresh secrets must be different."));
  } else {
    issues.push(issue("JWT_SECRET_SEPARATION", true, "ok", "JWT access and refresh secrets are distinct."));
  }

  const mfaEncryptionKey = optionalEnv("MFA_ENCRYPTION_KEY")?.trim() ?? "";
  let validMfaEncryptionKey = false;
  try {
    validMfaEncryptionKey = Buffer.from(mfaEncryptionKey, "base64url").length === 32;
  } catch {
    validMfaEncryptionKey = false;
  }
  issues.push(
    validMfaEncryptionKey
      ? issue("MFA_ENCRYPTION_KEY", true, "ok", "MFA secrets are protected by an application encryption key.")
      : issue("MFA_ENCRYPTION_KEY", true, "error", "MFA_ENCRYPTION_KEY must be a base64url-encoded 32-byte key."),
  );

  for (const passwordName of ["ADMIN_PASSWORD", "PLATFORM_ADMIN_PASSWORD"]) {
    if (hasValue(passwordName) && secretLength(passwordName) < 12) {
      issues.push(issue(passwordName, true, "error", `${passwordName} must contain at least 12 characters.`));
    } else if (hasValue(passwordName)) {
      issues.push(issue(passwordName, true, "ok", `${passwordName} meets the minimum length requirement.`));
    }
  }

  const oauthConfigured = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
  ].some(hasValue);
  if (oauthConfigured && secretLength("AUTH_OAUTH_STATE_SECRET") < 32) {
    issues.push(
      issue(
        "AUTH_OAUTH_STATE_SECRET",
        true,
        "error",
        "OAuth is configured, so AUTH_OAUTH_STATE_SECRET must contain at least 32 characters.",
      ),
    );
  } else if (oauthConfigured) {
    issues.push(issue("AUTH_OAUTH_STATE_SECRET", true, "ok", "OAuth state signing is configured."));
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
