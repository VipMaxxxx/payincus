# PayIncus Handoff

Last updated: 2026-06-28 CST

This file is a handoff note for a new Codex conversation. Do not include server passwords or other secrets in this file.

## Repository

- Local path: `/Users/max/Documents/incudal`
- Main product repository: `git@github.com:VipMaxxxx/payincus.git`
- Current local branch: `master`
- Target remote branch: `payincus/main`
- Repository history: default branch was rebuilt as an independent PayIncus baseline on 2026-06-27; a local mirror backup was kept for private audit traceability.
- Public documentation source: `docs-site/docs`
- Note: the old private `docs/production-audit.md`, `docs/full-function-audit.md`, and `docs/commercial-operation-task-goals.md` files are not present in the current tracked checkout. Treat the current worktree, `HANDOFF.md`, generated version logs, tests, and production/live proof output as authoritative.

## Current Git State

Use `git log --oneline --decorate -5` as the authoritative current HEAD because this handoff may receive handoff-only commits after product releases. The latest product/docs release baseline at the time of this refresh was:

```text
09670ad Release v1.0.3 package delivery hotfix
```

GitHub remote `payincus/main` should be aligned with the current local HEAD after each handoff-only refresh. Use `git status --short --branch` and `git ls-remote payincus refs/heads/main` as the source of truth instead of copying this note forward.

The current local tree should be clean after pulling `payincus/main`. Do not reset if new local changes appear; inspect them first.

Latest product/docs release boundary at the time of this refresh:

```text
09670ad Release v1.0.3 package delivery hotfix
```

## Latest GitHub Release Work

`v1.0.3` is published on GitHub, has release artifacts, and has been applied to production through the online update flow.

Release commits:

```text
e41c909 Fix admin risk evidence drawer background
6fb574b Release v0.9.7
50b4f9a Update version log for v0.9.7
a69542b Release v0.9.8
e64ad2c Release v0.9.9
105e980 Update version log for v0.9.9
0836203 Release v1.0.2 welfare check-in
b701d32 Update version log for v1.0.2
09670ad Release v1.0.3 package delivery hotfix
```

GitHub workflow proof:

```text
Build & Release: run 28291236823 completed success
CI: run 28291235509 completed success
Docs Pages: run 28291235507 completed success for the v0.9.7 version-log push.
Build & Release: run 28292114337 completed success for v0.9.8.
CI: run 28292112976 completed success for a69542b.
Docs Pages: run 28292112956 completed success for a69542b.
Build & Release: run 28292774371 completed success for v0.9.9.
CI: run 28292773068 completed success for e64ad2c.
Docs Pages: run 28292773057 completed success for e64ad2c.
Build & Release: run 28312345559 completed success for v1.0.2.
CI: run 28312344323 completed success for main.
Docs Pages: run 28312344320 completed success for main.
Build & Release: run 28313257102 completed success for v1.0.3.
CI: run 28313256856 completed success for main.
Docs Pages: run 28313256855 completed success for main.
```

Core release assets verified for `v0.9.9`:

```text
incudal-v0.9.9-linux-amd64.tar.gz
incudal-v0.9.9-linux-amd64.tar.gz.sha256
incudal-v0.9.9-linux-arm64.tar.gz
incudal-v0.9.9-linux-arm64.tar.gz.sha256
incudal-v0.9.9-ota-manifest.json
ota-manifest.json
```

Core release assets verified for `v1.0.2`:

```text
incudal-v1.0.2-linux-amd64.tar.gz
incudal-v1.0.2-linux-amd64.tar.gz.sha256
incudal-v1.0.2-linux-arm64.tar.gz
incudal-v1.0.2-linux-arm64.tar.gz.sha256
incudal-v1.0.2-ota-manifest.json
ota-manifest.json
```

Core release assets verified for `v1.0.3`:

```text
incudal-v1.0.3-linux-amd64.tar.gz
incudal-v1.0.3-linux-amd64.tar.gz.sha256
incudal-v1.0.3-linux-arm64.tar.gz
incudal-v1.0.3-linux-arm64.tar.gz.sha256
incudal-v1.0.3-ota-manifest.json
ota-manifest.json
```

The current `v0.9.9` bundle includes the `v0.9.0` commercial-operation baseline plus the follow-up OTA/smoke/UI/capacity hardening:

- `v0.9.1`: split auth smoke now runs from production artifacts through `dist/scripts/smoke-split-auth.js`.
- `v0.9.2`: split auth smoke is Turnstile-aware; without `SMOKE_TURNSTILE_TOKEN`, it treats enforced Turnstile as a protected login proof and skips the login-chain portion instead of failing the OTA.
- `v0.9.3`: OTA update and rollback workers use atomic task-claim guards to avoid duplicate workers mutating the same task.
- `v0.9.4`: duplicate OTA workers close the Prisma database connection before returning, so skipped duplicate oneshot services exit cleanly instead of hanging.
- `v0.9.5`: global `bg-themed-surface` now has solid light/dark backgrounds, fixing transparent admin risk evidence drawers and other themed cards; generated version logs filter handoff/version-log sync commits from user-facing unreleased changes.
- `v0.9.6`: public package sold-out checks now include disk capacity, keeping market availability aligned with backend instance creation checks; production readiness warnings and docs now describe CPU, memory, and disk capacity requirements.
- `v0.9.7`: admin resource-risk evidence drawer now renders above admin chrome with solid light/dark backgrounds for the drawer, snapshot cards, tables, and JSON evidence blocks.
- `v0.9.8`: resource-risk evidence drawer uses scoped opaque panel/surface/code backgrounds that survive admin theme CSS and Tailwind output changes; production readiness now makes empty payment callback IP whitelist warnings explicit about the still-required signature, status, amount and idempotency checks, and DB readiness identifies active providers without built-in callback IP defaults.
- `v0.9.9`: public installer, local environment initializer, atomic OTA migration and live acceptance report now use PayIncus public branding while preserving `/opt/incudal`, the `incudal` system user, the `incudal-backend` service name and artifact names for runtime/OTA compatibility; split-deploy guard coverage prevents old public-facing Incudal titles from returning.

The `v0.9.0` commercial-operation baseline includes:

- Integration Center: admin entry, backend health-check routes, persisted health history, and docs coverage for SMTP, Lsky, Telegram, payment providers, global notifications, remote storage, Agent/Incus, OTA, extension market, and theme market.
- Billing and payment operations: manual recharge provider flow, payment-provider secret handling guards, plugin gateway refund workbench, refund reconciliation cases, and safer payment detail redaction.
- Delivery and plan-upgrade hardening: delivery-center guard updates, plan upgrade capacity guard updates, and plan-upgrade sync repair service.
- Extension Center hardening: high-risk capability review records, enablement blocking for unapproved high-risk capabilities, capability review docs, market submission UI guard updates, and runtime capability guard updates.
- Resource risk operations: pagination and source-scoped order restriction work from `v0.8.9` remain the production baseline; current docs and guard coverage continue to reflect that behavior.
- Split deployment/docs: README and docs-site now emphasize split user/admin domains, empty `COOKIE_DOMAIN`, `/api` proxying, production proof refs, and `INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus`.

Local validation already completed for this candidate:

```text
v0.9.1:
  pnpm --filter server test:split-deploy-config  passed
  pnpm --filter server type-check                passed
  pnpm --filter server build                     passed
  pnpm build                                     passed
  pnpm --dir docs-site --ignore-workspace build  passed
v0.9.2:
  pnpm --filter server test:split-deploy-config  passed
  pnpm --filter server type-check                passed
  pnpm --filter server build                     passed
  pnpm build                                     passed
  pnpm --dir docs-site --ignore-workspace build  passed
v0.9.3:
  pnpm --filter server test:system-update-guards passed
  pnpm --filter server type-check                passed
  pnpm --filter server build                     passed
  pnpm build                                     passed
  pnpm --dir docs-site --ignore-workspace build  passed
v0.9.4:
  pnpm --filter server test:system-update-guards passed
  pnpm --filter server type-check                passed
  pnpm --filter server build                     passed
  pnpm build                                     passed
  pnpm --dir docs-site --ignore-workspace build  passed
v0.9.5:
  pnpm build                                      passed
  pnpm --filter server test:frontend-dist-boundary-guards passed
  pnpm --filter server test:frontend-route-guards          passed
  pnpm --dir docs-site --ignore-workspace build            passed
v0.9.6:
  pnpm --filter server test:package-soldout-capacity-guards passed
  pnpm --filter server type-check                            passed
  pnpm build                                                 passed
  pnpm --dir docs-site --ignore-workspace build              passed
v0.9.7:
  pnpm --filter client type-check                            passed
  pnpm --filter server type-check                            passed
  pnpm build                                                 passed
  pnpm --dir docs-site --ignore-workspace build              passed
v0.9.8:
  pnpm --filter server test:resource-risk-guards             passed
  pnpm --filter server test:split-deploy-config              passed
  pnpm --filter server type-check                            passed
  pnpm --filter client type-check                            passed
  pnpm --filter client build                                 passed
  pnpm build                                                 passed
  pnpm --dir docs-site --ignore-workspace build              passed
v0.9.9:
  pnpm --filter server test:split-deploy-config              passed
  bash -n scripts/install-panel.sh scripts/migrate-ota-atomic-layout.sh scripts/init-env.sh scripts/verify-live-acceptance.sh passed
  pnpm --filter server type-check                            passed
  pnpm build                                                 passed
  pnpm --dir docs-site --ignore-workspace build              passed
```

Remaining before calling the whole commercial-operation objective complete:

- Current `v1.0.0` production OTA is complete and verified. `v0.9.4` final-acceptance proof remains the latest full live proof report; `v1.0.0` passed OTA production checks.
- `DEBGP` production capacity warning was closed operationally on 2026-06-27 by setting package `#3` (`DEBGP`) `active=false`; package data and host binding were preserved for later re-enable after capacity is added.
- `PAYMENT_CALLBACK_IP_WHITELIST` remains empty by operator decision. Production `.env` now sets `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`, so production readiness records this as an explicit no-fixed-source-IP policy while keeping `PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false` and preserving signature/status/amount/idempotency requirements.
- `v1.0.0` hardens the host Agent against CPU/log pressure: default heartbeat 60s, minimum 30s, Incus state concurrency 3, 500-instance report cap, non-running instances skip `/state`, heartbeat log throttling, and generated `incudal-agent.service` CPU/memory/task/journal rate limits. Existing hosts must rerun the Agent installer after release to refresh old service templates. Production `/opt/incudal/agent-release` now serves Agent manifest `v1.0.0`; already-installed Agents can self-upgrade their binary, but systemd CPU/memory/journal limits still require rerunning the installer because the binary upgrade does not rewrite the unit file.
- With Turnstile enabled and no `SMOKE_TURNSTILE_TOKEN`, split auth smoke verifies Turnstile enforcement and skips the full login-chain smoke. Provide a valid Turnstile token if a full automated login-chain proof is required.
- Keep watching the high-risk surfaces touched by `v0.9.0`: Integration Center health checks, manual recharge, refund/reconciliation workbench, extension capability review blocking, delivery/plan-upgrade sync repair, and split user/admin login boundaries.

## v1.0.1 Release Summary

- Target version: `v1.0.1`.
- Scope: dedicated IPv4 and dedicated IPv4 + dedicated IPv6 delivery, host public IPv4 IPAM, package network mode cleanup, and consistent resource rollback.
- IPv6 NAT is intentionally not a new target capability. `nat_ipv6_nat` and `ipv6_nat` remain only for legacy data compatibility.
- Local validation completed:
  - `DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/payincus' pnpm --filter server exec prisma generate` passed.
  - `pnpm --filter server type-check` passed.
  - `pnpm --filter client type-check` passed.
  - `pnpm --filter server test:host-install-script-guards` passed.
  - `pnpm --filter server test:instance-create-failure-compensation` passed.
  - `pnpm --filter server test:package-input-guards` passed.
  - `pnpm build` passed.
  - `pnpm --dir docs-site --ignore-workspace build` passed.
- GitHub checks completed:
  - Build & Release run `28295943739` passed for tag `v1.0.1`.
  - CI run `28295942451` passed for `main`.
  - Pages run `28295942452` passed for `main`.

## v1.0.2 Release Summary

