import { customAlphabet } from 'nanoid'
import {
  Prisma,
  type ExchangeDisputeStatus,
  type ExchangeListingStatus,
  type ExchangeOrderStatus
} from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { EXCHANGE_ORDER_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { getPackageHostStoragePool, isSystemDiskPoolForClient } from '../db/storage-pools.js'
import { getSystemImageAvailabilityForHost } from '../db/images.js'
import { hasPendingTransfer } from '../db/transfers.js'

const exchangeOrderNo = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 18)
const exchangeWithdrawalNo = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 18)
const maxMoney = 99999999.99
const maxDescriptionLength = 500
const listingVisibleStatuses: ExchangeListingStatus[] = ['active']
const listingBlockingStatuses: ExchangeListingStatus[] = ['active', 'paused', 'locked', 'delivery_failed']
const orderBlockingStatuses: ExchangeOrderStatus[] = ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review', 'failed']
const activeDisputeStatuses: ExchangeDisputeStatus[] = ['open', 'processing', 'redelivering']
const exchangeRiskWindowDays = 7
const maxRecentBuyerCancellations = 3
const maxRecentDisputes = 3
const exchangeDeliveryProgressSteps = [
  'escrow_paid',
  'lock_instance',
  'freeze_seller_access',
  'cleanup_ssh_keys',
  'cleanup_terminal_sessions',
  'cleanup_console_tokens',
  'cleanup_network_bindings',
  'cleanup_snapshots_and_backups',
  'reinstall',
  'transfer_owner',
  'rebuild_billing',
  'preserve_traffic_usage',
  'complete'
] as const

export class ExchangeError extends Error {
  code: string
  httpStatus: number
  detail?: unknown

  constructor(code: string, message: string, httpStatus = 400, detail?: unknown) {
    super(message)
    this.name = 'ExchangeError'
    this.code = code
    this.httpStatus = httpStatus
    this.detail = detail
  }
}

export interface ExchangeEligibilityResult {
  eligible: boolean
  status: 'can_list' | 'must_stop_first' | 'cannot_list'
  reasons: string[]
  checks: Array<{ key: string; label: string; passed: boolean; message: string }>
  instance?: ReturnType<typeof serializeInstanceSnapshot>
}

interface ListingInput {
  userId: number
  instanceId: number
  price: number
  description?: string | null
  autoDelistAt?: Date | null
  idempotencyKey?: string | null
}

interface PurchaseInput {
  userId: number
  listingId: number
  idempotencyKey?: string | null
  imageAlias?: string | null
  sshKeyId?: number | null
}

interface TransferInput {
  userId: number
  amount: number
  idempotencyKey?: string | null
}

interface WithdrawalInput {
  userId: number
  amount: number
  method?: string | null
  accountSnapshot?: Record<string, unknown>
  applicantRemark?: string | null
  idempotencyKey?: string | null
}

function normalizeMoney(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new ExchangeError('EXCHANGE_INVALID_AMOUNT', `${field}必须是有效金额`)
  }
  const normalized = Number(value.toFixed(2))
  if (normalized <= 0 || normalized > maxMoney) {
    throw new ExchangeError('EXCHANGE_INVALID_AMOUNT', `${field}必须大于 0 且不能超出系统限制`)
  }
  if (!/^\d+(\.\d{1,2})?$/.test(String(normalized))) {
    throw new ExchangeError('EXCHANGE_INVALID_AMOUNT', `${field}最多保留两位小数`)
  }
  return normalized
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key) return null
  if (key.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    throw new ExchangeError('EXCHANGE_INVALID_IDEMPOTENCY_KEY', '幂等键格式无效')
  }
  return key
}

function normalizeOptionalImageAlias(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new ExchangeError('EXCHANGE_INVALID_IMAGE_ALIAS', '重装镜像参数无效')
  }
  const imageAlias = value.trim()
  if (!imageAlias) return null
  if (imageAlias.length > 200 || !/^[A-Za-z0-9:_./+-]+$/.test(imageAlias)) {
    throw new ExchangeError('EXCHANGE_INVALID_IMAGE_ALIAS', '重装镜像别名格式无效')
  }
  return imageAlias
}

function normalizeOptionalPositiveId(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ExchangeError('EXCHANGE_INVALID_ID', `${field}无效`)
  }
  return value
}

function imageAvailabilityMessage(reason: string): string {
  const messages: Record<string, string> = {
    host_not_found: '交割节点不存在，不能使用该镜像',
    image_not_found: '重装镜像不存在或已隐藏',
    architecture_mismatch: '重装镜像架构与节点不匹配',
    host_instance_type_mismatch: '重装镜像类型与节点实例类型不匹配',
    instance_type_mismatch: '重装镜像类型与实例套餐不匹配',
    memory_incompatible: '重装镜像与实例内存配置不兼容',
    not_allowed: '该节点不允许使用所选重装镜像'
  }
  return messages[reason] || '所选重装镜像当前不可用'
}

function assertAnonymousText(value: string | null, code: string, message: string): void {
  if (!value) return
  const contactPatterns = [
    /https?:\/\//i,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /\b(?:t\.me|telegram|wechat|weixin|qq)\b/i,
    /(?:微信|邮箱|电报|飞机|联系我|联系方式|手机号|手机|QQ)/i,
    /(?:\+?\d[\d\s-]{6,}\d)/
  ]
  if (contactPatterns.some(pattern => pattern.test(value))) {
    throw new ExchangeError(code, message)
  }
}

function assertAnonymousListingDescription(description: string | null): void {
  assertAnonymousText(description, 'EXCHANGE_DESCRIPTION_CONTACT_FORBIDDEN', '挂牌说明不能包含联系方式、外链或可识别交易双方身份的信息')
}

function assertAnonymousDisputeText(reason: string, detail: string | null): void {
  assertAnonymousText(reason, 'EXCHANGE_DISPUTE_CONTACT_FORBIDDEN', '争议内容不能包含联系方式、外链或可识别交易双方身份的信息')
  assertAnonymousText(detail, 'EXCHANGE_DISPUTE_CONTACT_FORBIDDEN', '争议内容不能包含联系方式、外链或可识别交易双方身份的信息')
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function toDateIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toBigintString(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value.toString()
}

function toInputJson(value: Prisma.JsonValue | Record<string, unknown> | undefined | null): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {}
  return value as Prisma.InputJsonValue
}

function jsonNumberList(value: Prisma.JsonValue | null | undefined): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => Number(item))
    .filter(item => Number.isSafeInteger(item) && item > 0)
}

function isDedicatedIpNetworkMode(networkMode: string | null | undefined): boolean {
  return ['public_ipv4', 'public_ipv4_ipv6', 'nat_ipv6', 'ipv6_only'].includes(networkMode || '')
}

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function visibleListingWhere(now = new Date()): Prisma.ExchangeListingWhereInput {
  return {
    status: { in: listingVisibleStatuses },
    OR: [
      { autoDelistAt: null },
      { autoDelistAt: { gt: now } }
    ]
  }
}

function visibleListingPackageWhere(packageId?: number | null): Prisma.ExchangeListingWhereInput {
  const where = visibleListingWhere()
  if (!packageId) return where
  return {
    ...where,
    snapshot: {
      path: ['package', 'id'],
      equals: packageId
    }
  }
}

function getSnapshotPackageCategory(snapshot: Prisma.JsonValue): { id: number; name: string } | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const packageValue = (snapshot as Prisma.JsonObject).package
  if (!packageValue || typeof packageValue !== 'object' || Array.isArray(packageValue)) return null
  const packageRecord = packageValue as Prisma.JsonObject
  const id = Number(packageRecord.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const name = typeof packageRecord.name === 'string' && packageRecord.name.trim()
    ? packageRecord.name.trim()
    : `套餐 #${id}`
  return { id, name }
}

