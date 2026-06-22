import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/checkin.ts'), 'utf8')
const redeemDbSource = readFileSync(resolve(__dirname, '../src/db/redeem-codes.ts'), 'utf8')

assert.ok(
  routeSource.includes("import { acquireLock, releaseLock } from '../lib/distributed-lock.js'"),
  'system redeem flow must use a distributed lock across the external Incus operation'
)

assert.ok(
  routeSource.includes('async function withSystemRedeemLocks'),
  'system redeem flow must define a scoped lock helper'
)

assert.ok(
  routeSource.includes('`redeem-code:${redeemCodeId}`'),
  'system redeem flow must serialize per redeem code'
)

assert.ok(
  routeSource.includes('`redeem-batch:${batchId}:user:${userId}`'),
  'system redeem flow must serialize same-batch usage per user'
)

assert.ok(
  routeSource.includes('const currentCodeRecord = await db.getRedeemCodeByCode(trimmedCode)'),
  'system redeem flow must re-read the code after acquiring locks'
)

assert.ok(
  routeSource.includes('const currentInstance = await db.getInstanceById(instanceId)'),
  'system redeem flow must re-read the target instance after acquiring locks'
)

assert.ok(
  routeSource.includes('await patchInstanceResources(client, currentInstance.incus_id, { cpu: newCpu })') &&
  routeSource.includes('await patchInstanceResources(client, currentInstance.incus_id, { memory: newMemory })') &&
  routeSource.includes('await patchInstanceResources(client, currentInstance.incus_id, { disk: newDisk })'),
  'CPU, memory, and disk redeems must patch Incus before recording successful use'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, currentInstance\.incus_id, \{ cpu: currentInstance\.cpu \}\)/),
  'CPU redeem must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, currentInstance\.incus_id, \{ memory: currentInstance\.memory \}\)/),
  'memory redeem must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.match(/patchedRollback = async \(\) => \{[\s\S]*?patchInstanceResources\(client, currentInstance\.incus_id, \{ disk: currentInstance\.disk \}\)/),
  'disk redeem must prepare an Incus rollback if DB recording fails'
)

assert.ok(
  routeSource.includes('await db.applySystemRedeemCodeToInstance({'),
  'system redeem success must be recorded through the atomic DB helper'
)

assert.ok(
  routeSource.includes("if (!['c', 'r', 'd', 't'].includes(codeType))"),
  'system redeem flow must reject unsupported non-resource code types before any old consume path'
)

assert.ok(
  !routeSource.includes("await db.addPoints(user.id, codeValue, 'checkin', undefined, '兑换码奖励')"),
  'system redeem flow must not keep the old non-atomic points redeem branch'
)

assert.ok(
  redeemDbSource.includes('export async function applySystemRedeemCodeToInstance'),
  'redeem DB module must expose an atomic application helper'
)

assert.ok(
  redeemDbSource.includes('await advisoryTransactionLock(tx, REDEEM_CODE_LOCK_NAMESPACE, data.redeemCodeId)') &&
  redeemDbSource.includes('await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)'),
  'atomic redeem application must lock both redeem code and instance state'
)

assert.ok(
  redeemDbSource.includes('"enabled" = true') &&
  redeemDbSource.includes('"expires_at" IS NULL OR "expires_at" >') &&
  redeemDbSource.includes('"used_count" < "max_uses"'),
  'atomic redeem application must revalidate enabled, expiry, and usage limits'
)

assert.ok(
  redeemDbSource.includes('cpuUsed: { increment: data.hostResourceDelta.cpuUsed }') &&
  redeemDbSource.includes('memoryUsed: { increment: data.hostResourceDelta.memoryUsed }') &&
  redeemDbSource.includes('diskUsed: { increment: data.hostResourceDelta.diskUsed }'),
  'host resource usage must be incremented instead of absolute-written from stale reads'
)

assert.ok(
  redeemDbSource.includes('SET "monthly_traffic_limit" = COALESCE("monthly_traffic_limit", 0) + ${data.monthlyTrafficDelta}'),
  'traffic redeem must increment the monthly traffic limit atomically'
)

assert.ok(
  redeemDbSource.includes('await tx.redeemCodeUsage.create({'),
  'atomic redeem application must create usage in the same transaction as resource DB updates'
)

console.log('system redeem consistency checks passed')
