# Role Permissions Matrix

This document is the working source of truth for access boundaries in the Finance Assistant platform.

## Roles

- `platform_super_admin`: platform owner / operator
- `tenant_owner`: company owner inside one tenant
- `tenant_admin`: day-to-day company admin
- `employee`: staff user
- `client`: external client for pre-approvals only

## Core Rules

- Every request must be scoped to a tenant unless it is a platform-console request.
- Tenant users cannot see or act on other tenants.
- Platform users can see platform health and tenant registry, but should not casually edit tenant business data.
- Sensitive money-moving actions must remain tenant-scoped and audit logged.
- Client access is limited to pre-approvals and their own comments/approvals.

## Module Access Matrix

| Module | platform_super_admin | tenant_owner | tenant_admin | employee | client |
| --- | --- | --- | --- | --- | --- |
| Platform Console | Full access | No access | No access | No access | No access |
| Monitoring | Full access | No access | No access | No access | No access |
| Tenant Registry / Recovery | Full access | No access | No access | No access | No access |
| Platform Settings | Full access | No access | No access | No access | No access |
| Tenant Settings | View only, support-only override if needed | Full access | Full access | No access | No access |
| Employees | View only, support-only override if needed | Full access | Full access | Self profile only | No access |
| Salary / Payroll | View only, support-only override if needed | Full access | Full access | Salary slips only | No access |
| Timesheets | View only, support-only override if needed | Full access | Full access | Own timesheets only | No access |
| Leave Management | View only, support-only override if needed | Full access | Full access | Own requests only | No access |
| Expenses | View only, support-only override if needed | Full access | Full access | Own expenses only | No access |
| Funds | View only, support-only override if needed | Full access | Full access | No access | No access |
| Projects | View only, support-only override if needed | Full access | Full access | Read-only if needed | No access |
| Purchase Orders | View only, support-only override if needed | Full access | Full access | No access | No access |
| Pre Approvals | No casual edit access | Full access | Full access | No access | View / comment / approve / request changes |
| Transactions | View only, support-only override if needed | Full access | Full access | No access | No access |
| Audit Trail | Platform audit only | Tenant audit only | Tenant audit only | No access | No access |
| Notifications | Platform notifications only | Tenant notifications | Tenant notifications | Own notifications only | Own notifications only |

## Detailed Behavior

### `platform_super_admin`

- Can create, disable, and restore tenants.
- Can view platform monitoring and recovery data.
- Can inspect platform audit events.
- Can create tenant owner accounts during onboarding.
- Should not edit tenant payroll, expenses, or approvals unless a support override is explicitly added later.

### `tenant_owner`

- Owns a single tenant/company.
- Can create tenant admins.
- Can manage company settings, leave policy, and business data.
- Can recover tenant-level operational issues inside the tenant.

### `tenant_admin`

- Handles daily operations inside the tenant.
- Can manage employees, timesheets, leave, expenses, funds, PO, pre-approvals, and reports.
- Can approve/reject tenant workflow items.

### `employee`

- Can manage their own work and profile.
- Can submit timesheets, leaves, and expenses.
- Can view salary slips and notifications.
- Cannot see other employees' private or financial data.

### `client`

- Can view their own pre-approval sheets.
- Can comment, approve, or request changes.
- Can see only their own approval history.
- Cannot see internal employee, payroll, or platform data.

## Platform Console Screens

- `Overview`: platform-level counts and health snapshot.
- `Tenants`: create and manage tenant workspaces.
- `Monitoring`: errors, warnings, slow requests, and incident feed.
- `Recovery`: restore or inspect inactive tenants.
- `Settings`: platform identity, access boundaries, and admin list.

## Enforcement Checklist

- Verify backend route guards for every sensitive route.
- Scope every database query by tenant ID unless it is platform-console data.
- Record audit events for platform actions and tenant finance actions.
- Keep platform monitoring events separate from tenant audit history.
- Keep client routes isolated from all tenant internal data.

