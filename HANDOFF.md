# PayIncus / Incudal Handoff

Last updated: 2026-06-24 CST

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
847aaa6 Update version log for v0.0.22
```

GitHub remote `payincus/main` was aligned after the handoff refresh commits.

The tracked tree should be clean against `payincus/main` after pulling. The local audit ledger under `docs/production-audit.md` is ignored by git and may contain newer operational notes.

Recently updated/released files include:

```text
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
README.md
deploy/nginx-split-intranet.conf.example
scripts/install-panel.sh
server/package.json
server/scripts/test-split-deploy-config.ts
server/scripts/test-system-update-guards.ts
docs-site/docs/deployment/nginx.md
docs-site/docs/en/deployment/nginx.md
docs-site/docs/guide/architecture.md
docs-site/docs/en/guide/architecture.md
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

Production proof snapshot helper:

```bash
ENV_FILE=/opt/incudal/.env PROOF_SINCE_HOURS=24 pnpm verify:production-proof-snapshot
```

This is read-only and prints shareable redacted JSON for payment callback, Host/Agent, instance/traffic, lifecycle task/log, SMTP/Lsky presence, and notification-log proof. It intentionally omits database URLs, host URLs, certificate paths, install tokens, Agent secrets, provider config, order numbers, callback bodies, SMTP passwords, Lsky tokens, notification config, instance root passwords, user emails, IPs and User-Agent values.

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
- `v0.0.18`: Agent binary installer cache query fix.
- `v0.0.19`: storage-pool LVM default plus Incus/ZFS actionable error guidance.
- `v0.0.20`: production split static roots follow atomic `current`.
- `v0.0.21`: production artifact CLI OTA start command uses compiled dist entry.
- `v0.0.22`: redacted production proof snapshot helper.

Latest production proof:

- Production online-update task `#18` updated from `v0.0.20` to `v0.0.21`.
- Current production symlink after the task: `/opt/incudal/current -> /opt/incudal/releases/v0.0.21-20260623175349`.
- `version.json` reports version/tag `v0.0.21`, commit `71cdcff11008`, deployed at `2026-06-23T17:53:57.514Z`.
- Post-OTA `verify-split-host`, `pnpm verify:production`, and `pnpm verify:log-header` passed.
- Production `/opt/incudal/current/server/package.json` now reports `update:online:start` as `node dist/scripts/start-system-update-task.js`.
- Production Nginx roots now point at `/opt/incudal/current/client/dist/user` and `/opt/incudal/current/client/dist/admin`, so frontend static assets follow atomic OTA releases.
- Public `https://admin.payincus.com/admin/plugins` returns HTTP 200 and its current admin JS assets contain `/admin/plugins` and `插件中心`.
- Latest public non-auth recheck passed: live `pnpm verify:split:host` against `https://pay.payincus.com` / `https://admin.payincus.com`, public health endpoints, plugin static bundle markers for admin `/admin/plugins` and user `/plugins/smoke`, plugin API 401 protection, docs TLS, and v0.0.21 Chinese/English version logs.
- Docs apex DNS is still incomplete for resilience: public resolvers currently return only A `185.199.108.153` and AAAA `2606:50c0:8000::153` for `payincus.com`, not the full recommended GitHub Pages record set.
- Remaining production warnings are still business-proof blockers, not deployment blockers: full resource lifecycle cleanup proof, SMTP delivery, Lsky upload, external notification delivery, and Turnstile/session-gated browser smoke.

Latest release proof:

- `v0.0.22` was tagged from commit `9f638d8 Add redacted production proof snapshot`.
- GitHub Build & Release run `28047303600` completed successfully.
- GitHub Release assets are available for `ota-manifest.json`, `incudal-v0.0.22-ota-manifest.json`, linux amd64/arm64 tarballs, and both `.sha256` files.
- The public OTA manifest reports version `v0.0.22`, commit `9f638d87fc3e`, changelog `Add redacted production proof snapshot`, amd64 size `89845500` with SHA256 prefix `c02b95244dca4323`, and arm64 size `88976634` with SHA256 prefix `489594c506ad5487`.
- Production has not yet been updated to `v0.0.22`; current live production proof remains `v0.0.21` until an online update task is run and verified.

Storage-pool note:

- Debian 12 is supported. The current failure was caused by choosing ZFS on a host/kernel where `modprobe zfs` fails, not by Debian 12 itself.
- New storage-pool creation now defaults to LVM and lists LVM before ZFS.
- If Incus returns `not authorized`, rerun a fresh host install command on the real Incus host to refresh the `panel` trust entry.
- If Incus returns `Error loading "zfs" module` or `modprobe: FATAL: Module zfs not found`, install matching headers and make `zfs-dkms`/`modprobe zfs` work, or use LVM/Btrfs/DIR.

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

Production `/opt/incudal/current` resolves to `/opt/incudal/releases/v0.0.21-20260623175349`; `version.json` reports `v0.0.21`, commit `71cdcff11008`, and `deployedAt=2026-06-23T17:53:57.514Z`.

Recent live business proof:

- `ENV_FILE=/opt/incudal/.env pnpm --filter server verify:production-db` passed on production `v0.0.21`.
- Production host `HKCMI-01` is online/installed/API-enabled, with one live storage pool and two running instances.
- Host Agent for `HKCMI-01` is enabled and online with fresh `lastSeenAt`, version `v0.0.1`, and capabilities `heartbeat`, `report`, `host-metrics`, `instance-status`, and `traffic-counters`.
- Agent `lastReport` contains `incus`, `metrics`, `resources`, and `runtime`; traffic snapshots and daily traffic rows exist for both running instances.
- A completed real recharge exists with actual amount, fee, third-party trade number and callback timestamp; a processed payment callback row exists with callback IP present. Full order number, provider config and callback body were intentionally not printed.
- Live operation logs show SSH key generation, recharge completion, instance create, terminal connect/disconnect, Agent install token consumption, a Debian 12 instance create, and NAT port-add successes.
- Interpretation: real payment callback, Agent heartbeat/report, resource/instance/traffic reporting, Incus create, NAT port add, and Web terminal connect/disconnect are now live-proven.

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
- Live payment callback proof.
- Live Agent heartbeat/resource/instance/traffic proof.
- Live Incus create, NAT port add, Web terminal connect/disconnect, and Debian 12 instance proof.

Not completed:

- Final real production business proof.

Remaining production proof items:

- Real Incus stop, restart, reinstall/recreate, delete, cleanup and resource-release proof.
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
2. Run the remaining real instance lifecycle proof on `HKCMI-01`: stop, restart, reinstall/recreate, delete, cleanup and resource-release verification.
3. Complete real SMTP delivery, Lsky upload and Telegram / notification delivery proof.
4. Complete a logged-in browser smoke through Turnstile/session-gated UI, including `/admin/plugins` and user plugin rendering.
5. If creating an additional ZFS pool still fails, fix or avoid ZFS on that Incus host; the existing `default` ZFS pool already lists through Incus.
6. Decide whether to continue improving docs:
   - Page-by-page admin field explanations.
   - User workflow screenshots.
   - API request/response/error reference.
   - Payment provider setup guide.
   - Agent install guide with real host commands.
7. Complete remaining real production proof items from `docs/production-audit.md`.
8. When a real production proof is completed, update `docs/production-audit.md` with exact date, command/evidence, and outcome.

## Release Documentation Rule

When a new feature or complete bugfix bundle is completed, publish one OTA version for that completed unit of work, and keep GitHub plus the docs site in sync. Do not publish an OTA for every tiny intermediate fix. Handoff-only, audit-only, and non-behavior documentation changes usually do not need an OTA.

Versioning rule:

- Use three-part semantic tags: `vMAJOR.MINOR.PATCH`.
- Patch values only run from `0` through `9`.
- After `v0.0.9`, the next version is `v0.1.0`, not `v0.0.10`.
- After `v0.9.9`, the next version is `v1.0.0`.
- Existing historical tags remain unchanged; apply this rule to future releases.
- Version-log section labels and commit subject labels must be bilingual Chinese/English.

Required AI development lifecycle:

```text
Implement feature
  -> run automatic acceptance / guard checks
  -> run targeted and relevant full tests
  -> fix any failures
  -> publish one OTA version for the completed feature/fix bundle
  -> regenerate version logs
  -> update missing Chinese and English docs
  -> build docs site
  -> commit and push everything
```

Required release steps:

1. Commit the code change with a clear commit message that can be used in the public version log.
2. Create/publish one OTA tag and GitHub Release artifact for the completed feature/fix bundle. Do not leave completed product features only on `main` without an OTA version.
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
