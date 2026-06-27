# Architecture

## Repository Shape

This codebase is a pnpm workspace for a finance/payroll management application. The main runtime apps and shared packages are:

- `artifacts/finance-dashboard`: React/Vite frontend.
- `artifacts/api-server`: Express API backend.
- `lib/db`: shared Drizzle ORM/PostgreSQL database package.
- `lib/api-spec`: OpenAPI source, currently only documenting `/healthz`.
- `lib/api-zod`: generated Zod package from the API spec.
- `lib/api-client-react`: generated React Query client package from the API spec.
- `tests`: Playwright live/end-to-end tests.
- `artifacts/api-server/tests`: backend Node test files.

The root `package.json` enforces pnpm and provides workspace-wide `build`, `typecheck`, and database migration scripts.

## Frontend

The frontend is in `artifacts/finance-dashboard`.

Stack:

- React 19.
- Vite.
- TypeScript.
- `wouter` for routing.
- `@tanstack/react-query` for server-state caching.
- Zustand for auth/UI state.
- Axios for HTTP requests.
- Tailwind CSS 4.
- Radix UI primitives and local shadcn-style components under `src/components/ui`.

Primary frontend files:

- `src/main.tsx`: React root render.
- `src/App.tsx`: route table, role guards, legacy redirects.
- `src/app/providers.tsx`: theme, React Query, tooltip, auth bootstrap, toasts.
- `src/auth/http-client.ts`: API base URL selection, Axios instances, CSRF handling, bearer-token attachment, 401 refresh retry.
- `src/auth/auth-service.ts`: login, logout, MFA verification, password reset, profile/account API wrappers.
- `src/store/auth.ts`: Zustand auth state and session hydration.
- `src/lib/api.ts`: hand-written business API facade and frontend DTOs.

Frontend route groups in `src/App.tsx`:

- Public/auth: `/login`, `/reset`.
- Admin: `/`, `/transactions`, `/admins`, `/employees`, `/salary`, `/funds`, `/clients`, `/purchase-orders`, `/pre-approvals`, `/project-budgets`, `/expenses`, `/settings`, `/settings/financial-accounts`, `/timesheets`, `/leave-management`, `/reports`, `/audit-trail`.
- Employee: `/employee/timesheet`, `/employee/task-manager`, `/employee/leaves`, `/employee/expenses`, `/employee/salary-slips`, `/employee/profile`.
- Client: `/client/pre-approvals`.
- Platform super admin: `/platform/dashboard`, `/platform/tenants`, `/platform/monitoring`, `/platform/recovery`, `/platform/settings`.

## Backend

The backend is in `artifacts/api-server`.

Stack:

- Express 5.
- TypeScript compiled with esbuild through `build.mjs`.
- Node ESM.
- Drizzle ORM through `@workspace/db`.
- Zod for request validation.
- `pino` and `pino-http` for logging.
- `cookie-parser` and `cors`.
- `jsonwebtoken` for access/refresh/MFA tokens.
- `bcryptjs` for password hashing.
- `otplib` for MFA TOTP.
- `nodemailer` for mail.
- `googleapis` for Google Sheets integration.

Primary backend files:

- `src/index.ts`: loads env/integrations, bootstraps runtime state, starts server, installs process shutdown/error handlers.
- `src/app.ts`: Express app setup, logging, CORS, security headers, body parsing, test startup gate, `/api` router mount, error handler.
- `src/routes/index.ts`: mounts top-level API routers.
- `src/middlewares/auth.ts`: bearer-token auth, session validation, tenant/user status checks, RBAC helpers.
- `src/middlewares/csrf.ts`: same-origin auth mutation and CSRF validation.
- `src/middlewares/rate-limit.ts`: in-memory/API rate-limiting middleware.
- `src/lib/auth-service.ts`: password login, OAuth account login, refresh sessions, MFA, user/account lifecycle, password reset, initial admin bootstrap.
- `src/lib/business-store.ts`: business-domain mapping/service helpers around normalized Drizzle tables and legacy JSON-shaped records.
- `src/lib/platform.ts`: platform event creation and monitoring helpers.
- `src/integrations/googleSheets`: Google Sheets sync/listener support.

Top-level backend route mounts:

- `/api/healthz`
- `/api/auth`
- `/api/admin`
- `/api/business`
- `/api/platform`
- `/api/notifications`
- `/api/uploads`

## Database Layer

The shared database package is `lib/db`.

- `src/index.ts` loads database environment, creates a PostgreSQL pool, and exports a Drizzle client.
- `src/schema/index.ts` re-exports schema modules.
- `drizzle.config.ts` configures `drizzle-kit`.
- `drizzle/` contains SQL migrations and Drizzle metadata snapshots.

Database schema is split by domain:

- `tenants.ts`
- `users.ts`
- `refresh-sessions.ts`
- `mfa-trusted-devices.ts`
- `password-reset-tokens.ts`
- `business.ts`
- `notifications.ts`
- `platform.ts`

## Runtime Flow

Backend startup in `src/index.ts` performs:

- Production config assertion.
- Database schema readiness assertion.
- Default tenant creation/verification.
- Platform tenant creation/verification.
- Initial tenant admin creation/verification.
- Initial platform admin creation/verification.

Request flow:

1. Express receives `/api/*` traffic through `src/app.ts`.
2. CORS, security headers, request logging, cookie parsing, and JSON/urlencoded body parsing run.
3. `src/routes/index.ts` dispatches to the route group.
4. Protected routes use `requireAuth`.
5. Role-specific routes use `requireTenantRole(...)` or `requirePlatformRole()`.
6. Domain handlers call Drizzle-backed services/helpers.
7. Errors fall through the central error handler in `src/app.ts`.

## Auth Architecture

Authentication uses short-lived bearer access tokens plus cookie refresh sessions.

- Login: `POST /api/auth/login`.
- Access token transport: `Authorization: Bearer <token>`.
- Refresh token transport: HTTP cookie named by `REFRESH_COOKIE_NAME`.
- Refresh persistence: only hashed refresh-token JTIs are stored in `refresh_sessions`.
- Refresh endpoint: `POST /api/auth/refresh`, protected with CSRF validation.
- Logout endpoints clear cookies and revoke refresh sessions.
- MFA uses TOTP challenges and optional trusted-device cookies.
- OAuth supports Google and Microsoft start/callback routes and signs in by email.

Frontend auth bootstrap:

1. `AppProviders` mounts `AuthBootstrap`.
2. `useAuthStore.hydrateFromStorage()` calls `bootstrapSession()`.
3. `bootstrapSession()` attempts a refresh-token exchange.
4. Authenticated routes are selected by role in `src/App.tsx`.

## Coding Patterns

- Workspace imports use package names such as `@workspace/db`.
- Backend route files use Express routers and Zod schemas.
- RBAC is explicit at the route handler level.
- Newer business modules live under `src/modules/*`.
- Older consolidated business logic remains in `src/routes/business.ts` and `src/lib/business-store.ts`.
- Drizzle schema files define tables, enums, indexes/checks, insert schemas, inferred types, and relations.
- Frontend pages consume centralized API wrappers instead of calling Axios directly in most page code.
- UI primitives are local components under `src/components/ui`.
- Tests are split between backend `node --test` files and Playwright specs.
