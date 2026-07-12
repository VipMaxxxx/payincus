# Documentation Coverage

This page defines the usability standard for PayIncus documentation. The docs are not just product copy; they are the operating manual for installation, deployment, API integration, and production operations. Public documentation must match the current repository code, scripts, routes, environment variables, and deployment layout.

## Usability Standard

| Area | Required outcome | Authoritative source |
| --- | --- | --- |
| Installation | A new operator can complete one-click install, domain setup, backend startup, and first access | `scripts/install-panel.sh` |
| Manual deployment | Operators can build user/admin frontends and backend, then configure systemd and Nginx | `package.json`, `deploy/`, `scripts/verify-split-host.sh` |
| Environment | Documented variables must be read by code or scripts, with accurate defaults and risk notes | `scripts/install-panel.sh`, `server/src/config`, `server/src/lib/runtime-settings.ts` |
| OTA | Admins can understand Release artifacts, SHA256, tasks, logs, rollback, and atomic release layout | `server/src/routes/system-update.ts`, `server/src/scripts/run-system-update-task.ts` |
| Agent | Host operators can install the Agent and understand certs, heartbeat, resource reports, and failures | `server/templates/`, `agent/`, `server/src/routes/agent*.ts` |
| Delivery | Packages, plans, storage pools, stock, bandwidth, traffic, upgrades, and capacity checks match implementation | `server/src/routes/instances.ts`, `server/src/routes/instance-billing.ts`, `server/src/db/hosts.ts` |
| Billing | Recharge, balance, billing records, callbacks, reconciliation, adjustments, and refunds keep high-risk boundaries | `server/src/routes/orders.ts`, `server/src/routes/admin-billing.ts` |
| Public API | Endpoints, auth, scopes, pagination, sorting, errors, and SDK examples match routes | `server/src/routes/public-api.ts`, `server/src/lib/public-api-openapi.ts` |
| Troubleshooting | Common failures include commands, log paths, and safe remediation steps | `scripts/verify-*`, systemd, Nginx, OTA logs |

## Current Coverage

The documentation currently covers:

- Product scope, roles, architecture, and production split deployment.
- One-click install, manual deployment, Nginx, systemd, and environment variables.
- User portal, admin console, instance delivery, billing, payments, communication, hosting, and resource pools.
- Host Agent installation, heartbeat, resource reports, and delivery boundaries.
- Admin OTA, Release artifacts, SHA256, atomic `current/releases` layout, and rollback.
- Full-site capability matrix for admin entries, user entries, APIs, code sources, guard coverage, and next gaps.
- OAuth Provider, Public API, OpenAPI, Bearer tokens, scopes, pagination, sorting, error model, and SDK.
- Common issues and troubleshooting paths.

## Maintenance Rule

Update the docs whenever any of these change:

- Environment variables.
- Public API endpoints, OAuth scopes, or SDK methods.
- One-click install, Nginx, systemd, OTA, or Agent scripts.
- Packages, resources, instance delivery, balance, payments, refunds, or permissions.
- Any admin entry, user entry, Public API endpoint, OAuth scope, delivery, or billing capability that changes the full-site capability matrix.

Documentation that touches authentication, payments, permissions, resource delivery, balance, or OTA must include risk boundaries and verification steps.

## Verification Commands

Before publishing docs, run at least:

```bash
pnpm --dir docs-site --ignore-workspace build
pnpm --filter server test:frontend-i18n-keys
rg "old source keyword or old contributor name" README.md docs-site
```

For deployment, OTA, or API docs, also run the relevant guards:

```bash
pnpm --filter server test:system-update-guards
pnpm --filter server test:public-api-openapi-guards
```
