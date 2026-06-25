# PayIncus / Incudal Handoff

Last updated: 2026-06-25 CST

This file is a handoff note for a new Codex conversation. Do not include server passwords or other secrets in this file.

## Repository

- Local path: `/Users/max/Documents/incudal`
- Main product repository: `git@github.com:VipMaxxxx/payincus.git`
- Current local branch: `master`
- Target remote branch: `payincus/main`
- Upstream original project: `git@github.com:VipMaxxxx/payincus.git`
- Important ledger: `docs/production-audit.md`
- Commercial operation task ledger: `docs/commercial-operation-task-goals.md`

## Current Git State

Use `git log --oneline --decorate -5` as the authoritative current HEAD because this handoff may receive handoff-only commits after product releases. The latest product/docs release baseline at the time of this refresh was:

```text
f630dac Update version log for v0.5.4
```

GitHub remote `payincus/main` was aligned after the handoff refresh commits.

The tracked tree should be clean against `payincus/main` after pulling. The local audit ledger under `docs/production-audit.md` is ignored by git and may contain newer operational notes.

Latest tracked repository commit at the time of this refresh:

```text
f630dac Update version log for v0.5.4
```

Recently updated/released files include:

```text
client/src/views/TicketsView.vue
client/src/views/admin/ProductionProofView.vue
server/scripts/test-production-proof-center-guards.ts
docs-site/docs/deployment/production-checklist.md
docs-site/docs/en/deployment/production-checklist.md
client/src/router/admin.ts
client/src/config/side-nav-items-admin.ts
client/src/locales/zh-CN.ts
client/src/locales/zh-TW.ts
client/src/locales/en.ts
client/vite.config.ts
scripts/install-panel.sh
deploy/nginx-split-intranet.conf.example
scripts/smoke-local-nginx-split.sh
server/prisma/migrations/20260625100000_add_capacity_cost_center/migration.sql
server/src/routes/admin-capacity-cost.ts
server/scripts/test-capacity-cost-guards.ts
server/scripts/test-ai-ticket-context-guards.ts
server/scripts/test-split-deploy-config.ts
server/scripts/test-plugin-market-governance-guards.ts
server/src/lib/plugin-market.ts
server/src/routes/admin-plugins.ts
client/src/views/admin/PluginCenterView.vue
docs-site/docs/plugins/overview.md
docs-site/docs/en/plugins/overview.md
client/src/views/admin/CapacityCostView.vue
client/src/components/layout/SideNav.vue
client/src/views/TicketsView.vue
client/vite.config.ts
server/scripts/test-frontend-i18n-keys.ts
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
server/prisma/migrations/20260624233000_add_ticket_success_center/migration.sql
server/scripts/test-ticket-success-guards.ts
server/src/db/tickets.ts
server/src/routes/tickets.ts
server/prisma/schema.prisma
client/src/views/TicketsView.vue
client/src/types/api.ts
client/src/api/index.ts
client/src/api/admin.ts
client/src/locales/zh-CN.ts
client/src/locales/zh-TW.ts
client/src/locales/en.ts
docs-site/docs/admin/overview.md
docs-site/docs/en/admin/overview.md
server/prisma/migrations/20260624230000_add_sla_alert_center/migration.sql
server/src/routes/admin-sla-alerts.ts
server/scripts/test-sla-alert-guards.ts
client/src/views/admin/SlaAlertsView.vue
client/src/config/side-nav-items-admin.ts
client/src/router/admin.ts
docs-site/docs/admin/overview.md
docs-site/docs/en/admin/overview.md
server/prisma/schema.prisma
server/prisma/migrations/20260624222000_add_delivery_assurance_cases/migration.sql
server/src/routes/admin-delivery.ts
server/src/lib/notifier.ts
server/scripts/test-delivery-center-guards.ts
client/src/views/admin/DeliveryCenterView.vue
docs-site/docs/features/instances.md
docs-site/docs/en/features/instances.md
server/prisma/migrations/20260624214500_add_financial_reconciliation/migration.sql
server/src/routes/admin-billing.ts
server/scripts/test-financial-reconciliation-guards.ts
docs-site/docs/features/billing.md
docs-site/docs/en/features/billing.md
server/prisma/migrations/20260624210000_add_order_operation_cases/migration.sql
server/src/routes/orders.ts
server/scripts/test-order-payment-operations-guards.ts
README.md
package.json
server/package.json
server/src/routes/admin-statistics.ts
server/scripts/test-commercial-operations-overview-guards.ts
client/src/api/admin.ts
client/src/views/admin/StatisticsView.vue
client/src/locales/zh-CN.ts
client/src/locales/zh-TW.ts
client/src/locales/en.ts
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
client/src/views/admin/DeliveryCenterView.vue
server/src/routes/admin-delivery.ts
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

## Latest Release Proof

Latest completed feature bundle:

```text
v0.5.7 Harden online update runner environment
feature commit: d470e7b
version-log commit: 233cfe6
docs/handoff commit: this handoff refresh commit
```

GitHub Actions:

```text
Build & Release for tag v0.5.7: Release assets confirmed publicly.
CI for main/version-log commit: GitHub API rate-limited during this handoff; public docs/version assets were verified instead.
Docs Pages for main/version-log commit: public docs version-log contains v0.5.7.
```

Release assets confirmed publicly for `v0.5.7`:

```text
ota-manifest.json
incudal-v0.5.7-linux-amd64.tar.gz
incudal-v0.5.7-linux-amd64.tar.gz.sha256
incudal-v0.5.7-linux-arm64.tar.gz
incudal-v0.5.7-linux-arm64.tar.gz.sha256
incudal-v0.5.7-ota-manifest.json
```

Published `v0.5.7` OTA manifest:

```text
version: v0.5.7
gitCommit: d470e7b36925
buildTime: 2026-06-25T10:07:50.727Z
amd64 artifact: incudal-v0.5.7-linux-amd64.tar.gz
amd64 size: 90276649
amd64 sha256: 2e0cd6572067158a76ba2ffe1c4caaba40c022814fdcd1fc37ba15a1fbc97ac0
arm64 artifact: incudal-v0.5.7-linux-arm64.tar.gz
arm64 size: 89397183
arm64 sha256: 283d549434e5693b83607dd22e824ba81054cc744c9b74c45debf6670774c6d7
```

Production OTA proof:

```text
latest proven production version: v0.5.7 from task #64
task: #64
target: v0.5.7
fromVersion: v0.5.6
started: 2026-06-25T10:24:24.547Z
finished: 2026-06-25T10:25:38.119Z
backup path: /opt/incudal/releases/v0.5.6-20260625091326
release dir: /opt/incudal/releases/v0.5.7-20260625102424
current release: /opt/incudal/releases/v0.5.7-20260625102424
version.json: version/tag v0.5.7, commit d470e7b36925, buildTime 2026-06-25T10:07:19.607Z, deployedAt 2026-06-25T10:24:32.529Z
verify-split-host: passed
pnpm verify:production: passed
verify-production-db: passed
agent manifest check: passed
pnpm verify:log-header: passed
secret log/header scan: passed
update result: System update completed successfully
cleanup: OTA download cache cleaned; old release pruning executed with protected-release retention
```

Production OTA follow-up for `v0.5.7`:

```text
task: #64
target: v0.5.7
status: success
fromVersion: v0.5.6
logPath: /opt/incudal/update-logs/system-update-64.log
public health after update: user/admin /api/health returned HTTP 200
production readiness: passed
log/header exposure check: passed
runner marker proof: assertRequiredCommands/defaultExecutionPath present in deployed runner
systemd PATH marker proof: deployed update unit template contains Environment=PATH
update result: System update completed successfully
cleanup: OTA download cache cleaned; old release pruning executed with protected-release retention
```

Post-update checks:

```text
The admin console contains a read-only Production Proof workspace at /admin/production-proof.
The user build output does not contain the production-proof route, nav key, or page content.
Production `v0.5.7` is live after the online update runner hardening release. Current proof progress is still `12/13`, but the remaining proof count is now `1`: Lsky confirmed deletion/provider cleanup.
Production `v0.5.3` showed the production DB backup/restore drill as verified in the read-only proof workspace and is now task `#61` rollback backup.
Production Lsky proof script is deployed at `server/dist/scripts/lsky-production-proof.js`. Latest read-only proof `lsky-upload-delete-proof-2026-06-25T10:26:54.133Z` confirmed config present, API v2 host `kkksr.com`, group endpoint HTTP 200, existing Lsky attachment count 0, and `/api/v2/user/photos?page=1&per_page=1` HTTP 403 with token-permission denial. Previous upload proof preserved a numeric providerFileId, but cleanup remains unproven.
Official Lsky Pro+ API docs confirm `DELETE /api/v2/user/photos` expects a JSON numeric ID array and returns HTTP 204 on successful deletion. The current production code matches this endpoint/body shape. A later production DB-only known-ID search `lsky-db-known-id-readonly-search-2026-06-25T04:54:26.080Z` found `attachmentCount=0` and no Lsky providerFileId in matched business log rows, so there is no safe persisted proof image ID to delete from the app side.
Current code review confirms there is no safe no-upload/no-known-ID deletion proof path: `deleteTicketImageFromLsky()` requires a numeric Lsky v2 provider ID before it sends `DELETE /api/v2/user/photos`, and the proof script refuses commit mode while `/api/v2/user/photos` returns HTTP 403. Do not probe production with guessed IDs, empty delete arrays, or invalid-ID delete requests.
Production DB backup/restore drill is now proven through a temporary database restore and cleanup check.
Production Incus lifecycle is now proven on dedicated test instance #9: stop task #5, start task #6, restart task #7, recreate task #8, delete cleanup, DB status deleted, Incus object not found, and host CPU/memory/disk resources returned to baseline.
Telegram delivery is proven by production bot message #339 to public group @Payincus.
Turnstile/session browser smoke is proven through the approved temporary disable-and-restore path: user /dashboard and admin /admin/production-proof rendered after login, config restored, temp secret file removed, and test users #31/#32 banned.
SMTP provider reference is proven by production send-test proof `smtp-provider-reference-2026-06-25T04:34:51.773Z`: recipient domain `qq.com`, provider reference `35bd2e0d-e817-1e31-ffde-de033e861c7e@qq.com`, accepted=1, rejected=0, pending=0, response `250 OK: queued as.`.
Remaining production proof is still incomplete: Lsky confirmed deletion/provider cleanup.
Current follow-up: configure a delete-capable Lsky token or use provider-side cleanup before commit-mode proof; previous proof images may still need cleanup. Once that is available, run `LSKY_PROOF_COMMIT=1 ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js` and prove `DELETE /api/v2/user/photos` returns success/204 for its numeric provider ID.
```

Local gates run for `v0.5.3`:

```text
bash -n scripts/production-db-restore-drill.sh
pnpm --filter server test:production-proof-center-guards
pnpm --filter client type-check
pnpm --filter client build
pnpm --filter server test:frontend-route-guards
pnpm --filter server test:frontend-dist-boundary-guards
pnpm --filter server type-check
pnpm --filter server build
pnpm docs:changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The previous `v0.5.3` release chain was verified locally by the targeted guards, client/server build/type-check, docs version-log generation, docs build, diff hygiene, remote main/tag refs, public Release artifact availability, GitHub Build & Release/CI/Pages success, and production deployment/readiness proof. Final production acceptance still remains pending until the remaining real business proofs are captured.

