# API Routes

## Route Mounts

All routes are mounted under `/api` by `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/routes/index.ts`.

Top-level route groups:

- `/api/healthz`
- `/api/auth`
- `/api/admin`
- `/api/business`
- `/api/platform`
- `/api/notifications`
- `/api/uploads`

## Route Protection

- `/api/healthz` is public.
- `/api/auth` has public login/reset/OAuth routes, authenticated `/me` and `/logout-all`, and CSRF-protected refresh/logout routes.
- `/api/admin` uses `requireAuth` and `requireTenantRole("admin")`.
- `/api/business` uses `requireAuth`; individual handlers add role requirements.
- `/api/platform` uses `requireAuth` and `requirePlatformRole()`.
- `/api/notifications` uses `requireAuth`.
- `/api/uploads` uses `requireAuth`.

## Health

Source: `artifacts/api-server/src/routes/health.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/healthz` | Public | Health check. |

## Auth

Source: `artifacts/api-server/src/routes/auth.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/auth/csrf` | Public | Issue CSRF token cookie and response token. |
| GET | `/api/auth/oauth-debug` | Public | Report OAuth env configuration booleans and redirect URI values. |
| GET | `/api/auth/oauth/:provider/start` | Public | Start Google/Microsoft OAuth sign-in. |
| GET | `/api/auth/oauth/:provider/callback` | Public | Complete OAuth sign-in callback. |
| POST | `/api/auth/login` | Public | Password login; may return an MFA challenge. |
| POST | `/api/auth/mfa/verify` | Public | Complete MFA challenge and create session. |
| POST | `/api/auth/refresh` | Public with refresh cookie and CSRF | Refresh access token. |
| POST | `/api/auth/logout` | Public with refresh cookie and CSRF | Revoke current refresh token and clear cookies. |
| POST | `/api/auth/logout-all` | Authenticated | Revoke all sessions for current user and clear cookies. |
| POST | `/api/auth/request-reset` | Public | Request password reset email. |
| POST | `/api/auth/reset` | Public | Reset password with token. |
| GET | `/api/auth/me` | Authenticated | Return current user. |
| PATCH | `/api/auth/me` | Authenticated | Update current-user profile. |

## Admin Accounts

Source: `artifacts/api-server/src/routes/admin.ts`

All routes require tenant admin role.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/employees` | List employee accounts. |
| GET | `/api/admin/admins` | List admin accounts. |
| GET | `/api/admin/clients` | List client accounts. |
| POST | `/api/admin/admins` | Create admin account. |
| POST | `/api/admin/employees` | Create employee account. |
| POST | `/api/admin/clients` | Create client account. |
| PATCH | `/api/admin/admins/:id` | Update admin account. |
| PATCH | `/api/admin/employees/:id` | Update employee account. |
| PATCH | `/api/admin/clients/:id` | Update client account. |
| DELETE | `/api/admin/employees/:id` | Deactivate/delete employee account route. |
| DELETE | `/api/admin/admins/:id` | Deactivate/delete admin account route. |
| DELETE | `/api/admin/clients/:id` | Deactivate/delete client account route. |

## Business Base Routes

Source: `artifacts/api-server/src/routes/business.ts`

All routes require authentication. Role requirements are listed from the route definitions.

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/overview` | admin | Dashboard overview. |
| GET | `/api/business/charts` | admin | Chart data. |
| GET | `/api/business/transactions` | admin | Transaction list. |
| GET | `/api/business/audit-trail` | admin | Audit trail entries. |
| GET | `/api/business/holidays` | authenticated | List holidays. |
| POST | `/api/business/holidays` | admin | Create holiday. |
| DELETE | `/api/business/holidays/:id` | admin | Delete holiday. |
| GET | `/api/business/leave-settings` | authenticated | Get leave settings. |
| PATCH | `/api/business/leave-settings` | admin | Update leave settings. |
| GET | `/api/business/company-settings` | admin | Get company settings. |
| PATCH | `/api/business/company-settings` | admin | Update company settings. |
| GET | `/api/business/leave-requests` | admin, employee | List leave requests. |
| POST | `/api/business/leave-requests` | employee | Create leave request. |
| DELETE | `/api/business/leave-requests/:id` | admin, employee | Delete leave request. |
| PATCH | `/api/business/leave-requests/:id/status` | admin | Review leave request. |
| GET | `/api/business/expenses` | admin, employee | List expenses. |
| GET | `/api/business/projects/summary` | admin, employee | Project summary. |
| GET | `/api/business/projects/names` | admin, employee | Project names. |
| GET | `/api/business/pre-approvals` | admin, client | List pre-approvals for actor. |
| POST | `/api/business/pre-approvals` | admin | Create pre-approval. |
| POST | `/api/business/pre-approvals/:id/submit` | admin | Submit pre-approval. |
| POST | `/api/business/pre-approvals/:id/comments` | admin, client | Add pre-approval comment. |
| POST | `/api/business/pre-approvals/:id/approve` | client | Approve pre-approval. |
| POST | `/api/business/pre-approvals/:id/receive-funds` | admin | Record received funds for pre-approval. |
| POST | `/api/business/pre-approvals/:id/request-changes` | client | Request changes to pre-approval. |

