# Documentation Coverage

This page states whether the current documentation is enough for PayIncus as an open-source program: installation, operation handoff, third-party development and API integration.

## Current Conclusion

The documentation is now good enough for an open-source release, standard deployment, understanding the main product surface and starting third-party extension development. It is not yet a complete operator manual for every admin field, every button and every possible provider failure.

Developers can understand the architecture, deployment model, core features, Extension Center, theme system, OAuth, Public API and SDK. Operators can follow the non-Docker split deployment path and production checklist. Deep troubleshooting and full admin-field documentation still need more work.

## Covered Areas

| Area | Current coverage |
| --- | --- |
| Product scope | Incus NAT VPS sales, delivery, billing, admin operations, Agent reporting and OTA |
| Deployment | One-click install, manual install, Nginx split deployment, systemd, environment variables and production checklist |
| Architecture | User frontend, admin frontend, backend, PostgreSQL, reserved Redis service, Incus, Agent and static asset boundaries |
| Access boundaries | User/admin split, backend authorization, build artifact checks and production proof rules |
| User portal | Dashboard, services, orders, wallet, tickets, notifications and self-service overview |
| Admin console | Users, products, hosts, images, billing, payments, notifications, logs, OTA and operations overview |
| Delivery | Service lifecycle, Incus delivery, terminal access, Agent install and reporting |
| Billing | Recharge, balance, billing records, providers, callbacks and reconciliation boundaries |
| Communication | Notifications, tickets, help, SMTP, Telegram, attachments and Lsky boundaries |
| Extension Center | Manifest, upload install, online market, submission review, scanning, publishing, config, events, actions and storage |
| Theme system | Theme manifest, CSS, assets, template slots, config forms, theme market and security boundaries |
| OAuth/API | OAuth Provider, Public API, OpenAPI, Bearer tokens, scopes, SDK and endpoint reference |
| Release | Version logs, admin OTA, release artifacts, atomic current/releases layout, rollback and verification commands |

## Match Against The Current Program

| Capability | Covered for the current program | Notes |
| --- | --- | --- |
| New user understanding | Yes | Homepage, introduction and feature pages explain the product and roles. |
| Fresh deployment | Mostly | Non-Docker deployment, Nginx split deployment, systemd and environment variables are covered. |
| Production acceptance | Mostly | Checklists and commands exist, but real payment, Incus, SMTP, Lsky and notification proof must be produced by the deployer. |
| Third-party development | Enough to start | Extension Center, theme system, Public API, OAuth and SDK have stable entrypoints. |
| API integration | Mostly | OpenAPI 3.1, grouped endpoint docs, scopes and boundaries are now documented. |
| Complete admin manual | Not complete | Every admin page, field and state is not yet documented. |
| Troubleshooting encyclopedia | Not complete | Key paths and common issues are covered, not every provider or host failure combination. |

## Remaining Gaps

- Field-level documentation for every admin settings page, including defaults, risk level and effect after change.
- Screenshot-style user workflows for purchase, renewal, reinstall, tickets, notifications and balance.
- Scenario-based troubleshooting for payment providers, SMTP, Telegram, Lsky, Incus and Agent.
- A complete third-party extension example, such as a flash-sale extension with frontend page, admin settings, actions, events and marketplace publishing.
- A real theme package example, including file structure, template slots, config fields, preview image and marketplace submission.
- Full internal Admin/User API developer docs; the stable public contract remains the Public API.

## Maintenance Rule

Whenever a feature, public API, extension capability, theme slot, environment variable or production verification script changes, the documentation site should be updated in the same release. Changes touching authentication, payments, permissions, resource delivery, balance or third-party extensions must also update boundary notes and verification steps.
