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
88bc89d Update version log for v0.1.8 / 更新 v0.1.8 版本日志
```

GitHub remote `payincus/main` was aligned after the handoff refresh commits.

The tracked tree should be clean against `payincus/main` after pulling. The local audit ledger under `docs/production-audit.md` is ignored by git and may contain newer operational notes.

Latest tracked handoff/rule commit at the time of this refresh:

```text
88bc89d Update version log for v0.1.8 / 更新 v0.1.8 版本日志
```

Recently updated/released files include:

```text
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
README.md
client/src/views/admin/PluginCenterView.vue
client/src/views/admin/SystemUpdateView.vue
server/src/lib/system-version.ts
server/scripts/test-system-update-guards.ts
docs-site/docs/admin/overview.md
docs-site/docs/en/admin/overview.md
docs-site/docs/guide/ota-update.md
docs-site/docs/en/guide/ota-update.md
docs-site/docs/plugins/overview.md
docs-site/docs/en/plugins/overview.md
client/src/components/layout/SideNav.vue
client/src/router/admin.ts
client/src/views/admin/DeliveryAssuranceView.vue
server/src/routes/admin/delivery.ts
server/scripts/test-delivery-center-guards.ts
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
- `v0.1.0`: admin version-update UI and plugin-center UI polish.
- `v0.1.1`: update task and plugin-center UI pagination/market polish.
- `v0.1.2`: admin update and plugin UI fixes.
- `v0.1.3`: instance detail bandwidth rendering fix.
- `v0.1.4`: incompatible VM package host-binding guard.
- `v0.1.5`: user/admin operation logs localized to Chinese.
- `v0.1.6`: admin instance detail loading fix.
- `v0.1.7`: delivery assurance center.
- `v0.1.8`: delivery assurance sidebar icon fix.
- `v0.1.9`: one-click installer pnpm bootstrap fix.
- `v0.2.0`: one-click installer static asset permission fix.
- `v0.2.1`: one-click installer initial admin email support.
- `v0.2.2`: unified order center.
- `v0.2.3`: order exception handling and manual balance adjustment from admin order detail.

Latest production proof:

- Production OTA task `#32` updated production from `v0.2.2` to `v0.2.3` and completed successfully.
- Server-side `v0.2.3` symlink/version proof has been captured. `/opt/incudal/current` resolves to `/opt/incudal/releases/v0.2.3-20260624111838`; `version.json` reports version/tag `v0.2.3`, commit `21a678cb4d4f`, deployed at `2026-06-24T11:18:46.473Z`, and changelog `Add order exception handling / 新增订单异常处理`.
- Update task `#32` used OTA artifact `incudal-v0.2.3-linux-amd64.tar.gz`, downloaded `89892971` bytes, verified SHA256 `54cc2f9eca40033d619844abe4c6a2569815292ed58e3152f4ef1408b4ba6e2c`, ran Prisma migrate deploy with no pending migrations, switched `/opt/incudal/current`, restarted `incudal-backend`, passed `verify-split-host`, passed `pnpm verify:production`, passed `pnpm verify:log-header`, and ended with `System update completed successfully`.
- Public post-OTA proof for `v0.2.3` passed: `https://pay.payincus.com/api/health` and `https://admin.payincus.com/api/health` returned HTTP 200, anonymous `/api/orders` and `/api/admin/orders` returned HTTP 401, `https://admin.payincus.com/admin/orders` returned HTTP 200, public Chinese and English version-log pages contain `v0.2.3`, public GitHub OTA manifest reports version `v0.2.3` and commit `21a678cb4d4f`, and the public GitHub Release exposes amd64/arm64 tarballs, `.sha256` files, and OTA manifests.
- The production admin bundle contains the new order-operation markers `充值订单处理`, `人工调账`, `手动完成并入账`, and `确认调账`.
- A redacted server-side `PROOF_SINCE_HOURS=72 pnpm verify:production-proof-snapshot` emitted observational proof for two online hosts, two fresh online Agents, two ZFS storage pools, five running instances, one completed recharge/callback, SMTP/Lsky config presence, zero notification channels/logs, and missing lifecycle actions `instance.start`, `instance.restart`, `instance.recreate`, and `instance.delete`. The SSH session was manually interrupted after JSON output stopped, so treat it as observational evidence rather than a clean command-exit proof.
- Production `/opt/incudal/current/server/package.json` reports `update:online:start` as `node dist/scripts/start-system-update-task.js`.
- Production Nginx roots now point at `/opt/incudal/current/client/dist/user` and `/opt/incudal/current/client/dist/admin`, so frontend static assets follow atomic OTA releases.
- Public `https://admin.payincus.com/admin/plugins` returns HTTP 200 and current admin JS assets contain `/admin/plugins`, `插件中心`, and `admin-instance-detail` markers.
- Latest public non-auth recheck passed: live `verify-split-host` against `https://pay.payincus.com` / `https://admin.payincus.com`, public health endpoints, order/plugin/update API 401 protection, Turnstile missing-token negative controls, docs TLS, `v0.2.3` Chinese/English version logs, public admin bundle marker scan, and public root/API security headers.
- Public header checks on `https://pay.payincus.com/`, `https://admin.payincus.com/`, `https://pay.payincus.com/api/health`, and `https://admin.payincus.com/api/health` returned HSTS, CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- `v0.1.8` public release asset availability was verified directly. GitHub Actions API polling hit an anonymous rate limit during that check, so the latest fully recorded Actions run IDs in this handoff remain the earlier `v0.1.6` chain.
- Docs apex DNS is still incomplete for resilience: public resolvers currently return only A `185.199.108.153` and AAAA `2606:50c0:8000::153` for `payincus.com`, not the full recommended GitHub Pages record set.
- Full-function audit progress is `12/13` categories complete, current category `13/13` is `7/13` items complete (`54%`). Remaining production blockers are business-proof blockers, not deployment blockers: Incus start/restart/recreate/delete/cleanup proof, SMTP delivery, Lsky upload, Telegram/external notification delivery, and real password+Turnstile browser smoke.