function buildMarketPackageCategories(rows: Array<{ snapshot: Prisma.JsonValue }>) {
  const categories = new Map<number, { id: number; name: string; count: number }>()
  for (const row of rows) {
    const category = getSnapshotPackageCategory(row.snapshot)
    if (!category) continue
    const existing = categories.get(category.id)
    if (existing) {
      existing.count += 1
      if (existing.name.startsWith('套餐 #') && !category.name.startsWith('套餐 #')) {
        existing.name = category.name
      }
    } else {
      categories.set(category.id, { ...category, count: 1 })
    }
  }
  return Array.from(categories.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

function normalizeFutureAutoDelistAt(value: Date | null | undefined): Date | null {
  if (!value) return null
  if (value.getTime() <= Date.now()) {
    throw new ExchangeError('EXCHANGE_AUTO_DELIST_AT_EXPIRED', '自动下架时间必须晚于当前时间')
  }
  return value
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function assertPolicyAllowlist(
  policy: Awaited<ReturnType<typeof getPolicy>>,
  instance: {
    packageId: number | null
    hostId: number
    networkMode?: string | null
  }
) {
  const packageAllowlist = jsonNumberList(policy.packageAllowlist)
  if (packageAllowlist.length > 0 && (!instance.packageId || !packageAllowlist.includes(instance.packageId))) {
    throw new ExchangeError('EXCHANGE_PACKAGE_NOT_ALLOWED', '当前套餐不允许进入交易所')
  }
  const hostAllowlist = jsonNumberList(policy.hostAllowlist)
  if (hostAllowlist.length > 0 && !hostAllowlist.includes(instance.hostId)) {
    throw new ExchangeError('EXCHANGE_HOST_NOT_ALLOWED', '当前节点不允许进入交易所')
  }
  if (!policy.allowPublicIpTransfer && isDedicatedIpNetworkMode(instance.networkMode)) {
    throw new ExchangeError('EXCHANGE_PUBLIC_IP_TRANSFER_DISABLED', '当前交易所配置不允许独立 IP 跟随转让，该网络类型不能挂牌')
  }
}

function assertMaxMarkup(
  price: number,
  policy: Awaited<ReturnType<typeof getPolicy>>,
  instance: { billingPrice: Prisma.Decimal | null }
) {
  const basePrice = toNumber(instance.billingPrice)
  if (!basePrice || !policy.maxMarkupPercent) return
  const maxAllowed = Number((basePrice * policy.maxMarkupPercent / 100).toFixed(2))
  if (price > maxAllowed) {
    throw new ExchangeError('EXCHANGE_PRICE_MARKUP_TOO_HIGH', `出售价格不能超过当前续费价格的 ${policy.maxMarkupPercent}%`)
  }
}

function isInstanceTrafficWithinLimit(instance: {
  monthlyTrafficLimit: bigint | null
  monthlyTrafficUsed: bigint
  trafficStatus: string
}): boolean {
  if (instance.trafficStatus === 'LIMITED') return false
  return instance.monthlyTrafficLimit === null || instance.monthlyTrafficUsed < instance.monthlyTrafficLimit
}

function instanceTrafficLimitMessage(instance: {
  monthlyTrafficLimit: bigint | null
  monthlyTrafficUsed: bigint
  trafficStatus: string
}): string {
  if (instance.trafficStatus === 'LIMITED') return '实例已触发流量限速，不能挂牌'
  if (instance.monthlyTrafficLimit !== null && instance.monthlyTrafficUsed >= instance.monthlyTrafficLimit) {
    return '实例月流量已超限，不能挂牌'
  }
  return '实例流量未超限'
}

function isAccountTrafficWithinLimit(quota: {
  monthlyTrafficLimit: bigint | null
  monthlyTrafficUsed: bigint
  trafficStatus: string
} | null): boolean {
  if (!quota) return true
  if (quota.trafficStatus === 'LIMITED') return false
  return quota.monthlyTrafficLimit === null || quota.monthlyTrafficUsed < quota.monthlyTrafficLimit
}

function accountTrafficLimitMessage(quota: {
  monthlyTrafficLimit: bigint | null
  monthlyTrafficUsed: bigint
  trafficStatus: string
} | null): string {
  if (!quota) return '账号总流量未超限'
  if (quota.trafficStatus === 'LIMITED') return '账号已触发总流量限速，不能挂牌'
  if (quota.monthlyTrafficLimit !== null && quota.monthlyTrafficUsed >= quota.monthlyTrafficLimit) {
    return '账号月总流量已超限，不能挂牌'
  }
  return '账号总流量未超限'
}

function addCheck(
  checks: ExchangeEligibilityResult['checks'],
  key: string,
  label: string,
  passed: boolean,
  message: string,
  reasons: string[]
) {
  checks.push({ key, label, passed, message })
  if (!passed) reasons.push(message)
}

async function validateListingStoragePools(
  client: Prisma.TransactionClient | typeof prisma,
  instance: {
    hostId: number
    packageId: number | null
    storagePoolName: string | null
  }
): Promise<{
  instancePoolOk: boolean
  packagePoolOk: boolean
  instancePoolName: string | null
  packagePoolName: string | null
}> {
  const instancePoolName = instance.storagePoolName?.trim() || null
  const packagePoolName = instance.packageId
    ? await getPackageHostStoragePool(instance.packageId, instance.hostId, client)
    : null
  const fallbackSystemPool = await client.storagePool.findFirst({
    where: {
      hostId: instance.hostId,
      purpose: 'instance_data'
    },
    select: { name: true }
  })

  const instancePoolOk = instancePoolName
    ? await isSystemDiskPoolForClient(instance.hostId, instancePoolName, client)
    : !!fallbackSystemPool
  const packagePoolOk = !instance.packageId
    ? true
    : packagePoolName
      ? await isSystemDiskPoolForClient(instance.hostId, packagePoolName, client)
      : !!fallbackSystemPool

  return {
    instancePoolOk,
    packagePoolOk,
    instancePoolName,
    packagePoolName
  }
}

async function assertNoUnhandledFinancialRisk(
  client: Prisma.TransactionClient | typeof prisma,
  userId: number,
  actionLabel: string
) {
  const item = await client.financialReconciliationItem.findFirst({
    where: {
      userId,
      status: 'discrepancy',
      handledAt: null
    },
    select: { id: true, itemType: true, title: true }
  })
  if (item) {
    throw new ExchangeError(
      'EXCHANGE_BALANCE_SOURCE_RISK',
      `账号存在未处理资金对账异常，不能${actionLabel}`,
      403,
      { reconciliationItemId: item.id, itemType: item.itemType, title: item.title }
    )
  }
}

async function assertExchangeFundsRiskClear(
  client: Prisma.TransactionClient | typeof prisma,
  userId: number,
  actionLabel: string
) {
  await assertNoUnhandledFinancialRisk(client, userId, actionLabel)
}

async function assertExchangeBuyerRiskClear(
  client: Prisma.TransactionClient | typeof prisma,
  userId: number
) {
  await assertNoUnhandledFinancialRisk(client, userId, '购买交易所实例')
  const since = daysAgo(exchangeRiskWindowDays)
  const [openDispute, recentDisputes, recentCancellations] = await Promise.all([
    client.exchangeDispute.findFirst({
      where: {
        status: { in: activeDisputeStatuses },
        order: {
          OR: [
            { buyerUserId: userId },
            { sellerUserId: userId }
          ]
        }
      },
      select: { id: true }
    }),
    client.exchangeDispute.count({
      where: {
        creatorUserId: userId,
        createdAt: { gte: since }
      }
    }),
    client.exchangeOrder.count({
      where: {
        buyerUserId: userId,
        status: { in: ['cancelled', 'refunded'] },
        updatedAt: { gte: since }
      }
    })
  ])
  if (openDispute) {
    throw new ExchangeError('EXCHANGE_HAS_OPEN_DISPUTE', '存在未完结争议，不能购买交易所实例', 403)
  }
  if (recentDisputes >= maxRecentDisputes) {
    throw new ExchangeError('EXCHANGE_BUYER_DISPUTE_RISK', '近期交易所争议次数过多，不能购买交易所实例', 403)
  }
  if (recentCancellations >= maxRecentBuyerCancellations) {
    throw new ExchangeError('EXCHANGE_BUYER_CANCEL_RISK', '近期交易所取消或退款次数过多，不能购买交易所实例', 403)
  }
}

async function getPolicy(tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const policy = await tx.exchangePolicyConfig.findFirst({
    orderBy: { id: 'asc' }
  })
  if (policy) return policy
  return tx.exchangePolicyConfig.create({ data: { enabled: false } })
}

export async function getPublicExchangePolicy() {
  const policy = await getPolicy()
  return {
    enabled: policy.enabled,
    minRemainingDays: policy.minRemainingDays,
    expiringSoonDays: policy.expiringSoonDays,
    minPrice: toNumber(policy.minPrice),
    maxPrice: policy.maxPrice === null ? null : toNumber(policy.maxPrice),
    maxMarkupPercent: policy.maxMarkupPercent,
    feePercent: toNumber(policy.feePercent),
    minFee: toNumber(policy.minFee),
    maxFee: policy.maxFee === null ? null : toNumber(policy.maxFee),
    confirmationHours: policy.confirmationHours,
    autoConfirmEnabled: policy.autoConfirmEnabled,
    allowBuyerImageSelection: policy.allowBuyerImageSelection,
    allowBalanceTransfer: policy.allowBalanceTransfer,
    allowPublicIpTransfer: policy.allowPublicIpTransfer,
    withdrawalMinAmount: toNumber(policy.minWithdrawalAmount),
    dailyWithdrawalLimit: policy.dailyWithdrawalLimit === null ? null : toNumber(policy.dailyWithdrawalLimit),
    dailyWithdrawalCountLimit: policy.dailyWithdrawalCountLimit,
    maxActiveListingsPerUser: policy.maxActiveListingsPerUser,
    maxPurchasesPerUserPerDay: policy.maxPurchasesPerUserPerDay,
    disputeTimeoutHours: policy.disputeTimeoutHours
  }
}

function calculateFee(price: number, policy: Awaited<ReturnType<typeof getPolicy>>): {
  feeAmount: number
  sellerReceivesAmount: number
} {
  const feeByPercent = Number((price * toNumber(policy.feePercent) / 100).toFixed(2))
  let feeAmount = Math.max(feeByPercent, toNumber(policy.minFee))
  if (policy.maxFee !== null) {
    feeAmount = Math.min(feeAmount, toNumber(policy.maxFee))
  }
  feeAmount = Number(feeAmount.toFixed(2))
  return {
    feeAmount,
    sellerReceivesAmount: Number((price - feeAmount).toFixed(2))
  }
}

async function createDisputeWalletLog(
  tx: Prisma.TransactionClient,
  order: Pick<Prisma.ExchangeOrderGetPayload<{}>, 'id' | 'orderNo' | 'sellerUserId' | 'sellerReceivesAmount'>,
  type: 'dispute_freeze' | 'dispute_release',
  remark: string
) {
  const wallet = await tx.exchangeWallet.upsert({
    where: { userId: order.sellerUserId },
    update: {},
    create: { userId: order.sellerUserId }
  })
  return tx.exchangeWalletLog.create({
    data: {
      walletId: wallet.id,
      userId: order.sellerUserId,
      type,
      amount: toNumber(order.sellerReceivesAmount),
      availableBefore: wallet.availableAmount,
      availableAfter: wallet.availableAmount,
      frozenBefore: wallet.frozenAmount,
      frozenAfter: wallet.frozenAmount,
      orderId: order.id,
      remark
    }
  })
}

export async function recordExchangeDisputeWalletRelease(orderId: number, remark: string) {
  return prisma.$transaction(async tx => {
    return recordExchangeDisputeWalletReleaseInTransaction(tx, orderId, remark)
  })
}

export async function recordExchangeDisputeWalletReleaseInTransaction(
  tx: Prisma.TransactionClient,
  orderId: number,
  remark: string
) {
  const order = await tx.exchangeOrder.findUnique({ where: { id: orderId } })
  if (!order) {
    throw new ExchangeError('EXCHANGE_ORDER_NOT_FOUND', '交易订单不存在', 404)
  }
  return createDisputeWalletLog(tx, order, 'dispute_release', remark)
}

function serializeInstanceSnapshot(instance: {
  id: number
  name: string
  status: string
  cpu: number
  memory: number
  disk: number
  networkMode: string
  portLimit: number | null
  snapshotLimit: number | null
  backupLimit: number | null
  siteLimit: number | null
  limitsIngress: string | null
  limitsEgress: string | null
  monthlyTrafficLimit: bigint | null
  monthlyTrafficUsed: bigint
  expiresAt: Date | null
  billingPrice: Prisma.Decimal | null
  billingCycle: number | null
  ipv4: string | null
  ipv6: string | null
  package: { id: number; name: string; active: boolean } | null
  packagePlan: { id: number; name: string; isActive: boolean; isSoldOut: boolean } | null
  host: { id: number; name: string; location: string | null; countryCode: string | null; status: string }
}) {
  return {
    instanceId: instance.id,
    name: instance.name,
    status: instance.status,
    cpu: instance.cpu,
    memory: instance.memory,
    disk: instance.disk,
    networkMode: instance.networkMode,
    portLimit: instance.portLimit,
    snapshotLimit: instance.snapshotLimit,
    backupLimit: instance.backupLimit,
    siteLimit: instance.siteLimit,
    limitsIngress: instance.limitsIngress,
    limitsEgress: instance.limitsEgress,
    monthlyTrafficLimit: toBigintString(instance.monthlyTrafficLimit),
    monthlyTrafficUsed: toBigintString(instance.monthlyTrafficUsed),
    expiresAt: toDateIso(instance.expiresAt),
    billingPrice: instance.billingPrice === null ? null : toNumber(instance.billingPrice),
    billingCycle: instance.billingCycle,
    ipv4: instance.ipv4 ? maskIp(instance.ipv4) : null,
    ipv6: instance.ipv6 ? maskIp(instance.ipv6) : null,
    package: instance.package ? { id: instance.package.id, name: instance.package.name } : null,
    packagePlan: instance.packagePlan ? { id: instance.packagePlan.id, name: instance.packagePlan.name } : null,
    host: {
      id: instance.host.id,
      name: instance.host.name,
      location: instance.host.location,
      countryCode: instance.host.countryCode
    },
    deliveryMode: 'reinstall_required',
    privacyMode: 'anonymous'
  }
}

const publicSnapshotRootForbiddenFields = new Set([
  'instanceId',
  'name'
])

const publicSnapshotForbiddenFields = new Set([
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
])

function sanitizePublicInstanceSnapshot(value: Prisma.JsonValue, isRoot = true): Prisma.JsonValue {
  if (Array.isArray(value)) {
    return value.map(item => sanitizePublicInstanceSnapshot(item, false))
  }
  if (!value || typeof value !== 'object') return value
  const snapshot: Prisma.JsonObject = {}
  for (const [key, item] of Object.entries(value as Prisma.JsonObject)) {
    if (isRoot && publicSnapshotRootForbiddenFields.has(key)) continue
    if (publicSnapshotForbiddenFields.has(key)) continue
    snapshot[key] = sanitizePublicInstanceSnapshot(item as Prisma.JsonValue, false)
  }
  return snapshot
}

function maskIp(value: string): string {
  if (value.includes(':')) {
    const parts = value.split(':')
    return `${parts.slice(0, 2).join(':')}:****`
  }
  const parts = value.split('.')
  if (parts.length !== 4) return value
  return `${parts[0]}.${parts[1]}.*.*`
}

async function loadInstanceForEligibility(instanceId: number, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.instance.findUnique({
    where: { id: instanceId },
    include: {
      package: { select: { id: true, name: true, active: true, instanceType: true } },
      packagePlan: { select: { id: true, name: true, isActive: true, isSoldOut: true } },
      host: { select: { id: true, name: true, location: true, countryCode: true, status: true } },
      resourceRiskState: true
    }
  })
}

export async function checkExchangeListingEligibility(userId: number, instanceId: number): Promise<ExchangeEligibilityResult> {
  const policy = await getPolicy()
  const instance = await loadInstanceForEligibility(instanceId)
  if (!instance || instance.userId !== userId || instance.status === 'deleted') {
    throw new ExchangeError('EXCHANGE_INSTANCE_NOT_FOUND', '实例不存在', 404)
  }

  const checks: ExchangeEligibilityResult['checks'] = []
  const reasons: string[] = []

  addCheck(checks, 'exchange_enabled', '交易所已启用', policy.enabled, '交易所当前未启用', reasons)
  const sellerAccount = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true }
  })
  addCheck(checks, 'account_active', '账号状态正常', sellerAccount?.status === 'active', '账号状态异常，不能挂牌', reasons)
  addCheck(checks, 'must_be_stopped', '实例必须暂停', instance.status === 'stopped', '上架交易所前必须先暂停实例', reasons)

  const now = Date.now()
  const minRemainingMs = policy.minRemainingDays * 24 * 60 * 60 * 1000
  const expiringSoonMs = policy.expiringSoonDays * 24 * 60 * 60 * 1000
  const remainingMs = instance.expiresAt === null ? null : instance.expiresAt.getTime() - now
  const hasMinimumRemaining = remainingMs === null || remainingMs >= minRemainingMs
  const notExpiringSoon = remainingMs === null || remainingMs >= expiringSoonMs
  addCheck(checks, 'minimum_remaining', '最低剩余有效期满足要求', hasMinimumRemaining, `实例剩余有效期不足 ${policy.minRemainingDays} 天，不能挂牌`, reasons)
  addCheck(checks, 'not_expiring_soon', '未进入即将到期阈值', notExpiringSoon, `实例将在 ${policy.expiringSoonDays} 天内到期，不能挂牌`, reasons)
  addCheck(checks, 'not_overdue', '实例未欠费/逾期', instance.expiresAt === null || instance.expiresAt.getTime() > now, '实例已欠费或逾期，不能挂牌', reasons)

  const [activeTask, activeRestoreTask, activeUploadTask] = await Promise.all([
    prisma.instanceTask.findFirst({
      where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, taskType: true, status: true }
    }),
    prisma.restoreTask.findFirst({
      where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, status: true }
    }),
    prisma.backupUploadTask.findFirst({
      where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, status: true }
    })
  ])
  addCheck(checks, 'no_active_task', '没有执行中任务', !activeTask && !activeRestoreTask && !activeUploadTask, '实例存在执行中任务，不能挂牌', reasons)

  const activeListing = await prisma.exchangeListing.findFirst({
    where: { instanceId, status: { in: listingBlockingStatuses } },
    select: { id: true, status: true }
  })
  addCheck(checks, 'not_listed', '未挂牌/未锁定交易', !activeListing, '实例已在交易所挂牌或锁定交易中', reasons)

  const activeOrder = await prisma.exchangeOrder.findFirst({
    where: { instanceId, status: { in: orderBlockingStatuses } },
    select: { id: true, status: true }
  })
  addCheck(checks, 'no_active_order', '没有未完成交易', !activeOrder, '实例存在未完成交易订单', reasons)
  const pendingTransfer = await hasPendingTransfer(instanceId)
  addCheck(checks, 'no_pending_transfer', '没有待处理普通转移', !pendingTransfer, '实例存在待处理普通转移，不能挂牌交易所', reasons)

  const activeRestriction = await prisma.userOrderRestriction.findFirst({
    where: { userId, status: 'active' },
    select: { id: true }
  })
  addCheck(checks, 'account_not_restricted', '账号未被限制下单', !activeRestriction, '账号存在风控下单限制，不能挂牌', reasons)
  const accountTrafficQuota = await prisma.userQuota.findUnique({
    where: { userId },
    select: {
      monthlyTrafficLimit: true,
      monthlyTrafficUsed: true,
      trafficStatus: true
    }
  })
  const accountTrafficWithinLimit = isAccountTrafficWithinLimit(accountTrafficQuota)
  addCheck(checks, 'account_traffic_not_over_limit', '账号总流量未超限', accountTrafficWithinLimit, accountTrafficLimitMessage(accountTrafficQuota), reasons)

  const riskState = instance.resourceRiskState
  const riskOk = !riskState || (riskState.status === 'normal' && riskState.level === 'normal' && riskState.score < 70)
  addCheck(checks, 'risk_normal', '实例风控正常', riskOk, '实例处于风控状态，不能挂牌', reasons)

  addCheck(checks, 'package_active', '套餐正常', !instance.package || instance.package.active, '实例套餐已停用，不能挂牌', reasons)
  addCheck(checks, 'plan_snapshot_available', '方案快照可展示', true, instance.packagePlan && (!instance.packagePlan.isActive || instance.packagePlan.isSoldOut)
    ? '实例方案已停用或售罄，但存量实例剩余使用权允许交易'
    : '实例方案可展示', reasons)
  addCheck(checks, 'host_available', '节点正常', instance.host.status === 'online', '实例所在节点不可用，不能挂牌', reasons)
  const trafficWithinLimit = isInstanceTrafficWithinLimit(instance)
  addCheck(checks, 'traffic_not_over_limit', '实例流量未超限', trafficWithinLimit, instanceTrafficLimitMessage(instance), reasons)
  const storagePoolCheck = await validateListingStoragePools(prisma, instance)
  addCheck(
    checks,
    'instance_storage_pool_available',
    '实例存储池可用',
    storagePoolCheck.instancePoolOk,
    storagePoolCheck.instancePoolName
      ? `实例当前存储池 ${storagePoolCheck.instancePoolName} 不存在或不是系统盘池，不能挂牌`
      : '实例未记录存储池且节点没有可用系统盘池，不能挂牌',
    reasons
  )
  addCheck(
    checks,
    'package_storage_pool_available',
    '套餐存储池可用',
    storagePoolCheck.packagePoolOk,
    storagePoolCheck.packagePoolName
      ? `套餐绑定存储池 ${storagePoolCheck.packagePoolName} 不存在或不是系统盘池，不能挂牌`
      : '套餐未绑定存储池且节点没有可用系统盘池，不能挂牌',
    reasons
  )
  const packageAllowlist = jsonNumberList(policy.packageAllowlist)
  addCheck(checks, 'package_allowed', '套餐允许交易', packageAllowlist.length === 0 || (!!instance.packageId && packageAllowlist.includes(instance.packageId)), '当前套餐不允许进入交易所', reasons)
  const hostAllowlist = jsonNumberList(policy.hostAllowlist)
  addCheck(checks, 'host_allowed', '节点允许交易', hostAllowlist.length === 0 || hostAllowlist.includes(instance.hostId), '当前节点不允许进入交易所', reasons)
  addCheck(checks, 'public_ip_transfer_allowed', '独立 IP 跟随策略', policy.allowPublicIpTransfer || !isDedicatedIpNetworkMode(instance.networkMode), '当前交易所配置不允许独立 IP 跟随转让，该网络类型不能挂牌', reasons)

  const [portMappingCount, proxySiteCount, snapshotCount, backupPolicyCount] = await Promise.all([
    prisma.portMapping.count({ where: { instanceId } }),
    prisma.proxySite.count({ where: { instanceId } }),
    prisma.snapshot.count({ where: { instanceId } }),
    prisma.backupPolicy.count({ where: { instanceId } })
  ])
  addCheck(checks, 'cleanup_port_mappings', '端口映射交割清理', true, portMappingCount > 0 ? `成交交割时会清理 ${portMappingCount} 条端口映射` : '无端口映射需要清理', reasons)
  addCheck(checks, 'cleanup_proxy_sites', '代理站点交割清理', true, proxySiteCount > 0 ? `成交交割时会清理 ${proxySiteCount} 个代理站点绑定` : '无代理站点绑定需要清理', reasons)
  addCheck(checks, 'cleanup_snapshots', '快照交割清理', true, snapshotCount > 0 ? `成交交割时会清理 ${snapshotCount} 个旧快照` : '无旧快照需要清理', reasons)
  addCheck(checks, 'cleanup_backup_policy', '备份策略交割清理', true, backupPolicyCount > 0 ? '成交交割时会清理自动备份策略' : '无自动备份策略需要清理', reasons)

  const hasBlockingReasonExceptStopped = checks.some(check => !check.passed && check.key !== 'must_be_stopped')
  const status: ExchangeEligibilityResult['status'] = instance.status === 'running' && !hasBlockingReasonExceptStopped
    ? 'must_stop_first'
    : instance.status !== 'stopped'
      ? 'cannot_list'
      : reasons.length > 0 ? 'cannot_list' : 'can_list'

  return {
    eligible: reasons.length === 0,
    status,
    reasons,
    checks,
    instance: serializeInstanceSnapshot(instance)
  }
}