- Target version: `v1.0.2`.
- Scope: Welfare daily check-in now grants random points instead of resource-pool credits, admin check-in settings/logs, database-backed daily claim guard, and instance card network/quota markers.
- The daily claim guard uses `daily_checkins(user_id, date_key)` plus per-user points locking, so concurrent requests cannot double-claim the same Beijing calendar day.
- Local validation completed:
  - `DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/payincus' pnpm --filter server exec prisma generate` passed.
  - `pnpm --filter server type-check` passed.
  - `pnpm --filter client type-check` passed.
  - `pnpm --filter server test:entertainment-route-guards` passed.
  - `pnpm --filter server test:admin-entertainment-route-guards` passed.
  - `pnpm --filter server test:frontend-i18n-keys` passed.
  - `pnpm --filter server test:points-mutation-amount-guards` passed.
  - `DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/payincus' pnpm --filter server exec prisma validate` passed.
  - `pnpm --filter server test:frontend-dist-boundary-guards` passed.
  - `pnpm --filter client build` passed.
  - `pnpm --filter server build` passed.
  - `pnpm --dir docs-site --ignore-workspace build` passed.
- GitHub checks completed:
  - Build & Release run `28312345559` passed for tag `v1.0.2`.
  - CI run `28312344323` passed for `main`.
  - Pages run `28312344320` passed for `main`.

## v1.0.3 Release Summary

- Target version: `v1.0.3`.
- Scope: hosted package publish/unpublish controls, active package storage-pool binding hardening, Incus certificate path fallback after OTA, and Germany `DEBGP` production package recovery.
- Active packages now resolve each bound host to an `instance_data` storage pool before save/activation. Empty per-host storage selections fall back to the host's preferred system disk pool, prioritizing `default`; activation is blocked if no usable pool exists.
- Incus client and terminal proxy certificate reads now fall back from stale release-specific paths to the stable panel certificate directory under `/opt/incudal/server/certs` or configured panel certificate environment variables.
- Local validation completed:
  - `pnpm --filter server test:incus-certificate-paths` passed.
  - `pnpm --filter server test:package-input-guards` passed.
  - `pnpm --filter server test:package-host-type-guards` passed.
  - `pnpm --filter server test:frontend-i18n-keys` passed.
  - `pnpm --filter server type-check` passed.
  - `pnpm --filter client type-check` passed.
  - `pnpm --filter server build` passed.
  - `pnpm --filter client build` passed.
  - `pnpm docs:changelog` passed.
  - `pnpm --dir docs-site --ignore-workspace build` passed.
- GitHub checks completed:
  - Build & Release run `28313257102` passed for tag `v1.0.3`.
  - CI run `28313256856` passed for `main`.
  - Pages run `28313256855` passed for `main`.

## Latest Production OTA Proof

- Production version: `v1.0.3`
- Release tag commit: `09670ad88`
- Current production symlink: `/opt/incudal/current -> /opt/incudal/releases/v1.0.3-20260628060652`
- OTA task: `107`, status `success`; backup path `/opt/incudal/releases/v1.0.2-20260628052356`; log path `/opt/incudal/update-logs/system-update-107.log`.
- GitHub Release assets for `v1.0.3` are available, including linux amd64/arm64 tarballs, sha256 files, `incudal-v1.0.3-ota-manifest.json`, `ota-manifest.json`, AI ticket extension assets, and plugin market index.
- Production checks passed during and after OTA: split host verification, `pnpm verify:production`, health checks for user/admin/backend APIs, and Agent manifest check.
- Independent checks after OTA:
  - `https://pay.payincus.com/api/health` returned HTTP 200.
  - `https://admin.payincus.com/api/health` returned HTTP 200.
  - Local backend `http://127.0.0.1:3001/api/health` returned HTTP 200.
  - `package.json` under `/opt/incudal/current` reports `1.0.3`.
  - OTA log shows `System update completed successfully`.
  - Task `107` database row is `success` with `errorMessage=null`.
  - Production DB has `DEBGP` active, bound to host `DE-01` with `storage_pool_name=default`.
  - Production host certificate paths for `DE-01` point to `/opt/incudal/server/certs/client.crt` and `/opt/incudal/server/certs/client.key`.
  - Direct Incus storage-pool check against `DE-01` returned `/1.0/storage-pools/default`.
  - Public API `https://pay.payincus.com/api/packages/public?source=official` returns `DEBGP` with host id `6`.
  - Production DB contains `daily_checkins`.
  - Production system configs contain `checkin_enabled=true`, `checkin_min_points=1`, `checkin_max_points=500`, and `checkin_require_instance=false`.
  - Production DB contains `public_ipv4_pools` and `public_ipv4_addresses`.
  - `pnpm verify:production` on production passes and records the empty payment callback IP whitelist as an intentional policy because `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false` is set.
  - Online docs `https://payincus.com/release/version-log` and `https://payincus.com/en/release/version-log` should contain `v1.0.3` after the follow-up version-log handoff commit is deployed by Pages.
  - Deployed admin bundle contains `resource-risk-evidence-panel` and generated CSS with `background-color:#fff;opacity:1`, plus dark-mode opaque surface/code backgrounds.
- Production readiness currently logs one WARN: public package `#3` (`DEBGP`) is active but online bound hosts cannot satisfy its minimum CPU/memory/disk requirement. Storage-pool visibility and Incus connectivity are fixed; add Germany capacity or lower/package-disable the plan before relying on new paid orders.

Historical note:

- Duplicate-start verification on task `97` found the `v0.9.3` skipped-worker path could leave Prisma open and keep the systemd oneshot active. `v0.9.4` fixed that path and verified the duplicate service now exits cleanly.

## Latest Independence / Docs Release Work

`v0.8.8` rebuilt the public project identity and developer-facing release artifacts:

- Default branch history was rebuilt as an independent PayIncus baseline and force-pushed to `payincus/main`; local mirror backup: `/Users/max/Documents/payincus-history-backup-20260627143322.git`.
- Public README, docs site, deployment docs, extension center docs, theme docs, OAuth/Public API docs and release notes no longer reference the retired upstream project.
- `LICENSE` and package metadata now use PayIncus/VipMaxxxx ownership language.
- Public API TypeScript SDK and examples are tracked under `docs-site/docs/public/sdk`.
- Official extension templates and the clean theme template now track their `dist` and `docs` artifacts explicitly despite global `dist/` and `docs/` ignore rules.
- Release workflow wording is PayIncus-branded while keeping existing artifact names and `/opt/incudal` runtime paths for OTA compatibility.
- Local validation before release: server type-check, docs-site build, old-reference scan, system update guard, Public API OpenAPI/resource/SDK guards, OAuth Provider guard, extension runtime/package/template/market guards, theme guard, frontend i18n guard, agent install command guard.

