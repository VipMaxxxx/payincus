# Architecture

PayIncus is a control panel for commercial Incus/LXC/KVM delivery. Production is designed around host-process deployment, two frontend builds, a backend listening on localhost or an internal address, and Agents reporting host state.

## Standard Topology

```text
User browser
  -> https://panel.example.com
  -> Nginx serves /opt/incudal/current/client/dist/user
  -> /api and /api/ws proxy to backend 127.0.0.1:3001 or an internal IP

Admin browser
  -> https://admin.example.com
  -> Nginx serves /opt/incudal/current/client/dist/admin
  -> /api and /api/ws proxy to the same backend

Backend Node API
  -> PostgreSQL
  -> Incus hosts / Agent
  -> Payment, SMTP, Telegram, Lsky, Turnstile
  -> Admin OTA
```

The installer keeps Redis for deployment compatibility and future distributed state expansion. Current core persistent state is PostgreSQL-backed.

## Code Modules

| Module | Directory | Responsibility |
| --- | --- | --- |
| User portal | `client/src` + `VITE_APP_ENTRY=user` | Login, instances, terminal, wallet, tickets, notifications, gift cards and self-service pages |
| Admin console | `client/src/admin` + `VITE_APP_ENTRY=admin` | Operations, configuration, resources, billing, delivery, and OTA |
| Backend | `server/src` | Fastify APIs, auth, database, jobs, payment, delivery and audit |
| Agent | `agent` | Host install, heartbeat, resources, instance and traffic reporting |
| Docs site | `docs-site/docs` | Public docs, API reference, and SDK examples |

## Build Outputs

| Entry | Build output | Domain |
| --- | --- | --- |
| User portal | `client/dist/user` | `FRONTEND_URL` |
| Admin console | `client/dist/admin` | `ADMIN_FRONTEND_URL` |
| Backend | `server/dist/app.js` | `127.0.0.1:3001` or internal API |

`pnpm build` builds both frontends, runs frontend bundle boundary guards, then builds the backend.

## Data and Jobs

- PostgreSQL stores users, instances, plans, billing, payments, gift cards, tickets, notifications, logs, Public API/OAuth data and system update tasks.
- Backend workers process instance tasks, restore tasks, backup uploads, notification email jobs, traffic collection and maintenance tasks.
- High-risk state transitions must go through PayIncus internal state machines, transactions, permissions, audit and compensation logic. Public API can only use controlled entrypoints.
- Admin OTA uses release artifacts or Git tags to build a new release and switches `/opt/incudal/current` atomically.

## External Integrations

| Integration | Purpose | Risk boundary |
| --- | --- | --- |
| Incus/Agent | Instance delivery, resource and traffic state | Host certificates, install tokens and root passwords must not appear in the user portal or Public API |
| Payment providers | Recharge, callbacks, reconciliation, refund/adjustment review | Raw callbacks, secrets and provider config are admin-only and redacted |
| SMTP/Telegram | Mail and notifications | Channel secrets must not leak through responses or logs |
| Turnstile | Login, human verification and sensitive operation protection | Test tokens must not be used in production |
| Lsky | Ticket attachments and image storage | Upload tokens and raw provider payloads are not returned publicly |

## Production Constraints

- Keep `SERVE_STATIC_CLIENT=false`; Nginx serves frontend assets.
- Use separate domains and static directories for the user portal and admin console.
- Both frontends call same-origin `VITE_API_BASE_URL=/api`.
- Nginx proxies only `/api/` and `/api/ws/` to the backend.
- Do not long-cache `index.html`, or browsers may keep loading the old SPA after OTA.
- Payment callbacks should use the public user domain, not the admin domain or internal backend URL.
- The user portal must not expose admin entrypoints, admin APIs or admin wording.
- The admin console must not expose user self-service entrypoints.

## Verification Entrypoints

```bash
pnpm --filter server test:frontend-route-guards
pnpm --filter server test:frontend-dist-boundary-guards
pnpm --filter server test:system-update-guards
pnpm --filter server test:public-api-openapi-guards
```

Production domains also need `pnpm verify:split:host` and `pnpm verify:production`. Final acceptance requires real payment, real Incus/Agent, SMTP/notification, Turnstile and backup/restore proof.
