---
title: One-click Install
description: Deploy PayIncus on Debian or Ubuntu from a verified GitHub Release
---

# One-click Install

<p class="doc-lead">Deploy PayIncus on a clean server with the official installer. It configures dependencies, database access, environment variables, systemd, and the selected external access mode.</p>

<div class="doc-meta">
  <div><span>Use case</span><strong>First production install</strong></div>
  <div><span>Supported OS</span><strong>Debian / Ubuntu</strong></div>
  <div><span>Default path</span><strong>/opt/incudal</strong></div>
</div>

::: tip Expected result
The installation creates separate user and admin frontends with a local backend service. Release artifacts are extracted only after SHA256 verification.
:::

## Requirements

Every mode requires a clean Debian or Ubuntu server and root or sudo access. External access requirements depend on the mode selected during installation:

| Mode | Domain and network requirements |
| --- | --- |
| Nginx + Certbot | Prepare separate user and admin domains, point A/AAAA records to the server, and expose ports 80/443. |
| Cloudflare Tunnel | Manage both domains in Cloudflare and prepare Tunnel credentials; inbound public ports 80/443 are not required. |
| Service only | The script does not require domains or configure TLS; an existing reverse proxy or internal gateway must expose the local backend. |

The default install directory is `/opt/incudal`. This is the real path used by the installer, systemd templates, OTA worker, and production release layout.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/VipMaxxxx/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

During installation, provide:

- User portal domain.
- Admin console domain.
- Initial admin email. Empty input defaults to `admin@payincus.local`.
- Initial admin password. Use a strong password in production.

## What It Does

- Installs Node.js, pnpm, PostgreSQL, Redis, Nginx, and systemd dependencies.
- Creates the database connection and `/opt/incudal/.env`.
- Downloads the latest GitHub Release artifact and its `.sha256`, then verifies it before extraction.
- Extracts PayIncus into `/opt/incudal`.
- Runs Prisma migrations and Prisma Client generation.
- Creates the `incudal` system user and `incudal-backend` service.
- Creates OTA, certificate, cache, and log directories.
- Writes Nginx configuration for both domains.
- Sets `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `SITE_URL`, and `PAYMENT_CALLBACK_BASE_URL`.

## Upgrade and Uninstall

```bash
sudo bash install-panel.sh --upgrade
sudo bash install-panel.sh --uninstall
```

`--upgrade` is only for the legacy non-atomic layout. If `/opt/incudal/current` is an atomic symlink, the script exits safely; use admin OTA instead so `current/releases` is not overwritten.

Legacy upgrades preserve `.env`, certificates, runtime caches, and OTA directories. Uninstall removes all of `/opt/incudal`, including runtime assets, OTA releases, and update logs. PostgreSQL/Redis services and database data are not removed automatically. Back up the database and installation directory first.

## Post-install Checks

```bash
systemctl status incudal-backend --no-pager
journalctl -u incudal-backend -n 100 --no-pager
```

Open:

```text
https://panel.example.com
https://admin.example.com
```

Run split deployment verification:

```bash
cd /opt/incudal/current 2>/dev/null || cd /opt/incudal
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

If atomic OTA layout is enabled, the runtime directory is `/opt/incudal/current`; otherwise it is `/opt/incudal`.