export async function createExchangeListing(input: ListingInput) {
  const price = normalizeMoney(input.price, '出售价格')
  const description = normalizeOptionalText(input.description, maxDescriptionLength)
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  assertAnonymousListingDescription(description)

  return prisma.$transaction(async tx => {
    if (idempotencyKey) {
      const existing = await tx.exchangeListing.findUnique({
        where: { idempotencyKey }
      })
      if (existing) {
        if (existing.sellerUserId !== input.userId) {
          throw new ExchangeError('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT', '幂等键已被其他请求使用', 409)
        }
        return serializeListing(existing)
      }
    }
    const autoDelistAt = normalizeFutureAutoDelistAt(input.autoDelistAt)
    const policy = await getPolicy(tx)
    if (!policy.enabled) {
      throw new ExchangeError('EXCHANGE_DISABLED', '交易所当前未启用')
    }
    const seller = await tx.user.findUnique({
      where: { id: input.userId },
      select: { status: true }
    })
    if (!seller || seller.status !== 'active') {
      throw new ExchangeError('EXCHANGE_ACCOUNT_NOT_ACTIVE', '账号状态异常，不能挂牌')
    }
    if (price < toNumber(policy.minPrice)) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_LOW', `出售价格不能低于 ¥${toNumber(policy.minPrice).toFixed(2)}`)
    }
    if (policy.maxPrice !== null && price > toNumber(policy.maxPrice)) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_HIGH', `出售价格不能高于 ¥${toNumber(policy.maxPrice).toFixed(2)}`)
    }

    const activeCount = await tx.exchangeListing.count({
      where: {
        sellerUserId: input.userId,
        status: { in: listingBlockingStatuses }
      }
    })
    if (activeCount >= policy.maxActiveListingsPerUser) {
      throw new ExchangeError('EXCHANGE_LISTING_LIMIT', '已达到当前账号最大挂牌数量')
    }

    const instance = await loadInstanceForEligibility(input.instanceId, tx)
    if (!instance || instance.userId !== input.userId || instance.status === 'deleted') {
      throw new ExchangeError('EXCHANGE_INSTANCE_NOT_FOUND', '实例不存在', 404)
    }
    if (instance.status !== 'stopped') {
      throw new ExchangeError('EXCHANGE_INSTANCE_MUST_BE_STOPPED', '上架交易所前必须先暂停实例')
    }
    assertPolicyAllowlist(policy, instance)
    assertMaxMarkup(price, policy, instance)

    const now = Date.now()
    const minRemainingMs = policy.minRemainingDays * 24 * 60 * 60 * 1000
    const expiringSoonMs = policy.expiringSoonDays * 24 * 60 * 60 * 1000
    if (instance.expiresAt !== null && instance.expiresAt.getTime() <= now) {
      throw new ExchangeError('EXCHANGE_INSTANCE_OVERDUE', '实例已欠费或逾期，不能挂牌')
    }
    if (instance.expiresAt !== null && instance.expiresAt.getTime() - now < minRemainingMs) {
      throw new ExchangeError('EXCHANGE_INSTANCE_EXPIRING_SOON', `实例剩余有效期不足 ${policy.minRemainingDays} 天，不能挂牌`)
    }
    if (instance.expiresAt !== null && instance.expiresAt.getTime() - now < expiringSoonMs) {
      throw new ExchangeError('EXCHANGE_INSTANCE_EXPIRING_SOON', `实例将在 ${policy.expiringSoonDays} 天内到期，不能挂牌`)
    }
    const riskState = instance.resourceRiskState
    if (riskState && (riskState.status !== 'normal' || riskState.level !== 'normal' || riskState.score >= 70)) {
      throw new ExchangeError('EXCHANGE_INSTANCE_RISKY', '实例处于风控状态，不能挂牌')
    }
    if (instance.package && !instance.package.active) {
      throw new ExchangeError('EXCHANGE_PACKAGE_INACTIVE', '实例套餐已停用，不能挂牌')
    }
    if (instance.host.status !== 'online') {
      throw new ExchangeError('EXCHANGE_HOST_UNAVAILABLE', '实例所在节点不可用，不能挂牌')
    }
    if (!isInstanceTrafficWithinLimit(instance)) {
      throw new ExchangeError('EXCHANGE_INSTANCE_TRAFFIC_OVER_LIMIT', instanceTrafficLimitMessage(instance))
    }
    const accountTrafficQuota = await tx.userQuota.findUnique({
      where: { userId: input.userId },
      select: {
        monthlyTrafficLimit: true,
        monthlyTrafficUsed: true,
        trafficStatus: true
      }
    })
    if (!isAccountTrafficWithinLimit(accountTrafficQuota)) {
      throw new ExchangeError('EXCHANGE_ACCOUNT_TRAFFIC_OVER_LIMIT', accountTrafficLimitMessage(accountTrafficQuota))
    }
    const storagePoolCheck = await validateListingStoragePools(tx, instance)
    if (!storagePoolCheck.instancePoolOk) {
      throw new ExchangeError(
        'EXCHANGE_INSTANCE_STORAGE_POOL_UNAVAILABLE',
        storagePoolCheck.instancePoolName
          ? `实例当前存储池 ${storagePoolCheck.instancePoolName} 不存在或不是系统盘池，不能挂牌`
          : '实例未记录存储池且节点没有可用系统盘池，不能挂牌'
      )
    }
    if (!storagePoolCheck.packagePoolOk) {
      throw new ExchangeError(
        'EXCHANGE_PACKAGE_STORAGE_POOL_UNAVAILABLE',
        storagePoolCheck.packagePoolName
          ? `套餐绑定存储池 ${storagePoolCheck.packagePoolName} 不存在或不是系统盘池，不能挂牌`
          : '套餐未绑定存储池且节点没有可用系统盘池，不能挂牌'
      )
    }

    const activeRestriction = await tx.userOrderRestriction.findFirst({
      where: { userId: input.userId, status: 'active' },
      select: { id: true }
    })
    if (activeRestriction) {
      throw new ExchangeError('EXCHANGE_SELLER_RESTRICTED', '账号存在风控下单限制，不能挂牌')
    }

    const [activeTask, activeRestoreTask, activeUploadTask] = await Promise.all([
      tx.instanceTask.findFirst({
        where: { instanceId: input.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.restoreTask.findFirst({
        where: { instanceId: input.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId: input.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeTask || activeRestoreTask || activeUploadTask) {
      throw new ExchangeError('EXCHANGE_INSTANCE_HAS_ACTIVE_TASK', '实例存在执行中任务，不能挂牌')
    }

    const activeListing = await tx.exchangeListing.findFirst({
      where: { instanceId: input.instanceId, status: { in: listingBlockingStatuses } },
      select: { id: true }
    })
    if (activeListing) {
      throw new ExchangeError('EXCHANGE_INSTANCE_ALREADY_LISTED', '实例已在交易所挂牌或锁定交易中')
    }

    const activeOrder = await tx.exchangeOrder.findFirst({
      where: { instanceId: input.instanceId, status: { in: orderBlockingStatuses } },
      select: { id: true }
    })
    if (activeOrder) {
      throw new ExchangeError('EXCHANGE_INSTANCE_HAS_ACTIVE_ORDER', '实例存在未完成交易订单')
    }
    const pendingTransferCount = await tx.instanceTransfer.count({
      where: {
        instanceId: input.instanceId,
        status: { in: ['pending', 'processing'] }
      }
    })
    if (pendingTransferCount > 0) {
      throw new ExchangeError('EXCHANGE_INSTANCE_HAS_PENDING_TRANSFER', '实例存在待处理普通转移，不能挂牌交易所')
    }

    const { feeAmount, sellerReceivesAmount } = calculateFee(price, policy)
    if (sellerReceivesAmount <= 0) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_LOW', '扣除手续费后卖家到账金额必须大于 0')
    }
    const snapshot = serializeInstanceSnapshot(instance)
    const eligibility = await buildEligibilitySnapshot(input.userId, input.instanceId, tx)

    const listing = await tx.exchangeListing.create({
      data: {
        instanceId: input.instanceId,
        sellerUserId: input.userId,
        price,
        feeAmount,
        sellerReceivesAmount,
        description,
        autoDelistAt,
        idempotencyKey,
        snapshot,
        eligibilitySnapshot: eligibility
      }
    })

    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'listing.create',
        targetType: 'exchange_listing',
        targetId: listing.id,
        detail: { instanceId: input.instanceId, price, feeAmount, sellerReceivesAmount }
      }
    })

    return serializeListing(listing)
  })
}

async function buildEligibilitySnapshot(userId: number, instanceId: number, tx: Prisma.TransactionClient) {
  const activeTask = await tx.instanceTask.findFirst({
    where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true, taskType: true, status: true }
  })
  const riskState = await tx.instanceRiskState.findUnique({
    where: { instanceId },
    select: { score: true, level: true, status: true }
  })
  const activeRestriction = await tx.userOrderRestriction.findFirst({
    where: { userId, status: 'active' },
    select: { id: true }
  })
  const accountTrafficState = await tx.userQuota.findUnique({
    where: { userId },
    select: {
      monthlyTrafficLimit: true,
      monthlyTrafficUsed: true,
      trafficStatus: true
    }
  })
  const trafficState = await tx.instance.findUnique({
    where: { id: instanceId },
    select: {
      monthlyTrafficLimit: true,
      monthlyTrafficUsed: true,
      trafficStatus: true
    }
  })
  return {
    requiredStatus: 'stopped',
    activeTask,
    riskState,
    activeRestriction,
    accountTraffic: accountTrafficState ? {
      status: accountTrafficState.trafficStatus,
      monthlyTrafficLimit: toBigintString(accountTrafficState.monthlyTrafficLimit),
      monthlyTrafficUsed: toBigintString(accountTrafficState.monthlyTrafficUsed),
      withinLimit: isAccountTrafficWithinLimit(accountTrafficState)
    } : null,
    traffic: trafficState ? {
      status: trafficState.trafficStatus,
      monthlyTrafficLimit: toBigintString(trafficState.monthlyTrafficLimit),
      monthlyTrafficUsed: toBigintString(trafficState.monthlyTrafficUsed),
      withinLimit: isInstanceTrafficWithinLimit(trafficState)
    } : null,
    cleanupOnDelivery: ['ssh_keys', 'terminal_sessions', 'console_tokens', 'port_mappings', 'proxy_sites', 'snapshots', 'credentials'],
    deliveryMode: 'reinstall_required',
    privacyMode: 'anonymous'
  }
}

