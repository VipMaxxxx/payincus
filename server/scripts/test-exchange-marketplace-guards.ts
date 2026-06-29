import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260629120000_add_exchange_marketplace/migration.sql', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
const exchangeRouteSource = readFileSync(new URL('../src/routes/exchange.ts', import.meta.url), 'utf8')
const exchangeServiceSource = readFileSync(new URL('../src/services/exchange.ts', import.meta.url), 'utf8')
const exchangeDeliveryWorkerSource = readFileSync(new URL('../src/workers/exchangeDeliveryWorker.ts', import.meta.url), 'utf8')
const adminExchangeRouteSource = readFileSync(new URL('../src/routes/admin-exchange.ts', import.meta.url), 'utf8')
const verificationRouteSource = readFileSync(new URL('../src/routes/verification.ts', import.meta.url), 'utf8')
const operationVerificationSource = readFileSync(new URL('../src/lib/operation-verification.ts', import.meta.url), 'utf8')
const notifierSource = readFileSync(new URL('../src/lib/notifier.ts', import.meta.url), 'utf8')
const instanceTaskSource = readFileSync(new URL('../src/db/instance-tasks.ts', import.meta.url), 'utf8')
const instanceTaskWorkerSource = readFileSync(new URL('../src/workers/instanceTaskWorker.ts', import.meta.url), 'utf8')
const instanceDestroySource = readFileSync(new URL('../src/routes/instance-destroy.ts', import.meta.url), 'utf8')
const instanceRouteSource = readFileSync(new URL('../src/routes/instances.ts', import.meta.url), 'utf8')
const snapshotRouteSource = readFileSync(new URL('../src/routes/snapshots.ts', import.meta.url), 'utf8')
const proxySiteRouteSource = readFileSync(new URL('../src/routes/proxy-sites.ts', import.meta.url), 'utf8')
const trafficRouteSource = readFileSync(new URL('../src/routes/traffic.ts', import.meta.url), 'utf8')
const backupRouteSource = readFileSync(new URL('../src/routes/backups.ts', import.meta.url), 'utf8')
const transferRouteSource = readFileSync(new URL('../src/routes/transfers.ts', import.meta.url), 'utf8')
const hostRouteSource = readFileSync(new URL('../src/routes/hosts.ts', import.meta.url), 'utf8')
const terminalRouteSource = readFileSync(new URL('../src/routes/terminal.ts', import.meta.url), 'utf8')
const adminBillingRouteSource = readFileSync(new URL('../src/routes/admin-billing.ts', import.meta.url), 'utf8')
const instanceBillingRouteSource = readFileSync(new URL('../src/routes/instance-billing.ts', import.meta.url), 'utf8')
const batchConfigRouteSource = readFileSync(new URL('../src/routes/batch-config.ts', import.meta.url), 'utf8')
const billingRecordsSource = readFileSync(new URL('../src/db/billing-records.ts', import.meta.url), 'utf8')
const billingOperationsSource = readFileSync(new URL('../src/db/billing-operations.ts', import.meta.url), 'utf8')
const billingSchedulerSource = readFileSync(new URL('../src/services/billing-scheduler.ts', import.meta.url), 'utf8')
const autoPolicySchedulerSource = readFileSync(new URL('../src/services/auto-policy-scheduler.ts', import.meta.url), 'utf8')
const publicApiRouteSource = readFileSync(new URL('../src/routes/public-api.ts', import.meta.url), 'utf8')
const exchangeOperationLockSource = readFileSync(new URL('../src/services/exchange-operation-lock.ts', import.meta.url), 'utf8')
const balanceDbSource = readFileSync(new URL('../src/db/balance.ts', import.meta.url), 'utf8')
const balanceRouteSource = readFileSync(new URL('../src/routes/balance.ts', import.meta.url), 'utf8')
const instancesViewSource = readFileSync(new URL('../../client/src/views/InstancesView.vue', import.meta.url), 'utf8')
const instanceDetailViewSource = readFileSync(new URL('../../client/src/views/InstanceDetailView.vue', import.meta.url), 'utf8')
const instanceNetworkTabSource = readFileSync(new URL('../../client/src/components/instance/InstanceNetworkTab.vue', import.meta.url), 'utf8')
const instanceSitesTabSource = readFileSync(new URL('../../client/src/components/instance/InstanceSitesTab.vue', import.meta.url), 'utf8')
const instanceConfigTabSource = readFileSync(new URL('../../client/src/components/instance/InstanceConfigTab.vue', import.meta.url), 'utf8')
const snapshotManagerSource = readFileSync(new URL('../../client/src/components/SnapshotManager.vue', import.meta.url), 'utf8')
const userApiSource = readFileSync(new URL('../../client/src/api/index.ts', import.meta.url), 'utf8')
const clientTypesSource = readFileSync(new URL('../../client/src/types/api.ts', import.meta.url), 'utf8')
const userExchangeViewSource = readFileSync(new URL('../../client/src/views/ExchangeView.vue', import.meta.url), 'utf8')
const adminExchangeViewSource = readFileSync(new URL('../../client/src/views/admin/ExchangeManageView.vue', import.meta.url), 'utf8')
const sensitiveVerificationModalSource = readFileSync(new URL('../../client/src/components/SensitiveVerificationModal.vue', import.meta.url), 'utf8')
const zhCnLocaleSource = readFileSync(new URL('../../client/src/locales/zh-CN.ts', import.meta.url), 'utf8')
const enLocaleSource = readFileSync(new URL('../../client/src/locales/en.ts', import.meta.url), 'utf8')
const zhTwLocaleSource = readFileSync(new URL('../../client/src/locales/zh-TW.ts', import.meta.url), 'utf8')
const adminRouteGuardSource = readFileSync(new URL('./test-admin-route-guards.ts', import.meta.url), 'utf8')

