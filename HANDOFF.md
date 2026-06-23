# PayIncus / Incudal Handoff

Last updated: 2026-06-23 CST

This file is a handoff note for a new Codex conversation. Do not include server passwords or other secrets in this file.

## Repository

- Local path: `/Users/max/Documents/incudal`
- Main product repository: `git@github.com:VipMaxxxx/payincus.git`
- Current local branch: `master`
- Target remote branch: `payincus/main`
- Upstream original project: `git@github.com:qwer-xyz/incudal.git`
- Important ledger: `docs/production-audit.md`

## Current Git State

Use `git log --oneline --decorate -5` as the authoritative current HEAD because this handoff may receive handoff-only commits after product releases. The latest product/docs release baseline at the time of this refresh was:

```text
d93b1ef Update version log for v0.0.17
```

GitHub remote `payincus/main` was aligned after the handoff refresh commits.

The tracked tree should be clean against `payincus/main` after pulling. The local audit ledger under `docs/production-audit.md` is ignored by git and may contain newer operational notes.

Recently updated/released files include:

```text
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
server/templates/agent-install.sh
server/src/routes/hosts.ts
client/src/locales/*
docs-site/docs/agent/install.md
docs-site/docs/en/agent/install.md
docs-site/docs/features/resource-hosting.md
docs-site/docs/en/features/resource-hosting.md
```

Recommended first step in a new session or user terminal:

```bash
cd /Users/max/Documents/incudal
git status
git pull --rebase --autostash payincus main
```

If Git reports conflicts or blocks because of staged local changes, inspect with:

```bash
git status
git diff --cached --stat
git diff --stat
```

Do not reset or discard changes unless the user explicitly approves.

## Product Split Status

The user portal and admin console are split into independent Vite entries and builds.

Key files:

- User router: `client/src/router/user.ts`
- Admin router: `client/src/router/admin.ts`
- Admin entry: `client/src/admin/`
- Admin login view: `client/src/views/admin/AdminLoginView.vue`
- User API client: `client/src/api/index.ts`
- Admin API client: `client/src/api/admin.ts`
- User build output: `client/dist/user`
- Admin build output: `client/dist/admin`

Boundary status:

- User authenticated routes require ordinary-user identity.
- Admin accounts are blocked from user-only pages.
- Regular users are blocked from admin pages.
- Admin login is `/admin/login`.
- Legacy admin `/login` only redirects to `/admin/login`.
- User bundle should not contain admin entrypoints, admin API, admin routes, or admin wording.
- Admin bundle should not contain user self-service features such as wallet recharge, friends, transfers, check-in, package sharing, resource pool self-service, mail subscription self-service, or hosting balance self-service.

Important guards:

```bash
pnpm --filter server test:frontend-route-guards
pnpm --filter server test:frontend-dist-boundary-guards
```

## OTA Status

Admin OTA is implemented and proven live through release artifacts and atomic release layout.

Important features completed:

- Admin version page shows current version, tag, commit, release notes, task logs, update and rollback controls.
- Release OTA artifact mode uses GitHub Release manifest, size check and SHA256.
- Atomic layout is supported:

```text
/opt/incudal/current -> /opt/incudal/releases/<version-timestamp>
/opt/incudal/releases/v0.0.10-...
/opt/incudal/releases/v0.0.11-...
```

Live proof already completed:

- Updated through artifact path to `v0.0.10`.
- Migrated production to atomic OTA layout.
- Updated to `v0.0.11`.
- Rolled back to previous release.
- Updated forward again to `v0.0.11`.

Key tags:

- `v0.0.1`: OTA baseline.
- `v0.0.3`: git safe-directory fix.
- `v0.0.7` / `v0.0.8`: verified OTA artifact path.
- `v0.0.10` / `v0.0.11`: atomic OTA release layout and rollback proof.
- `v0.0.12`: plugin center.
- `v0.0.13`: production plugin OTA proof.
- `v0.0.15`: atomic OTA install-root recovery.
- `v0.0.16`: host panel trust certificate refresh.
- `v0.0.17`: Agent installer manifest parsing and ZFS error guidance.

## Plugin Center Status

