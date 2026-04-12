# Backup And Recovery Runbook

This runbook is for platform operators managing Finance-Assistant in production.

## 1. Backup baseline

- Primary database: managed PostgreSQL with point-in-time recovery enabled.
- Full backup cadence: daily snapshot.
- Log/WAL capture: continuous for PITR.
- Retention target: at least 30 days.
- Artifact/storage backup: keep Supabase buckets under provider backup/versioning policy.

## 2. What to monitor

- Error spikes in platform monitoring (`/platform/monitoring`).
- Authentication failure bursts.
- Database connectivity or migration failures.
- Upload/storage failures.
- Tenant-wide outage signals (multiple events tied to one tenant).

## 2a. Retention posture

- Platform monitoring events can be pruned manually from the platform console once they are resolved and older than policy windows.
- Default platform event retention windows:
  - info: 30 days
  - warning: 90 days
  - error: 180 days
- Open incidents and acknowledged-but-unresolved incidents are retained indefinitely.
- Recovery drill records are excluded from pruning so restore history remains visible in the console.
- Business audit and finance history are protected by default. Prefer archival and backups over destructive audit cleanup.

## 3. Recovery objectives

- RPO target: <= 24 hours for snapshot restore, lower when PITR is available.
- RTO target: <= 60 minutes for full DB restore and service cutover.
- Priority order:
  1. Platform auth and super-admin access
  2. Tenant API availability
  3. Financial write-path integrity
  4. Secondary UX features

## 4. Incident response flow

1. Acknowledge incident in platform monitoring.
2. Freeze risky admin mutations if data integrity is uncertain.
3. Capture incident timestamp window (start, peak, last good point).
4. Decide restoration mode:
   - PITR to exact minute (preferred)
   - latest healthy snapshot restore
5. Restore to isolated environment first and verify.
6. Validate tenant isolation, auth, and finance workflows.
7. Cut traffic to restored instance.
8. Resolve incident and log postmortem actions.

## 5. Restore verification checklist

- Platform super-admin login works.
- Tenant admin login works for at least one active tenant.
- Employee and client scoped access still enforced.
- Can list funds/expenses/salaries without cross-tenant leakage.
- Duplicate-protected actions remain idempotent (salary/PO/expense critical paths).
- Audit trail writes continue with request ID and actor metadata.

## 6. Recovery drill cadence

- Run full restore drill at least monthly.
- Record:
  - drill date
  - restore method used
  - measured RTO/RPO
  - failures/gaps found
  - follow-up owner and due date
- Log the drill outcome in the platform console recovery workspace so it appears in `/platform/recovery` history and settings.

Update `PLATFORM_LAST_RECOVERY_DRILL_DATE` after each successful drill.

## 7. Configuration references

Set these environment variables in production:

- `PLATFORM_BACKUP_STRATEGY`
- `PLATFORM_BACKUP_FREQUENCY`
- `PLATFORM_BACKUP_RETENTION_DAYS`
- `PLATFORM_BACKUP_STORAGE`
- `PLATFORM_RECOVERY_RUNBOOK_URL`
- `PLATFORM_LAST_RECOVERY_DRILL_DATE`
- `PLATFORM_MONITORING_WEBHOOK_URL`
- `PLATFORM_MONITORING_WEBHOOK_TOKEN`
- `PLATFORM_MONITORING_MIN_SEVERITY`
- `PLATFORM_MONITORING_ALERT_COOLDOWN_MS`
- `PLATFORM_MONITORING_WEBHOOK_TIMEOUT_MS`
- `PLATFORM_MONITORING_INFO_RETENTION_DAYS`
- `PLATFORM_MONITORING_WARNING_RETENTION_DAYS`
- `PLATFORM_MONITORING_ERROR_RETENTION_DAYS`
- `PLATFORM_AUDIT_RETENTION_DAYS`
- `PLATFORM_AUDIT_PRUNE_ENABLED`
