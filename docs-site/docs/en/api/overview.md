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
- Manual completion and failure marking in admin order detail reuse the existing recharge endpoints: `POST /api/admin/recharge/orders/:orderNo/complete` and `POST /api/admin/recharge/orders/:orderNo/fail`.
- Refunds, compensation credits and deductions first enter balance-adjustment approval: `POST /api/balance/admin/:userId/adjustment-requests` creates a request, `GET /api/balance/admin/adjustment-requests` lists tasks, `POST /api/balance/admin/adjustment-requests/:requestId/approve` approves and executes it, and `POST /api/balance/admin/adjustment-requests/:requestId/reject` rejects it. Balance logs are written only after approval.

## Boundary Rule

Frontend separation does not replace backend authorization. Every route must still enforce identity, role and resource ownership on the backend.
