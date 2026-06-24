# Production Checklist

Local tests do not replace real production proof.

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
- Real Incus create, start, stop, delete and terminal.
- Agent heartbeat and resource reporting.
- SMTP delivery.
- Lsky upload or attachment delivery.
- Notification delivery through configured channels.
- Public responses include CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Strict-Transport-Security`.
