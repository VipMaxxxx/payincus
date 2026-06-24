# API Overview

PayIncus frontends call the backend through same-origin `/api`.

```text
https://panel.example.com/api
https://admin.example.com/api
```

Both domains proxy `/api` to the same backend.

## WebSocket

Terminal WebSocket also uses same-origin `/api/ws`:

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```

## Permissions

- User APIs require a regular user session.
- Admin APIs require an administrator session.
- Agent APIs require signature and replay protection.
- Payment callbacks require signature checks and callback source controls.

## Order APIs

- User portal: `GET /api/orders` and `GET /api/orders/:type/:id`, scoped to the current regular user.
- Admin console: `GET /api/admin/orders` and `GET /api/admin/orders/:type/:id`, available only to administrators.
- The order center aggregates `recharge_records` and `instance_billing_records` and does not return raw callback payloads, provider config snapshots or other sensitive fields.
- Manual completion, failure marking and balance adjustments in admin order detail reuse the existing recharge and balance endpoints: `POST /api/admin/recharge/orders/:orderNo/complete`, `POST /api/admin/recharge/orders/:orderNo/fail`, and `POST /api/balance/admin/:userId/adjust`.

## Boundary Rule

Frontend separation does not replace backend authorization. Every route must still enforce identity, role and resource ownership on the backend.
