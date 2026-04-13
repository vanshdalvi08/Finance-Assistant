# Finance-Assistant

Finance-Assistant is a monorepo for the finance dashboard, API server, and shared database packages used in this project.

## Database migrations

This repo now uses committed Drizzle migrations instead of runtime table creation.

### Fresh setup

1. Set `DATABASE_URL` in:
   - `artifacts/api-server/.env`
   - `lib/db/.env`
2. Run:

```bash
corepack pnpm db:migrate
```

3. Start the backend and frontend normally.

If the API starts against a database without the required schema, it now fails fast with a message telling you to run the migration command first.

### Migration files

Generated SQL migrations live in:

- `lib/db/drizzle`

Useful commands:

```bash
corepack pnpm db:generate
corepack pnpm db:baseline
corepack pnpm db:migrate
```

### Existing databases created before migrations

If you already have a database that was created by the older runtime bootstrap path, align it once with:

```bash
corepack pnpm db:baseline
```

That command records the current committed migrations in Drizzle's migration history table without replaying schema SQL against tables that already exist. After that, normal `corepack pnpm db:migrate` runs are safe.

## Deployment environment

Example env files now live in:

- `.env.example`
- `artifacts/api-server/.env.example`
- `artifacts/finance-dashboard/.env.example`
- `lib/db/.env.example`

### Storage variables

To use Supabase Storage in production, set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_AVATARS_BUCKET`
- `SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET`

Recommended bucket setup:

- `yojak-avatars`
  public bucket for employee profile photos
- `yojak-expense-attachments`
  private bucket for receipts and expense files

Profile photos are now uploaded to Supabase Storage and stored as URLs.
Expense attachments are now uploaded to Supabase Storage and stored as bucket paths, with signed URLs returned by the backend when expenses are read.

## Platform operations

Backup/recovery runbook:

- `docs/operations/backup-recovery-runbook.md`

Optional platform monitoring + recovery env vars:

- `PLATFORM_MONITORING_WEBHOOK_URL`
- `PLATFORM_MONITORING_WEBHOOK_TOKEN`
- `PLATFORM_MONITORING_MIN_SEVERITY`
- `PLATFORM_MONITORING_ALERT_COOLDOWN_MS`
- `PLATFORM_MONITORING_WEBHOOK_TIMEOUT_MS`
- `PLATFORM_BACKUP_STRATEGY`
- `PLATFORM_BACKUP_FREQUENCY`
- `PLATFORM_BACKUP_RETENTION_DAYS`
- `PLATFORM_BACKUP_STORAGE`
- `PLATFORM_RECOVERY_RUNBOOK_URL`
- `PLATFORM_LAST_RECOVERY_DRILL_DATE`

## Upload storage

The backend now includes Supabase Storage helpers for:

- profile photos
- expense attachments

Backend env variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_AVATARS_BUCKET`
- `SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET`

Example env files:

- `artifacts/api-server/.env.example`
- `lib/db/.env.example`

## Deployment

This repository keeps deployment targets out of source control so they can be recreated cleanly.

Typical production setup:

- Frontend app from `artifacts/finance-dashboard`
- API server from the repository root
- PostgreSQL and file storage from Supabase

Frontend build settings:

- Build command: `corepack pnpm --filter @workspace/finance-dashboard run build`
- Install command: `corepack pnpm install --frozen-lockfile`
- Output directory: `dist/public`

Backend build settings:

- Build command: `corepack pnpm --filter @workspace/api-server run build`
- Start command: `node artifacts/api-server/dist/index.mjs`
- Health check path: `/api/healthz`

Required environment variables live in the hosting platform for each service.

Recommended order of operations:

1. Deploy or update the database schema in Supabase with `corepack pnpm db:migrate`.
2. Deploy the API service.
3. Deploy the frontend service.
4. Point the frontend at the API base URL.
5. Update backend CORS and app URLs to match the deployed frontend domain.
