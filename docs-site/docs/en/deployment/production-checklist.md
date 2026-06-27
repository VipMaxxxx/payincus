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

## Production Warnings

A `WARN` line from `verify:production` does not always mean the application is down, but the acceptance record must explain the decision.

- `PAYMENT_CALLBACK_IP_WHITELIST is empty`: no global payment callback IP allowlist is configured. If the payment provider publishes fixed callback source IPs, configure `PAYMENT_CALLBACK_IP_WHITELIST` in `.env`. If the provider does not provide stable source IPs, confirm that the callback still passes signature verification, trade-status validation, amount matching and `payment_callbacks` idempotency before balance credit, then record that operator decision in the acceptance report. DB readiness also identifies active payment providers without built-in default callback IPs.
- `Public package ... cannot satisfy its minimum CPU/memory/disk requirement`: a public package is still enabled/public in configuration, but its online bound Hosts cannot create the smallest available plan after subtracting non-deleted instance usage. The current user package API marks this package as `soldOut=true` and blocks new orders; close the warning by increasing host CPU, memory or disk capacity, migrating or cleaning instances, binding the package to a Host with spare capacity, or pausing the package from public sale. Do not treat this as a display-only frontend issue.

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
- SMTP provider reference and notification delivery through configured channels.
- Lsky upload is already covered by production proof; if the operator excludes Lsky deletion/cleanup from final scope, record the waiver reference in the acceptance report and do not describe it as confirmed deletion.
- Real Turnstile login and session-refresh smoke.
- Backup/restore drill, preferably restoring to a temporary directory or temporary database without overwriting production data.
- Public responses include CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Strict-Transport-Security`.
