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
| Delivery Assurance | `/admin/delivery` | Instance delivery task status, failed delivery details and notification delivery state for post-payment troubleshooting. |
| Images | `/admin/images` | OS images, architecture and availability. |
| Hosting | `/admin/hosting` | Hosted hosts, providers, revenue and review. |
| Statistics | `/admin/statistics` | Operational, resource and billing metrics. |
| Logs | `/admin/logs` | Audit logs and system operation records. In the Chinese UI, modules, actions, results and common log content are localized to Chinese. |

## Billing and Commercial Features

- Billing center: `/admin/billing`.
- Payment providers: `/admin/billing?tab=paymentProviders`.
- Affiliate review: `/admin/billing?tab=affConversions`.
- Entertainment management: `/admin/entertainment`.

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

Verification must prove that regular users cannot enter the admin console, that the admin bundle does not include user self-service workflows, and that Delivery Assurance does not expose root passwords, certificates, tokens or password hashes.
