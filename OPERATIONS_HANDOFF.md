# PayIncus / Incudal Operations Handoff

Last updated: 2026-07-10 05:02 CST

This is the operational handoff for engineers or agents taking over PayIncus / Incudal release work. Do not put server passwords, API tokens, cookies, private keys, or customer secrets in this file.

## Current Baseline

- Active worktree: `/Users/max/.codex/worktrees/payincus-release-v133`
- GitHub repository: `VipMaxxxx/payincus`
- Git remote name in this worktree: `payincus`
- Production install root: `/opt/incudal`
- Production current symlink: `/opt/incudal/current`
- User frontend: <https://pay.payincus.com>
- Admin frontend: <https://admin.payincus.com>
- Current production version: `v1.3.5`
- Current production release path: `/opt/incudal/releases/v1.3.5-20260709205805`
- Current production OTA task: `#144`
- Current release commit/tag: `7f6f6b8c1070` / `v1.3.5`
- Latest product main commit before this evidence update: `0f422e0e7`

`v1.3.5` is the audited security, accounting, OTA, scheduler, authentication, UI, installer, and documentation release. Production task `#144` completed successfully with artifact sha256 `ffcf0f17e1290ec2ed43d7c02f3e37993d2df70b92d4b680353932e014ac7fea`.

The Claude UI work is already merged into main and included in production:

- `f9df2160c` - full anime-style UI makeover.
- `f32e44e02` - `v1.3.3` release.
- `bd0a36c69` - `v1.3.4` reload-loop hotfix.

## Private Backend Must Run As A Single Instance

The private backend at `127.0.0.1:3001` must run as exactly one Node.js process. The supported production topology is the single `incudal-backend.service` process; do not use Node cluster mode, multiple systemd service replicas, process-manager worker counts above one, containers with multiple replicas, or horizontal backend scaling.

This is an architecture invariant because the backend intentionally has no Redis and keeps these correctness-relevant states in process memory:

- login failure locks in `server/src/lib/security.ts`;
- OAuth state nonce and one-time login-code replay protection in `server/src/lib/security.ts`;
- exchange delivery finalize re-entry deduplication in `server/src/workers/exchangeDeliveryWorker.ts`;
- system configuration cache and its update invalidation in `server/src/lib/config-cache.ts`.

The security module also keeps export-task state in process memory. PostgreSQL advisory locks remain the coordination mechanism for database-backed jobs, but they do not make these process-local maps shared. Before any multi-process or horizontal expansion, move the affected locks, nonce/replay records, deduplication, and cache invalidation to PostgreSQL or another shared store. Treat a second backend replica as an unsupported deployment, not as extra capacity.

## First Things To Read

Before making changes, read:

```bash
sed -n '1,180p' HANDOFF.md
git status --short
git diff --stat
git log --oneline --decorate -10
```

`HANDOFF.md` is the version evidence ledger. This file is the operations runbook. Keep both aligned after production releases.

## Hard Rules

- Default to Chinese communication with the owner.
- Do not run `git reset`, `git checkout --`, force-delete files, or clean untracked files unless the owner explicitly asks.
- Do not OTA, publish, push, tag, or touch production unless the owner explicitly asks.
- Treat authentication, payment, permissions, risk control, resource delivery, exchange flows, instance creation, and OTA as high risk.
- Read existing code and tests before editing high-risk paths.
- Keep edits minimal. Do not do broad refactors during release fixes.
- Do not include credentials in commits, handoff notes, terminal summaries, or screenshots.
- Local passing does not mean production verified. Keep local, GitHub Actions, Release asset, OTA, and live proof separate.

## Current Known Caveat And OTA Policy

The active payment provider readiness check fails because production cannot resolve `max.xinyuqicheng.cn`. Task `#143` auto-rolled back for this reason. The owner issued a standing directive on 2026-07-10 that all future PayIncus OTA runs should use:

```bash
RUN_DB_CHECKS=0 bash scripts/apply-online-update.sh <version>
```

This is a standing authorization; do not ask for a per-release DB/payment readiness waiver again unless the owner revokes it. Continue all artifact SHA256, Prisma migration, static environment, split-host, Agent manifest, service health, and log/header checks. Payment runtime signature/status/amount/idempotency checks are not disabled by this waiver.

Current sanitized configuration findings after v1.3.5:

- Five secret-type system settings are configured.
- One plugin is enabled, no themes are installed, one Telegram notification channel is enabled, and no OAuth providers are configured.
- `DE-01` Agent heartbeat is stale. Production readiness also reports one active package without sufficient online host capacity and two sold-out package groups.

## Normal Development Checks

Use targeted checks first, then broaden based on risk:

```bash
pnpm --filter client type-check
pnpm --filter server type-check
pnpm --filter server test:frontend-route-guards
pnpm build
pnpm test
git diff --check
```

For docs/release notes:

```bash
pnpm --dir docs-site --ignore-workspace changelog
pnpm --dir docs-site --ignore-workspace build
```

For split-host production checks:

```bash
pnpm verify:split:host
pnpm verify:production
pnpm verify:log-header
```

`pnpm verify:final-acceptance` is stricter than `pnpm verify:live-acceptance`; do not treat them as equivalent.

## Release Preparation

Use a clean worktree except for intentional release changes:

```bash
git status --short
git diff --stat
git diff --check
```

For a version release, update all version-bearing files that apply:

- `package.json`
- `client/package.json`
- `server/package.json`
- `client/public/sw.js` cache name, for example `incudal-cache-v1.3.5`
- `docs-site/release-notes/vX.Y.Z.md`
- generated docs-site version logs, if release notes changed
- `HANDOFF.md` only after there is real release/OTA evidence

Run the release verification set before tagging:

```bash
pnpm --filter client type-check
pnpm --filter server type-check
pnpm build
pnpm test
pnpm --dir docs-site --ignore-workspace changelog
pnpm --dir docs-site --ignore-workspace build
git diff --check
```

Commit and tag:

```bash
git add <changed-files>
git commit -m "Release vX.Y.Z <short reason>"
git tag vX.Y.Z
git push payincus HEAD:main
git push payincus vX.Y.Z
```

Do not move an existing version tag after it has been pushed unless the owner explicitly approves rewriting release history.

## GitHub Actions And Release Asset Checks

After pushing, wait for all relevant workflows for the release commit:

- CI
- Build & Release
- Deploy docs site to GitHub Pages

If `gh` is available:

```bash
gh run list --repo VipMaxxxx/payincus --limit 10
```

If `gh` is not available, use the GitHub API:

```bash
node - <<'NODE'
const sha = '<full-release-commit-sha>'
const res = await fetch(`https://api.github.com/repos/VipMaxxxx/payincus/actions/runs?head_sha=${sha}&per_page=20`, {
  headers: { 'User-Agent': 'payincus-release-check' },
})
const data = await res.json()
for (const run of data.workflow_runs || []) {
  console.log(`${run.name}\t${run.status}\t${run.conclusion || '-'}\t${run.html_url}`)
}
NODE
```

Check the GitHub Release and OTA manifest:

```bash
node - <<'NODE'
const version = 'vX.Y.Z'
const release = await fetch(`https://api.github.com/repos/VipMaxxxx/payincus/releases/tags/${version}`, {
  headers: { 'User-Agent': 'payincus-release-check' },
})
console.log(release.status, release.statusText)
const data = await release.json()
console.log(JSON.stringify({
  tag_name: data.tag_name,
  published_at: data.published_at,
  assets: (data.assets || []).map(a => ({ name: a.name, size: a.size })),
}, null, 2))