Plugin center development has been committed, pushed and released as `v0.0.12`.

Implemented backend scope:

- Prisma schema and migration for plugins, plugin versions, install tasks, plugin configs, market sources, event logs and user plugin data.
- Admin API under `/api/admin/plugins` for list/detail, upload install, GitHub market install, enable, disable, uninstall, config and task logs.
- User API under `/api/plugins` for enabled client extensions, public config, plugin action placeholder and sandboxed plugin assets.
- Package validation for `.tar.gz` uploads, manifest validation, path traversal rejection, link rejection, SHA256 calculation, staging extraction and entry/template file checks.
- Market index support through `PLUGIN_MARKET_INDEX_URL`, restricted to GitHub-hosted indexes and GitHub Release artifact download URLs with SHA256 verification.

Implemented frontend scope:

- Admin route `/admin/plugins` and plugin center page for upload install, market install, enable/disable/uninstall, config JSON and task log viewing.
- User route `/plugins/:pathMatch(.*)*` for plugin-provided user pages.
- User sidebar extension point `user.sidebar.extra` rendered through sandboxed plugin frames.
- User and admin API clients remain separated; user client does not expose `/admin/plugins`.

Templates and docs:

- `plugin-templates/basic-admin-plugin`
- `plugin-templates/user-sidebar-plugin`
- `plugin-templates/admin-user-mixed-plugin`
- Chinese docs under `docs-site/docs/plugins/`
- English docs under `docs-site/docs/en/plugins/`

Deployment/OTA changes:

- `.env.example`, `scripts/install-panel.sh`, and `deploy/incudal-backend.service.example` include plugin env vars and runtime directories.
- Online update and rollback preserve/recreate `plugins`, `plugin-data`, `plugin-logs` and `plugin-staging`.

Important plugin commands:

```bash
pnpm --filter server test:plugin-center-guards
pnpm --filter server test:plugin-package-guards
pnpm --filter server test:plugin-market-guards
pnpm --filter server test:plugin-client-boundary-guards
```

Release proof:

- Commit: `0453d5a Add plugin center`
- Version log commit: `6e8ce21 Update version log for v0.0.12`
- Tag: `v0.0.12`
- GitHub Actions Build & Release run: `28026305328`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.0.12`
- Assets generated: linux amd64 tar.gz, linux arm64 tar.gz, both `.sha256` files, `incudal-v0.0.12-ota-manifest.json`, and `ota-manifest.json`.

Production API proof has passed for the plugin center. Browser UI smoke for `/admin/plugins` iframe rendering and user `/plugins/smoke` rendering still needs a real session/Turnstile proof.

## Documentation Site

Documentation site is implemented under `docs-site/`.

Technology:

- VitePress
- Chinese default route: `/`
- English route: `/en/`
- Auto-generated system version logs from Git tags and commits.

Important files:

- VitePress config: `docs-site/docs/.vitepress/config.ts`
- Docs package: `docs-site/package.json`
- Git changelog generator: `docs-site/scripts/generate-changelog.mjs`
- GitHub Pages workflow: `.github/workflows/docs-pages.yml`
- GitHub Pages root-domain CNAME: `docs-site/docs/public/CNAME`

Current docs domain:

```text
https://payincus.com
https://payincus.com/en/
```

GitHub Pages deployment:

- Repository: `VipMaxxxx/payincus`
- Pages source: GitHub Actions
- Custom domain: `payincus.com`
- DNS apex records should point to GitHub Pages:

```text
A @ 185.199.108.153
A @ 185.199.109.153
A @ 185.199.110.153
A @ 185.199.111.153
```

Optional IPv6:

```text
AAAA @ 2606:50c0:8000::153
AAAA @ 2606:50c0:8001::153
AAAA @ 2606:50c0:8002::153
AAAA @ 2606:50c0:8003::153
```

Useful docs commands:

```bash
pnpm docs:install
pnpm docs:changelog
pnpm docs:build
pnpm docs:preview
```

Direct docs-site commands:

```bash
pnpm --dir docs-site install --ignore-workspace
pnpm --dir docs-site --ignore-workspace build
pnpm --dir docs-site --ignore-workspace preview
```

Known docs build behavior:

- `docs-site/docs/.vitepress/dist/`, `.temp/`, and `docs-site/node_modules/` are ignored.
- `docs-site/pnpm-lock.yaml` should be committed.
- `docs-site/docs/public/CNAME` must stay `payincus.com`.

## Last Known Verification

Recently passed locally after the Agent installer and ZFS guidance work:

```text
bash -n server/templates/agent-install.sh server/templates/install.sh
pnpm --filter server test:agent-install-command-guards
pnpm --filter server test:host-route-id-guards
pnpm --filter server test:frontend-i18n-keys
pnpm --filter server type-check
pnpm --filter client type-check
pnpm build
pnpm docs:changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

