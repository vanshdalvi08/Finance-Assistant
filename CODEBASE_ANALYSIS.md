# Codebase Analysis

## High-Level Architecture

This repository is a pnpm workspace for a finance/payroll management system. The active product is split into:

- `artifacts/finance-dashboard`: React/Vite frontend.
- `artifacts/api-server`: Express API server.
- `lib/db`: shared Drizzle ORM/PostgreSQL schema and database client.
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: generated/shared API typing packages, currently minimal compared with the hand-written app API.
- `tests` and `artifacts/api-server/tests`: Playwright and Node test suites.

The root workspace enforces pnpm, TypeScript project builds, and shared dependency versions through `pnpm-workspace.yaml`.

## Frontend Framework

- Framework: React 19 with Vite.
- Routing: `wouter`, wired in `artifacts/finance-dashboard/src/App.tsx`.
- Data fetching/cache: `@tanstack/react-query` through `AppProviders`.
- State management: Zustand, notably `src/store/auth.ts` and `src/store/ui.ts`.
- HTTP client: Axios wrappers in `src/auth/http-client.ts`.
- UI system: Tailwind CSS 4, Radix UI primitives, shadcn-style local components under `src/components/ui`, lucide icons, Sonner/toast support.

Frontend entry flow:

- `src/main.tsx` renders `<App />`.
- `src/app/providers.tsx` installs theme, React Query, tooltip, auth bootstrap, and toast providers.
- `src/App.tsx` uses role-aware routes for admin, employee, client, and platform super admin screens.

## Backend Framework

- Framework: Express 5 on Node ESM.
- Entry point: `artifacts/api-server/src/index.ts`.
- App setup: `artifacts/api-server/src/app.ts`.
- Route root: all API routes are mounted under `/api`.
- Logging: `pino`/`pino-http`.
- Validation: `zod`.
- Database access: Drizzle ORM via `@workspace/db`.
- Auth/session tooling: `jsonwebtoken`, `bcryptjs`, cookie refresh tokens, CSRF cookies, optional MFA via `otplib`.
- External integrations: Google Sheets listener/service, SMTP mailer, optional Supabase-like upload storage config.

Startup bootstraps production config, database schema readiness, default tenant, platform tenant, initial tenant admin, and initial platform admin before listening outside test mode.

## Folder Structure

- `.github`: CI/workflow configuration.
- `artifacts/api-server`: backend app.
  - `src/app.ts`: Express middleware, CORS, security headers, request logging, error handling, `/api` mount.
  - `src/index.ts`: process lifecycle, startup bootstrap, server listen/shutdown.
  - `src/routes`: top-level route groups: auth, admin, business, platform, notifications, uploads, health.
  - `src/modules`: newer business route modules for expenses, funds, accounts, payroll, projects, purchase orders, and timesheets.
  - `src/lib`: domain services, auth service, business store, policies, platform event helpers, mail/storage/env utilities.
  - `src/middlewares`: auth/RBAC, CSRF, rate limiting.
  - `src/integrations/googleSheets`: Google Sheets sync/listener integration.
  - `tests`: Node test files for workflows, RBAC, security, Google Sheets, and smoke coverage.
- `artifacts/finance-dashboard`: frontend app.
  - `src/App.tsx`: route table and role redirects.
  - `src/app/providers.tsx`: app-level providers and session bootstrapping.
  - `src/auth`: session storage, login/logout/bootstrap, axios interceptors.
  - `src/lib/api.ts`: hand-written API facade and frontend DTOs.
  - `src/pages`: admin, employee, client, auth, platform, and shared pages.
  - `src/components`: app-specific layout/widgets and local UI primitives.
  - `src/store`: Zustand stores.
- `lib/db`: shared database package.
  - `src/index.ts`: PostgreSQL pool and Drizzle client.
  - `src/schema`: schema modules for tenants, users, sessions, MFA, reset tokens, business, notifications, platform events.
  - `drizzle`: SQL migrations and Drizzle metadata.
- `lib/api-spec`: OpenAPI source; currently only includes the health endpoint.
- `lib/api-zod` and `lib/api-client-react`: generated Zod/client packages from the API spec.
- `tests`: Playwright end-to-end/live specs.
- `docs/operations`: operational runbooks for security monitoring, secrets rotation, backup/recovery.
- `scripts`: small workspace scripts and assets.

