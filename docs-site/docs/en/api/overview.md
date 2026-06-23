# API Overview

PayIncus frontends call the backend through same-origin `/api`.

```text
https://demo.payincus.com/api
https://demoadmin.payincus.com/api
```

Both domains proxy `/api` to the same backend.

## WebSocket

Terminal WebSocket also uses same-origin `/api/ws`:

```text
wss://demo.payincus.com/api/ws/...
wss://demoadmin.payincus.com/api/ws/...
```

## Permissions

- User APIs require a regular user session.
- Admin APIs require an administrator session.
- Agent APIs require signature and replay protection.
- Payment callbacks require signature checks and callback source controls.

## Boundary Rule

Frontend separation does not replace backend authorization. Every route must still enforce identity, role and resource ownership on the backend.
