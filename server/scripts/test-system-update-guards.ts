import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const serverApp = read('server/src/app.ts')
const route = read('server/src/routes/system-update.ts')
const versionLib = read('server/src/lib/system-version.ts')
const prismaSchema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260623093000_add_system_update_tasks/migration.sql')
const adminApi = read('client/src/api/admin.ts')
const userApi = read('client/src/api/index.ts')
const adminRouter = read('client/src/router/admin.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const releaseWorkflow = read('.github/workflows/release.yml')
const onlineScript = read('scripts/apply-online-update.sh')
const atomicMigrationScript = read('scripts/migrate-ota-atomic-layout.sh')
const installPanel = read('scripts/install-panel.sh')
const backendService = read('deploy/incudal-backend.service.example')
const updateService = read('deploy/incudal-online-update@.service.example')
const rollbackService = read('deploy/incudal-online-rollback@.service.example')
const runTask = read('server/src/scripts/run-system-update-task.ts')
const rollbackTask = read('server/src/scripts/rollback-system-update-task.ts')
const rootPackage = read('package.json')
const serverPackage = read('server/package.json')

assert.ok(
  serverApp.includes("import systemUpdateRoutes from './routes/system-update.js'") &&
    serverApp.includes("fastify.register(systemUpdateRoutes, { prefix: '/api/admin/system-update' })"),
  'system update routes must be mounted only under the admin API namespace'
)

assert.ok(
  route.includes('onRequest: [fastify.authenticateAdmin]') &&
    route.includes('SUPER_ADMIN_REQUIRED') &&
    route.includes("return user.username === 'admin'") &&
    route.includes('SYSTEM_UPDATE_ALLOWED_ADMIN_IDS'),
  'system update routes must require admin authentication plus super-admin gating'
)

assert.ok(
  versionLib.includes('const tagPattern = /^v\\d+\\.\\d+\\.\\d+') &&
    versionLib.includes('repositoryAvailable: false') &&
    versionLib.includes("rev-parse', '--is-inside-work-tree") &&
    versionLib.includes('interface GitHubReleaseAsset') &&
    versionLib.includes('getOtaReleaseInfo') &&
    versionLib.includes('ota-manifest.json') &&
    versionLib.includes('SYSTEM_UPDATE_RELEASE_REPOSITORY') &&
    route.includes('isValidReleaseTag(targetVersion)') &&
    route.includes('GIT_REPOSITORY_REQUIRED') &&
    route.includes('additionalProperties: false'),
  'system update must only accept controlled release tags, require a Git checkout, expose OTA manifest metadata, and reject extra input'
)

assert.ok(
  versionLib.includes('const latest = tags[0] ? await buildAvailableUpdate(tags[0]) : null') &&
    versionLib.includes('updates.push(latest?.version === tag ? latest : await buildAvailableUpdate(tag))') &&
    versionLib.includes('latest,') &&
    versionLib.includes('updateAvailable: updates.length > 0') &&
    route.includes('canManageUpdates: canManageSystemUpdates(getRequestUser(request))') &&
    route.includes("fastify.post<{ Body: StartUpdateBody }>('/start'") &&
    route.includes('if (!(await requireUpdateManager(request, reply))) return'),
  'system update checks must always expose the newest release tag while keeping updateAvailable and mutation permissions separate'
)

assert.ok(
  prismaSchema.includes('model SystemUpdateTask') &&
    prismaSchema.includes('enum SystemUpdateTaskStatus') &&
    migration.includes('CREATE TABLE "system_update_tasks"') &&
    migration.includes('FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id")'),
  'system update tasks must be persisted with an audited admin user'
)

assert.ok(
  adminApi.includes('/admin/system-update/version') &&
    adminApi.includes('/admin/system-update/start') &&
    adminRouter.includes("path: '/admin/system-update'") &&
    adminNav.includes("path: '/admin/system-update'"),
  'admin frontend must expose the version update page and API client'
)

assert.ok(
  !userApi.includes('/admin/system-update') &&
    !userApi.includes('systemUpdate'),
  'customer API bundle must not expose system update endpoints'
)

assert.ok(
  runTask.includes("git', ['checkout', '--force', targetVersion]") &&
    runTask.includes("git', ['clean', '-fdx'") &&
    runTask.includes("'-e', '.env'") &&
    runTask.includes("'-e', '.gitconfig'") &&
    runTask.includes("git', ['config', '--global', '--add', 'safe.directory', appDir]") &&
    runTask.includes("targetVersion = task.targetVersion") &&
    runTask.includes("pnpm', ['build']") &&
    runTask.includes("test:frontend-dist-boundary-guards") &&
    runTask.includes("test:frontend-route-guards") &&
    runTask.includes("systemctl', ['restart', serviceName]") &&
    runTask.includes('waitForBackendHealth()') &&
    runTask.includes("verify:production") &&
    runTask.includes("verify:log-header") &&
    runTask.includes("smoke:agent-release"),
  'online updater must build, migrate, guard, restart, and verify before marking success'
)

assert.ok(
  runTask.includes('SYSTEM_UPDATE_APPLY_MODE') &&
    runTask.includes('getOtaReleaseInfo(targetVersion)') &&
    runTask.includes('selectRuntimeArtifact') &&
    runTask.includes('downloadArtifact') &&
    runTask.includes('createHash') &&
    runTask.includes('OTA artifact sha256 mismatch') &&
    runTask.includes("tar', ['-xzf', artifactPath") &&
    runTask.includes('assertArtifactStaging') &&
    runTask.includes("'.git'") &&
    runTask.includes('No usable OTA artifact found; falling back to Git build mode') &&
    runTask.includes('Skipping source-based Agent release smoke in artifact mode') &&
    runTask.includes('autoRollbackFromBackup') &&
    runTask.includes('switchCurrentRelease') &&
    runTask.includes('applyArtifactAtomic') &&
    runTask.includes('function deriveInstallDir') &&
    runTask.includes("resolvedAppDir.endsWith('/current')") &&
    runTask.includes("releasesDir.endsWith('/releases')") &&
    runTask.includes("join(installDir, '.incudal-update-downloads')") &&
    runTask.includes("join(installDir, 'current')") &&
    runTask.includes("join(installDir, 'releases')") &&
    runTask.includes('SYSTEM_UPDATE_MIN_FREE_MB') &&
    runTask.includes('SYSTEM_UPDATE_RELEASES_KEEP') &&
    runTask.includes('SYSTEM_UPDATE_BACKUP_TASKS_KEEP') &&
    runTask.includes('assertRequiredCommands()') &&
    runTask.includes('defaultExecutionPath') &&
    runTask.includes("PATH: executionPath") &&
    runTask.includes("cleanupUpdateDownloadDir('更新开始前')") &&
    runTask.includes('assertEnoughDiskSpace') &&
    runTask.includes('磁盘空间不足，无法继续 OTA 更新') &&
    runTask.includes('runPostUpdateCleanup(backupPath)') &&
    runTask.includes('runFailedUpdateCleanup()') &&
    runTask.includes('cleanupOldReleases') &&
    runTask.includes('getRecentProtectedBackupPaths') &&
    runTask.includes('getCurrentReleaseTarget') &&
    runTask.includes('已删除旧 release') &&
    runTask.includes("'.incudal-update-downloads'") &&
    !runTask.includes("cp -a ${JSON.stringify(stagingDir)}/.") &&
    !runTask.includes("cp -a ${JSON.stringify(backupDir)}/.") &&
    runTask.includes('Auto rollback completed successfully') &&
    runTask.includes("status: rolledBack ? 'rolled_back' : 'failed'") &&
    runTask.includes('failed-update'),
  'online updater must prefer checksum-verified OTA release artifacts, support atomic current/release switching, clean OTA caches, preflight disk space, prune old releases safely, and preserve Git fallback mode'
)

assert.ok(
  runTask.includes("pnpm', ['install', '--prod', '--frozen-lockfile', '--force']") &&
    runTask.includes("timeoutMs: 600000,") &&
    runTask.includes('cwd: releaseDir') &&
    (runTask.match(/env: \{ CI: '1' \}/g) ?? []).length >= 2,
  'artifact updates must recreate production dependency symlinks non-interactively inside the applied release, not keep links into temporary staging'
)

assert.ok(
  route.includes("execFileAsync('sudo', ['-n', 'systemctl', 'start', '--no-block', unitName]") &&
    route.includes("incudal-online-update@${taskId}.service") &&
    route.includes("incudal-online-rollback@${taskId}.service") &&
    updateService.includes('User=root') &&
    updateService.includes('run-system-update-task.js %i') &&
    rollbackService.includes('User=root') &&
    rollbackService.includes('rollback-system-update-task.js %i') &&
    installPanel.includes('/etc/sudoers.d/incudal-online-update') &&
    installPanel.includes('NOPASSWD: ${systemctl_bin} start --no-block incudal-online-update@*.service') &&
    installPanel.includes('readonly SERVICE_NAME="incudal-backend"') &&
    installPanel.includes('SYSTEM_UPDATE_RELEASE_REPOSITORY') &&
    installPanel.includes('SYSTEM_UPDATE_RELEASE_TOKEN') &&
    installPanel.includes('SYSTEM_UPDATE_APPLY_MODE=auto') &&
    installPanel.includes('app_dir="${INSTALL_DIR}/current"') &&
    updateService.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    rollbackService.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    installPanel.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    installPanel.includes('NoNewPrivileges=false') &&
    backendService.includes('NoNewPrivileges=false') &&
    backendService.includes('/opt/incudal/.git /opt/incudal/update-logs'),
  'production online updates must run through root-owned systemd oneshot units with restricted sudoers, sudo-compatible backend privileges, and writable git/log paths'
)

assert.ok(
  runTask.includes("pnpm', ['install', '--frozen-lockfile', '--prod=false']") &&
    runTask.includes("NODE_ENV: 'development'") &&
    runTask.includes("PNPM_CONFIG_PROD: 'false'"),
  'online updater must install build-time dependencies even when the production service environment sets NODE_ENV=production'
)

assert.ok(
  runTask.includes('server/certs') &&
    runTask.includes('agent-release') &&
    runTask.includes("'.npm'") &&
    runTask.includes("'.cache'") &&
    rollbackTask.includes('pre-rollback') &&
    rollbackTask.includes('PATH: executionPath') &&
    rollbackTask.includes("chown', ['-R', 'incudal:incudal', installDir]") &&
    rollbackTask.includes('waitForBackendHealth()') &&
    rollbackTask.includes('verify-split-host.sh'),
  'online update and rollback must preserve runtime assets and verify the split deployment'
)

for (const runtimeDir of ['plugins', 'plugin-data', 'plugin-logs', 'plugin-staging']) {
  assert.ok(runTask.includes(runtimeDir), `online updater must preserve plugin runtime dir: ${runtimeDir}`)
  assert.ok(rollbackTask.includes(runtimeDir), `online rollback must recreate plugin runtime dir: ${runtimeDir}`)
  assert.ok(installPanel.includes(runtimeDir), `install panel must create plugin runtime dir: ${runtimeDir}`)
  assert.ok(backendService.includes(runtimeDir), `backend service must permit plugin runtime dir: ${runtimeDir}`)
}

assert.ok(
  releaseWorkflow.includes('cp scripts/apply-online-update.sh release/scripts/') &&
    releaseWorkflow.includes("fs.writeFileSync('release/version.json'") &&
    releaseWorkflow.includes('incudal-${VERSION}-ota-manifest.json') &&
    releaseWorkflow.includes('sha256sum "$file" > "$file.sha256"') &&
    releaseWorkflow.includes('ota-manifest.json') &&
    releaseWorkflow.includes('pnpm --filter server test:frontend-dist-boundary-guards') &&
    releaseWorkflow.includes('pnpm --filter server test:frontend-route-guards') &&
    releaseWorkflow.includes('cp scripts/migrate-ota-atomic-layout.sh release/scripts/') &&
    onlineScript.includes('APP_DIR="$INSTALL_DIR"') &&
    onlineScript.includes('APP_DIR="$INSTALL_DIR/current"') &&
    onlineScript.includes('INCUDAL_APP_DIR="$APP_DIR"') &&
    runTask.includes('const appDir = resolve(process.env.INCUDAL_APP_DIR || process.cwd())') &&
    rollbackTask.includes('function deriveInstallDir') &&
    read('server/src/scripts/start-system-update-task.ts').includes("releasesDir.endsWith('/releases')") &&
    serverPackage.includes('"update:online:start": "node dist/scripts/start-system-update-task.js"') &&
    releaseWorkflow.includes('fetch-depth: 0') &&
    releaseWorkflow.includes('cp -r deploy/* release/deploy/') &&
    rootPackage.includes('"update:online": "bash scripts/apply-online-update.sh"') &&
    installPanel.includes('git init -q') &&
    installPanel.includes('git fetch --tags --force --quiet origin') &&
    onlineScript.includes('node "$APP_DIR/server/dist/scripts/start-system-update-task.js"') &&
    onlineScript.includes('git rev-parse --is-inside-work-tree') &&
    read('server/src/scripts/start-system-update-task.ts').includes('INSTALL_DIR: installDir'),
  'release package and package scripts must expose the controlled online updater and version metadata'
)

assert.ok(
  atomicMigrationScript.includes('current_link="$INSTALL_DIR/current"') &&
    atomicMigrationScript.includes('releases_dir="$INSTALL_DIR/releases"') &&
    atomicMigrationScript.includes('WorkingDirectory=${app_dir}') &&
    atomicMigrationScript.includes('Environment=INCUDAL_APP_DIR=${app_dir}') &&
    atomicMigrationScript.includes('ExecStart=/usr/bin/node ${app_dir}/server/dist/scripts/run-system-update-task.js %i') &&
    atomicMigrationScript.includes('mv -Tf "$next_link" "$current_link"') &&
    atomicMigrationScript.includes('bash "$current_link/scripts/verify-split-host.sh"'),
  'atomic OTA migration script must create current/releases layout, rewrite systemd units, and verify the split host'
)

console.log('system update guard tests passed')