## Important APIs

All backend routes are mounted under `/api`.

- `/api/healthz`: health check.
- `/api/auth`
  - `GET /csrf`: issue CSRF token cookie.
  - `GET /oauth/:provider/start`, `GET /oauth/:provider/callback`: Google/Microsoft OAuth flow.
  - `POST /login`: password login; may return MFA challenge.
  - `POST /mfa/verify`: MFA challenge completion.
  - `POST /refresh`: refresh access token using refresh cookie and CSRF token.
  - `POST /logout`, `POST /logout-all`: revoke sessions and clear cookies.
  - `POST /request-reset`, `POST /reset`: password reset flow.
  - `GET /me`, `PATCH /me`: current-user profile.
- `/api/admin`
  - Admin-only account management for admins, employees, and clients.
- `/api/business`
  - Dashboard overview, charts, transactions, audit trail.
  - Holidays, leave settings, leave requests.
  - Company settings.
  - Employee/admin business data endpoints.
  - Pre-approval workflows for admin/client collaboration.
  - Mounted modules for funds, financial accounts, expenses, payroll/salaries, purchase orders, timesheets, and projects.
- `/api/platform`
  - Platform-super-admin-only tenant management, monitoring, recovery drills, retention, settings.
- `/api/notifications`
  - Current-user notification listing and read/read-all mutations.
- `/api/uploads`
  - Profile photo, expense attachment, and fund receipt uploads.

The frontend primarily talks to these APIs through:

- `artifacts/finance-dashboard/src/auth/http-client.ts`: Axios instances, base URL resolution, bearer token injection, CSRF handling, refresh retry.
- `artifacts/finance-dashboard/src/auth/auth-service.ts`: auth and account-management API functions.
- `artifacts/finance-dashboard/src/lib/api.ts`: domain API facade used by pages/components.

## Database Schema

Database: PostgreSQL, modeled with Drizzle ORM in `lib/db/src/schema`.

Core tenancy/auth entities:

- `tenants`: tenant records with `id`, `name`, `slug`, `status`.
- `users`: all application users. Roles are `admin`, `employee`, `client`, and `platform_super_admin`. Users belong to tenants.
- `refresh_sessions`: hashed refresh-token session records per user.
- `mfa_trusted_devices`: hashed trusted-device tokens per user.
- `password_reset_tokens`: hashed password reset tokens per user.

Business entities:

- `company_settings`: tenant-level company and leave policy settings.
- `financial_accounts`: tenant accounts used for operational/personal/reserve/cash reporting.
- `funds`: inbound funds, optionally tied to a financial account and receipt.
- `expense_categories`: shared category definitions by group.
- `expenses`: tenant expenses, optionally tied to a financial account and employee.
- `salaries`: payroll records, optionally tied to employee, account, and generated timesheet.
- `timesheets`: weekly employee timesheets.
- `timesheet_lines`: normalized line items for timesheets, linked to projects/tasks/budgets.
- `projects`: tenant projects.
- `project_tasks`: tasks under projects, with hour/window constraints and optional per-employee limits.
- `project_budgets`: legacy/parallel project budget records with JSON task lists.
- `purchase_orders`: purchase order headers with JSON task records.
- `pre_approvals`: client-facing approval workflow records with JSON task/comment/project/client metadata.
- `audit_trail`: tenant audit log for business events.
- `idempotency_keys`: request idempotency records.
- `business_state`: legacy JSON state table retained alongside normalized tables.

Platform and messaging entities:

- `notifications`: in-app/email notification records for users.
- `platform_events`: platform monitoring events for request/auth/database/upload/tenant/system categories.

Key relationships:

- `tenants` own most tenant-scoped records through `tenantId`.
- `users.tenantId` references `tenants.id`.
- `refresh_sessions`, `mfa_trusted_devices`, and `password_reset_tokens` reference `users.id`.
- `funds`, `expenses`, `salaries`, `financial_accounts`, `projects`, `project_tasks`, `project_budgets`, `purchase_orders`, `pre_approvals`, and `audit_trail` are tenant-scoped.
- `expenses.employeeId`, `salaries.employeeId`, `pre_approvals.clientId`, and `audit_trail.actorUserId` reference `users.id`.
- `project_tasks.projectId` references `projects.id`.
- `timesheets.employeeId` references `users.id`.
- `timesheet_lines.timesheetId` references `timesheets.id`; optional links connect to `project_budgets`, `projects`, and `project_tasks`.
- `pre_approvals.receivedFundId` references `funds.id`.
- `notifications.recipientId` and `notifications.actorId` reference `users.id`.
- `platform_events.tenantId` and actor/acknowledge/resolve user fields reference tenants/users.

