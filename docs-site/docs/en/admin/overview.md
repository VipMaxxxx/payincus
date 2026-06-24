# Admin Console

The admin console is for operators and administrators only. It provides operations, configuration, auditing, delivery and maintenance features.

Entry:

```text
https://admin.example.com
```

## Access Boundary

- Admin login page: `/admin/login`.
- Legacy `/login` only redirects to `/admin/login`.
- Admin routes require administrator identity.
- The admin build output is `client/dist/admin`.
- Admin APIs are protected and mostly live under `/api/admin/*`.

## Operations

| Feature | Route | Description |
| --- | --- | --- |
| Users | `/admin/users` | Accounts, roles, status, balance and customer registration links. |
| Instances | `/admin/instances` | Global instance list and lifecycle operations. |
| Admin create instance | `/admin/instances/create` | Manual delivery or correction workflows. |
| Delivery Assurance | `/admin/delivery` | Instance delivery tasks, failure details, notification state, Agent/host/billing context and post-payment delivery troubleshooting actions. |
| Images | `/admin/images` | OS images, architecture and availability. |
| Hosting | `/admin/hosting` | Hosted hosts, providers, revenue and review. |
| Statistics | `/admin/statistics` | Operations overview, revenue, orders, resources, delivery, risk alerts and billing metrics. |
| Logs | `/admin/logs` | Audit logs and system operation records. In the Chinese UI, modules, actions, results and common log content are localized to Chinese. |

## Billing and Commercial Features

- Billing center: `/admin/billing`.
- Order center: `/admin/orders` aggregates recharge orders and instance billing records, with filters by type, status, user ID, order number, provider transaction ID and date range, order details, recharge exception handling, dispute status, refund or adjustment approval requests and approval execution.
- Financial reconciliation: `/admin/billing?tab=reconciliation` generates one business-day reconciliation run, compares recharge, balance ledger, instance billing, adjustment approvals and hosting income, tracks differences and exports redacted CSV files.
- Payment providers: `/admin/billing?tab=paymentProviders`.
- Affiliate review: `/admin/billing?tab=affConversions`.
- Entertainment management: `/admin/entertainment`.

## Operations Overview

The top of `/admin/statistics` now gives administrators a commercial operations view before the user, instance and billing trend tabs:

- Revenue: today, yesterday, last 7 days and last 30 days completed recharge revenue.
- Orders: today total, successful, failed, pending and payment orders needing review.
- Users: today new users, today active users and historical paid users.
- Instances: today new instances, currently running, abnormal and expiring within 7 days.
- Delivery: pending delivery tasks and delivery failures in the last 24 hours.
- Infrastructure: online hosts, online Agents, and stale or offline Agents.
- Support and notifications: open tickets, unread inbox messages and notification delivery failures in the last 24 hours.
- Risk alerts: missing active payment provider, SMTP disabled, missing notification channel, offline host or Agent, failed delivery, payment exception, OTA failure and OTA disk-space error.

The operations overview is returned only by the admin statistics API and is not exposed through the user API.

## Order and Payment Operations

`/admin/orders` records the operational lifecycle for abnormal orders from review to compensation or closure:

- Order details show a redacted provider status summary: raw status, provider, masked transaction ID and callback time. Raw callback payloads and provider configuration snapshots are not returned.
- Dispute states are pending review, confirmed, compensated and closed.
- Refund registration creates a balance-adjustment approval request only. It does not directly modify the user balance.
- If the order already has a pending refund approval request, the admin UI blocks duplicate registration.
- Refunds, compensation credits and deductions still execute through balance-adjustment approval. A balance log is written only after approval.
- The user order center does not expose admin operation records, refund approval controls or provider internal summaries.

## Financial Reconciliation

`/admin/billing?tab=reconciliation` provides a daily reconciliation workspace:

- One run is stored per business date. Rerunning the same date updates that run and upserts stable difference keys, so differences are not duplicated.
- The summary covers completed recharge, balance logs, instance billing, approved adjustment requests and hosting income.
- Difference detection covers completed recharge without a balance log, key balance logs without a business source, delivered paid instances without billing, and approved adjustment requests without a balance log.
- Differences can be kept as open, confirmed or ignored with notes and handler metadata.
- CSV exports cover orders, balance logs, hosting income and adjustment approvals. Exports do not include raw callback payloads, payment secrets, tokens, passwords or provider configuration snapshots.
- Reconciliation permissions are centralized. Administrators can view and handle runs now; the same entrypoint is reserved for a future read-only finance role.

## Delivery Assurance

`/admin/delivery` handles paid resources that were not delivered, are stuck, or failed during delivery:

- Delivery tasks are shown as pending, processing, failed or completed. Failed tasks and tasks processing for more than 30 minutes are turned into assurance cases.
- Assurance statuses are pending manual handling, auto retryable, in progress, recovered and closed.
- Only idempotent start, stop and restart tasks can be requeued automatically. Rebuild, recreate, clone and host-change tasks require manual takeover.
- Task details include user, instance, host, Agent heartbeat, host resource usage, latest billing record and a redacted failure reason.
- Administrators can take over a case, requeue retryable tasks, notify the user, mark recovered or close the issue.
- User notifications cover delivery delayed, recovered and contact support states.
- Delivery Assurance stores notes, handler metadata and action history without returning root passwords, host certificates, install tokens or password hashes.

## System Settings

- Access and registration.
- Hosting and site URLs.
- Brand and appearance.
- Security verification.
- Mail service and SMTP.
- Tickets and attachments.
- Popup announcements.
- Telegram integration.

## Plugin Center

`/admin/plugins` splits plugin management into Installed, Plugin Market and Install Tasks pages. Administrators can upload plugin packages, install from a GitHub-hosted market index, enable or disable plugins, edit plugin configuration and inspect paginated install task logs.

## OTA

`/admin/system-update` shows current version, latest release tag, tag, commit, build time, deployment time, release notes, paginated task logs and rollback controls. If the deployment is already on the latest tag, the latest version still remains visible and the update action is disabled as already up to date.

OTA updates and rollbacks preserve `plugins`, `plugin-data`, `plugin-logs` and `plugin-staging`.

Verification must prove that regular users cannot enter the admin console, that the admin bundle does not include user self-service workflows, that Delivery Assurance does not expose root passwords, certificates, tokens or password hashes and does not auto-retry non-idempotent delivery tasks, that the order center does not expose raw callback payloads, provider snapshots or payment secrets, and that reconciliation exports remain redacted.
