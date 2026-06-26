# API Reference

PayIncus frontends, third-party integrations, and extension backends enter the platform through controlled APIs. Public API uses `/api/v1`; internal user and admin APIs use same-origin `/api`.

```text
https://panel.example.com/api
https://admin.example.com/api
https://panel.example.com/api/v1
```

## Introduction

| Capability | Base path | Authentication | Purpose |
| --- | --- | --- | --- |
| User API | `/api/*` | User JWT / Refresh Cookie | User portal, orders, instances, tickets, wallet |
| Admin API | `/api/admin/*` | Admin JWT / Refresh Cookie | Admin operations, settings, review, payments, resources |
| Public API | `/api/v1/*` | `pat_` or `poa_` Bearer token | Third-party backends, extension services, automation |
| Agent API | `/api/agent/*` | Agent signature and replay protection | Host heartbeat, resources, instances, traffic |
| WebSocket | `/api/ws/*` | Session and ticket | Web terminal |

## Authentication

Public API accepts two Bearer token types:

- `pat_`: API token created by a PayIncus user.
- `poa_`: OAuth Provider access token from the authorization code flow.

Internal browser JWTs should not be used as long-lived third-party credentials. External apps should use API tokens or OAuth Provider.

## Public API Resources

| Resource | Method | Path | Scope |
| --- | --- | --- | --- |
| Current user | `GET` | `/api/v1/me` | `profile:read` |
| Balance | `GET` | `/api/v1/balance` | `balance:read` |
| Balance logs | `GET` | `/api/v1/balance/logs` | `balance:read` |
| Balance adjustment requests | `GET` / `POST` | `/api/v1/balance/adjustment-requests` | `balance:write` |
| Products | `GET` | `/api/v1/products` | `products:read` |
| Services | `GET` | `/api/v1/services` | `services:read` |
| Service actions | `POST` | `/api/v1/services/:id/actions` | `services:operate` |
| Service renew | `POST` | `/api/v1/services/:id/renew` | `services:billing` |
| Orders | `GET` | `/api/v1/orders` | `orders:read` |
| Billing records | `GET` | `/api/v1/billing-records` | `billing:read` |
| Tickets | `GET` / `POST` | `/api/v1/tickets` | `tickets:read` / `tickets:write` |
| Notifications | `GET` / `POST` | `/api/v1/notifications` | `notifications:read` / `notifications:send` |
| Plugin actions | `GET` / `POST` | `/api/v1/plugins/:pluginId/actions/:action` | `plugins:action` |

## WebSocket

Terminal WebSocket uses same-origin `/api/ws`:

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```

## Permissions

- User APIs require a regular user session and resource ownership checks.
- Admin APIs require an administrator session.
- Public API requires Bearer token, scope, expiry, revocation, and user-state checks.
- Agent APIs require signature and replay protection.
- Payment callbacks require signature checks and callback source controls.

## Boundary Rule

Frontend separation does not replace backend authorization. Every route must enforce identity, role, scope, resource ownership, idempotency, rate limits, and audit rules on the backend.
