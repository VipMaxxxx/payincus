# One-click Install

The recommended production path is the non-Docker installer:

```bash
curl -fsSL https://raw.githubusercontent.com/VipMaxxxx/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

Upgrade:

```bash
sudo bash install-panel.sh --upgrade
```

Uninstall:

```bash
sudo bash install-panel.sh --uninstall
```

## What the Installer Handles

- Installs Node.js, pnpm, PostgreSQL, Redis, Nginx and systemd services.
- Creates the production `.env`.
- Runs Prisma migrations.
- Installs backend dependencies and starts the backend service.
- Configures split Nginx frontend hosts.

## Required Domains

- User portal domain, for example `panel.example.com`.
- Admin console domain, for example `admin.example.com`.
- Initial admin email: enter a real email when prompted, or leave blank to use `admin@payincus.local`.

The two domains must be separate.
