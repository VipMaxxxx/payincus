import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function section(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  if (endMarker) assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const restoreSource = readFileSync(resolve(__dirname, '../src/db/restore-tasks.ts'), 'utf8')
const uploadSource = readFileSync(resolve(__dirname, '../src/db/backup-upload-tasks.ts'), 'utf8')
const backupDbSource = readFileSync(resolve(__dirname, '../src/db/backups.ts'), 'utf8')
const quotaSource = readFileSync(resolve(__dirname, '../src/db/quota-operations.ts'), 'utf8')
const routeSource = readFileSync(resolve(__dirname, '../src/routes/backups.ts'), 'utf8')
const restoreWorkerSource = readFileSync(resolve(__dirname, '../src/workers/restoreTaskWorker.ts'), 'utf8')
const uploadWorkerSource = readFileSync(resolve(__dirname, '../src/workers/backupUploadWorker.ts'), 'utf8')
const appSource = readFileSync(resolve(__dirname, '../src/app.ts'), 'utf8')

const createRestoreSection = section(restoreSource, 'export async function createRestoreTask(', '/**\n * 获取恢复任务')
assert.ok(createRestoreSection.includes('prisma.$transaction'), 'createRestoreTask must be transactional')
assert.ok(
  createRestoreSection.includes('tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)'),
  'createRestoreTask must acquire the instance operation lock'
)
assert.ok(
  createRestoreSection.includes("status: { in: ['PENDING', 'PROCESSING'] }"),
  'createRestoreTask must check active restore tasks inside the transaction'
)

const cancelRestoreSection = section(restoreSource, 'export async function cancelRestoreTask(', '// hasActiveRestoreTask')
assert.ok(cancelRestoreSection.includes('prisma.$transaction'), 'cancelRestoreTask must be transactional')
assert.ok(
  cancelRestoreSection.includes('tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)'),
  'cancelRestoreTask must share the worker instance operation lock'
)
assert.ok(cancelRestoreSection.includes('tx.restoreTask.updateMany'), 'cancelRestoreTask must use conditional updateMany')
assert.ok(cancelRestoreSection.includes("status: 'PENDING'"), 'cancelRestoreTask must only update pending tasks')

const createUploadSection = section(uploadSource, 'export async function createBackupUploadTask(', '/**\n * 根据 ID 获取任务')
assert.ok(createUploadSection.includes('prisma.$transaction'), 'createBackupUploadTask must be transactional')
assert.ok(
  createUploadSection.includes('tryAdvisoryTransactionLock(tx, USER_BACKUP_UPLOAD_LOCK_NAMESPACE, data.userId)'),
  'createBackupUploadTask must acquire the per-user upload lock'
)
assert.ok(
  createUploadSection.includes("status: { in: ['PENDING', 'PROCESSING'] }"),
  'createBackupUploadTask must check active user upload tasks inside the transaction'
)

assert.ok(
  uploadSource.includes('const BACKUP_UPLOAD_TASK_STATUSES = new Set<BackupUploadTaskStatus>') &&
    uploadSource.includes("'PENDING'") &&
    uploadSource.includes("'PROCESSING'") &&
    uploadSource.includes("'COMPLETED'") &&
    uploadSource.includes("'FAILED'"),
  'backup upload task helpers must define an explicit status allowlist'
)

assert.ok(
  uploadSource.includes('function normalizeBackupUploadTaskLimit(limit: number | undefined): number') &&
    uploadSource.includes('Math.min(Math.max(limit, 1), 100)'),
  'backup upload task list helper must clamp invalid or excessive limits'
)

assert.ok(
  uploadSource.includes('function normalizeBackupUploadTaskStatus(status: BackupUploadTaskStatus | undefined): BackupUploadTaskStatus | undefined') &&
    uploadSource.includes('BACKUP_UPLOAD_TASK_STATUSES.has(status)'),
  'backup upload task list helper must ignore unknown status filters'
)

const listUploadSection = section(uploadSource, 'export async function getBackupUploadTasksByUserId(', '/**\n * 获取实例的上传任务列表')
assert.ok(
  listUploadSection.includes('const limit = normalizeBackupUploadTaskLimit(options?.limit)') &&
    listUploadSection.includes('const status = normalizeBackupUploadTaskStatus(options?.status)') &&
    listUploadSection.includes('...(status ? { status } : {})') &&
    listUploadSection.includes('take: limit'),
  'getBackupUploadTasksByUserId must query with sanitized limit and status values'
)
assert.ok(
  !listUploadSection.includes('take: options?.limit || 50') &&
    !listUploadSection.includes('...(options?.status ? { status: options.status } : {})'),
  'getBackupUploadTasksByUserId must not trust raw caller limit or status options'
)

const cancelUploadSection = section(uploadSource, 'export async function cancelBackupUploadTask(', '/**\n * 获取实例的活跃上传任务')
assert.ok(cancelUploadSection.includes('prisma.$transaction'), 'cancelBackupUploadTask must be transactional')
assert.ok(
  cancelUploadSection.includes('tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)'),
  'cancelBackupUploadTask must share the worker instance operation lock'
)
assert.ok(cancelUploadSection.includes('tx.backupUploadTask.updateMany'), 'cancelBackupUploadTask must use conditional updateMany')
assert.ok(cancelUploadSection.includes("status: 'PENDING'"), 'cancelBackupUploadTask must only update pending tasks')

assert.ok(routeSource.includes('if (!taskId)'), 'restore route must handle concurrent create conflicts')
assert.ok(routeSource.includes('if (!cancelledTask)'), 'backup routes must handle failed cancellation races')
assert.ok(routeSource.includes('if (!task)'), 'upload route must handle concurrent create conflicts')
assert.ok(
  routeSource.includes('const reservation = await db.createBackupWithQuotaReservation({') &&
    routeSource.includes('const backupId = reservation.backupId') &&
    !routeSource.includes('const backupId = await db.createBackup({'),
  'backup create route must reserve quota and creating rows atomically before Incus backup creation'
)
const createBackupReservationSection = section(
  backupDbSource,
  'export async function createBackupWithQuotaReservation(',
  '/**\n * 更新备份状态'
)
assert.ok(
  createBackupReservationSection.includes('prisma.$transaction') &&
    createBackupReservationSection.includes('advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)'),
  'backup quota reservation must run under the instance operation advisory transaction lock'
)
assert.ok(
  createBackupReservationSection.includes("status: { in: ['creating', 'ready'] }") &&
    createBackupReservationSection.includes('if (current >= limit)') &&
    createBackupReservationSection.includes("status: 'creating'"),
  'backup quota reservation must count reserved/ready backups and create the reserved row inside the lock'
)
const staleBackupCleanupSection = section(
  backupDbSource,
  'export async function cleanupStaleCreatingBackups(',
  '/**\n * 删除备份'
)
assert.ok(
  staleBackupCleanupSection.includes('const cutoff = new Date(Date.now() - maxAgeMs)') &&
    staleBackupCleanupSection.includes("status: 'creating'") &&
    staleBackupCleanupSection.includes('createdAt: { lt: cutoff }') &&
    staleBackupCleanupSection.includes("status: 'error'") &&
    staleBackupCleanupSection.includes('return result.count'),
  'stale backup cleanup must release only old creating rows by marking them error'
)
const checkBackupQuotaSection = section(
  quotaSource,
  'export async function checkBackupQuota(',
  '/**\n * 同步用户配额使用量'
)
assert.ok(
  checkBackupQuotaSection.includes("status: { in: ['creating', 'ready'] }") &&
    !checkBackupQuotaSection.includes("status: { not: 'deleted' }"),
  'backup quota checks must not let failed error backups permanently consume quota'
)
assert.ok(
  routeSource.includes("reply.raw.on('finish'") &&
    routeSource.includes("finalizeExportTask('completed')"),
  'backup export download must only mark completed after the response finish event'
)
assert.ok(
  routeSource.includes("reply.raw.on('close'") &&
    routeSource.includes('!reply.raw.writableEnded') &&
    routeSource.includes('Download connection closed before completion'),
  'backup export download must treat premature connection close as an error'
)
const restoreRollbackRouteSection = section(
  routeSource,
  "'/:instanceId/restore/:taskId/rollback',",
  '  // 取消恢复任务'
)
const rollbackOriginalCheckIndex = restoreRollbackRouteSection.indexOf('const originalExists = await instanceExists(client, task.originalIncusId)')
const rollbackUnsafeIndex = restoreRollbackRouteSection.indexOf("error: 'ROLLBACK_UNSAFE'")
const rollbackStartIndex = restoreRollbackRouteSection.indexOf('await startInstance(client, task.originalIncusId)')
const rollbackTempCheckIndex = restoreRollbackRouteSection.indexOf('if (task.tempInstanceName)')
const rollbackDeleteTempIndex = restoreRollbackRouteSection.indexOf('await deleteInstance(client, task.tempInstanceName)')
assert.ok(
  rollbackOriginalCheckIndex !== -1 &&
    rollbackUnsafeIndex !== -1 &&
    rollbackStartIndex !== -1 &&
    rollbackTempCheckIndex !== -1 &&
    rollbackDeleteTempIndex !== -1,
  'restore rollback route must check original instance safety and keep temp cleanup explicit'
)
assert.ok(
  rollbackOriginalCheckIndex < rollbackStartIndex &&
    rollbackStartIndex < rollbackTempCheckIndex &&
    rollbackTempCheckIndex < rollbackDeleteTempIndex,
  'restore rollback route must start the original instance before deleting the temporary restored instance'
)
assert.ok(
  !restoreRollbackRouteSection.includes('Failed to start original instance') &&
    !restoreRollbackRouteSection.includes('fastify.log.warn(`Failed to delete temp instance'),
  'restore rollback route must not swallow original-start or temp-delete failures while reporting success'
)

const restoreTimeoutSection = section(
  restoreWorkerSource,
  'async function cleanupTimeoutTasks()',
  '/**\n * 检查队列并执行任务'
)
assert.ok(
  restoreWorkerSource.includes('const runningRestoreTaskIds = new Set<number>()'),
  'restore worker must track tasks currently executing in this process'
)
assert.ok(
  restoreTimeoutSection.includes('.filter(taskId => !runningRestoreTaskIds.has(taskId))'),
  'restore timeout cleanup must not mark tasks still executing in this worker as failed'
)
assert.ok(
  restoreTimeoutSection.includes("where: {\n            id: { in: timedOutTaskIds },\n            status: 'PROCESSING'"),
  'restore timeout cleanup must conditionally fail only still-processing tasks'
)

const restoreExecuteSection = section(
  restoreWorkerSource,
  'async function executeRestoreTask(',
  '/**\n * 启动恢复任务 Worker'
)
assert.ok(
  restoreExecuteSection.includes('runningRestoreTaskIds.add(taskId)') &&
    restoreExecuteSection.includes('runningRestoreTaskIds.delete(taskId)'),
  'restore worker must remove running task tracking in a finally block'
)
assert.ok(
  restoreExecuteSection.includes("where: { id: taskId, status: 'PROCESSING' }") &&
    restoreExecuteSection.includes("status: 'COMPLETED'") &&
    restoreExecuteSection.includes("status: 'FAILED'"),
  'restore worker final status writes must not overwrite non-processing task states'
)
assert.ok(
  restoreExecuteSection.includes('await prisma.backup.updateMany({') &&
    restoreExecuteSection.includes('where: {\n                instanceId: task.instanceId\n            }') &&
    restoreExecuteSection.includes("data: { status: 'deleted' }"),
  'restore worker must mark every old DB backup deleted after deleting the original Incus instance and its backups'
)
assert.ok(
  !restoreExecuteSection.includes('id: { not: task.backupId'),
  'restore worker must not keep the used backup as ready after deleting all original Incus backups'
)

const uploadTimeoutSection = section(
  uploadWorkerSource,
  'async function cleanupTimeoutUploadTasks()',
  '/**\n * 检查队列并执行任务'
)
assert.ok(
  uploadWorkerSource.includes('const runningUploadTaskIds = new Set<number>()'),
  'upload worker must track tasks currently executing in this process'
)
assert.ok(
  uploadTimeoutSection.includes('.filter(taskId => !runningUploadTaskIds.has(taskId))'),
  'upload timeout cleanup must not mark tasks still executing in this worker as failed'
)
assert.ok(
  uploadTimeoutSection.includes("where: {\n            id: { in: timedOutTaskIds },\n            status: 'PROCESSING'"),
  'upload timeout cleanup must conditionally fail only still-processing tasks'
)

const uploadExecuteSection = section(
  uploadWorkerSource,
  'async function executeUploadTask(',
  '/**\n * 启动备份上传 Worker'
)
assert.ok(
  uploadExecuteSection.includes('runningUploadTaskIds.add(taskId)') &&
    uploadExecuteSection.includes('runningUploadTaskIds.delete(taskId)'),
  'upload worker must remove running task tracking in a finally block'
)
assert.ok(
  uploadExecuteSection.includes("where: { id: taskId, status: 'PROCESSING' }") &&
    uploadExecuteSection.includes("status: 'COMPLETED'") &&
    uploadExecuteSection.includes("status: 'PENDING'") &&
    uploadExecuteSection.includes("status: 'FAILED'"),
  'upload worker final/retry status writes must not overwrite non-processing task states'
)

assert.ok(
  appSource.includes('cleanupStaleTasks: cleanupStaleRestoreTasks') &&
    appSource.includes('cleanupStaleUploadTasks') &&
    appSource.includes('cleanupStaleCreatingBackups') &&
    appSource.includes('startRestoreWorker()') &&
    appSource.includes('startBackupUploadWorker()'),
  'app startup must clean stale creating backups and start restore/upload workers for queued backup tasks'
)
assert.ok(
  appSource.includes('stopRestoreWorker()') &&
    appSource.includes('stopBackupUploadWorker()'),
  'app graceful shutdown must stop restore and backup upload workers'
)
assert.ok(
  !appSource.includes('failRetiredBackupTasks') &&
    !appSource.includes('备份恢复功能已下线') &&
    !appSource.includes('备份上传功能已下线'),
  'app startup must not fail pending restore/upload tasks as retired features'
)

console.log('backup task race guard tests passed')
