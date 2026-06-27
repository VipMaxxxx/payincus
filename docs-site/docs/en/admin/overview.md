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
| SLA & Alerts | `/admin/sla-alerts` | Scan and handle host, Agent, delivery, payment, notification, mail and OTA incidents. |
| User Lifecycle | `/admin/user-lifecycle` | User lifecycle overview, tags, segments, commercial summary, targeted redeem codes, reminders and win-back actions. |
| Tickets & Customer Success | `/admin/tickets` | Handle support tickets with user context, SLA state, linked objects, internal notes, handling timeline and safe support shortcuts. |
| Images | `/admin/images` | OS images, architecture and availability. |
| Hosting | `/admin/hosting` | Hosted hosts, providers, revenue and review. |
| Capacity & Cost | `/admin/capacity-cost` | Host sellable inventory, cost profiles, plan margin estimates, capacity alerts and 7/30-day trends. |
| Resource Risk | `/admin/resource-risk` | Instance risk scores, bandwidth/CPU/packet anomalies, QoS policy, manual suspension and source-scoped order restriction handling. |
| Statistics | `/admin/statistics` | Operations overview, revenue, orders, resources, delivery, risk alerts and billing metrics. |
| Gift Cards | `/admin/gift-cards` | Create single or batch balance gift cards, review stats and redacted lists, and enable, disable or delete unused cards. |
| Logs and Audit | `/admin/logs` | Audit logs and system operation records with risk levels, approval or verification hints, and redacted CSV export. |

## Billing and Commercial Features

- Billing center: `/admin/billing`.
- Order center: `/admin/orders` aggregates recharge orders and instance billing records, with filters by type, status, user ID, order number, provider transaction ID and date range, order details, recharge exception handling, dispute status, refund or adjustment approval requests and approval execution.
- Financial reconciliation: `/admin/billing?tab=reconciliation` generates one business-day reconciliation run, compares recharge, balance ledger, instance billing, adjustment approvals and hosting income, tracks differences and exports redacted CSV files.
- Payment providers: `/admin/billing?tab=paymentProviders`.
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
- Risk alerts: missing active payment provider, SMTP disabled, missing notification channel, offline host or Agent, failed delivery, payment exception, OTA failure and OTA disk-space error.

The operations overview is returned only by the admin statistics API and is not exposed through the user API.

## Capacity and Cost

`/admin/capacity-cost` consolidates resource headroom and cost assumptions for operators:

- Summarizes Host CPU, memory, disk, NAT ports, instance count and traffic usage as sellable inventory.
- Lets administrators maintain monthly host cost, monthly IPv4 cost, traffic cost per TB and notes per Host.
- Estimates plan monthly margin from plan price and Host cost assumptions to highlight low-margin or negative-margin plans.
- Capacity alerts are operational warnings only. They do not auto-disable sales, modify plans, affect instance creation or change billing.
- Host pressure alerts are synced into SLA alert events and deduplicated with stable fingerprints.
- Daily Host capacity snapshots are stored for 7/30-day trends and later operations review.
- User package, instance and purchase APIs do not return Host cost, margin or internal capacity fields.

## Resource Risk Control

`/admin/resource-risk` handles instance-level resource abuse and security risk:

- The risk target is the instance. Scores, events, QoS downgrades and manual suspension are all instance-scoped.
- The account is linked only for order restriction. When an instance reaches high risk, PayIncus can block the linked account from creating new instances until staff review it through a ticket.
- Instance, event and order restriction tables show up to 10 rows per page, with pagination for older records.
- Manual suspension, unsuspension, order restriction and release all require an admin reason and write audit records.
- Releasing order restrictions is source-scoped. Only an active restriction created by the current instance shows the release action; if another instance under the same account caused the active restriction, the row shows an account-restricted state instead.
- Resource risk data is not exposed to user APIs. User-facing responses do not include backend score policy, manual notes or restriction records belonging to other accounts.

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

## SLA & Alerts

`/admin/sla-alerts` turns platform incidents into operational alerts:

