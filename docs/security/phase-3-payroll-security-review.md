# Phase 3 Payroll-Specific Security Review

Date: June 7, 2026

## Executive summary

The reviewed REST application has strong application-layer tenant and employee ownership checks around salary, expense, leave, and timesheet records. Directly changing a salary or employee identifier does not bypass authorization: route middleware checks role and the service layer checks tenant and employee ownership.

There is no GraphQL server, GraphQL endpoint, or GraphQL client in the repository.

This phase fixed two confirmed issues:

- Employee salary responses exposed internal accounting and workflow fields that the employee UI did not need.
- Employee/account/authentication audit coverage was incomplete.

The highest remaining risks are database-level tenant enforcement, public profile-photo storage, fragmented/non-immutable audit storage, limited audit retention in the legacy business-store path, and the absence of malware scanning for uploaded HR/financial documents.

## IDOR review

UUIDs are used as identifiers, but security does not depend on identifiers being difficult to guess.

| Surface | Identifier source | Server-side enforcement | Result |
| --- | --- | --- | --- |
| `GET /api/business/salaries/:id` | Path | Authenticated `admin` or `employee`; service checks salary tenant; employee must own salary | Protected |
| `PATCH /api/business/salaries/:id` | Path | Tenant `admin`; service checks existing salary tenant | Protected |
| `DELETE /api/business/salaries/:id` | Path | Tenant `admin`; service checks existing salary tenant | Protected |
| `POST /api/business/salaries/:id/pay` | Path | Tenant `admin`; service checks salary and account tenant | Protected |
| `GET /api/business/salaries?employeeId=` | Query | Employee-supplied ID is replaced with authenticated user ID; admin target must be a tenant employee | Protected |
| `/api/admin/employees/:id` | Path | Entire router requires tenant `admin`; lookups and writes include tenant ID and employee role | Protected |
| `/api/admin/admins/:id` | Path | Tenant `admin`; target requires same tenant and admin role; self-delete and last-admin protections | Protected |
| `/api/admin/clients/:id` | Path | Tenant `admin`; target requires same tenant and client role | Protected |
| `/api/business/expenses/:id` | Path | Tenant check plus employee-self check | Protected |
| `/api/business/timesheets/:id` | Path | Tenant employee set plus employee-self or admin policy | Protected |
| `/api/business/leave-requests/:id` | Path | Tenant store plus employee-self checks for employee mutations | Protected |
| `/api/business/pre-approvals/:id` | Path | Tenant and client ownership checked by actor-aware service | Protected |
| Uploaded expense/fund documents | Stored object path | Record access is role/owner-scoped; server issues one-hour signed URLs | Protected with residual storage risks |

There is no generic `/employee/:id`, `/payroll/:id`, or unauthenticated document download endpoint.

### IDOR residual risks

**P1: Database row-level security**

Tenant isolation is enforced by application predicates. Add PostgreSQL row-level security or tenant-bound database functions so a future missed predicate cannot become a cross-tenant disclosure.

**P1: Manager authorization**

The system has no manager role or manager-to-employee assignment relation. Do not grant managers tenant-admin access as a workaround.

**P2: Uniform not-found behavior**

Some endpoints return `403` for a foreign resource and others return `404`. Standardize sensitive object lookups on a non-enumerating response policy while preserving detailed internal audit reasons.

## Salary and employee data exposure

### REST responses

Employee salary responses now return only:

- Salary record ID
- Employee ID and display snapshot
- Amount
- Pay date and status
- Source
- Pay-period/timesheet calculation fields (`weekStart`, `hours`, `rate`)

Employee salary responses no longer return:

- `tenantId`
- Financial `accountId`
- Internal/admin `note`
- Internal `timesheetId`
- Internal creation/update timestamps

Tenant administrators retain operational fields needed to administer and reconcile payroll.

### Authentication response coupling

The shared `PublicUser` response includes salary/pay-type fields because employees use `/auth/me` as their own profile source and administrators use the same model for employee administration.

No user can request another employee through `/auth/me`, and client/admin accounts have zero salary. Nevertheless, this shared model creates future leakage risk.

Recommended change:

1. Define `AuthPrincipalDto` with identity, role, status, and MFA state only.
2. Define `EmployeeSelfProfileDto` for the authenticated employee.
3. Define `AdminEmployeeDto` for tenant-admin employee management.
4. Add response-schema tests that reject unexpected fields.

### GraphQL

No GraphQL implementation was found. There are no GraphQL responses to review. If GraphQL is added later, require resolver-level authorization, field-level salary permissions, query-depth/cost limits, disabled production introspection where appropriate, and persisted operations for privileged payroll workflows.

