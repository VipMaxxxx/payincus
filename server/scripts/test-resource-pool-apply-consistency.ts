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
  routeSource.indexOf('await db.applyResourcePoolToInstance({') <
    routeSource.indexOf('await patchInstanceResources(client, instance.incus_id, resourcesToPatch)'),
  'resource-pool apply must durably commit the DB intent before patching Incus'
)

assert.ok(
  routeSource.includes('await db.applyResourcePoolToInstance({'),
  'resource-pool apply route must record success through the atomic DB helper'
)

assert.ok(
  dbSource.includes('export const MAX_RESOURCE_POOL_APPLY_AMOUNT = 104_857_600') &&
  routeSource.includes("amount: { type: 'integer', minimum: 1, maximum: db.MAX_RESOURCE_POOL_APPLY_AMOUNT }") &&
  dbSource.includes('!Number.isSafeInteger(data.amount)') &&
  dbSource.includes('data.amount > MAX_RESOURCE_POOL_APPLY_AMOUNT'),
  'resource-pool apply amount must be positive, safely represented, and bounded'
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
  dbSource.includes('AND "cpu" >= ${poolDebitAmount}') &&
  dbSource.includes('AND "memory" >= ${poolDebitAmount}') &&
  dbSource.includes('AND "disk" >= ${poolDebitAmount}') &&
  dbSource.includes('AND "traffic" >= ${amount}'),
  'resource-pool consumption must be conditional to prevent negative balances under concurrency'
)

assert.ok(
  routeSource.includes('const poolDebitAmount = calculateVipResourcePoolCost(amount, vip.benefit.resourcePoolBonusPercent)') &&
  routeSource.match(/poolDebitAmount,/g)?.length === 4 &&
  dbSource.includes('const poolDebitAmount = data.poolDebitAmount ?? data.amount') &&
  dbSource.includes('poolDebitAmount > data.amount') &&
  dbSource.includes('amount: -poolDebitAmount') &&
  dbSource.includes('const cpuDelta = data.hostResourceDelta.cpuUsed ?? 0'),
  'VIP resource-pool bonus must reduce only pool debit while host capacity remains checked against the full delivered amount'
)

assert.ok(
  dbSource.includes('const applyWhere: Prisma.HostWhereInput = { id: data.hostId }') &&
  dbSource.includes('applyWhere.cpuUsed = { lte: cpuLimit - cpuDelta }') &&
  dbSource.includes('applyWhere.memoryUsed = { lte: memoryLimit - memoryDelta }') &&
  dbSource.includes('applyWhere.diskUsed = { lte: diskLimit - diskDelta }') &&
  dbSource.includes('const hostUpdate = await tx.host.updateMany({') &&
  dbSource.includes('cpuUsed: { increment: cpuDelta }') &&
  dbSource.includes('memoryUsed: { increment: memoryDelta }') &&
  dbSource.includes('diskUsed: { increment: diskDelta }') &&
  dbSource.includes('if (hostUpdate.count === 0)') &&
  dbSource.includes("throw new Error('HOST_RESOURCES_INSUFFICIENT')"),
  'host resource usage must use bounded conditional atomic increments for every dimension'
)

assert.ok(
  routeSource.includes("if (errorMessage === 'HOST_RESOURCES_INSUFFICIENT')") &&
  routeSource.includes("apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, 'Host capacity is insufficient for this resource claim')"),
  'host capacity rejection must return a clear error before Incus is patched'
)

assert.ok(
  dbSource.includes('export async function getResourcePoolApplyReconciliationCandidates') &&
  dbSource.includes("export const RESOURCE_POOL_INCUS_PENDING_PREFIX = '[incus-pending] '") &&
  dbSource.includes("action: 'apply'") &&
  dbSource.includes('remark: { startsWith: RESOURCE_POOL_INCUS_PENDING_PREFIX }') &&
  dbSource.includes('export async function markResourcePoolAppliesReconciled') &&
  routeSource.includes('async function reconcileResourcePoolApplies') &&
  routeSource.includes('const incusInstance = await getInstance(client, instance.incus_id)') &&
  routeSource.includes('await patchInstanceResources(client, instance.incus_id, resources)') &&
  routeSource.includes('await db.markResourcePoolAppliesReconciled(') &&
  routeSource.includes('setInterval(() => void runReconciliation(), RESOURCE_POOL_RECONCILIATION_INTERVAL_MS)') &&
  routeSource.includes("'Resource-pool DB apply committed but Incus patch confirmation failed; reconciliation will retry'"),
  'committed resource-pool applies must be replayable and periodically reconciled against Incus'
)

assert.ok(
  dbSource.includes('SET "monthly_traffic_limit" = COALESCE("monthly_traffic_limit", 0) + ${data.monthlyTrafficDelta}'),
  'traffic apply must increment the monthly traffic limit atomically'
)

assert.ok(
  dbSource.includes("action: 'apply'") &&
  dbSource.includes('amount: -poolDebitAmount') &&
  dbSource.includes('instanceId: data.instanceId'),
  'resource-pool apply helper must write the consumption log in the same transaction'
)

console.log('resource-pool apply consistency checks passed')