export async function listExchangeMarket(options: { page?: number; pageSize?: number; packageId?: number | null } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const packageId = options.packageId && options.packageId > 0 ? Math.floor(options.packageId) : null
  const policy = await getPolicy()
  if (!policy.enabled) {
    return { items: [], total: 0, page, pageSize, packages: [] }
  }
  const where = visibleListingPackageWhere(packageId)
  const [items, total, packageRows] = await Promise.all([
    prisma.exchangeListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.exchangeListing.count({ where }),
    prisma.exchangeListing.findMany({
      where: visibleListingWhere(),
      select: { snapshot: true }
    })
  ])
  return {
    items: items.map(serializePublicListing),
    total,
    page,
    pageSize,
    packages: buildMarketPackageCategories(packageRows)
  }
}

export async function getExchangeListingDetail(listingId: number) {
  const policy = await getPolicy()
  if (!policy.enabled) {
    throw new ExchangeError('EXCHANGE_DISABLED', '交易所当前未启用', 403)
  }
  const listing = await prisma.exchangeListing.findFirst({
    where: {
      id: listingId,
      ...visibleListingWhere()
    }
  })
  if (!listing) {
    throw new ExchangeError('EXCHANGE_LISTING_NOT_FOUND', '挂牌不存在或已下架', 404)
  }
  return serializePublicListing(listing)
}

export async function listUserExchangeListings(userId: number, options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const where = { sellerUserId: userId }
  const [items, total] = await Promise.all([
    prisma.exchangeListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.exchangeListing.count({ where })
  ])
  return { items: items.map(serializeListing), total, page, pageSize }
}

export async function getUserExchangeListingForInstance(userId: number, instanceId: number) {
  const listing = await prisma.exchangeListing.findFirst({
    where: {
      sellerUserId: userId,
      instanceId,
      status: { in: listingBlockingStatuses }
    },
    orderBy: { updatedAt: 'desc' }
  })
  return { listing: listing ? serializeListing(listing) : null }
}

export async function delistExchangeListing(userId: number, listingId: number) {
  const updated = await prisma.exchangeListing.updateMany({
    where: {
      id: listingId,
      sellerUserId: userId,
      status: { in: ['active', 'paused'] }
    },
    data: {
      status: 'delisted',
      delistedAt: new Date()
    }
  })
  if (updated.count !== 1) {
    throw new ExchangeError('EXCHANGE_LISTING_NOT_DELISTABLE', '挂牌不存在或当前状态不能下架')
  }
  await prisma.exchangeAuditLog.create({
    data: {
      actorUserId: userId,
      action: 'listing.delist',
      targetType: 'exchange_listing',
      targetId: listingId
    }
  })
  return { success: true }
}

