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
| Tickets & Customer Success | `/admin/tickets` | Handle support tickets with user context, linked objects, internal notes, handling timeline and safe support shortcuts. |
| Images | `/admin/images` | OS images, architecture and availability. |
| Hosting | `/admin/hosting` | Hosted hosts, providers, revenue and review. |
| Statistics | `/admin/statistics` | Operations overview, revenue, orders, resources, delivery and billing metrics. |
| Gift Cards | `/admin/gift-cards` | Create single or batch balance gift cards, review stats and redacted lists, and enable, disable or delete unused cards. |
| Logs and Audit | `/admin/logs` | Audit logs and system operation records with risk levels, approval or verification hints, and redacted CSV export. |

## Billing and Commercial Features

- Billing center: `/admin/billing`.
- Order center: `/admin/orders` aggregates recharge orders and instance billing records, with filters by type, status, user ID, order number, provider transaction ID and date range, order details, recharge exception handling, dispute status, refund or adjustment approval requests and approval execution.
- Financial reconciliation: `/admin/billing?tab=reconciliation` generates one business-day reconciliation run, compares recharge, balance ledger, instance billing, adjustment approvals and hosting income, tracks differences and exports redacted CSV files.
- Payment providers: `/admin/billing?tab=paymentProviders`, including online providers and manual recharge instructions.
- Affiliate review: `/admin/billing?tab=affConversions`.
- Entertainment management: `/admin/entertainment`.
- Gift cards: `/admin/gift-cards`. Production deployments must configure the `PAYINCUS_GIFT_CARD_ADMIN_IDS` administrator allowlist.

## Operations Overview

The top of `/admin/statistics` now gives administrators a commercial operations view before the user, instance and billing trend tabs:

- Revenue: today, yesterday, last 7 days and last 30 days completed recharge revenue.
- Orders: today total, successful, failed, pending and payment orders needing review.
- Users: today new users, today active users and historical paid users.
- Instances: today new instances, currently running, abnormal and expiring within 7 days.
- Delivery: pending delivery tasks and delivery failures in the last 24 hours.
- Infrastructure: online hosts, online Agents, and stale or offline Agents.
- Support and notifications: open tickets, unread inbox messages and notification delivery failures in the last 24 hours.

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

## Tickets and Customer Success

`/admin/tickets` now provides a customer success workspace:

- Ticket lists can be filtered by active state, source and support queue. Support queues include pending, waiting for user and waiting for internal handling.
- The admin ticket detail aggregates user context: account status, masked email, balance, recent orders and recent instances.
- Support staff can link payment orders, order operation cases, instances and hosts. Linked objects are validated against the current ticket context.
- Internal notes are stored separately from user-visible replies. They are returned only by admin endpoints and are not included in user ticket details or message lists.
- Quick actions only send user notices or open the adjustment, user, instance and host pages. They do not directly mutate balances or resources.
- The handling timeline merges user replies, support replies, internal notes and linked objects.
- Support context does not return raw payment callbacks, provider snapshots, IP addresses, User-Agent values, instance root passwords, 2FA secrets, tokens, certificates or other secrets.

## Logs and Audit

`/admin/logs` tracks admin actions, system events and high-risk operations:

- The log table shows risk levels: low, medium, high and critical.
- The high-risk catalog covers system updates, payment providers, balance adjustments, batch instance deletion, hosts, packages and admin role changes.
- The top summary shows risk catalog size, high-risk records on the current page, records that need approval and records that need verification.
- Administrators can export the currently filtered audit CSV, capped at 1000 rows per export.
- Audit export masks emails, IP addresses, tokens and JWT-like values. It does not export passwords, certificates, raw payment callbacks or secrets.
- Every audit export writes an `audit.export` operation log.
- The risk catalog and full audit export are admin-only. Regular users can only read logs scoped to their own account.

## System Settings

- Access and registration.
- Hosting and site URLs.
- Brand and appearance.
- Security verification.
- Mail service and SMTP.
- Tickets and attachments.
- Popup announcements.
- Telegram integration.

## OTA

`/admin/system-update` shows current version, latest release tag, tag, commit, build time, deployment time, release notes, paginated task logs and rollback controls. If the deployment is already on the latest tag, the latest version still remains visible and the update action is disabled as already up to date.

Verification must prove that regular users cannot enter the admin console, that the admin bundle does not include user self-service workflows, that ticket support context and internal notes are admin-only and cannot bypass adjustment workflows, that logs and audit exports are admin-only, redacted and recorded as export actions, that the order center does not expose raw callback payloads, provider snapshots or payment secrets, and that reconciliation exports remain redacted.