Local gates run for `v0.5.4`:

```text
pnpm --filter server test:production-proof-center-guards
pnpm --filter client type-check
pnpm --filter client build
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The latest release chain was refreshed for `v0.5.4`: GitHub Build & Release/CI/Pages succeeded, production OTA task `#61` completed successfully, public user/admin health checks passed, docs version-log pages contain `v0.5.4`, and server-side admin dist grep confirmed the live production-proof chunk contains the new `12/13` progress plus SMTP/Lsky remaining-proof wording.

Local gates run for `v0.5.6`:

```text
pnpm --filter server test:lsky-production-proof-guards
pnpm --filter server test:ticket-image-security
pnpm --filter server type-check
pnpm --filter server proof:lsky
pnpm --filter server build
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The latest release chain was refreshed for `v0.5.6`: GitHub Build & Release/CI/Pages succeeded, production OTA task `#63` completed successfully after running the official updater runner manually, public user/admin health checks passed, docs version-log pages contain `v0.5.6`, and production now includes the repeatable read-only/commit-mode Lsky proof script. The script remains in read-only preflight mode by default and refuses commit-mode upload while the configured Lsky token cannot list user photos.

Local gates run for `v0.5.7`:

```text
pnpm --filter server test:system-update-guards
pnpm --filter server type-check
pnpm --filter server build
pnpm --filter server test:lsky-production-proof-guards
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The `v0.5.7` release hardens the online update/rollback runner environment: systemd update units now set a stable PATH, the runner checks required commands before mutating state, child processes inherit the stable PATH, ownership repair avoids shell interpolation, and artifact copies no longer depend on shell `cp -a`. Public Release assets and docs version-log proof passed. Production task `#64` completed successfully after running the official updater runner manually from the previous `v0.5.6` release; public health, production readiness, split-host, DB readiness, Agent manifest, log/header exposure, deployed runner markers and deployed systemd PATH template markers passed.

