# Security Regression Checklist

Use this checklist for every production release. A failed required item blocks release unless the security owner documents and approves a time-bounded exception.

## Automated release gate

- [ ] Workspace typecheck and production build pass.
- [ ] Authentication hardening unit tests pass.
- [ ] Rate-limit and production-header unit tests pass.
- [ ] RBAC/workflow integration tests pass against an isolated database.
- [ ] API security integration tests pass against an isolated database.
- [ ] Frontend CSP and security-header configuration test passes.
- [ ] Repository secret regression tests pass.
- [ ] No runtime `.env` file is tracked.

Commands:

```text
corepack pnpm build
corepack pnpm run test:security-release
corepack pnpm --filter @workspace/finance-dashboard run test:security-headers
corepack pnpm --filter @workspace/api-server run test:security-unit
corepack pnpm --filter @workspace/api-server run test:workflow
corepack pnpm --filter @workspace/api-server run test:security
```

The workflow and API security suites require the isolated CI PostgreSQL database and migrations. Do not point them at production.

## Authentication

- [ ] Valid password login succeeds.
- [ ] Invalid login returns a generic response and creates a security event.
- [ ] Required MFA roles cannot bypass MFA through password or OAuth login.
- [ ] Refresh rotation works and revoked/expired sessions fail.
- [ ] Logout and logout-all revoke the intended sessions.
- [ ] Password reset is enumeration-safe, single-use, expires, and revokes sessions.
- [ ] Access tokens are not written to local or session storage.
- [ ] Production cookies remain `HttpOnly`, `Secure`, and appropriately `SameSite`.

## Authorization

- [ ] Anonymous requests fail on salary, employee, admin, upload, and platform routes.
- [ ] Employees cannot list or mutate `/api/admin/*`.
- [ ] Clients cannot access payroll or employee-management APIs.
- [ ] Employees can read only their own salary, expense, leave, and timesheet records.
- [ ] Changing a path or query ID does not expose another employee or tenant.
- [ ] Tenant administrators cannot access another tenant.
- [ ] Platform administrators cannot enter tenant-admin routes.
- [ ] Every new sensitive endpoint has a negative authorization test.

## Payroll and employee data

- [ ] Employee salary responses contain only approved employee-facing fields.
- [ ] Internal account IDs, admin notes, tenant IDs, and workflow linkage are absent from employee salary responses.
- [ ] Employee lists are restricted to tenant administrators.
- [ ] Temporary passwords are never returned in production responses.
- [ ] Password hashes, MFA seeds, refresh tokens, reset tokens, and signed document URLs never enter logs.
- [ ] Payroll exports are role-protected and audited.

## Browser security

- [ ] `X-Content-Type-Options: nosniff` is present.
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` is present.
- [ ] `Permissions-Policy` disables camera, microphone, and geolocation.
- [ ] `X-Frame-Options: DENY` is present.
- [ ] HSTS is present on the production frontend and API HTTPS responses.
- [ ] CSP report-only or enforced policy parses successfully.
- [ ] No unexplained first-party CSP violations appear in the observation window.
- [ ] CSP does not contain `*`, broad `https:`, or `'unsafe-eval'`.

## Rate limiting

- [ ] Login per-IP and per-account limits return `429` after the configured quota.
- [ ] MFA, refresh, password-reset, upload, salary-pay, and CSP-report limits remain active.
- [ ] Rate-limit keys do not expose account identifiers.
- [ ] Production uses a shared atomic rate-limit store before horizontal scaling.
- [ ] Trusted proxy configuration is verified in the deployed environment.

## Secrets

- [ ] Secret regression tests find no tracked environment files or known credential signatures.
- [ ] Frontend `VITE_*` variables contain no credentials.
- [ ] Production secrets are provided only through the managed secret store.
- [ ] JWT access and refresh secrets are distinct and at least 32 characters.
- [ ] `MFA_ENCRYPTION_KEY` is present, backed up securely, and exactly 32 decoded bytes.
- [ ] No secret appears in build output, source maps, browser bundles, logs, or deployment screenshots.

## Audit logging

- [ ] Salary create/update/delete/pay emits an audit event.
- [ ] Employee create/update/deactivate emits an audit event.
- [ ] Administrator lifecycle events are recorded.
- [ ] Successful and failed login, MFA, OAuth, and reset events are recorded.
- [ ] Audit events contain tenant, actor, action, resource, outcome, request ID, and timestamp.
- [ ] Audit events contain no credentials or unnecessary payroll values.
- [ ] Audit pipeline lag, write failures, and retention are reviewed.
- [ ] Audit access and exports are restricted and themselves audited.

## Deployment verification

- [ ] Dependency and container vulnerability scans meet the approved severity threshold.
- [ ] Verify headers against the final production URL, not only preview or local environments.
- [ ] Run one employee, tenant-admin, client, and platform-admin smoke flow.
- [ ] Confirm production health checks and monitoring are green.
- [ ] Confirm database migrations completed and rollback procedure is available.
- [ ] Record release commit, test run, approver, exceptions, and deployment URL.