- Default rules cover offline hosts, offline Agents, stale Agent heartbeat, failed instance tasks, failed recharge orders, failed notifications, failed mail delivery tasks and failed OTA updates.
- Alert severities are info, warning and critical. Alert states are open, investigating, recovered and ignored.
- The same rule and object use a stable fingerprint, so repeated scans merge records instead of creating unlimited duplicates.
- Administrators can run scans, acknowledge alerts, mark recovered, ignore, silence alerts and enable or disable rules.
- Alert details show the linked object, trigger count, first trigger time, latest trigger time, notes and action history.
- Alert content stores only redacted summaries and linked object IDs. It does not store raw payment callbacks, provider configuration snapshots, host certificate paths, install tokens, passwords or secrets.
- The alert center is admin-only. User APIs and the user build do not expose alert rules, alert events or internal handling notes.

## Tickets and Customer Success

`/admin/tickets` now provides a customer success workspace:

- Ticket lists can be filtered by active state, source and support queue. Support queues include pending, due soon, overdue, waiting for user and waiting for internal handling.
- Tickets receive first-response and resolution SLA deadlines from their priority. The admin list and detail page show the SLA state and due times.
- The admin ticket detail aggregates user context: account status, masked email, balance, recent orders, recent instances, recent Delivery Assurance cases and recent SLA alerts.
- Support staff can link payment orders, order operation cases, instances, hosts, delivery cases, SLA alerts and plugin tasks. Linked objects are validated against the current ticket context.
- Internal notes are stored separately from user-visible replies. They are returned only by admin endpoints and are not included in user ticket details or message lists.
- Quick actions only send user notices or open the adjustment, delivery, user, instance and host pages. They do not directly mutate balances or resources.
- The handling timeline merges user replies, support replies, internal notes and linked objects.
- Support context does not return raw payment callbacks, provider snapshots, IP addresses, User-Agent values, instance root passwords, 2FA secrets, tokens, certificates or other secrets.

## User Lifecycle

`/admin/user-lifecycle` turns user operations into an auditable workspace:

- The overview shows total users, active users, expiring instances, tag counts, segment counts and recent lifecycle actions.
- Built-in tags cover new users, paid users, high-value users, expiring users, churn risk and risk flags. Adding or removing tags writes an action record.
- Built-in segments cover new registrations, paid users, high-value users, expiring users and churn-risk users. Admins can refresh segment membership.
- The user list supports filters by tag, segment, total recharge, instance count and active state.
- The user summary shows masked email, total recharge, total spend, instance counts, earliest expiry, tickets, lifecycle events and action history.
- Admins can issue targeted resource redeem codes to one user. The code stores `target_user_id`, so other users cannot redeem it.
- Bulk reminders require selected users and explicit confirmation. They are delivered as inbox messages and written to action history.
- The user portal only shows the current user's available targeted redeem codes. It does not expose admin tags, segments, internal events or action records.
- Lifecycle APIs do not return raw payment callbacks, provider snapshots, IP addresses, User-Agent values, instance root passwords, 2FA secrets, tokens or secrets.

## Logs and Audit

`/admin/logs` tracks admin actions, system events and high-risk operations:

- The log table shows risk levels: low, medium, high and critical.
- The high-risk catalog covers system updates, payment providers, balance adjustments, batch instance deletion, hosts, packages, admin role changes and plugin installation.
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

## Extension Center

`/admin/plugins` splits extension management into Installed, Extension Market and Install Tasks pages. Administrators can upload extension packages, install from the online governed market index, enable or disable extensions, open standalone extension settings pages from the left sidebar and inspect paginated install task logs.

## OTA

`/admin/system-update` shows current version, latest release tag, tag, commit, build time, deployment time, release notes, paginated task logs and rollback controls. If the deployment is already on the latest tag, the latest version still remains visible and the update action is disabled as already up to date.

OTA updates and rollbacks preserve `plugins`, `plugin-data`, `plugin-logs` and `plugin-staging`.

Verification must prove that regular users cannot enter the admin console, that the admin bundle does not include user self-service workflows, that Delivery Assurance does not expose root passwords, certificates, tokens or password hashes and does not auto-retry non-idempotent delivery tasks, that SLA alerts are admin-only, deduplicated and redacted, that ticket support context and internal notes are admin-only and cannot bypass adjustment or delivery workflows, that user lifecycle admin data is admin-only while users can only read their own offers, that logs and audit exports are admin-only, redacted and recorded as export actions, that the order center does not expose raw callback payloads, provider snapshots or payment secrets, and that reconciliation exports remain redacted.