Current commercial operation progress:

```text
12/12 categories have local feature coverage: commercial deployment/recovery, operations overview, order/payment operations, financial reconciliation, delivery assurance enhancement, SLA and alerting, customer success, user lifecycle, risk and audit, resource capacity and cost, plugin market governance, and production proof workspace.
Important caveat: final production proof is not complete until Lsky confirmed deletion/provider cleanup is collected and recorded.
```

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
- `v0.2.4`: balance adjustment approval flow.
- `v0.2.5`: OTA download cache cleanup, disk-space preflight and atomic release pruning safeguards.
- `v0.2.6`: commercial operations overview.
- `v0.2.7`: order payment operations workflow.
- `v0.2.8`: financial reconciliation workflow.
- `v0.2.9`: delivery assurance operations workflow.
- `v0.3.0`: SLA alert center.
- `v0.3.1`: customer success ticket workspace.
- `v0.3.2`: user lifecycle operations center.
- `v0.3.3`: AI ticket takeover safeguards.
- `v0.3.4`: AI ticket reply confidence checks.
- `v0.3.5`: plugin asset hardening and benefits localization.
- `v0.3.6`: risk audit logging center.

Latest production proof:

- Production OTA task `#36` updated production from `v0.2.4` to `v0.2.5`, ended with status `success`, and switched `/opt/incudal/current` to `/opt/incudal/releases/v0.2.5-20260624122951`.
- Server-side `v0.2.5` symlink/version proof was captured after OTA. `version.json` reported version/tag `v0.2.5`, commit `49959a2e76c2`, build time `2026-06-24T12:26:34.260Z`, deployed at `2026-06-24T12:30:00.233Z`, and changelog `Harden OTA cleanup and disk preflight / 加固 OTA 清理与磁盘预检`.
- Update task `#36` used OTA artifact `incudal-v0.2.5-linux-amd64.tar.gz`, downloaded `89922287` bytes, verified SHA256 `0882b2854fc146c0a333930256617505769e92e38e92fcc0985c5eb536141005`, found no pending migrations, switched `/opt/incudal/current`, restarted `incudal-backend`, reached backend health on the second attempt, passed live `verify-split-host`, `pnpm verify:production`, and `pnpm verify:log-header`.
- Production database proof for task `#36` reported status `success`, `fromVersion=v0.2.4`, `targetVersion=v0.2.5`, `backupPath=/opt/incudal/releases/v0.2.4-20260624115836`, no error message, started at `2026-06-24T12:29:51.674Z`, and finished at `2026-06-24T12:31:28.467Z`.
- Production `/opt/incudal/current/server/dist/scripts/run-system-update-task.js` now contains the `SYSTEM_UPDATE_MIN_FREE_MB`, `SYSTEM_UPDATE_RELEASES_KEEP`, Chinese disk-space error, and `cleanupOldReleases` markers. This means the cleanup/preflight behavior is deployed and will be used by the next online update task. Task `#36` itself was launched by the previous `v0.2.4` updater, so it does not show the new cleanup log lines.
- Public post-OTA proof for `v0.2.5` passed: `https://pay.payincus.com/api/health` and `https://admin.payincus.com/api/health` returned HTTP 200, `https://admin.payincus.com/admin/system-update` returned HTTP 200 with production security headers, and public docs version-log pages `https://payincus.com/release/version-log.html` plus `https://payincus.com/en/release/version-log.html` contain `v0.2.5`.
- A manual attempt to query and clean `/opt/incudal/.incudal-update-downloads` after OTA hit repeated SSH connection closures. The last successful disk snapshot before that attempt showed `/` at `30G/40G` used with `8.1G` available, `.incudal-update-downloads` at `930M`, and `/opt/incudal/releases` at `9.4G`. Avoid rapid repeated SSH connections; use one longer session or wait before retrying operational cleanup checks.
- Production OTA task `#35` updated production from `v0.2.3` to `v0.2.4`, ended with status `success`, and switched `/opt/incudal/current` to `/opt/incudal/releases/v0.2.4-20260624115836`.
- Server-side `v0.2.4` symlink/version proof was captured during OTA. `version.json` reported version/tag `v0.2.4`, commit `0eb2178f76d4`, deployed at `2026-06-24T11:58:42.874Z`, and changelog `Add balance adjustment approval / 新增调账审批流`.
- Update task `#35` used OTA artifact `incudal-v0.2.4-linux-amd64.tar.gz`, downloaded `89919195` bytes, verified SHA256 `6a4f9551fe3b5abde60bded0e672f1c1a4f0a09babd49b7fc66326ee757dd6b8`, applied migration `20260624193000_add_balance_adjustment_requests`, switched `/opt/incudal/current`, restarted `incudal-backend`, reached backend health on the second attempt, and passed live `verify-split-host` before the proof command tail.
- Operational note: task `#33` first failed because the root filesystem was full while PostgreSQL applied the migration. OTA temp downloads under `/opt/incudal/.incudal-update-downloads` were cleaned, freeing about 9 GB. Task `#34` then hit Prisma `P3009` because the failed migration row remained. The database had no partial table or enum residue, so `prisma migrate resolve --rolled-back 20260624193000_add_balance_adjustment_requests` was applied before task `#35`.
- Final database proof for migration `20260624193000_add_balance_adjustment_requests` shows one rolled-back failed row and one finished successful row, which is expected after the failed disk-space attempt and retry.
- Public post-OTA proof for `v0.2.4` passed: `https://pay.payincus.com/api/health` and `https://admin.payincus.com/api/health` returned HTTP 200, `https://admin.payincus.com/admin/orders` returned HTTP 200, anonymous `https://admin.payincus.com/api/balance/admin/adjustment-requests` returned HTTP 401, and the public admin bundle contains the new `adjustment-requests` API marker.
- A redacted server-side `PROOF_SINCE_HOURS=72 pnpm verify:production-proof-snapshot` emitted observational proof for two online hosts, two fresh online Agents, two ZFS storage pools, five running instances, one completed recharge/callback, SMTP/Lsky config presence, zero notification channels/logs, and missing lifecycle actions `instance.start`, `instance.restart`, `instance.recreate`, and `instance.delete`. The SSH session was manually interrupted after JSON output stopped, so treat it as observational evidence rather than a clean command-exit proof.
- Production `/opt/incudal/current/server/package.json` reports `update:online:start` as `node dist/scripts/start-system-update-task.js`.
- Production Nginx roots now point at `/opt/incudal/current/client/dist/user` and `/opt/incudal/current/client/dist/admin`, so frontend static assets follow atomic OTA releases.
- Public `https://admin.payincus.com/admin/plugins` returns HTTP 200 and current admin JS assets contain `/admin/plugins`, `插件中心`, and `admin-instance-detail` markers.
- Latest public non-auth recheck passed: live health endpoints, protected adjustment-request API 401 protection, admin order page HTTP 200, docs TLS, `v0.2.4` release assets, public admin bundle marker scan, and public root/API security headers.
- Public header checks on `https://pay.payincus.com/`, `https://admin.payincus.com/`, `https://pay.payincus.com/api/health`, and `https://admin.payincus.com/api/health` returned HSTS, CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- `v0.1.8` public release asset availability was verified directly. GitHub Actions API polling hit an anonymous rate limit during that check, so the latest fully recorded Actions run IDs in this handoff remain the earlier `v0.1.6` chain.
- Docs apex DNS is still incomplete for resilience: public resolvers currently return only A `185.199.108.153` and AAAA `2606:50c0:8000::153` for `payincus.com`, not the full recommended GitHub Pages record set.
- Full-function audit progress is `12/13` categories complete, current category `13/13` is `12/13` items complete (`92%`). Remaining production blocker is a business-proof/provider blocker, not a deployment blocker: Lsky confirmed deletion/provider cleanup.

