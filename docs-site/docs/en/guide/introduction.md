# Introduction

PayIncus is an Incus hosting platform for NAT VPS sales, resource delivery, billing, and operations. It connects user purchases, balance billing, Incus instance delivery, NAT networking, traffic accounting, tickets, notifications, payment callbacks, host Agent reporting, Public API, and admin OTA updates in one auditable workflow.

## Use Cases

- Sell LXC / KVM NAT VPS, IPv6 VPS, or lightweight container instances.
- Run Incus as the instance runtime while users self-service purchase, renew, upgrade, and access terminals.
- Manage packages, plans, hosts, storage pools, traffic, bandwidth, payments, orders, and balances.
- Collect host resources, instance state, and traffic from a host Agent.
- Provide OAuth Provider, Public API, and SDK access for third-party developers.
- Operate release artifact updates, SHA256 verification, and rollback from the admin console.

## Roles

- Users manage accounts, packages, instances, terminals, renewals, upgrades, wallet balance, tickets, notifications, and gift cards.
- Administrators manage users, plans, hosts, storage pools, images, orders, billing, payments, notifications, resource pools, and system updates.
- Host Agents run on Incus hosts and report heartbeat, resources, instance state, traffic, and delivery data.
- Developers use OAuth, Public API, and the SDK to integrate third-party workflows.

## Product Boundary

PayIncus is optimized for non-Docker split production deployment:

- The user portal and admin console are separate Vite entrypoints.
- User build output is `client/dist/user`.
- Admin build output is `client/dist/admin`.
- Backend runtime entry is `server/dist/app.js`.
- Nginx serves both frontends and proxies only `/api` and `/api/ws` to the backend.
- PostgreSQL is the primary persistence layer.
- Redis is kept by the installer for deployment compatibility and future distributed state expansion.
- The default install directory is `/opt/incudal`; this is the real path used by the current installer, systemd templates, OTA worker, and production release layout.

## Entry Points

- User portal: `https://panel.example.com`
- Admin console: `https://admin.example.com`
- Online demo: [/en/demo](/en/demo)
- One-click install: [/en/deployment/one-click-install](/en/deployment/one-click-install)
- Production deployment: [/en/deployment/manual-install](/en/deployment/manual-install)
- API reference: [/en/api/overview](/en/api/overview)

## Next Steps

For first-time deployment, read:

1. [Architecture](/en/guide/architecture)
2. [One-click Install](/en/deployment/one-click-install)
3. [Nginx Split Deployment](/en/deployment/nginx)
4. [Environment Variables](/en/deployment/environment)
For third-party development, start with [Public API](/en/api/overview).