## Business Module Routes

These routers are mounted inside `/api/business` by `src/routes/business.ts`.

### Financial Accounts

Source: `src/modules/financial-accounts/financial-accounts.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/financial-accounts` | admin | List financial accounts. |
| POST | `/api/business/financial-accounts` | admin | Create financial account. |
| GET | `/api/business/financial-accounts/:id` | admin | Get financial account. |
| PATCH | `/api/business/financial-accounts/:id` | admin | Update financial account. |

### Expenses

Source: `src/modules/expenses/expenses.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/api/business/expenses` | admin, employee | Submit/create expense. |
| POST | `/api/business/expenses/historical` | admin | Create historical expense. |
| PATCH | `/api/business/expenses/:id/status` | admin | Review/update expense status. |

### Payroll

Source: `src/modules/payroll/payroll.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/salaries` | admin, employee | List salaries. |
| POST | `/api/business/salaries` | admin | Create salary. |
| POST | `/api/business/salaries/historical` | admin | Create historical salary. |
| POST | `/api/business/salaries/:id/pay` | admin | Mark salary as paid. |

### Projects

Source: `src/modules/projects/projects.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/projects` | admin | List projects. |
| GET | `/api/business/projects/catalog` | admin, employee | List project/task catalog. |
| POST | `/api/business/projects` | admin | Create project. |
| POST | `/api/business/projects/:id/tasks` | admin | Add task to project. |

### Purchase Orders

Source: `src/modules/purchase-orders/purchase-orders.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/purchase-orders` | admin | List purchase orders. |
| POST | `/api/business/purchase-orders` | admin | Create purchase order. |
| POST | `/api/business/purchase-orders/:id/tasks` | admin | Add purchase order task. |
| POST | `/api/business/purchase-orders/:id/tasks/:taskId/pay` | admin | Mark purchase order task as paid. |

### Timesheets

Source: `src/modules/timesheets/timesheets.routes.ts`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/api/business/month-calendar` | admin, employee | Month calendar data. |
| GET | `/api/business/timesheets` | admin, employee | List timesheets. |
| GET | `/api/business/timesheets/summary` | admin, employee | Timesheet summary. |
| GET | `/api/business/timesheets/by-week` | admin, employee | Get timesheet by week. |
| GET | `/api/business/timesheets/:id` | admin, employee | Get timesheet. |
| POST | `/api/business/timesheets` | admin, employee | Create/save timesheet. |
| PATCH | `/api/business/timesheets/:id` | admin, employee | Update timesheet. |
| PATCH | `/api/business/timesheets/:id/daily-review/:day` | admin | Update daily review state. |
| POST | `/api/business/timesheets/submit` | admin, employee | Submit timesheet by payload. |
| POST | `/api/business/timesheets/:id/submit` | admin, employee | Submit timesheet by id. |
| POST | `/api/business/timesheets/:id/approve` | admin | Approve timesheet. |
| POST | `/api/business/timesheets/:id/reject` | admin | Reject timesheet. |
| DELETE | `/api/business/timesheets/:id` | admin, employee | Delete timesheet. |

## Platform

Source: `artifacts/api-server/src/routes/platform.ts`

All routes require platform super admin role.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/platform/overview` | Platform overview. |
| GET | `/api/platform/tenants` | List tenants. |
| POST | `/api/platform/tenants` | Create tenant. |
| PATCH | `/api/platform/tenants/:id/status` | Update tenant status. |
| GET | `/api/platform/monitoring` | Platform monitoring events. |
| POST | `/api/platform/monitoring/test-alert` | Create/test monitoring alert. |
| PATCH | `/api/platform/monitoring/:id/acknowledge` | Acknowledge monitoring event. |
| PATCH | `/api/platform/monitoring/:id/resolve` | Resolve monitoring event. |
| POST | `/api/platform/monitoring/:id/retry-delivery` | Retry delivery for one monitoring event. |
| POST | `/api/platform/monitoring/retry-failed` | Retry failed monitoring deliveries. |
| GET | `/api/platform/recovery/drills` | List recovery drills. |
| POST | `/api/platform/recovery/drills` | Create recovery drill. |
| GET | `/api/platform/retention` | Retention information. |
| POST | `/api/platform/retention/prune` | Run retention prune. |
| GET | `/api/platform/settings` | Platform settings. |

## Notifications

Source: `artifacts/api-server/src/routes/notifications.ts`

All routes require authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/notifications` | List current-user notifications. |
| POST | `/api/notifications/:id/read` | Mark one notification read. |
| POST | `/api/notifications/read-all` | Mark all current-user notifications read. |

## Uploads

Source: `artifacts/api-server/src/routes/uploads.ts`

All routes require authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/uploads/profile-photo` | Upload profile photo. |
| POST | `/api/uploads/expense-attachment` | Upload expense attachment. |
| POST | `/api/uploads/fund-receipt` | Upload fund receipt. |

## Documentation Gap

`lib/api-spec/openapi.yaml` currently documents only `/healthz`. Most application routes above are implemented directly in Express and are not represented in the generated OpenAPI/Zod/client packages.