Previous `v0.5.4` release proof:

- `v0.5.4` was tagged from commit `bbae57c Update production proof workspace status`.
- Version-log commit `f630dac Update version log for v0.5.4` is current `payincus/main`.
- GitHub Release `v0.5.4` is public and has OTA manifests, linux amd64/arm64 tarballs, both `.sha256` files, and plugin market assets.
- Public `ota-manifest.json` reports version `v0.5.4`, commit `bbae57c1b6dd`, linux amd64 SHA256 `2b704ea790a69bb87a5467bd8b5bdc7e6d7b6031688d82f1bd606c74d4919b91`, and amd64 size `90274617`.
- GitHub Actions proof: Build & Release run `28146079848`, CI run `28146077728`, and GitHub Pages run `28146077726` completed successfully.
- Production OTA task `#61` updated `v0.5.3 -> v0.5.4`, ended `success`, switched `/opt/incudal/current` to `/opt/incudal/releases/v0.5.4-20260625040931`, and `version.json` reports commit `bbae57c1b6dd`, build time `2026-06-25T04:07:16.302Z`, deployed at `2026-06-25T04:09:41.074Z`.
- OTA task `#61` log recorded backend health, split-host, production readiness, DB readiness, Agent manifest, log/header secret scan, OTA cache cleanup, release retention/prune, and `System update completed successfully`.
- Public follow-up checks returned HTTP 200 for user/admin `/api/health`; docs version-log pages contain `v0.5.4`; server-side admin dist grep confirmed the live production-proof chunk contains the new `12/13` progress, SMTP/Lsky remaining wording, Telegram proof wording, and Turnstile disable-and-restore wording.
- `v0.2.5` was tagged from commit `49959a2 Harden OTA cleanup and disk preflight / 加固 OTA 清理与磁盘预检`.
- Version-log commit `4ae29d8 Update version log for v0.2.5 / 更新 v0.2.5 版本日志` is current `payincus/main`.
- GitHub Release `v0.2.5` is public and has the OTA manifest, versioned manifest, linux amd64/arm64 tarballs, and both `.sha256` files.
- Public `ota-manifest.json` reports version `v0.2.5`, two artifacts, linux amd64 SHA256 `0882b2854fc146c0a333930256617505769e92e38e92fcc0985c5eb536141005`, and linux arm64 SHA256 `5528a13063e305a962ad005887d1c8342906f8d82fc484e19a04a8042a1c913d`.
- GitHub Actions proof: Build & Release run `28098233274` completed successfully for tag `v0.2.5`, CI run `28098230303` completed successfully for main commit `4ae29d8`, and GitHub Pages run `28098230219` completed successfully for main commit `4ae29d8`.
- Public docs version-log pages `https://payincus.com/release/version-log.html` and `https://payincus.com/en/release/version-log.html` contain `v0.2.5`.
- Production has OTA task `#36` deployment proof, public health/admin/docs proof, and server-side `version.json` proof recorded above.
- `v0.2.4` was tagged from commit `0eb2178 Add balance adjustment approval / 新增调账审批流`.
- Version-log commit `a7de735 Update version log for v0.2.4 / 更新 v0.2.4 版本日志` is current `payincus/main`.
- GitHub Release `v0.2.4` is public and has the OTA manifest, versioned manifest, linux amd64/arm64 tarballs, and both `.sha256` files.
- Public `ota-manifest.json` reports version `v0.2.4`, commit `0eb2178f76d4`, two artifacts, and changelog `Add balance adjustment approval / 新增调账审批流`.
- Public docs version-log pages `https://payincus.com/release/version-log.html` and `https://payincus.com/en/release/version-log.html` contain `v0.2.4`.
- Production has OTA task `#35` deployment proof, public health/API-boundary/admin-bundle proof, and server-side `version.json` proof recorded above.

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