export async function updateExchangeListing(input: Omit<ListingInput, 'instanceId'> & { listingId: number; instanceId?: number | null }) {
  const price = normalizeMoney(input.price, '出售价格')
  const description = normalizeOptionalText(input.description, maxDescriptionLength)
  const autoDelistAt = normalizeFutureAutoDelistAt(input.autoDelistAt)
  assertAnonymousListingDescription(description)

  return prisma.$transaction(async tx => {
    const listing = await tx.exchangeListing.findFirst({
      where: {
        id: input.listingId,
        sellerUserId: input.userId,
        status: 'active'
      }
    })
    if (!listing) {
      throw new ExchangeError('EXCHANGE_LISTING_NOT_EDITABLE', '挂牌不存在或当前状态不能修改')
    }
    if (input.instanceId !== undefined && input.instanceId !== null && input.instanceId !== listing.instanceId) {
      throw new ExchangeError('EXCHANGE_LISTING_INSTANCE_IMMUTABLE', '挂牌实例不能修改')
    }
    const policy = await getPolicy(tx)
    if (price < toNumber(policy.minPrice)) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_LOW', `出售价格不能低于 ¥${toNumber(policy.minPrice).toFixed(2)}`)
    }
    if (policy.maxPrice !== null && price > toNumber(policy.maxPrice)) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_HIGH', `出售价格不能高于 ¥${toNumber(policy.maxPrice).toFixed(2)}`)
    }
    const instance = await tx.instance.findUnique({
      where: { id: listing.instanceId },
      select: { billingPrice: true }
    })
    if (instance) {
      assertMaxMarkup(price, policy, instance)
    }
    const { feeAmount, sellerReceivesAmount } = calculateFee(price, policy)
    if (sellerReceivesAmount <= 0) {
      throw new ExchangeError('EXCHANGE_PRICE_TOO_LOW', '扣除手续费后卖家到账金额必须大于 0')
    }
    const updated = await tx.exchangeListing.update({
      where: { id: input.listingId },
      data: {
        price,
        feeAmount,
        sellerReceivesAmount,
        description,
        autoDelistAt
      }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'listing.update',
        targetType: 'exchange_listing',
        targetId: input.listingId,
        detail: { price, feeAmount, sellerReceivesAmount }
      }
    })
    return serializeListing(updated)
  })
}

async function assertListingStillPurchasable(
  tx: Prisma.TransactionClient,
  policy: Awaited<ReturnType<typeof getPolicy>>,
  listing: Pick<Prisma.ExchangeListingGetPayload<{}>, 'id' | 'instanceId' | 'sellerUserId' | 'autoDelistAt'>
) {
  if (listing.autoDelistAt !== null && listing.autoDelistAt.getTime() <= Date.now()) {
    throw new ExchangeError('EXCHANGE_LISTING_EXPIRED', '挂牌已到自动下架时间，无法购买')
  }

  const instance = await loadInstanceForEligibility(listing.instanceId, tx)
  if (!instance || instance.userId !== listing.sellerUserId || instance.status !== 'stopped') {
    throw new ExchangeError('EXCHANGE_INSTANCE_STATE_CHANGED', '实例状态已变化，无法购买')
  }

  const seller = await tx.user.findUnique({
    where: { id: listing.sellerUserId },
    select: { status: true }
  })
  if (!seller || seller.status !== 'active') {
    throw new ExchangeError('EXCHANGE_SELLER_NOT_ACTIVE', '卖家账号状态异常，无法购买')
  }

  assertPolicyAllowlist(policy, instance)

  const now = Date.now()
  const minRemainingMs = policy.minRemainingDays * 24 * 60 * 60 * 1000
  const expiringSoonMs = policy.expiringSoonDays * 24 * 60 * 60 * 1000
  if (instance.expiresAt !== null && instance.expiresAt.getTime() <= now) {
    throw new ExchangeError('EXCHANGE_INSTANCE_OVERDUE', '实例已欠费或逾期，无法购买')
  }
  if (instance.expiresAt !== null && instance.expiresAt.getTime() - now < minRemainingMs) {
    throw new ExchangeError('EXCHANGE_INSTANCE_EXPIRING_SOON', `实例剩余有效期不足 ${policy.minRemainingDays} 天，无法购买`)
  }
  if (instance.expiresAt !== null && instance.expiresAt.getTime() - now < expiringSoonMs) {
    throw new ExchangeError('EXCHANGE_INSTANCE_EXPIRING_SOON', `实例将在 ${policy.expiringSoonDays} 天内到期，无法购买`)
  }

  const riskState = instance.resourceRiskState
  if (riskState && (riskState.status !== 'normal' || riskState.level !== 'normal' || riskState.score >= 70)) {
    throw new ExchangeError('EXCHANGE_INSTANCE_RISKY', '实例处于风控状态，无法购买')
  }
  if (instance.package && !instance.package.active) {
    throw new ExchangeError('EXCHANGE_PACKAGE_INACTIVE', '实例套餐已停用，无法购买')
  }
  if (instance.host.status !== 'online') {
    throw new ExchangeError('EXCHANGE_HOST_UNAVAILABLE', '实例所在节点不可用，无法购买')
  }
  if (!isInstanceTrafficWithinLimit(instance)) {
    throw new ExchangeError('EXCHANGE_INSTANCE_TRAFFIC_OVER_LIMIT', instanceTrafficLimitMessage(instance))
  }

  const [sellerRestriction, accountTrafficQuota, storagePoolCheck, activeOrder] = await Promise.all([
    tx.userOrderRestriction.findFirst({
      where: { userId: listing.sellerUserId, status: 'active' },
      select: { id: true }
    }),
    tx.userQuota.findUnique({
      where: { userId: listing.sellerUserId },
      select: {
        monthlyTrafficLimit: true,
        monthlyTrafficUsed: true,
        trafficStatus: true
      }
    }),
    validateListingStoragePools(tx, instance),
    tx.exchangeOrder.findFirst({
      where: {
        instanceId: listing.instanceId,
        status: { in: orderBlockingStatuses }
      },
      select: { id: true, status: true }
    })
  ])
  if (sellerRestriction) {
    throw new ExchangeError('EXCHANGE_SELLER_RESTRICTED', '卖家账号存在风控限制，无法购买')
  }
  if (!isAccountTrafficWithinLimit(accountTrafficQuota)) {
    throw new ExchangeError('EXCHANGE_ACCOUNT_TRAFFIC_OVER_LIMIT', accountTrafficLimitMessage(accountTrafficQuota))
  }
  if (!storagePoolCheck.instancePoolOk) {
    throw new ExchangeError(
      'EXCHANGE_INSTANCE_STORAGE_POOL_UNAVAILABLE',
      storagePoolCheck.instancePoolName
        ? `实例当前存储池 ${storagePoolCheck.instancePoolName} 不存在或不是系统盘池，无法购买`
        : '实例未记录存储池且节点没有可用系统盘池，无法购买'
    )
  }
  if (!storagePoolCheck.packagePoolOk) {
    throw new ExchangeError(
      'EXCHANGE_PACKAGE_STORAGE_POOL_UNAVAILABLE',
      storagePoolCheck.packagePoolName
        ? `套餐绑定存储池 ${storagePoolCheck.packagePoolName} 不存在或不是系统盘池，无法购买`
        : '套餐未绑定存储池且节点没有可用系统盘池，无法购买'
    )
  }
  if (activeOrder) {
    throw new ExchangeError('EXCHANGE_INSTANCE_HAS_ACTIVE_ORDER', '实例存在未完成交易订单，无法购买')
  }

  return instance
}