Latest release proof:

- `v0.2.3` was tagged from commit `21a678c Add order exception handling / 新增订单异常处理`.
- Version-log commit `cd63437 Update version log for v0.2.3 / 更新 v0.2.3 版本日志` is current `payincus/main`.
- GitHub Release `v0.2.3` is public and has the OTA manifest, versioned manifest, linux amd64/arm64 tarballs, and both `.sha256` files.
- Public `ota-manifest.json` reports version `v0.2.3`, commit `21a678cb4d4f`, two artifacts, and changelog `Add order exception handling / 新增订单异常处理`.
- Public docs version-log pages `https://payincus.com/release/version-log.html` and `https://payincus.com/en/release/version-log.html` contain `v0.2.3`.
- Production has OTA task `#32` completion, public health/docs/API-boundary/admin-bundle proof, and server-side `version.json` proof recorded above.

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

Recently passed locally for the latest shipped code path:

```text
pnpm --filter server test:frontend-route-guards
pnpm --filter client type-check
pnpm --filter client build
pnpm --filter server test:frontend-dist-boundary-guards
pnpm --filter client lint:check
pnpm --filter server type-check
pnpm build
pnpm test
pnpm test:agent
pnpm docs:changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

Recently refreshed public production checks after the `v0.2.0` OTA upgrade:

```text
FRONTEND_URL=https://pay.payincus.com ADMIN_FRONTEND_URL=https://admin.payincus.com BACKEND_URL=https://pay.payincus.com VERIFY_RETRIES=2 VERIFY_RETRY_DELAY=1 pnpm verify:split:host
```

Production `/opt/incudal/current` resolves to `/opt/incudal/releases/v0.2.0-20260624093816`; `version.json` reports `v0.2.0`, commit `01731f693610`, build time `2026-06-24T09:36:26.844Z`, and `deployedAt=2026-06-24T09:38:25.047Z`. Production OTA task `#29` also ran `pnpm verify:production` and `pnpm verify:log-header` successfully during the update.

Recent live business proof:

- Server-side redacted snapshot on production `v0.1.6` emitted observational proof for two online hosts, two fresh online Agents, two ZFS storage pools, five running instances, one completed recharge/callback, SMTP/Lsky config presence, and zero notification channels/logs.
- Production hosts `HKCMI-01` and `JPIIJ-01` are online/installed/API-enabled in the latest observational snapshot.
- Host Agents are enabled and online with fresh `lastSeenAt`, version `v0.0.1`, and capabilities `heartbeat`, `report`, `host-metrics`, `instance-status`, and `traffic-counters`.
- Agent `lastReport` contains `incus`, `metrics`, `resources`, and `runtime`; traffic snapshots and daily traffic rows exist for both running instances.
- A completed real recharge exists with actual amount, fee, third-party trade number and callback timestamp; a processed payment callback row exists with callback IP present. Full order number, provider config and callback body were intentionally not printed.
- Live operation logs show SSH key generation, recharge completion, instance create, instance stop, instance rebuild, terminal connect/disconnect, Agent install token consumption, Debian 12 instance create, and NAT port-add successes.
- Interpretation: real payment callback, Agent heartbeat/report, resource/instance/traffic reporting, Incus create, stop, rebuild, NAT port add, storage, and Web terminal connect/disconnect are now live-proven. Start/restart/recreate/delete/cleanup remain missing.

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
- Live Incus create, stop, rebuild, NAT port add, storage, Web terminal connect/disconnect, and Debian 12 instance proof.