Official AI plugin market proof:

- Commit: `92cda32 Publish AI ticket plugin market assets / 发布 AI 工单插件市场资产`
- Tag: `v0.3.8`
- GitHub Actions Build & Release run: `28119821316`
- CI run: `28119818074`
- Docs Pages run: `28119818054`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.3.8`
- Release assets include:
  - `payincus-plugin-ai-ticket-agent-0.1.0.tar.gz`
  - `payincus-plugin-ai-ticket-agent-0.1.0.tar.gz.sha256`
  - `payincus-plugin-ai-ticket-agent-0.1.0.manifest.json`
  - `plugin-market-index.json`
- Release plugin package SHA256: `5c00745af7c3371ec1dd9ac4a1385c8062b612998c73ec0ea8289432f200b71d`
- Production OTA task: `#48`, `v0.3.7 -> v0.3.8`, completed successfully.
- Production plugin market index URL is configured to `https://github.com/VipMaxxxx/payincus/releases/download/v0.3.8/plugin-market-index.json`.
- Production server-side market proof returned one plugin id: `com.payincus.ai-ticket-agent`.
- User can now open `/admin/plugins`, switch to "插件市场", refresh the market, and install `AI Ticket Agent`.

Official AI plugin Chinese UI proof:

- Commit: `f009c7e Localize AI plugin settings UI / 中文化 AI 插件设置界面`
- Tag: `v0.3.9`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.3.9`
- Release assets include `payincus-plugin-ai-ticket-agent-0.1.1.tar.gz`, `.sha256`, `.manifest.json`, and `plugin-market-index.json`.
- Market index proof returned `AI 工单助手@0.1.1` with SHA256 `b378b0bfa16e2b7499267229d90223638a725ec6524430fc283ff3eb0df4aa23`.
- Production OTA task: `#49`, `v0.3.8 -> v0.3.9`, completed successfully.
- Production version file reports `v0.3.9`, git commit `f009c7e01b5a`.
- Production plugin market index URL has been updated in `.env` to `https://github.com/VipMaxxxx/payincus/releases/download/v0.3.9/plugin-market-index.json`, and backend health passed after restart.
- Admin plugin center now:
  - displays the known AI plugin as `AI 工单助手` even when an older installed manifest still has English text;
  - shows Chinese description and permission labels;
  - links enabled plugins with `admin.plugins.settings` to standalone settings routes;
  - no longer embeds the settings iframe or raw config JSON in the plugin center detail panel.