const instancesExchangeStateLoaderSource = sourceBetween(
  instancesViewSource,
  'async function loadExchangeListingStates(): Promise<void> {',
  'function toggleSelectAll(): void {'
)

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert(startIndex >= 0, `source section must contain ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert(endIndex > startIndex, `source section ${start} must end before ${end}`)
  return source.slice(startIndex, endIndex)
}

function interfaceSection(source: string, name: string): string {
  const start = `export interface ${name} {`
  const startIndex = source.indexOf(start)
  assert(startIndex >= 0, `client API types must include ${name}`)
  const nextIndex = source.indexOf('\nexport interface ', startIndex + start.length)
  assert(nextIndex > startIndex, `client API type ${name} must end before the next exported interface`)
  return source.slice(startIndex, nextIndex)
}

function assertSourceOrder(source: string, markers: string[], message: string): void {
  let previousIndex = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, previousIndex + 1)
    assert(index >= 0, `${message}: missing marker ${marker}`)
    assert(index > previousIndex, `${message}: ${marker} must appear after the previous marker`)
    previousIndex = index
  }
}

function routeBlocks(source: string): string[] {
  const matches = [...source.matchAll(/fastify\.(?:get|post|put|patch|delete)<?[\s\S]*?(?=\n\s*fastify\.(?:get|post|put|patch|delete)<?|^}\n?$)/g)]
  return matches.map(match => match[0])
}

function routeBlock(source: string, path: string): string {
  const block = routeBlocks(source).find(item => item.includes(path))
  assert(block, `route ${path} must exist`)
  return block || ''
}

for (const model of [
  'ExchangeListing',
  'ExchangeOrder',
  'ExchangeDeliveryTask',
  'ExchangeWallet',
  'ExchangeWalletLog',
  'ExchangeWithdrawal',
  'ExchangeDispute',
  'ExchangeAuditLog',
  'ExchangePolicyConfig'
]) {
  assert(schema.includes(`model ${model} `), `schema must define ${model}`)
}

for (const enumName of [
  'ExchangeListingStatus',
  'ExchangeOrderStatus',
  'ExchangeDeliveryTaskStatus',
  'ExchangeWalletLogType',
  'ExchangeWithdrawalStatus',
  'ExchangeDisputeStatus'
]) {
  assert(schema.includes(`enum ${enumName} `), `schema must define ${enumName}`)
  assert(migration.includes(`CREATE TYPE "${enumName}"`), `migration must create ${enumName}`)
}

for (const balanceType of ['exchange_purchase', 'exchange_refund', 'exchange_transfer']) {
  assert(schema.includes(balanceType), `BalanceLogType must include ${balanceType}`)
  assert(migration.includes(`'${balanceType}'`), `migration must add BalanceLogType ${balanceType}`)
  assert(balanceDbSource.includes(`'${balanceType}'`), `balance db allowlist must include ${balanceType}`)
  assert(balanceRouteSource.includes(`'${balanceType}'`), `balance route allowlist must include ${balanceType}`)
}

for (const operationType of ['exchange_purchase', 'exchange_withdrawal', 'exchange_balance_transfer']) {
  assert(schema.includes(operationType), `OperationType must include ${operationType}`)
  assert(migration.includes(`'${operationType}'`), `migration must add OperationType ${operationType}`)
  assert(verificationRouteSource.includes(`'${operationType}'`), `verification routes must allow ${operationType}`)
  assert(operationVerificationSource.includes(`'${operationType}'`), `operation verification service must handle ${operationType}`)
}

for (const walletLogType of [
  'escrow_hold',
  'escrow_refund',
  'fee_charge',
  'escrow_release',
  'withdrawal_freeze',
  'withdrawal_complete',
  'withdrawal_reject',
  'balance_transfer',
  'dispute_freeze',
  'dispute_release',
  'admin_adjust'
]) {
  assert(schema.includes(walletLogType), `ExchangeWalletLogType must include ${walletLogType}`)
  assert(migration.includes(`'${walletLogType}'`), `migration must create ExchangeWalletLogType ${walletLogType}`)
  assert(
    exchangeServiceSource.includes(`type: '${walletLogType}'`) ||
      exchangeServiceSource.includes(`'${walletLogType}'`) ||
      adminExchangeRouteSource.includes(`type: '${walletLogType}'`),
    `exchange service or admin route must write ${walletLogType} wallet log`
  )
}

assert(
  appSource.includes("import exchangeRoutes from './routes/exchange.js'") &&
    appSource.includes("fastify.register(exchangeRoutes, { prefix: '/api/exchange' })") &&
    appSource.includes('startExchangeDeliveryWorker()'),
  'app must register exchange routes and start the exchange delivery worker'
)

for (const block of routeBlocks(adminExchangeRouteSource)) {
  assert(block.includes('fastify.authenticateAdmin'), 'all admin exchange routes must require admin authentication')
}

for (const path of [
  "'/market/:listingId/purchase'",
  "'/wallet/transfer'",
  "'/withdrawals'"
]) {
  const block = routeBlock(exchangeRouteSource, path)
  assert(
    block.includes('fastify.authenticateUser') &&
      block.includes('requireExchangeVerification') &&
      block.includes('getRequestIdempotencyKey'),
    `user exchange money route ${path} must require auth, second verification, and idempotency`
  )
}

assert(
  exchangeServiceSource.includes("instance.status === 'stopped'") &&
    exchangeServiceSource.includes("instance.status === 'running'") &&
    exchangeServiceSource.includes('EXCHANGE_INSTANCE_MUST_BE_STOPPED') &&
    exchangeServiceSource.includes('hasBlockingReasonExceptStopped') &&
    exchangeServiceSource.includes('上架交易所前必须先暂停实例'),
  'exchange listing must require stopped instances, only otherwise-eligible running instances may enter stop-first flow, and expose the pause-first reason'
)

assert(
  exchangeServiceSource.includes('if (!policy.enabled)') &&
    exchangeServiceSource.includes('return { items: [], total: 0, page, pageSize, packages: [] }') &&
    exchangeServiceSource.includes("throw new ExchangeError('EXCHANGE_DISABLED', '交易所当前未启用', 403)") &&
    countOccurrences(exchangeServiceSource, "throw new ExchangeError('EXCHANGE_DISABLED'") >= 2,
  'exchange enabled policy must hide public market listings and block listing detail, listing creation, and purchase when disabled'
)

assert(
  exchangeServiceSource.includes('function visibleListingWhere') &&
    exchangeServiceSource.includes('autoDelistAt: { gt: now }') &&
    exchangeServiceSource.includes('const where = visibleListingWhere()') &&
    exchangeServiceSource.includes('...visibleListingWhere()') &&
    exchangeServiceSource.includes('function normalizeFutureAutoDelistAt') &&
    exchangeServiceSource.includes('EXCHANGE_AUTO_DELIST_AT_EXPIRED') &&
    countOccurrences(exchangeServiceSource, 'normalizeFutureAutoDelistAt(input.autoDelistAt)') >= 2,
  'exchange market/detail reads and listing create/update paths must synchronously reject expired auto-delist windows'
)

assert(
	  exchangeServiceSource.includes('function serializePublicListing') &&
			exchangeServiceSource.includes('instanceId: _instanceId') &&
				exchangeServiceSource.includes('eligibilitySnapshot: _eligibilitySnapshot') &&
				exchangeServiceSource.includes('sanitizePublicInstanceSnapshot') &&
					exchangeServiceSource.includes('publicSnapshotRootForbiddenFields') &&
					exchangeServiceSource.includes('publicSnapshotForbiddenFields') &&
					exchangeServiceSource.includes('publicSnapshotRootForbiddenFields.has(key)') &&
					exchangeServiceSource.includes('publicSnapshotForbiddenFields.has(key)') &&
					exchangeServiceSource.includes('sanitizePublicInstanceSnapshot(item as Prisma.JsonValue, false)') &&
					exchangeServiceSource.includes('items: items.map(serializePublicListing)') &&
					exchangeServiceSource.includes('return serializePublicListing(listing)'),
	  'public exchange market/detail APIs must use anonymous serialization and must not expose internal instance, instance name, or user identity fields'
)

assert(
  clientTypesSource.includes('export interface ExchangeInstanceSnapshot') &&
    clientTypesSource.includes('instanceId?: number') &&
    clientTypesSource.includes('name?: string') &&
    clientTypesSource.includes('export interface ExchangeListing') &&
    clientTypesSource.includes('instanceId?: number'),
  'client exchange types must model public market listings as anonymous and must not require internal instance id or original instance name'
)

assert(
  adminRouteGuardSource.includes("file === 'exchange.ts'") &&
    adminRouteGuardSource.includes("'/market'") &&
    adminRouteGuardSource.includes("'/market/:listingId'") &&
    !adminRouteGuardSource.includes("'/market/:listingId/purchase'") &&
    !adminRouteGuardSource.includes("'/wallet/transfer'") &&
    !adminRouteGuardSource.includes("'/withdrawals'"),
  'global route guard must only whitelist anonymous exchange market reads; purchase, wallet, withdrawal, and dispute routes must stay authenticated'
)

assert(
  exchangeServiceSource.includes("status: { in: ['PENDING', 'PROCESSING'] }") &&
    exchangeServiceSource.includes('restoreTask.findFirst') &&
    exchangeServiceSource.includes('backupUploadTask.findFirst') &&
    exchangeServiceSource.includes('EXCHANGE_INSTANCE_HAS_ACTIVE_TASK'),
  'exchange eligibility must block instances with active instance, restore, or backup upload tasks'
)

assert(
  exchangeServiceSource.includes('successMessage?: string') &&
    exchangeServiceSource.includes('passed ? (successMessage || message) : message') &&
    exchangeServiceSource.includes('交易所当前已启用') &&
    exchangeServiceSource.includes('实例已暂停，满足交易所上架状态要求') &&
    exchangeServiceSource.includes('到期时间 ${instance.expiresAt.toISOString()}') &&
    exchangeServiceSource.includes('未发现创建、重启、重装、迁移、恢复或上传中的任务') &&
    exchangeServiceSource.includes('实例当前未挂牌，也未被交易锁定') &&
    exchangeServiceSource.includes('实例没有交割中、争议中或未结算交易') &&
    exchangeServiceSource.includes('实例未命中封禁、限速或高风险状态') &&
    exchangeServiceSource.includes('当前套餐在交易所允许列表内') &&
    exchangeServiceSource.includes('当前节点在交易所允许列表内') &&
    exchangeServiceSource.includes('交易所允许独立 IP 随实例剩余使用权转让'),
  'exchange eligibility checks must return explicit success messages instead of showing failure text on passed checks'
)

assert(
  exchangeServiceSource.includes('hasPendingTransfer') &&
    exchangeServiceSource.includes('no_pending_transfer') &&
    exchangeServiceSource.includes('没有待处理普通转移') &&
    exchangeServiceSource.includes('EXCHANGE_INSTANCE_HAS_PENDING_TRANSFER') &&
    exchangeServiceSource.includes("status: { in: ['pending', 'processing'] }"),
  'exchange listing eligibility and creation must block instances with pending normal transfers'
)

assert(
  exchangeServiceSource.includes('resourceRiskState') &&
    exchangeServiceSource.includes('risk_normal') &&
    exchangeServiceSource.includes('account_active') &&
    exchangeServiceSource.includes('账号存在风控下单限制，不能挂牌'),
  'exchange eligibility must block risk, inactive, or order-restricted instances/accounts'
)

assert(
  exchangeServiceSource.includes('isInstanceTrafficWithinLimit') &&
    exchangeServiceSource.includes('traffic_not_over_limit') &&
    exchangeServiceSource.includes('实例流量未超限') &&
    exchangeServiceSource.includes('EXCHANGE_INSTANCE_TRAFFIC_OVER_LIMIT') &&
    exchangeServiceSource.includes('const trafficState = await tx.instance.findUnique') &&
    exchangeServiceSource.includes('monthlyTrafficLimit: toBigintString(trafficState.monthlyTrafficLimit)') &&
    exchangeServiceSource.includes('withinLimit: isInstanceTrafficWithinLimit(trafficState)'),
  'exchange eligibility and listing creation must block traffic-limited or over-limit instances and persist traffic evidence in the listing snapshot'
)

assert(
  exchangeServiceSource.includes('isAccountTrafficWithinLimit') &&
    exchangeServiceSource.includes('account_traffic_not_over_limit') &&
    exchangeServiceSource.includes('账号总流量未超限') &&
    exchangeServiceSource.includes('EXCHANGE_ACCOUNT_TRAFFIC_OVER_LIMIT') &&
    exchangeServiceSource.includes('const accountTrafficState = await tx.userQuota.findUnique') &&
    exchangeServiceSource.includes('monthlyTrafficLimit: toBigintString(accountTrafficState.monthlyTrafficLimit)') &&
    exchangeServiceSource.includes('withinLimit: isAccountTrafficWithinLimit(accountTrafficState)'),
  'exchange eligibility and listing creation must block traffic-limited or over-limit seller accounts and persist account traffic evidence in the listing snapshot'
)

assert(
  exchangeServiceSource.includes('isDedicatedIpNetworkMode') &&
    exchangeServiceSource.includes('public_ip_transfer_allowed') &&
    exchangeServiceSource.includes('EXCHANGE_PUBLIC_IP_TRANSFER_DISABLED'),
  'exchange eligibility and listing creation must respect the independent IP transfer policy'
)

assert(
  exchangeServiceSource.includes('assertAnonymousListingDescription') &&
    exchangeServiceSource.includes('EXCHANGE_DESCRIPTION_CONTACT_FORBIDDEN') &&
    exchangeServiceSource.includes('联系方式、外链或可识别交易双方身份的信息'),
  'exchange listing descriptions must reject contact info and identity disclosure'
)

assert(
  exchangeServiceSource.includes('function assertAnonymousText') &&
    exchangeServiceSource.includes('function assertAnonymousDisputeText') &&
    exchangeServiceSource.includes('EXCHANGE_DISPUTE_CONTACT_FORBIDDEN') &&
    exchangeServiceSource.includes('争议内容不能包含联系方式、外链或可识别交易双方身份的信息') &&
    exchangeServiceSource.includes('const normalizedReason = reason.trim().slice(0, 100)') &&
    exchangeServiceSource.includes('EXCHANGE_DISPUTE_REASON_REQUIRED') &&
    exchangeServiceSource.includes('必须填写争议原因') &&
    exchangeServiceSource.includes('const normalizedDetail = normalizeOptionalText(detail, 1000)') &&
    exchangeServiceSource.includes('assertAnonymousDisputeText(normalizedReason, normalizedDetail)') &&
    exchangeServiceSource.includes('reason: normalizedReason') &&
    exchangeServiceSource.includes('detail: normalizedDetail'),
  'exchange disputes must reject contact info and identity disclosure before writing participant-visible dispute text'
)

assert(
  exchangeRouteSource.includes('function normalizeListingUpdateBody') &&
    exchangeRouteSource.includes('const input = normalizeListingUpdateBody(request.body)') &&
    userApiSource.includes('instanceId?: number') &&
    userExchangeViewSource.includes('api.exchange.updateListing(draft.listing.id') &&
    !userExchangeViewSource.includes('挂牌实例信息缺失，请刷新后重试') &&
    exchangeServiceSource.includes('input.instanceId !== undefined && input.instanceId !== null && input.instanceId !== listing.instanceId') &&
    exchangeServiceSource.includes('EXCHANGE_LISTING_INSTANCE_IMMUTABLE') &&
    exchangeServiceSource.includes('挂牌实例不能修改'),
  'exchange listing updates must allow price/description/auto-delist changes without requiring instanceId, while still rejecting attempts to change the listed asset when instanceId is supplied'
)

assert(
  exchangeServiceSource.includes('cleanup_port_mappings') &&
    exchangeServiceSource.includes('cleanup_proxy_sites') &&
    exchangeServiceSource.includes('cleanup_snapshots') &&
    exchangeServiceSource.includes('cleanup_backup_policy'),
  'exchange eligibility must expose delivery cleanup checks for port mappings, proxy sites, snapshots, and backup policies'
)

assert(
  exchangeServiceSource.includes('validateListingStoragePools') &&
    exchangeServiceSource.includes('getPackageHostStoragePool') &&
    exchangeServiceSource.includes('isSystemDiskPoolForClient') &&
    exchangeServiceSource.includes('instance_storage_pool_available') &&
    exchangeServiceSource.includes('package_storage_pool_available') &&
    exchangeServiceSource.includes('EXCHANGE_INSTANCE_STORAGE_POOL_UNAVAILABLE') &&
    exchangeServiceSource.includes('EXCHANGE_PACKAGE_STORAGE_POOL_UNAVAILABLE'),
  'exchange listing eligibility and creation must block unavailable instance/package system disk pools'
)

const purchaseExchangeListingSection = sourceBetween(
  exchangeServiceSource,
  'export async function purchaseExchangeListing',
  'export async function releaseExchangeOrderEscrow'
)
const purchaseRecheckSection = sourceBetween(
  exchangeServiceSource,
  'async function assertListingStillPurchasable',
  'export async function purchaseExchangeListing'
)
assert(
  purchaseExchangeListingSection.includes('const purchaseInstance = await assertListingStillPurchasable(tx, policy, listing)') &&
    purchaseRecheckSection.includes('instance.status !==') &&
    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_STATE_CHANGED') &&
    purchaseRecheckSection.includes('EXCHANGE_SELLER_NOT_ACTIVE') &&
    purchaseRecheckSection.includes('assertPolicyAllowlist(policy, instance)') &&
    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_OVERDUE') &&
	    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_EXPIRING_SOON') &&
	    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_RISKY') &&
	    !purchaseRecheckSection.includes('EXCHANGE_PACKAGE_INACTIVE') &&
	    !purchaseRecheckSection.includes('EXCHANGE_PLAN_INACTIVE') &&
	    purchaseRecheckSection.includes('EXCHANGE_HOST_UNAVAILABLE') &&
    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_TRAFFIC_OVER_LIMIT') &&
    purchaseRecheckSection.includes('EXCHANGE_SELLER_RESTRICTED') &&
    purchaseRecheckSection.includes('EXCHANGE_ACCOUNT_TRAFFIC_OVER_LIMIT') &&
    purchaseRecheckSection.includes('validateListingStoragePools(tx, instance)') &&
    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_STORAGE_POOL_UNAVAILABLE') &&
    purchaseRecheckSection.includes('EXCHANGE_PACKAGE_STORAGE_POOL_UNAVAILABLE') &&
    purchaseRecheckSection.includes('EXCHANGE_INSTANCE_HAS_ACTIVE_ORDER') &&
    purchaseRecheckSection.includes("'autoDelistAt'") &&
    purchaseRecheckSection.includes('EXCHANGE_LISTING_EXPIRED') &&
    purchaseRecheckSection.includes('挂牌已到自动下架时间，无法购买'),
  'exchange purchase must recheck seller/account/instance risk, expiry, auto-delist, allowlist, traffic, storage pool, host, and active-order state immediately before locking and charging the buyer; inactive packages and sold-out or inactive plans can trade as existing instance rights'
)

const createExchangeListingSection = sourceBetween(
  exchangeServiceSource,
  'export async function createExchangeListing',
  'async function buildEligibilitySnapshot'
)
assert(
  exchangeServiceSource.includes('package_snapshot_available') &&
    exchangeServiceSource.includes('实例套餐已停用，但存量实例剩余使用权允许交易') &&
    exchangeServiceSource.includes('实例方案已停用或售罄，但存量实例剩余使用权允许交易') &&
    !createExchangeListingSection.includes('EXCHANGE_PACKAGE_INACTIVE') &&
    !purchaseRecheckSection.includes('EXCHANGE_PACKAGE_INACTIVE'),
  'exchange listing and purchase must allow inactive package/plan snapshots as existing instance rights while keeping allowlist, storage, host, risk, traffic, task, and expiry checks in force'
)

assert(
  exchangeServiceSource.includes('function visibleListingPackageWhere') &&
    exchangeServiceSource.includes("path: ['package', 'id']") &&
    exchangeServiceSource.includes('buildMarketPackageCategories') &&
    exchangeServiceSource.includes('packages: buildMarketPackageCategories(packageRows)') &&
    exchangeRouteSource.includes('packageId?: string') &&
    exchangeRouteSource.includes("parseOptionalPositiveId(request.query.packageId, '套餐')") &&
    userExchangeViewSource.includes('marketPackages') &&
    userExchangeViewSource.includes('selectedMarketPackageId') &&
    userExchangeViewSource.includes('套餐分类') &&
    userExchangeViewSource.includes('selectMarketPackage'),
  'exchange market must support package category filtering with accurate backend pagination and frontend filter controls'
)

assert(
  exchangeServiceSource.includes("type: 'exchange_purchase'") &&
    exchangeServiceSource.includes("type: 'escrow_hold'") &&
    exchangeServiceSource.includes("status: 'delivering'") &&
	    exchangeServiceSource.includes('escrowAmount: price') &&
	    exchangeServiceSource.includes('exchangeDeliveryTask.create') &&
	    exchangeServiceSource.includes("step: 'escrow_paid'") &&
	    !exchangeServiceSource.includes("step: 'lock_order'") &&
	    exchangeServiceSource.includes('const exchangeDeliveryProgressSteps') &&
	    exchangeServiceSource.includes('steps: [...exchangeDeliveryProgressSteps]') &&
    exchangeServiceSource.includes("'freeze_seller_access'") &&
    exchangeServiceSource.includes("'cleanup_ssh_keys'") &&
    exchangeServiceSource.includes("'cleanup_console_tokens'") &&
    exchangeServiceSource.includes("'rebuild_billing'"),
  'exchange purchase must deduct buyer balance into escrow and create a delivery task'
)

assert(
  exchangeServiceSource.includes('EXCHANGE_BUYER_IMAGE_SELECTION_DISABLED') &&
    exchangeServiceSource.includes('getSystemImageAvailabilityForHost') &&
    exchangeServiceSource.includes('EXCHANGE_IMAGE_UNAVAILABLE') &&
    exchangeServiceSource.includes('tx.sshKey.findUnique') &&
    exchangeServiceSource.includes('EXCHANGE_SSH_KEY_NOT_OWNED') &&
    exchangeServiceSource.includes('imageAlias,') &&
    exchangeServiceSource.includes('sshKeyId'),
  'exchange purchase must validate buyer reinstall image selection and buyer-owned SSH key before storing delivery task preferences'
)

assert(
  schema.includes('instanceTaskId     Int?') &&
    migration.includes('"instance_task_id" INTEGER') &&
    migration.includes('exchange_delivery_tasks_instance_task_id_fkey'),
  'exchange delivery tasks must be linked to the internal instance rebuild task'
)

assert(
  exchangeDeliveryWorkerSource.includes("taskType: 'rebuild'") &&
    exchangeDeliveryWorkerSource.includes('allowExchangeLocked: true') &&
    exchangeDeliveryWorkerSource.includes('cleanupLegacyAccess') &&
    exchangeDeliveryWorkerSource.includes('DeliveryCleanupSummary') &&
    exchangeDeliveryWorkerSource.includes('terminalSessionsClosed') &&
    exchangeDeliveryWorkerSource.includes("action: 'delivery.cleanup_access'") &&
    exchangeDeliveryWorkerSource.includes("action: 'delivery.transfer_owner'") &&
    exchangeDeliveryWorkerSource.includes('removeDevice') &&
    exchangeDeliveryWorkerSource.includes('createCaddyClient') &&
    exchangeDeliveryWorkerSource.includes("step: 'preserve_traffic_usage'") &&
    exchangeDeliveryWorkerSource.includes("progress: taskProgress('transfer_owner'") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'freeze_seller_access')") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'cleanup_ssh_keys'") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'cleanup_terminal_sessions')") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'cleanup_console_tokens'") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'cleanup_network_bindings')") &&
    exchangeDeliveryWorkerSource.includes("setDeliveryProgress(taskId, 'cleanup_snapshots_and_backups')") &&
    exchangeDeliveryWorkerSource.includes("'rebuild_billing'") &&
    exchangeDeliveryWorkerSource.includes('sellerAccessFrozen: true') &&
    exchangeDeliveryWorkerSource.includes('sshAuthorizedKeysClearedByForcedReinstall: true') &&
    exchangeDeliveryWorkerSource.includes('consoleCloudInitTokensClearedByForcedReinstall: true') &&
    exchangeDeliveryWorkerSource.includes('const alreadyFailed = task.status ===') &&
    exchangeDeliveryWorkerSource.includes('notificationSkipped: alreadyFailed') &&
    exchangeDeliveryWorkerSource.includes("createLog(notice.buyerUserId, 'exchange', 'exchange.delivery.failed'") &&
    exchangeDeliveryWorkerSource.includes("createLog(notice.sellerUserId, 'exchange', 'exchange.delivery.failed'") &&
    exchangeDeliveryWorkerSource.includes("'exchange_delivery_failed'") &&
    exchangeDeliveryWorkerSource.includes('buyerSshKeyWillBeInjected') &&
    exchangeDeliveryWorkerSource.includes('newRootPasswordWillBeGenerated: true') &&
    exchangeDeliveryWorkerSource.includes('rootPasswordRotatedByReinstall: true') &&
    exchangeDeliveryWorkerSource.includes('buyerSshKeyInjected: !!task.sshKeyId') &&
    exchangeDeliveryWorkerSource.includes('generatedRootPasswordForBuyer: true') &&
    exchangeDeliveryWorkerSource.includes('cloudInitStateResetForBuyer: true') &&
    exchangeDeliveryWorkerSource.includes('oldBillingRecordsKeptWithSeller: true') &&
	    exchangeDeliveryWorkerSource.includes('renewalOwnershipRebuiltForBuyer: true') &&
	    exchangeDeliveryWorkerSource.includes('instanceBillingRecord.create') &&
	    exchangeDeliveryWorkerSource.includes("type: 'newPurchase'") &&
	    exchangeDeliveryWorkerSource.includes('amount: task.order.price') &&
	    exchangeDeliveryWorkerSource.includes('balanceLogId: task.order.buyerBalanceLogId') &&
	    exchangeDeliveryWorkerSource.includes('buyerBillingRecordId: buyerBillingRecord.id') &&
	    exchangeDeliveryWorkerSource.includes('restoredFrom: Prisma.JsonNull') &&
	    exchangeDeliveryWorkerSource.includes('trafficUsagePreserved: true') &&
	    !exchangeDeliveryWorkerSource.includes('monthlyTrafficUsed: 0') &&
	    !exchangeDeliveryWorkerSource.includes("trafficStatus: 'NORMAL'") &&
	    !exchangeDeliveryWorkerSource.includes('trafficSnapshotsRemoved') &&
	    !exchangeDeliveryWorkerSource.includes('dailyTrafficRowsRemoved') &&
	    instanceTaskWorkerSource.includes('const exchangeDeliveryTask = await prisma.exchangeDeliveryTask.findUnique') &&
	    instanceTaskWorkerSource.includes('where: { instanceTaskId: task.id }') &&
	    instanceTaskWorkerSource.includes('if (!exchangeDeliveryTask)') &&
	    instanceTaskWorkerSource.includes('await prisma.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })') &&
	    exchangeDeliveryWorkerSource.includes('instanceRiskState.deleteMany') &&
	    exchangeDeliveryWorkerSource.includes('instanceRiskEvent.deleteMany') &&
	    exchangeDeliveryWorkerSource.includes('instanceResourceSample.deleteMany') &&
    exchangeDeliveryWorkerSource.includes('resourceRiskStateRemoved') &&
	    exchangeDeliveryWorkerSource.includes('portMappingDeviceCleanupFailures') &&
	    exchangeDeliveryWorkerSource.includes('proxySiteRemoteCleanupFailures') &&
	    exchangeDeliveryWorkerSource.includes('cleanupWarningSamples') &&
	    exchangeDeliveryWorkerSource.includes('failedPortMappingDeviceCleanup') &&
	    exchangeDeliveryWorkerSource.includes('failedProxySiteRemoteCleanup') &&
	    exchangeDeliveryWorkerSource.includes('affBinding.deleteMany') &&
	    exchangeDeliveryWorkerSource.includes('instanceTransfer.updateMany') &&
	    exchangeDeliveryWorkerSource.includes("import { customAlphabet } from 'nanoid'") &&
	    exchangeDeliveryWorkerSource.includes('buildBuyerIncusId') &&
	    exchangeDeliveryWorkerSource.includes('buildExchangeDisplayName') &&
	    exchangeDeliveryWorkerSource.includes('renameIncusInstance(client, oldIncusId, newIncusId)') &&
	    exchangeDeliveryWorkerSource.includes('renameIncusInstance(client, newIncusId, oldIncusId)') &&
	    exchangeDeliveryWorkerSource.includes('incusId: newIncusId') &&
	    exchangeDeliveryWorkerSource.includes('name: newDisplayName') &&
	    exchangeDeliveryWorkerSource.includes('displayOrder: 0') &&
	    exchangeDeliveryWorkerSource.includes('oldIncusId') &&
	    exchangeDeliveryWorkerSource.includes('newIncusId') &&
	    exchangeDeliveryWorkerSource.includes('newDisplayName') &&
    exchangeDeliveryWorkerSource.includes("userId: task.buyerUserId") &&
	    exchangeDeliveryWorkerSource.includes("status: 'confirming'") &&
	    exchangeDeliveryWorkerSource.includes('confirmationDueAt') &&
	    exchangeDeliveryWorkerSource.includes('sendNotification(task.buyerUserId') &&
	    exchangeDeliveryWorkerSource.includes("'exchange_delivery_completed'") &&
	    exchangeDeliveryWorkerSource.includes('sendNotification(task.sellerUserId') &&
	    exchangeDeliveryWorkerSource.includes("'exchange_sale_confirming'") &&
	    exchangeDeliveryWorkerSource.includes('Promise.allSettled') &&
	    exchangeDeliveryWorkerSource.includes('post-commit notifications/logs failed') &&
		    exchangeDeliveryWorkerSource.includes('settleDueConfirmingOrders') &&
		    exchangeDeliveryWorkerSource.includes('releaseExchangeOrderEscrow') &&
		    exchangeDeliveryWorkerSource.includes("status: 'manual_review'"),
  'exchange delivery worker must clean old access/billing bindings with audit evidence, queue forced rebuild for the buyer, rename Incus/display identity for anonymous buyer delivery, preserve traded traffic usage, notify both parties without post-commit rollback, enter confirmation period, auto-settle escrow, and fail into manual review'
)

const cleanupLegacyAccessSection = sourceBetween(exchangeDeliveryWorkerSource, 'async function cleanupLegacyAccess', 'async function markDeliveryFailed')
assert(
  cleanupLegacyAccessSection.includes('try {') &&
    cleanupLegacyAccessSection.includes('await removeDevice') &&
    cleanupLegacyAccessSection.includes('portMappingDeviceCleanupFailures++') &&
    cleanupLegacyAccessSection.includes('await caddy.deleteSite') &&
    cleanupLegacyAccessSection.includes('proxySiteRemoteCleanupFailures++') &&
    cleanupLegacyAccessSection.includes('cleanupWarnings.push') &&
    cleanupLegacyAccessSection.includes('cleanupWarningSamples: cleanupWarnings.slice(0, 10)'),
  'exchange delivery cleanup must tolerate missing/stale Incus proxy devices or Caddy site cleanup failures, persist DB cleanup, and record warning samples for operator audit'
)

const enqueueReinstallSection = sourceBetween(exchangeDeliveryWorkerSource, 'async function enqueueReinstall', 'async function finalizeDelivery')
const finalizeDeliverySection = sourceBetween(exchangeDeliveryWorkerSource, 'async function finalizeDelivery', 'async function settleDueConfirmingOrders')
assertSourceOrder(
  enqueueReinstallSection,
  [
    "if (task.instance.userId !== task.sellerUserId)",
    "if (task.instance.status !== 'stopped')",
    "setDeliveryProgress(taskId, 'freeze_seller_access')",
    "setDeliveryProgress(taskId, 'cleanup_terminal_sessions')",
    "setDeliveryProgress(taskId, 'cleanup_network_bindings')",
    "setDeliveryProgress(taskId, 'cleanup_snapshots_and_backups')",
    'const cleanupSummary = await cleanupLegacyAccess(task.instanceId)',
    "setDeliveryProgress(taskId, 'cleanup_ssh_keys'",
    "setDeliveryProgress(taskId, 'cleanup_console_tokens'",
	    'const instanceTask = await createInstanceTask({',
	    'userId: task.buyerUserId',
	    "taskType: 'rebuild'",
	    'allowExchangeLocked: true',
	    "step: 'reinstall'",
	    "progress: taskProgress('reinstall', { instanceTaskId: instanceTask.id })"
	  ],
	  'exchange delivery must recheck seller ownership/stopped status, clean legacy access, then queue a buyer-owned forced rebuild'
	)
assert(
  !exchangeDeliveryWorkerSource.includes("step: 'reinstall_queued'") &&
    !exchangeDeliveryWorkerSource.includes("step: task.instanceTask?.progress || 'reinstall'") &&
    exchangeDeliveryWorkerSource.includes("instanceTaskProgress: task.instanceTask?.progress || null"),
  'exchange delivery task step must stay within the public delivery progress steps; instance-task progress belongs in progress.instanceTaskProgress only'
)
assertSourceOrder(
  finalizeDeliverySection,
  [
    "if (!renameContext.instanceTask || renameContext.instanceTask.status !== 'COMPLETED')",
    'const oldIncusId = renameContext.instance.incusId',
    'const newIncusId = buildBuyerIncusId(renameContext.buyerUserId)',
    'await stopInstance(client, oldIncusId, true)',
    'await renameIncusInstance(client, oldIncusId, newIncusId)',
    'await prisma.$transaction',
    'userId: task.buyerUserId',
    'incusId: newIncusId',
    'name: newDisplayName',
    "status: 'stopped'",
    "type: 'newPurchase'",
    "step: 'preserve_traffic_usage'",
    "status: 'confirming'",
    "status: 'COMPLETED'"
  ],
  'exchange delivery must wait for rebuild completion before anonymous Incus rename, owner transfer, billing rebuild, preserving traffic usage, and confirmation state'
)
assert(
  finalizeDeliverySection.includes('await renameIncusInstance(client, newIncusId, oldIncusId)') &&
    finalizeDeliverySection.includes('CRITICAL: failed to rollback exchange Incus rename') &&
    finalizeDeliverySection.includes('throw error'),
  'exchange delivery finalization must attempt to rollback the Incus rename if the database transfer transaction fails'
)

assert(
  instanceBillingRouteSource.includes('userId: isOwner ? user.id : undefined') &&
    billingRecordsSource.includes('userId?: number') &&
    billingRecordsSource.includes('instanceId: { in: billingLineageInstanceIds }') &&
    billingRecordsSource.includes('userId: options.userId'),
  'instance billing records must hide seller historical billing records from the buyer after exchange delivery while preserving host-owner support visibility'
)

assert(
  notifierSource.includes("'exchange_delivery_completed'") &&
    notifierSource.includes("'exchange_delivery_failed'") &&
    notifierSource.includes("'exchange_sale_confirming'") &&
    notifierSource.includes('交易所交割完成') &&
    notifierSource.includes('交易所交割异常') &&
    notifierSource.includes('交易所订单进入确认期') &&
    notifierSource.includes('不包含卖家原系统或原数据') &&
    notifierSource.includes('平台可执行重试交割、退款或人工接管处理') &&
    notifierSource.includes('确认期内无未完结争议'),
  'notification templates must include exchange delivery completion and seller confirmation-period messages without exposing trading identities'
)

assert(
  instanceTaskWorkerSource.includes('const newPassword = generateRandomPassword(16)') &&
    instanceTaskWorkerSource.includes('rootPassword: newPassword') &&
    instanceTaskWorkerSource.includes('sshKey,') &&
    instanceTaskWorkerSource.includes('rootPassword: encryptSensitiveData(newPassword)') &&
    instanceTaskWorkerSource.includes('SSH key is optional; password login still remains available when no key is present'),
  'instance rebuild worker must inject the buyer SSH key when available or generate and store a fresh root password for delivery'
)

assert(
  exchangeDeliveryWorkerSource.includes('async function autoDelistExpiredListings') &&
    exchangeDeliveryWorkerSource.includes("status: 'active'") &&
    exchangeDeliveryWorkerSource.includes('autoDelistAt: { lte: now }') &&
    exchangeDeliveryWorkerSource.includes("status: 'delisted'") &&
    exchangeDeliveryWorkerSource.includes("action: 'listing.auto_delist'") &&
    exchangeDeliveryWorkerSource.includes('await autoDelistExpiredListings()') &&
    exchangeDeliveryWorkerSource.includes('exchange.listing.auto_delisted'),
  'exchange delivery worker must automatically delist active listings after autoDelistAt and write audit/log evidence'
)

assert(
  exchangeDeliveryWorkerSource.includes('async function escalateTimedOutDisputes') &&
    exchangeDeliveryWorkerSource.includes('policy?.disputeTimeoutHours ?? 72') &&
    exchangeDeliveryWorkerSource.includes("status: 'open'") &&
    exchangeDeliveryWorkerSource.includes("status: 'processing'") &&
    exchangeDeliveryWorkerSource.includes("status: 'manual_review'") &&
    exchangeDeliveryWorkerSource.includes("action: 'dispute.timeout_escalate'") &&
    exchangeDeliveryWorkerSource.includes('exchange.dispute.timeout_escalated') &&
    exchangeDeliveryWorkerSource.includes('await escalateTimedOutDisputes()'),
  'exchange delivery worker must enforce dispute timeout policy by escalating stale open disputes into manual processing'
)

assert(
  exchangeServiceSource.includes('releaseExchangeOrderEscrow') &&
    exchangeServiceSource.includes("type: 'escrow_release'") &&
    exchangeServiceSource.includes("type: 'fee_charge'") &&
    exchangeServiceSource.includes("status: 'completed'") &&
    exchangeServiceSource.includes('walletLogId: walletLog.id') &&
    exchangeServiceSource.includes('resolveDispute?:') &&
    exchangeServiceSource.includes('EXCHANGE_DISPUTE_STATE_CHANGED') &&
    exchangeServiceSource.includes("targetType: 'exchange_dispute'") &&
    exchangeServiceSource.includes('disputeReleaseWalletLogId: disputeReleaseLog?.id ?? null') &&
    exchangeServiceSource.includes('alreadyReleased: true'),
  'exchange service must release escrow only through the confirmation/administrator settlement path and close resolving disputes atomically in the release transaction'
)

assert(
  exchangeServiceSource.includes('sellerUserId') &&
    exchangeServiceSource.includes('buyerUserId') &&
    exchangeServiceSource.includes("privacyMode: 'anonymous'") &&
	    exchangeServiceSource.includes("deliveryMode: 'reinstall_required'") &&
	    exchangeServiceSource.includes("viewerRole: 'buyer' | 'seller'") &&
	    exchangeServiceSource.includes("canViewBuyerDeliveryPreference") &&
	    exchangeServiceSource.includes('startedAt: toDateIso(deliveryTask.startedAt)') &&
	    exchangeServiceSource.includes('finishedAt: toDateIso(deliveryTask.finishedAt)') &&
	    exchangeServiceSource.includes('const visibleSnapshot = sanitizePublicInstanceSnapshot(order.snapshot)') &&
	    exchangeServiceSource.includes('instance: visibleSnapshot') &&
	    exchangeServiceSource.includes('snapshot: visibleSnapshot') &&
	    exchangeServiceSource.includes("serializeOrder(item, item.deliveryTasks[0] || null, role)") &&
    exchangeServiceSource.includes('export async function getUserExchangeOrder') &&
    exchangeServiceSource.includes('OR: [') &&
    exchangeServiceSource.includes('buyerUserId: userId') &&
    exchangeServiceSource.includes('sellerUserId: userId') &&
    exchangeServiceSource.includes("order.buyerUserId === userId ? 'buyer' : 'seller'") &&
    exchangeServiceSource.includes('order: serializeOrder(order, order.deliveryTasks[0] || null, viewerRole)'),
  'exchange service must persist buyer/seller ids internally while returning anonymous delivery markers, real delivery timestamps, hiding seller original snapshots and buyer delivery preferences from the opposite side, and exposing participant-only order detail'
)

const publicListingReturnSection = sourceBetween(exchangeServiceSource, 'function serializePublicListing', 'function serializeOrder')
const orderReturnSection = sourceBetween(exchangeServiceSource, 'function serializeOrder', 'function serializeWithdrawal').split('return {')[1] || ''
const disputeReturnSection = sourceBetween(exchangeServiceSource, 'export async function listExchangeDisputes', 'function serializeWallet').split('items: items.map')[1] || ''
assert(
  publicListingReturnSection.includes('sellerReceivesAmount: _sellerReceivesAmount') &&
    orderReturnSection.includes("...(viewerRole === 'seller' ? { sellerReceivesAmount: toNumber(order.sellerReceivesAmount) } : {})"),
  'public exchange listings and buyer-view orders must not expose the seller net settlement amount; only seller-view order/listing responses may include sellerReceivesAmount'
)
for (const strippedRootSnapshotField of ['instanceId', 'name']) {
  assert(
    exchangeServiceSource.includes(`'${strippedRootSnapshotField}'`) && exchangeServiceSource.includes('publicSnapshotRootForbiddenFields.has(key)'),
    `public and participant exchange snapshots must strip root ${strippedRootSnapshotField}`
  )
}
for (const strippedSnapshotField of [
  'userId',
  'user_id',
  'ownerId',
  'owner_id',
  'fromUserId',
  'from_user_id',
  'toUserId',
  'to_user_id',
  'sellerUserId',
  'buyerUserId',
  'creatorUserId',
  'createdById',
  'updatedById',
  'operatorUserId',
  'username',
  'userName',
  'nickname',
  'displayName',
  'email',
  'emailMasked',
  'contact',
  'contactEmail',
  'phone',
  'mobile',
  'telegram',
  'telegramId',
  'telegramUsername',
  'wechat',
  'weixin',
  'qq',
  'avatar',
  'avatarStyle',
  'avatarBadgeId',
  'registeredAt',
  'createdBy',
  'updatedBy',
  'operator',
  'owner',
  'fromUser',
  'toUser',
  'buyer',
  'seller',
  'user'
]) {
  assert(
    exchangeServiceSource.includes(`'${strippedSnapshotField}'`) && exchangeServiceSource.includes('publicSnapshotForbiddenFields.has(key)'),
    `public and participant exchange snapshots must strip ${strippedSnapshotField}`
  )
}
for (const allowedPublicSnapshotField of ['host:', 'package:', 'packagePlan:']) {
  assert(exchangeServiceSource.includes(allowedPublicSnapshotField), `public exchange snapshots must keep sale metadata ${allowedPublicSnapshotField}`)
}
for (const forbiddenIdentityField of [
  'buyerUserId',
  'sellerUserId',
  'creatorUserId',
  'userId',
  'user_id',
  'ownerId',
  'owner_id',
  'fromUserId',
  'toUserId',
  'username',
  'userName',
  'nickname',
  'email',
  'emailMasked',
  'contact',
  'contactEmail',
  'phone',
  'mobile',
  'telegram',
  'wechat',
  'avatar',
  'registeredAt',
  'createdBy',
  'updatedBy',
  'owner',
  'fromUser',
  'toUser'
]) {
  assert(!publicListingReturnSection.includes(forbiddenIdentityField), `public listing response must not expose ${forbiddenIdentityField}`)
  assert(!orderReturnSection.includes(forbiddenIdentityField), `user exchange order response must not expose ${forbiddenIdentityField}`)
  assert(!disputeReturnSection.includes(forbiddenIdentityField), `user exchange dispute response must not expose ${forbiddenIdentityField}`)
}

const anonymousUserExchangeTypeSections = [
  interfaceSection(clientTypesSource, 'ExchangeListing'),
  interfaceSection(clientTypesSource, 'ExchangeOrder'),
  interfaceSection(clientTypesSource, 'ExchangeDeliveryTask'),
  interfaceSection(clientTypesSource, 'ExchangeWalletLog'),
  interfaceSection(clientTypesSource, 'ExchangeWithdrawal'),
  interfaceSection(clientTypesSource, 'ExchangeDispute')
]
for (const forbiddenUserTypeIdentityField of [
  'buyerUserId',
  'sellerUserId',
  'creatorUserId',
  'userId',
  'user_id',
  'ownerId',
  'owner_id',
  'fromUserId',
  'toUserId',
  'buyer:',
  'seller:',
  'user:',
  'fromUser:',
  'toUser:',
  'username',
  'userName',
  'nickname',
  'email',
  'emailMasked',
  'contact',
  'contactEmail',
  'phone',
  'mobile',
  'telegram',
  'wechat',
  'avatar',
  'registeredAt'
]) {
  for (const section of anonymousUserExchangeTypeSections) {
    assert(!section.includes(forbiddenUserTypeIdentityField), `user exchange API types must not expose ${forbiddenUserTypeIdentityField}`)
  }
}

assert(
  exchangeServiceSource.includes("deliveryMode: 'reinstall_required'") &&
    exchangeServiceSource.includes("privacyMode: 'anonymous'"),
  'exchange responses must expose reinstall-required and anonymous-trading markers'
)

assert(
  exchangeServiceSource.includes('export async function getPublicExchangePolicy') &&
    exchangeServiceSource.includes('minRemainingDays: policy.minRemainingDays') &&
    exchangeServiceSource.includes('expiringSoonDays: policy.expiringSoonDays') &&
    exchangeServiceSource.includes('maxMarkupPercent: policy.maxMarkupPercent') &&
    exchangeServiceSource.includes('allowBuyerImageSelection: policy.allowBuyerImageSelection') &&
    exchangeServiceSource.includes('allowBalanceTransfer: policy.allowBalanceTransfer') &&
    exchangeServiceSource.includes('allowPublicIpTransfer: policy.allowPublicIpTransfer') &&
    exchangeServiceSource.includes('withdrawalMinAmount: toNumber(policy.minWithdrawalAmount)') &&
    exchangeServiceSource.includes('dailyWithdrawalCountLimit: policy.dailyWithdrawalCountLimit') &&
    exchangeServiceSource.includes('maxPurchasesPerUserPerDay: policy.maxPurchasesPerUserPerDay'),
  'exchange service must expose a non-sensitive public policy summary for user purchase and wallet UI'
)

assert(
	  exchangeRouteSource.includes("onRequest: [fastify.authenticateUser]") &&
	    exchangeRouteSource.includes("fastify.get('/config'") &&
	    exchangeRouteSource.includes('getPublicExchangePolicy') &&
	    exchangeRouteSource.includes('/instances/:instanceId/eligibility') &&
	    exchangeRouteSource.includes('/instances/:instanceId/listing-state') &&
	    exchangeRouteSource.includes('/instances/:instanceId/stop-for-listing') &&
		    exchangeRouteSource.includes('EXCHANGE_INSTANCE_CANNOT_STOP_FOR_LISTING') &&
		    exchangeRouteSource.includes("nextAction: 'recheck_listing_eligibility'") &&
		    exchangeRouteSource.includes('/market/:listingId/purchase') &&
				exchangeRouteSource.includes('normalizePurchaseBody') &&
				exchangeRouteSource.includes('imageAlias: input.imageAlias') &&
				exchangeRouteSource.includes('sshKeyId: input.sshKeyId') &&
		    exchangeRouteSource.includes('/orders/:orderId') &&
		    exchangeRouteSource.includes('getUserExchangeOrder(request.user.id, orderId)') &&
		    exchangeRouteSource.includes('/wallet/transfer') &&
    exchangeRouteSource.includes('/withdrawals') &&
    exchangeRouteSource.includes('/orders/:orderId/disputes') &&
    exchangeRouteSource.includes('requireExchangeVerification') &&
    exchangeRouteSource.includes("EXCHANGE_OPERATION_VERIFICATION_REQUIRED") &&
    exchangeRouteSource.includes("'exchange_purchase'") &&
    exchangeRouteSource.includes("'exchange_withdrawal'") &&
    exchangeRouteSource.includes("'exchange_balance_transfer'") &&
    exchangeRouteSource.includes('getRequestIdempotencyKey') &&
    exchangeRouteSource.includes('hasExistingIdempotentExchangeAction'),
  'exchange routes must expose authenticated eligibility, purchase, wallet, withdrawal, dispute endpoints, and verification gates for sensitive money operations'
)

assert(
		    adminExchangeRouteSource.includes('/orders/:id/refund') &&
	    adminExchangeRouteSource.includes("type: 'escrow_refund'") &&
	    adminExchangeRouteSource.includes('refundWalletLogId') &&
	    adminExchangeRouteSource.includes("type: 'refund'") &&
	    adminExchangeRouteSource.includes('buyerRefundBillingRecordId: buyerRefundBillingRecord.id') &&
	    adminExchangeRouteSource.includes('deliveredBuyerInstanceSuspended') &&
	    adminExchangeRouteSource.includes("status: 'suspended'") &&
	    adminExchangeRouteSource.includes("suspendReason: `exchange_${targetStatus}`") &&
	    adminExchangeRouteSource.includes('/orders/:id/freeze') &&
    adminExchangeRouteSource.includes('/orders/:id/cancel') &&
	adminExchangeRouteSource.includes('/disputes/:id/refund') &&
	adminExchangeRouteSource.includes('/disputes/:id/reject') &&
		adminExchangeRouteSource.includes('/disputes/:id/release') &&
		adminExchangeRouteSource.includes('claimExchangeDisputeForProcessing') &&
		adminExchangeRouteSource.includes('restoreProcessingDispute') &&
		adminExchangeRouteSource.includes("const activeDisputeStatuses = ['open', 'processing', 'redelivering'] as const") &&
		adminExchangeRouteSource.includes('status: { in: [...activeDisputeStatuses] }') &&
		adminExchangeRouteSource.includes("dispute.status === 'processing' && dispute.handledByUserId && dispute.handledByUserId !== actorUserId") &&
	adminExchangeRouteSource.includes("{ status: 'open' }") &&
	adminExchangeRouteSource.includes("{ status: 'processing', handledByUserId: null }") &&
	adminExchangeRouteSource.includes("{ status: 'processing', handledByUserId: actorUserId }") &&
	adminExchangeRouteSource.includes("where: { id, status: 'processing', handledByUserId: user.id }") &&
	adminExchangeRouteSource.includes('let claimedDispute = false') &&
	adminExchangeRouteSource.includes('claimedDispute = true') &&
	adminExchangeRouteSource.includes('orderActionCompleted') &&
	adminExchangeRouteSource.includes('/delivery-tasks/:id/manual-takeover') &&
		adminExchangeRouteSource.includes('/delivery-tasks/:id/rollback') &&
			adminExchangeRouteSource.includes('/delivery-tasks/:id/complete') &&
			adminExchangeRouteSource.includes('delivery.manual_takeover') &&
			adminExchangeRouteSource.includes('delivery.rollback') &&
			adminExchangeRouteSource.includes('delivery.manual_complete') &&
			adminExchangeRouteSource.includes('completeDeliveryTaskManually') &&
			adminExchangeRouteSource.includes('实例尚未转移给买家，不能人工确认交割完成') &&
			adminExchangeRouteSource.includes('实例尚未完成匿名交割重命名，不能人工确认交割完成') &&
			adminExchangeRouteSource.includes('关联重装任务尚未完成，不能人工确认交割完成') &&
			adminExchangeRouteSource.includes('manualSafetyChecks') &&
			adminExchangeRouteSource.includes('ownerTransferredToBuyer: true') &&
			adminExchangeRouteSource.includes('anonymousIncusIdVerified: true') &&
			adminExchangeRouteSource.includes('anonymousDisplayNameVerified: true') &&
			adminExchangeRouteSource.includes('buyerBillingRecordId: buyerBillingRecord.id') &&
			adminExchangeRouteSource.includes("remark: `交易所购买 ${task.order.orderNo}`") &&
			adminExchangeRouteSource.includes('trafficUsagePreserved: true') &&
			adminExchangeRouteSource.includes("status: 'confirming'") &&
			adminExchangeRouteSource.includes("status: 'sold'") &&
			adminExchangeRouteSource.includes("status: 'COMPLETED'") &&
		adminExchangeRouteSource.includes('sendNotification(result.buyerUserId') &&
		adminExchangeRouteSource.includes('exchange_delivery_completed') &&
		adminExchangeRouteSource.includes("!['FAILED', 'CANCELLED'].includes(current.status)") &&
		adminExchangeRouteSource.includes("status: 'delivering'") &&
		adminExchangeRouteSource.includes("data: { status: 'locked' }") &&
			adminExchangeRouteSource.includes('retryFrom: current.step || current.status') &&
			adminExchangeRouteSource.includes('previousOrderStatus: current.order.status') &&
			adminExchangeRouteSource.includes('const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE') &&
			adminExchangeRouteSource.includes("where: { id, status: { in: ['FAILED', 'CANCELLED'] } }") &&
			adminExchangeRouteSource.includes('const claimedTask = await tx.exchangeDeliveryTask.updateMany') &&
			adminExchangeRouteSource.includes('交割任务状态已变化，请刷新后重试') &&
			adminExchangeRouteSource.includes("current.status !== 'pending'") &&
			adminExchangeRouteSource.includes("where: { id, status: 'pending' }") &&
			adminExchangeRouteSource.includes('只有待审核提现可以审核通过') &&
		adminExchangeRouteSource.includes('/wallets/:userId/freeze') &&
    adminExchangeRouteSource.includes('/wallets/:userId/unfreeze') &&
    adminExchangeRouteSource.includes('/wallets/:userId/adjust') &&
	    adminExchangeRouteSource.includes("type: 'exchange_refund'") &&
	    adminExchangeRouteSource.includes("type: 'admin_adjust'") &&
	    adminExchangeRouteSource.includes("type: 'withdrawal_complete'") &&
		    adminExchangeRouteSource.includes("type: 'withdrawal_reject'") &&
		    adminExchangeRouteSource.includes('withdrawal.complete') &&
		    adminExchangeRouteSource.includes('withdrawal.reject') &&
		    adminExchangeRouteSource.includes('async function assertWithdrawalStillPayable') &&
		    adminExchangeRouteSource.includes('用户账号处于风控限制中，不能审核或完成提现') &&
		    adminExchangeRouteSource.includes('用户存在未完结交易所争议，不能审核或完成提现') &&
		    adminExchangeRouteSource.includes('用户存在未结算交易或确认期未结束，不能审核或完成提现') &&
		    adminExchangeRouteSource.includes("const proofUrl = normalizeText(body?.proofUrl, '', 500)") &&
		    adminExchangeRouteSource.includes('打款凭证 URL 或流水号不能为空') &&
		    adminExchangeRouteSource.includes('proofUrl,') &&
		    countOccurrences(adminExchangeRouteSource, 'await assertWithdrawalStillPayable(tx, current.userId)') >= 2 &&
		    adminExchangeRouteSource.includes('recordExchangeDisputeWalletReleaseInTransaction') &&
	    adminExchangeRouteSource.includes('auditInTransaction(tx') &&
	    adminExchangeRouteSource.includes('wallet.freeze') &&
	    adminExchangeRouteSource.includes('wallet.unfreeze') &&
	    adminExchangeRouteSource.includes('wallet.adjust') &&
	    adminExchangeRouteSource.includes('freezeExchangeOrder') &&
    adminExchangeRouteSource.includes('/risk-records') &&
    adminExchangeRouteSource.includes('releaseExchangeOrderEscrow') &&
    adminExchangeRouteSource.includes('resolveDispute: {') &&
    adminExchangeRouteSource.includes('releaseRemark: `交易所争议 ${id} 人工放款，争议冻结标记解除：${resolution}`') &&
    !adminExchangeRouteSource.includes("action: 'dispute.release', 'exchange_dispute'") &&
    adminExchangeRouteSource.includes("!['active', 'paused', 'delivery_failed'].includes(listing.status)"),
	  'admin exchange routes must support refunds, order freeze/cancel, dispute release, wallet freeze/unfreeze/adjust, risk records, and must not force-delist locked orders'
)

const refundOrderSection = sourceBetween(adminExchangeRouteSource, 'async function refundExchangeOrder', 'async function freezeExchangeOrder')
const refundReturnSection = sourceBetween(adminExchangeRouteSource, 'async function returnDeliveredExchangeInstanceForRefund', 'async function refundExchangeOrder')
const manualCompleteSection = sourceBetween(adminExchangeRouteSource, 'async function completeDeliveryTaskManually', 'async function claimExchangeDisputeForProcessing')
const adminDisputeRefundRoute = routeBlock(adminExchangeRouteSource, "'/disputes/:id/refund'")
assertSourceOrder(
  refundReturnSection,
  [
    'options: { allowAlreadyRefunded?: boolean } = {}',
    'const allowAlreadyRefundedReturn = options.allowAlreadyRefunded === true',
    'const orderLocked = await tryAdvisoryTransactionLock',
    "order.status === 'refunded' && !allowAlreadyRefundedReturn",
    "order.status === 'refunded' && !order.refundBalanceLogId",
    "const alreadyRefundedReturn = order.status === 'refunded'",
    "status: 'manual_review'",
    'await stopInstance(client, context.currentIncusId, true)',
    'await renameIncusInstance(client, context.currentIncusId, restoredIncusId)',
    'userId: context.sellerUserId',
    'incusId: restoredIncusId',
    "status: 'stopped'",
    'context.alreadyRefundedReturn',
    "action: 'order.refund_instance_return'",
    'alreadyRefundedReturn: context.alreadyRefundedReturn',
    'trafficUsagePreserved: true'
  ],
  'admin exchange dispute/order refund must return already-delivered instances to the original seller before refunding buyer funds, including already-refunded repair states, while preserving traffic usage'
)
assertSourceOrder(
  refundOrderSection,
  [
    'resolveDispute?: {',
    'existingOrder?.status === targetStatus',
    'const instanceReturn = await returnDeliveredExchangeInstanceForRefund',
    'allowAlreadyRefunded: true',
    'alreadyRefunded: true',
    'const resolved = await tx.exchangeDispute.updateMany',
    "status: 'refunded'",
    'disputeReleaseWalletLogId: disputeReleaseLog?.id ?? null'
  ],
  'admin exchange dispute refund must close the dispute inside the refund transaction and repair already-refunded half-complete states without double refunding'
)
assertSourceOrder(
  refundOrderSection,
  [
    'const instanceReturn = await returnDeliveredExchangeInstanceForRefund',
    'const orderLocked = await tryAdvisoryTransactionLock',
    "status: 'manual_review'",
    "type: 'exchange_refund'",
    "type: 'refund'",
    "status: 'suspended'",
    "type: 'escrow_refund'",
    "status: targetStatus",
    "action: targetStatus === 'cancelled' ? 'order.cancel' : 'order.refund'",
    'deliveredBuyerInstanceReturned: instanceReturn.returned'
  ],
  'admin exchange refund must return delivered instances first, lock the order, refund buyer balance, write billing/wallet/audit logs, and keep the old suspend fallback for non-returned delivered state'
)
assert(
  adminDisputeRefundRoute.includes("await refundExchangeOrder(dispute.orderId, user.id, resolution, 'refunded', {") &&
    adminDisputeRefundRoute.includes('disputeId: id') &&
    !adminDisputeRefundRoute.includes('recordExchangeDisputeWalletReleaseInTransaction(tx') &&
    adminDisputeRefundRoute.includes('prisma.exchangeDispute.findUniqueOrThrow'),
  'admin dispute refund route must delegate dispute closure to refundExchangeOrder instead of running a second post-refund transaction'
)
assertSourceOrder(
  manualCompleteSection,
  [
    'if (task.instance.userId !== task.buyerUserId)',
    'if (!task.instance.incusId.startsWith',
    "task.instance.name.startsWith('exchange-')",
    "task.instanceTask && task.instanceTask.status !== 'COMPLETED'",
    "type: 'newPurchase'",
    "status: 'COMPLETED'",
    "status: 'confirming'",
    "status: 'sold'",
    'manualSafetyChecks'
  ],
  'admin manual delivery completion must verify buyer ownership, anonymous identity, completed rebuild, billing rebuild, sold listing, and confirmation state'
)

assert(
  exchangeServiceSource.includes('EXCHANGE_ORDER_LOCK_NAMESPACE') &&
	    exchangeServiceSource.includes('const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)') &&
	    exchangeServiceSource.includes('EXCHANGE_DISPUTE_EXISTS') &&
	    exchangeServiceSource.includes("type: 'dispute_freeze'") &&
	    exchangeServiceSource.includes('dispute.freeze') &&
		    exchangeServiceSource.includes("const activeDisputeStatuses: ExchangeDisputeStatus[] = ['open', 'processing', 'redelivering']") &&
		    exchangeServiceSource.includes('status: { in: activeDisputeStatuses }') &&
    exchangeServiceSource.includes('EXCHANGE_ORDER_STATE_CHANGED'),
  'user dispute creation must use order-level transaction locking, idempotency, active-dispute checks, and conditional order status updates'
)

assert(
  userExchangeViewSource.includes('上架前必须先暂停实例') &&
    userExchangeViewSource.includes('function instanceStatusLabel') &&
    userExchangeViewSource.includes('function canOpenListingEntry') &&
    userExchangeViewSource.includes('function requestListingEntry') &&
    userExchangeViewSource.includes("eligibility?.status === 'must_stop_first'") &&
    userExchangeViewSource.includes('@click="requestListingEntry(instance)"') &&
    userExchangeViewSource.includes('只有已暂停并通过检测的实例可以提交挂牌') &&
    userExchangeViewSource.includes('先暂停实例') &&
    userExchangeViewSource.includes('function ipSummary') &&
    userExchangeViewSource.includes('独立 IP') &&
    userExchangeViewSource.includes('暂停交割') &&
    userExchangeViewSource.includes('openListingDetail') &&
    userExchangeViewSource.includes('买家获得重装后的新实例，不包含卖家原数据') &&
    userExchangeViewSource.includes('实例锁定') &&
    userExchangeViewSource.includes('保留流量用量') &&
    userExchangeViewSource.includes('流量用量和剩余额度按挂牌实例当前状态交割') &&
    userExchangeViewSource.includes('requestEditListing') &&
    userExchangeViewSource.includes('listingEditDraft') &&
    userExchangeViewSource.includes('修改挂牌信息') &&
	    userExchangeViewSource.includes('requestDelist') &&
	    userExchangeViewSource.includes('pendingDelistListing') &&
	    userExchangeViewSource.includes('确认下架交易所') &&
	    userExchangeViewSource.includes("['active', 'paused'].includes(listing.status)") &&
	    userExchangeViewSource.includes("paused: '暂停挂牌中'") &&
	    userExchangeViewSource.includes('requestCreateListing') &&
    userExchangeViewSource.includes('showListingConfirm') &&
    userExchangeViewSource.includes('确认上架交易所') &&
    userExchangeViewSource.includes('确认挂牌') &&
    userExchangeViewSource.includes('pendingPurchaseListing') &&
    userExchangeViewSource.includes('requestPurchaseListing') &&
    userExchangeViewSource.includes('确认购买交易所实例') &&
    userExchangeViewSource.includes('确认购买并托管') &&
    userExchangeViewSource.includes("{ key: 'records', label: '交易记录' }") &&
	    userExchangeViewSource.includes('(res as any).items || (res as any).instances') &&
	    userExchangeViewSource.includes('const recordPageSize = 10') &&
	    userExchangeViewSource.includes('marketTotalPages') &&
	    userExchangeViewSource.includes('changeMarketPage') &&
	    userExchangeViewSource.includes('myListingsPage') &&
	    userExchangeViewSource.includes('changeMyListingsPage') &&
	    userExchangeViewSource.includes('buysPage') &&
	    userExchangeViewSource.includes('changeBuysPage') &&
	    userExchangeViewSource.includes('salesPage') &&
	    userExchangeViewSource.includes('changeSalesPage') &&
	    userExchangeViewSource.includes('walletLogsPage') &&
	    userExchangeViewSource.includes('changeWalletLogsPage') &&
	    userExchangeViewSource.includes('withdrawalsPage') &&
	    userExchangeViewSource.includes('changeWithdrawalsPage') &&
	    userExchangeViewSource.includes('disputesPage') &&
	    userExchangeViewSource.includes('changeDisputesPage') &&
	    userExchangeViewSource.includes('pageSummary(') &&
	    !userExchangeViewSource.includes('api.exchange.myListings({ page: 1') &&
	    !userExchangeViewSource.includes('api.exchange.myBuys({ page: 1') &&
	    !userExchangeViewSource.includes('api.exchange.mySales({ page: 1') &&
	    !userExchangeViewSource.includes('api.exchange.walletLogs({ page: 1') &&
	    !userExchangeViewSource.includes('api.exchange.withdrawals({ page: 1') &&
	    !userExchangeViewSource.includes('api.exchange.disputes({ page: 1') &&
	    userExchangeViewSource.includes('SensitiveVerificationModal') &&
	    userExchangeViewSource.includes('EXCHANGE_OPERATION_VERIFICATION_REQUIRED') &&
	    userExchangeViewSource.includes('instanceNeedsStopBeforeListing') &&
	    userExchangeViewSource.includes('stopConfirmInstance') &&
	    userExchangeViewSource.includes('requestStopBeforeListing') &&
	    userExchangeViewSource.includes('cancelStopBeforeListing') &&
	    userExchangeViewSource.includes('confirmStopBeforeListing') &&
	    userExchangeViewSource.includes('api.exchange.stopForListing') &&
	    userExchangeViewSource.includes('挂牌期间保持暂停/锁定') &&
			userExchangeViewSource.includes('清理 SSH key') &&
	    userExchangeViewSource.includes('deliveryPolicyCheckKeys') &&
	    userExchangeViewSource.includes('admissionEligibilityChecks') &&
	    userExchangeViewSource.includes('deliveryPolicyEligibilityChecks') &&
	    userExchangeViewSource.includes('准入检测结果') &&
	    userExchangeViewSource.includes('交割清理和转移策略') &&
	    userExchangeViewSource.includes("'cleanup_port_mappings'") &&
	    userExchangeViewSource.includes("'cleanup_proxy_sites'") &&
	    userExchangeViewSource.includes("'cleanup_snapshots'") &&
	    userExchangeViewSource.includes("'cleanup_backup_policy'") &&
	    userExchangeViewSource.includes('冻结卖家访问') &&
	    userExchangeViewSource.includes('清理控制台 token') &&
	    userExchangeViewSource.includes('重建账单和续费归属') &&
			userExchangeViewSource.includes('deliveryProgressSteps') &&
			userExchangeViewSource.includes('deliveryStepState') &&
			userExchangeViewSource.includes('refreshOrderDetail') &&
			userExchangeViewSource.includes('api.exchange.orderDetail(order.id)') &&
			userExchangeViewSource.includes('刷新进度') &&
			userExchangeViewSource.includes('requestCreateDispute') &&
			userExchangeViewSource.includes('disputeDraft') &&
			userExchangeViewSource.includes('发起交易争议') &&
			!userExchangeViewSource.includes("window.prompt('请输入争议原因") &&
			userExchangeViewSource.includes('showTransferConfirm') &&
			userExchangeViewSource.includes('确认划转到账户余额') &&
			userExchangeViewSource.includes('canTransferExchangeBalance') &&
			userExchangeViewSource.includes('当前交易所策略未开放划转到账户余额') &&
			userExchangeViewSource.includes('划转会即时进入账户余额，但仍会先通过风控和二次验证') &&
			userExchangeViewSource.includes('showWithdrawalConfirm') &&
			userExchangeViewSource.includes('确认提交提现审核') &&
			userExchangeViewSource.includes('canSubmitWithdrawal') &&
			userExchangeViewSource.includes('提现必须人工审核，最低提现') &&
			userExchangeViewSource.includes('提现金额不能低于') &&
			!userExchangeViewSource.includes('window.prompt') &&
			!userExchangeViewSource.includes('window.confirm') &&
			userExchangeViewSource.includes('交割已完成，确认期截止') &&
			userExchangeViewSource.includes('确认期结束后托管款扣除手续费进入卖家交易所余额') &&
			userExchangeViewSource.includes('policyFeeSummary') &&
			userExchangeViewSource.includes('policyWithdrawalSummary') &&
			userExchangeViewSource.includes('交易费率') &&
			userExchangeViewSource.includes('交割确认') &&
			userExchangeViewSource.includes('交易限制') &&
			userExchangeViewSource.includes('准入和交割策略') &&
			userExchangeViewSource.includes('匿名交易') &&
			userExchangeViewSource.includes('强制重装交割') &&
			userExchangeViewSource.includes('资金托管') &&
			userExchangeViewSource.includes('renewalPriceLabel') &&
			userExchangeViewSource.includes('续费价格') &&
			    userExchangeViewSource.includes("'exchange_purchase'") &&
		    userExchangeViewSource.includes("'exchange_withdrawal'") &&
		    userExchangeViewSource.includes("'exchange_balance_transfer'") &&
			userExchangeViewSource.includes('交割设置') &&
			userApiSource.includes('getConfig: (): Promise<ExchangePublicConfig>') &&
			clientTypesSource.includes('export interface ExchangePublicConfig') &&
			userExchangeViewSource.includes('exchangeConfig.value = await api.exchange.getConfig()') &&
			userExchangeViewSource.includes('exchangeConfig.value.allowBuyerImageSelection') &&
			userExchangeViewSource.includes('v-if="exchangeConfig.allowBuyerImageSelection"') &&
			userExchangeViewSource.includes('当前交易所策略未开放买家自选镜像') &&
			userExchangeViewSource.includes('api.images.getSystemImages') &&
			userExchangeViewSource.includes('api.sshKeys.list') &&
				userExchangeViewSource.includes('使用原实例镜像重装') &&
				userExchangeViewSource.includes('重装镜像：') &&
				userExchangeViewSource.includes("activeTab === 'buys'") &&
					userExchangeViewSource.includes('查看并购买') &&
					userExchangeViewSource.includes('{{ statusLabel(listing.status) }}') &&
					userExchangeViewSource.includes('剩余有效期') &&
					userExchangeViewSource.includes('<dt class="font-medium text-themed">交割方式</dt>') &&
					userExchangeViewSource.includes('暂停锁定后强制重装') &&
					userExchangeViewSource.includes('开始：{{ formatDate(order.deliveryTask.startedAt) }}') &&
					userExchangeViewSource.includes('平台手续费 {{ money(selectedListing.feeAmount) }}') &&
					!userExchangeViewSource.includes('卖家预计到账 {{ money(selectedListing.sellerReceivesAmount) }}') &&
					userExchangeViewSource.includes('购买后获得的是实例剩余使用权') &&
					userExchangeViewSource.includes('不包含卖家原系统、原数据、账号信息或历史订单') &&
					userExchangeViewSource.includes('实例当前已用流量和剩余额度会按挂牌时状态交割，不会因交易重置') &&
					userExchangeViewSource.includes('当前已用流量和剩余额度会原样交割，不会重置') &&
					userExchangeViewSource.includes('买卖双方前台互不可见') &&
					userExchangeViewSource.includes('成交前实例保持暂停锁定') &&
					userExchangeViewSource.includes('交易状态') &&
					userExchangeViewSource.includes('挂牌说明') &&
					userExchangeViewSource.includes('平台仍会按强制重装交割'),
  'user exchange view must show stopped-instance requirements, listing status, detailed anonymous listing information, editable active listings, transaction records, purchase delivery settings, and verification retry flow for money operations'
)

assert(
  exchangeServiceSource.includes("status: { in: ['active', 'paused'] }") &&
    exchangeServiceSource.includes("action: 'listing.delist'") &&
    !exchangeServiceSource.includes("status: { in: ['active', 'paused', 'locked'] }"),
  'seller delist must support active and paused listings while keeping locked or delivery-failed listings protected'
)

assert(
  userApiSource.includes('orderDetail: (orderId: number)') &&
    userApiSource.includes('http.get(`/exchange/orders/${orderId}`)'),
  'user exchange API must expose a participant-only order detail endpoint for refreshing delivery progress'
)

assert(
  instancesViewSource.includes('isInstanceExchangeLocked') &&
    instancesViewSource.includes('selectedBillingActionIds') &&
    instancesViewSource.includes('!!instance.packagePlanId && !isInstanceExchangeLocked(instance)') &&
    countOccurrences(instancesViewSource, 'selectedBillingActionIds.value') >= 3 &&
    countOccurrences(instancesViewSource, 'selectedBillingActionIds.length === 0') >= 3 &&
    instancesExchangeStateLoaderSource.includes('instances.value.map(instance => instance.id)') &&
    instancesExchangeStateLoaderSource.includes('api.exchange.getInstanceListing(instanceId)') &&
    !instancesExchangeStateLoaderSource.includes('api.exchange.myListings') &&
    instancesViewSource.includes('canStartInstance') &&
    instancesViewSource.includes('canDeleteInstance') &&
    instancesViewSource.includes('canTransferInstance') &&
    instancesViewSource.includes("['active', 'paused', 'locked', 'delivery_failed'].includes(listing.status)") &&
    instancesViewSource.includes('交易所挂牌中') &&
    instancesViewSource.includes('交易所暂停中') &&
    !instancesViewSource.includes("label: '可上架'") &&
    !instancesViewSource.includes("label: '需先暂停'") &&
    !instancesViewSource.includes("label: '不可上架'") &&
    instancesViewSource.includes('挂牌已暂停，实例仍保持交易锁定') &&
    instancesViewSource.includes('暂停锁定 · 挂牌价') &&
    instancesViewSource.includes('等待平台重试、退款或人工接管') &&
    instancesViewSource.includes('实例已上架交易所或处于交割中，不能执行该操作') &&
    instancesViewSource.includes('实例已上架交易所或处于交割中，不能 PUSH'),
  'instances view must show exchange listing state and block start/delete/transfer/reset/billing actions while listed or delivering'
)

assert(
  instanceDetailViewSource.includes('交易所上架') &&
    instanceDetailViewSource.includes('实例必须处于暂停状态才能挂牌') &&
    instanceDetailViewSource.includes('checkExchangeEligibility') &&
  instanceDetailViewSource.includes('api.exchange.checkEligibility') &&
    instanceDetailViewSource.includes('api.exchange.getInstanceListing') &&
    instanceDetailViewSource.includes('showExchangeStopConfirm') &&
    instanceDetailViewSource.includes('stopInstanceForExchangeListing') &&
	    instanceDetailViewSource.includes('api.exchange.stopForListing') &&
	    instanceDetailViewSource.includes('需要先暂停后才能上架交易所') &&
	    instanceDetailViewSource.includes('原系统和数据不可恢复') &&
		    instanceDetailViewSource.includes('isExchangeLocked') &&
		    instanceDetailViewSource.includes("const exchangeListingBlockingStatuses = ['active', 'paused', 'locked', 'delivery_failed']") &&
		    instanceDetailViewSource.includes('交易所暂停中') &&
		    instanceDetailViewSource.includes('挂牌已暂停，实例仍保持交易锁定') &&
		    instanceDetailViewSource.includes('|| isExchangeLocked.value') &&
	    instanceDetailViewSource.includes('openInstanceExchangeListing') &&
	    instanceDetailViewSource.includes('清理 SSH key') &&
	    instanceDetailViewSource.includes('warnExchangeLockedOperation') &&
	    instanceDetailViewSource.includes(':exchange-locked="isExchangeLocked"') &&
	    instanceDetailViewSource.includes('交易所挂牌或交割期间不能续费') &&
	    instanceDetailViewSource.includes('交易所挂牌或交割期间不能升级配置') &&
	    instanceDetailViewSource.includes('交易所挂牌或交割期间不能销毁实例') &&
	    instanceDetailViewSource.includes('requestAddPort') &&
	    instanceDetailViewSource.includes('requestReassignIpv6'),
	  'instance detail view must expose exchange eligibility, stopped-first guidance, stop-for-listing action, operation lock, listing entry, and block billing/network/snapshot/site mutations while listed or delivering'
	)

assert(
  instanceNetworkTabSource.includes('exchangeLocked?: boolean') &&
    instanceNetworkTabSource.includes('canMutateNetwork') &&
    instanceNetworkTabSource.includes('props.exchangeLocked') &&
    instanceNetworkTabSource.includes('网络配置已锁定') &&
    instanceNetworkTabSource.includes('if (!canMutateNetwork.value) return') &&
    instanceNetworkTabSource.includes('canReassignIpv6') &&
    instanceNetworkTabSource.includes('exchangeLockText'),
  'instance network tab must become read-only for port and IPv6 mutations while the instance is exchange-listed or delivering'
)

assert(
  instanceConfigTabSource.includes('exchangeLocked?: boolean') &&
    instanceConfigTabSource.includes('const exchangeLockText') &&
    instanceConfigTabSource.includes('canMutateConfig') &&
    instanceConfigTabSource.includes('!props.exchangeLocked') &&
    instanceConfigTabSource.includes('props.exchangeLocked') &&
    instanceConfigTabSource.includes('运行配置已锁定') &&
    instanceConfigTabSource.includes('toast.warning(exchangeLockText)') &&
    instanceConfigTabSource.includes('canChangeHost = computed(() => canMutateConfig.value') &&
    instanceConfigTabSource.includes('if (!canMutateConfig.value) return false') &&
    instanceConfigTabSource.includes('showSwapModal.value = false') &&
    instanceConfigTabSource.includes('showBoostModal.value = false') &&
    instanceDetailViewSource.includes(':exchange-locked="isExchangeLocked"'),
  'instance config tab must block change-host, swap, boost, and config mutation entry points while the instance is exchange-listed or delivering'
)

assert(
  snapshotManagerSource.includes('exchangeLocked?: boolean') &&
    snapshotManagerSource.includes('mutationLocked') &&
    snapshotManagerSource.includes('快照和自动策略已锁定') &&
    snapshotManagerSource.includes('toast.warning(exchangeLockText.value)') &&
    snapshotManagerSource.includes(':disabled="mutationLocked || !hasQuota || isQuotaFull"') &&
    snapshotManagerSource.includes(':disabled="mutationLocked || policyLoading"') &&
    snapshotManagerSource.includes(':disabled="mutationLocked || createLoading || !createForm.name"'),
  'snapshot manager must block create/restore/delete and auto-policy mutations while the instance is exchange-listed or delivering'
)

assert(
  instanceSitesTabSource.includes('exchangeLocked?: boolean') &&
    instanceSitesTabSource.includes('canMutateSites') &&
    instanceSitesTabSource.includes('代理站点配置已锁定') &&
    instanceSitesTabSource.includes('toast.warning(exchangeLockText.value)') &&
    instanceSitesTabSource.includes('v-if="canMutateSites"') &&
    instanceSitesTabSource.includes(':disabled="props.exchangeLocked || adding"') &&
    instanceSitesTabSource.includes(':disabled="props.exchangeLocked || editing"'),
  'instance sites tab must block proxy site mutations while the instance is exchange-listed or delivering'
)

for (const operationType of ['exchange_purchase', 'exchange_withdrawal', 'exchange_balance_transfer']) {
  assert(sensitiveVerificationModalSource.includes(operationType), `sensitive verification modal must display ${operationType}`)
  assert(zhCnLocaleSource.includes(`${operationType}:`), `zh-CN locale must include ${operationType}`)
  assert(enLocaleSource.includes(`${operationType}:`), `en locale must include ${operationType}`)
  assert(zhTwLocaleSource.includes(`${operationType}:`), `zh-TW locale must include ${operationType}`)
}

assert(
  adminExchangeViewSource.includes('refundOrder') &&
    adminExchangeViewSource.includes('freezeOrder') &&
    adminExchangeViewSource.includes('cancelOrder') &&
    adminExchangeViewSource.includes('runDisputeAction') &&
    adminExchangeViewSource.includes('freezeWallet') &&
    adminExchangeViewSource.includes('unfreezeWallet') &&
    adminExchangeViewSource.includes('adjustWallet') &&
	adminExchangeViewSource.includes('adminActionDialog') &&
	adminExchangeViewSource.includes('submitAdminAction') &&
	adminExchangeViewSource.includes('该操作会写入交易所审计日志') &&
	adminExchangeViewSource.includes("title: '放款结案'") &&
	adminExchangeViewSource.includes("confirmText: '确认放款结案'") &&
	adminExchangeViewSource.includes("toast.success('争议已放款结案')") &&
	adminExchangeViewSource.includes(">放款结案</button>") &&
	!adminExchangeViewSource.includes("toast.success('争议已关闭')") &&
	!adminExchangeViewSource.includes("title: '关闭并维持放款'") &&
	!adminExchangeViewSource.includes('window.prompt') &&
	!adminExchangeViewSource.includes('window.confirm') &&
	adminExchangeViewSource.includes('loadRiskRecords') &&
	adminExchangeViewSource.includes('rollbackDelivery') &&
		adminExchangeViewSource.includes('manualTakeoverDelivery') &&
		adminExchangeViewSource.includes('completeDelivery') &&
		adminExchangeViewSource.includes('人工确认交割完成') &&
		adminExchangeViewSource.includes('后台会再次校验买家归属和匿名标识') &&
		adminExchangeViewSource.includes('api.exchange.completeDeliveryTask') &&
		adminExchangeViewSource.includes('packageAllowlistText') &&
		adminExchangeViewSource.includes('hostAllowlistText') &&
		adminExchangeViewSource.includes('const listState') &&
		adminExchangeViewSource.includes('activeStatusOptions') &&
		adminExchangeViewSource.includes('changeActiveStatus') &&
		adminExchangeViewSource.includes('changePage') &&
		adminExchangeViewSource.includes('重试') &&
		adminExchangeViewSource.includes('回滚') &&
		adminExchangeViewSource.includes('人工完成') &&
		adminExchangeViewSource.includes('人工接管') &&
		adminExchangeViewSource.includes('退款') &&
		adminExchangeViewSource.includes('已暂停，可交易') &&
		adminExchangeViewSource.includes('非暂停，需处理') &&
		adminExchangeViewSource.includes('已挂牌，暂停锁定中') &&
		adminExchangeViewSource.includes('不可交易原因') &&
		adminExchangeViewSource.includes('金额/托管') &&
		adminExchangeViewSource.includes('订单资金') &&
		adminExchangeViewSource.includes('orderEscrowText(item.order)') &&
		adminExchangeViewSource.includes('订单金额：{{ money(item.order.price) }} / 手续费 {{ money(item.order.feeAmount) }}') &&
		adminExchangeRouteSource.includes('order: { select: { id: true, orderNo: true, status: true, price: true, escrowAmount: true, feeAmount: true } }') &&
		adminExchangeRouteSource.includes('escrowAmount: toNumber(item.order.escrowAmount)') &&
		adminExchangeViewSource.includes('重试 {{ item.retryCount || 0 }} 次') &&
		adminExchangeViewSource.includes('开始 {{ formatDate(item.startedAt) }} / 完成 {{ formatDate(item.finishedAt) }}') &&
			adminExchangeRouteSource.includes('const exchangeDeliveryProgressSteps') &&
			adminExchangeRouteSource.includes('steps: [...exchangeDeliveryProgressSteps]') &&
			adminExchangeRouteSource.includes("step: 'lock_instance'") &&
			!adminExchangeRouteSource.includes("step: 'retry_queued'") &&
			adminExchangeRouteSource.includes("'freeze_seller_access'") &&
		adminExchangeRouteSource.includes("'cleanup_console_tokens'") &&
		adminExchangeRouteSource.includes("'rebuild_billing'"),
	  'admin exchange view must expose retry, rollback, manual takeover, refund, order freeze/cancel, dispute, wallet operation controls, risk records, allowlist config, listing pause/lock/reason state, escrow state, and delivery task status'
)

assert(
  instanceTaskSource.includes('allowExchangeLocked') &&
    instanceTaskSource.includes('实例已上架交易所或处于交易锁定中，不能执行该操作') &&
    instanceTaskSource.includes("status: { in: ['active', 'paused', 'locked', 'delivery_failed'] }") &&
    instanceTaskSource.includes("status: { in: ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review', 'failed'] }") &&
    instanceTaskSource.includes('实例存在未完成的交易所订单，不能执行该操作'),
  'instance task creation must block paused/listed, delivery-failed, exchange-ordered, or failed-order instances'
)

assert(
  instanceDestroySource.includes('getExchangeDestroyLock') &&
    instanceDestroySource.includes('EXCHANGE_DESTROY_LOCK_REASON') &&
    instanceDestroySource.includes("status: { in: ['active', 'paused', 'locked', 'delivery_failed'] }") &&
    instanceDestroySource.includes("status: { in: ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review', 'failed'] }") &&
    instanceDestroySource.includes('EXCHANGE_INSTANCE_LOCKED') &&
    instanceDestroySource.includes('EXCHANGE_ORDER_ACTIVE'),
  'instance destroy routes must block paused/listed/failed-delivery exchange listings and unsettled exchange-ordered instances'
)

assert(
  exchangeOperationLockSource.includes("const listingLockedStatuses = ['active', 'paused', 'locked', 'delivery_failed']") &&
    exchangeOperationLockSource.includes("const orderLockedStatuses = ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review', 'failed']") &&
    exchangeServiceSource.includes("const listingBlockingStatuses: ExchangeListingStatus[] = ['active', 'paused', 'locked', 'delivery_failed']") &&
    exchangeServiceSource.includes('status: { in: listingBlockingStatuses }') &&
    exchangeServiceSource.includes("const orderBlockingStatuses: ExchangeOrderStatus[] = ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review', 'failed']"),
  'exchange operation lock, listing-state display, and listing eligibility must cover active, paused, failed, and unsettled exchange states'
)

assert(
  instanceRouteSource.includes('getExchangeOperationLock') &&
    snapshotRouteSource.includes('getExchangeOperationLock') &&
    proxySiteRouteSource.includes('getExchangeOperationLock') &&
    trafficRouteSource.includes('getExchangeOperationLock') &&
    backupRouteSource.includes('getExchangeOperationLock') &&
    instanceBillingRouteSource.includes('getExchangeOperationLock') &&
    batchConfigRouteSource.includes('getExchangeOperationLock') &&
    billingOperationsSource.includes('getExchangeOperationLock') &&
    billingSchedulerSource.includes('getExchangeOperationLock') &&
    autoPolicySchedulerSource.includes('getExchangeOperationLock') &&
    publicApiRouteSource.includes('getExchangeOperationLock') &&
    transferRouteSource.includes('getExchangeOperationLock') &&
    hostRouteSource.includes('getExchangeOperationLock') &&
    adminBillingRouteSource.includes('getExchangeOperationLock'),
  'instance, host ops, transfer, admin billing, billing, batch config, public API, schedulers, backup, snapshot, proxy site, and traffic reset paths must use exchange operation locks'
)

assert(
  exchangeOperationLockSource.includes('export async function getExchangeSensitiveAccessLock') &&
    exchangeOperationLockSource.includes("const buyerDeliveredAccessStatuses = ['delivered', 'confirming', 'disputed'] as const") &&
    exchangeOperationLockSource.includes('viewer.role ===') &&
    exchangeOperationLockSource.includes('viewerIsDeliveredBuyer') &&
    exchangeOperationLockSource.includes('不能查看密码或连接终端') &&
    instanceRouteSource.includes('getExchangeSensitiveAccessLock') &&
    instanceRouteSource.includes("fastify.get<{ Params: { id: string } }>('/:id/password'") &&
    instanceRouteSource.includes("code: exchangeLock.code || 'EXCHANGE_INSTANCE_LOCKED'") &&
    terminalRouteSource.includes('getExchangeSensitiveAccessLock') &&
    terminalRouteSource.includes("generateTerminalAccessTicket") &&
    countOccurrences(terminalRouteSource, 'const exchangeLock = await getExchangeSensitiveAccessLock(') >= 2 &&
    terminalRouteSource.includes("socket.close(4003, 'Exchange locked')"),
  'exchange sensitive access lock must block password and terminal access while listed or pre-delivery, while allowing the delivered buyer to use the rebuilt instance'
)

assert(
  exchangeRouteSource.includes("import { getExchangeOperationLock } from '../services/exchange-operation-lock.js'") &&
    exchangeRouteSource.includes("'/instances/:instanceId/stop-for-listing'") &&
    exchangeRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instanceId)') &&
    exchangeRouteSource.includes('实例已上架交易所或处于交易锁定中，不能提交暂停后挂牌任务') &&
    exchangeRouteSource.includes("code: exchangeLock.code || 'EXCHANGE_INSTANCE_LOCKED'"),
  'exchange stop-for-listing route must explicitly reject already listed or ordered instances before queuing a stop task'
)

assert(
  transferRouteSource.includes('async function checkExchangeLock') &&
    transferRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instanceId)') &&
    transferRouteSource.includes('不能发起普通转移') &&
    transferRouteSource.includes('if (await checkExchangeLock(instanceId, reply)) return') &&
    countOccurrences(transferRouteSource, 'if (await checkExchangeLock(transfer.instanceId, reply))') >= 2 &&
    countOccurrences(transferRouteSource, 'await rollbackToPending()') >= 4,
  'normal instance transfer creation, acceptance, and push delivery must reject exchange-listed or exchange-ordered instances'
)

assert(
  adminBillingRouteSource.includes("'/api/admin/instances/:id/delete-and-refund'") &&
    adminBillingRouteSource.includes('EXCHANGE_ADMIN_DELETE_LOCK_REASON') &&
    adminBillingRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instanceId)') &&
    adminBillingRouteSource.includes('reply.status(409).send') &&
    adminBillingRouteSource.includes('请先在交易所管理中处理订单、退款或下架'),
  'admin delete-and-refund must reject exchange-listed or exchange-ordered instances and require exchange management flow first'
)

assert(
  adminBillingRouteSource.includes('EXCHANGE_ADMIN_BILLING_LOCK_REASON') &&
    adminBillingRouteSource.includes('async function rejectAdminBillingExchangeLock') &&
    countOccurrences(adminBillingRouteSource, 'await rejectAdminBillingExchangeLock(reply, instanceId)') >= 7 &&
    adminBillingRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instance.id)') &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/suspend'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/unsuspend'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/extend'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/apply-aff'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/update-price'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/update-price/preview'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/batch-update-price/preview'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/batch-update-price'") &&
    adminBillingRouteSource.includes("'/api/admin/instances/:id/upgrade-plan'"),
  'admin billing suspend, unsuspend, extend, AFF, price update, batch price update, and plan upgrade paths must reject exchange-listed or exchange-ordered instances'
)

assert(
  hostRouteSource.includes('async function rejectHostExchangeLock') &&
    hostRouteSource.includes('不能执行宿主机运维操作') &&
    hostRouteSource.includes('不能批量删除') &&
    hostRouteSource.includes("}>('/:id/instances/migrate'") &&
    hostRouteSource.includes('不能迁移节点') &&
    hostRouteSource.includes("}>('/:id/ops/instances/:instanceId/restart'") &&
    hostRouteSource.includes("}>('/:id/ops/instances/:instanceId/dangerous-action'") &&
    countOccurrences(hostRouteSource, 'await rejectHostExchangeLock(reply, instanceId)') >= 2 &&
    hostRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instance.id)'),
  'host batch delete, batch migrate, restart, rebuild, and recreate operations must reject exchange-listed or exchange-ordered instances'
)

assert(
  countOccurrences(backupRouteSource, 'await checkTransferLock(instanceIdNum, reply)') >= 9,
  'backup create/delete/policy/export/download/restore/upload operations must be blocked while an instance is exchange-listed or exchange-ordered'
)

assert(
  snapshotRouteSource.includes('交易所挂牌/交割期间禁止修改自动快照策略') &&
    countOccurrences(snapshotRouteSource, 'await checkTransferLock(instanceIdNum, reply)') >= 4,
  'snapshot create/delete/restore and auto snapshot policy changes must be blocked while an instance is exchange-listed or exchange-ordered'
)

assert(
  autoPolicySchedulerSource.includes("import { getExchangeOperationLock } from './exchange-operation-lock.js'") &&
    autoPolicySchedulerSource.includes('const exchangeLock = await getExchangeOperationLock(candidate.instanceId)') &&
    autoPolicySchedulerSource.includes('if (exchangeLock.locked)') &&
    autoPolicySchedulerSource.includes('exchange locked') &&
    autoPolicySchedulerSource.indexOf('const exchangeLock = await getExchangeOperationLock(candidate.instanceId)') <
      autoPolicySchedulerSource.indexOf('await executeAutoSnapshot({'),
  'auto snapshot scheduler must skip exchange-listed or exchange-ordered instances before creating or rotating snapshots'
)

assert(
  instanceBillingRouteSource.includes('checkExchangeBillingLock') &&
    instanceBillingRouteSource.includes('/:id/renew') &&
    instanceBillingRouteSource.includes('/batch/renew') &&
    instanceBillingRouteSource.includes('/:id/change-plan') &&
    instanceBillingRouteSource.includes('/:id/auto-renew') &&
    instanceBillingRouteSource.includes('/batch/auto-renew'),
  'user billing routes must block renew, plan change, and auto-renew mutations while an instance is exchange-listed or exchange-ordered'
)

assert(
  billingOperationsSource.includes('assertInstanceNotExchangeLocked') &&
    billingOperationsSource.includes('await assertInstanceNotExchangeLocked(instance.id)') &&
    billingOperationsSource.includes('await assertInstanceNotExchangeLocked(instanceId)'),
  'billing core operations must reject renewal, plan change, and auto-renew updates for exchange-locked instances'
)

assert(
  countOccurrences(proxySiteRouteSource, 'await checkExchangeLock(instanceId, reply)') >= 6,
  'proxy site create/delete/check/refresh/update/toggle operations must be blocked while an instance is exchange-listed or exchange-ordered'
)

assert(
  trafficRouteSource.includes('/instances/:instanceId/traffic/reset') &&
    trafficRouteSource.includes('code: exchangeLock.code') &&
    trafficRouteSource.includes('exchangeLock.locked'),
  'traffic reset route must reject exchange-listed or exchange-ordered instances'
)

assert(
  instanceRouteSource.includes('交易所挂牌/交割期间禁止调整实例配额') &&
    instanceRouteSource.includes('交易所挂牌/交割期间禁止迁移节点') &&
    instanceRouteSource.includes('/:id/change-host-options') &&
    instanceRouteSource.includes('/:id/change-host') &&
    instanceRouteSource.includes('交易所挂牌/交割期间只允许通过交易所入口改价、改说明、下架或查看交易状态') &&
    instanceRouteSource.includes('交易所挂牌/交割期间禁止修改实例运行配置') &&
    instanceRouteSource.includes('交易所挂牌/交割期间禁止修改实例交付状态标记') &&
    countOccurrences(instanceRouteSource, 'await checkTransferLock(instanceId, reply)') >= 20,
  'instance change-host, quota/config/port/start/stop/restart/reinstall/delete/boost/rename/swap/cloud-init operations must be blocked while an instance is exchange-listed or exchange-ordered'
)

assert(
  batchConfigRouteSource.includes('const exchangeLock = await getExchangeOperationLock(instance.id)') &&
    batchConfigRouteSource.includes('实例已上架交易所或处于交易锁定中，不能批量修改配置'),
  'host batch config must reject exchange-listed or exchange-ordered instances before changing resources, network limits, swap, or autostart settings'
)

assert(
	  exchangeServiceSource.includes('packageAllowlist') &&
	    exchangeServiceSource.includes('hostAllowlist') &&
	    exchangeServiceSource.includes('maxMarkupPercent') &&
	    exchangeServiceSource.includes('policy.expiringSoonDays * 24 * 60 * 60 * 1000') &&
	    exchangeServiceSource.includes('未进入即将到期阈值') &&
	    exchangeServiceSource.includes('实例将在 ${policy.expiringSoonDays} 天内到期，不能挂牌') &&
	    exchangeServiceSource.includes('EXCHANGE_PURCHASE_DAILY_LIMIT') &&
    exchangeServiceSource.includes('EXCHANGE_ACCOUNT_NOT_ACTIVE') &&
	    exchangeServiceSource.includes('allowBalanceTransfer') &&
	    exchangeServiceSource.includes("type: 'exchange_transfer'") &&
	    exchangeServiceSource.includes("type: 'balance_transfer'") &&
	    exchangeServiceSource.includes("action: 'wallet.balance_transfer'") &&
	    exchangeServiceSource.includes("targetType: 'exchange_wallet_log'") &&
	    exchangeServiceSource.includes('balanceLogId: balanceLog.id') &&
	    exchangeServiceSource.includes('dailyWithdrawalCountLimit') &&
	    exchangeServiceSource.includes('EXCHANGE_HAS_OPEN_DISPUTE') &&
	    countOccurrences(exchangeServiceSource, 'status: { in: activeDisputeStatuses }') >= 4 &&
	    exchangeServiceSource.includes('assertExchangeBuyerRiskClear') &&
	    exchangeServiceSource.includes('EXCHANGE_BALANCE_SOURCE_RISK') &&
	    exchangeServiceSource.includes('EXCHANGE_BUYER_DISPUTE_RISK') &&
	    exchangeServiceSource.includes('EXCHANGE_BUYER_CANCEL_RISK') &&
		exchangeServiceSource.includes('EXCHANGE_WITHDRAWAL_HAS_UNSETTLED_SALE') &&
		exchangeServiceSource.includes('存在未结算交易或确认期未结束，不能提现') &&
		exchangeServiceSource.includes('EXCHANGE_WITHDRAWAL_METHOD_REQUIRED') &&
			exchangeServiceSource.includes('EXCHANGE_WITHDRAWAL_ACCOUNT_REQUIRED'),
		  'exchange service must enforce policy allowlists, markup limit, account status, purchase limits, transfer restrictions, withdrawal limits, dispute restrictions, pending-sale withdrawal restrictions, withdrawal profile validation, and buyer/funds risk gates'
		)

assert(
  adminExchangeViewSource.includes("const activeDisputeStatuses = ['open', 'processing', 'redelivering']") &&
    countOccurrences(adminExchangeViewSource, 'activeDisputeStatuses.includes(item.status)') >= 3,
  'admin exchange dispute action buttons must treat redelivering disputes as active and still actionable'
)

assert(
  adminExchangeViewSource.includes("item.status === 'pending'") &&
    adminExchangeViewSource.includes("['approved', 'paying'].includes(item.status)") &&
    adminExchangeViewSource.includes("['pending', 'approved'].includes(item.status)") &&
    adminExchangeViewSource.includes("!['pending', 'approved', 'paying'].includes(item.status)") &&
    adminExchangeViewSource.includes("proofUrlLabel: '打款凭证 URL 或流水号'") &&
    adminExchangeViewSource.includes('requiresProofUrl: true') &&
    adminExchangeViewSource.includes('请输入${dialog.proofUrlLabel}'),
  'admin exchange withdrawal actions must be status-driven and require payment proof before marking withdrawals completed'
)

assert(
  countOccurrences(schema, 'idempotencyKey') >= 5 &&
    migration.includes('exchange_orders_idempotency_key_key') &&
    migration.includes('exchange_withdrawals_idempotency_key_key') &&
    migration.includes('exchange_wallet_logs_idempotency_key_key') &&
    exchangeServiceSource.includes('normalizeIdempotencyKey') &&
    exchangeServiceSource.includes('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT') &&
    exchangeServiceSource.includes('where: { idempotencyKey }') &&
    userExchangeViewSource.includes('createIdempotencyKey') &&
    userExchangeViewSource.includes('idempotencyKey: createIdempotencyKey') &&
    userExchangeViewSource.includes('retry: () => performPurchase(listing, idempotencyKey)') &&
    userExchangeViewSource.includes('retry: () => performTransferToBalance(amount, idempotencyKey)'),
  'exchange write APIs must persist and reuse idempotency keys across listing, purchase, transfer, withdrawal, and dispute flows'
)

assert(
	  adminExchangeRouteSource.includes('const nextPolicy = {') &&
	    adminExchangeRouteSource.includes('enabled: Boolean(body.enabled),\n        forceStoppedRequired: true,') &&
	    adminExchangeRouteSource.includes('function normalizeIdList') &&
	    adminExchangeRouteSource.includes("packageAllowlist: normalizeIdList(body.packageAllowlist, '允许交易套餐')") &&
	    adminExchangeRouteSource.includes("hostAllowlist: normalizeIdList(body.hostAllowlist, '允许交易节点')") &&
	    schema.includes('autoConfirmEnabled') &&
    migration.includes('"auto_confirm_enabled" BOOLEAN NOT NULL DEFAULT true') &&
    adminExchangeRouteSource.includes('最高售价不能低于最低售价') &&
    adminExchangeRouteSource.includes('最高手续费不能低于最低手续费') &&
    adminExchangeRouteSource.includes('即将到期阈值不能小于最低剩余有效期') &&
    adminExchangeRouteSource.includes('data: nextPolicy') &&
    adminExchangeRouteSource.includes('autoConfirmEnabled: body.autoConfirmEnabled !== false') &&
    exchangeDeliveryWorkerSource.includes('!policy.autoConfirmEnabled') &&
    adminExchangeViewSource.includes('强制暂停状态上架：固定开启，不可关闭') &&
    adminExchangeViewSource.includes('自动确认规则：可配置') &&
    adminExchangeViewSource.includes('forceStoppedRequired: true') &&
    adminExchangeViewSource.includes('policy.autoConfirmEnabled'),
  'admin exchange config must keep force-stopped listing fixed, validate cross-field policy ranges, and expose real configurable auto-confirm rules'
)

console.log('exchange marketplace guards passed')
