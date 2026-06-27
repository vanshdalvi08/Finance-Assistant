# Database

## Overview

The database is PostgreSQL and is accessed through Drizzle ORM in `lib/db`.

Key files:

- `lib/db/src/index.ts`: creates the `pg` pool and Drizzle client.
- `lib/db/src/schema/index.ts`: exports all schema modules.
- `lib/db/src/schema/*.ts`: table, enum, type, relation, and insert schema definitions.
- `lib/db/drizzle.config.ts`: Drizzle Kit configuration.
- `lib/db/drizzle`: SQL migrations and metadata snapshots.

In test mode, `lib/db/src/index.ts` falls back to `postgresql://postgres:postgres@127.0.0.1:5432/finance_assistant?sslmode=disable` if `DATABASE_URL` is missing.

## Schema Modules

- `tenants.ts`: tenant records and tenant status enum.
- `users.ts`: users, roles, status, pay type, profile/client billing fields.
- `refresh-sessions.ts`: refresh-token session records.
- `mfa-trusted-devices.ts`: remembered MFA device records.
- `password-reset-tokens.ts`: password reset token records.
- `business.ts`: finance, payroll, timesheet, project, leave, purchase order, pre-approval, audit, and idempotency tables.
- `notifications.ts`: notification records.
- `platform.ts`: platform monitoring/event records.

## Tables

### `tenants`

Fields include:

- `id`
- `name`
- `slug`
- `status`: `active` or `inactive`
- `createdAt`
- `updatedAt`

Indexes/constraints:

- Unique `slug`.
- Status index.

Constants:

- `DEFAULT_TENANT_ID`
- `DEFAULT_TENANT_SLUG`
- `PLATFORM_TENANT_ID`
- `PLATFORM_TENANT_SLUG`

### `users`

Fields include:

- `id`
- `tenantId`
- `name`
- `email`
- `phone`
- `role`: `admin`, `employee`, `client`, `platform_super_admin`
- `employeeId`
- `position`
- `department`
- `salary`
- `payType`: `monthly` or `hourly`
- `hourlyRate`
- `profilePhotoUrl`
- `clientInfo`
- `hashedPassword`
- `status`: `active` or `inactive`
- `mfaEnabled`
- `mfaSecret`
- MFA timestamps
- `createdAt`
- `updatedAt`
- `lastLoginAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.

Indexes/constraints:

- Unique `email`.
- Unique `(tenantId, phone)`.
- Unique `(tenantId, employeeId)`.
- Indexes for tenant, role, and status.

### `refresh_sessions`

Fields include:

- `id`
- `userId`
- `jtiHash`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Relationships:

- `userId` references `users.id` with cascade delete.

Indexes/constraints:

- Unique `jtiHash`.
- Indexes for `userId` and `expiresAt`.

### `mfa_trusted_devices`

Fields include:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `createdAt`
- `lastUsedAt`
- `userAgent`
- `ipAddress`

Relationships:

- `userId` references `users.id` with cascade delete.

Indexes/constraints:

- Unique `tokenHash`.
- Indexes for `userId` and `expiresAt`.

### `password_reset_tokens`

Fields include:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `usedAt`
- `createdAt`

Relationships:

- `userId` references `users.id` with cascade delete.

Indexes/constraints:

- Unique `tokenHash`.
- Indexes for `userId` and `expiresAt`.

### `business_state`

Legacy JSON state table with:

- `id`
- `data`
- `createdAt`
- `updatedAt`

Used alongside normalized business tables through `business-store.ts`.

### `company_settings`

Fields include:

- `id`
- `tenantId`
- `data`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.

Indexes/constraints:

- Unique `tenantId`.

### `financial_accounts`

Fields include:

- `id`
- `tenantId`
- `name`
- `accountType`: `operational`, `personal`, `mixed_use`, `reserve`, `cash`
- `category`: `bank`, `cash`, `wallet`, `other`
- `openingBalance`
- `description`
- `includeInOperationalReporting`
- `isActive`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.

Indexes/constraints:

- Indexes for tenant, name, active state, and account type.
- Check: `openingBalance >= 0`.

### `funds`

Fields include:

- `id`
- `tenantId`
- `accountId`
- `source`
- `amount`
- `date`
- `note`
- `receiptName`
- `receiptPath`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `accountId` references `financial_accounts.id` with set null on delete.

Indexes/constraints:

- Indexes for tenant, account, source, and date.
- Check: `amount > 0`.

### `idempotency_keys`

Fields include:

- `id`
- `tenantId`
- `scope`
- `keyHash`
- `requestHash`
- `status`: `processing` or `completed`
- `responseEntityId`
- `createdById`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `createdById` references `users.id` with set null on delete.

Indexes/constraints:

- Unique `(tenantId, scope, keyHash)`.
- Indexes for tenant, scope/status, and response entity.

### `expense_categories`

Fields include:

- `id`
- `name`
- `color`
- `group`: `personal` or `office`
- `createdAt`
- `updatedAt`

Indexes/constraints:

- Unique `(name, group)`.
- Group index.

### `expenses`

Fields include:

- `id`
- `tenantId`
- `accountId`
- `employeeId`
- `employeeNameSnapshot`
- `project`
- `category`
- `group`: `personal` or `office`
- `amount`
- `date`
- `description`
- `note`
- `attachmentName`
- `attachmentPath`
- `reimbursable`
- `status`: `draft`, `submitted`, `approved`, `rejected`
- `reviewerNote`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `accountId` references `financial_accounts.id` with set null on delete.
- `employeeId` references `users.id` with set null on delete.

Indexes/constraints:

- Indexes for tenant, account, employee, status, date, category, and project.
- Check: `amount > 0`.

### `salaries`

Fields include:

- `id`
- `tenantId`
- `accountId`
- `employeeId`
- `employeeNameSnapshot`
- `amount`
- `date`
- `note`
- `status`: `pending` or `paid`
- `source`: `manual` or `timesheet`
- `paidAt`
- `weekStart`
- `hours`
- `rate`
- `timesheetId`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `accountId` references `financial_accounts.id` with set null on delete.
- `employeeId` references `users.id` with set null on delete.

Indexes/constraints:

- Indexes for tenant, account, employee, status, date, and paid timestamp.
- Unique `timesheetId`.
- Checks for positive amount and non-negative hours/rate.

### `timesheets`

Fields include:

- `id`
- `employeeId`
- `employeeNameSnapshot`
- `weekStart`
- `status`: `draft`, `submitted`, `approved`, `rejected`
- `submittedAt`
- `reviewedAt`
- `reviewedBy`
- `reviewNotes`
- `reviewShell`
- `dailyReviewStatus`
- `dailyReviewNotes`
- `dailyReviewHolidays`
- `dailyReviewLocks`
- `lines`
- `createdAt`
- `updatedAt`

Relationships:

- `employeeId` references `users.id` with cascade delete.
- Drizzle relation: one timesheet has many `timesheet_lines`.

Indexes/constraints:

- Indexes for employee, week, and status.
- Unique `(employeeId, weekStart)`.

### `timesheet_lines`

Fields include:

- `id`
- `timesheetId`
- `projectBudgetId`
- `projectId`
- `projectTaskId`
- `subTask`
- `sortOrder`
- `notes`
- `workNotes`
- `mon` through `sun`
- `createdAt`
- `updatedAt`

Relationships:

- `timesheetId` references `timesheets.id` with cascade delete.
- `projectBudgetId` references `project_budgets.id` with set null on delete.
- `projectId` references `projects.id` with set null on delete.
- `projectTaskId` references `project_tasks.id` with set null on delete.

Indexes/constraints:

- Indexes for timesheet, project budget, project, project task, and sort order.
- Check: all daily hours are non-negative.

### `project_budgets`

Fields include:

- `id`
- `tenantId`
- `project`
- `totalBudget`
- `client`
- `note`
- `tasks`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- Drizzle relation: one project budget has many `timesheet_lines`.

Indexes/constraints:

- Unique `(tenantId, project)`.
- Indexes for tenant, project, and updated timestamp.

### `projects`

Fields include:

- `id`
- `tenantId`
- `name`
- `client`
- `note`
- `status`: `active` or `archived`
- `createdById`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `createdById` references `users.id` with set null on delete.
- Drizzle relations: one project has many `project_tasks` and many `timesheet_lines`.

Indexes:

- Tenant, name, client, status, and created-by indexes.

### `project_tasks`

Fields include:

- `id`
- `tenantId`
- `projectId`
- `name`
- `description`
- `maxHours`
- `startDate`
- `endDate`
- `durationDays`
- `hourLimitScope`
- `employeeHourLimits`
- `subTasks`
- `status`: `active` or `archived`
- `sortOrder`
- `createdById`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `projectId` references `projects.id` with cascade delete.
- `createdById` references `users.id` with set null on delete.
- Drizzle relations: one task belongs to one project and has many `timesheet_lines`.

Indexes/constraints:

- Indexes for tenant, project, name, status, sort order, and created-by.
- Checks for non-negative max hours and duration.
- Checks that start/end dates are paired and ordered.

### `purchase_orders`

Fields include:

- `id`
- `tenantId`
- `title`
- `totalAmount`
- `usedAmount`
- `remainingAmount`
- `vendor`
- `status`: `active` or `archived`
- `date`
- `notes`
- `tasks`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.

Indexes/constraints:

- Indexes for tenant, title, vendor, status, date, and updated timestamp.
- Checks for non-negative total/used/remaining amounts.
- Checks used and remaining amounts do not exceed total amount.

### `pre_approvals`

Fields include:

- `id`
- `tenantId`
- `title`
- `project`
- `clientId`
- `clientNameSnapshot`
- `date`
- `notes`
- `companyInfo`
- `clientInfo`
- `projectInfo`
- `status`: `draft`, `submitted`, `changes_requested`, `approved`
- `createdById`
- `submittedAt`
- `approvedAt`
- `receivedAt`
- `receivedFundId`
- `tasks`
- `comments`
- `createdAt`
- `updatedAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `clientId` references `users.id` with cascade delete.
- `createdById` references `users.id` with set null on delete.
- `receivedFundId` references `funds.id` with set null on delete.