Official AI plugin standalone settings proof:

- Commit: `b4d4cce Add standalone plugin settings pages / 新增独立插件设置页`
- Tag: `v0.4.0`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.4.0`
- Production version file reports `v0.4.0`, git commit `b4d4cce11319`.
- Admin sidebar dynamically loads enabled plugins that declare `admin.plugins.settings` and inserts the settings entry after `插件中心`.
- `AI 工单助手` now opens as `/admin/plugins/com.payincus.ai-ticket-agent/settings`.
- The standalone page provides Chinese business controls for enablement, takeover mode, OpenAI-compatible model URL, model name, API key, temperature, timeout, auto-reply categories, confidence threshold, limits, cooldown, AI identity disclosure and custom system prompt.
- Leaving the API key blank keeps the stored encrypted secret unchanged.
- Production admin assets contain the standalone page markers `自动回复策略`, `OpenAI 兼容接口地址`, `模型 API Key`, and `留空则保持不变`, and no longer contain `配置 JSON` or `套用默认模板`.

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
- Interpretation: real payment callback, Agent heartbeat/report, resource/instance/traffic reporting, Incus create, stop, start, restart, rebuild, recreate, delete/cleanup, NAT port add, storage, and Web terminal connect/disconnect are now live-proven.

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

Remaining production proof item:

- Real Lsky confirmed deletion/provider cleanup.

Optional follow-up if final acceptance scope expands:

- Real suspend/unsuspend, IPv6, and host migration smoke.
- Additional plugin iframe rendering proof once a real enabled plugin exists.

## Current Server Access Note

Password-authenticated SSH was available again during the 2026-06-25 proof pass. A read-only recheck at `2026-06-25T03:57:08.849Z` confirmed Turnstile restored, temp secret file removed, and temporary test users banned.

SSH has still been intermittently closed by the remote service during non-interactive commands. A 2026-06-25 09:34 UTC retry closed before command execution, but a later 2026-06-25 10:00 UTC retry succeeded: `/opt/incudal/current` still pointed to `v0.5.6`, and the read-only Lsky preflight ran but still returned HTTP 403 for `/api/v2/user/photos`. Prefer short read-only commands or an interactive shell for production proof, and never paste server passwords into handoff notes.

Safe proof paste template for the user:

```text
Proof date/time:
Production version:
Test actor: admin or test user only