export async function purchaseExchangeListing(input: PurchaseInput) {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const imageAlias = normalizeOptionalImageAlias(input.imageAlias)
  const sshKeyId = normalizeOptionalPositiveId(input.sshKeyId, 'SSH 密钥')
  return prisma.$transaction(async tx => {
    if (idempotencyKey) {
      const existing = await tx.exchangeOrder.findUnique({
        where: { idempotencyKey },
        include: { deliveryTasks: { orderBy: { createdAt: 'desc' }, take: 1 } }
      })
      if (existing) {
        if (existing.buyerUserId !== input.userId || existing.listingId !== input.listingId) {
          throw new ExchangeError('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT', '幂等键已被其他交易请求使用', 409)
        }
        return serializeOrder(existing, existing.deliveryTasks[0] || null)
      }
    }
    const listing = await tx.exchangeListing.findUnique({
      where: { id: input.listingId }
    })
    if (!listing || listing.status !== 'active') {
      throw new ExchangeError('EXCHANGE_LISTING_NOT_AVAILABLE', '挂牌不存在或已不可购买', 404)
    }
    if (listing.sellerUserId === input.userId) {
      throw new ExchangeError('EXCHANGE_CANNOT_BUY_OWN_LISTING', '不能购买自己挂牌的实例')
    }
    const policy = await getPolicy(tx)
    if (!policy.enabled) {
      throw new ExchangeError('EXCHANGE_DISABLED', '交易所当前未启用')
    }
    const purchaseInstance = await assertListingStillPurchasable(tx, policy, listing)

    const buyerRestriction = await tx.userOrderRestriction.findFirst({
      where: { userId: input.userId, status: 'active' },
      select: { id: true }
    })
    if (buyerRestriction) {
      throw new ExchangeError('EXCHANGE_BUYER_RESTRICTED', '账号存在风控限制，不能购买交易所实例')
    }
    await assertExchangeBuyerRiskClear(tx, input.userId)
    const todayPurchases = await tx.exchangeOrder.count({
      where: {
        buyerUserId: input.userId,
        createdAt: { gte: startOfLocalDay() }
      }
    })
    if (todayPurchases >= policy.maxPurchasesPerUserPerDay) {
      throw new ExchangeError('EXCHANGE_PURCHASE_DAILY_LIMIT', '已达到今日交易所购买次数上限')
    }

    if (imageAlias) {
      if (!policy.allowBuyerImageSelection) {
        throw new ExchangeError('EXCHANGE_BUYER_IMAGE_SELECTION_DISABLED', '当前交易所未开放买家自选重装镜像')
      }
      const instanceType = purchaseInstance.package?.instanceType === 'vm' ? 'vm' : 'container'
      const imageAvailability = await getSystemImageAvailabilityForHost(imageAlias, purchaseInstance.hostId, {
        instanceType,
        memory: purchaseInstance.memory
      })
      if (!imageAvailability.ok) {
        throw new ExchangeError('EXCHANGE_IMAGE_UNAVAILABLE', imageAvailabilityMessage(imageAvailability.reason))
      }
    }

    if (sshKeyId) {
      const sshKey = await tx.sshKey.findUnique({
        where: { id: sshKeyId },
        select: { userId: true }
      })
      if (!sshKey || sshKey.userId !== input.userId) {
        throw new ExchangeError('EXCHANGE_SSH_KEY_NOT_OWNED', 'SSH 密钥不存在或不属于当前买家')
      }
    }

    const [activeTask, activeRestoreTask, activeUploadTask] = await Promise.all([
      tx.instanceTask.findFirst({
        where: { instanceId: listing.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.restoreTask.findFirst({
        where: { instanceId: listing.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId: listing.instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeTask || activeRestoreTask || activeUploadTask) {
      throw new ExchangeError('EXCHANGE_INSTANCE_HAS_ACTIVE_TASK', '实例存在执行中任务，无法购买')
    }

    const claimed = await tx.exchangeListing.updateMany({
      where: { id: listing.id, status: 'active' },
      data: { status: 'locked' }
    })
    if (claimed.count !== 1) {
      throw new ExchangeError('EXCHANGE_LISTING_LOCK_FAILED', '挂牌已被其他订单锁定')
    }

    const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)
    if (!locked) {
      throw new ExchangeError('EXCHANGE_BALANCE_BUSY', '余额正在处理，请稍后重试')
    }
    const buyer = await tx.user.findUnique({
      where: { id: input.userId },
      select: { balance: true, status: true }
    })
    if (!buyer) {
      throw new ExchangeError('EXCHANGE_BUYER_NOT_FOUND', '买家不存在', 404)
    }
    if (buyer.status !== 'active') {
      throw new ExchangeError('EXCHANGE_ACCOUNT_NOT_ACTIVE', '账号状态异常，不能购买交易所实例')
    }
    const price = toNumber(listing.price)
    if (toNumber(buyer.balance) < price) {
      throw new ExchangeError('EXCHANGE_BALANCE_NOT_ENOUGH', '账户余额不足')
    }

    const orderNo = `EX${exchangeOrderNo()}`
    const balanceBefore = toNumber(buyer.balance)
    const balanceAfter = Number((balanceBefore - price).toFixed(2))
    const updated = await tx.user.updateMany({
      where: { id: input.userId, balance: { gte: price } },
      data: { balance: { decrement: price } }
    })
    if (updated.count !== 1) {
      throw new ExchangeError('EXCHANGE_BALANCE_NOT_ENOUGH', '账户余额不足')
    }
    const buyerBalanceLog = await tx.balanceLog.create({
      data: {
        userId: input.userId,
        type: 'exchange_purchase',
        amount: -price,
        balanceBefore,
        balanceAfter,
        orderId: orderNo,
        instanceId: listing.instanceId,
        remark: `交易所购买实例，订单 ${orderNo}`
      }
    })

    const order = await tx.exchangeOrder.create({
      data: {
        orderNo,
        listingId: listing.id,
        instanceId: listing.instanceId,
        buyerUserId: input.userId,
        sellerUserId: listing.sellerUserId,
        status: 'delivering',
        price,
        feeAmount: listing.feeAmount,
        sellerReceivesAmount: listing.sellerReceivesAmount,
        escrowAmount: price,
        buyerBalanceLogId: buyerBalanceLog.id,
        idempotencyKey,
        snapshot: toInputJson(listing.snapshot)
      }
    })

    const buyerExchangeWallet = await tx.exchangeWallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId }
    })
    const escrowHoldLog = await tx.exchangeWalletLog.create({
      data: {
        walletId: buyerExchangeWallet.id,
        userId: input.userId,
        type: 'escrow_hold',
        amount: price,
        availableBefore: buyerExchangeWallet.availableAmount,
        availableAfter: buyerExchangeWallet.availableAmount,
        frozenBefore: buyerExchangeWallet.frozenAmount,
        frozenAfter: buyerExchangeWallet.frozenAmount,
        orderId: order.id,
        balanceLogId: buyerBalanceLog.id,
        remark: `交易所订单 ${orderNo} 买家扣款进入平台托管`
      }
    })

    await tx.exchangeListing.update({
      where: { id: listing.id },
      data: { lockedOrderId: order.id }
    })

    const deliveryTask = await tx.exchangeDeliveryTask.create({
      data: {
        orderId: order.id,
        instanceId: listing.instanceId,
        buyerUserId: input.userId,
        sellerUserId: listing.sellerUserId,
	        status: 'PENDING',
	        step: 'escrow_paid',
	        progress: {
	          steps: [...exchangeDeliveryProgressSteps],
	          current: 'escrow_paid'
	        },
        imageAlias,
        sshKeyId
      }
    })

    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'order.purchase',
        targetType: 'exchange_order',
        targetId: order.id,
        detail: { listingId: listing.id, instanceId: listing.instanceId, price, deliveryTaskId: deliveryTask.id, buyerBalanceLogId: buyerBalanceLog.id, escrowHoldLogId: escrowHoldLog.id, imageAlias, sshKeyId }
      }
    })

    return serializeOrder(order, deliveryTask)
  })
}

export async function releaseExchangeOrderEscrow(
  orderId: number,
  options: {
    actorUserId?: number | null
    action?: string
    remark?: string
    allowedStatuses?: ExchangeOrderStatus[]
    resolveDispute?: {
      disputeId: number
      resolution: string
      releaseRemark?: string
    }
  } = {}
) {
  const allowedStatuses = options.allowedStatuses || ['confirming']
  return prisma.$transaction(async tx => {
    const order = await tx.exchangeOrder.findUnique({ where: { id: orderId } })
    if (!order) {
      throw new ExchangeError('EXCHANGE_ORDER_NOT_FOUND', '交易订单不存在', 404)
    }
    if (order.status === 'completed' && order.walletLogId) {
      if (options.resolveDispute) {
        const resolved = await tx.exchangeDispute.updateMany({
          where: {
            id: options.resolveDispute.disputeId,
            orderId: order.id,
            status: 'processing',
            handledByUserId: options.actorUserId ?? null
          },
          data: {
            status: 'released',
            resolution: options.resolveDispute.resolution,
            resolvedAt: new Date()
          }
        })
        if (resolved.count !== 1) {
          throw new ExchangeError('EXCHANGE_DISPUTE_STATE_CHANGED', '争议状态已变化，请刷新后重试')
        }
        const disputeReleaseLog = await createDisputeWalletLog(
          tx,
          order,
          'dispute_release',
          options.resolveDispute.releaseRemark || `交易所争议 ${options.resolveDispute.disputeId} 人工放款，争议冻结标记解除`
        )
        await tx.exchangeAuditLog.create({
          data: {
            actorUserId: options.actorUserId ?? null,
            action: 'dispute.release',
            targetType: 'exchange_dispute',
            targetId: options.resolveDispute.disputeId,
            detail: {
              resolution: options.resolveDispute.resolution,
              orderId: order.id,
              walletLogId: disputeReleaseLog.id,
              escrowWalletLogId: order.walletLogId,
              alreadyReleased: true
            }
          }
        })
      }
      return order
    }
    if (!allowedStatuses.includes(order.status)) {
      throw new ExchangeError('EXCHANGE_ORDER_NOT_RELEASABLE', '当前订单状态不能放款')
    }

    const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, order.sellerUserId)
    if (!locked) {
      throw new ExchangeError('EXCHANGE_WALLET_BUSY', '卖家交易所余额正在处理，请稍后重试')
    }

    const sellerWallet = await tx.exchangeWallet.upsert({
      where: { userId: order.sellerUserId },
      update: {},
      create: { userId: order.sellerUserId }
    })
    const sellerReceivesAmount = toNumber(order.sellerReceivesAmount)
    const feeAmount = toNumber(order.feeAmount)
    const availableBefore = toNumber(sellerWallet.availableAmount)
    const availableAfter = Number((availableBefore + sellerReceivesAmount).toFixed(2))
    const feeLog = feeAmount > 0
      ? await tx.exchangeWalletLog.create({
          data: {
            walletId: sellerWallet.id,
            userId: order.sellerUserId,
            type: 'fee_charge',
            amount: -feeAmount,
            availableBefore,
            availableAfter: availableBefore,
            frozenBefore: sellerWallet.frozenAmount,
            frozenAfter: sellerWallet.frozenAmount,
            orderId: order.id,
            remark: `交易所订单 ${order.orderNo} 平台手续费从托管款扣除`
          }
        })
      : null
    const walletLog = await tx.exchangeWalletLog.create({
      data: {
        walletId: sellerWallet.id,
        userId: order.sellerUserId,
        type: 'escrow_release',
        amount: sellerReceivesAmount,
        availableBefore,
        availableAfter,
        frozenBefore: sellerWallet.frozenAmount,
        frozenAfter: sellerWallet.frozenAmount,
        orderId: order.id,
        remark: options.remark || `交易所订单 ${order.orderNo} 确认期结束，托管款放款`
      }
    })

    await tx.exchangeWallet.update({
      where: { id: sellerWallet.id },
      data: { availableAmount: { increment: sellerReceivesAmount } }
    })

    const updated = await tx.exchangeOrder.updateMany({
      where: {
        id: order.id,
        status: { in: allowedStatuses },
        walletLogId: null
      },
      data: {
        status: 'completed',
        walletLogId: walletLog.id,
        completedAt: new Date(),
        failureReason: null
      }
    })
    if (updated.count !== 1) {
      throw new ExchangeError('EXCHANGE_ORDER_RELEASE_RACE', '订单放款状态已变化，请刷新后重试')
    }

    let disputeReleaseLog: Awaited<ReturnType<typeof createDisputeWalletLog>> | null = null
    if (options.resolveDispute) {
      const resolved = await tx.exchangeDispute.updateMany({
        where: {
          id: options.resolveDispute.disputeId,
          orderId: order.id,
          status: 'processing',
          handledByUserId: options.actorUserId ?? null
        },
        data: {
          status: 'released',
          resolution: options.resolveDispute.resolution,
          resolvedAt: new Date()
        }
      })
      if (resolved.count !== 1) {
        throw new ExchangeError('EXCHANGE_DISPUTE_STATE_CHANGED', '争议状态已变化，请刷新后重试')
      }
      disputeReleaseLog = await createDisputeWalletLog(
        tx,
        order,
        'dispute_release',
        options.resolveDispute.releaseRemark || `交易所争议 ${options.resolveDispute.disputeId} 人工放款，争议冻结标记解除`
      )
      await tx.exchangeAuditLog.create({
        data: {
          actorUserId: options.actorUserId ?? null,
          action: 'dispute.release',
          targetType: 'exchange_dispute',
          targetId: options.resolveDispute.disputeId,
          detail: {
            resolution: options.resolveDispute.resolution,
            orderId: order.id,
            walletLogId: disputeReleaseLog.id,
            escrowWalletLogId: walletLog.id
          }
        }
      })
    }

    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: options.actorUserId ?? null,
        action: options.action || 'order.escrow_release',
        targetType: 'exchange_order',
        targetId: order.id,
        detail: {
          feeAmount,
          sellerReceivesAmount,
          feeWalletLogId: feeLog?.id ?? null,
          walletLogId: walletLog.id,
          disputeReleaseWalletLogId: disputeReleaseLog?.id ?? null,
          previousStatus: order.status
        }
      }
    })

    return tx.exchangeOrder.findUniqueOrThrow({ where: { id: order.id } })
  })
}

export async function getExchangeWallet(userId: number) {
  const wallet = await prisma.exchangeWallet.upsert({
    where: { userId },
    update: {},
    create: { userId }
  })
  return serializeWallet(wallet)
}

export async function listExchangeWalletLogs(userId: number, options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const where = { userId }
  const [items, total] = await Promise.all([
    prisma.exchangeWalletLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.exchangeWalletLog.count({ where })
  ])
  return {
    items: items.map(serializeWalletLog),
    total,
    page,
    pageSize
  }
}