Known follow-up:

- Superseded historical note: current production warning status is tracked in "Latest Production OTA Proof" above. Do not use this old v0.8.8 note as the current capacity source of truth.

## Latest Instance Upgrade Work

`v0.8.7` fixed paid instance plan upgrade resource and bandwidth consistency:

- User-side and admin-side plan upgrades now perform host capacity checks against the instance's current host before charging or updating the instance.
- Upgrade capacity checks use the resource delta between the current instance and target plan, then lock the host row with `FOR UPDATE` during the transaction to prevent concurrent over-allocation.
- CPU, memory, and disk are all checked; disk capacity now also participates in available-host filtering for new purchases.
- Plan upgrade transactions update host usage counters from projected aggregate usage, avoiding the previous post-upgrade counter increment pattern.
- Upgrades now update `limitsIngress` and `limitsEgress` in the database and call Incus bandwidth restore so the displayed bandwidth and actual instance bandwidth are aligned.
- User preview and admin upgrade plan lists expose `resourceCapacity` / `resourceWarnings`; unavailable upgrade targets are disabled in the admin modal.
- New guard coverage: `pnpm --filter server test:plan-upgrade-capacity-guards`.

## Latest Resource Risk Work

`v0.8.4` added the instance-scoped resource risk center:

- Collects bandwidth Mbps, PPS, packet deltas, and CPU usage samples from Incus traffic polling.
- Scores instances only; accounts are linked through the source instance and can be restricted from new orders/requires manual ticket review.
- Supports QoS tiers from the admin policy page, defaulting to 50 Mbps, 30 Mbps, and 10 Mbps thresholds.
- Supports CPU sustained usage, sustained bandwidth, packet anomaly, and small-packet scan suspicion signals.
- Supports automatic instance suspension when `autoSuspendEnabled` is enabled and score reaches `autoSuspendScore`; default is currently disabled to avoid first-rollout false positives.
- Adds user review ticket flow when `ORDER_RESTRICTED_BY_RISK` blocks instance creation.

`v0.8.5` hardened OTA:

- The OTA runner now explicitly runs `pnpm --filter server exec prisma generate` after `prisma migrate deploy` in artifact atomic, artifact legacy, and git fallback update paths.
- `server/scripts/test-resource-risk-guards.ts` now checks the key risk policy fields and auto-suspend/order-restrict service wiring.

`v0.8.6` added manual resource risk controls:

- Resource risk policy QoS tiers now use structured numeric rows instead of a CSV textarea; each row has level, bandwidth Mbps, and trigger score.
- Admins can manually limit a risky instance's bandwidth and optionally restrict the linked account from new orders.
- Admins can manually suspend or unsuspend an instance from the resource risk center; manual suspension writes risk events, updates the instance state, and can notify the user.
- Admins can manually restrict the linked account from ordering when a specific instance needs ticket review.
- Backend validation rejects invalid QoS tiers, invalid scores, missing manual reasons, and invalid manual bandwidth values.

`v0.8.9` refined the resource risk center operations UI:

- Instance, event, and order restriction tables now paginate at 10 rows per page and recover to the last valid page after row removal.
- Instance action buttons now reflect current state: suspended instances show unsuspend, active source-scoped restrictions show release order restriction, and unrelated account restrictions show a disabled account-restricted state.
- Manual order restriction release is now source-scoped. Releasing a restriction from one risk instance only releases that instance's active restriction record, and no longer presents every risky instance under the same account as independently releasable.
- Backend instance list now returns both the current instance's active order restriction and the linked account's newest active restriction so the UI can distinguish same-source and other-source account restrictions.

Recently updated/released files include:

```text
client/src/api/admin.ts
client/src/views/admin/ResourceRiskView.vue
server/src/routes/resource-risk.ts
server/scripts/test-resource-risk-guards.ts
package.json
client/package.json
server/package.json
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/views/admin/BillingView.vue
client/src/components/instance/modals/ChangePlanModal.vue
client/src/types/api.ts
client/src/api/admin.ts
server/src/db/hosts.ts
server/src/db/pagination.ts
server/src/db/billing-operations.ts
server/src/routes/instance-billing.ts
server/src/routes/admin-billing.ts
server/scripts/test-plan-upgrade-capacity-guards.ts
package.json
client/package.json
server/package.json
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/views/InstancesView.vue
client/src/components/layout/SideNav.vue
server/src/db/pagination.ts
server/src/routes/instances.ts
package.json
client/package.json
server/package.json
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/components/TurnstileWidget.vue
client/src/views/GiftCardsView.vue
server/src/db/gift-cards.ts
server/scripts/test-gift-card-flow.ts
server/scripts/test-gift-card-guards.ts
server/package.json
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/composables/useTurnstile.ts
client/src/views/admin/GiftCardsView.vue
server/src/routes/gift-cards.ts
server/scripts/test-gift-card-guards.ts
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/views/admin/SystemConfigView.vue
client/src/router/admin.ts
client/src/locales/zh-CN.ts
client/src/locales/zh-TW.ts
client/src/locales/en.ts
server/src/lib/runtime-settings.ts
server/src/db/system-config.ts
server/src/routes/system-config.ts
server/src/routes/system-update.ts
server/src/routes/gift-cards.ts
server/src/routes/admin-plugins.ts
server/src/routes/admin-themes.ts
server/src/routes/plugin-market-submissions.ts
server/src/routes/theme-market-submissions.ts
server/src/lib/plugin-market.ts
server/src/lib/theme-market.ts
server/src/lib/plugin-market-publisher.ts
server/src/lib/theme-market-publisher.ts
server/src/services/plugin-storage-backup-scheduler.ts
server/scripts/test-system-update-guards.ts
server/scripts/test-plugin-market-guards.ts
server/scripts/test-plugin-market-publish-guards.ts
server/scripts/test-plugin-market-submission-guards.ts
server/scripts/test-theme-system-guards.ts
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
client/src/views/TicketsView.vue
client/src/views/GiftCardsView.vue
client/src/views/admin/GiftCardsView.vue
server/src/routes/gift-cards.ts
server/src/db/gift-cards.ts
server/prisma/migrations/20260625210000_add_gift_cards/migration.sql
server/scripts/test-gift-card-guards.ts
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
v0.8.3 Instance bandwidth and billing nav display OTA
release commit/tag: 1a82f05 (v0.8.3)
version-log commit: 78640e4
previous production release: 4f5bb5e (v0.8.2)
versioning note: OTA tags now continue with carry at 10, e.g. 0.8.9 -> 0.9.0.
```

