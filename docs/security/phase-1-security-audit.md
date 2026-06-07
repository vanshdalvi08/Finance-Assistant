# Phase 1 Security Hardening Report

Date: June 7, 2026

## Executive summary

The payroll platform already had meaningful server-side authorization. The earlier external report was incorrect when it implied that sensitive routes were generally unprotected. All `/api/admin`, `/api/business`, `/api/platform`, and `/api/uploads` routes require a validated server-side session, and payroll reads/writes also enforce tenant and employee ownership in the service layer.

This pass fixed real authentication and secret-handling weaknesses:

- JWT verification now pins HS256, issuer, audience, and token type.
- Login has per-IP and per-account throttling with hashed rate-limit keys.
- OAuth login can no longer bypass mandatory MFA.
- MFA seeds are encrypted with AES-256-GCM instead of stored as plaintext.
- Trusted MFA devices are checked against the recorded user agent.
- Password reset and tenant-owner passwords require at least 12 characters and are limited to bcrypt's 72-byte input boundary.
- Reset links are removed from browser history after the token is read.
- The public OAuth diagnostic endpoint was removed.
- Bootstrap environment passwords no longer overwrite an existing administrator's password at application startup.
- A client-side employee-section passcode was removed because it was not a security boundary.
- Deployment validation now rejects weak, reused, or missing production secrets.
- Temporary administrative scripts and local environment files are ignored by Git.

No review can make a system "fully secure." The remaining items below are required before describing the platform as enterprise-ready.

## Authorization architecture

Every authenticated request is checked against:

1. A signed access JWT.
2. The current database user and role.
3. The refresh-session record referenced by the access token.
4. Session revocation and expiry.
5. Active user status.
6. Active tenant status.
7. Route-level role middleware.
8. Tenant and resource ownership checks where applicable.

The access token is not treated as the sole source of truth. A changed role, revoked session, inactive user, or inactive tenant invalidates access.

### Sensitive endpoint inventory

All paths below are under `/api`.

| Endpoint | Current authorization | Assessment |
| --- | --- | --- |
| `GET /admin/employees` | Authenticated tenant `admin`; query receives actor tenant ID | Protected |
| `POST /admin/employees` | Authenticated tenant `admin`; tenant assigned server-side; mutation throttled | Protected |
| `PATCH /admin/employees/:id` | Authenticated tenant `admin`; target lookup and update scoped to actor tenant | Protected |
| `DELETE /admin/employees/:id` | Authenticated tenant `admin`; target lookup and deactivation scoped to actor tenant | Protected |
| `GET /admin/admins` | Authenticated tenant `admin`; tenant-scoped query | Protected |
| `POST /admin/admins` | Authenticated tenant `admin`; tenant assigned server-side | Protected, but lacks owner/admin separation |
| `PATCH /admin/admins/:id` | Authenticated tenant `admin`; tenant-scoped target | Protected, but lacks owner/admin separation |
| `DELETE /admin/admins/:id` | Authenticated tenant `admin`; tenant-scoped target, self-delete and last-admin protections | Protected |
| `GET /admin/clients` | Authenticated tenant `admin`; tenant-scoped query | Protected |
| `POST/PATCH/DELETE /admin/clients[/:id]` | Authenticated tenant `admin`; tenant-scoped target and writes | Protected |
| `GET /business/salaries` | `admin` or `employee`; employee ID is forcibly replaced with the authenticated employee ID; service filters tenant | Protected |
| `GET /business/salaries/:id` | `admin` or `employee`; service checks tenant and employee ownership | Protected |
| `POST /business/salaries` | Tenant `admin`; target employee must exist in actor tenant | Protected |
| `POST /business/salaries/historical` | Tenant `admin`; actor tenant assigned server-side | Protected |
| `PATCH /business/salaries/:id` | Tenant `admin`; service verifies existing salary tenant | Protected |
| `DELETE /business/salaries/:id` | Tenant `admin`; service verifies existing salary tenant | Protected |
| `POST /business/salaries/:id/pay` | Tenant `admin`; tenant/account checks, funds check, throttling, idempotency, audit event | Protected |
| `GET/POST/PATCH/DELETE /business/expenses[/:id]` | Role checks plus tenant and employee-self policy | Protected |
| Timesheet and leave endpoints | Role checks plus employee-self, workflow-state, and tenant policies | Protected |
| Fund, financial-account, audit, settings, and overview endpoints | Tenant `admin` for financial/admin operations | Protected |
| Project endpoints | Authenticated tenant role rules; employee use constrained by project assignment/task policy | Protected |
| Pre-approval endpoints | `admin`/`client` workflow-specific roles and actor-aware service checks | Protected |
| `/platform/*` | Authenticated `platform_super_admin` only | Protected |
| `/uploads/*` | Authenticated session required | Protected |
| `GET/PATCH /auth/me` | Authenticated user; always operates on the authenticated user | Protected |

### Missing authorization controls

**P1: No manager role or assignment model**

There is no `manager` role in the database schema, JWT role set, middleware, or routing. This means a manager cannot currently be granted limited team access; they would have to be made an `admin`, which is excessive privilege.

Required implementation:

1. Add an explicit `manager` role.
2. Add a tenant-scoped `manager_employee_assignments` relation, preferably effective-dated.
3. Add `requireManagerEmployeeAccess()` and service-layer assignment checks.
4. Define separate read/write permissions for employee profile, salary, leave, expenses, and timesheets.
5. Add tests proving managers cannot enumerate or access unassigned employees.