Indexes:

- Tenant, client, status, project, created-by, and updated timestamp indexes.

### `audit_trail`

Fields include:

- `id`
- `tenantId`
- `actorUserId`
- `actorName`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `summary`
- `requestId`
- `details`
- `createdAt`

Relationships:

- `tenantId` references `tenants.id` with cascade delete.
- `actorUserId` references `users.id` with set null on delete.

Indexes:

- Tenant, actor name, actor user, entity, request, and created timestamp indexes.

### `notifications`

Fields include:

- `id`
- `recipientId`
- `actorId`
- `actorName`
- `actorRole`
- `type`
- `title`
- `body`
- `link`
- `metadata`
- `deliveryChannel`: `in_app`, `email`, or `both`
- `readAt`
- `emailSentAt`
- `emailError`
- `createdAt`
- `updatedAt`

Relationships:

- `recipientId` references `users.id` with cascade delete.
- `actorId` references `users.id` with set null on delete.

Indexes:

- Recipient, recipient/read state, created timestamp, and type indexes.

### `platform_events`

Fields include:

- `id`
- `tenantId`
- `actorUserId`
- `severity`: `info`, `warning`, `error`
- `category`: `request`, `auth`, `database`, `upload`, `tenant`, `system`
- `title`
- `message`
- `path`
- `method`
- `statusCode`
- `durationMs`
- `fingerprint`
- `acknowledgedAt`
- `acknowledgedByUserId`
- `resolvedAt`
- `resolvedByUserId`
- `metadata`
- `createdAt`

Relationships:

- `tenantId` references `tenants.id` with set null on delete.
- `actorUserId`, `acknowledgedByUserId`, and `resolvedByUserId` reference `users.id` with set null on delete.

Indexes:

- Tenant, severity, category, created timestamp, fingerprint, and unresolved-state indexes.

## Relationship Summary

- Tenants own tenant-scoped application data.
- Users belong to tenants.
- Auth session/MFA/reset records belong to users.
- Financial accounts are optional parents for funds, expenses, and salaries.
- Employees are users referenced by expenses, salaries, and timesheets.
- Timesheets own normalized timesheet lines.
- Projects own project tasks.
- Timesheet lines can reference projects, project tasks, and project budgets.
- Clients are users referenced by pre-approvals.
- Pre-approvals can create or reference received funds.
- Notifications target users and may reference an actor user.
- Platform events can reference tenants and users.

## Data Modeling Notes

- Business IDs are mostly text IDs generated by application helpers.
- Tenant/user/auth IDs are UUIDs.
- Monetary values are integers.
- JSONB is used for company settings, client info, task lists, comments, daily timesheet review state, employee hour limits, subtasks, and legacy business state.
- Some current business behavior still bridges normalized tables and legacy JSON record shapes through `artifacts/api-server/src/lib/business-store.ts`.