GitHub Actions:

```text
Build & Release for tag v0.8.3: public OTA manifest and amd64/arm64 artifacts are available.
CI for main commit 78640e4: pushed after version-log generation; local type-check/build gates passed.
Build & Release for tag v0.8.2: run 28276692386 completed successfully; public OTA manifest and amd64/arm64 artifacts are available.
CI for main commit ef43193: run 28276690725 was started by the version-log push; GitHub API later rate-limited unauthenticated status polling, but local type-check/build gates passed and Docs Pages run 28276690722 completed successfully.
Build & Release for tag v0.8.1: run 28275824753 completed successfully.
CI for main commit 4a131d7: run 28275823541 completed successfully.
Build & Release for previous tag v0.6.19: run 28274947080 completed successfully.
```

Release assets confirmed for `v0.8.3`:

```text
ota-manifest.json
incudal-v0.8.3-linux-amd64.tar.gz
incudal-v0.8.3-linux-amd64.tar.gz.sha256
incudal-v0.8.3-linux-arm64.tar.gz
incudal-v0.8.3-linux-arm64.tar.gz.sha256
incudal-v0.8.3-ota-manifest.json
```

Previous release assets confirmed for `v0.8.2`:

```text
ota-manifest.json
incudal-v0.8.2-linux-amd64.tar.gz
incudal-v0.8.2-linux-amd64.tar.gz.sha256
incudal-v0.8.2-linux-arm64.tar.gz
incudal-v0.8.2-linux-arm64.tar.gz.sha256
incudal-v0.8.2-ota-manifest.json
payincus-plugin-ai-ticket-agent-0.1.1.manifest.json
payincus-plugin-ai-ticket-agent-0.1.1.tar.gz
payincus-plugin-ai-ticket-agent-0.1.1.tar.gz.sha256
plugin-market-index.json
```

Published `v0.8.3` OTA manifest:

```text
version: v0.8.3
gitCommit: 1a82f05eca51
buildTime: 2026-06-27T03:24:06.930Z
amd64 artifact: incudal-v0.8.3-linux-amd64.tar.gz
amd64 size: 92391355
amd64 sha256: 4c5f3a3104e1a32cdef0276dd8fd2dca73b9387cb328cbdbf2c8fa576c22a910
arm64 artifact: incudal-v0.8.3-linux-arm64.tar.gz
arm64 size: 91478978
arm64 sha256: 2fb68a224d5f9e23fb172d5d39b747c0214cc0c61ac17bd2859aa107735fb1be
```

Production OTA proof:

```text
task: #87
fromVersion: v0.8.2
targetVersion: v0.8.3
release dir: /opt/incudal/releases/v0.8.3-20260627032627
log: /opt/incudal/update-logs/system-update-87.log
status: success at 2026-06-27T03:27:43.625Z
public health: https://pay.payincus.com/api/health -> HTTP 200
admin health: https://admin.payincus.com/api/health -> HTTP 200
current version.json: v0.8.3 / 1a82f05eca51
checks: backend health passed after retry 2; verify-split-host, verify:production, verify:log-header passed; OTA cache cleanup and release pruning completed.
notes: production DB readiness kept the existing warning that public package #1 (HKCMI) is active but online bound hosts cannot satisfy its minimum CPU/memory requirement.
```

Production OTA proof:

```text
latest proven production version: v0.6.19
task: #84
target: v0.6.19
status: success
started: 2026-06-27 01:54:26 UTC
finished: 2026-06-27 01:55:58 UTC
backup path: /opt/incudal/releases/v0.6.17-20260627010123
logPath: /opt/incudal/update-logs/system-update-84.log
release dir: /opt/incudal/releases/v0.6.19-20260627015426
current release: /opt/incudal/releases/v0.6.19-20260627015426
version.json: version/tag v0.6.19, commit d60bf6d5fd55, buildTime 2026-06-27T01:51:48.921Z
backend service: `incudal-backend` active after restart
backend health after update: `http://127.0.0.1:3001/api/health` returned `{"status":"ok"}`
verify-split-host: passed for user/admin domains, proxied API, proxied WebSocket, and direct backend health
production readiness: `pnpm verify:production` passed on `/opt/incudal/current`
log/header exposure: `pnpm verify:log-header` passed; configured secret values were not found in logs or headers
public health after update: `https://pay.payincus.com/api/health` and `https://admin.payincus.com/api/health` returned `{"status":"ok"}`
UI proof: user instance cards use the product-card layout, management/PUSH/renew actions are wired through guarded helpers, and instance creation can auto-generate names with server-side fallback.
Docs proof: version logs were regenerated after `v0.6.19`.
```

Production warnings observed during `pnpm verify:production`:

```text
PAYMENT_CALLBACK_IP_WHITELIST is empty; provider-specific defaults apply only where the backend implements them.
Public package #1 (HKCMI) is active but online bound hosts cannot satisfy its minimum CPU/memory requirement.
```

These are existing operational warnings and did not block the `v0.8.1` OTA.

Important release-chain note:

```text
v0.6.7 contained the extension platform and theme system feature bundle, but its Release failed on the frontend route guard and must not be used for OTA.
v0.6.8 fixed the extension platform release guards and deployed successfully through production task #74.
v0.6.9 fixed the public extension/theme market domain to payincus.com.
v0.6.10 adds the guarded gift card center.
v0.6.11 adds the guarded operations settings center.
v0.6.12 fixes admin gift card generation being blocked by the Turnstile gate.
v0.6.13 adds the visible user gift-card Turnstile verification page.
v0.6.14 fixes reliable user gift-card Turnstile token submission and redeemed-card list visibility.
v0.6.15 persists expired gift-card status outside the rolled-back error path.
v0.6.16 fixes gift-card user Turnstile body-token verification by moving the check after body parsing.
v0.6.17 polishes public/user/admin UI structure, help search, gift-card safety UI, Extension Center tab routing, docs, and guard coverage.
v0.6.18 includes the instance card and auto-name feature commit but its Release failed on frontend boundary guard and must not be used for OTA.
v0.6.19 fixes the instance transfer path boundary guard and was the previous production boundary.
v0.8.1 hardens storage pool sellability/creation guards, fixes loop storage source handling, adds user self-service instance traffic reset, and is the current production boundary.
```

Previous production-proof closure:

```text
v0.6.6 remains the production-proof scope closure release. It completed the operator-approved final proof scope with Lsky cleanup explicitly waived, not tested.
```

Previous completed feature bundle:

```text
v0.6.4 Update production proof workspace status
feature commit/tag: 5eff38f
version-log commit: 6b2e7d4
docs/handoff commit: this handoff refresh commit
```

GitHub Actions:

```text
Build & Release for tag v0.6.4: run 28176495161 completed successfully.
CI for version-log commit 6b2e7d4: run 28176491244 completed successfully.
Docs Pages for version-log commit 6b2e7d4: run 28176492013 completed successfully.
```

Release assets confirmed publicly for `v0.6.4`:

```text
ota-manifest.json
incudal-v0.6.4-linux-amd64.tar.gz
incudal-v0.6.4-linux-amd64.tar.gz.sha256
incudal-v0.6.4-linux-arm64.tar.gz
incudal-v0.6.4-linux-arm64.tar.gz.sha256
incudal-v0.6.4-ota-manifest.json
```

Published `v0.6.4` OTA manifest:

```text
version: v0.6.4
gitCommit: 5eff38f1545d
buildTime: 2026-06-25T14:16:40.111Z
amd64 artifact: incudal-v0.6.4-linux-amd64.tar.gz
amd64 size: 90284586
amd64 sha256: 44ef7f673a66007fb7d83d829f348816c46c0e3c5163e872c74dcfb52c1181f6
arm64 artifact: incudal-v0.6.4-linux-arm64.tar.gz
arm64 size: 89396099
arm64 sha256: 419882d8f089dda1f79bff4c8d890a727dcfb6868215b9ee3d25ab6925e1115a
```

Production OTA proof:

```text
historical proven production version for this release block: v0.6.4 from task #71
task: #71
target: v0.6.4
fromVersion: v0.6.3
status: success
started: 2026-06-25 14:19:20.443 UTC
finished: 2026-06-25 14:20:44.408 UTC
backup path: /opt/incudal/releases/v0.6.3-20260625135526
logPath: /opt/incudal/update-logs/system-update-71.log
release dir: /opt/incudal/releases/v0.6.4-20260625141920
current release: /opt/incudal/releases/v0.6.4-20260625141920
version.json: version/tag v0.6.4, commit 5eff38f1545d, buildTime 2026-06-25T14:15:59.835Z, deployedAt 2026-06-25T14:19:39.415Z
verify-split-host: passed
current-release pnpm verify:production: passed
verify-production-db: passed, with existing public-package capacity warnings for package #1 and #2
agent manifest check: passed
correct-loopback-backend pnpm verify:log-header: passed
secret log/header scan: passed
public health after update: user/admin /api/health returned HTTP 200
post-OTA dependency check: SERVER_NODE_MODULES_OK passed from /opt/incudal/current/server
deployed admin bundle markers: `Lsky 只读预检`, `SMTP 与 Telegram 已证明`, and `支付、Incus 生命周期和终端已有测试证据` present
update result: System update completed successfully
cleanup: OTA download cache cleaned; old release pruning executed with protected-release retention
```

Post-update checks:

```text
The admin console contains a read-only Production Proof workspace at /admin/production-proof.
The user build output does not contain the production-proof route, nav key, or page content.
Production `v0.6.6` is live after the final-proof scope waiver release and artifact-mode live-acceptance fix. Current proof progress is complete for the operator-approved scope: 12 proof items are verified, and Lsky confirmed deletion/provider cleanup is explicitly waived by the operator rather than tested.
Latest OTA proof: task `#73` updated `v0.6.5 -> v0.6.6`, switched `/opt/incudal/current` to `/opt/incudal/releases/v0.6.6-20260625151558`, and finished with `System update completed successfully`. Manual current-release checks confirmed version `v0.6.6`, commit `9fcbe2867efa`, backend `active`, `SERVER_NODE_MODULES_OK`, `pnpm verify:production`, and `pnpm verify:log-header`.
Final live acceptance report: `/tmp/incudal-proof/final-acceptance-v0.6.6.md` ended with `final_go_status: live_proof_references_documented` and `status: automated_checks_completed`. In artifact mode, `agent_release_smoke` is recorded as skipped because production preflight verifies the Agent manifest; this avoids the old `tsx` dev-dependency failure in production artifacts.
Production `v0.5.3` showed the production DB backup/restore drill as verified in the read-only proof workspace and is now an older rollback release.
Production Lsky proof script is deployed at `server/dist/scripts/lsky-production-proof.js`. Latest read-only proof `lsky-upload-delete-proof-2026-06-25T14:33:18.929Z` confirmed config present, API v2 host `kkksr.com`, group endpoint HTTP 200, token permission endpoint HTTP 200 with redacted summary output, token abilities only include `upload:write`, missing `user:photo:read` and `user:photo:write`, and `/api/v2/user/photos?page=1&per_page=1` returned HTTP 403. Commit mode was not run. The operator then explicitly said this cleanup proof does not need testing, so record it as a scope waiver and never as confirmed deletion.
Official Lsky Pro+ API docs confirm `DELETE /api/v2/user/photos` expects a JSON numeric ID array and returns HTTP 204 on successful deletion. The current production code matches this endpoint/body shape. A later production DB-only known-ID search `lsky-db-known-id-readonly-search-2026-06-25T04:54:26.080Z` found `attachmentCount=0` and no Lsky providerFileId in matched business log rows, so there is no safe persisted proof image ID to delete from the app side.
Current code review confirms there is no safe no-upload/no-known-ID deletion proof path: `deleteTicketImageFromLsky()` requires a numeric Lsky v2 provider ID before it sends `DELETE /api/v2/user/photos`, and the proof script refuses commit mode while `/api/v2/user/photos` returns HTTP 403. Do not probe production with guessed IDs, empty delete arrays, or invalid-ID delete requests.
Production DB backup/restore drill is proven through a temporary database restore and cleanup check.
Production Incus lifecycle is proven on dedicated test instance #9: stop task #5, start task #6, restart task #7, recreate task #8, delete cleanup, DB status deleted, Incus object not found, and host CPU/memory/disk resources returned to baseline.
Telegram delivery is proven by production bot message #339 to public group @Payincus.
Turnstile/session browser smoke is proven through the approved temporary disable-and-restore path: user /dashboard and admin /admin/production-proof rendered after login, config restored, temp secret file removed, and test users #31/#32 banned.
SMTP provider reference is proven by production send-test proof `smtp-provider-reference-2026-06-25T04:34:51.773Z`: recipient domain `qq.com`, provider reference `35bd2e0d-e817-1e31-ffde-de033e861c7e@qq.com`, accepted=1, rejected=0, pending=0, response `250 OK: queued as.`.
Remaining production proof for the current operator-approved scope is closed. Lsky confirmed deletion/provider cleanup is waived by operator decision, not tested. If this is later reintroduced, configure a delete-capable Lsky token with `user:photo:read` and `user:photo:write`, use a wildcard token, or perform provider-side cleanup before commit-mode proof; previous proof images may still need cleanup. Once that is available, run `LSKY_PROOF_COMMIT=1 ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js` and prove `DELETE /api/v2/user/photos` returns success/204 for its numeric provider ID.
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

