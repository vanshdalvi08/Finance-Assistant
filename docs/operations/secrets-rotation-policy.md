# Secrets Rotation Policy

This runbook defines how to rotate sensitive secrets without downtime.

## Secrets In Scope

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_PASS`
- `PLATFORM_MONITORING_WEBHOOK_TOKEN`
- Any third-party API tokens added later

## Rotation Frequency

- JWT secrets: every 90 days (or immediately on incident)
- Service/API tokens: every 90 to 180 days based on provider limits
- SMTP credentials: every 180 days
- Emergency rotation: immediate

## Standard Rotation Process

1. Create new secret value in password manager and provider.
2. Add new value to deployment environment (do not remove old value until verification completes where dual-key support exists).
3. Redeploy service.
4. Verify login, refresh, reset, email, uploads, and monitoring webhook.
5. Revoke old provider credential.
6. Record rotation in change log with date, owner, and verification result.

## JWT Rotation Notes

Current implementation uses single active access/refresh secrets. Rotating JWT secrets will invalidate existing sessions.

Safe approach:

1. Announce maintenance window.
2. Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
3. Redeploy API.
4. Force re-login and verify auth flows.

Future enhancement (recommended): support previous+current key IDs for non-disruptive rotation.

## Incident Rotation (Compromise Suspected)

1. Rotate affected secret immediately.
2. Revoke all active user sessions.
3. Check `/platform/monitoring` for suspicious activity window.
4. Export evidence and incident timeline.
5. Notify stakeholders and complete RCA.
