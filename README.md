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

This project is set up for:

- `Vercel` for the frontend dashboard
- `Render` for the API server
- `Supabase` for PostgreSQL and storage

### Frontend on Vercel

Deploy the frontend from `artifacts/finance-dashboard` and set that folder as the Vercel project root.

Use these settings:

- Build command: `corepack pnpm build`
- Output directory: `dist/public`
- Environment variable: `VITE_API_BASE_URL=https://<your-render-api-domain>/api`

The included `artifacts/finance-dashboard/vercel.json` rewrites all routes to `index.html` so React Router/Wouter works on refresh.

### Backend on Render

Deploy the API from the repository root using the included `render.yaml` blueprint.

Render should use:

- Build command: `corepack pnpm install --frozen-lockfile && corepack pnpm --filter @workspace/api-server run build`
- Start command: `node artifacts/api-server/dist/index.mjs`
- Health check path: `/api/healthz`

Required Render environment variables:

- `NODE_ENV=production`
- `DATABASE_URL` pointing to your Supabase database
- `FRONTEND_URL=https://<your-vercel-domain>`
- `APP_URL=https://<your-vercel-domain>`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_AVATARS_BUCKET`
- `SUPABASE_STORAGE_EXPENSE_ATTACHMENTS_BUCKET`

Recommended optional variables:

- `CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_PASSWORD`

### Order of operations

1. Deploy or update the database schema in Supabase with `corepack pnpm db:migrate`.
2. Deploy the Render API service.
3. Deploy the Vercel frontend.
4. Set `VITE_API_BASE_URL` on Vercel to the Render API URL.
5. Update `FRONTEND_URL`, `APP_URL`, and `CORS_ALLOWED_ORIGINS` on Render to the Vercel URL.