Not completed:

- Final real production business proof.

Remaining production proof items:

- Real Incus start, restart, recreate, delete, cleanup and resource-release proof.
- Real backup/restore, suspend/unsuspend, IPv6, and host migration smoke if these features remain in the final acceptance scope.
- Real SMTP delivery.
- Real Lsky upload.
- Real Telegram / notification delivery.
- Manual browser login smoke through Turnstile, or an explicitly approved temporary Turnstile disable-and-restore smoke.
- Logged-in browser rendering proof for `/admin/plugins` and user `/plugins/smoke`.

## Current Server Access Constraint

This Codex environment can reach the production server TCP/22, but recent authenticated and non-authenticated SSH attempts were closed by the remote host during the SSH handshake before command execution.

Recent SSH behavior:

```text
nc -vz 147.125.252.103 22: succeeded
kex_exchange_identification: Connection closed by remote host
```

This is no longer the earlier local sandbox `Operation not permitted` result. Treat it as remote SSH service, rate-limit, or access-policy instability until server-side logs prove otherwise.

For server-side work while SSH is unstable, ask the user to run commands in their own terminal and paste redacted output. Do not ask them to put passwords into handoff notes.

Safe proof paste template for the user:

```text
Proof date/time:
Production version:
Test actor: admin or test user only

Incus lifecycle:
- test instance ID/name:
- host name:
- actions completed: start / restart / recreate / delete / cleanup
- task or log IDs:
- final instance/resource state:

SMTP:
- recipient reference:
- send timestamp:
- backend/admin status:
- inbox receipt reference:

Lsky:
- test ticket/message ID:
- attachment count:
- upload/proxy status:
- safe provider reference:

Telegram / notification:
- channel name or ID:
- send timestamp:
- backend log/status:
- external receipt reference:

Turnstile/browser:
- user login page proof reference:
- admin login page proof reference:
- pages opened after login:
- refresh/session note:
```

Never paste passwords, API secrets, SMTP passwords, Telegram bot tokens, Lsky tokens, Turnstile tokens, session cookies, JWTs, root passwords, raw `.env`, provider private keys, raw callback bodies, raw notification channel config, or instance root credentials.

## Important Production Domains

Current known domains:

- Product/user production: `https://pay.payincus.com`
- Admin production: `https://admin.payincus.com`
- User site in docs: `https://pay.payincus.com`
- Admin site in docs: `https://admin.payincus.com`
- Documentation/root site: `https://payincus.com`
- Telegram group: `https://t.me/Payincus`

Note: a previous request excluded the old demo domain from production audit scope. Public README/docs and example configs now use the current production user/admin domains instead.

## Suggested Next Work

1. Keep local Git synced with remote `payincus/main`; current checked state is `0696a45` on local `master`, `payincus/main`, and `payincus/HEAD`.
2. Run the remaining real instance lifecycle proof on a dedicated test instance only: start, restart, recreate/delete, cleanup and resource-release verification. Existing proof already covers create, stop, rebuild, terminal connect/disconnect, NAT port add, storage, Agent reports, and traffic.
3. Complete real SMTP delivery, Lsky upload and Telegram / notification delivery proof.
4. Complete a logged-in browser smoke through Turnstile/session-gated UI, including `/admin/plugins` and user plugin rendering.
5. After the remaining proof is complete, run `pnpm verify:live-acceptance` with real live proof references. Only run `pnpm verify:final-acceptance` when real password+Turnstile or approved disable-and-restore auth smoke is available.
6. If creating an additional ZFS pool still fails, fix or avoid ZFS on that Incus host; the existing `default` ZFS pool already lists through Incus.
7. Decide whether to continue improving docs:
   - Page-by-page admin field explanations.
   - User workflow screenshots.
   - API request/response/error reference.
   - Payment provider setup guide.
   - Agent install guide with real host commands.
8. Complete remaining real production proof items from `docs/production-audit.md`.
9. When a real production proof is completed, update `docs/production-audit.md` with exact date, command/evidence, and outcome.

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
