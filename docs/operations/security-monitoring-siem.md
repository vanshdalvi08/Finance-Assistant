# Security Monitoring And SIEM Webhook

This project can dispatch platform monitoring events to an external SIEM or alerting tool through a webhook.

## Environment Variables

Set these in the API deployment:

- `PLATFORM_MONITORING_WEBHOOK_URL`
- `PLATFORM_MONITORING_WEBHOOK_TOKEN` (optional bearer token)
- `PLATFORM_MONITORING_MIN_SEVERITY` (`info` | `warning` | `error`)
- `PLATFORM_MONITORING_ALERT_COOLDOWN_MS`
- `PLATFORM_MONITORING_WEBHOOK_TIMEOUT_MS`

## Suggested Defaults

- `PLATFORM_MONITORING_MIN_SEVERITY=warning`
- `PLATFORM_MONITORING_ALERT_COOLDOWN_MS=90000`
- `PLATFORM_MONITORING_WEBHOOK_TIMEOUT_MS=6000`

## What Gets Forwarded

Platform events are created from:

- Auth failures (`401`)
- RBAC denials (`403`)
- CSRF/origin/CORS blocks
- Slow requests and server errors
- Platform operations events

Each event includes normalized metadata like severity, category, path, method, request id, and timestamps.

## How To Verify

1. Login as `platform_super_admin`.
2. Open `/platform/monitoring`.
3. Trigger test alert from `POST /api/platform/monitoring/test-alert`.
4. Confirm event appears in both:
   - `/platform/monitoring`
   - your SIEM destination

## Operational Notes

- Failed webhook deliveries are stored as platform events and can be retried from the platform monitoring APIs.
- Cooldown prevents alert flooding for repeated identical events.