Recently passed on production `v0.0.17`:

```text
ENV_FILE=/opt/incudal/.env FRONTEND_URL=https://pay.payincus.com ADMIN_FRONTEND_URL=https://admin.payincus.com BACKEND_URL=http://127.0.0.1:3001 pnpm verify:production
ENV_FILE=/opt/incudal/.env FRONTEND_URL=https://pay.payincus.com BACKEND_URL=http://127.0.0.1:3001 pnpm verify:log-header
```

Production `/opt/incudal/current` resolves to `/opt/incudal/releases/v0.0.17-20260623164805`; `version.json` reports `v0.0.17`, commit `60faf9a59ba0`, and `deployedAt=2026-06-23T16:58:50.000Z`.

Recent Incus/Agent read-only proof:

- The SSH target `147.125.252.103` is the panel host, not the registered Incus host; it has no local `incus` command and no local `incudal-agent` service.
- Production DB host `HKCMI-01` points to a different host URL than the panel SSH IP.
- Panel-to-Incus mTLS read-only storage listing succeeded for host `HKCMI-01`: Incus returned `default` storage pool, driver `zfs`, status `Created`, with space data.
- Backend logs show the Host Agent install token was consumed for host `2`, but `ENV_FILE=/opt/incudal/.env pnpm --filter server verify:production-db` still warns `Online host #2 (HKCMI-01) Agent status is offline`.
- The latest `verify:production-db` warning set was reduced to Lsky not configured and Agent offline; the previous host-capacity and global-shared-package warnings were no longer present.

Manual plugin package proof also passed with `plugin-templates/admin-user-mixed-plugin` packaged as `.tar.gz` and validated by `validateAndExtractPluginPackage`; result had id `com.example.coupon`, one admin page, one user page, one template and 64-char SHA256.

Earlier full product gates already passed before the docs/plugin work:

```text
pnpm --filter client build
pnpm --filter server test:frontend-dist-boundary-guards
pnpm build
pnpm --filter server test:frontend-route-guards
pnpm --filter client lint:check
pnpm --filter server type-check
pnpm test
pnpm test:agent
git diff --check
```

Only rerun the full suite when relevant production code changes occur. For docs-only changes, docs build plus link/format checks are usually enough.

## Production Audit Status

`docs/production-audit.md` currently says progress is about 99%.

Completed:

- Non-Docker split deployment path.
- User/admin frontend split and bundle boundary guards.
- Local build/test gates.
- Live HTTPS smoke for the production split hosts.
- OTA artifact update path.
- Atomic OTA layout and rollback proof.
- Bilingual docs site and GitHub Pages deployment.
- Plugin center API production smoke.
- Host installer certificate-refresh hotfix.
- Agent installer compact-manifest hotfix.
- Panel-to-Incus storage-list proof for the registered host's existing `default` ZFS pool.

Not completed:

- Final real production business proof.

Remaining production proof items:

- Real payment provider order and callback.
- Real Incus create, start, stop, restart, reinstall/recreate, delete.
- Real Web terminal connection through `/api/ws`.
- Production Agent heartbeat on the real Incus host, with fresh resources, metrics, instance report, and traffic updates.
- Real SMTP delivery.
- Real Lsky upload.
- Real Telegram / notification delivery.
- Manual browser login smoke through Turnstile, or an explicitly approved temporary Turnstile disable-and-restore smoke.

## Current Server Access Constraint