### HR documents and uploads

- Expense attachments and fund receipts use private Supabase buckets and one-hour signed URLs.
- Uploads validate declared type and file magic signatures.
- Upload size and frequency are limited.
- Profile photos use a public bucket and object paths include an employee/account identifier.
- All authenticated roles can call each upload route, although unauthorized users cannot attach a fund receipt to a fund record.
- PDFs and images are not malware-scanned or content-disarmed.

Required actions:

1. Move profile photos to a private bucket if employee images are considered HR data.
2. Use opaque storage prefixes rather than user IDs in object paths.
3. Restrict upload routes by business role and intended workflow.
4. Add asynchronous malware scanning/quarantine before a document becomes downloadable.
5. Force safe `Content-Disposition` and a restrictive content type for risky document classes.
6. Log document create, access, replacement, and deletion without logging signed URLs.

## Audit logging coverage

| Event | Current coverage |
| --- | --- |
| Salary create/update/delete/pay | Tenant audit record with actor, request ID, changed fields, before/after, and operation |
| Employee create/update/deactivate | Added tenant audit record with actor, request ID, changed fields, and before/after |
| Administrator create/update/deactivate | Added platform security event with actor, tenant, target ID, target role, and action |
| Role changes | No general role mutation endpoint exists; administrator privilege lifecycle is now logged |
| Failed password login | Platform security event with hashed account identifier |
| Successful password login | Added platform security event |
| MFA challenge/success/failure | Added platform security events |
| OAuth success/failure | Platform security events |
| Password reset request | Added enumeration-safe event with hashed account identifier |
| Password reset success/failure | Platform security event; success identifies affected user/tenant and notes session revocation |
| Session refresh rejection | Platform security event |
| Upload rejection/failure | Platform upload security event |

Passwords, password hashes, reset tokens, refresh tokens, MFA seeds, OAuth authorization codes, signed document URLs, and raw login email addresses are not written by the new events.

## Audit architecture gaps

The current design has two audit systems:

- Tenant business audit records in `audit_trail`
- Platform/security records in `platform_events`

They are ordinary mutable database tables. Event writes are not consistently in the same transaction as the business mutation. The legacy business-store update path can keep only the newest 250 audit entries and may remove older entries during synchronization. This is insufficient for enterprise payroll evidence and long-term investigations.

## Recommended audit logging architecture

### Event model

Use one versioned envelope:

```text
event_id
schema_version
occurred_at
received_at
tenant_id
actor_user_id
actor_role
actor_session_id_hash
action
resource_type
resource_id
outcome
request_id
source_ip_prefix_or_hash
user_agent_hash
changed_fields
before_digest
after_digest
metadata
previous_event_hash
event_hash
```

Do not store authentication secrets, tokens, document URLs containing signatures, or unnecessary payroll values.

### Write path

1. Perform the payroll/HR mutation and insert an audit outbox row in the same database transaction.
2. A durable worker publishes the event to append-only audit storage.
3. Mark the outbox event delivered only after durable acknowledgement.
4. Alert on repeated delivery failure.

### Storage and integrity

- Keep operational searchable logs in a separate least-privilege audit database/schema.
- Export immutable copies to WORM/object-lock storage.
- Hash-chain events per tenant or time partition and periodically anchor/sign partition manifests.
- Deny application update/delete privileges on finalized audit rows.
- Encrypt at rest with separately managed keys.
- Back up and restore-test audit data independently.

### Access control

- Create `auditor` and security roles separate from payroll administrators.
- Require MFA and recent reauthentication for audit export.
- Log every audit search, view, and export.
- Mask salary values by default; permit value access only for authorized investigations.
- Prevent tenant administrators from viewing platform-wide authentication telemetry.

### Retention

- Remove the 250-event cap.
- Define retention by event class and jurisdiction with legal review.
- Typical planning baseline: payroll/account-change evidence 7 years; authentication/security telemetry 1-2 years, subject to applicable law and contracts.
- Support legal holds and documented deletion approvals.

### Monitoring

Alert on:

- Cross-tenant authorization failures
- Repeated employee-ID probing
- Bulk salary reads or exports
- Salary/account changes outside expected hours
- Administrator creation or deactivation
- MFA/recovery changes
- Repeated reset attempts
- Audit pipeline lag, gaps, hash failures, or deletion attempts

## Verification

- Full workspace typecheck and production build passed.
- Existing security integration tests cover anonymous rejection, cross-tenant isolation, client payroll denial, and employee salary self-access.
- Employee salary tests now verify internal accounting/workflow fields are absent.
- Database-backed integration tests passed against a freshly migrated isolated PostgreSQL database.