Local gates run for `v0.5.8`:

```text
pnpm --filter server test:production-proof-center-guards
pnpm --filter client type-check
pnpm --filter client build
pnpm --filter server type-check
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The `v0.5.8` release updated the read-only admin production-proof workspace to show SMTP as verified and the remaining proof count as `1`: only Lsky deletion/provider cleanup. GitHub Build & Release run `28164941815`, product CI run `28164938942`, version-log CI run `28164985317`, and Pages run `28164985293` succeeded. Production task `#65` deployed `v0.5.8` content and passed health/readiness checks, but it exposed an old-runner artifact issue: because the launcher was started from a symlink target, it treated a release directory as `installDir`, applied in legacy mode, then cleanup broke production dependency symlinks that pointed into staging. Production was repaired with `CI=1 pnpm install --prod --frozen-lockfile`; do not use task `#65` as the latest clean OTA boundary.

Local gates run for `v0.5.9`:

```text
pnpm --filter server test:system-update-guards
pnpm --filter server type-check
pnpm --filter server build
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The `v0.5.9` release fixes the artifact OTA issue: start/update/rollback scripts now derive `installDir` correctly when `process.cwd()` resolves to `/opt/incudal/releases/<version>`, and artifact updates run `pnpm install --prod --frozen-lockfile` inside the applied release so node_modules symlinks do not point into temporary staging. GitHub Build & Release run `28166024694`, product CI run `28166021879`, version-log CI run `28166039786`, and Pages run `28166039793` succeeded. Production task `#66` completed successfully and switched `/opt/incudal/current` to `/opt/incudal/releases/v0.5.9-20260625111908`; a post-OTA production `CI=1 pnpm install --prod --frozen-lockfile` repaired the one remaining old-runner symlink issue, backend restart passed local health, and public user/admin `/api/health` returned HTTP 200.

Local gates run for `v0.6.0-v0.6.2`:

```text
pnpm --filter server test:lsky-production-proof-guards
pnpm --filter server test:ticket-image-security
pnpm --filter server test:system-update-guards
pnpm --filter server type-check
pnpm --filter server build
pnpm build
pnpm docs:changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The `v0.6.0-v0.6.2` release chain redacts Lsky token permission previews, reports missing Lsky abilities explicitly, and hardens future artifact OTA dependency installs by adding `--force` to both production install paths. GitHub Build & Release run `28173791822`, CI run `28173791846`, and Pages run `28173792049` succeeded for the latest `v0.6.2` boundary. Production task `#69` completed successfully and switched `/opt/incudal/current` to `/opt/incudal/releases/v0.6.2-20260625133527`; `SERVER_NODE_MODULES_OK`, public user/admin `/api/health`, deployed updater `--force` marker grep, split-host, production readiness, DB readiness, Agent manifest, and log/header checks passed. Latest Lsky preflight `lsky-upload-delete-proof-2026-06-25T13:37:40.242Z` still blocks commit-mode cleanup because the production Lsky token only has `upload:write` and is missing `user:photo:read` plus `user:photo:write`.

Local gates run for `v0.6.3`:

```text
pnpm --filter server test:lsky-production-proof-guards
pnpm --filter server type-check
pnpm --filter server build
pnpm build
pnpm docs:changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

The `v0.6.3` release hardens Lsky commit-mode proof safety: the production proof script now refuses to upload a new proof image when the token permission summary is absent or `missingForCommitProof` is non-empty. GitHub Build & Release run `28174973047`, CI run `28174969332`, and Pages run `28174969346` succeeded. Production task `#70` completed successfully and switched `/opt/incudal/current` to `/opt/incudal/releases/v0.6.3-20260625135526`; task `#70` ran `pnpm install --prod --frozen-lockfile --force`, `SERVER_NODE_MODULES_OK`, public user/admin `/api/health`, current-release `pnpm verify:production`, correct-backend `pnpm verify:log-header`, and deployed Lsky marker grep passed. Latest Lsky preflight `lsky-upload-delete-proof-2026-06-25T14:00:06.848Z` still blocks commit-mode cleanup because the production Lsky token only has `upload:write` and is missing `user:photo:read` plus `user:photo:write`.

Current commercial operation progress:

```text
12/12 categories have local feature coverage: commercial deployment/recovery, operations overview, order/payment operations, financial reconciliation, delivery assurance enhancement, SLA and alerting, customer success, user lifecycle, risk and audit, resource capacity and cost, plugin market governance, and production proof workspace.
Current operator-approved final scope is closed: Lsky confirmed deletion/provider cleanup is explicitly excluded from the required proof set. Do not record the waived Lsky cleanup item as deleted; if cleanup proof is reintroduced later, use a delete-capable Lsky token or separate provider cleanup evidence.
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
- `v0.0.12`: extension center.
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
- Public `https://admin.payincus.com/admin/plugins` returns HTTP 200 and current admin JS assets contain `/admin/plugins`, `扩展中心`, and `admin-instance-detail` markers.
- Latest public non-auth recheck passed: live health endpoints, protected adjustment-request API 401 protection, admin order page HTTP 200, docs TLS, `v0.2.4` release assets, public admin bundle marker scan, and public root/API security headers.
- Public header checks on `https://pay.payincus.com/`, `https://admin.payincus.com/`, `https://pay.payincus.com/api/health`, and `https://admin.payincus.com/api/health` returned HSTS, CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- `v0.1.8` public release asset availability was verified directly. GitHub Actions API polling hit an anonymous rate limit during that check, so the latest fully recorded Actions run IDs in this handoff remain the earlier `v0.1.6` chain.
- Docs apex DNS is still incomplete for resilience: public resolvers currently return only A `185.199.108.153` and AAAA `2606:50c0:8000::153` for `payincus.com`, not the full recommended GitHub Pages record set.
- Full-function audit progress is complete for the current operator-approved scope. Category `13/13` is closed with Lsky confirmed deletion/provider cleanup recorded as an explicit scope waiver, not as a tested delete proof.

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

## Extension Center Status

Extension Center development was originally committed, pushed, and released as `v0.0.12`; later releases renamed the user-facing surface to Extension Center while preserving internal `plugin` route and package names for compatibility.

Implemented backend scope:

- Prisma schema and migration for plugins, plugin versions, install tasks, plugin configs, market sources, event logs and user plugin data.
- Admin API under `/api/admin/plugins` for list/detail, upload install, GitHub market install, enable, disable, uninstall, config and task logs.
- User API under `/api/plugins` for enabled client extensions, public config, plugin action placeholder and sandboxed plugin assets.
- Package validation for `.tar.gz` uploads, manifest validation, path traversal rejection, link rejection, SHA256 calculation, staging extraction and entry/template file checks.
- Market index support through `PLUGIN_MARKET_INDEX_URL`, restricted to GitHub-hosted indexes and GitHub Release artifact download URLs with SHA256 verification.

Implemented frontend scope:

- Admin route `/admin/plugins` and extension center page for upload install, market install, enable/disable/uninstall, config JSON and task log viewing.
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

- Commit: `0453d5a Add extension center`
- Version log commit: `6e8ce21 Update version log for v0.0.12`
- Tag: `v0.0.12`
- GitHub Actions Build & Release run: `28026305328`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.0.12`
- Assets generated: linux amd64 tar.gz, linux arm64 tar.gz, both `.sha256` files, `incudal-v0.0.12-ota-manifest.json`, and `ota-manifest.json`.

Production API proof has passed for the extension center. Browser UI smoke for `/admin/plugins` iframe rendering and user `/plugins/smoke` rendering still needs a real session/Turnstile proof.

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
- Admin extension center now:
  - displays the known AI plugin as `AI 工单助手` even when an older installed manifest still has English text;
  - shows Chinese description and permission labels;
  - links enabled plugins with `admin.plugins.settings` to standalone settings routes;
  - no longer embeds the settings iframe or raw config JSON in the extension center detail panel.

Official AI plugin standalone settings proof:

- Commit: `b4d4cce Add standalone plugin settings pages / 新增独立插件设置页`
- Tag: `v0.4.0`
- Release URL: `https://github.com/VipMaxxxx/payincus/releases/tag/v0.4.0`
- Production version file reports `v0.4.0`, git commit `b4d4cce11319`.
- Admin sidebar dynamically loads enabled extensions that declare `admin.plugins.settings` and inserts the settings entry after `扩展中心`.
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

## Historical Production Audit Notes

The old private production-audit ledger is not present in the current tracked checkout. The notes in this section are historical context only; use the top `Latest Production OTA Proof` and `Current Local Unreleased Work` sections for current release decisions.

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

Note: public README examples currently use `https://demo.payincus.com` and `https://demoadmin.payincus.com` as split-deployment example domains. Production proof should still use the real production domains above unless the operator explicitly scopes a demo check.

## Suggested Next Work

1. Treat the top sections of this file as authoritative. Older production proof notes below this point are historical evidence and may mention older versions.
2. Finish the current local `0.9.0` candidate release boundary: review the 63 changed/new files, commit the bundle, create/publish `v0.9.0`, and regenerate version logs after the release commit/tag exists.
3. Run the release/OTA process and verify that GitHub Release assets include linux amd64/arm64 tarballs, sha256 files, OTA manifest, extension/theme market assets, and Agent release metadata.
4. Apply OTA to production and record the system-update task id, release symlink, backup path, logs, production `package.json` version, and `systemctl is-active incudal-backend`.
5. Re-run production checks with the real `/opt/incudal/.env`: `pnpm verify:production`, `pnpm verify:split:host`, `pnpm verify:log-header`, and `pnpm verify:final-acceptance` with non-placeholder proof refs.
6. Smoke the high-risk surfaces touched by `0.9.0`: Integration Center health checks, manual recharge, refund/reconciliation workbench, extension capability review blocking, delivery/plan-upgrade sync repair, and split user/admin login boundaries.
7. Keep README, docs-site Chinese/English pages, generated version logs, and this handoff aligned with the final `v0.9.0` proof state.

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
- For auth, payment, permissions, OTA, Agent, resource delivery, and production deployment changes, include the relevant guard scripts and document any remaining live proof requirement in `HANDOFF.md`, the production checklist, or the release notes that ship with the OTA.

## Safety Notes

- Do not include server passwords, API secrets, payment keys, SMTP passwords, Telegram tokens, Lsky tokens, or GitHub tokens in summaries or docs.
- Treat auth, payment, permissions, OTA, Agent, and resource delivery as high-risk.
- Do not revert user changes or staged files without explicit approval.
- Before changing backend/admin/user boundary code, read existing guards and update tests with the change.
