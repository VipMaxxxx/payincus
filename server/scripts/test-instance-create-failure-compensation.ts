import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const instancesSource = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')
const managedProvisionSource = readFileSync(resolve(__dirname, '../src/lib/managed-instance-provision.ts'), 'utf8')
const appSource = readFileSync(resolve(__dirname, '../src/app.ts'), 'utf8')
const compensationSource = readFileSync(resolve(__dirname, '../src/db/instance-provisioning-compensation.ts'), 'utf8')

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert.ok(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const relativeEnd = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + relativeEnd)
}

const compensationSection = compensationSource

const failureSection = section(
  instancesSource,
  '  } catch (error) {\n    const errorMessage = error instanceof Error ? error.message : String(error)',
  '    throw error\n  }\n}'
)

assert.ok(
  failureSection.includes('if (updateResult.count > 0 && userId && resources)') &&
    failureSection.includes('await db.compensateFailedInstancePurchase(instanceId, userId, host.id)'),
  'provisioning failure must compensate billing only after this worker wins the creating->error transition'
)

assert.ok(
  appSource.includes('const { getStuckCreatingInstances, getHostById, compensateFailedInstancePurchase, releasePublicIpv4ForInstance } = await import') &&
    appSource.includes("status: 'creating' // 原子条件：只有状态仍为 creating 时才更新") &&
    appSource.includes('const compensation = await compensateFailedInstancePurchase(instance.id, instance.user_id, instance.host_id)'),
  'create-timeout cleanup must run the same paid purchase compensation after winning creating->error transition'
)

assert.ok(
  appSource.includes('const instanceCreationReservesPorts = (networkMode: string) => networkModeAllowsPortMapping(networkMode)') &&
    appSource.includes('portCount: instanceCreationReservesPorts(instance.network_mode) ? (instance.port_limit || 0) : 0') &&
    appSource.includes('if (networkModeNeedsPublicIpv4(instance.network_mode))') &&
    appSource.includes('await prisma.$transaction((tx) => releasePublicIpv4ForInstance(tx, instance.id))'),
  'create-timeout cleanup must use the shared network-mode helper for port quota and release reserved public IPv4 addresses'
)

const adminAsyncSection = section(
  adminBillingSource,
  'async function createInstanceAsync(',
  '\n}\n'
)

assert.ok(
  adminAsyncSection.includes("where: { id: instanceId, status: 'creating' }") &&
    adminAsyncSection.includes('await db.rollbackResources({') &&
    adminAsyncSection.includes('await prisma.$transaction((tx) => db.releasePublicIpv4ForInstance(tx, instanceId))') &&
    adminAsyncSection.includes('await db.compensateFailedInstancePurchase(instanceId, userId, host.id)') &&
    adminAsyncSection.includes('await deleteInstance(client, config.name)'),
  'admin paid instance async failures must atomically claim creating->error, release host resources/public IPv4, compensate billing, and clean Incus leftovers'
)

assert.ok(
  adminAsyncSection.includes('await stopInstance(client, config.name, true)') &&
    adminAsyncSection.includes('await deleteInstance(client, config.name)') &&
    adminAsyncSection.indexOf("where: { id: instanceId, status: 'creating' }") <
      adminAsyncSection.indexOf('console.log(`[Admin Provisioning] 实例 ${instanceId} 创建成功`)'),
  'admin async success must use conditional creating->running update and clean Incus if timeout cleanup won the race'
)

const managedAsyncSection = section(
  managedProvisionSource,
  'export async function provisionManagedInstanceAsync(',
  '\n}\n'
)

assert.ok(
  managedAsyncSection.includes("where: { id: instanceId, status: 'creating' }") &&
    managedAsyncSection.includes('await db.rollbackResources({') &&
    managedAsyncSection.includes('await prisma.$transaction((tx) => db.releasePublicIpv4ForInstance(tx, instanceId))') &&
    managedAsyncSection.includes('await db.compensateFailedInstancePurchase(instanceId, instance.userId, instance.hostId)') &&
    managedAsyncSection.includes('await deleteInstance(client, config.name)'),
  'managed host-owner/admin gifted instance async failures must claim creating->error, release resources/public IPv4, compensate any paid ledger, and clean Incus leftovers'
)

assert.ok(
  instancesSource.includes('宿主机 ${host.name} 没有可用独立 IPv4 地址') &&
    instancesSource.includes('[Provisioning] 独立 IPv4 分配失败后资源回滚失败') &&
    instancesSource.includes('[Provisioning] 独立 IPv4 分配失败后计费补偿失败'),
  'user instance creation must rollback resources and compensate purchase when public IPv4 allocation races to empty'
)

assert.ok(
  adminBillingSource.includes('宿主机 ${host.name} 没有可用独立 IPv4 地址') &&
    adminBillingSource.includes('[Admin Create Instance] 独立 IPv4 分配失败后资源回滚失败') &&
    adminBillingSource.includes('[Admin Create Instance] 独立 IPv4 分配失败后计费补偿失败'),
  'admin instance creation must rollback resources and compensate purchase when public IPv4 allocation races to empty'
)

const hostRoutesSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
assert.ok(
  hostRoutesSource.includes('宿主机 ${lockedHost!.name} 没有可用独立 IPv4 地址') &&
    hostRoutesSource.includes('[Host Create For User] failed to rollback resources after public IPv4 allocation miss') &&
    hostRoutesSource.includes('[Host Create For User] failed to compensate purchase after public IPv4 allocation miss'),
  'host-owner instance creation must rollback resources and compensate purchase when public IPv4 allocation races to empty'
)

assert.ok(
  managedAsyncSection.includes('await stopInstance(client, config.name, true)') &&
    managedAsyncSection.includes('await deleteInstance(client, config.name)'),
  'managed async success must clean Incus if timeout cleanup won the creating status race'
)

assert.ok(
  compensationSection.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)'),
  'failed paid provisioning refund must use a blocking user balance lock'
)

assert.ok(
  compensationSection.includes("type: 'newPurchase'") &&
    compensationSection.includes("type: 'refund'") &&
    compensationSection.includes("remark: { contains: '实例创建失败自动退款' }"),
  'failed paid provisioning refund must be idempotent against existing failure refunds'
)

assert.ok(
  compensationSection.includes("data: { balance: { increment: refundAmount } }") &&
    compensationSection.includes("type: 'refund'") &&
    compensationSection.includes('amount: refundAmount') &&
    compensationSection.includes('amount: -refundAmount') &&
    compensationSection.includes('balanceLogId: balanceLog.id'),
  'failed paid provisioning must refund user balance and create matching billing refund record'
)

assert.ok(
  compensationSection.includes('USER_AFF_BALANCE_LOCK_NAMESPACE') &&
    compensationSection.includes("type: 'new_purchase'") &&
    compensationSection.includes('amount: -commissionAmount') &&
    compensationSection.includes("remark: `实例创建失败返利冲正：${instance.name}`") &&
    compensationSection.includes('usedCount: { decrement: 1 }') &&
    compensationSection.includes('totalEarnings: { decrement: commissionAmount }'),
  'failed paid provisioning must reverse AFF commission logs and counters'
)

assert.ok(
  compensationSection.includes('await tx.hostingBalanceLog.deleteMany({') &&
    compensationSection.includes("type: 'income'") &&
    compensationSection.includes("actionType: 'purchase'") &&
    compensationSection.includes('frozen: true'),
  'failed paid provisioning must remove unearned hosted-node frozen purchase income'
)

console.log('instance create failure compensation checks passed')