## Authentication Flow

Backend:

- Password login is handled by `POST /api/auth/login`, backed by `loginWithPassword` in `src/lib/auth-service.ts`.
- Passwords are hashed and verified with helpers in `src/lib/security.ts`.
- Successful login creates a refresh session, returns an access token, and sets an HTTP cookie refresh token.
- Access tokens are sent as `Authorization: Bearer ...` and verified by `requireAuth`.
- Refresh tokens are stored in cookies; only hashed JTIs are persisted in `refresh_sessions`.
- Refresh uses `POST /api/auth/refresh`, protected by CSRF token validation.
- CSRF token is issued through `/api/auth/csrf` and attached for refresh/logout-style auth mutations.
- MFA is required for configured roles, defaults to admin/platform roles in production, and uses TOTP plus optional trusted-device cookies.
- OAuth start/callback supports Google and Microsoft, then maps OAuth identity by email.
- RBAC is enforced by `requireTenantRole`, `requirePlatformRole`, and route-level role guards.

Frontend:

- `useAuthStore` bootstraps by calling `bootstrapSession`, which attempts a refresh-token session restore.
- `auth/http-client.ts` keeps access and CSRF tokens in client-side session helpers, attaches bearer tokens to API requests, and retries authenticated requests once after a 401 by refreshing.
- `App.tsx` gates pages by role and redirects users to admin, employee, client, or platform workspaces.
- A per-tab session user id in `sessionStorage` prevents silent identity switching in the same browser tab.

## Main Business Modules

- Accounts and cash flow: financial accounts, funds, transactions, operational reporting.
- Expenses: personal/office expense submission, attachments, historical/admin creation, review status.
- Payroll/salary: salary records, paid status, timesheet-derived payroll snapshots.
- Timesheets: weekly employee time entry, line items, daily review state, submission/approval/rejection, work notes.
- Projects and tasks: project catalog, task constraints, employee-specific hour limits, task windows.
- Project budgets: budget/task records used in older and current timesheet flows.
- Purchase orders: PO creation, task tracking, paid task status, archival.
- Pre-approvals: admin-created approval documents, client comments/approval/change requests, fund receipt after approval.
- Users and roles: admin/employee/client provisioning and deactivation.
- Leave management: holidays, leave policy/settings, leave request lifecycle.
- Notifications: in-app/email notification creation and read tracking.
- Platform administration: tenant lifecycle, platform event monitoring, recovery drills, retention/pruning.
- Audit trail: append-only business event tracking with before/after/context metadata.

## Existing Coding Patterns

- Workspace packages use TypeScript ESM and pnpm workspace imports such as `@workspace/db`.
- Backend routes use Express routers, Zod validation, explicit role middleware, and JSON responses.
- Newer domain code is moving toward module folders under `src/modules/*` with route and service files.
- Older/consolidated domain code still lives in `src/routes/business.ts` and `src/lib/business-store.ts`, bridging normalized Drizzle tables and legacy JSON-shaped frontend DTOs.
- Drizzle schema modules colocate table definitions, insert schemas, inferred types, indexes, checks, and relations.
- Most IDs for business records are text IDs generated in application code; core auth/tenant records use UUIDs.
- Monetary amounts are stored as integers.
- Several complex business details are stored in JSONB fields, especially task lists, comments, settings, daily review flags, and legacy state.
- Frontend pages call a centralized API facade and use React Query for server state.
- Frontend auth is isolated in `src/auth` and global session state in Zustand.
- UI components follow a shadcn/Radix composition style with local component wrappers and Tailwind utility classes.
- Tests are split between backend Node tests and Playwright live specs.

## Notes and Risks

- The OpenAPI spec in `lib/api-spec/openapi.yaml` only documents `/healthz`; most real APIs are hand-written and not represented in generated clients.
- `business_state` and `business-store.ts` indicate a legacy JSON-store compatibility layer alongside normalized tables.
- There are existing uncommitted changes in several files at the time of analysis; this document does not inspect or modify those changes beyond reading current workspace contents.