Incus lifecycle:
- test instance ID/name: #9 / production-proof-20260625031054
- host name: #2 HKCMI-01
- actions completed: stop / start / restart / recreate / delete / cleanup
- task or log IDs: tasks #5-#8; operation logs #276-#284
- final instance/resource state: DB status deleted; Incus object u26-qf9iaavw not found; CPU/memory/disk returned to baseline; NAT count recalculated to 5

SMTP:
- proof ID: smtp-provider-reference-2026-06-25T04:34:51.773Z
- recipient domain: qq.com
- backend/admin status: accepted=1, rejected=0, pending=0
- provider response: 250 OK: queued as.

Lsky:
- preflight proof ID:
- commit proof ID:
- test ticket/message/attachment IDs:
- upload/delete status:
- safe provider ID summary:
- cleanup result:

Telegram / notification:
- channel name or ID: public group @Payincus
- send timestamp: 2026-06-25T03:30:52.670Z proof ID
- backend log/status: production Telegram bot sendMessage.ok=true
- external receipt reference: Telegram message #339, bot username Payincus_bot

Turnstile/browser:
- user login page proof reference: temporary test user #31, user /dashboard rendered with marker "实例"
- admin login page proof reference: temporary test admin #32, admin /admin/production-proof rendered with marker "生产验收"
- pages opened after login: https://pay.payincus.com/dashboard and https://admin.payincus.com/admin/production-proof
- refresh/session note: approved temporary disable-and-restore; Turnstile restored enabled=true with secret present, temp secret file removed, users #31/#32 banned
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