export async function transferExchangeBalanceToUserBalance(input: TransferInput) {
  const amount = normalizeMoney(input.amount, '划转金额')
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  return prisma.$transaction(async tx => {
    if (idempotencyKey) {
      const existingLog = await tx.exchangeWalletLog.findUnique({
        where: { idempotencyKey },
        include: { wallet: true }
      })
      if (existingLog) {
        if (existingLog.userId !== input.userId || existingLog.type !== 'balance_transfer') {
          throw new ExchangeError('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT', '幂等键已被其他资金请求使用', 409)
        }
        return {
          wallet: serializeWallet(existingLog.wallet),
          walletLogId: existingLog.id,
          balanceLogId: existingLog.balanceLogId,
          transferredAmount: Math.abs(toNumber(existingLog.amount))
        }
      }
    }
    const policy = await getPolicy(tx)
    if (!policy.allowBalanceTransfer) {
      throw new ExchangeError('EXCHANGE_TRANSFER_DISABLED', '当前不允许交易所余额划转到账户余额')
    }
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { status: true }
    })
    if (!account || account.status !== 'active') {
      throw new ExchangeError('EXCHANGE_ACCOUNT_NOT_ACTIVE', '账号状态异常，不能划转交易所余额')
    }
    const restriction = await tx.userOrderRestriction.findFirst({
      where: { userId: input.userId, status: 'active' },
      select: { id: true }
    })
    if (restriction) {
      throw new ExchangeError('EXCHANGE_ACCOUNT_RESTRICTED', '账号处于风控限制中，不能划转交易所余额')
    }
    await assertExchangeFundsRiskClear(tx, input.userId, '划转交易所余额')
    const openDisputes = await tx.exchangeDispute.count({
      where: {
        status: { in: activeDisputeStatuses },
        order: {
          OR: [
            { buyerUserId: input.userId },
            { sellerUserId: input.userId }
          ]
        }
      }
    })
    if (openDisputes > 0) {
      throw new ExchangeError('EXCHANGE_HAS_OPEN_DISPUTE', '存在未完结争议，不能划转交易所余额')
    }
    const walletLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)
    if (!walletLocked) {
      throw new ExchangeError('EXCHANGE_WALLET_BUSY', '交易所余额正在处理，请稍后重试')
    }
    const wallet = await tx.exchangeWallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId }
    })
    const availableBefore = toNumber(wallet.availableAmount)
    if (availableBefore < amount) {
      throw new ExchangeError('EXCHANGE_WALLET_NOT_ENOUGH', '交易所余额不足')
    }
    const availableAfter = Number((availableBefore - amount).toFixed(2))
    const debitedWallet = await tx.exchangeWallet.updateMany({
      where: { id: wallet.id, availableAmount: { gte: amount } },
      data: { availableAmount: { decrement: amount } }
    })
    if (debitedWallet.count !== 1) {
      throw new ExchangeError('EXCHANGE_WALLET_NOT_ENOUGH', '交易所余额不足')
    }
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { balance: true }
    })
    if (!user) throw new ExchangeError('EXCHANGE_USER_NOT_FOUND', '用户不存在', 404)
    const balanceBefore = toNumber(user.balance)
    const balanceAfter = Number((balanceBefore + amount).toFixed(2))
    await tx.user.update({
      where: { id: input.userId },
      data: { balance: { increment: amount } }
    })
    const balanceLog = await tx.balanceLog.create({
      data: {
        userId: input.userId,
        type: 'exchange_transfer',
        amount,
        balanceBefore,
        balanceAfter,
        remark: '交易所余额划转到账户余额'
      }
    })
	    const walletLog = await tx.exchangeWalletLog.create({
	      data: {
	        walletId: wallet.id,
        userId: input.userId,
        type: 'balance_transfer',
        amount: -amount,
        availableBefore,
        availableAfter,
        frozenBefore: wallet.frozenAmount,
        frozenAfter: wallet.frozenAmount,
        balanceLogId: balanceLog.id,
        idempotencyKey,
	        remark: '划转到账户余额'
	      }
	    })
	    await tx.exchangeAuditLog.create({
	      data: {
	        actorUserId: input.userId,
	        action: 'wallet.balance_transfer',
	        targetType: 'exchange_wallet_log',
	        targetId: walletLog.id,
	        detail: {
	          amount,
	          balanceLogId: balanceLog.id,
	          availableBefore,
	          availableAfter
	        }
	      }
	    })
	    const updatedWallet = await tx.exchangeWallet.findUniqueOrThrow({
	      where: { id: wallet.id }
	    })
    return {
      wallet: serializeWallet(updatedWallet),
      walletLogId: walletLog.id,
      balanceLogId: balanceLog.id,
      transferredAmount: amount
    }
  })
}

