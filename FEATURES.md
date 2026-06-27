# Features

This file lists features present in the actual frontend pages, backend route modules, and database schema.

## Authentication and Sessions

Code locations:

- Frontend: `artifacts/finance-dashboard/src/auth`, `src/store/auth.ts`, `src/pages/login.tsx`, `src/pages/auth/reset-password.tsx`.
- Backend: `artifacts/api-server/src/routes/auth.ts`, `src/lib/auth-service.ts`, `src/middlewares/auth.ts`, `src/middlewares/csrf.ts`.
- Database: `users`, `refresh_sessions`, `mfa_trusted_devices`, `password_reset_tokens`.

Implemented capabilities:

- Password login.
- Refresh-token session restore.
- Bearer access token authentication.
- CSRF token issuance and validation for refresh/logout-style auth mutations.
- Logout current session.
- Logout all sessions.
- Password reset request and reset.
- Current-user profile read/update.
- MFA challenge/verification with trusted-device support.
- Google and Microsoft OAuth start/callback routes.
- Role-based route access.

## Roles and Workspaces

User roles are defined in `lib/db/src/schema/users.ts`:

- `admin`
- `employee`
- `client`
- `platform_super_admin`

Frontend workspaces from `src/App.tsx`:

- Admin workspace: dashboard, transactions, admins, employees, salary, funds, clients, purchase orders, pre-approvals, project budgets, expenses, settings, financial accounts, timesheets, leave management, reports, audit trail.
- Employee workspace: timesheet, task manager, leaves, expenses, salary slips, profile.
- Client workspace: pre-approvals.
- Platform workspace: dashboard, tenants, monitoring, recovery, settings.

## Admin Account Management

Code locations:

- Frontend pages: `src/pages/admins.tsx`, `src/pages/employees.tsx`, `src/pages/clients.tsx`.
- Backend routes: `src/routes/admin.ts`.
- Backend service: `src/lib/auth-service.ts`.
- Database: `users`.

Implemented capabilities:

- List admins, employees, and clients.
- Create admin, employee, and client accounts.
- Update admin, employee, and client accounts.
- Delete/deactivate admin, employee, and client accounts through route handlers.
- Store client billing information in `users.clientInfo`.
- Store employee salary, pay type, hourly rate, position, department, and employee ID.

## Dashboard, Reporting, and Audit Trail

Code locations:

- Frontend pages: `src/pages/dashboard.tsx`, `src/pages/transactions.tsx`, `src/pages/admin/reports.tsx`, `src/pages/admin/audit-trail.tsx`.
- Backend routes: `src/routes/business.ts`.
- Database: `audit_trail`, plus finance/payroll/business tables.

Implemented capabilities:

- Admin overview endpoint.
- Chart data endpoint.
- Transactions endpoint.
- Audit trail endpoint.
- Audit records include actor, action, entity type/id, summary, request id, details, and timestamp.

## Financial Accounts

Code locations:

- Frontend page: `src/pages/financial-accounts.tsx`.
- Backend routes: `src/modules/financial-accounts/financial-accounts.routes.ts`.
- Backend service: `src/modules/financial-accounts/financial-accounts.service.ts`.
- Database: `financial_accounts`.

Implemented capabilities:

- List financial accounts.
- Create financial account.
- Get one financial account.
- Update financial account.
- Track account type, category, opening balance, operational reporting inclusion, and active state.

## Funds

Code locations:

- Frontend page: `src/pages/funds.tsx`.
- Backend routes/services: `src/modules/funds`.
- Database: `funds`.
- Upload route: `POST /api/uploads/fund-receipt`.

Implemented capabilities:

- Fund records with source, amount, date, note, optional financial account, and receipt fields.
- Receipt upload route.
- Funds can be linked from pre-approval receipt flow through `pre_approvals.receivedFundId`.

## Expenses

Code locations:

- Frontend pages: `src/pages/expenses.tsx`, `src/pages/employee/expenses.tsx`.
- Backend routes/services: `src/modules/expenses`.
- Database: `expenses`, `expense_categories`.
- Upload route: `POST /api/uploads/expense-attachment`.

Implemented capabilities:

- Admin/employee expense creation.
- Admin historical expense creation.
- Admin expense status review.
- Expense fields include account, employee snapshot, project, category, group, amount, date, description, note, attachment, reimbursable flag, status, and reviewer note.
- Expense attachment upload route.

## Payroll and Salaries

Code locations:

- Frontend pages: `src/pages/salary.tsx`, `src/pages/employee/salary-slips.tsx`.
- Backend routes/services: `src/modules/payroll`.
- Database: `salaries`.

Implemented capabilities:

- Admin/employee salary listing.
- Admin salary creation.
- Admin historical salary creation.
- Admin mark-as-paid route.
- Salary records support manual and timesheet sources.
- Salary records can include paid timestamp, week start, hours, rate, and timesheet ID.

## Timesheets

Code locations:

- Frontend pages/components: `src/pages/admin/timesheet-validation.tsx`, `src/pages/employee/timesheet.tsx`, `src/components/timesheet`.
- Backend routes: `src/modules/timesheets/timesheets.routes.ts`.
- Backend helpers: `src/lib/business-store.ts`.
- Database: `timesheets`, `timesheet_lines`.

