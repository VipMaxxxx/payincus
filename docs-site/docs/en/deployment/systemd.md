# systemd Service

Production should run the backend under systemd and start OTA update/rollback work through narrow oneshot templates. The backend service is long-running; online update and rollback services run per task ID.

## Backend Service

Template:

```text
deploy/incudal-backend.service.example
```

Install:

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo systemctl status incudal-backend --no-pager
```

Important runtime settings:

```text
User=incudal
Group=incudal
WorkingDirectory=/opt/incudal/current
EnvironmentFile=/opt/incudal/.env
ExecStartPre=/usr/bin/bash -lc 'cd /opt/incudal/current/server && pnpm exec prisma migrate deploy'
ExecStart=/usr/bin/node /opt/incudal/current/server/dist/app.js
```

`WorkingDirectory` points to `/opt/incudal/current`, so after OTA switches the symlink a service restart enters the new release.

## Permission Boundary

The backend template uses `ProtectSystem=strict` and `ProtectHome=true`, with write access limited to PayIncus runtime directories:

```text
/opt/incudal
/opt/incudal/current
/opt/incudal/releases
/opt/incudal/update-logs
```

Do not add `/`, `/etc` or database directories to `ReadWritePaths`. Payment secrets, database URLs, OAuth secrets, SMTP passwords and install tokens should live only in `/opt/incudal/.env` or encrypted admin configuration.

## Online Update Services

The update and rollback oneshots run as **root**, but their entry point is funneled through a single root helper, backed by restricted sudoers, an argument-validating wrapper, and a trusted file manifest — so the service user is never handed arbitrary root capability.

### 1. Install the root helper

Extract the helpers from a **SHA256-verified** release and install them `root:root 0755` (the `deploy/*.example` files below are the controlled templates shipped in `/opt/incudal/current`):

```bash
sudo install -d -o root -g root -m 0755 /usr/local/libexec/incudal /usr/local/libexec/incudal/ota-path
sudo install -o root -g root -m 0755 deploy/incudal-online-task.sh.example        /usr/local/libexec/incudal/incudal-online-task
sudo install -o root -g root -m 0755 deploy/incudal-systemctl-wrapper.sh.example  /usr/local/libexec/incudal/systemctl
sudo install -o root -g root -m 0755 deploy/incudal-ota-chown-wrapper.sh.example  /usr/local/libexec/incudal/ota-path/chown
# OTA runtime cache and trusted-manifest directories
sudo install -d -o root -g root -m 0755 /var/cache/incudal-ota /var/lib/incudal-ota/manifests
# Harden ownership: code / current / releases become root-owned; only runtime dirs stay writable by incudal
sudo /usr/local/libexec/incudal/incudal-online-task harden
```

- `incudal-online-task` — the only OTA entry point. Before `update <id>` / `rollback <id>` it verifies the trusted file manifest (SHA256), ownership, and git control, then runs `server/dist/scripts/run-system-update-task.js` as root; it re-seals the manifest after a successful task.
- `systemctl` (wrapper) — the only systemctl the service user can reach via sudo. It accepts only `start --no-block incudal-online-(update|rollback)@<positive integer>.service` and rejects anything else.

### 2. Install the systemd units

Templates:

```text
deploy/incudal-online-update@.service.example
deploy/incudal-online-rollback@.service.example
```

Install:

```bash
sudo cp deploy/incudal-online-update@.service.example /etc/systemd/system/incudal-online-update@.service
sudo cp deploy/incudal-online-rollback@.service.example /etc/systemd/system/incudal-online-rollback@.service
sudo systemctl daemon-reload
```

Both units are `Type=oneshot`, `User=root`, and their entry point is fixed to the root helper — they do **not** point at scripts inside the release:

```text
ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i
ExecStart=/usr/local/libexec/incudal/incudal-online-task rollback %i
```

The admin OTA worker creates a task ID, then starts the corresponding unit through the restricted sudoers wrapper:

```text
sudo /usr/local/libexec/incudal/systemctl start --no-block incudal-online-update@<taskId>.service
sudo /usr/local/libexec/incudal/systemctl start --no-block incudal-online-rollback@<taskId>.service
```

## Restricted sudoers

Grant the service user only the **root helper wrapper** (not `/usr/bin/systemctl`), and pin the command lookup path with `secure_path`:

```bash
sudo tee /etc/sudoers.d/incudal-online-update >/dev/null << 'EOF'
Defaults:incudal !requiretty
Defaults:incudal secure_path=/usr/local/libexec/incudal:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
incudal ALL=(root) NOPASSWD: /usr/local/libexec/incudal/systemctl start --no-block incudal-online-update@*.service, /usr/local/libexec/incudal/systemctl start --no-block incudal-online-rollback@*.service
EOF
sudo chmod 440 /etc/sudoers.d/incudal-online-update
sudo visudo -cf /etc/sudoers.d/incudal-online-update
```

This only lets `incudal` start the update/rollback oneshots through the root-owned wrapper: the wrapper validates the unit name and task ID, and the helper then verifies the trusted manifest, ownership, and git control before anything runs. The service user gets neither an arbitrary root shell nor write access to the code tree or manifest.

### First-time manifest seal

Once the units and sudoers are in place, seal the current release once to write the trusted file manifest (every later OTA verifies against it and re-seals on success):

```bash
sudo /usr/local/libexec/incudal/incudal-online-task seal
```

## Logs

```bash
sudo journalctl -u incudal-backend -n 200 --no-pager
sudo journalctl -u 'incudal-online-update@*' -n 200 --no-pager
sudo journalctl -u 'incudal-online-rollback@*' -n 200 --no-pager
```

Admin OTA task logs are also written under `SYSTEM_UPDATE_LOG_DIR`, which defaults to `/opt/incudal/update-logs`.

## Agent Service

The host Agent install command generated by the admin console writes `incudal-agent.service` on the Incus host. The current template limits Agent resource use and journal write rate:

```text
CPUQuota=20%
MemoryMax=256M
TasksMax=128
StandardOutput=journal
StandardError=journal
LogRateLimitIntervalSec=30s
LogRateLimitBurst=120
```

If a host was installed with an older Agent, update the panel, copy a fresh Agent install command from the admin console, and run it once on the host. Agent binary self-upgrade alone does not rewrite an old systemd service, so old hosts may still lack CPU, memory and journal rate limits.

## Verification

```bash
systemctl is-active incudal-backend
curl -fsS http://127.0.0.1:3001/api/health
```

If startup fails, inspect `journalctl -u incudal-backend`, then verify `/opt/incudal/.env`, database connectivity, the `/opt/incudal/current` symlink, and `server/dist/app.js`.