export async function createExchangeWithdrawal(input: WithdrawalInput) {
  const amount = normalizeMoney(input.amount, '提现金额')
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const method = normalizeOptionalText(input.method, 64)
  const rawAccount = input.accountSnapshot?.account
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 200) : ''
  if (!method) {
    throw new ExchangeError('EXCHANGE_WITHDRAWAL_METHOD_REQUIRED', '必须填写提现方式')
  }
  if (!account) {
    throw new ExchangeError('EXCHANGE_WITHDRAWAL_ACCOUNT_REQUIRED', '必须填写收款账号')
  }
  const accountSnapshot = {
    ...(input.accountSnapshot || {}),
    account
  }
  return prisma.$transaction(async tx => {
    if (idempotencyKey) {
      const existing = await tx.exchangeWithdrawal.findUnique({
        where: { idempotencyKey }
      })
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new ExchangeError('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT', '幂等键已被其他提现请求使用', 409)
        }
        return serializeWithdrawal(existing)
      }
    }
    const policy = await getPolicy(tx)
    if (amount < toNumber(policy.minWithdrawalAmount)) {
      throw new ExchangeError('EXCHANGE_WITHDRAWAL_TOO_LOW', `提现金额不能低于 ¥${toNumber(policy.minWithdrawalAmount).toFixed(2)}`)
    }
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { status: true }
    })
    if (!account || account.status !== 'active') {
      throw new ExchangeError('EXCHANGE_ACCOUNT_NOT_ACTIVE', '账号状态异常，不能提现')
    }
    const restriction = await tx.userOrderRestriction.findFirst({
      where: { userId: input.userId, status: 'active' },
      select: { id: true }
    })
    if (restriction) {
      throw new ExchangeError('EXCHANGE_ACCOUNT_RESTRICTED', '账号处于风控限制中，不能提现')
    }
    await assertExchangeFundsRiskClear(tx, input.userId, '提现')
    const openDisputes = await tx.exchangeDispute.count({
      where: {
        status: { in: activeDisputeStatuses },
        order: {
          OR: [
            { buyerUserId: input.userId },
            { sellerUserId: input.userId }
          ]
        }
      }
    })
    if (openDisputes > 0) {
      throw new ExchangeError('EXCHANGE_HAS_OPEN_DISPUTE', '存在未完结争议，不能提现')
    }
    const unsettledSales = await tx.exchangeOrder.count({
      where: {
        sellerUserId: input.userId,
        status: { in: ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review'] }
      }
    })
    if (unsettledSales > 0) {
      throw new ExchangeError('EXCHANGE_WITHDRAWAL_HAS_UNSETTLED_SALE', '存在未结算交易或确认期未结束，不能提现')
    }
    const today = startOfLocalDay()
    const dailyCount = await tx.exchangeWithdrawal.count({
      where: {
        userId: input.userId,
        createdAt: { gte: today },
        status: { in: ['pending', 'approved', 'paying', 'completed'] }
      }
    })
    if (dailyCount >= policy.dailyWithdrawalCountLimit) {
      throw new ExchangeError('EXCHANGE_WITHDRAWAL_DAILY_COUNT_LIMIT', '已达到今日提现次数上限')
    }
    if (policy.dailyWithdrawalLimit !== null) {
      const aggregate = await tx.exchangeWithdrawal.aggregate({
        where: {
          userId: input.userId,
          createdAt: { gte: today },
          status: { in: ['pending', 'approved', 'paying', 'completed'] }
        },
        _sum: { amount: true }
      })
      const dailyUsed = toNumber(aggregate._sum.amount)
      if (dailyUsed + amount > toNumber(policy.dailyWithdrawalLimit)) {
        throw new ExchangeError('EXCHANGE_WITHDRAWAL_DAILY_AMOUNT_LIMIT', '已超过今日提现金额上限')
      }
    }
    const walletLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)
    if (!walletLocked) {
      throw new ExchangeError('EXCHANGE_WALLET_BUSY', '交易所余额正在处理，请稍后重试')
    }
    const wallet = await tx.exchangeWallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId }
    })
    const availableBefore = toNumber(wallet.availableAmount)
    const frozenBefore = toNumber(wallet.frozenAmount)
    if (availableBefore < amount) {
      throw new ExchangeError('EXCHANGE_WALLET_NOT_ENOUGH', '交易所余额不足')
    }
    const availableAfter = Number((availableBefore - amount).toFixed(2))
    const frozenAfter = Number((frozenBefore + amount).toFixed(2))
    const withdrawal = await tx.exchangeWithdrawal.create({
      data: {
        withdrawalNo: `EW${exchangeWithdrawalNo()}`,
        walletId: wallet.id,
        userId: input.userId,
        amount,
        status: 'pending',
        method,
        accountSnapshot: toInputJson(accountSnapshot),
        applicantRemark: normalizeOptionalText(input.applicantRemark, 500),
        idempotencyKey
      }
    })
    const frozen = await tx.exchangeWallet.updateMany({
      where: { id: wallet.id, availableAmount: { gte: amount } },
      data: {
        availableAmount: { decrement: amount },
        frozenAmount: { increment: amount }
      }
    })
    if (frozen.count !== 1) {
      throw new ExchangeError('EXCHANGE_WALLET_NOT_ENOUGH', '交易所余额不足')
    }
    const log = await tx.exchangeWalletLog.create({
      data: {
        walletId: wallet.id,
        userId: input.userId,
        type: 'withdrawal_freeze',
        amount: -amount,
        availableBefore,
        availableAfter,
        frozenBefore,
        frozenAfter,
        withdrawalId: withdrawal.id,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:freeze` : null,
        remark: '提交交易所提现申请，资金冻结待人工审核'
      }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'withdrawal.create',
        targetType: 'exchange_withdrawal',
        targetId: withdrawal.id,
        detail: { amount, walletLogId: log.id }
      }
    })
    return serializeWithdrawal(withdrawal)
  })
}

export async function listExchangeWithdrawals(userId: number, options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const where = { userId }
  const [items, total] = await Promise.all([
    prisma.exchangeWithdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.exchangeWithdrawal.count({ where })
  ])
  return {
    items: items.map(serializeWithdrawal),
    total,
    page,
    pageSize
  }
}

export async function listUserExchangeOrders(userId: number, role: 'buyer' | 'seller', options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const where = role === 'buyer' ? { buyerUserId: userId } : { sellerUserId: userId }
  const [items, total] = await Promise.all([
    prisma.exchangeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { deliveryTasks: { orderBy: { createdAt: 'desc' }, take: 1 } }
    }),
    prisma.exchangeOrder.count({ where })
  ])
  return {
    items: items.map(item => serializeOrder(item, item.deliveryTasks[0] || null, role)),
    total,
    page,
    pageSize
  }
}

export async function getUserExchangeOrder(userId: number, orderId: number) {
  const order = await prisma.exchangeOrder.findFirst({
    where: {
      id: orderId,
      OR: [
        { buyerUserId: userId },
        { sellerUserId: userId }
      ]
    },
    include: { deliveryTasks: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })
  if (!order) {
    throw new ExchangeError('EXCHANGE_ORDER_NOT_FOUND', '交易订单不存在或无权查看', 404)
  }
  const viewerRole = order.buyerUserId === userId ? 'buyer' : 'seller'
  return {
    order: serializeOrder(order, order.deliveryTasks[0] || null, viewerRole)
  }
}

export async function createExchangeDispute(userId: number, orderId: number, reason: string, detail?: string | null, idempotencyKeyInput?: string | null) {
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput)
  const normalizedReason = reason.trim().slice(0, 100)
  if (!normalizedReason) {
    throw new ExchangeError('EXCHANGE_DISPUTE_REASON_REQUIRED', '必须填写争议原因')
  }
  const normalizedDetail = normalizeOptionalText(detail, 1000)
  return prisma.$transaction(async tx => {
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)
    if (!orderLocked) {
      throw new ExchangeError('EXCHANGE_ORDER_BUSY', '交易订单正在处理，请稍后重试', 409)
    }
    if (idempotencyKey) {
      const existing = await tx.exchangeDispute.findUnique({
        where: { idempotencyKey }
      })
      if (existing) {
        if (existing.creatorUserId !== userId || existing.orderId !== orderId) {
          throw new ExchangeError('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT', '幂等键已被其他争议请求使用', 409)
        }
        return {
          id: existing.id,
          orderId: existing.orderId,
          status: existing.status,
          reason: existing.reason,
          detail: existing.detail,
          createdAt: existing.createdAt.toISOString()
        }
      }
    }
    assertAnonymousDisputeText(normalizedReason, normalizedDetail)
    const order = await tx.exchangeOrder.findUnique({ where: { id: orderId } })
    if (!order || (order.buyerUserId !== userId && order.sellerUserId !== userId)) {
      throw new ExchangeError('EXCHANGE_ORDER_NOT_FOUND', '交易订单不存在', 404)
    }
    if (!['delivered', 'confirming', 'disputed', 'manual_review'].includes(order.status)) {
      throw new ExchangeError('EXCHANGE_DISPUTE_NOT_ALLOWED', '当前交易状态不能发起争议')
    }
    const activeDispute = await tx.exchangeDispute.findFirst({
      where: { orderId, status: { in: activeDisputeStatuses } },
      select: { id: true }
    })
    if (activeDispute) {
      throw new ExchangeError('EXCHANGE_DISPUTE_EXISTS', '该订单已有未完结争议')
    }
    const dispute = await tx.exchangeDispute.create({
      data: {
        orderId,
        creatorUserId: userId,
        reason: normalizedReason,
        detail: normalizedDetail,
        idempotencyKey
      }
    })
    const disputed = await tx.exchangeOrder.updateMany({
      where: { id: orderId, status: { in: ['delivered', 'confirming', 'disputed', 'manual_review'] } },
      data: { status: 'disputed' }
    })
    if (disputed.count !== 1) {
      throw new ExchangeError('EXCHANGE_ORDER_STATE_CHANGED', '交易订单状态已变化，请刷新后重试', 409)
    }
    const disputeFreezeLog = await createDisputeWalletLog(
      tx,
      order,
      'dispute_freeze',
      `交易所订单 ${order.orderNo} 发起争议，卖家应收托管款进入争议冻结标记`
    )
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: userId,
        action: 'dispute.freeze',
        targetType: 'exchange_order',
        targetId: order.id,
        detail: {
          disputeId: dispute.id,
          walletLogId: disputeFreezeLog.id,
          sellerReceivesAmount: toNumber(order.sellerReceivesAmount)
        }
      }
    })
    return {
      id: dispute.id,
      orderId: dispute.orderId,
      status: dispute.status,
      reason: dispute.reason,
      detail: dispute.detail,
      createdAt: dispute.createdAt.toISOString()
    }
  })
}

export async function listExchangeDisputes(userId: number, options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1))
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize || 20)), 100)
  const where = {
    order: {
      OR: [
        { buyerUserId: userId },
        { sellerUserId: userId }
      ]
    }
  }
  const [items, total] = await Promise.all([
    prisma.exchangeDispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            price: true,
            createdAt: true
          }
        }
      }
    }),
    prisma.exchangeDispute.count({ where })
  ])
  return {
    items: items.map(item => ({
      id: item.id,
      orderId: item.orderId,
      orderNo: item.order.orderNo,
      orderStatus: item.order.status,
      orderPrice: toNumber(item.order.price),
      status: item.status,
      reason: item.reason,
      detail: item.detail,
      resolution: item.resolution,
      createdAt: item.createdAt.toISOString(),
      resolvedAt: toDateIso(item.resolvedAt)
    })),
    total,
    page,
    pageSize
  }
}

function serializeWallet(wallet: {
  id: number
  userId: number
  availableAmount: Prisma.Decimal
  frozenAmount: Prisma.Decimal
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: wallet.id,
    availableAmount: toNumber(wallet.availableAmount),
    frozenAmount: toNumber(wallet.frozenAmount),
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString()
  }
}

function serializeWalletLog(log: {
  id: number
  type: string
  amount: Prisma.Decimal
  availableBefore: Prisma.Decimal
  availableAfter: Prisma.Decimal
  frozenBefore: Prisma.Decimal
  frozenAfter: Prisma.Decimal
  orderId: number | null
  withdrawalId: number | null
  balanceLogId: number | null
  remark: string | null
  createdAt: Date
}) {
  return {
    id: log.id,
    type: log.type,
    amount: toNumber(log.amount),
    availableBefore: toNumber(log.availableBefore),
    availableAfter: toNumber(log.availableAfter),
    frozenBefore: toNumber(log.frozenBefore),
    frozenAfter: toNumber(log.frozenAfter),
    orderId: log.orderId,
    withdrawalId: log.withdrawalId,
    balanceLogId: log.balanceLogId,
    remark: log.remark,
    createdAt: log.createdAt.toISOString()
  }
}

function serializeListing(listing: {
  id: number
  instanceId: number
  sellerUserId: number
  status: ExchangeListingStatus
  price: Prisma.Decimal
  feeAmount: Prisma.Decimal
  sellerReceivesAmount: Prisma.Decimal
  description: string | null
  autoDelistAt: Date | null
  snapshot: Prisma.JsonValue
  eligibilitySnapshot: Prisma.JsonValue
  createdAt: Date
  updatedAt: Date
  delistedAt: Date | null
}) {
  return {
    id: listing.id,
    publicCode: `EX-L${listing.id.toString().padStart(6, '0')}`,
    instanceId: listing.instanceId,
    status: listing.status,
    price: toNumber(listing.price),
    feeAmount: toNumber(listing.feeAmount),
    sellerReceivesAmount: toNumber(listing.sellerReceivesAmount),
    description: listing.description,
    autoDelistAt: toDateIso(listing.autoDelistAt),
    instance: listing.snapshot,
    snapshot: listing.snapshot,
    eligibilitySnapshot: listing.eligibilitySnapshot,
    deliveryMode: 'reinstall_required',
    privacyMode: 'anonymous',
    listedAt: listing.createdAt.toISOString(),
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    delistedAt: toDateIso(listing.delistedAt),
    soldAt: null
  }
}

function serializePublicListing(listing: Parameters<typeof serializeListing>[0]) {
  const serialized = serializeListing(listing)
  const {
    instanceId: _instanceId,
    eligibilitySnapshot: _eligibilitySnapshot,
    instance: _instance,
    snapshot: _snapshot,
    sellerReceivesAmount: _sellerReceivesAmount,
    ...publicListing
  } = serialized
  const publicSnapshot = sanitizePublicInstanceSnapshot(serialized.snapshot as Prisma.JsonValue)
  return {
    ...publicListing,
    instance: publicSnapshot,
    snapshot: publicSnapshot
  }
}

function serializeOrder(order: {
  id: number
  orderNo: string
  listingId: number
  instanceId: number
  buyerUserId: number
  sellerUserId: number
  status: ExchangeOrderStatus
  price: Prisma.Decimal
  feeAmount: Prisma.Decimal
  sellerReceivesAmount: Prisma.Decimal
  escrowAmount: Prisma.Decimal
  confirmationDueAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  failureReason: string | null
  snapshot: Prisma.JsonValue
  createdAt: Date
  updatedAt: Date
}, deliveryTask?: {
  id: number
  status: string
  step: string | null
  progress: Prisma.JsonValue
  imageAlias?: string | null
  sshKeyId?: number | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
} | null, viewerRole: 'buyer' | 'seller' = 'buyer') {
  const canViewBuyerDeliveryPreference = viewerRole === 'buyer'
  const visibleSnapshot = sanitizePublicInstanceSnapshot(order.snapshot)
  return {
    id: order.id,
    orderNo: order.orderNo,
    listingId: order.listingId,
    instanceId: order.instanceId,
    status: order.status,
    price: toNumber(order.price),
    feeAmount: toNumber(order.feeAmount),
    ...(viewerRole === 'seller' ? { sellerReceivesAmount: toNumber(order.sellerReceivesAmount) } : {}),
    escrowAmount: toNumber(order.escrowAmount),
    confirmationDueAt: toDateIso(order.confirmationDueAt),
    completedAt: toDateIso(order.completedAt),
    cancelledAt: toDateIso(order.cancelledAt),
    failureReason: order.failureReason,
    instance: visibleSnapshot,
    snapshot: visibleSnapshot,
    deliveryMode: 'reinstall_required',
    privacyMode: 'anonymous',
    deliveryTask: deliveryTask ? {
      id: deliveryTask.id,
      status: deliveryTask.status,
      step: deliveryTask.step,
      progress: deliveryTask.progress,
      imageAlias: canViewBuyerDeliveryPreference ? deliveryTask.imageAlias || null : null,
      sshKeyId: canViewBuyerDeliveryPreference ? deliveryTask.sshKeyId || null : null,
      error: deliveryTask.error,
      createdAt: deliveryTask.createdAt.toISOString(),
      startedAt: toDateIso(deliveryTask.startedAt),
      finishedAt: toDateIso(deliveryTask.finishedAt)
    } : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  }
}

function serializeWithdrawal(withdrawal: {
  id: number
  withdrawalNo: string
  amount: Prisma.Decimal
  status: string
  method: string | null
  applicantRemark: string | null
  reviewRemark: string | null
  proofUrl: string | null
  createdAt: Date
  updatedAt: Date
  reviewedAt: Date | null
  completedAt: Date | null
}) {
  return {
    id: withdrawal.id,
    withdrawalNo: withdrawal.withdrawalNo,
    amount: toNumber(withdrawal.amount),
    status: withdrawal.status,
    method: withdrawal.method,
    applicantRemark: withdrawal.applicantRemark,
    reviewRemark: withdrawal.reviewRemark,
    proofUrl: withdrawal.proofUrl,
    createdAt: withdrawal.createdAt.toISOString(),
    updatedAt: withdrawal.updatedAt.toISOString(),
    reviewedAt: toDateIso(withdrawal.reviewedAt),
    completedAt: toDateIso(withdrawal.completedAt)
  }
}
