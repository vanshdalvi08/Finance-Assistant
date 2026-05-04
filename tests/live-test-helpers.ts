import { expect, request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hash } from "bcryptjs";
import pg from "pg";
import { authenticator } from "otplib";

const { Client } = pg;

// Use IPv4 explicitly so the live suite doesn't depend on localhost resolving to ::1.
const API_BASE_URL = "http://127.0.0.1:3001";
export const FRONTEND_ORIGIN = "http://127.0.0.1:5173";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000101";

export const DEFAULT_ADMIN_EMAIL = "admin@reforix.com";
export const DEFAULT_ADMIN_PASSWORD = "reforix123";

export type ApiSession = {
  client: APIRequestContext;
  accessToken: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
};

function apiUrl(pathname: string) {
  return `${API_BASE_URL}${pathname}`;
}

function commonHeaders(extra?: Record<string, string>) {
  return {
    Origin: FRONTEND_ORIGIN,
    Referer: `${FRONTEND_ORIGIN}/`,
    "X-Test-Bypass-Rate-Limit": "1",
    ...extra,
  };
}

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

function loadDatabaseUrl() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "artifacts/api-server/.env.local"),
    path.resolve(process.cwd(), "artifacts/api-server/.env"),
    path.resolve(process.cwd(), "lib/db/.env.local"),
    path.resolve(process.cwd(), "lib/db/.env"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = parseEnv(readFileSync(candidate, "utf8"));
    if (parsed.DATABASE_URL?.trim()) {
      return parsed.DATABASE_URL.trim();
    }
  }

  throw new Error("DATABASE_URL not found in local environment files.");
}

export async function ensureDefaultAdminCredentials() {
  const client = new Client({ connectionString: loadDatabaseUrl() });
  const hashedPassword = await hash(DEFAULT_ADMIN_PASSWORD, 10);
  const now = new Date().toISOString();

  await client.connect();

  try {
    await client.query(
      `
        insert into tenants (id, name, slug, status, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $5)
        on conflict (id) do update
        set name = excluded.name,
            slug = excluded.slug,
            status = excluded.status,
            updated_at = excluded.updated_at
      `,
      [DEFAULT_TENANT_ID, "Yojak", "yojak", "active", now],
    );

    const existingAdminResult = await client.query<{
      id: string;
      phone: string;
    }>(
      `
        select id, phone
        from users
        where email = $1
           or (tenant_id = $2 and role = 'admin')
        order by case when email = $1 then 0 else 1 end, created_at asc
        limit 1
      `,
      [DEFAULT_ADMIN_EMAIL, DEFAULT_TENANT_ID],
    );

    const existingAdmin = existingAdminResult.rows[0];
    const resolvedPhone = existingAdmin?.phone?.trim() || "9999999999";

    if (existingAdmin) {
      await client.query(
        `
          update users
          set tenant_id = $2,
              name = $3,
              email = $4,
              phone = $5,
              role = 'admin',
              employee_id = null,
              position = $6,
              department = $7,
              salary = 0,
              pay_type = 'monthly',
              hourly_rate = 0,
              profile_photo_url = null,
              client_info = $8::jsonb,
              hashed_password = $9,
              status = 'active',
              mfa_enabled = false,
              mfa_secret = null,
              mfa_enrolled_at = null,
              mfa_updated_at = null,
              updated_at = $10,
              last_login_at = null
          where id = $1
        `,
        [
          existingAdmin.id,
          DEFAULT_TENANT_ID,
          "Reforix Admin",
          DEFAULT_ADMIN_EMAIL,
          resolvedPhone,
          "Administrator",
          "Operations",
          JSON.stringify({}),
          hashedPassword,
          now,
        ],
      );
      return;
    }

    await client.query(
      `
        insert into users (
          tenant_id,
          name,
          email,
          phone,
          role,
          employee_id,
          position,
          department,
          salary,
          pay_type,
          hourly_rate,
          profile_photo_url,
          client_info,
          hashed_password,
          status,
          mfa_enabled,
          mfa_secret,
          mfa_enrolled_at,
          mfa_updated_at,
          created_at,
          updated_at,
          last_login_at
        )
        values (
          $1,
          $2,
          $3,
          $4,
          'admin',
          null,
          $5,
          $6,
          0,
          'monthly',
          0,
          null,
          $7::jsonb,
          $8,
          'active',
          false,
          null,
          null,
          null,
          $9,
          $9,
          null
        )
      `,
      [
        DEFAULT_TENANT_ID,
        "Reforix Admin",
        DEFAULT_ADMIN_EMAIL,
        "9999999999",
        "Administrator",
        "Operations",
        JSON.stringify({}),
        hashedPassword,
        now,
      ],
    );
  } finally {
    await client.end();
  }
}

export async function loginApi(email: string, password: string, providedClient?: APIRequestContext): Promise<ApiSession> {
  const client =
    providedClient
    ?? await playwrightRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: commonHeaders(),
    });

  const csrfResponse = await client.get(apiUrl("/api/auth/csrf"), {
    headers: commonHeaders(),
  });
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfPayload = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await client.post(apiUrl("/api/auth/login"), {
    data: { email, password },
    headers: commonHeaders({
      "x-csrf-token": csrfPayload.csrfToken,
    }),
  });

  if (loginResponse.status() === 202) {
    const challenge = (await loginResponse.json()) as {
      mfaToken: string;
      mfaSecret?: string;
      user: ApiSession["user"];
    };

    if (!challenge.mfaSecret) {
      throw new Error(`MFA challenge for ${email} did not include a setup secret.`);
    }

    const verifyResponse = await client.post(apiUrl("/api/auth/mfa/verify"), {
      data: {
        mfaToken: challenge.mfaToken,
        code: authenticator.generate(challenge.mfaSecret),
        rememberDevice: false,
      },
      headers: commonHeaders({
        "x-csrf-token": csrfPayload.csrfToken,
      }),
    });

    if (!verifyResponse.ok()) {
      throw new Error(`MFA verification failed for ${email} with status ${verifyResponse.status()}.`);
    }

    const verifyPayload = (await verifyResponse.json()) as {
      accessToken: string;
      csrfToken: string;
      user: ApiSession["user"];
    };

    return {
      client,
      accessToken: verifyPayload.accessToken,
      csrfToken: verifyPayload.csrfToken,
      user: verifyPayload.user,
    };
  }

  if (!loginResponse.ok()) {
    const body = await loginResponse.text();
    throw new Error(`Login failed for ${email} with status ${loginResponse.status()}: ${body || "<empty>"}`);
  }

  const loginPayload = (await loginResponse.json()) as {
    accessToken: string;
    csrfToken: string;
    user: ApiSession["user"];
  };

  return {
    client,
    accessToken: loginPayload.accessToken,
    csrfToken: loginPayload.csrfToken,
    user: loginPayload.user,
  };
}

export function authHeaders(session: ApiSession, extras?: Record<string, string>) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "x-csrf-token": session.csrfToken,
    ...extras,
  };
}

export function trackPageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

export async function createAuthenticatedContext(browser: Browser, email: string, password: string): Promise<{
  context: BrowserContext;
  page: Page;
  pageErrors: string[];
}> {
  const authClient = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: commonHeaders(),
  });
  await loginApi(email, password, authClient);
  const storageState = await authClient.storageState();
  await authClient.dispose();

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const pageErrors = trackPageErrors(page);
  return { context, page, pageErrors };
}