**P1: Tenant owner and tenant administrator are collapsed into `admin`**

Any tenant admin can create or modify other admins. Enterprise separation of duties requires explicit `tenant_owner`, `tenant_admin`, payroll administrator, and optionally read-only auditor permissions.

**P1: Database row-level security is not the final enforcement layer**

Tenant isolation is enforced by application code. Add PostgreSQL row-level security or database access functions that bind tenant context so a missed application predicate cannot expose another tenant.

## Authentication findings

### Implemented

- Access token lifetime: 20 minutes.
- Refresh session lifetime: 14 days, stored in an `HttpOnly`, `Secure` production cookie with CSRF protection and rotation.
- Access tokens are held in JavaScript memory only, not local or session storage.
- Refresh sessions are stored hashed, capped per user, revocable, and checked on every authenticated request.
- Password reset tokens are random, stored hashed, expire after one hour, are single-use, and revoke refresh sessions and trusted devices after use.
- Login, MFA verification, refresh, logout, and reset endpoints are throttled.
- MFA exists and is production-enforced by default for tenant admins and platform super administrators.
- JWT verification now pins algorithm, issuer, audience, token type, role, tenant, and session identifiers.
- OAuth state is signed and OAuth authentication no longer bypasses mandatory MFA.
- MFA seeds are authenticated-encrypted at rest.

### Remaining authentication work

| Priority | Finding | Required action |
| --- | --- | --- |
| P1 | Rate limiting is process-local | Move counters to Redis or another shared atomic store before horizontal scaling |
| P1 | TOTP MFA is not phishing-resistant | Add WebAuthn/passkeys and require them for platform and tenant owners |
| P1 | No MFA recovery-code or controlled recovery workflow | Add one-time hashed recovery codes, audited admin recovery, and notification |
| P1 | OAuth identity is matched primarily by email | Persist provider issuer + immutable subject and require verified provider email |
| P2 | Passwords are not checked against a breached/common-password blocklist | Add a local blocklist or privacy-preserving breached-password service |
| P2 | Sensitive profile/email changes do not require recent reauthentication | Require password/MFA confirmation for identity and security changes |
| P2 | Trusted-device binding uses user agent, not a cryptographic device credential | Replace or supplement it with WebAuthn/device-bound credentials |
| P2 | Concurrent refresh requests can trigger reuse protection and revoke all sessions | Add a short rotation grace window or atomic family rotation design |
| P2 | Authentication event alerting is incomplete | Alert on MFA changes, recovery, repeated failures, new devices, and privilege changes |

## Secrets audit

### Repository result

- No real `.env`, `.env.local`, production, staging, or test environment file is tracked in the current Git index or found in Git filename history.
- Only example environment files are tracked.
- Frontend `VITE_*` configuration contains public runtime configuration only after removal of the employee passcode.
- Access and refresh tokens are not persisted to browser storage.
- A local ignored `.env.local` contains `DATABASE_URL` and SMTP credentials. These values were not printed or copied into this report.
- A local temporary admin-reset script contained a hardcoded password. The `.tmp` directory is now ignored. Treat that password as exposed if it was ever used outside a disposable local environment.

### Required rotation checklist

**Database**

- Create a new least-privilege application credential.
- Update the production secret store and connection pool configuration.
- Deploy and verify migrations, reads, writes, and tenant isolation.
- Revoke the old credential.
- Replace local copies.

**SMTP**

- Generate a new mailbox/app password.
- Update the production secret store.
- Test onboarding, password reset, and notification delivery.
- Revoke the old credential and review mail-provider login history.

**JWT and OAuth state**

- Generate distinct random values of at least 32 bytes for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `AUTH_OAUTH_STATE_SECRET`.
- Update them in a coordinated maintenance deployment.
- Expect all current sessions and in-progress OAuth requests to be invalidated.
- Never reuse one secret for multiple token purposes.

**MFA encryption**

- Set `MFA_ENCRYPTION_KEY` to a base64url-encoded random 32-byte key before production deployment.
- Back up the key in the managed secret store.
- Do not rotate it blindly: existing MFA seeds must first be decrypted with the old key and re-encrypted with the new key.

**OAuth providers**

- Rotate Google and Microsoft client secrets.
- Verify exact production redirect URIs.
- Persist and validate provider issuer and subject before broad rollout.
- Revoke the old secrets after successful login tests.

**Third-party services**

- Rotate Supabase/service-role keys, webhook secrets, monitoring tokens, and service-account keys if present in the deployment environment.
- Update one integration at a time, verify it, then revoke the prior credential.
- Review provider audit logs for unexpected use.

## Deployment requirements

Production startup now rejects:

- Missing or weak JWT secrets.
- Identical access and refresh JWT secrets.
- Missing or malformed `MFA_ENCRYPTION_KEY`.
- Weak configured bootstrap administrator passwords.
- Missing/weak OAuth state signing secret when OAuth is enabled.

The JWT validation changes intentionally invalidate previously issued tokens. Plan a forced sign-in after deployment.

## Verification

- Full workspace typecheck: passed.
- API and frontend production builds: passed.
- Authentication hardening unit tests: 4 passed.
- Existing RBAC/security integration suite was extended with employee salary ownership, weak reset password, and removed OAuth diagnostics checks. It should run in CI against the isolated PostgreSQL service.
- CI now rejects tracked environment secret files and runs security header, auth hardening, RBAC, workflow, and API security tests.

## Standards references

- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP JSON Web Token Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
