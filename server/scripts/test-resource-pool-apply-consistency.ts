import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/resource-pool.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/resource-pool.ts'), 'utf8')
const locksSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const checkinDbSource = readFileSync(resolve(__dirname, '../src/db/checkin.ts'), 'utf8')
const checkinRouteSource = readFileSync(resolve(__dirname, '../src/routes/checkin.ts'), 'utf8')
const lotterySource = readFileSync(resolve(__dirname, '../src/db/lottery.ts'), 'utf8')
const logsRouteSection = routeSource.slice(
  routeSource.indexOf("  // ==================== 获取资源池变动记录 ===================="),
  routeSource.indexOf("  // ==================== 获取用户可应用资源的实例列表 ====================")
)

assert.ok(
  routeSource.includes("import { acquireLock, releaseLock } from '../lib/distributed-lock.js'"),
  'resource-pool apply route must lock across the external Incus operation'
)

assert.ok(
  routeSource.includes("import type { RedeemCodeType, ResourcePoolAction } from '@prisma/client'"),
  'resource-pool routes must type query filters against Prisma enums'
)

assert.ok(
  routeSource.includes('const RESOURCE_POOL_ACTIONS = new Set<ResourcePoolAction>([') &&
  routeSource.includes("'checkin'") &&
  routeSource.includes("'system_redeem'"),
  'resource-pool log action filters must be allowlisted'
)

assert.ok(
  routeSource.includes("const RESOURCE_POOL_RESOURCE_TYPES = new Set<RedeemCodeType>(['c', 'r', 'd', 't'])"),
  'resource-pool log resource-type filters must only allow resources that can enter the pool'
)

assert.ok(
  routeSource.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
  routeSource.includes('function parseNonNegativeIntegerQuery(value: string | undefined, fallback: number): number'),
  'resource-pool logs route must strictly parse pagination query values'
)

assert.ok(
  routeSource.includes('action: normalizeResourcePoolAction(action)') &&
  routeSource.includes('resourceType: normalizeResourcePoolType(resourceType)') &&
  routeSource.includes('limit: parseClampedPositiveIntegerQuery(limit, 20, 100)') &&
  routeSource.includes('offset: parseNonNegativeIntegerQuery(offset, 0)'),
  'resource-pool logs route must normalize filters and pagination before DB reads'
)

const forbiddenLogQueryPatterns = [
  'action: action as any',
  'resourceType: resourceType as RedeemCodeType',
  'limit: limit ? Number(limit) : 20',
  'offset: offset ? Number(offset) : 0'
]

for (const pattern of forbiddenLogQueryPatterns) {
  assert.ok(
    !logsRouteSection.includes(pattern),
    `resource-pool logs route must not use unsafe query handling: ${pattern}`
  )
}

assert.ok(
  routeSource.includes('async function withResourcePoolApplyLocks'),
  'resource-pool apply route must define a scoped lock helper'
)

assert.ok(
  routeSource.includes('`resource-pool:${userId}:${resourceType}`') &&
  routeSource.includes('`instance:${instanceId}:resource-pool-apply`'),
  'resource-pool apply route must serialize per user/resource type and instance'
)

assert.ok(
  routeSource.includes('if (!host.enable_resource_pool)'),
  'resource-pool apply route must reject direct POSTs to hosts with resource-pool disabled'
)

assert.ok(
  !routeSource.includes('await db.deductFromResourcePool('),
  'resource-pool apply route must not deduct the pool before external resource delivery'
)

assert.ok(
  routeSource.includes('const instance = await db.getInstanceById(instanceId)') &&
  routeSource.includes('const host = await db.getHostById(instance.host_id)'),
  'resource-pool apply route must re-read instance and host after acquiring locks'
)

