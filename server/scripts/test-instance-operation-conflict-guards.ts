import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const instancesSource = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')
const hostsSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const userConflictGuard = sectionBetween(
  instancesSource,
  'async function rejectActiveInstanceWorkflowConflict(',
  'function isUniqueConstraintError('
)

assert.ok(
  userConflictGuard.includes('prisma.restoreTask.findFirst') &&
    userConflictGuard.includes('prisma.backupUploadTask.findFirst') &&
    userConflictGuard.includes('getActiveTaskForInstance(instanceId)'),
  'user instance operation guard must check restore, backup upload, and instance tasks'
)
assert.ok(
  userConflictGuard.includes("code: 'RESTORE_IN_PROGRESS'") &&
    userConflictGuard.includes("code: 'UPLOAD_IN_PROGRESS'") &&
    userConflictGuard.includes('sendActiveTaskConflict(reply, activeInstanceTask)'),
  'user instance operation guard must return explicit 409 conflicts for each active workflow'
)

const guardedUserRoutes = [
  ['start', '// 启动实例', '// 停止实例'],
  ['stop', '// 停止实例', '// 重启实例'],
  ['restart', '// 重启实例', '// 封停实例'],
  ['rebuild', '// 重装系统', '// 重建实例'],
  ['recreate', '// 重建实例', '// 删除实例'],
  ['clone', '// ==================== 复制实例 ====================', '// ==================== 重命名实例 ====================']
]

for (const [name, startMarker, endMarker] of guardedUserRoutes) {
  const routeSection = sectionBetween(instancesSource, startMarker, endMarker)
  assert.ok(
    routeSection.includes('rejectActiveInstanceWorkflowConflict(reply, instanceId)'),
    `${name} route must reject active restore/upload/instance workflows before queueing an instance task`
  )
}

const hostConflictGuard = sectionBetween(
  hostsSource,
  'async function rejectActiveHostInstanceWorkflowConflict(',
  'async function createHostInstanceTaskOrConflict('
)

assert.ok(
  hostConflictGuard.includes('prisma.restoreTask.findFirst') &&
    hostConflictGuard.includes('prisma.backupUploadTask.findFirst') &&
    hostConflictGuard.includes('getActiveTaskForInstance(instanceId)'),
  'host dangerous-action guard must check restore, backup upload, and instance tasks'
)
assert.ok(
  hostsSource.includes('error instanceof InstanceTaskConflictError') &&
    hostsSource.includes('sendHostActiveTaskConflict(reply, error.activeTask)'),
  'host dangerous-action task creation must convert concurrent instance task conflicts to 409'
)

const hostDangerousAction = sectionBetween(
  hostsSource,
  "}>('/:id/ops/instances/:instanceId/dangerous-action'",
  "await createLog(user.id, 'host', `host.ops.${action}`"
)
assert.ok(
  hostDangerousAction.includes('rejectActiveHostInstanceWorkflowConflict(reply, instanceId)'),
  'host dangerous-action route must reject active restore/upload/instance workflows before queueing'
)
assert.ok(
  hostDangerousAction.includes('createHostInstanceTaskOrConflict(reply, {') &&
    hostDangerousAction.includes('if (!task) return'),
  'host dangerous-action route must use conflict-safe task creation'
)

console.log('instance operation conflict guard tests passed')
