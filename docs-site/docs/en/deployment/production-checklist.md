# Production Checklist

Local tests do not replace real production proof.

## Split Host Checks

```bash
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

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