const manifest = await fetch(`https://github.com/VipMaxxxx/payincus/releases/download/${version}/ota-manifest.json`, {
  headers: { 'User-Agent': 'payincus-release-check' },
})
console.log(await manifest.text())
NODE
```

Required release assets:

- `incudal-vX.Y.Z-linux-amd64.tar.gz`
- `incudal-vX.Y.Z-linux-amd64.tar.gz.sha256`
- `incudal-vX.Y.Z-linux-arm64.tar.gz`
- `incudal-vX.Y.Z-linux-arm64.tar.gz.sha256`
- `incudal-vX.Y.Z-ota-manifest.json`
- `ota-manifest.json`
- plugin assets, if plugin packaging is still enabled
- `plugin-market-index.json`

Do not OTA until the GitHub Release exists and the required assets are present.

## Production Preflight Before OTA

Use current authorized SSH details from the owner/operator. Do not save passwords in files.

On production:

```bash
cd /opt/incudal
git fetch --tags payincus
git rev-parse vX.Y.Z
systemctl is-active incudal-backend
readlink -f /opt/incudal/current
cat /opt/incudal/current/version.json
curl -fsS --max-time 10 http://127.0.0.1:3001/api/health
curl -fsS --max-time 10 https://pay.payincus.com/api/health
curl -fsS --max-time 10 https://admin.payincus.com/api/health
```

If the tag cannot resolve, the service is not active, or health checks fail, stop and diagnose before OTA.

## OTA Command

Standard OTA:

```bash
cd /opt/incudal
bash scripts/apply-online-update.sh vX.Y.Z
```

Only with explicit owner approval to skip DB/payment readiness checks:

```bash
cd /opt/incudal
RUN_DB_CHECKS=0 bash scripts/apply-online-update.sh vX.Y.Z
```

The script creates a system update task and prints JSON containing:

- `task.id`
- `targetVersion`
- `fromVersion`
- `logPath`

Example log path:

```text
/opt/incudal/update-logs/system-update-141.log
```

## OTA Monitoring

Tail the task log until it clearly succeeds or fails:

```bash
tail -f /opt/incudal/update-logs/system-update-<id>.log
```

Success indicators:

- Backend health is ready
- Host-process split deployment verification passed
- Production readiness verification passed
- Log/header exposure verification passed
- System update completed successfully

Failure indicators:

- System update failed
- Rolling back
- Production readiness verification failed

If the update fails, first check whether the updater auto-rolled back:

```bash
readlink -f /opt/incudal/current
cat /opt/incudal/current/version.json
systemctl is-active incudal-backend
curl -fsS --max-time 10 http://127.0.0.1:3001/api/health
tail -n 160 /opt/incudal/update-logs/system-update-<id>.log
```

Do not manually relink `/opt/incudal/current` unless the updater did not recover, production is impaired, and the owner explicitly approves manual rollback.

## Post-OTA Live Verification

After success:

```bash
systemctl is-active incudal-backend
readlink -f /opt/incudal/current
cat /opt/incudal/current/version.json
curl -fsS --max-time 10 http://127.0.0.1:3001/api/health
curl -fsS --max-time 10 https://pay.payincus.com/api/health
curl -fsS --max-time 10 https://admin.payincus.com/api/health
```

Check Service Worker versioned URL:

```bash
curl -fsS --max-time 10 'https://pay.payincus.com/sw.js?v=X.Y.Z' | rg 'incudal-cache-vX.Y.Z'
curl -fsS --max-time 10 'https://admin.payincus.com/sw.js?v=X.Y.Z' | rg 'incudal-cache-vX.Y.Z'
```

For frontend asset fixes, confirm the new code is actually in live bundles. Example for the `v1.3.4` reload guard:

```bash
for origin in https://pay.payincus.com https://admin.payincus.com; do
  echo "== $origin =="
  curl -fsS --max-time 15 "$origin/" \
    | rg -o '/assets/[^"]+\.js' \
    | sort -u \
    | while read asset; do
        keys="$(curl -fsS --max-time 20 "$origin$asset" \
          | rg -o 'incudal:service-worker-controller-reloaded|incudal:stale-asset-reload-signature' \
          | sort -u \
          | tr '\n' ' ' || true)"
        if [ -n "$keys" ]; then
          echo "$asset -> $keys"
        fi
      done
done
```

For browser-only issues, use a real browser session when available. If the Codex in-app browser is unavailable, say so plainly and rely on HTTP/live asset proof only; do not claim browser observation was completed.

## Updating Evidence After OTA

After production is verified:

Update `HANDOFF.md` top section with the new production version, release commit, GitHub Actions, Release assets, OTA manifest proof, OTA task id/log path, current symlink, health checks, and known caveats.

Commit the handoff evidence separately after the release tag commit:

```bash
git add HANDOFF.md OPERATIONS_HANDOFF.md
git commit -m "Update handoff for vX.Y.Z production OTA"
git push payincus HEAD:main
```

Do not move the version tag for a handoff-only evidence commit.

## What To Report After Any Modification

Every completed change report must include:

- What files changed.
- Why they changed.
- Risk points.
- How it was verified.

For OTA/release work, also report:

- release commit/tag
- GitHub Actions status
- Release asset status
- OTA task id and log path
- production current symlink
- live health checks
- skipped checks, if any, and who authorized the skip