1. Keep local Git synced with remote `payincus/main`; before this handoff refresh, the tracked baseline is `233cfe6`.
2. Continue commercial operation target 12 from `docs/commercial-operation-task-goals.md`; commercial operation is 12/12 categories with 100% local function coverage, while production proof is now 12/13 items, 92%.
3. Treat `v0.5.7` production deployment/readiness as the latest proven production deployment from the 2026-06-25 SSH proof: `/opt/incudal/current -> /opt/incudal/releases/v0.5.7-20260625102424`, version commit `d470e7b36925`, deployed at `2026-06-25T10:24:32.529Z`, production readiness/DB/split-host/Agent manifest/log-header passed, and OTA task `#64` completed successfully.
4. Current latest-production boundary: `v0.5.7` is live and proven. Lsky cleanup is still not proven because the configured production Lsky token returned HTTP 403 for the documented user-gallery list API, and the production DB/log known-ID search did not find a safe persisted proof image ID to delete.
5. Treat the core Incus lifecycle as proven on a dedicated test instance: #9 on host #2 completed stop/start/restart/recreate/delete cleanup, and existing proof already covers create, rebuild, terminal connect/disconnect, NAT port add, storage, Agent reports, and traffic. Only run suspend/unsuspend, IPv6, or host-migration smoke if these remain in final acceptance scope.
6. Complete delivery proof: SMTP provider reference is proven by `smtp-provider-reference-2026-06-25T04:34:51.773Z`; Telegram delivery is proven by message `#339` to `@Payincus`; Lsky still needs a delete-capable token or provider-side cleanup before commit-mode proof. The target endpoint is `DELETE /api/v2/user/photos` with a JSON numeric ID array; do not use guessed IDs or invalid/empty delete probes as proof.
7. Treat production DB backup/restore drill as proven: `scripts/production-db-restore-drill.sh` created a `601026` byte custom dump, restored it into temporary database `incudal_restore_drill_20260625023234_126219`, validated public table/migration/user/instance/update-task counts, removed the temp workdir, and `pg_database` returned `0` for the temp DB afterward.
8. Treat the approved temporary Turnstile disable-and-restore smoke as proven unless final acceptance specifically requires a human-solved Cloudflare challenge UX.
9. After the remaining proof is complete, run `pnpm verify:live-acceptance` with real live proof references. For the Lsky proof, first run read-only preflight with `ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js`; only after it can access user photos, run commit mode with `LSKY_PROOF_COMMIT=1 ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js`. Only run `pnpm verify:final-acceptance` with the approved disable-and-restore auth smoke reference, or with an additional human-solved Turnstile reference if final acceptance scope requires it.
10. If creating an additional ZFS pool still fails, fix or avoid ZFS on that Incus host; the existing `default` ZFS pool already lists through Incus.
11. Decide whether to continue improving docs:
   - Page-by-page admin field explanations.
   - User workflow screenshots.
   - API request/response/error reference.
   - Payment provider setup guide.
   - Agent install guide with real host commands.
12. Complete remaining real production proof items from `docs/production-audit.md`.
13. When a real production proof is completed, update `docs/production-audit.md` with exact date, command/evidence, and outcome.

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
