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

const createInstanceAsyncSection = instancesSource.slice(
  indexOfOrThrow(instancesSource, 'async function createInstanceAsync(', 'createInstanceAsync')
)

const staticIpAllocationSection = section(
  instancesSource,
  '    if (networkModeNeedsNatIpv4(networkMode)) {',
  '    console.log(`[Provisioning] IP 分配完成: IPv4=${staticIPv4}, IPv6=${staticIPv6}`)'
)

const postTransactionPreparationSection = section(
  instancesSource,
  '    // 事务成功后，完成 IP 分配和存储池选择',
  '    // ==================== 阶段六: 异步执行创建 ===================='
)

const publicIpv4ReleaseHelperSection = section(
  instancesSource,
  'async function releaseReservedPublicIpv4ForFailedCreation(',
  '\n}\n\nasync function compensateFailedInstanceCreation('
)

const compensationHelperSection = section(
  instancesSource,
  'async function compensateFailedInstanceCreation(',
  '\n}\n\n/**\n * 异步创建实例'
)

assert.ok(
  staticIpAllocationSection.includes('staticIpAllocationError = `NAT 内网 IPv4 分配失败') &&
    staticIpAllocationSection.includes("staticIpAllocationError ||= '宿主机未配置 routed IPv6 子网'") &&
    staticIpAllocationSection.includes('staticIpAllocationError ||= `routed IPv6 分配失败') &&
    staticIpAllocationSection.includes('throw new Error(staticIpAllocationError)') &&
    !staticIpAllocationSection.includes('实例将使用动态 IP') &&
    !staticIpAllocationSection.includes('将使用动态分配'),
  'fatal NAT IPv4 and routed IPv6 allocation failures must enter provisioning compensation and return an explicit failure'
)

assert.ok(
  postTransactionPreparationSection.includes('try {') &&
    postTransactionPreparationSection.includes('db.reservePublicIpv4ForInstance') &&
    postTransactionPreparationSection.includes('await db.resolveStoragePoolForNewInstance') &&
    postTransactionPreparationSection.includes('} catch (error) {') &&
    postTransactionPreparationSection.includes('await compensateFailedInstanceCreation({') &&
    postTransactionPreparationSection.includes('return reply.code(503).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, errorMessage))'),
  'all synchronous post-transaction IP and storage preparation failures must be compensated immediately'
)

assert.ok(
  failureSection.includes('await compensateFailedInstanceCreation({') &&
    compensationHelperSection.includes("status: 'creating'") &&
    compensationHelperSection.includes('if (updateResult.count === 0)') &&
    compensationHelperSection.includes('await db.rollbackResources({') &&
    compensationHelperSection.includes('await releaseReservedPublicIpv4ForFailedCreation(instanceId, networkMode)') &&
    compensationHelperSection.includes('await db.compensateFailedInstancePurchase(instanceId, userId, host.id)'),
  'sync preparation and async provisioning failures must share the idempotent creating->error compensation helper'
)

assert.ok(
  publicIpv4ReleaseHelperSection.includes('if (!networkModeNeedsPublicIpv4(networkMode))') &&
    publicIpv4ReleaseHelperSection.includes('db.releasePublicIpv4ForInstance(tx, instanceId)') &&
    instancesSource.match(/db\.releasePublicIpv4ForInstance\(tx, instanceId\)/g)?.length === 1,
  'all user-create failure branches must release reserved public IPv4 through one shared helper'
)

assert.ok(
  appSource.includes('const { getStuckCreatingInstances, getHostById, compensateFailedInstancePurchase, releasePublicIpv4ForInstance } = await import') &&
    appSource.includes("status: 'creating' // 原子条件：只有状态仍为 creating 时才更新") &&
    appSource.includes('const compensation = await compensateFailedInstancePurchase(instance.id, instance.user_id, instance.host_id)') &&
    appSource.includes("await markFlashSaleFailed(instance.id, '实例创建超时', compensation.refunded)") &&
    appSource.includes("await markFlashSaleFailed(instance.id, '实例创建超时', false)"),
  'create-timeout cleanup must run paid purchase and idempotent flash-sale compensation after winning creating->error transition'
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
    postTransactionPreparationSection.includes('throw new Error(`宿主机 ${host.name} 没有可用独立 IPv4 地址`)') &&
    compensationHelperSection.includes('await markFlashSaleFailed(instanceId, errorMessage, compensation.refunded)') &&
    compensationHelperSection.includes('await markFlashSaleFailed(instanceId, errorMessage, false)'),
  'public IPv4 allocation races must enter the same resource, billing, and flash-sale compensation path'
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
