import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/db/instance-tasks.ts'), 'utf8')
const workerSource = readFileSync(resolve(__dirname, '../src/workers/instanceTaskWorker.ts'), 'utf8')
const instanceRoutesSource = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')

const start = source.indexOf('export async function cancelInstanceTask(')
assert.notEqual(start, -1, 'cancelInstanceTask function not found')
const section = source.slice(start)

assert.ok(
  section.includes('prisma.$transaction'),
  'cancelInstanceTask must run inside a transaction'
)
assert.ok(
  section.includes('tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)'),
  'cancelInstanceTask must share the instance operation lock with worker task claiming'
)
assert.ok(
  section.includes('tx.instanceTask.updateMany'),
  'cancelInstanceTask must use conditional updateMany'
)
assert.ok(
  section.includes("status: 'PENDING'"),
  'cancelInstanceTask must only update still-pending tasks'
)
assert.ok(
  !section.includes('prisma.instanceTask.update({'),
  'cancelInstanceTask must not use unconditional update by id'
)

console.log('instance task cancel race guard tests passed')

const staleCleanupStart = workerSource.indexOf('export async function cleanupStaleTasks()')
assert.notEqual(staleCleanupStart, -1, 'cleanupStaleTasks function not found')
const staleCleanupSection = workerSource.slice(staleCleanupStart, workerSource.indexOf('/**\n * 运行时检查并清理超时的任务', staleCleanupStart))

assert.ok(
  staleCleanupSection.includes('const lightTimeoutThreshold = new Date(Date.now() - LIGHT_TASK_TIMEOUT)') &&
    staleCleanupSection.includes('const heavyTimeoutThreshold = new Date(Date.now() - HEAVY_TASK_TIMEOUT)') &&
    staleCleanupSection.includes('taskType: { in: HEAVY_TASK_TYPES }') &&
    staleCleanupSection.includes('startedAt: { lt: heavyTimeoutThreshold }') &&
    staleCleanupSection.includes('taskType: { notIn: HEAVY_TASK_TYPES }') &&
    staleCleanupSection.includes('startedAt: { lt: lightTimeoutThreshold }'),
  'startup stale-task cleanup must only fail timed-out processing tasks'
)
assert.ok(
  !staleCleanupSection.includes("where: { status: 'PROCESSING' }"),
  'startup stale-task cleanup must not fail every processing task during rolling starts'
)

const timeoutStart = workerSource.indexOf('async function cleanupTimeoutTasks()')
assert.notEqual(timeoutStart, -1, 'cleanupTimeoutTasks function not found')
const timeoutSection = workerSource.slice(timeoutStart, workerSource.indexOf('/**\n * 检查队列并执行任务', timeoutStart))

assert.ok(
  workerSource.includes('const runningTaskIds = new Set<number>()'),
  'worker must track tasks currently executing in this process'
)
assert.ok(
  timeoutSection.includes('.filter(taskId => !runningTaskIds.has(taskId))'),
  'timeout cleanup must not mark tasks that are still executing in this worker as failed'
)
assert.ok(
  timeoutSection.includes("where: {\n      id: { in: timedOutTaskIds },\n      status: 'PROCESSING'"),
  'timeout cleanup must conditionally fail only still-processing tasks'
)

const executeStart = workerSource.indexOf('async function executeTask(')
assert.notEqual(executeStart, -1, 'executeTask function not found')
const executeSection = workerSource.slice(executeStart, workerSource.indexOf('/**\n * 判断错误是否为', executeStart))

assert.ok(
  executeSection.includes('runningTaskIds.add(taskId)') && executeSection.includes('runningTaskIds.delete(taskId)'),
  'executeTask must add and remove running task tracking in a finally block'
)
assert.ok(
  executeSection.includes("where: { id: taskId, status: 'PROCESSING' }") &&
    executeSection.includes("status: 'COMPLETED'"),
  'executeTask completion must not overwrite non-processing task states'
)
assert.ok(
  executeSection.includes("where: { id: taskId, status: 'PROCESSING' }") &&
    executeSection.includes("status: 'FAILED'"),
  'executeTask failure must not overwrite non-processing task states'
)

console.log('instance task worker race guard tests passed')

const createTransactionStart = instanceRoutesSource.indexOf('const result = await prisma.$transaction(async (tx) => {')
assert.notEqual(createTransactionStart, -1, 'instance create transaction not found')
const createTransactionEnd = instanceRoutesSource.indexOf('}, {\n        isolationLevel:', createTransactionStart)
assert.notEqual(createTransactionEnd, -1, 'instance create transaction end not found')
const createTransaction = instanceRoutesSource.slice(createTransactionStart, createTransactionEnd)
const idempotencyClaim = createTransaction.indexOf('const instance = await tx.instance.create({')
const balanceLock = createTransaction.indexOf('const balanceLocked = await tryAdvisoryTransactionLock(')
const balanceDeduction = createTransaction.indexOf('const balanceUpdateResult = await tx.user.updateMany({')

assert.ok(
  idempotencyClaim >= 0 &&
    createTransaction.includes('idempotencyKey: selectedPlan && !flashSaleCheckout ? normalPaidIdempotencyKey : null'),
  'normal paid instance creation must claim its unique idempotency key by inserting the instance'
)
assert.ok(
  balanceLock > idempotencyClaim && balanceDeduction > balanceLock,
  'normal paid instance balance lock and deduction must happen only after the unique idempotency claim'
)
assert.ok(
  instanceRoutesSource.includes("err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'") &&
    instanceRoutesSource.includes('findNormalPaidCreateReplay(user.id, normalPaidIdempotencyKey)') &&
    instanceRoutesSource.includes("code: 'INSTANCE_CREATE_DUPLICATE_REQUEST'"),
  'same-key races must return the existing instance or a duplicate response without a second charge/create'
)
