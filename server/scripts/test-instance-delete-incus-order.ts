import { readFileSync } from 'fs'
import { resolve } from 'path'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const end = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + end)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const instancesSource = readFileSync(resolve(repoRoot, 'server/src/routes/instances.ts'), 'utf8')
const hostsSource = readFileSync(resolve(repoRoot, 'server/src/routes/hosts.ts'), 'utf8')

const singleDeleteSection = section(
  instancesSource,
  'fastify.delete<{ Params: { id: string }; Body: { reason?: string } }>(\'/:id\'',
  '  })\n\n  // 添加端口映射'
)

assert(
  instancesSource.includes('async function restoreClaimedInstanceForDelete'),
  'single delete must be able to restore claimed instance status'
)
assert(
  instancesSource.includes('async function deleteIncusInstanceForDelete'),
  'single delete must use a strict Incus delete helper'
)
assert(
  singleDeleteSection.includes('await restoreClaimedInstanceForDelete(instanceId, instance.status as InstanceStatus)'),
  'single delete must restore claimed status when Incus client/delete fails'
)

const singleIncusDelete = indexOfOrThrow(singleDeleteSection, 'await deleteIncusInstanceForDelete(client, instance, request.log)', 'single strict Incus delete')
const singleRefund = indexOfOrThrow(singleDeleteSection, '// ===== 7. 处理退款', 'single refund section')
const singleDbCleanup = indexOfOrThrow(singleDeleteSection, '// ===== 7.1 删除数据库附属记录', 'single DB cleanup section')
const singleResourceRelease = indexOfOrThrow(singleDeleteSection, 'await db.rollbackResources({', 'single resource release')

assert(singleIncusDelete < singleRefund, 'single delete must delete Incus instance before refund')
assert(singleIncusDelete < singleDbCleanup, 'single delete must delete Incus instance before DB cleanup')
assert(singleIncusDelete < singleResourceRelease, 'single delete must delete Incus instance before resource release')
assert(
  !singleDeleteSection.includes('Incus 删除实例失败'),
  'single delete must not swallow Incus delete failures and continue'
)

const singleRefundSection = singleDeleteSection.slice(singleRefund, singleDbCleanup)
assert(
  singleRefundSection.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.user_id)'),
  'single delete refund must use a blocking user balance lock'
)
assert(
  !singleRefundSection.includes('tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE'),
  'single delete refund must not use a nonblocking user balance lock'
)

const batchDeleteSection = section(
  hostsSource,
  'fastify.delete<{\n    Params: { id: string }\n    Body: { instanceIds: number[]; reason?: string; databaseOnly?: boolean }',
  '  })\n\n  // 删除宿主机'
)

assert(
  hostsSource.includes('async function claimHostBatchInstanceForDelete'),
  'host batch delete must claim each instance before remote deletion'
)
assert(
  hostsSource.includes('async function restoreHostBatchDeleteClaim'),
  'host batch delete must be able to restore claimed instance status'
)
assert(
  hostsSource.includes('async function deleteIncusInstanceForHostBatch'),
  'host batch delete must use a strict Incus delete helper'
)
assert(
  batchDeleteSection.includes("code: 'INCUS_CLIENT_UNAVAILABLE'"),
  'host batch delete must fail when Incus client is unavailable in full delete mode'
)
assert(
  batchDeleteSection.includes('await restoreHostBatchDeleteClaim(instance.id, instance.status as InstanceStatus)'),
  'host batch delete must restore claimed status when Incus delete fails'
)

const batchClaim = indexOfOrThrow(batchDeleteSection, 'await claimHostBatchInstanceForDelete(instance.id, instance.status as InstanceStatus)', 'host batch claim')
const batchRemoteCleanup = indexOfOrThrow(batchDeleteSection, '// ===== 1. 删除反代站点', 'host batch remote cleanup')
const batchIncusDelete = indexOfOrThrow(batchDeleteSection, 'await deleteIncusInstanceForHostBatch(client, incusInstanceOperations, instance, fastify.log)', 'host batch strict Incus delete')
const batchRefund = indexOfOrThrow(batchDeleteSection, '// ===== 6. 处理退款', 'host batch refund section')
const batchDbCleanup = indexOfOrThrow(batchDeleteSection, '// ===== 7. 删除数据库附属记录', 'host batch DB cleanup section')
const batchResourceRelease = indexOfOrThrow(batchDeleteSection, 'await db.rollbackResources({', 'host batch resource release')

assert(batchClaim < batchRemoteCleanup, 'host batch delete must claim before remote cleanup')
assert(batchIncusDelete < batchRefund, 'host batch delete must delete Incus instance before refund')
assert(batchIncusDelete < batchDbCleanup, 'host batch delete must delete Incus instance before DB cleanup')
assert(batchIncusDelete < batchResourceRelease, 'host batch delete must delete Incus instance before resource release')

const batchRefundSection = batchDeleteSection.slice(batchRefund, batchDbCleanup)
assert(
  batchRefundSection.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)'),
  'host batch delete refund must use a blocking user balance lock'
)
assert(
  !batchRefundSection.includes('tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE'),
  'host batch delete refund must not use a nonblocking user balance lock'
)

console.log('instance delete Incus ordering checks passed')