assert.ok(
  routeSource.includes('await patchInstanceResources(client, instance.incus_id, { cpu: newCpu })') &&
  routeSource.includes('await patchInstanceResources(client, instance.incus_id, { memory: newMemory })') &&
  routeSource.includes('await patchInstanceResources(client, instance.incus_id, { disk: newDisk })'),
  'CPU, memory, and disk applies must patch Incus before recording successful pool consumption'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, instance\.incus_id, \{ cpu: instance\.cpu \}\)/),
  'CPU apply must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, instance\.incus_id, \{ memory: instance\.memory \}\)/),
  'memory apply must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, instance\.incus_id, \{ disk: instance\.disk \}\)/),
  'disk apply must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.includes('await db.applyResourcePoolToInstance({'),
  'resource-pool apply route must record success through the atomic DB helper'
)

assert.ok(
  locksSource.includes('export const USER_RESOURCE_POOL_LOCK_NAMESPACE = 4114'),
  'resource-pool DB writes must have a dedicated advisory-lock namespace'
)

assert.ok(
  dbSource.includes('export async function applyResourcePoolToInstance'),
  'resource-pool DB module must expose an atomic apply helper'
)

assert.ok(
  dbSource.includes('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, data.userId)') &&
  dbSource.includes('await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)'),
  'resource-pool atomic apply helper must lock both user pool and instance state'
)

assert.ok(
  dbSource.includes('export async function addToResourcePool') &&
  dbSource.includes('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') &&
  dbSource.indexOf('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') <
    dbSource.indexOf('await tx.userResourcePool.upsert({'),
  'resource-pool grant helper must lock the user pool before adding resources'
)

assert.ok(
  dbSource.includes('export async function deductFromResourcePool') &&
  dbSource.includes('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') &&
  dbSource.includes('WHERE "user_id" = ${userId}') &&
  dbSource.includes('AND "cpu" >= ${amount}') &&
  dbSource.includes('AND "traffic" >= ${trafficAmount}'),
  'legacy resource-pool deduction helper must lock and conditionally decrement the user pool'
)

assert.ok(
  checkinDbSource.includes('USER_RESOURCE_POOL_LOCK_NAMESPACE') &&
  checkinDbSource.includes('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') &&
  checkinDbSource.includes("throw new Error('CHECKIN_ALREADY_TODAY')"),
  'check-in resource grants must lock the user pool and recheck daily state inside the transaction'
)

assert.ok(
  checkinRouteSource.includes("if (errorMessage === 'CHECKIN_ALREADY_TODAY')") &&
  checkinRouteSource.includes('apiError(ErrorCode.CHECKIN_ALREADY_TODAY)'),
  'check-in route must map transaction-level duplicate check-in detection to the business error'
)

assert.ok(
  lotterySource.includes('USER_RESOURCE_POOL_LOCK_NAMESPACE') &&
  lotterySource.includes('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') &&
  lotterySource.indexOf('await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)') <
    lotterySource.indexOf('await tx.userResourcePool.upsert({'),
  'lottery resource prizes must lock the user pool before adding resources'
)

assert.ok(
  dbSource.includes('WHERE "user_id" = ${data.userId}') &&
  dbSource.includes('AND "cpu" >= ${data.amount}') &&
  dbSource.includes('AND "memory" >= ${data.amount}') &&
  dbSource.includes('AND "disk" >= ${data.amount}') &&
  dbSource.includes('AND "traffic" >= ${amount}'),
  'resource-pool consumption must be conditional to prevent negative balances under concurrency'
)

assert.ok(
  dbSource.includes('cpuUsed: { increment: data.hostResourceDelta.cpuUsed }') &&
  dbSource.includes('memoryUsed: { increment: data.hostResourceDelta.memoryUsed }') &&
  dbSource.includes('diskUsed: { increment: data.hostResourceDelta.diskUsed }'),
  'host resource usage must be incremented instead of absolute-written from stale reads'
)

assert.ok(
  dbSource.includes('SET "monthly_traffic_limit" = COALESCE("monthly_traffic_limit", 0) + ${data.monthlyTrafficDelta}'),
  'traffic apply must increment the monthly traffic limit atomically'
)

assert.ok(
  dbSource.includes("action: 'apply'") &&
  dbSource.includes('amount: -data.amount') &&
  dbSource.includes('instanceId: data.instanceId'),
  'resource-pool apply helper must write the consumption log in the same transaction'
)

console.log('resource-pool apply consistency checks passed')