This Codex environment can reach the production server TCP/22, but recent authenticated and non-authenticated SSH attempts were closed by the remote host during the SSH handshake before command execution.

Recent SSH behavior:

```text
nc -vz 147.125.252.103 22: succeeded
kex_exchange_identification: Connection closed by remote host
```

This is no longer the earlier local sandbox `Operation not permitted` result. Treat it as remote SSH service, rate-limit, or access-policy instability until server-side logs prove otherwise.

For server-side work while SSH is unstable, ask the user to run commands in their own terminal and paste redacted output. Do not ask them to put passwords into handoff notes.

## Important Production Domains

Current known domains:

- Product/user production: `https://pay.payincus.com`
- Admin production: previously `https://admin.payincus.com`
- User site in docs: `https://pay.payincus.com`
- Admin site in docs: `https://admin.payincus.com`
- Documentation/root site: `https://payincus.com`
- Telegram group: `https://t.me/Payincus`

Note: a previous request excluded the old demo domain from production audit scope. Public README/docs and example configs now use the current production user/admin domains instead.

## Suggested Next Work

1. Sync local Git with remote `payincus/main`.
2. Repair or restart the Agent on registered host `HKCMI-01`; the install token was consumed, but the Agent still reports offline.
3. After Agent heartbeat is fresh, run real instance lifecycle proof: create, start, stop, restart, reinstall/recreate, delete, and `/api/ws` terminal.
4. If creating an additional ZFS pool still fails, fix or avoid ZFS on that Incus host; the existing `default` ZFS pool already lists through Incus.
5. Decide whether to continue improving docs:
   - Page-by-page admin field explanations.
   - User workflow screenshots.
   - API request/response/error reference.
   - Payment provider setup guide.
   - Agent install guide with real host commands.
6. Complete real production proof items from `docs/production-audit.md`.
7. When a real production proof is completed, update `docs/production-audit.md` with exact date, command/evidence, and outcome.

## Release Documentation Rule

When a new feature is completed, it must be released as a new OTA version, and GitHub plus the docs site must be kept in sync.

Required AI development lifecycle:

```text
Implement feature
  -> run automatic acceptance / guard checks
  -> run targeted and relevant full tests
  -> fix any failures
  -> publish a new OTA version
  -> regenerate version logs
  -> update missing Chinese and English docs
  -> build docs site
  -> commit and push everything
```

Required release steps:

1. Commit the code change with a clear commit message that can be used in the public version log.
2. Create/publish a new OTA tag and GitHub Release artifact. Do not leave completed product features only on `main` without an OTA version.
3. Regenerate the docs-site version logs:

```bash
pnpm docs:changelog
```

This updates:

```text
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
```

4. If the OTA changes user-visible behavior, admin behavior, deployment steps, config, API, Agent behavior, payment flow, resource delivery, or troubleshooting behavior, update the matching docs page in `docs-site/docs/` and `docs-site/docs/en/`.
5. Run the docs build before publishing:

```bash
pnpm --dir docs-site --ignore-workspace build
```

6. Commit and push the docs changes so GitHub Pages updates `payincus.com`.

Do not publish an OTA that changes behavior while leaving the public docs and version logs stale. Also do not mark a new feature complete unless its OTA version, Git tag, GitHub Release artifact, docs version log, and any missing feature docs are updated together.

Acceptance rule:

- A feature is not considered complete immediately after code changes.
- It is complete only after automatic acceptance checks pass, relevant tests pass, the OTA version is published, the version logs are regenerated, and the docs site is updated for any changed behavior.
- For auth, payment, permissions, OTA, Agent, resource delivery, and production deployment changes, include the relevant guard scripts and document any remaining live proof requirement in `docs/production-audit.md`.

## Safety Notes

- Do not include server passwords, API secrets, payment keys, SMTP passwords, Telegram tokens, Lsky tokens, or GitHub tokens in summaries or docs.
- Treat auth, payment, permissions, OTA, Agent, and resource delivery as high-risk.
- Do not revert user changes or staged files without explicit approval.
- Before changing backend/admin/user boundary code, read existing guards and update tests with the change.
