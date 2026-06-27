# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands use pnpm (enforced via preinstall hook; managed by corepack).

### Development

```bash
# Run the API server (port 3001)
pnpm --filter @workspace/api-server run dev

# Run the frontend (port 5173)
pnpm --filter @workspace/finance-dashboard run dev
```

### Build & Typecheck

```bash
pnpm build           # Full workspace build with typecheck
pnpm typecheck       # TypeScript validation across all packages
pnpm --filter @workspace/api-server run build        # esbuild bundle → dist/index.mjs
pnpm --filter @workspace/finance-dashboard run build  # Vite build → dist/public/
```

### Database

```bash
pnpm db:generate     # Generate Drizzle migration files from schema changes
pnpm db:migrate      # Apply pending migrations
pnpm db:baseline     # Baseline existing database (first-run for existing DBs)

# Direct filter forms:
pnpm --filter @workspace/db run push        # Drizzle Kit push (dev only)
pnpm --filter @workspace/db run push-force
```

After changing any file under `lib/db/src/schema/`, always run `pnpm db:generate` to produce the SQL migration, then `pnpm db:migrate` to apply it.

### Tests

```bash
pnpm --filter @workspace/api-server run test:workflow        # Workflow/RBAC/Sheets integration tests
pnpm --filter @workspace/api-server run test:security        # E2E security tests
pnpm --filter @workspace/api-server run test:security-unit   # Auth-hardening unit tests
pnpm --filter @workspace/finance-dashboard run test:security-headers

# Single test file (Node built-in runner):
node --import tsx --test artifacts/api-server/tests/<file>.ts
```

### API Client Codegen

```bash
pnpm --filter @workspace/api-spec run codegen   # Regenerates lib/api-client-react and lib/api-zod from OpenAPI spec
```

### Local Infrastructure

```bash
docker compose -f compose.local.yml up -d   # PostgreSQL 18 on localhost:5433
```

---

## Architecture

### Monorepo Layout

```
artifacts/
  api-server/          Express 5 backend (Node ESM, esbuild)
  finance-dashboard/   React 19 + Vite frontend
lib/
  db/                  Drizzle ORM schema + migrations (shared across apps)
  api-spec/            OpenAPI spec (source)
  api-zod/             Generated Zod schemas
  api-client-react/    Generated React Query hooks
tests/                 Playwright live/e2e tests
```

### What the App Does

Multi-tenant payroll and finance management platform. Tenants (companies) have `admin`, `employee`, and `client` users. A `platform_super_admin` role exists above all tenants. Core features: timesheets, expenses, salary/payroll, project budgets, pre-approvals, financial accounts, and fund tracking.

### Backend (`artifacts/api-server`)

- **Entry**: `src/index.ts` (process lifecycle, bootstrap) → `src/app.ts` (Express middleware stack) → `src/routes/index.ts` (route groups)
- **Modules**: Feature-oriented subdirectories under `src/modules/` (expenses, funds, accounts, payroll, timesheets, notifications, etc.)
- **Older routes**: Flat files under `src/routes/` (admin.ts, auth.ts, business.ts, platform.ts, etc.)
- **Services**: `src/lib/` contains domain logic: `auth-service.ts`, `business-store.ts`, `storage.ts`, `mailer.ts`, `platform-events.ts`
- **Startup bootstrap**: On server start, the app validates DB schema readiness (`schema-ready.ts`), then seeds the platform tenant and any `ADMIN_*` env-configured admin users
- **Health check**: `GET /api/healthz` (public, no auth)

### Frontend (`artifacts/finance-dashboard`)

- **Entry**: `src/main.tsx` → `src/app/providers.tsx` (React Query, theme, auth bootstrap) → `src/App.tsx` (route table with role-based redirects)
- **Auth state**: Zustand store (`src/store/`) + axios interceptors in `src/auth/` handle bearer token injection, CSRF headers, and silent refresh
- **API layer**: `src/lib/api.ts` is the central facade for all backend calls; also uses generated React Query hooks from `lib/api-client-react`
- **Routing**: `wouter` (not React Router)
- **Styling**: Tailwind CSS v4 + Radix UI primitives

### Database (`lib/db`)

- **ORM**: Drizzle ORM v0.45 against PostgreSQL
- **Schema files**: `lib/db/src/schema/` split by domain (`tenants.ts`, `users.ts`, `business.ts`, `platform.ts`)
- **Migrations**: committed SQL in `lib/db/drizzle/` — never edit these by hand; always use `pnpm db:generate`
- **Client export**: `lib/db/src/index.ts` exports the Drizzle client and PostgreSQL pool; imported by the API server

### Auth & Security

- **Sessions**: Short-lived JWT access tokens (bearer) + long-lived refresh tokens in HTTP-only cookies
- **CSRF**: Double-submit cookie pattern; enforced in `AUTH_CSRF_ENFORCE` env flag
- **MFA**: TOTP-based; configurable enforcement per role via `MFA_REQUIRED_ROLES`
- **RBAC**: Middleware in `src/middlewares/auth.ts` enforces role and tenant isolation on every protected route
- **Multi-tenancy**: All business tables have a `tenantId` foreign key; queries always scope by tenant

### Environment Setup

Copy `.env.example` to `.env` (root) and `artifacts/api-server/.env.example` to `artifacts/api-server/.env`. The minimum required variables to run locally:

```
DATABASE_URL=postgresql://reforix_local:reforix_local_only@localhost:5433/reforix_local
JWT_ACCESS_SECRET=<any secret>
JWT_REFRESH_SECRET=<any secret>
MFA_ENCRYPTION_KEY=<32-byte hex>
ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE  # seeds first admin on startup
```

Supabase Storage variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket names) are optional for local dev — file upload features will degrade gracefully without them.

### Key Conventions

- **Idempotency**: Mutating API endpoints use the `idempotency_keys` table to deduplicate retries
- **Audit trail**: Significant mutations write to the `audit_trail` table via `src/lib/business-store.ts`
- **Platform events**: Errors and security incidents are recorded in `platform_events` and optionally forwarded to a webhook (`PLATFORM_MONITORING_WEBHOOK_URL`)
- **Google Sheets sync**: Real-time listener in `src/integrations/` syncs business data; enabled by `GOOGLE_*` env vars
- **Supply-chain**: `pnpm-workspace.yaml` enforces a minimum 1-day npm package release age to prevent typosquatting attacks
