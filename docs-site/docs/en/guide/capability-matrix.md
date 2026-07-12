# Full-Site Capability Matrix

This page aligns PayIncus capabilities with the current architecture, admin entry points, user/API entry points, documentation, and guard tests. It is not a release promise; it is the acceptance map for deciding whether a capability is product-complete.

Status legend:

- Complete: core code, visible entry point, documentation, and guard coverage exist.
- Usable foundation: the core capability exists, but operations, compensation, or documentation still needs work.
- Planned enhancement: a direction or partial foundation exists and still needs dedicated implementation.

| Capability | Status | Admin entry | User/API entry | Main source | Verification and gap |
| --- | --- | --- | --- | --- | --- |
| Split user/admin apps | Complete | `/admin/*` | User router | `client/src/router/admin.ts`, `client/src/router/user.ts` | Route and bundle guards exist; keep customer self-service code out of the admin bundle. |
| OTA updates | Complete | `/admin/system-update` | None | `server/src/routes/system-update.ts`, `server/src/scripts/run-system-update-task.ts` | Release artifact, SHA256, rollback, and runtime directory preservation are covered; production proof still comes from task logs. |
| Instance purchase and delivery | Usable foundation | `/admin/instances/create` | `/instances/create`, `/instances/:id` | `server/src/routes/instances.ts`, `server/src/db/hosts.ts` | Purchase checks host, inventory, and storage pools; a broader delivery verification matrix is still needed. |
| Storage pool binding | Complete | Host storage page, package binding | Automatic instance placement | `server/src/routes/hosts.ts`, `server/src/db/storage-pools.ts` | Hosts without system disk pools cannot be sold; more health checks and alerts can be added. |
| Instance plan upgrades | Usable foundation | `/admin/billing` upgrade modal | Instance change-plan modal | `server/src/routes/instance-billing.ts`, `server/src/routes/admin-billing.ts` | Capacity, balance, sold-out state, bandwidth sync and Incus sync are checked. A fuller rollback playbook is still needed. |
| Bandwidth and traffic | Usable foundation | Package/plan settings, traffic sync | Instance list/detail, traffic reset | `server/src/db/traffic.ts`, `server/src/services/traffic-scheduler.ts` | Plan-level reset price and speed limits exist; abnormal sync and over-limit states should enter a unified operations view. |
| Payments and accounting | Usable foundation | `/admin/billing`, `/admin/orders` | Wallet, orders, recharge | `server/src/routes/admin-billing.ts`, `server/src/routes/orders.ts` | Online recharge, manual recharge, balance logs, adjustment approval, reconciliation, and redacted exports exist. Manual recharge creates a pending order, shows payment instructions to the user, and waits for admin confirmation in the order center. Fuller provider status sync is still needed. |
| Gift cards | Complete | `/admin/gift-cards` | `/gift-cards` | `server/src/routes/gift-cards.ts` | Generation, redemption, allowlist, and Turnstile are covered; production still requires the correct admin allowlist and Turnstile keys. |
| Communication | Usable foundation | `/admin/tickets`, `/admin/help`, `/admin/inbox` | `/tickets`, help center, inbox | `server/src/routes/tickets.ts`, `server/src/lib/notifier.ts` | Admin-only support context and internal notes exist; notifications, help, and ticket entry points cover the main support flows. |
| Telegram integration | Usable foundation | `/admin/settings/telegram` | Profile binding | `server/src/routes/telegram.ts`, `client/src/views/admin/TelegramConfigView.vue` | Bot, webhook, user bindings, and group eligibility exist. |
| Mail and Lsky attachments | Usable foundation | `/admin/settings/mail`, `/admin/settings/tickets` | Email verification, ticket attachments | `server/src/routes/system-config.ts`, `server/src/lib/lsky.ts` | SMTP/Lsky configuration and preflight exist. |
| Public API / OAuth | Usable foundation | `/admin/oauth` | `/api/v1/*`, OAuth Provider | `server/src/routes/public-api.ts`, `server/src/lib/public-api-openapi.ts` | Token auth, scopes, pagination, sorting, errors, and SDK exist; service creation, refunds, direct balance writes, and migrations remain closed. |
| Hosting and resource pools | Usable foundation | `/admin/hosting`, resource pages | My hosts, my packages, hosting wallet | `server/src/routes/hosting.ts`, `server/src/routes/packages.ts` | Hosting zones, income, packages, and host binding exist; business acceptance and anomaly notification need more work. |
| Entertainment and benefits | Usable foundation | `/admin/entertainment` | `/entertainment`, check-in/benefits | `server/src/routes/admin-entertainment.ts`, `server/src/routes/checkin.ts` | Foundation exists; product positioning, visibility, and configuration boundaries should be clarified. |

## Next Closures

- Upgrade compensation: next add a fuller rollback playbook and finer repair audit views.
- Refund lifecycle: next add built-in provider refund adapters and fuller provider status synchronization.

## Maintenance Rule

Update this page whenever admin entries, user entries, Public API endpoints, OAuth scopes, delivery, payments, or OTA behavior changes. Run the matching guard tests with the docs update.
