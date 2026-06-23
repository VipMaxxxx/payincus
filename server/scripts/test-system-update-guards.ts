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
    route.includes('isValidReleaseTag(targetVersion)') &&
    route.includes('GIT_REPOSITORY_REQUIRED') &&
    route.includes('additionalProperties: false'),
  'system update must only accept controlled release tags, require a Git checkout, and reject extra input'
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
    runTask.includes("verify:production") &&
    runTask.includes("verify:log-header") &&
    runTask.includes("smoke:agent-release"),
  'online updater must build, migrate, guard, restart, and verify before marking success'
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
    rollbackTask.includes('verify-split-host.sh'),
  'online update and rollback must preserve runtime assets and verify the split deployment'
)

assert.ok(
  releaseWorkflow.includes('cp scripts/apply-online-update.sh release/scripts/') &&
    releaseWorkflow.includes("fs.writeFileSync('release/version.json'") &&
    releaseWorkflow.includes('cp -r deploy/* release/deploy/') &&
    installPanel.includes('git init -q') &&
    installPanel.includes('git fetch --tags --force --quiet origin') &&
    onlineScript.includes('node server/dist/scripts/start-system-update-task.js') &&
    onlineScript.includes('git rev-parse --is-inside-work-tree') &&
    rootPackage.includes('"update:online": "bash scripts/apply-online-update.sh"') &&
    serverPackage.includes('"update:online:start": "node --import tsx src/scripts/start-system-update-task.ts"'),
  'release package and package scripts must expose the controlled online updater and version metadata'
)

console.log('system update guard tests passed')
