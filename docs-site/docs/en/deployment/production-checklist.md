# Production Checklist

Local tests do not replace real production proof.

## Admin Workspace

`/admin/production-proof` provides a read-only Production Proof workspace for remaining proof items, risk order, command packs, and evidence-recording rules.

The page does not execute real payments, resource deletion, Turnstile changes, or OTA rollback. High-risk actions still require an operator-run maintenance window or dedicated test resources. Commands on the page are production-server references only. The audit record must still use redacted logs, admin pages, database summaries, screenshot IDs, or ticket references.

## Split Host Checks

```bash
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

## Redacted Proof Snapshot

```bash
ENV_FILE=/opt/incudal/.env \
PROOF_SINCE_HOURS=24 \
pnpm verify:production-proof-snapshot
```

`verify:production-proof-snapshot` reads the database and prints shareable redacted JSON. It does not print the database URL, host URLs, certificate paths, install tokens, Agent secrets, payment order numbers, provider config, callback body, SMTP password, Lsky token, notification channel config, instance root passwords, user emails, IPs or User-Agent values. Use it to confirm payment callbacks, Agent reports, instance/traffic state and missing lifecycle log actions.

## Must-pass Items

- User domain serves `client/dist/user`.
- Admin domain serves `client/dist/admin`.
- Both domains proxy `/api/health`.
- Both domains support `/api/ws` WebSocket upgrade.
- Regular users cannot enter the admin console.
- Admin accounts cannot enter the user portal.
- User bundle has no admin entrypoints or admin API.
- Admin bundle has no user self-service bundle markers.

## Real Live Proof Still Required

- Real payment callback.
- Real Incus create, start, stop, restart, recreate/rebuild, delete, cleanup and terminal.
- Agent heartbeat and resource reporting.
- SMTP delivery.
- Lsky upload or attachment delivery, including confirmed deletion or cleanup of the test attachment. A bare image URL is not enough proof.
- Notification delivery through configured channels.
- Real Turnstile login and session-refresh smoke.
- Backup/restore drill, preferably restoring to a temporary directory or temporary database without overwriting production data.
- Public responses include CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Strict-Transport-Security`.
