# Content Security Policy Rollout Plan

Date: June 7, 2026

## Current deployment mode

The frontend sends `Content-Security-Policy-Report-Only`. It does not send an enforcing `Content-Security-Policy` header.

The following headers are enforced immediately:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Frame-Options: DENY`

CSP reports are sent to:

`https://api.payroll.reforix.com/api/security/csp-report`

The collector accepts legacy CSP reports and Reporting API payloads, removes URL query strings and fragments, limits request size, rate-limits by remote address, and records a sanitized platform event.

## Application resource inventory

| Resource type | Required sources | Reason |
| --- | --- | --- |
| Scripts | `'self'` | Vite production JavaScript bundles only |
| Script attributes | `'none'` | No inline event handlers are required |
| Styles | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` | Compiled CSS, Google Fonts stylesheet, React style properties, chart-generated style elements |
| Fonts | `'self'`, `data:`, `https://fonts.gstatic.com` | Local/font data and Inter from Google Fonts |
| API connections | `'self'`, `https://api.payroll.reforix.com`, `https://finance-assistant-api-nmc7.onrender.com` | Production API domains |
| Images | `'self'`, `data:`, `blob:`, `https://*.supabase.co`, `https://www.svgrepo.com` | Bundled assets, QR/profile previews, uploaded assets, Google login icon |
| Frames | `'none'` | The application does not embed frames |
| Workers | `'none'` | No web/service workers are used |
| Media | `'none'` | No audio/video resources are used |
| Analytics | None | No analytics, tag manager, session replay, or error-reporting browser SDK was found |
| Third-party scripts | None | No third-party JavaScript origin was found |

External hyperlinks and OAuth top-level navigation do not require a CSP resource-source exception.

## Report-only policy

```text
default-src 'none';
base-uri 'self';
child-src 'none';
connect-src 'self' https://api.payroll.reforix.com https://finance-assistant-api-nmc7.onrender.com;
font-src 'self' data: https://fonts.gstatic.com;
form-action 'self';
frame-ancestors 'none';
frame-src 'none';
img-src 'self' data: blob: https://*.supabase.co https://www.svgrepo.com;
manifest-src 'self';
media-src 'none';
object-src 'none';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
worker-src 'none';
upgrade-insecure-requests;
report-uri https://api.payroll.reforix.com/api/security/csp-report;
report-to csp-endpoint
```

## Audit procedure

1. Deploy report-only mode to a preview environment and production.
2. Exercise login, OAuth, MFA setup, password reset, every role dashboard, employee photos, expense attachments, fund receipts, exports, and print/report views.
3. Review browser console violations and platform events by effective directive, blocked origin, route, and browser.
4. Treat extension-injected scripts, browser tooling, malformed reports, and automated scanners as noise only after verification.
5. Add a source only when a documented product feature requires it. Never add `*`, broad schemes such as `https:`, or `'unsafe-eval'` to silence reports.
6. Observe normal production traffic for at least 14 days, including a payroll close and all critical workflows.

## Promotion criteria

Promote to enforcement only when:

- No unexplained first-party violations remain for 14 consecutive days.
- Login, OAuth, MFA, reset, payroll, employee management, uploads, exports, and reporting pass in supported browsers.
- Every allowed external origin has an owner and business justification.
- CI confirms the report-only policy and proposed enforcing policy remain synchronized.
- A rollback deployment is prepared.

## Final production CSP

After the promotion criteria are satisfied, rename the header to `Content-Security-Policy` and retain reporting:

```text
default-src 'none';
base-uri 'self';
child-src 'none';
connect-src 'self' https://api.payroll.reforix.com https://finance-assistant-api-nmc7.onrender.com;
font-src 'self' data: https://fonts.gstatic.com;
form-action 'self';
frame-ancestors 'none';
frame-src 'none';
img-src 'self' data: blob: https://*.supabase.co https://www.svgrepo.com;
manifest-src 'self';
media-src 'none';
object-src 'none';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
worker-src 'none';
upgrade-insecure-requests;
report-uri https://api.payroll.reforix.com/api/security/csp-report;
report-to csp-endpoint
```

For a stricter later phase, self-host Inter and the Google icon, replace dynamic inline styles with CSS classes or nonce-compatible generated styles, and remove `'unsafe-inline'` and the remaining third-party asset origins.

## References

- Vercel CSP guide: https://vercel.com/guides/content-security-policy
- Vercel project headers: https://vercel.com/docs/projects/project-configuration
- OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- W3C CSP Level 3: https://www.w3.org/TR/CSP/