Implemented capabilities:

- Month calendar data.
- Timesheet listing.
- Timesheet summary.
- Lookup by week.
- Get one timesheet.
- Create/save/update timesheets.
- Daily review state updates by day.
- Submit by payload or by ID.
- Admin approve/reject.
- Delete timesheet.
- Timesheet lines track project/task links, subtasks, notes, work notes, and daily hours.
- Timesheets track review notes, daily review statuses, daily review notes, holiday flags, lock flags, and review shell state.

## Projects and Tasks

Code locations:

- Frontend pages: `src/pages/project-budgets.tsx`, `src/pages/employee/task-manager.tsx`.
- Backend routes/services: `src/modules/projects`.
- Database: `projects`, `project_tasks`, `project_budgets`.

Implemented capabilities:

- Admin project listing.
- Admin/employee project catalog.
- Admin project creation.
- Admin task creation under a project.
- Project tasks support max hours, date window, duration days, hour limit scope, per-employee hour limits, subtasks, status, and sort order.
- Project budgets store project, total budget, client, note, and JSON task records.

## Purchase Orders

Code locations:

- Frontend page: `src/pages/purchase-orders.tsx`.
- Backend routes/services: `src/modules/purchase-orders`.
- Database: `purchase_orders`.

Implemented capabilities:

- Admin purchase order listing.
- Admin purchase order creation.
- Admin purchase order task creation.
- Purchase orders store title, total/used/remaining amounts, vendor, status, date, notes, and JSON task records.
- Purchase order tasks in schema include task name, description, hours, rate, amount, status, and paid timestamp.

## Pre-Approvals

Code locations:

- Frontend pages: `src/pages/pre-approvals.tsx`, `src/pages/client/pre-approvals.tsx`.
- Backend routes: `src/routes/business.ts`.
- Backend service: `src/lib/services/pre-approvals-service.ts`.
- Database: `pre_approvals`.

Implemented capabilities:

- Admin/client pre-approval listing.
- Admin pre-approval creation.
- Admin pre-approval submission.
- Admin/client comments.
- Client approval.
- Client change request.
- Admin received-funds action.
- Pre-approvals store company info, client info, project info, task records, comments, status timestamps, and optional received fund link.

## Leave Management and Holidays

Code locations:

- Frontend pages: `src/pages/admin/leave-management.tsx`, `src/pages/employee/leaves.tsx`.
- Backend routes: `src/routes/business.ts`.
- Database-related storage: `company_settings.data` and business-store records.

Implemented capabilities:

- Holiday list/create/delete routes.
- Leave settings read/update routes.
- Admin/employee leave request listing.
- Employee leave request creation.
- Admin/employee leave request deletion.
- Admin leave request status update.
- Company settings can store leave policy fields.

## Notifications

Code locations:

- Frontend component: `src/components/layout/notification-center.tsx`.
- Backend routes: `src/routes/notifications.ts`.
- Backend service: `src/lib/notifications.ts`.
- Database: `notifications`.

Implemented capabilities:

- List current-user notifications.
- Mark notification as read.
- Mark all notifications as read.
- Notification types cover employee changes, timesheets, expenses, salary paid, projects, purchase orders, pre-approvals, and funds.
- Notifications support in-app, email, or both delivery channel values.

## Uploads

Code locations:

- Backend routes: `src/routes/uploads.ts`.
- Backend storage helpers: `src/lib/storage.ts`.
- Frontend upload API helpers: `src/lib/uploads.ts`.

Implemented capabilities:

- Profile photo upload.
- Expense attachment upload.
- Fund receipt upload.

## Platform Administration

Code locations:

- Frontend pages: `src/pages/platform/dashboard.tsx`, `src/pages/platform/tenants.tsx`, `src/pages/platform/monitoring.tsx`, `src/pages/platform/recovery.tsx`, `src/pages/platform/settings.tsx`.
- Backend routes: `src/routes/platform.ts`.
- Backend service/helpers: `src/lib/platform.ts`.
- Database: `tenants`, `platform_events`.

Implemented capabilities:

- Platform overview.
- Tenant listing.
- Tenant creation.
- Tenant status update.
- Monitoring event listing.
- Test alert creation.
- Monitoring event acknowledge/resolve.
- Retry delivery for one event or failed events.
- Recovery drill listing/creation.
- Retention info and prune route.
- Platform settings route.

## Google Sheets Integration

Code locations:

- `artifacts/api-server/src/integrations/googleSheets/sheets.listener.ts`
- `artifacts/api-server/src/integrations/googleSheets/sheets.rows.ts`
- `artifacts/api-server/src/integrations/googleSheets/sheets.service.ts`
- Backend test: `artifacts/api-server/tests/google-sheets.test.mjs`

Implemented capability visible from code structure:

- API server imports the Google Sheets listener at startup.
- Google Sheets service/listener/row helper modules exist.
- Backend test coverage exists for the integration.

## Operational Documentation

Existing docs under `docs/operations`:

- `backup-recovery-runbook.md`
- `secrets-rotation-policy.md`
- `security-monitoring-siem.md`

These correspond to platform monitoring, secrets, and recovery workflows implemented in backend platform routes and platform-event storage.
