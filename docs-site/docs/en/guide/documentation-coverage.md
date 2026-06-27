# Documentation Coverage

This page defines the usability standard for PayIncus documentation. The docs are not just product copy; they are the operating manual for installation, deployment, third-party development, API integration, and production operations. Public documentation must match the current repository code, scripts, routes, environment variables, and deployment layout.

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
| Integration Center | SMTP, Lsky, Telegram, payment providers, notification channels, remote storage, Agent/Incus, OTA, and marketplace health checks match the admin implementation | `server/src/routes/admin-integrations.ts`, `client/src/views/admin/IntegrationsView.vue` |
| Extensions | Third parties can build extensions with admin config, user pages, events, actions, and marketplace publishing | `server/src/lib/plugin-manifest.ts`, `plugin-templates/` |
| Themes | Third parties can package, upload, preview, enable, rollback, and submit themes | `server/src/lib/theme-package.ts`, `theme-templates/` |
| Public API | Endpoints, auth, scopes, pagination, sorting, errors, and SDK examples match routes | `server/src/routes/public-api.ts`, `server/src/lib/public-api-openapi.ts` |
| Troubleshooting | Common failures include commands, log paths, and safe remediation steps | `scripts/verify-*`, systemd, Nginx, OTA logs |

## Current Coverage

The documentation currently covers:

- Product scope, roles, architecture, and production split deployment.
- One-click install, manual deployment, Nginx, systemd, environment variables, and production acceptance.
- User portal, admin console, instance delivery, billing, payments, communication, hosting, and resource pools.
- Integration Center, external service health checks, recent failure records, and 7-day success rates.
- Host Agent installation, heartbeat, resource reports, and delivery boundaries.
- Admin OTA, Release artifacts, SHA256, atomic `current/releases` layout, and rollback.
- Extension Center, manifest, config forms, client slots, events, actions, storage, templates, and marketplace submissions.
- Theme system, manifest, CSS/HTML safety checks, config forms, template slots, theme marketplace, and rollback.
- Full-site capability matrix for admin entries, user entries, APIs, code sources, guard coverage, and next gaps.
- OAuth Provider, Public API, OpenAPI, Bearer tokens, scopes, pagination, sorting, error model, and SDK.
- Common issues and production proof checks.

## Maintenance Rule

Update the docs whenever any of these change:

- Environment variables.
- Public API endpoints, OAuth scopes, or SDK methods.
- One-click install, Nginx, systemd, OTA, or Agent scripts.
- Packages, resources, instance delivery, balance, payments, refunds, risk controls, or permissions.
- Integration Center, SMTP, Lsky, Telegram, payment providers, notification channels, remote storage, Agent/Incus, OTA, or marketplace health checks.
- Extension manifest, actions, events, slots, storage, or marketplace publishing.
- Theme manifest, template slots, config fields, asset validation, or marketplace publishing.
- Any admin entry, user entry, Public API endpoint, OAuth scope, delivery, billing, risk-control, extension, or theme capability that changes the full-site capability matrix.

Documentation that touches authentication, payments, permissions, resource delivery, balance, OTA, extensions, or themes must include risk boundaries and verification steps.

## Verification Commands

Before publishing docs, run at least:

```bash
pnpm --dir docs-site --ignore-workspace build
pnpm --filter server test:frontend-i18n-keys
rg "old source keyword or old contributor name" README.md docs-site
```

For deployment, OTA, extension, theme, or API docs, also run the relevant guards:

```bash
pnpm --filter server test:system-update-guards
pnpm --filter server test:integration-health-guards
pnpm --filter server test:plugin-package-guards
pnpm --filter server test:plugin-runtime-capabilities-guards
pnpm --filter server test:plugin-client-boundary-guards
pnpm --filter server test:theme-system-guards
pnpm --filter server test:public-api-openapi-guards
```
