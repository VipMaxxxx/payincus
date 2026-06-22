/**
 * 管理员计费相关路由
 */

import { FastifyInstance } from 'fastify'
import { Prisma, type InstanceStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { sendNotification } from '../lib/notifier.js'
import { createEpayClient, type EpayConfig, type EpayConfigV1, type EpayConfigV2, type EpayVersion } from '../lib/epay.js'
import {
  buildHeleketConfig,
  createHeleketClient,
  extractHeleketStatus,
  getHeleketInvoiceAmount,
  getHeleketPaymentState,
  getHeleketStatusDescription
} from '../lib/heleket.js'
import {
  extractRechargePaymentDisplayInfo,
  getRechargePayableAmount,
  mergeHeleketPaymentDetails
} from '../lib/recharge-payment-details.js'
import { resolveRechargeProviderConfigSnapshot } from '../lib/recharge-provider-snapshot.js'
import { createInboxMessage } from '../db/inbox.js'
import { getTodayRange, getThisMonthStart, getLastMonthRange } from '../lib/timezone.js'
import { validateName, encryptSensitiveData } from '../lib/security.js'
import { generateIncusConfig, generateRandomPassword } from '../lib/incus-config-generator.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import {
  getSystemImageAvailabilityForHost,
  isImageCompatibleWithInstanceType,
  isImageCompatibleWithMemory,
  isValidSystemImage
} from '../db/images.js'
import { sendAdminInstanceCreatedEmail, sendInstanceDestroyRefundEmail } from '../lib/mailer.js'
import { generateRandomIPv4, generateRandomIPv6 } from '../lib/ip-calculator.js'
import { validateCommandsOwnership, mergeCommandContents, getImageDistroFromAlias } from '../db/custom-init-commands.js'
import { customAlphabet } from 'nanoid'
import { buildInstanceConfig, getIncusClient, createInstance, deleteInstance, startInstance, stopInstance, getInstanceState } from '../lib/incus/index.js'
import { calculateCreateBilling, getMaxRefundable } from '../db/billing-operations.js'
import { shouldSyncInstanceSwapSizeWithPlan } from '../lib/instance-swap.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { normalizePlanTrafficLimitSpeed } from '../services/traffic-bandwidth.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'
import type { Host } from '../types/database.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { sanitizeObject } from '../lib/log-sanitizer.js'

// 自定义 nanoid，只使用小写字母和数字
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
const BILLING_RECORD_TYPES = new Set(['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'])
const INSTANCE_STATUSES = new Set(['creating', 'running', 'stopped', 'suspended', 'error', 'deleted'])
const RECHARGE_STATUSES = new Set(['pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded'])

interface RechargeAggregateRow {
  amount: unknown
  count: unknown
}

function getRechargeAggregate(row: RechargeAggregateRow[] | undefined): { amount: number; count: number } {
  const first = row?.[0]
  return {
    amount: first?.amount === null || first?.amount === undefined ? 0 : parseFloat(String(first.amount)) || 0,
    count: first?.count === null || first?.count === undefined ? 0 : Number(first.count) || 0
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return max === undefined ? parsed : Math.min(parsed, max)
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeStringFilter(value: string | undefined, allowedValues: Set<string>): string | undefined {
  return value !== undefined && allowedValues.has(value) ? value : undefined
}

async function claimInstanceForAdminDelete(instanceId: number, currentStatus: InstanceStatus): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    if (!locked) return false

    const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
      tx.restoreTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.instanceTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeRestoreTask || activeUploadTask || activeInstanceTask) return false

    const result = await tx.instance.updateMany({
      where: {
        id: instanceId,
        status: currentStatus
      },
      data: { status: 'deleted' }
    })

    return result.count === 1
  })
}

// ==================== 易支付辅助函数 ====================

/**
 * 根据配置构建易支付客户端配置
 */
function buildEpayConfig(config: Record<string, unknown>): { epayConfig: EpayConfig; valid: boolean; error?: string } {
  const version = (config.version as EpayVersion) || 'v2'

  if (version === 'v1') {
    const v1Config: EpayConfigV1 = {
      version: 'v1',
      apiurl: config.apiurl as string || '',
      pid: config.pid as string || '',
      key: config.key as string || ''
    }

    if (!v1Config.apiurl || !v1Config.pid || !v1Config.key) {
      return { epayConfig: v1Config, valid: false, error: '支付渠道配置不完整' }
    }

    return { epayConfig: v1Config, valid: true }
  } else {
    const v2Config: EpayConfigV2 = {
      version: 'v2',
      apiurl: config.apiurl as string || '',
      pid: config.pid as string || '',
      platform_public_key: config.platform_public_key as string || '',
      merchant_private_key: config.merchant_private_key as string || ''
    }

    if (!v2Config.apiurl || !v2Config.pid || !v2Config.platform_public_key || !v2Config.merchant_private_key) {
      return { epayConfig: v2Config, valid: false, error: '支付渠道配置不完整' }
    }

    return { epayConfig: v2Config, valid: true }
  }
}

/**
 * 生成唯一的 tradeNo 标识（用于联合索引）
 * 当 tradeNo 为空时，使用基于订单号的确定性标识，确保重复同步能命中同一唯一索引
 */
function getTradeNoForIndex(orderNo: string, tradeNo: string | null | undefined): string {
  if (tradeNo && tradeNo.trim()) {
    return tradeNo.trim()
  }
  return `__NO_TRADE_NO__${orderNo}`
}

function resolveRechargeProviderConfig(
  providerType: string,
  currentConfig: Record<string, unknown>,
  snapshotValue: unknown
): { config: Record<string, unknown>; source: 'snapshot' | 'provider' } {
  return resolveRechargeProviderConfigSnapshot(providerType, currentConfig, snapshotValue)
}

// ==================== 辅助函数 ====================

/**
 * 计算月均价格
 */
function calculateMonthlyPrice(billingPrice: number, billingCycle: number | null): number {
  const cycle = billingCycle || 1
  return Number((billingPrice / cycle).toFixed(2))
}

/**
 * 计算日均价格
 */
function calculateDailyPrice(billingPrice: number, billingCycle: number | null): number {
  const monthlyPrice = calculateMonthlyPrice(billingPrice, billingCycle)
  return Number((monthlyPrice / 30).toFixed(2))
}

const MAX_BATCH_PRICE_UPDATE_INSTANCES = 100

type BatchPriceUpdateItemStatus = 'ready' | 'unchanged' | 'failed'

interface BatchPriceUpdateItem {
  id: number
  name: string | null
  user: { id: number; username: string; balance: number } | null
  oldPrice: number | null
  newPrice: number
  billingCycle: number | null
  remainingDays: number
  priceDiff: number
  discountRate: number
  status: BatchPriceUpdateItemStatus
  error?: string
  instanceVersion?: number
}

interface BatchPriceUpdateExpectation {
  instanceId: number
  version: number
}

interface BatchPriceUpdateUserImpact {
  userId: number
  username: string
  balanceBefore: number
  balanceAfter: number
  totalCharge: number
  totalRefund: number
  netDiff: number
  insufficientBalance: boolean
}

interface BatchPriceUpdatePreview {
  summary: {
    selectedCount: number
    validCount: number
    changedCount: number
    unchangedCount: number
    failedCount: number
    totalCharge: number
    totalRefund: number
    netAmount: number
  }
  canSubmit: boolean
  items: BatchPriceUpdateItem[]
  userImpacts: BatchPriceUpdateUserImpact[]
}

class BatchPriceUpdateError extends Error {
  statusCode: number
  preview?: BatchPriceUpdatePreview

  constructor(message: string, statusCode = 400, preview?: BatchPriceUpdatePreview) {
    super(message)
    this.name = 'BatchPriceUpdateError'
    this.statusCode = statusCode
    this.preview = preview
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function parseBatchPriceUpdateBody(body: unknown): { instanceIds: number[]; newPrice: number; settleBalance: boolean; expectations: BatchPriceUpdateExpectation[] } {
  if (!body || typeof body !== 'object') {
    throw new BatchPriceUpdateError('请求参数无效')
  }

  const input = body as { instanceIds?: unknown; newPrice?: unknown; settleBalance?: unknown; expectations?: unknown }
  const { instanceIds, newPrice, settleBalance, expectations } = input

  if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
    throw new BatchPriceUpdateError('请选择要修改价格的实例')
  }

  if (instanceIds.length > MAX_BATCH_PRICE_UPDATE_INSTANCES) {
    throw new BatchPriceUpdateError(`单次最多只能修改 ${MAX_BATCH_PRICE_UPDATE_INSTANCES} 个实例`)
  }

  const ids: number[] = []
  for (const rawId of instanceIds) {
    const id = typeof rawId === 'number' ? rawId : Number(rawId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new BatchPriceUpdateError('实例ID列表包含无效值')
    }
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }

  if (ids.length === 0) {
    throw new BatchPriceUpdateError('请选择要修改价格的实例')
  }

  if (typeof newPrice !== 'number' || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 100000) {
    throw new BatchPriceUpdateError('价格必须是 0-100000 之间的数字')
  }

  const parsedExpectations: BatchPriceUpdateExpectation[] = []
  if (expectations !== undefined) {
    if (!Array.isArray(expectations)) {
      throw new BatchPriceUpdateError('预览版本参数无效')
    }

    const expectedIdSet = new Set(ids)
    for (const rawExpectation of expectations) {
      if (!rawExpectation || typeof rawExpectation !== 'object') {
        throw new BatchPriceUpdateError('预览版本参数无效')
      }

      const expectation = rawExpectation as { instanceId?: unknown; version?: unknown }
      const instanceId = typeof expectation.instanceId === 'number'
        ? expectation.instanceId
        : Number(expectation.instanceId)
      const version = typeof expectation.version === 'number'
        ? expectation.version
        : Number(expectation.version)

      if (!Number.isInteger(instanceId) || !expectedIdSet.has(instanceId) || !Number.isInteger(version) || version < 0) {
        throw new BatchPriceUpdateError('预览版本参数无效')
      }

      if (!parsedExpectations.some(item => item.instanceId === instanceId)) {
        parsedExpectations.push({ instanceId, version })
      }
    }
  }

  return {
    instanceIds: ids,
    newPrice: roundMoney(newPrice),
    settleBalance: settleBalance !== false,
    expectations: parsedExpectations
  }
}

function summarizeBatchPriceItems(items: BatchPriceUpdateItem[], selectedCount: number): BatchPriceUpdatePreview['summary'] {
  let totalCharge = 0
  let totalRefund = 0
  let changedCount = 0
  let unchangedCount = 0
  let failedCount = 0

  for (const item of items) {
    if (item.status === 'failed') {
      failedCount += 1
      continue
    }

    if (item.status === 'unchanged') {
      unchangedCount += 1
    } else {
      changedCount += 1
    }

    if (item.priceDiff > 0) {
      totalCharge += item.priceDiff
    } else if (item.priceDiff < 0) {
      totalRefund += Math.abs(item.priceDiff)
    }
  }

  totalCharge = roundMoney(totalCharge)
  totalRefund = roundMoney(totalRefund)

  return {
    selectedCount,
    validCount: items.length - failedCount,
    changedCount,
    unchangedCount,
    failedCount,
    totalCharge,
    totalRefund,
    netAmount: roundMoney(totalCharge - totalRefund)
  }
}

function buildBatchUserImpacts(items: BatchPriceUpdateItem[]): BatchPriceUpdateUserImpact[] {
  const impactMap = new Map<number, {
    userId: number
    username: string
    balanceBefore: number
    totalCharge: number
    totalRefund: number
    netDiff: number
  }>()

  for (const item of items) {
    if (item.status === 'failed' || !item.user || item.priceDiff === 0) continue

    const existing = impactMap.get(item.user.id) || {
      userId: item.user.id,
      username: item.user.username,
      balanceBefore: item.user.balance,
      totalCharge: 0,
      totalRefund: 0,
      netDiff: 0
    }

    if (item.priceDiff > 0) {
      existing.totalCharge += item.priceDiff
    } else if (item.priceDiff < 0) {
      existing.totalRefund += Math.abs(item.priceDiff)
    }
    existing.netDiff += item.priceDiff

    impactMap.set(item.user.id, existing)
  }

  return Array.from(impactMap.values()).map(impact => {
    const totalCharge = roundMoney(impact.totalCharge)
    const totalRefund = roundMoney(impact.totalRefund)
    const netDiff = roundMoney(impact.netDiff)
    const balanceAfter = roundMoney(impact.balanceBefore - netDiff)

    return {
      userId: impact.userId,
      username: impact.username,
      balanceBefore: roundMoney(impact.balanceBefore),
      balanceAfter,
      totalCharge,
      totalRefund,
      netDiff,
      insufficientBalance: balanceAfter < -0.0001
    }
  }).sort((a, b) => a.username.localeCompare(b.username))
}

async function buildBatchPriceUpdatePreview(
  client: typeof prisma | Prisma.TransactionClient,
  instanceIds: number[],
  newPrice: number,
  settleBalance: boolean
): Promise<BatchPriceUpdatePreview> {
  const instances = await client.instance.findMany({
    where: { id: { in: instanceIds } },
    include: {
      user: { select: { id: true, username: true, balance: true } }
    }
  })
  const instanceMap = new Map(instances.map(instance => [instance.id, instance]))
  const items: BatchPriceUpdateItem[] = []

  for (const instanceId of instanceIds) {
    const instance = instanceMap.get(instanceId)

    if (!instance) {
      items.push({
        id: instanceId,
        name: null,
        user: null,
        oldPrice: null,
        newPrice,
        billingCycle: null,
        remainingDays: 0,
        priceDiff: 0,
        discountRate: 0,
        status: 'failed',
        error: '实例不存在'
      })
      continue
    }

    const user = instance.user
      ? {
          id: instance.user.id,
          username: instance.user.username,
          balance: Number(instance.user.balance) || 0
        }
      : null
    const oldPrice = Number(instance.billingPrice) || 0

    if (instance.status === 'deleted') {
      items.push({
        id: instance.id,
        name: instance.name,
        user,
        oldPrice,
        newPrice,
        billingCycle: instance.billingCycle,
        remainingDays: 0,
        priceDiff: 0,
        discountRate: 0,
        status: 'failed',
        error: '实例已删除'
      })
      continue
    }

    if (!instance.packagePlanId) {
      items.push({
        id: instance.id,
        name: instance.name,
        user,
        oldPrice,
        newPrice,
        billingCycle: instance.billingCycle,
        remainingDays: 0,
        priceDiff: 0,
        discountRate: 0,
        status: 'failed',
        error: '免费实例不支持修改价格'
      })
      continue
    }

    const quote = await db.calculateInstancePriceAdjustmentQuote(
      instance,
      newPrice,
      settleBalance,
      '$transaction' in client ? undefined : client
    )
    items.push({
      id: instance.id,
      name: instance.name,
      user,
      oldPrice: quote.oldPrice,
      newPrice: quote.newPrice,
      billingCycle: quote.billingCycle,
      remainingDays: quote.remainingDays,
      priceDiff: quote.priceDiff,
      discountRate: quote.discountRate,
      status: quote.oldPrice === quote.newPrice ? 'unchanged' : 'ready',
      instanceVersion: instance.version
    })
  }

  const summary = summarizeBatchPriceItems(items, instanceIds.length)
  const userImpacts = buildBatchUserImpacts(items)
  const canSubmit = summary.validCount > 0 &&
    summary.failedCount === 0 &&
    !userImpacts.some(impact => impact.insufficientBalance)

  return {
    summary,
    canSubmit,
    items,
    userImpacts
  }
}

export default async function adminBillingRoutes(app: FastifyInstance): Promise<void> {
  // ==================== 计费概览 ====================

  // GET /api/admin/billing/overview - 计费概览
  app.get('/api/admin/billing/overview', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      // 使用业务时区（Asia/Shanghai）计算日期边界
      const { start: today, end: tomorrow } = getTodayRange()
      const thisMonthStart = getThisMonthStart()
      const { start: lastMonthStart, end: lastMonthEnd } = getLastMonthRange()
      const now = new Date()
      const revenueTypes: Array<'newPurchase' | 'renew' | 'upgrade' | 'transfer_fee'> = ['newPurchase', 'renew', 'upgrade', 'transfer_fee']
      const expiringDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const revenueBaseWhere: Prisma.InstanceBillingRecordWhereInput = {
        type: { in: revenueTypes }
      }
      const directRevenueWhere: Prisma.InstanceBillingRecordWhereInput = {
        ...revenueBaseWhere,
        instance: {
          is: {
            host: {
              is: {
                user: {
                  is: {
                    role: 'admin'
                  }
                }
              }
            }
          }
        }
      }
      const hostedRevenueWhere: Prisma.InstanceBillingRecordWhereInput = {
        ...revenueBaseWhere,
        instance: {
          is: {
            host: {
              is: {
                user: {
                  is: {
                    role: { not: 'admin' }
                  }
                }
              }
            }
          }
        }
      }

      const [
        totalRevenue,
        thisMonthRevenue,
        lastMonthRevenue,
        todayRevenue,
        totalDirectRevenue,
        totalHostedRevenue,
        thisMonthDirectRevenue,
        thisMonthHostedRevenue,
        todayDirectRevenue,
        todayHostedRevenue,
        totalRefunds,
        paidInstancesCount,
        activePaidInstancesCount,
        suspendedCount,
        expiringCount,
        rechargeStats,
        thisMonthRecharge,
        todayRecharge,
        affStats,
        thisMonthAff,
        affConverted,
        affPendingConvert
      ] = await prisma.$transaction([
        prisma.instanceBillingRecord.aggregate({
          where: revenueBaseWhere,
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...revenueBaseWhere,
            createdAt: { gte: thisMonthStart }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...revenueBaseWhere,
            createdAt: { gte: lastMonthStart, lte: lastMonthEnd }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...revenueBaseWhere,
            createdAt: { gte: today, lt: tomorrow }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: directRevenueWhere,
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: hostedRevenueWhere,
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...directRevenueWhere,
            createdAt: { gte: thisMonthStart }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...hostedRevenueWhere,
            createdAt: { gte: thisMonthStart }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...directRevenueWhere,
            createdAt: { gte: today, lt: tomorrow }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: {
            ...hostedRevenueWhere,
            createdAt: { gte: today, lt: tomorrow }
          },
          _sum: { amount: true }
        }),
        prisma.instanceBillingRecord.aggregate({
          where: { type: 'refund' },
          _sum: { amount: true }
        }),
        prisma.instance.count({
          where: {
            packagePlanId: { not: null },
            status: { notIn: ['deleted'] }
          }
        }),
        prisma.instance.count({
          where: {
            packagePlanId: { not: null },
            status: { notIn: ['deleted', 'suspended'] },
            expiresAt: { gt: now }
          }
        }),
        prisma.instance.count({
          where: {
            packagePlanId: { not: null },
            status: 'suspended'
          }
        }),
        prisma.instance.count({
          where: {
            packagePlanId: { not: null },
            expiresAt: {
              not: null,
              gt: now,
              lte: expiringDeadline
            },
            status: { notIn: ['deleted', 'suspended'] }
          }
        }),
        prisma.$queryRaw<RechargeAggregateRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS amount,
                 COUNT(*)::int AS count
          FROM recharge_records
          WHERE status = 'completed'
        `),
        prisma.$queryRaw<RechargeAggregateRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS amount,
                 COUNT(*)::int AS count
          FROM recharge_records
          WHERE status = 'completed'
            AND created_at >= ${thisMonthStart}
        `),
        prisma.$queryRaw<RechargeAggregateRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS amount,
                 COUNT(*)::int AS count
          FROM recharge_records
          WHERE status = 'completed'
            AND created_at >= ${today}
            AND created_at < ${tomorrow}
        `),
        prisma.affLog.aggregate({
          where: { type: { in: ['new_purchase', 'renew'] } },
          _sum: { amount: true },
          _count: { id: true }
        }),
        prisma.affLog.aggregate({
          where: {
            type: { in: ['new_purchase', 'renew'] },
            createdAt: { gte: thisMonthStart }
          },
          _sum: { amount: true }
        }),
        prisma.affWithdrawal.aggregate({
          where: { status: 'approved' },
          _sum: { amount: true }
        }),
        prisma.affWithdrawal.count({
          where: { status: 'pending' }
        })
      ])

      // 辅助函数：安全转换 Prisma Decimal 为数字
      const toNumber = (val: unknown): number => {
        if (val === null || val === undefined) return 0
        return parseFloat(String(val))
      }

      const rechargeTotal = getRechargeAggregate(rechargeStats)
      const rechargeThisMonth = getRechargeAggregate(thisMonthRecharge)
      const rechargeToday = getRechargeAggregate(todayRecharge)

      return {
        overview: {
          totalRevenue: toNumber(totalRevenue._sum?.amount),
          thisMonthRevenue: toNumber(thisMonthRevenue._sum?.amount),
          lastMonthRevenue: toNumber(lastMonthRevenue._sum?.amount),
          todayRevenue: toNumber(todayRevenue._sum?.amount),
          totalRefunds: Math.abs(toNumber(totalRefunds._sum?.amount)),
          netRevenue: toNumber(totalRevenue._sum?.amount) + toNumber(totalRefunds._sum?.amount),
          paidInstancesCount,
          activePaidInstancesCount,
          suspendedCount,
          expiringCount,
          revenueMix: {
            direct: {
              totalAmount: toNumber(totalDirectRevenue._sum?.amount),
              thisMonthAmount: toNumber(thisMonthDirectRevenue._sum?.amount),
              todayAmount: toNumber(todayDirectRevenue._sum?.amount)
            },
            hosted: {
              totalAmount: toNumber(totalHostedRevenue._sum?.amount),
              thisMonthAmount: toNumber(thisMonthHostedRevenue._sum?.amount),
              todayAmount: toNumber(todayHostedRevenue._sum?.amount)
            }
          },
          // 充值统计
          recharge: {
            totalAmount: rechargeTotal.amount,
            totalCount: rechargeTotal.count,
            thisMonthAmount: rechargeThisMonth.amount,
            thisMonthCount: rechargeThisMonth.count,
            todayAmount: rechargeToday.amount,
            todayCount: rechargeToday.count
          },
          // AFF 返利统计
          aff: {
            totalCommission: toNumber(affStats._sum?.amount),
            totalOrders: affStats._count?.id || 0,
            thisMonthCommission: toNumber(thisMonthAff._sum?.amount),
            totalConverted: toNumber(affConverted._sum?.amount),
            pendingConvertCount: affPendingConvert
          }
        }
      }
    } catch (error) {
      request.log.error(error, '获取计费概览失败')
      return reply.status(500).send({ error: '获取计费概览失败' })
    }
  })

  // GET /api/admin/billing/records - 所有扣费记录
  app.get('/api/admin/billing/records', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { page, pageSize, type, userId, instanceId } = request.query as {
        page?: string
        pageSize?: string
        type?: string
        userId?: string
        instanceId?: string
      }

      const pageNum = parsePositiveInteger(page, 1)
      const size = parsePositiveInteger(pageSize, 20, 100)
      const skip = (pageNum - 1) * size

      const where: Record<string, unknown> = {}
      const normalizedType = normalizeStringFilter(type, BILLING_RECORD_TYPES)
      if (normalizedType) where.type = normalizedType
      const parsedUserId = parseOptionalPositiveInteger(userId)
      const parsedInstanceId = parseOptionalPositiveInteger(instanceId)
      if (parsedUserId !== undefined) where.userId = parsedUserId
      if (parsedInstanceId !== undefined) where.instanceId = parsedInstanceId

      const [records, total] = await Promise.all([
        prisma.instanceBillingRecord.findMany({
          where,
          include: {
            instance: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: size
        }),
        prisma.instanceBillingRecord.count({ where })
      ])

      // 查询用户信息
      const userIds = [...new Set(records.map(r => r.userId))]
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true }
      })
      const userMap = new Map(users.map(u => [u.id, u]))

      return {
        records: records.map(r => ({
          id: r.id,
          type: r.type,
          amount: Number(r.amount),
          months: r.months,
          periodStart: r.periodStart?.toISOString(),
          periodEnd: r.periodEnd?.toISOString(),
          remark: r.remark,
          createdAt: r.createdAt.toISOString(),
          instance: r.instance,
          user: userMap.get(r.userId) || null
        })),
        total,
        page: pageNum,
        pageSize: size
      }
    } catch (error) {
      request.log.error(error, '获取扣费记录失败')
      return reply.status(500).send({ error: '获取扣费记录失败' })
    }
  })

  // ==================== 管理员封停/解封 ====================

  // POST /api/admin/instances/:id/suspend - 管理员封停
  app.post('/api/admin/instances/:id/suspend', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const admin = request.user!
      const { id } = request.params as { id: string }
      const { reason } = request.body as { reason?: string }

      const instanceId = parsePositiveRouteId(id)
      if (!instanceId) {
        return reply.status(400).send({ error: '无效的实例ID' })
      }

      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: { user: { select: { id: true, username: true } } }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      if (instance.status === 'suspended') {
        return reply.status(400).send({ error: '实例已被封停' })
      }

      // 如果正在运行，先停止
      if (instance.status === 'running') {
        try {
          const host = await db.getHostById(instance.hostId)
          if (host) {
            const { getIncusClient, stopInstance } = await import('../lib/incus/index.js')
            const client = await getIncusClient(host)
            await stopInstance(client, instance.incusId)
          }
        } catch (err) {
          request.log.warn(err, '停止实例失败')
        }
      }

      // 更新为封停状态
      await db.suspendInstanceManually(instanceId, admin.id, reason || '管理员封停')

      await createLog(
        admin.id,
        'admin',
        'instance.admin_suspend',
        `Admin suspended instance "${instance.name}" (User: ${instance.user?.username}): ${reason || '管理员封停'}`,
        'success',
        { instanceId }
      )

      // 通知用户
      await sendNotification(instance.userId, 'instance_suspended', {
        instanceName: instance.name,
        reason: reason || '管理员封停'
      })

      return { success: true, message: '实例已封停' }
    } catch (error) {
      request.log.error(error, '封停实例失败')
      return reply.status(500).send({ error: '封停实例失败' })
    }
  })

  // POST /api/admin/instances/:id/unsuspend - 管理员解封
  app.post('/api/admin/instances/:id/unsuspend', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const admin = request.user!
      const { id } = request.params as { id: string }

      const instanceId = parsePositiveRouteId(id)
      if (!instanceId) {
        return reply.status(400).send({ error: '无效的实例ID' })
      }

      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: { user: { select: { id: true, username: true } } }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status !== 'suspended') {
        return reply.status(400).send({ error: '实例未被封停' })
      }

      // 解除封停
      await db.unsuspendInstance(instanceId)

      await createLog(
        admin.id,
        'admin',
        'instance.admin_unsuspend',
        `Admin unsuspended instance "${instance.name}" (User: ${instance.user?.username})`,
        'success',
        { instanceId }
      )

      // 通知用户
      await sendNotification(instance.userId, 'instance_unsuspended', {
        instanceName: instance.name
      })

      return { success: true, message: '实例已解封' }
    } catch (error) {
      request.log.error(error, '解封实例失败')
      return reply.status(500).send({ error: '解封实例失败' })
    }
  })

  // ==================== 管理员手动延期 ====================

  // POST /api/admin/instances/:id/extend - 手动延期
  app.post('/api/admin/instances/:id/extend', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const admin = request.user!
      const { id } = request.params as { id: string }
      const { days, reason, freeExtend } = request.body as {
        days: number
        reason?: string
        freeExtend?: boolean  // 是否免费延期
      }

      const instanceId = parsePositiveRouteId(id)
      if (!instanceId || !Number.isInteger(days) || days < 1 || days > 365) {
        return reply.status(400).send({ error: '参数无效，延期天数必须在 1-365 之间' })
      }

      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: { user: { select: { id: true, username: true, balance: true } } }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      // 只有付费实例可以延期
      if (!instance.packagePlanId || !instance.billingPrice) {
        return reply.status(400).send({ error: '免费实例无需延期' })
      }

      // 计算延期费用（按天价计算）
      const dailyPrice = calculateDailyPrice(Number(instance.billingPrice), instance.billingCycle)
      const extendAmount = freeExtend ? 0 : Number((dailyPrice * days).toFixed(2))

      // 计算新的到期时间
      const baseDate = instance.expiresAt && instance.expiresAt > new Date()
        ? instance.expiresAt
        : new Date()
      const newExpiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

      // 如果不是免费延期，需要检查用户余额并扣费
      if (!freeExtend && extendAmount > 0) {
        const userBalance = Number(instance.user!.balance)
        if (userBalance < extendAmount) {
          return reply.status(400).send({ error: `用户余额不足，需要 ${extendAmount} 元，当前余额 ${userBalance} 元` })
        }

        // 扣费并延期
        await prisma.$transaction(async (tx) => {
          const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)
          if (!balanceLocked) {
            throw new Error('BALANCE_CONFLICT: 用户余额正在处理，请稍后重试')
          }

          const currentUser = await tx.user.findUnique({
            where: { id: instance.userId },
            select: { balance: true }
          })
          if (!currentUser) {
            throw new Error('USER_NOT_FOUND: 用户不存在')
          }
          const oldBalance = Number(currentUser.balance)

          // 扣除余额
          const userUpdateResult = await tx.user.updateMany({
            where: { id: instance.userId, balance: { gte: extendAmount } },
            data: { balance: { decrement: extendAmount } }
          })
          if (userUpdateResult.count !== 1) {
            throw new Error('BALANCE_INSUFFICIENT: 用户余额不足')
          }
          const updatedUser = await tx.user.findUnique({
            where: { id: instance.userId },
            select: { balance: true }
          })
          const newBalance = Number(updatedUser?.balance || 0)

          // 记录余额日志
          const balanceLog = await tx.balanceLog.create({
            data: {
              userId: instance.userId,
              type: 'consume',
              amount: -extendAmount,
              balanceBefore: oldBalance,
              balanceAfter: newBalance,
              instanceId,
              remark: `管理员延期 ${days} 天：${reason || '手动延期'}`
            }
          })

          // 更新到期时间
          await tx.instance.update({
            where: { id: instanceId },
            data: {
              expiresAt: newExpiresAt,
              // 如果是因到期被封停，解除封停
              ...(instance.status === 'suspended' && instance.suspendReason === 'expired' ? {
                status: 'stopped',
                suspendedAt: null,
                suspendedBy: null,
                suspendReason: null
              } : {})
            }
          })

          // 记录扣费记录
          await tx.instanceBillingRecord.create({
            data: {
              instanceId,
              userId: instance.userId,
              type: 'renew',  // 使用 renew 类型表示延期
              amount: extendAmount,
              months: 0,
              periodStart: baseDate,
              periodEnd: newExpiresAt,
              balanceLogId: balanceLog.id,
              remark: `管理员延期 ${days} 天（操作者: ${admin.username}）`
            }
          })
        })
      } else {
        // 免费延期
        await prisma.$transaction(async (tx) => {
          // 更新到期时间
          await tx.instance.update({
            where: { id: instanceId },
            data: {
              expiresAt: newExpiresAt,
              // 如果是因到期被封停，解除封停
              ...(instance.status === 'suspended' && instance.suspendReason === 'expired' ? {
                status: 'stopped',
                suspendedAt: null,
                suspendedBy: null,
                suspendReason: null
              } : {})
            }
          })

          // 记录免费延期记录
          await tx.instanceBillingRecord.create({
            data: {
              instanceId,
              userId: instance.userId,
              type: 'renew',  // 使用 renew 类型表示免费延期
              amount: 0,
              months: 0,
              periodStart: baseDate,
              periodEnd: newExpiresAt,
              remark: `管理员免费延期 ${days} 天（操作者: ${admin.username}）：${reason || '免费延期'}`
            }
          })
        })
      }

      await createLog(
        admin.id,
        'admin',
        'instance.admin_extend',
        `Admin extended instance "${instance.name}" by ${days} days (User: ${instance.user?.username}, Amount: ${extendAmount})`,
        'success',
        { instanceId }
      )

      // 通知用户
      await sendNotification(instance.userId, 'instance_extended', {
        instanceName: instance.name,
        days,
        newExpiresAt: newExpiresAt.toISOString(),
        amount: extendAmount
      })

      return {
        success: true,
        message: `实例已延期 ${days} 天`,
        amount: extendAmount,
        newExpiresAt: newExpiresAt.toISOString()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('BALANCE_CONFLICT')) {
        return reply.status(409).send({ error: '用户余额正在处理，请稍后重试' })
      }
      if (errorMessage.includes('BALANCE_INSUFFICIENT')) {
        return reply.status(400).send({ error: '用户余额不足' })
      }
      request.log.error(error, '延期实例失败')
      return reply.status(500).send({ error: '延期实例失败' })
    }
  })

  // ==================== 管理员退款 ====================

  // POST /api/admin/instances/:id/refund - 管理员退款
  app.post('/api/admin/instances/:id/refund', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const admin = request.user!
      const { id } = request.params as { id: string }
      const { amount, reason } = request.body as {
        amount: number
        reason: string
      }

      const instanceId = parsePositiveRouteId(id)
      if (!instanceId) {
        return reply.status(400).send({ error: '无效的实例ID' })
      }

      if (!amount || amount <= 0) {
        return reply.status(400).send({ error: '退款金额必须大于0' })
      }

      if (!reason || reason.trim().length < 2) {
        return reply.status(400).send({ error: '请填写退款原因' })
      }

      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: { user: { select: { id: true, username: true, balance: true } } }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      // 计算可退款上限
      const { maxRefundable } = await getMaxRefundable(instanceId)

      if (amount > maxRefundable) {
        return reply.status(400).send({
          error: `退款金额超过可退上限，最多可退 ${maxRefundable.toFixed(2)} 元`
        })
      }

      // 执行退款
      await prisma.$transaction(async (tx) => {
        const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)
        if (!balanceLocked) {
          throw new Error('BALANCE_CONFLICT: 用户余额正在处理，请稍后重试')
        }

        const currentUser = await tx.user.findUnique({
          where: { id: instance.userId },
          select: { balance: true }
        })
        if (!currentUser) {
          throw new Error('USER_NOT_FOUND: 用户不存在')
        }
        const oldBalance = Number(currentUser.balance)

        // 增加用户余额
        const updatedUser = await tx.user.update({
          where: { id: instance.userId },
          data: { balance: { increment: amount } },
          select: { balance: true }
        })
        const newBalance = Number(updatedUser.balance)

        // 记录余额变动
        const balanceLog = await tx.balanceLog.create({
          data: {
            userId: instance.userId,
            type: 'refund',
            amount: amount,
            balanceBefore: oldBalance,
            balanceAfter: newBalance,
            instanceId,
            remark: `管理员退款：${reason}`
          }
        })

        // 记录退款记录（负数表示退款）
        await tx.instanceBillingRecord.create({
          data: {
            instanceId,
            userId: instance.userId,
            type: 'refund',
            amount: -amount,
            months: 0,
            periodStart: new Date(),
            periodEnd: new Date(),
            balanceLogId: balanceLog.id,
            remark: `管理员退款：${reason}（操作者: ${admin.username}）`
          }
        })
      })

      await createLog(
        admin.id,
        'admin',
        'instance.admin_refund',
        `Admin refunded ${amount} for instance "${instance.name}" (User: ${instance.user?.username}): ${reason}`,
        'success',
        { instanceId }
      )

      // 通知用户
      await sendNotification(instance.userId, 'refund_completed', {
        instanceName: instance.name,
        amount,
        reason
      })

      return {
        success: true,
        message: `已退款 ${amount} 元`,
        amount,
        maxRefundable: maxRefundable - amount
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('BALANCE_CONFLICT')) {
        return reply.status(409).send({ error: '用户余额正在处理，请稍后重试' })
      }
      request.log.error(error, '退款失败')
      return reply.status(500).send({ error: '退款失败' })
    }
  })

  // ==================== 管理员删除并退款 ====================

  // POST /api/admin/instances/:id/delete-and-refund - 管理员删除实例并退款
  app.post('/api/admin/instances/:id/delete-and-refund', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!
    const { id } = request.params as { id: string }
    const { refundType, reason, databaseOnly } = request.body as {
      refundType: 'remaining' | 'full'  // remaining=按剩余价值, full=全额退款
      reason: string
      databaseOnly?: boolean  // 仅数据库删除，跳过 Incus 操作
    }

    const instanceId = parsePositiveRouteId(id)
    if (!instanceId) {
      return reply.status(400).send({ error: '无效的实例ID' })
    }

    if (!reason || reason.trim().length < 2) {
      return reply.status(400).send({ error: '请填写删除原因' })
    }

    if (!refundType || !['remaining', 'full'].includes(refundType)) {
      return reply.status(400).send({ error: '请选择退款方式' })
    }

    try {
      // 1. 获取实例信息
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          user: { select: { id: true, username: true, balance: true } },
          host: { select: { id: true, name: true } }
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      // 3. 计算可退款金额（仅用于全额退款模式）
      const { maxRefundable } = await getMaxRefundable(instanceId)

      // 4. 计算退款金额
      let refundAmount = 0
      if (refundType === 'full') {
        // 全额退款：退还所有已消费金额（受消费记录限制）
        refundAmount = maxRefundable
      } else {
        const refundQuote = await db.calculateInstanceRemainingRefundQuote({
          id: instanceId,
          billingPrice: instance.billingPrice,
          billingCycle: instance.billingCycle,
          expiresAt: instance.expiresAt,
          packagePlanId: instance.packagePlanId
        })
        refundAmount = refundQuote.refundableValue
      }

      const claimed = await claimInstanceForAdminDelete(instanceId, instance.status)
      if (!claimed) {
        return reply.status(409).send({ error: '实例正在删除或已删除' })
      }

      // 先完成账务结算；如果账务失败，恢复实例状态，避免已删除但未退款。
      if (refundAmount > 0) {
        try {
          await prisma.$transaction(async (tx) => {
            const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)
            if (!balanceLocked) {
              throw new Error('BALANCE_CONFLICT: 用户余额正在处理，请稍后重试')
            }

            const currentUser = await tx.user.findUnique({
              where: { id: instance.userId },
              select: { balance: true }
            })
            const oldBalance = Number(currentUser?.balance || 0)

            const updatedUser = await tx.user.update({
              where: { id: instance.userId },
              data: { balance: { increment: refundAmount } },
              select: { balance: true }
            })
            const newBalance = Number(updatedUser.balance)

            const balanceLog = await tx.balanceLog.create({
              data: {
                userId: instance.userId,
                type: 'refund',
                amount: refundAmount,
                balanceBefore: oldBalance,
                balanceAfter: newBalance,
                instanceId,
                remark: `管理员删除并退款（${refundType === 'full' ? '全额' : '按剩余价值'}）：${reason}`
              }
            })

            await tx.instanceBillingRecord.create({
              data: {
                instanceId,
                userId: instance.userId,
                type: 'refund',
                amount: -refundAmount,
                months: 0,
                periodStart: new Date(),
                periodEnd: new Date(),
                balanceLogId: balanceLog.id,
                remark: `管理员删除并退款（${refundType === 'full' ? '全额' : '按剩余价值'}）：${reason}（操作者: ${admin.username}）`
              }
            })
          })
        } catch (refundError) {
          await prisma.instance.updateMany({
            where: { id: instanceId, status: 'deleted' },
            data: { status: instance.status }
          })
          throw refundError
        }
      }

      // 4. 删除实例（复用现有逻辑）
      // 4.1 停止实例（databaseOnly 模式下跳过）
      if (instance.status === 'running' && !databaseOnly) {
        try {
          const host = await db.getHostById(instance.hostId)
          if (host) {
            const { getIncusClient, stopInstance } = await import('../lib/incus/index.js')
            const client = await getIncusClient(host)
            await stopInstance(client, instance.incusId, true)
          }
        } catch (err) {
          request.log.warn(err, '停止实例失败')
        }
      }

      // 4.2 删除端口映射
      const portMappings = await prisma.portMapping.findMany({ where: { instanceId } })

      // 4.3 清理关联数据
      try {
        await prisma.snapshot.deleteMany({ where: { instanceId } })
        await prisma.backup.deleteMany({ where: { instanceId } })
        await prisma.portMapping.deleteMany({ where: { instanceId } })
        await prisma.proxySite.deleteMany({ where: { instanceId } })
        await prisma.dailyTraffic.deleteMany({ where: { instanceId } })
        await prisma.ipAddress.deleteMany({ where: { instanceId } })
        await prisma.ipv6Subnet.deleteMany({ where: { instanceId } })
        await prisma.restoreTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.backupUploadTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.instanceTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.instanceTransfer.updateMany({
          where: { instanceId, status: 'pending' },
          data: { status: 'cancelled', cancelledAt: new Date() }
        })
      } catch (cleanupErr) {
        request.log.warn(cleanupErr, '清理关联数据失败')
      }

      // 4.4 从 Incus 删除实例（databaseOnly 模式下跳过）
      if (!databaseOnly) {
        try {
          const host = await db.getHostById(instance.hostId)
          if (host) {
            const { getIncusClient, deleteInstance } = await import('../lib/incus/index.js')
            const client = await getIncusClient(host)
            await deleteInstance(client, instance.incusId)
          }
        } catch (incusErr) {
          request.log.error(incusErr, 'Incus 删除实例失败')
          // 继续执行，即使 Incus 删除失败也要更新数据库状态
        }
      }

      // 4.6 释放宿主机资源
      const portMappingsCount = portMappings?.length || 0
      await db.rollbackResources({
        hostId: instance.hostId,
        cpu: instance.cpu,
        memory: instance.memory,
        disk: instance.disk,
        portCount: portMappingsCount
      })

      // 重新计算宿主机资源使用量
      const usedResources = await db.calculateHostResourcesFromInstances(instance.hostId)
      const actualPortsUsed = await prisma.portMapping.count({
        where: {
          instance: {
            hostId: instance.hostId,
            status: { not: 'deleted' }
          }
        }
      })
      await db.updateHostResources(instance.hostId, {
        cpuUsed: usedResources.cpuUsed,
        memoryUsed: usedResources.memoryUsed,
        diskUsed: usedResources.diskUsed
      })
      await prisma.host.update({
        where: { id: instance.hostId },
        data: { natPortsUsedCount: actualPortsUsed }
      })

      // 6. 记录操作日志
      await createLog(
        admin.id,
        'admin',
        databaseOnly ? 'instance.admin_delete_refund_db_only' : 'instance.admin_delete_refund',
        `Admin deleted${databaseOnly ? ' (database only)' : ''} and refunded instance "${instance.name}" (User: ${instance.user?.username}, RefundType: ${refundType}, Amount: ¥${refundAmount.toFixed(2)}): ${reason}`,
        'success',
        { instanceId }
      )

      // 7. 通知用户
      await sendNotification(instance.userId, 'instance_deleted_refunded', {
        instanceName: instance.name,
        refundAmount,
        refundType: refundType === 'full' ? '全额退款' : '按剩余价值退款',
        reason
      })

      try {
        const targetUser = await db.findUserById(instance.userId)
        if (targetUser?.email) {
          await sendInstanceDestroyRefundEmail(targetUser.email, {
            username: targetUser.username,
            instanceName: instance.name,
            refundAmount,
            refundType: refundType === 'full' ? '全额退款' : '按剩余价值退款',
            reason,
            isUserDestroy: false
          })
        }
      } catch (emailErr) {
        request.log.warn(emailErr, '删除退款邮件发送失败')
      }

      const modeText = databaseOnly ? '（仅数据库）' : ''
      return {
        success: true,
        message: `实例已删除${modeText}${refundAmount > 0 ? `，已退款 ¥${refundAmount.toFixed(2)}` : ''}`,
        refundAmount,
        refundType
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('BALANCE_CONFLICT')) {
        return reply.status(409).send({ error: '用户余额正在处理，请稍后重试' })
      }
      request.log.error(error, '删除并退款失败')
      return reply.status(500).send({ error: '删除并退款失败' })
    }
  })

  // ==================== 管理员应用AFF优惠码 ====================

  // POST /api/admin/instances/:id/apply-aff - 为实例应用AFF优惠码
  app.post('/api/admin/instances/:id/apply-aff', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!
    const { id } = request.params as { id: string }
    const { affCode: affCodeInput } = request.body as { affCode: string }

    const instanceId = parsePositiveRouteId(id)
    if (!instanceId) {
      return reply.status(400).send({ error: '无效的实例ID' })
    }

    if (!affCodeInput || affCodeInput.trim().length < 3) {
      return reply.status(400).send({ error: '请输入有效的AFF优惠码' })
    }

    try {
      // 1. 获取实例信息
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          user: { select: { id: true, username: true } },
          affBinding: true
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      if (!instance.packagePlanId) {
        return reply.status(400).send({ error: '免费实例不支持应用优惠码' })
      }

      // 2. 检查是否已有AFF绑定
      if (instance.affBinding) {
        return reply.status(400).send({ error: '该实例已绑定优惠码，无法重复应用' })
      }

      // 3. 验证AFF码
      const affCode = await prisma.affCode.findUnique({
        where: { code: affCodeInput.trim().toUpperCase() },
        include: {
          user: { select: { id: true, username: true } }
        }
      })

      if (!affCode) {
        return reply.status(400).send({ error: '优惠码不存在' })
      }

      // 4. 检查AFF码创建者不能是实例所有者（防止自返利）
      if (affCode.userId === instance.userId) {
        return reply.status(400).send({ error: '不能为用户应用其自己的优惠码' })
      }

      // 5. 创建AFF绑定
      await db.createAffBinding(instanceId, affCode.id)

      // 6. 记录操作日志
      await createLog(
        admin.id,
        'admin',
        'instance.admin_apply_aff',
        `Admin applied AFF code "${affCode.code}" (Owner: ${affCode.user?.username}) to instance "${instance.name}" (User: ${instance.user?.username})`,
        'success',
        { instanceId }
      )

      // 7. 通知用户
      await sendNotification(instance.userId, 'aff_applied', {
        instanceName: instance.name,
        discountPercent: Math.round(Number(affCode.discountRate) * 100)
      })

      return {
        success: true,
        message: `已为实例应用 ${Math.round(Number(affCode.discountRate) * 100)}% 续费折扣`,
        discountRate: Number(affCode.discountRate)
      }
    } catch (error) {
      request.log.error(error, '应用AFF优惠码失败')
      return reply.status(500).send({ error: '应用AFF优惠码失败' })
    }
  })

  // ==================== 修改实例价格 ====================

  // POST /api/admin/instances/:id/update-price - 修改实例专属价格
  app.post('/api/admin/instances/:id/update-price', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!
    const { id } = request.params as { id: string }

    if (!request.body || typeof request.body !== 'object') {
      return reply.status(400).send({ error: '请求参数无效' })
    }

    const { newPrice, settleBalance, expectedVersion } = request.body as {
      newPrice: number  // 新的单周期价格（元）
      settleBalance: boolean  // 是否结算差价
      expectedVersion?: number
    }

    const instanceId = parsePositiveRouteId(id)
    if (!instanceId) {
      return reply.status(400).send({ error: '无效的实例ID' })
    }

    // 验证新价格
    if (typeof newPrice !== 'number' || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 100000) {
      return reply.status(400).send({ error: '价格必须是 0-100000 之间的数字' })
    }

    if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
      return reply.status(400).send({ error: '预览版本参数无效' })
    }

    try {
      // 1. 获取实例信息（包含 AFF 绑定）
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          user: { select: { id: true, username: true, balance: true } },
          packagePlan: { select: { id: true, name: true, price: true, billingCycle: true } },
          affBinding: {
            select: {
              affCode: { select: { discountRate: true, enabled: true } }
            }
          }
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      if (!instance.packagePlanId) {
        return reply.status(400).send({ error: '免费实例不支持修改价格' })
      }

      const oldPrice = Number(instance.billingPrice) || 0
      const roundedNewPrice = Number(newPrice.toFixed(2))

      if (Number.isInteger(expectedVersion) && instance.version !== expectedVersion) {
        return reply.status(409).send({ error: '实例计费信息已变化，请刷新后重试' })
      }

      // 如果价格没有变化，直接返回
      if (oldPrice === roundedNewPrice) {
        return { success: true, message: '价格未变更', priceDiff: 0 }
      }

      let priceDiff = 0
      let remainingDays = 0
      let billingCycle = instance.billingCycle || 1

      // 2. 执行事务：重新读取、重新报价、并发检查、价格更新和余额结算
      await prisma.$transaction(async (tx) => {
        const currentInstance = await tx.instance.findUnique({
          where: { id: instanceId },
          include: {
            user: { select: { id: true, username: true, balance: true } }
          }
        })

        if (!currentInstance) {
          throw new BatchPriceUpdateError('实例不存在', 404)
        }

        if (currentInstance.status === 'deleted') {
          throw new BatchPriceUpdateError('实例已删除')
        }

        if (!currentInstance.packagePlanId) {
          throw new BatchPriceUpdateError('免费实例不支持修改价格')
        }

        const currentOldPrice = Number(currentInstance.billingPrice) || 0
        const comparisonVersion = Number.isInteger(expectedVersion) ? expectedVersion : instance.version
        if (currentOldPrice !== oldPrice || currentInstance.version !== comparisonVersion) {
          throw new BatchPriceUpdateError('实例计费信息已变化，请刷新后重试', 409)
        }

        const quote = await db.calculateInstancePriceAdjustmentQuote(currentInstance, roundedNewPrice, settleBalance, tx)
        priceDiff = quote.priceDiff
        remainingDays = quote.remainingDays
        billingCycle = quote.billingCycle

        // 检查用户余额（如果需要补交）
        const userBalance = Number(currentInstance.user!.balance)
        if (priceDiff > 0 && priceDiff > userBalance) {
          throw new BatchPriceUpdateError(`用户余额不足，需补交 ¥${priceDiff.toFixed(2)}，当前余额 ¥${userBalance.toFixed(2)}`)
        }

        // 更新实例价格
        const instanceUpdateResult = await tx.instance.updateMany({
          where: {
            id: instanceId,
            version: currentInstance.version
          },
          data: {
            billingPrice: roundedNewPrice,
            version: { increment: 1 }
          }
        })

        if (instanceUpdateResult.count !== 1) {
          throw new BatchPriceUpdateError('实例计费信息已变化，请刷新后重试', 409)
        }

        // 如果需要结算差价
        if (settleBalance && priceDiff !== 0) {
          const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, currentInstance.userId)
          if (!balanceLocked) {
            throw new BatchPriceUpdateError('用户余额正在处理，请稍后重试', 409)
          }

          let balanceBefore = userBalance
          let balanceAfter = balanceBefore - priceDiff

          // 更新用户余额
          if (priceDiff > 0) {
            const userUpdateResult = await tx.user.updateMany({
              where: {
                id: currentInstance.userId,
                balance: { gte: priceDiff }
              },
              data: { balance: { decrement: priceDiff } }
            })

            if (userUpdateResult.count !== 1) {
              throw new BatchPriceUpdateError(`用户余额不足，需补交 ¥${priceDiff.toFixed(2)}`)
            }

            const updatedUser = await tx.user.findUnique({
              where: { id: currentInstance.userId },
              select: { balance: true }
            })
            balanceAfter = Number(updatedUser?.balance || 0)
            balanceBefore = roundMoney(balanceAfter + priceDiff)
          } else {
            const updatedUser = await tx.user.update({
              where: { id: currentInstance.userId },
              data: { balance: { increment: Math.abs(priceDiff) } },
              select: { balance: true }
            })
            balanceAfter = Number(updatedUser.balance)
            balanceBefore = roundMoney(balanceAfter - Math.abs(priceDiff))
          }

          // 记录余额变动日志
          const balanceLog = await tx.balanceLog.create({
            data: {
              userId: currentInstance.userId,
              type: priceDiff > 0 ? 'consume' : 'refund',
              amount: -priceDiff,
              balanceBefore,
              balanceAfter,
              instanceId,
              remark: priceDiff > 0
                ? `管理员调整实例价格，补交差价 ¥${priceDiff.toFixed(2)}`
                : `管理员调整实例价格，退还差价 ¥${Math.abs(priceDiff).toFixed(2)}`
            }
          })

          // 记录计费变动
          await tx.instanceBillingRecord.create({
            data: {
              instanceId,
              userId: currentInstance.userId,
              type: priceDiff > 0 ? 'upgrade' : 'refund',
              amount: priceDiff > 0 ? Math.abs(priceDiff) : -Math.abs(priceDiff),
              months: 0,
              periodStart: new Date(),
              periodEnd: currentInstance.expiresAt || new Date(),
              balanceLogId: balanceLog.id,
              remark: `价格调整: ¥${oldPrice.toFixed(2)} → ¥${roundedNewPrice.toFixed(2)}`
            }
          })
        }
      })

      // 5. 记录操作日志
      await createLog(
        admin.id,
        'admin',
        'instance.admin_update_price',
        `Admin updated instance "${instance.name}" price: ¥${oldPrice.toFixed(2)} → ¥${roundedNewPrice.toFixed(2)}, settle: ${settleBalance}, diff: ¥${priceDiff.toFixed(2)}`,
        'success',
        { instanceId }
      )

      // 6. 通知用户（如果有余额变动）
      if (settleBalance && priceDiff !== 0) {
        await sendNotification(instance.userId, 'instance_price_changed', {
          instanceName: instance.name,
          oldPrice: oldPrice,
          newPrice: roundedNewPrice,
          priceDiff: Math.abs(priceDiff),
          isIncrease: priceDiff > 0
        })
      }

      return {
        success: true,
        message: priceDiff > 0
          ? `价格已更新，已从用户余额扣除 ¥${priceDiff.toFixed(2)}`
          : priceDiff < 0
            ? `价格已更新，已退还用户 ¥${Math.abs(priceDiff).toFixed(2)}`
            : '价格已更新',
        oldPrice,
        newPrice: roundedNewPrice,
        priceDiff,
        remainingDays,
        billingCycle
      }
    } catch (error) {
      if (error instanceof BatchPriceUpdateError) {
        return reply.status(error.statusCode).send({ error: error.message })
      }

      request.log.error(error, '修改实例价格失败')
      return reply.status(500).send({ error: '修改实例价格失败' })
    }
  })

  // POST /api/admin/instances/:id/update-price/preview - 预览实例专属价格变更结算
  app.post('/api/admin/instances/:id/update-price/preview', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    if (!request.body || typeof request.body !== 'object') {
      return reply.status(400).send({ error: '请求参数无效' })
    }

    const { newPrice, settleBalance } = request.body as {
      newPrice: number
      settleBalance: boolean
    }

    const instanceId = parsePositiveRouteId(id)
    if (!instanceId) {
      return reply.status(400).send({ error: '无效的实例ID' })
    }

    if (typeof newPrice !== 'number' || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 100000) {
      return reply.status(400).send({ error: '价格必须是 0-100000 之间的数字' })
    }

    try {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          user: { select: { id: true, username: true, balance: true } }
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      if (!instance.packagePlanId) {
        return reply.status(400).send({ error: '免费实例不支持修改价格' })
      }

      const quote = await db.calculateInstancePriceAdjustmentQuote(instance, newPrice, settleBalance)
      const userBalance = Number(instance.user?.balance || 0)

      return {
        oldPrice: quote.oldPrice,
        newPrice: quote.newPrice,
        billingCycle: quote.billingCycle,
        remainingDays: quote.remainingDays,
        priceDiff: quote.priceDiff,
        discountRate: quote.discountRate,
        userBalance,
        instanceVersion: instance.version
      }
    } catch (error) {
      request.log.error(error, '预览修改实例价格失败')
      return reply.status(500).send({ error: '预览修改实例价格失败' })
    }
  })

  // POST /api/admin/instances/batch-update-price/preview - 批量预览实例专属价格变更结算
  app.post('/api/admin/instances/batch-update-price/preview', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { instanceIds, newPrice, settleBalance } = parseBatchPriceUpdateBody(request.body)
      return await buildBatchPriceUpdatePreview(prisma, instanceIds, newPrice, settleBalance)
    } catch (error) {
      if (error instanceof BatchPriceUpdateError) {
        return reply.status(error.statusCode).send({
          error: error.message,
          preview: error.preview
        })
      }

      request.log.error(error, '批量预览修改实例价格失败')
      return reply.status(500).send({ error: '批量预览修改实例价格失败' })
    }
  })

  // POST /api/admin/instances/batch-update-price - 批量修改实例专属价格
  app.post('/api/admin/instances/batch-update-price', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!

    try {
      const { instanceIds, newPrice, settleBalance, expectations } = parseBatchPriceUpdateBody(request.body)
      let notificationItems: BatchPriceUpdateItem[] = []

      const preview = await prisma.$transaction(async (tx) => {
        const currentPreview = await buildBatchPriceUpdatePreview(tx, instanceIds, newPrice, settleBalance)

        const versionedPreviewItems = currentPreview.items.filter(item => item.status !== 'failed')
        const expectedVersionMap = new Map(expectations.map(item => [item.instanceId, item.version]))
        const missingPreviewSnapshot = versionedPreviewItems.some(item => !expectedVersionMap.has(item.id))

        if (missingPreviewSnapshot) {
          throw new BatchPriceUpdateError('请先刷新预览后再提交', 400, currentPreview)
        }

        const hasStalePreview = versionedPreviewItems.some(item => {
          const expectedVersion = expectedVersionMap.get(item.id)
          return expectedVersion !== item.instanceVersion
        })

        if (hasStalePreview) {
          throw new BatchPriceUpdateError('实例计费信息已变化，请刷新预览后重试', 409, currentPreview)
        }

        if (!currentPreview.canSubmit) {
          throw new BatchPriceUpdateError('批量修改价格预览未通过，请检查失败项或用户余额', 400, currentPreview)
        }

        const changedItems = currentPreview.items.filter(item => item.status === 'ready')
        const changedIds = changedItems.map(item => item.id)
        const periodEnds = changedIds.length > 0
          ? await tx.instance.findMany({
              where: { id: { in: changedIds } },
              select: { id: true, expiresAt: true }
            })
          : []
        const periodEndMap = new Map(periodEnds.map(item => [item.id, item.expiresAt]))

        for (const item of changedItems) {
          const updateResult = await tx.instance.updateMany({
            where: {
              id: item.id,
              version: item.instanceVersion
            },
            data: {
              billingPrice: item.newPrice,
              version: { increment: 1 }
            }
          })

          if (updateResult.count !== 1) {
            throw new BatchPriceUpdateError(`实例 #${item.id} 计费信息已变化，请刷新后重试`, 409, currentPreview)
          }
        }

        if (settleBalance) {
          const settlementItems = changedItems
            .filter(item => item.user && item.priceDiff !== 0)
            .sort((a, b) => {
              if (a.user!.id !== b.user!.id) return a.user!.id - b.user!.id
              return a.priceDiff - b.priceDiff
            })

          for (const item of settlementItems) {
            const user = item.user!
            const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, user.id)
            if (!balanceLocked) {
              throw new BatchPriceUpdateError(`用户 ${user.username} 余额正在处理，请稍后重试`, 409, currentPreview)
            }

            let balanceAfter = 0
            let balanceBefore = 0

            if (item.priceDiff > 0) {
              const updateResult = await tx.user.updateMany({
                where: {
                  id: user.id,
                  balance: { gte: item.priceDiff }
                },
                data: {
                  balance: { decrement: item.priceDiff }
                }
              })

              if (updateResult.count !== 1) {
                throw new BatchPriceUpdateError(`用户 ${user.username} 余额不足，请刷新预览后重试`, 400, currentPreview)
              }

              const updatedUser = await tx.user.findUnique({
                where: { id: user.id },
                select: { balance: true }
              })
              balanceAfter = Number(updatedUser?.balance || 0)
              balanceBefore = roundMoney(balanceAfter + item.priceDiff)
            } else {
              const refundAmount = Math.abs(item.priceDiff)
              const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: {
                  balance: { increment: refundAmount }
                },
                select: { balance: true }
              })
              balanceAfter = Number(updatedUser.balance)
              balanceBefore = roundMoney(balanceAfter - refundAmount)
            }

            const balanceLog = await tx.balanceLog.create({
              data: {
                userId: user.id,
                type: item.priceDiff > 0 ? 'consume' : 'refund',
                amount: -item.priceDiff,
                balanceBefore,
                balanceAfter,
                instanceId: item.id,
                remark: item.priceDiff > 0
                  ? `管理员批量调整实例价格，补交差价 ¥${item.priceDiff.toFixed(2)}`
                  : `管理员批量调整实例价格，退还差价 ¥${Math.abs(item.priceDiff).toFixed(2)}`
              }
            })

            await tx.instanceBillingRecord.create({
              data: {
                instanceId: item.id,
                userId: user.id,
                type: item.priceDiff > 0 ? 'upgrade' : 'refund',
                amount: item.priceDiff > 0 ? Math.abs(item.priceDiff) : -Math.abs(item.priceDiff),
                months: 0,
                periodStart: new Date(),
                periodEnd: periodEndMap.get(item.id) || new Date(),
                balanceLogId: balanceLog.id,
                remark: `批量价格调整: ¥${(item.oldPrice || 0).toFixed(2)} → ¥${item.newPrice.toFixed(2)}`
              }
            })
          }
        }

        notificationItems = changedItems.filter(item => item.user && item.priceDiff !== 0)
        return currentPreview
      })

      await createLog(
        admin.id,
        'admin',
        'instance.admin_batch_update_price',
        `Admin batch updated ${preview.summary.changedCount} instance prices to ¥${newPrice.toFixed(2)}, settle: ${settleBalance}, charge: ¥${preview.summary.totalCharge.toFixed(2)}, refund: ¥${preview.summary.totalRefund.toFixed(2)}`,
        'success'
      )

      const notificationResults = await Promise.allSettled(notificationItems.map(item => sendNotification(item.user!.id, 'instance_price_changed', {
        instanceName: item.name || `#${item.id}`,
        oldPrice: item.oldPrice || 0,
        newPrice: item.newPrice,
        priceDiff: Math.abs(item.priceDiff),
        isIncrease: item.priceDiff > 0
      })))
      for (const result of notificationResults) {
        if (result.status === 'rejected') {
          request.log.warn(result.reason, '批量价格修改通知发送失败')
        }
      }

      return {
        success: true,
        message: preview.summary.changedCount > 0
          ? `批量价格修改完成，已更新 ${preview.summary.changedCount} 个实例`
          : '价格未变更',
        preview
      }
    } catch (error) {
      if (error instanceof BatchPriceUpdateError) {
        return reply.status(error.statusCode).send({
          error: error.message,
          preview: error.preview
        })
      }

      request.log.error(error, '批量修改实例价格失败')
      return reply.status(500).send({ error: '批量修改实例价格失败' })
    }
  })

  // ==================== 付费实例列表 ====================

  // GET /api/admin/billing/instances - 付费实例列表
  app.get('/api/admin/billing/instances', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { page, pageSize, status, expiring, hostId, search } = request.query as {
        page?: string
        pageSize?: string
        status?: string
        expiring?: string  // 'true' 表示只显示即将到期的实例
        hostId?: string    // 宿主机筛选
        search?: string    // 搜索关键词（用户名/节点/实例名/方案/套餐）
      }

      const pageNum = parsePositiveInteger(page, 1)
      const size = parsePositiveInteger(pageSize, 20, 100)
      const skip = (pageNum - 1) * size

      const where: Record<string, unknown> = {
        packagePlanId: { not: null }
      }

      const normalizedStatus = normalizeStringFilter(status, INSTANCE_STATUSES)
      if (normalizedStatus) {
        where.status = normalizedStatus
      } else {
        where.status = { notIn: ['deleted'] }
      }

      if (expiring === 'true') {
        where.expiresAt = {
          not: null,
          gt: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      }

      // 宿主机筛选
      if (hostId) {
        const hostIdNum = parseOptionalPositiveInteger(hostId)
        if (hostIdNum !== undefined) {
          where.hostId = hostIdNum
        }
      }

      // 搜索关键词（用户名/节点/实例名/方案/套餐）
      if (search && search.trim()) {
        const keyword = search.trim().slice(0, 128)
        where.OR = [
          { name: { contains: keyword, mode: 'insensitive' } },
          { user: { username: { contains: keyword, mode: 'insensitive' } } },
          { host: { name: { contains: keyword, mode: 'insensitive' } } },
          { package: { name: { contains: keyword, mode: 'insensitive' } } },
          { packagePlan: { name: { contains: keyword, mode: 'insensitive' } } }
        ]
      }

      const [instances, total, hostsWithPaidInstances] = await Promise.all([
        prisma.instance.findMany({
          where,
          include: {
            user: { select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true, balance: true } },
            packagePlan: { select: { id: true, name: true } },
            package: { select: { id: true, name: true, instanceType: true } },
            host: {
              select: {
                id: true,
                name: true,
                userId: true,
                instanceType: true,
                user: {
                  select: {
                    role: true
                  }
                }
              }
            },
            affBinding: {
              select: {
                id: true,
                affCode: { select: { discountRate: true, enabled: true } }
              }
            }
          },
          orderBy: { expiresAt: 'asc' },
          skip,
          take: size
        }),
        prisma.instance.count({ where }),
        // 查询所有有付费实例的节点（不受筛选条件影响）
        prisma.instance.findMany({
          where: {
            packagePlanId: { not: null },
            status: { notIn: ['deleted'] }
          },
          select: {
            host: { select: { id: true, name: true } }
          },
          distinct: ['hostId']
        })
      ])

      return {
        instances: instances.map((inst: any) => {
          // 计算剩余天数
          let remainingDays: number | null = null
          if (inst.expiresAt) {
            const now = new Date()
            const diffMs = inst.expiresAt.getTime() - now.getTime()
            remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
          }

          // 根据实例的套餐类型推断实例类型（PRO=容器/PRIME=虚拟机）
          const pkgInstanceType = (inst.package as { instanceType?: string })?.instanceType || 'container'
          let instanceTypeLabel = 'PRO'  // 默认容器
          if (pkgInstanceType === 'vm') {
            instanceTypeLabel = 'PRIME'
          }

          // 获取 AFF 绑定信息
          const affBinding = (inst as any).affBinding
          const hasAffBinding = !!affBinding
          // 只有当优惠码启用时才返回折扣率
          const affDiscountRate = hasAffBinding && affBinding.affCode?.enabled
            ? Number(affBinding.affCode.discountRate) || 0
            : 0

          // 判断是否为托管实例（userId=1 是管理员/直营）
          const isHostedInstance = (inst.host as { user?: { role?: string } })?.user?.role === 'user'

          return {
            id: inst.id,
            incusId: inst.incusId,
            name: inst.name,
            status: inst.status,
            user: {
              id: inst.user.id,
              username: inst.user.username,
              email: inst.user.email,
              avatarStyle: inst.user.avatarStyle,
              avatarBadgeId: inst.user.avatarBadgeId ?? null,
              balance: Number(inst.user.balance) || 0
            },
            host: inst.host,
            package: inst.package,
            packagePlan: inst.packagePlan,
            packagePlanId: inst.packagePlanId,
            billingPrice: inst.billingPrice ? Number(inst.billingPrice) : null,
            billingCycle: inst.billingCycle,
            expiresAt: inst.expiresAt?.toISOString(),
            createdAt: inst.createdAt.toISOString(),
            remainingDays,
            instanceTypeLabel,
            isHostedInstance,
            autoRenew: inst.autoRenew,
            suspendedAt: inst.suspendedAt?.toISOString(),
            suspendReason: inst.suspendReason,
            hasAffBinding,
            affDiscountRate  // AFF折扣率（0-1）
          }
        }),
        total,
        page: pageNum,
        pageSize: size,
        // 返回有付费实例的节点列表（用于前端筛选器）
        hosts: hostsWithPaidInstances
          .filter(inst => inst.host)
          .map(inst => ({ id: inst.host!.id, name: inst.host!.name }))
          .filter((host, index, self) => self.findIndex(h => h.id === host.id) === index)
          .sort((a, b) => a.name.localeCompare(b.name))
      }
    } catch (error) {
      request.log.error(error, '获取付费实例列表失败')
      return reply.status(500).send({ error: '获取付费实例列表失败' })
    }
  })

  // ==================== 充值记录管理 ====================

  // GET /api/admin/billing/recharge-records - 获取充值记录列表
  app.get('/api/admin/billing/recharge-records', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { page, pageSize, status, userId } = request.query as {
        page?: string
        pageSize?: string
        status?: string
        userId?: string
      }

      const pageNum = parsePositiveInteger(page, 1)
      const size = parsePositiveInteger(pageSize, 20, 100)
      const skip = (pageNum - 1) * size

      const where: Record<string, unknown> = {}
      const normalizedStatus = normalizeStringFilter(status, RECHARGE_STATUSES)
      if (normalizedStatus) where.status = normalizedStatus
      const parsedUserId = parseOptionalPositiveInteger(userId)
      if (parsedUserId !== undefined) where.userId = parsedUserId

      // 分开查询避免类型推断问题
      const records = await prisma.rechargeRecord.findMany({
        where,
        include: {
          user: { select: { id: true, username: true } },
          provider: { select: { id: true, name: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size
      })
      const total = await prisma.rechargeRecord.count({ where })

      return {
        records: records.map(r => {
          const paymentInfo = extractRechargePaymentDisplayInfo((r as any).paymentDetails)

          return {
            id: r.id,
            orderNo: r.orderNo,
            userId: r.userId,
            user: r.user,
            amount: Number(r.amount),
            payableAmount: getRechargePayableAmount({
              amount: r.amount,
              paymentDetails: (r as any).paymentDetails
            }),
            actualAmount: r.actualAmount !== null && r.actualAmount !== undefined ? Number(r.actualAmount) : null,
            fee: Number(r.fee || 0),
            status: r.status,
            payMethod: r.paymentMethod,
            actualPaymentMethod: paymentInfo.actualPaymentMethod,
            paymentCurrency: paymentInfo.paymentCurrency,
            paymentNetwork: paymentInfo.paymentNetwork,
            paymentUuid: paymentInfo.paymentUuid,
            paymentTxid: paymentInfo.paymentTxid,
            invoiceCurrency: paymentInfo.invoiceCurrency,
            gatewayStatus: paymentInfo.gatewayStatus,
            gatewayStatusDescription: paymentInfo.gatewayStatusDescription,
            provider: r.provider ? {
              id: r.provider.id,
              name: r.provider.name,
              displayName: r.provider.name,
              type: r.provider.type
            } : null,
            tradeNo: r.tradeNo,
            createdAt: r.createdAt.toISOString(),
            paidAt: r.completedAt?.toISOString() || null,
            completedAt: r.completedAt?.toISOString() || null,
            expiresAt: r.expiredAt?.toISOString() || null
          }
        }),
        total,
        page: pageNum,
        pageSize: size
      }
    } catch (error) {
      request.log.error(error, '获取充值记录列表失败')
      return reply.status(500).send({ error: '获取充值记录列表失败' })
    }
  })

  // POST /api/admin/billing/recharge-records/:id/sync - 同步充值订单状态
  app.post('/api/admin/billing/recharge-records/:id/sync', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!
    const { id } = request.params as { id: string }
    const recordId = parsePositiveRouteId(id)

    if (!recordId) {
      return reply.status(400).send({ error: '无效的记录ID' })
    }

    try {
      // 1. 获取充值记录
      const record = await prisma.rechargeRecord.findUnique({
        where: { id: recordId },
        include: {
          user: { select: { id: true, username: true } },
          provider: true
        }
      })

      if (!record) {
        return reply.status(404).send({ error: '充值记录不存在' })
      }

      // 2. 如果订单已完成，直接返回
      if (record.status === 'completed') {
        return {
          success: true,
          synced: false,
          status: 'completed',
          message: '订单已完成，无需同步'
        }
      }

      // 3. 如果订单已取消或失败，不允许同步
      if (record.status === 'cancelled' || record.status === 'failed') {
        return reply.status(400).send({ error: `订单已${record.status === 'cancelled' ? '取消' : '失败'}，无法同步` })
      }

      // 4. 检查支付渠道
      if (!record.provider) {
        return reply.status(400).send({ error: '支付渠道不存在' })
      }

      // 5. 仅支持可主动查询的支付类型
      if (record.provider.type !== 'yipay' && record.provider.type !== 'heleket') {
        return reply.status(400).send({ error: '该支付渠道不支持手动同步' })
      }

      const config = typeof record.provider.config === 'string'
        ? JSON.parse(record.provider.config)
        : (record.provider.config || {}) as Record<string, unknown>
      const { config: effectiveConfig } = resolveRechargeProviderConfig(
        record.provider.type,
        config,
        (record as any).providerConfigSnapshot
      )

      const rechargeAmount = Number(record.amount)
      const orderAmount = getRechargePayableAmount({
        amount: record.amount,
        paymentDetails: (record as any).paymentDetails
      })
      const creditedAmount = record.actualAmount !== null && record.actualAmount !== undefined ? Number(record.actualAmount) : rechargeAmount
      let tradeNo = ''
      let tradeNoForIdx = ''
      let actualAmount = creditedAmount
      let callbackPayload: Record<string, unknown> = { source: 'admin_sync', adminId: admin.id }
      let paymentDetails = (record as any).paymentDetails as Record<string, unknown> | undefined

      if (record.provider.type === 'yipay') {
        const { epayConfig, valid, error: configError } = buildEpayConfig(effectiveConfig)
        if (!valid) {
          request.log.warn({ orderNo: record.orderNo, error: configError }, '支付渠道配置不完整')
          return reply.status(400).send({ error: configError || '支付渠道配置不完整' })
        }

        const epay = createEpayClient(epayConfig)
        const queryResult = await epay.queryOrder(record.orderNo)

        request.log.info({ orderNo: record.orderNo, queryResult: { success: queryResult.success, paid: queryResult.paid } }, '管理员同步-易支付订单查询结果')

        if (!queryResult.success) {
          return {
            success: true,
            synced: false,
            status: record.status,
            message: '查询支付平台失败，请稍后重试'
          }
        }

        if (!queryResult.paid) {
          return {
            success: true,
            synced: false,
            status: 'pending',
            message: '支付平台返回订单未支付'
          }
        }

        tradeNo = queryResult.trade_no || ''
        tradeNoForIdx = getTradeNoForIndex(record.orderNo, tradeNo)

        const paidAmount = queryResult.money ? parseFloat(queryResult.money) : 0
        if (paidAmount > 0 && Math.abs(paidAmount - orderAmount) > 0.01) {
          request.log.warn(
            { orderNo: record.orderNo, orderAmount, paidAmount },
            '管理员同步-支付金额不匹配'
          )
          return reply.status(400).send({
            error: `支付金额与订单金额不匹配（应付: ${orderAmount}，实付: ${paidAmount}）`
          })
        }

        actualAmount = creditedAmount
        callbackPayload = { source: 'admin_sync', queryResult: sanitizeObject(queryResult.rawData) as Record<string, unknown>, adminId: admin.id }
      } else {
        const { heleketConfig, valid, error: configError } = buildHeleketConfig(effectiveConfig)
        if (!valid) {
          request.log.warn({ orderNo: record.orderNo, error: configError }, 'Heleket 支付渠道配置不完整')
          return reply.status(400).send({ error: configError || '支付渠道配置不完整' })
        }

        const heleket = createHeleketClient(heleketConfig)
        const queryResult = await heleket.getPaymentInfo({ order_id: record.orderNo })
        const status = extractHeleketStatus(queryResult)
        const paymentState = getHeleketPaymentState(queryResult)
        const statusMessage = getHeleketStatusDescription(status)

        request.log.info(
          { orderNo: record.orderNo, status, paymentState, uuid: queryResult.uuid, txid: queryResult.txid },
          '管理员同步-Heleket 订单查询结果'
        )

        callbackPayload = {
          source: 'admin_sync',
          heleketStatus: status,
          queryResult: sanitizeObject(queryResult) as Record<string, unknown>,
          adminId: admin.id
        }
        paymentDetails = mergeHeleketPaymentDetails(
          (record as any).paymentDetails,
          queryResult,
          heleketConfig,
          {
            orderNo: record.orderNo,
            invoiceAmount: orderAmount
          }
        ) as Record<string, unknown>

        if (paymentState === 'pending') {
          const heleketTradeNo = (
            (typeof queryResult.uuid === 'string' && queryResult.uuid.trim() ? queryResult.uuid : '') ||
            (typeof queryResult.txid === 'string' && queryResult.txid.trim() ? queryResult.txid : '') ||
            null
          )
          await db.updateRechargeOrderMetadata(record.orderNo, {
            tradeNo: heleketTradeNo,
            paymentDetails
          })

          return {
            success: true,
            synced: false,
            status: 'pending',
            message: statusMessage
          }
        }

        if (paymentState === 'cancelled') {
          await db.cancelRecharge(record.orderNo, callbackPayload, paymentDetails)
          request.log.info({ orderNo: record.orderNo, status }, '管理员同步-Heleket 订单已取消')
          return {
            success: true,
            synced: false,
            status: 'cancelled',
            message: statusMessage
          }
        }

        if (paymentState === 'failed') {
          await db.failRecharge(record.orderNo, statusMessage, callbackPayload, paymentDetails)
          request.log.info({ orderNo: record.orderNo, status }, '管理员同步-Heleket 订单已失败')
          return {
            success: true,
            synced: false,
            status: 'failed',
            message: statusMessage
          }
        }

        tradeNo = (
          (typeof queryResult.uuid === 'string' && queryResult.uuid.trim() ? queryResult.uuid : '') ||
          (typeof queryResult.txid === 'string' && queryResult.txid.trim() ? queryResult.txid : '') ||
          (typeof queryResult.order_id === 'string' && queryResult.order_id.trim() ? queryResult.order_id : '') ||
          record.orderNo
        ).trim()
        tradeNoForIdx = getTradeNoForIndex(record.orderNo, tradeNo)

        const invoiceAmount = getHeleketInvoiceAmount(queryResult)
        if (invoiceAmount === undefined || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
          request.log.warn({ orderNo: record.orderNo, queryResult: sanitizeObject(queryResult) }, '管理员同步-Heleket 支付金额无效')
          return {
            success: true,
            synced: false,
            status: record.status,
            message: '支付金额异常，请稍后重试'
          }
        }

        if (invoiceAmount + 0.01 < orderAmount) {
          request.log.warn(
            { orderNo: record.orderNo, orderAmount, invoiceAmount },
            '管理员同步-Heleket 支付金额不足'
          )
          return reply.status(400).send({
            error: `支付金额不足（应付: ${orderAmount}，账单金额: ${invoiceAmount}）`
          })
        }

        actualAmount = creditedAmount
      }

      // 检查是否已处理（防重放）
      const existingCallback = await prisma.paymentCallback.findUnique({
        where: {
          providerId_orderNo_tradeNo: {
            providerId: record.provider.id,
            orderNo: record.orderNo,
            tradeNo: tradeNoForIdx
          }
        }
      })

      if (existingCallback) {
        // 已处理过，重新查询订单状态
        const updatedRecord = await prisma.rechargeRecord.findUnique({
          where: { id: recordId }
        })
        return {
          success: true,
          synced: false,
          status: updatedRecord?.status || 'completed',
          message: '订单已处理过'
        }
      }

      // 11. 完成充值
      const completion = await db.completeRecharge(record.orderNo, {
        tradeNo,
        actualAmount,
        callbackData: callbackPayload,
        paymentDetails
      })

      // 记录已处理（防重放）
      await prisma.paymentCallback.create({
        data: {
          providerId: record.provider.id,
          orderNo: record.orderNo,
          tradeNo: tradeNoForIdx,
          callbackIp: 'admin_sync',
          processed: true
        }
      }).catch(() => { })

      if (!completion.completedNow) {
        return {
          success: true,
          synced: false,
          status: 'completed',
          message: '订单已处理过'
        }
      }

      // 记录日志
      await createLog(
        admin.id,
        'user',
        'admin.recharge.sync',
        `Admin synced recharge order: ${record.orderNo}, user: ${record.user?.username}, amount: ${actualAmount}, tradeNo: ${tradeNo || 'N/A'}`,
        'success'
      )

      // 发送充值成功通知
      try {
        await createInboxMessage({
          userId: record.userId,
          eventType: 'recharge_success',
          title: '充值到账通知',
          content: `您的充值已到账！\n充值金额：￥${actualAmount.toFixed(2)}\n订单号：${record.orderNo}\n交易号：${tradeNo || 'N/A'}`,
          data: {
            orderNo: record.orderNo,
            amount: actualAmount,
            tradeNo
          }
        })
      } catch (notifyError) {
        request.log.warn({ orderNo: record.orderNo, error: notifyError }, '发送充值成功通知失败')
      }

      request.log.info({ orderNo: record.orderNo, tradeNo, adminId: admin.id }, '管理员同步充值订单成功')

      return {
        success: true,
        synced: true,
        status: 'completed',
        message: '同步成功，充值已到账'
      }
    } catch (error) {
      request.log.error(error, '同步充值订单失败')
      return reply.status(500).send({ error: '同步失败，请稍后重试' })
    }
  })

  // ==================== 管理员创建实例 ====================

  // POST /api/admin/instances/create - 管理员为用户创建实例（支持免费赠送或付费实例）
  app.post('/api/admin/instances/create', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = request.user!
    const body = request.body as {
      username: string      // 目标用户名
      name: string          // 实例名称
      packageId: number     // 套餐ID
      planId?: number       // 付费方案ID（可选，传入则创建付费实例）
      chargeFirstMonth?: boolean  // 是否扣除用户首月费用（仅付费实例有效，默认 true）
      image: string         // 镜像Alias
      cpu?: number          // CPU（免费实例自定义配置）
      memory?: number       // 内存（免费实例自定义配置）
      disk?: number         // 硬盘（免费实例自定义配置）
      hostId: number        // 指定宿主机
      customInitCommandIds?: number[]  // 初始化命令
    }

    const { username, name, packageId, planId, chargeFirstMonth = true, image, cpu, memory, disk, hostId, customInitCommandIds } = body

    try {
      // 1. 验证必填参数
      if (!username || !name || !packageId || !image || !hostId || hostId <= 0) {
        return reply.status(400).send({ error: '缺少必填参数' })
      }

      // 2. 验证实例名称
      const nameValidation = validateName(name, 'Instance name', 2, 64)
      if (!nameValidation.valid) {
        return reply.status(400).send({ error: nameValidation.message })
      }

      // 3. 查找目标用户
      const targetUser = await prisma.user.findUnique({
        where: { username },
        select: { id: true, username: true, status: true, balance: true }
      })

      if (!targetUser) {
        return reply.status(400).send({ error: `用户 "${username}" 不存在` })
      }

      if (targetUser.status !== 'active') {
        return reply.status(400).send({ error: `用户 "${username}" 状态异常，无法创建实例` })
      }

      // 4. 获取目标用户的 SSH 密钥
      const targetUserSshKeys = await db.getSSHKeysByUserId(targetUser.id)
      if (targetUserSshKeys.length === 0) {
        return reply.status(400).send({ error: `用户 "${username}" 没有 SSH 密钥，请先让用户添加 SSH 密钥` })
      }
      const sshKey = targetUserSshKeys[0].public_key

      // 5. 验证套餐
      const pkg = await db.getPackageById(packageId)
      if (!pkg || !pkg.active) {
        return reply.status(400).send({ error: '套餐不存在或已禁用' })
      }

      // 6. 处理付费方案（如果选择了 planId）
      let selectedPlan: Awaited<ReturnType<typeof db.getPlanById>> = null
      let billing: ReturnType<typeof calculateCreateBilling> | null = null

      if (planId) {
        selectedPlan = await db.getPlanById(planId)
        if (!selectedPlan || selectedPlan.packageId !== packageId) {
          return reply.status(400).send({ error: '方案不存在或不属于该套餐' })
        }
        if (!selectedPlan.isActive) {
          return reply.status(400).send({ error: '方案已下架' })
        }
        if (selectedPlan.isSoldOut) {
          return reply.status(400).send({ error: '方案已售罄', code: 'PLAN_SOLD_OUT' })
        }

        // 计算费用
        billing = calculateCreateBilling(selectedPlan)

        // 如果需要扣除首月费用，检查用户余额
        if (chargeFirstMonth) {
          const userBalance = Number(targetUser.balance)
          if (userBalance < billing.totalPrice) {
            return reply.status(400).send({
              error: `用户余额不足，需要 ¥${billing.totalPrice.toFixed(2)}，当前余额 ¥${userBalance.toFixed(2)}`
            })
          }
        }
      }

      // 7. 确定资源配置
      // 付费实例使用方案配置，免费实例使用自定义配置
      const requestedCpu = selectedPlan ? selectedPlan.cpu : (cpu || 15)
      const requestedMemory = selectedPlan ? selectedPlan.memory : (memory || 128)
      const requestedDisk = selectedPlan ? selectedPlan.disk : (disk || 512)

      // 8. 验证镜像
      if (!await isValidSystemImage(image)) {
        return reply.status(400).send({ error: '镜像不存在' })
      }

      const pkgInstanceType = (pkg as typeof pkg & { instance_type?: 'container' | 'vm' }).instance_type || 'container'
      if (!await isImageCompatibleWithInstanceType(image, pkgInstanceType)) {
        return reply.status(400).send({ error: '镜像类型与套餐类型不兼容' })
      }

      // 8.1 验证镜像与内存配置的兼容性（128MB 只允许 Alpine/Debian）
      if (!await isImageCompatibleWithMemory(image, requestedMemory)) {
        return reply.status(400).send({ error: '128MB内存只能使用 Alpine/Debian 镜像' })
      }

      // 9. 选择宿主机
      const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
      const pkgWithExtras = pkg as typeof pkg & { node_selectors?: string; port_limit?: number; snapshot_limit?: number; backup_limit?: number; site_limit?: number }

      const preCheckHost = await db.selectAvailableHost({
        packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
        nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
        cpu: requestedCpu,
        memory: requestedMemory,
        disk: requestedDisk,
        hostId: hostId,
        ownerId: pkg.user_id!
      })

      if (!preCheckHost) {
        return reply.status(400).send({ error: '指定宿主机不可用' })
      }

      // 10. 验证实例类型兼容性
      const hostInstanceType = preCheckHost.instance_type || 'container'
      const effectiveInstanceType = pkgInstanceType

      if (effectiveInstanceType === 'vm' && hostInstanceType === 'container') {
        return reply.status(400).send({ error: '套餐要求虚拟机，但节点只支持容器' })
      }
      if (effectiveInstanceType === 'container' && hostInstanceType === 'vm') {
        return reply.status(400).send({ error: '套餐要求容器，但节点只支持虚拟机' })
      }

      const hostImageAvailability = await getSystemImageAvailabilityForHost(image, preCheckHost.id, {
        instanceType: effectiveInstanceType,
        memory: requestedMemory
      })
      if (!hostImageAvailability.ok) {
        switch (hostImageAvailability.reason) {
          case 'host_not_found':
            return reply.status(404).send({ error: '宿主机不存在' })
          case 'image_not_found':
            return reply.status(400).send({ error: '镜像不存在' })
          case 'memory_incompatible':
            return reply.status(400).send({ error: '128MB内存只能使用 Alpine/Debian 镜像' })
          case 'instance_type_mismatch':
            return reply.status(400).send({ error: '镜像类型与套餐类型不兼容' })
          case 'host_instance_type_mismatch':
            return reply.status(400).send({ error: '套餐类型与宿主机不兼容' })
          default:
            return reply.status(400).send({ error: '选择的镜像在当前节点不可用' })
        }
      }

      // 11. 处理自定义初始化命令
      let extraShellCommands: string | undefined
      if (customInitCommandIds && customInitCommandIds.length > 0) {
        const cmdValidation = await validateCommandsOwnership(customInitCommandIds, targetUser.id)
        if (cmdValidation.valid && cmdValidation.commands.length > 0) {
          const imageDistro = getImageDistroFromAlias(image)
          const compatibleCmds = cmdValidation.commands.filter(cmd =>
            cmd.distros.includes('all') || cmd.distros.includes(imageDistro)
          )
          if (compatibleCmds.length > 0) {
            extraShellCommands = mergeCommandContents(compatibleCmds)
          }
        }
      }

      // 12. 生成配置
      const networkMode = (pkg.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
      if (effectiveInstanceType === 'vm' && ['nat_ipv6_nat', 'ipv6_nat'].includes(networkMode)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'KVM packages do not support IPv4 NAT & IPv6 NAT or IPv6 NAT network modes'))
      }
      const autoPassword = generateRandomPassword(16)
      const { configPayload, metaData } = generateIncusConfig({
        instanceName: name,
        imageAlias: image,
        rootPassword: autoPassword,
        sshKey: sshKey,
        networkMode,
        type: effectiveInstanceType === 'vm' ? 'virtual-machine' : 'container',
        extraShellCommands
      })

      // 13. 生成 IncusId（使用目标用户 ID）
      const shortId = nanoid()
      const incusId = `u${targetUser.id}-${shortId}`

      // 14. 获取套餐流量限额
      const packageTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null

      // 15. 事务创建实例
      const { Prisma } = await import('@prisma/client')
      let instanceId: number
      let host: Awaited<ReturnType<typeof db.selectAndReserveHostWithLock>>
      const normalizedPlanTrafficLimitSpeed = selectedPlan
        ? normalizePlanTrafficLimitSpeed(selectedPlan.trafficLimitSpeed)
        : null
      if (normalizedPlanTrafficLimitSpeed === undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit speed'))
      }

      const result = await prisma.$transaction(async (tx) => {
        // 使用行锁选择并预占宿主机资源
        const lockedHost = await db.selectAndReserveHostWithLock(tx, {
          packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
          nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
          cpu: requestedCpu,
          memory: requestedMemory,
          disk: requestedDisk,
          hostId: hostId,
          ownerId: pkg.user_id!,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(networkMode) ? (selectedPlan?.portLimit || pkgWithExtras.port_limit || 0) : 0
        })

        if (!lockedHost) {
          throw new Error('HOST_RESOURCES_INSUFFICIENT')
        }

        const planBandwidthLimit = normalizedPlanTrafficLimitSpeed

        const baseMonthlyTrafficLimit = selectedPlan ? selectedPlan.trafficLimit : packageTrafficLimit
        const effectiveMonthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
          packageId,
          hostId: lockedHost.id,
          baseTrafficLimit: baseMonthlyTrafficLimit
        })

        const instanceQuota = selectedPlan ? {
          portLimit: selectedPlan.portLimit,
          snapshotLimit: selectedPlan.snapshotLimit,
          backupLimit: selectedPlan.backupLimit,
          siteLimit: selectedPlan.siteLimit,
          swapSize: effectiveInstanceType === 'container' ? selectedPlan.swapSize : null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: planBandwidthLimit,
          limitsEgress: planBandwidthLimit
        } : {
          portLimit: pkgWithExtras.port_limit ?? null,
          snapshotLimit: pkgWithExtras.snapshot_limit ?? null,
          backupLimit: pkgWithExtras.backup_limit ?? null,
          siteLimit: pkgWithExtras.site_limit ?? null,
          swapSize: null as number | null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: null as string | null,
          limitsEgress: null as string | null
        }

        // 快照配置
        const snapshotSpecs = {
          packageId: pkg.id,
          packageName: pkg.name,
          planId: selectedPlan?.id ?? null,
          planName: selectedPlan?.name ?? null,
          cpuMax: pkg.cpu_max,
          memoryMax: pkg.memory_max,
          diskMax: pkg.disk_max,
          networkMode,
          portLimit: selectedPlan?.portLimit || pkgWithExtras.port_limit || 20,
          nested: Boolean(pkg.nested),
          privileged: Boolean(pkg.privileged),
          nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
          createdAt: new Date().toISOString(),
          adminGift: true,
          giftBy: admin.id,
          isPaidInstance: !!selectedPlan,
          chargedFirstMonth: !!selectedPlan && chargeFirstMonth
        }

        // 如果是付费实例且需要扣除首月费用，执行扣款
        let txBalanceLogId: number | null = null
        if (selectedPlan && billing && chargeFirstMonth) {
          const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, targetUser.id)
          if (!balanceLocked) {
            throw new Error('BALANCE_CONFLICT: 余额正在处理，请稍后重试')
          }

          // 获取用户当前余额（事务内再次检查）
          const userRecord = await tx.user.findUnique({
            where: { id: targetUser.id },
            select: { balance: true }
          })

          if (!userRecord) {
            throw new Error('USER_NOT_FOUND: 用户不存在')
          }

          const balanceBefore = Number(userRecord.balance)

          if (balanceBefore < billing.totalPrice) {
            throw new Error('BALANCE_INSUFFICIENT: 余额不足')
          }

          // 扣除余额
          const balanceUpdateResult = await tx.user.updateMany({
            where: {
              id: targetUser.id,
              balance: { gte: billing.totalPrice }
            },
            data: { balance: { decrement: billing.totalPrice } }
          })

          if (balanceUpdateResult.count === 0) {
            throw new Error('BALANCE_INSUFFICIENT: 余额不足或并发冲突')
          }

          const updatedUserRecord = await tx.user.findUnique({
            where: { id: targetUser.id },
            select: { balance: true }
          })
          if (!updatedUserRecord) {
            throw new Error('USER_NOT_FOUND: 用户不存在')
          }
          const balanceAfter = Number(updatedUserRecord.balance)

          // 记录余额日志
          const balanceLog = await tx.balanceLog.create({
            data: {
              userId: targetUser.id,
              type: 'consume',
              amount: -billing.totalPrice,
              balanceBefore,
              balanceAfter,
              remark: `管理员开通付费实例（${billing.billingCycle}个月）：${pkg.name} - ${selectedPlan.name}`
            }
          })
          txBalanceLogId = balanceLog.id
        }

        // 创建实例记录
        const instance = await tx.instance.create({
          data: {
            incusId,
            name,
            userId: targetUser.id,
            hostId: lockedHost.id,
            packageId,
            packagePlanId: selectedPlan?.id ?? null,
            image,
            cpu: requestedCpu,
            memory: requestedMemory,
            disk: requestedDisk,
            networkMode,
            snapshottedSpecs: snapshotSpecs as any,
            sshPort: metaData.sshPort,
            rootPassword: encryptSensitiveData(metaData.rootPassword),
            status: 'creating',
            monthlyTrafficLimit: instanceQuota.monthlyTrafficLimit,
            portLimit: instanceQuota.portLimit,
            snapshotLimit: instanceQuota.snapshotLimit,
            backupLimit: instanceQuota.backupLimit,
            siteLimit: instanceQuota.siteLimit,
            swapEnabled: false,
            swapSize: instanceQuota.swapSize,
            limitsIngress: instanceQuota.limitsIngress,
            limitsEgress: instanceQuota.limitsEgress,
            // 计费信息：付费实例设置到期时间和计费周期，免费实例则为 null
            expiresAt: billing?.expiresAt ?? null,
            billingPrice: billing?.price ?? null,
            billingCycle: billing?.billingCycle ?? null,
            autoRenew: false
          }
        })

        // 更新余额日志，添加 instanceId
        if (txBalanceLogId) {
          await tx.balanceLog.update({
            where: { id: txBalanceLogId },
            data: { instanceId: instance.id }
          })
        }

        // 如果是付费实例，创建计费记录
        if (selectedPlan && billing) {
          await tx.instanceBillingRecord.create({
            data: {
              instanceId: instance.id,
              userId: targetUser.id,
              type: 'newPurchase',
              amount: chargeFirstMonth ? billing.totalPrice : 0,
              months: billing.billingCycle,
              periodStart: new Date(),
              periodEnd: billing.expiresAt,
              balanceLogId: txBalanceLogId,
              remark: chargeFirstMonth
                ? `管理员开通 ${billing.billingCycle} 个月`
                : `管理员赠送首月（未扣费）`
            }
          })
        }

        return { instanceId: instance.id, host: lockedHost, planBandwidthLimit }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000
      })

      instanceId = result.instanceId
      host = result.host

      if (!host) {
        throw new Error('Host should not be null after successful transaction')
      }

      // 16. 分配 IP
      let staticIPv4: string | null = null
      let staticIPv6: string | null = null

      try {
        let attempts = 0
        const maxAttempts = 50
        while (attempts < maxAttempts) {
          staticIPv4 = generateRandomIPv4()
          const exists = await db.isIpAddressExistsOnHost(staticIPv4, host.id)
          if (!exists) break
          attempts++
          staticIPv4 = null
        }
      } catch (err) {
        console.error('[Admin Create Instance] IPv4 分配错误:', err)
      }

      const hostWithIpv6 = host as typeof host & {
        ipv6_mode?: number
        ipv6_subnet?: string | null
        ipv6_gateway?: string | null
        ipv6_parent_interface?: string | null
      }

      // 仅 Routed 模式（需要独立 IPv6 地址）才从子网分配
      const needsRoutedIPv6 = ['nat_ipv6', 'ipv6_only'].includes(networkMode)
      if (hostWithIpv6.ipv6_subnet && needsRoutedIPv6) {
        try {
          let attempts = 0
          const maxAttempts = 50
          while (attempts < maxAttempts) {
            staticIPv6 = generateRandomIPv6(hostWithIpv6.ipv6_subnet)
            const exists = await db.isIpAddressExists(staticIPv6)
            if (!exists) break
            attempts++
            staticIPv6 = null
          }
        } catch (err) {
          console.warn('[Admin Create Instance] IPv6 分配错误:', err)
        }
      }

      // VM 和容器都需要在 IP 分配完成后重新生成 cloud-init network-config
      let finalConfigPayload = configPayload
      if (effectiveInstanceType === 'vm') {
        const { generateVmConfig } = await import('../lib/incus-config-vm.js')
        const vmResult = generateVmConfig({
          instanceName: name,
          instanceIdSeed: incusId,
          imageAlias: image,
          rootPassword: metaData.rootPassword,
          sshKey: sshKey,
          network: staticIPv4 ? {
            ipAddress: `${staticIPv4}/22`,
            gateway: '10.10.0.1',  // NAT 网关 (与 incusbr0 一致)
            dns: ['8.8.8.8', '1.1.1.1'],
            ipv6Address: staticIPv6 ? `${staticIPv6}` : undefined,
            ipv6Gateway: staticIPv6 ? (hostWithIpv6.ipv6_gateway || undefined) : undefined
          } : undefined,
          extraShellCommands
        })
        finalConfigPayload = vmResult.configPayload
        console.log(`[Admin Create Instance] VM network-config 已更新: IPv4=${staticIPv4 || 'dhcp'}, IPv6=${staticIPv6 || 'none'}`)
      } else if (staticIPv4) {
        // 容器类型：重新生成包含静态 IP 的 cloud-init 配置
        const containerResult = generateIncusConfig({
          instanceName: name,
          imageAlias: image,
          rootPassword: metaData.rootPassword,
          sshKey: sshKey,
          networkMode,
          type: 'container',
          network: {
            ipAddress: `${staticIPv4}/22`,
            gateway: '10.10.0.1',
            dns: ['8.8.8.8', '1.1.1.1'],
            ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
            ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
          },
          extraShellCommands
        })
        finalConfigPayload = containerResult.configPayload
        console.log(`[Admin Create Instance] Container network-config 已更新: IPv4=${staticIPv4}, IPv6=${staticIPv6 || 'none'}`)
      }

      // 17. 选择存储池
      let selectedStoragePool = await db.resolveStoragePoolForNewInstance(host.id, { packageId })
      if (!selectedStoragePool) {
        selectedStoragePool = 'default'
      }

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          storagePoolName: selectedStoragePool
        }
      })

      // 18. 异步创建实例
      const pkgConfig = pkg as typeof pkg & {
        io_limit_mode?: string
        limits_read?: string | null
        limits_write?: string | null
        limits_read_iops?: number | null
        limits_write_iops?: number | null
        limits_ingress?: string | null
        limits_egress?: string | null
        limits_processes?: number | null
        limits_cpu_priority?: number | null
        boot_autostart?: boolean | null
        boot_autostart_priority?: number | null
        boot_autostart_delay?: number | null
        boot_host_shutdown_timeout?: number | null
      }

      // 计算带宽限制：使用事务中计算的方案带宽限制（如果有），否则使用套餐默认值
      const effectiveBandwidthLimit = result.planBandwidthLimit

      // 根据 ioLimitMode 选择性传入 IO 限制参数
      const ioMode = pkgConfig.io_limit_mode || 'throughput'

      createInstanceAsync(instanceId, host, {
        name: incusId,
        image,
        cpu: requestedCpu,
        memory: requestedMemory,
        disk: requestedDisk,
        swapEnabled: false,
        swapSize: effectiveInstanceType === 'container' ? (selectedPlan?.swapSize ?? null) : null,
        cloudInitConfig: finalConfigPayload,
        networkMode,
        nested: Boolean(pkg.nested),
        privileged: Boolean(pkg.privileged),
        portLimit: pkgWithExtras.port_limit || 20,
        instanceType: effectiveInstanceType,
        sshPort: metaData.sshPort,
        storagePool: selectedStoragePool,
        ipv4Address: staticIPv4,
        ipv6Address: staticIPv6,
        ipv6Gateway: hostWithIpv6.ipv6_gateway || null,
        hostInterface: hostWithIpv6.ipv6_parent_interface || 'eth0',
        limitsRead: ioMode === 'throughput' ? pkgConfig.limits_read : null,
        limitsWrite: ioMode === 'throughput' ? pkgConfig.limits_write : null,
        limitsReadIops: ioMode === 'iops' ? pkgConfig.limits_read_iops : null,
        limitsWriteIops: ioMode === 'iops' ? pkgConfig.limits_write_iops : null,
        limitsIngress: effectiveBandwidthLimit || pkgConfig.limits_ingress,
        limitsEgress: effectiveBandwidthLimit || pkgConfig.limits_egress,
        limitsProcesses: pkgConfig.limits_processes,
        limitsCpuPriority: pkgConfig.limits_cpu_priority,
        bootAutostart: pkgConfig.boot_autostart,
        bootAutostartPriority: pkgConfig.boot_autostart_priority,
        bootAutostartDelay: pkgConfig.boot_autostart_delay,
        bootHostShutdownTimeout: pkgConfig.boot_host_shutdown_timeout
      }, targetUser.id, { cpu: requestedCpu, memory: requestedMemory, disk: requestedDisk }).catch(err => {
        console.error(`[Admin Create Instance] 实例 ${instanceId} 创建失败:`, err)
      })

      // 19. 记录操作日志
      const logDetail = selectedPlan
        ? `Admin created paid instance "${name}" for user ${targetUser.username} (Package: ${pkg.name}, Plan: ${selectedPlan.name}, Charged: ${chargeFirstMonth ? `¥${billing!.totalPrice.toFixed(2)}` : 'Free first month'})`
        : `Admin created free instance "${name}" for user ${targetUser.username} (Package: ${pkg.name}, Free Gift)`

      await createLog(
        admin.id,
        'admin',
        'instance.admin_create',
        logDetail,
        'success',
        { instanceId }
      )

      // 20. 发送站内信通知用户
      // 格式化资源配置
      const formatMemory = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
      const formatDiskSize = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`
      const resourceInfo = `CPU ${requestedCpu}% | 内存 ${formatMemory(requestedMemory)} | 磁盘 ${formatDiskSize(requestedDisk)}`

      // 构建通知内容
      let notifyContent: string
      let notifyTitle: string
      if (selectedPlan) {
        notifyTitle = chargeFirstMonth ? '开通付费实例' : '收到付费实例赠送'
        notifyContent = chargeFirstMonth
          ? `管理员为您开通了一台付费实例：${name}
套餐：${pkg.name}
方案：${selectedPlan.name}
配置：${resourceInfo}
节点：${host.name}
扣费：¥${billing!.totalPrice.toFixed(2)}
到期时间：${billing!.expiresAt.toLocaleDateString()}`
          : `管理员为您赠送了一台付费实例：${name}
套餐：${pkg.name}
方案：${selectedPlan.name}
配置：${resourceInfo}
节点：${host.name}
首月免费，到期时间：${billing!.expiresAt.toLocaleDateString()}
次月将按方案价格正常计费`
      } else {
        notifyTitle = '收到实例赠送'
        notifyContent = `管理员为您创建了一台实例：${name}\n套餐：${pkg.name}\n配置：${resourceInfo}\n节点：${host.name}`
      }

      await createInboxMessage({
        userId: targetUser.id,
        eventType: selectedPlan ? 'instance_paid_created' : 'instance_gift',
        title: notifyTitle,
        content: notifyContent,
        data: {
          instanceId,
          instanceName: name,
          packageName: pkg.name,
          planName: selectedPlan?.name ?? null,
          cpu: requestedCpu,
          memory: requestedMemory,
          disk: requestedDisk,
          hostName: host.name,
          isPaid: !!selectedPlan,
          charged: chargeFirstMonth,
          amount: billing?.totalPrice ?? 0,
          expiresAt: billing?.expiresAt?.toISOString() ?? null
        }
      })

      // 发送管理员创建实例邮件通知
      try {
        const targetUserWithEmail = await prisma.user.findUnique({
          where: { id: targetUser.id },
          select: { email: true }
        })
        if (targetUserWithEmail?.email) {
          await sendAdminInstanceCreatedEmail(targetUserWithEmail.email, {
            username: targetUser.username,
            instanceName: name,
            packageName: pkg.name,
            planName: selectedPlan?.name,
            hostName: host.name,
            cpu: requestedCpu,
            memory: requestedMemory,
            disk: requestedDisk,
            isPaid: !!selectedPlan,
            charged: chargeFirstMonth,
            amount: billing?.totalPrice,
            expiresAt: billing?.expiresAt
          })
        }
      } catch (emailErr) {
        console.warn(`[Admin Create Instance] 发送邮件失败:`, emailErr)
      }

      return reply.status(202).send({
        message: '实例创建中',
        instance: {
          id: instanceId,
          name,
          incusId,
          host: host.name,
          status: 'creating',
          user: { id: targetUser.id, username: targetUser.username },
          sshPort: metaData.sshPort,
          rootPassword: metaData.rootPassword,
          isPaid: !!selectedPlan,
          planName: selectedPlan?.name ?? null,
          charged: chargeFirstMonth,
          amount: billing?.totalPrice ?? 0,
          expiresAt: billing?.expiresAt?.toISOString() ?? null
        }
      })

    } catch (error: any) {
      console.error('[Admin Create Instance] 创建失败:', error)

      if (error.message?.includes('HOST_RESOURCES_INSUFFICIENT')) {
        return reply.status(503).send({ error: '宿主机资源不足或已被占用' })
      }

      if (error.message?.includes('BALANCE_INSUFFICIENT')) {
        return reply.status(400).send({ error: '用户余额不足' })
      }

      if (error.message?.includes('BALANCE_CONFLICT')) {
        return reply.status(409).send({ error: '用户余额正在处理，请稍后重试' })
      }

      if (error.message?.includes('USER_NOT_FOUND')) {
        return reply.status(400).send({ error: '用户不存在' })
      }

      return reply.status(500).send({ error: error.message || '创建失败' })
    }
  })

  // ==================== 管理员升级方案 ====================

  // GET /api/admin/instances/:id/available-plans - 获取可升级的方案列表
  app.get('/api/admin/instances/:id/available-plans', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const instanceId = parsePositiveRouteId(id)
      if (!instanceId) {
        return reply.status(400).send({ error: '无效的实例ID' })
      }

      // 获取实例信息
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          packagePlan: true,
          package: true,
          user: { select: { id: true, username: true, balance: true } }
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (!instance.packagePlanId || !instance.packagePlan) {
        return reply.status(400).send({ error: '该实例不是付费实例，无法切换方案' })
      }

      // 当前方案信息
      const currentPlan = instance.packagePlan

      // 获取同一套餐下的所有激活方案
      const allPlans = await prisma.packagePlan.findMany({
        where: {
          packageId: instance.packageId!,
          isActive: true,
          isSoldOut: false
        },
        orderBy: { sortOrder: 'asc' }
      })

      const quotedPlans = await Promise.all(
        allPlans
          .filter(plan => plan.id !== currentPlan.id)
          .map(async plan => {
            const preview = await db.calculatePlanChange(instance, plan, {
              preciseRemainingDays: true,
              minRemainingDays: null
            })

            return {
              plan,
              preview
            }
          })
      )

      // 过滤出可升级的方案，并直接返回服务端报价结果
      const availablePlans = quotedPlans
        .filter(item => item.preview.isUpgrade)
        .map(({ plan, preview }) => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: Number(plan.price) / 100,  // 分转元
          billingCycle: plan.billingCycle,
          monthlyPrice: Number((Number(plan.price) / plan.billingCycle / 100).toFixed(2)),
          cpu: plan.cpu,
          memory: plan.memory,
          disk: plan.disk,
          portLimit: plan.portLimit,
          snapshotLimit: plan.snapshotLimit,
          backupLimit: plan.backupLimit,
          siteLimit: plan.siteLimit,
          swapSize: (instance.package?.instanceType === 'vm' ? 0 : plan.swapSize),
          trafficLimit: plan.trafficLimit.toString(),
          isSoldOut: plan.isSoldOut,
          slaGuarantee: plan.slaGuarantee,
          priceDiff: preview.priceDiff
        }))

      const remainingDays = instance.expiresAt
        ? Math.max(0, (instance.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0

      return {
        currentPlan: {
          id: currentPlan.id,
          name: currentPlan.name,
          price: instance.billingPrice ? Number(instance.billingPrice) : Number(currentPlan.price) / 100,
          billingCycle: currentPlan.billingCycle,
          monthlyPrice: Number(calculateMonthlyPrice(
            instance.billingPrice ? Number(instance.billingPrice) : Number(currentPlan.price) / 100,
            instance.billingCycle || currentPlan.billingCycle
          ).toFixed(2)),
          cpu: currentPlan.cpu,
          memory: currentPlan.memory,
          disk: currentPlan.disk
        },
        remainingDays,
        availablePlans,
        userBalance: Number(instance.user?.balance || 0)
      }
    } catch (error) {
      request.log.error(error, '获取可升级方案列表失败')
      return reply.status(500).send({ error: '获取可升级方案列表失败' })
    }
  })

  // POST /api/admin/instances/:id/upgrade-plan - 管理员升级实例方案
  app.post('/api/admin/instances/:id/upgrade-plan', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const admin = request.user!
      const { id } = request.params as { id: string }
      const { newPlanId } = request.body as { newPlanId: number }

      const instanceId = parsePositiveRouteId(id)
      if (!instanceId) {
        return reply.status(400).send({ error: '无效的实例ID' })
      }

      if (!Number.isSafeInteger(newPlanId) || newPlanId <= 0) {
        return reply.status(400).send({ error: '无效的新方案ID' })
      }

      // 1. 获取实例信息
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: {
          user: { select: { id: true, username: true, balance: true } },
          packagePlan: true,
          package: true,
          host: true
        }
      })

      if (!instance) {
        return reply.status(404).send({ error: '实例不存在' })
      }

      if (!instance.packagePlanId || !instance.packagePlan) {
        return reply.status(400).send({ error: '该实例不是付费实例，无法切换方案' })
      }

      if (instance.status === 'deleted') {
        return reply.status(400).send({ error: '实例已删除' })
      }

      // 2. 获取新方案信息
      const newPlan = await prisma.packagePlan.findUnique({
        where: { id: newPlanId }
      })

      if (!newPlan) {
        return reply.status(404).send({ error: '新方案不存在' })
      }

      if (!newPlan.isActive) {
        return reply.status(400).send({ error: '新方案已下架' })
      }
      if (newPlan.isSoldOut) {
        return reply.status(400).send({ error: '新方案已售罄', code: 'PLAN_SOLD_OUT' })
      }

      // 3. 验证新方案属于同一套餐
      if (newPlan.packageId !== instance.packageId) {
        return reply.status(400).send({ error: '新方案不属于同一套餐' })
      }

      // 4. 统一计算升级报价（仅保留管理员权限差异，不再分叉金额口径）
      const currentPlan = instance.packagePlan
      const changeQuote = await db.calculatePlanChange(instance, newPlan, {
        preciseRemainingDays: true,
        minRemainingDays: null
      })

      if (changeQuote.remainingDays <= 0) {
        return reply.status(400).send({ error: '实例已过期，请先续费后再升级方案' })
      }

      if (!changeQuote.isUpgrade) {
        return reply.status(400).send({ error: '只能升级到更高价格的方案' })
      }

      const priceDifference = changeQuote.priceDiff

      // 8. 验证用户余额
      const userBalance = Number(instance.user!.balance)
      if (priceDifference > userBalance) {
        return reply.status(400).send({
          error: `用户余额不足，需要 ¥${priceDifference.toFixed(2)}，当前余额 ¥${userBalance.toFixed(2)}`
        })
      }

      // 9. 检查是否需要同步到 Incus（资源变更）
      const resourcesChanged = (
        newPlan.cpu !== currentPlan.cpu ||
        newPlan.memory !== currentPlan.memory ||
        newPlan.disk !== currentPlan.disk
      )

      // 10. 执行事务：扣款 + 更新数据库
      await prisma.$transaction(async (tx) => {
        let balanceBefore = userBalance
        let balanceAfter = balanceBefore
        const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
          packageId: instance.packageId,
          hostId: instance.hostId,
          baseTrafficLimit: newPlan.trafficLimit
        })

        // 扣除用户余额
        if (priceDifference > 0) {
          const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)
          if (!balanceLocked) {
            throw new Error('BALANCE_CONFLICT: 用户余额正在处理，请稍后重试')
          }

          const userUpdateResult = await tx.user.updateMany({
            where: { id: instance.userId, balance: { gte: priceDifference } },
            data: { balance: { decrement: priceDifference } }
          })
          if (userUpdateResult.count !== 1) {
            throw new Error('BALANCE_INSUFFICIENT: 用户余额不足')
          }
          const updatedUser = await tx.user.findUnique({
            where: { id: instance.userId },
            select: { balance: true }
          })
          balanceAfter = Number(updatedUser?.balance || 0)
          balanceBefore = roundMoney(balanceAfter + priceDifference)
        }

        // 记录余额变动日志
        const balanceLog = await tx.balanceLog.create({
          data: {
            userId: instance.userId,
            type: 'consume',
            amount: -priceDifference,
            balanceBefore,
            balanceAfter,
            instanceId,
            remark: `方案升级：${currentPlan.name} → ${newPlan.name}，剩余 ${Math.ceil(changeQuote.remainingDays)} 天补差价`
          }
        })

        // 更新实例信息
        await tx.instance.update({
          where: { id: instanceId },
          data: {
            packagePlanId: newPlan.id,
            // 更新资源配置
            cpu: newPlan.cpu,
            memory: newPlan.memory,
            disk: newPlan.disk,
            // 更新配额
            portLimit: newPlan.portLimit,
            snapshotLimit: newPlan.snapshotLimit,
            backupLimit: newPlan.backupLimit,
            siteLimit: newPlan.siteLimit,
            swapEnabled: instance.package?.instanceType === 'vm' ? false : instance.swapEnabled,
            swapSize: instance.package?.instanceType === 'vm'
              ? null
              : (shouldSyncInstanceSwapSizeWithPlan(instance.swapSize, currentPlan.swapSize)
                  ? newPlan.swapSize
                  : instance.swapSize),
            monthlyTrafficLimit,
            trafficStatus: calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, monthlyTrafficLimit),
            // 更新计费信息（续费价格和周期）
            billingPrice: Number(newPlan.price) / 100,
            billingCycle: newPlan.billingCycle
          }
        })

        // 记录计费记录
        await tx.instanceBillingRecord.create({
          data: {
            instanceId,
            userId: instance.userId,
            type: 'upgrade',
            amount: priceDifference,
            months: 0,  // 升级不改变时长
            periodStart: new Date(),
            periodEnd: instance.expiresAt || new Date(),
            balanceLogId: balanceLog.id,
            remark: `方案升级：${currentPlan.name} → ${newPlan.name}（操作者: ${admin.username}）`
          }
        })
      })

      try {
        const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
        await reconcileTrafficStateForInstanceIds([instanceId])
      } catch (err) {
        request.log.warn(err, '实例方案已更新，流量状态即时复核失败')
      }

      // 9. 同步资源配置到 Incus（如果有变更）
      if (resourcesChanged && instance.host) {
        try {
          const { patchInstanceResources } = await import('../lib/incus/incus-instances.js')
          const client = await getIncusClient(instance.host)
          await patchInstanceResources(client, instance.incusId, {
            cpu: newPlan.cpu,
            memory: newPlan.memory,
            disk: newPlan.disk
          })
          console.log(`[Upgrade Plan] Synced resources to Incus for instance ${instance.name}`)
        } catch (incusErr) {
          // Incus 同步失败不影响数据库更新，但记录日志
          request.log.error(incusErr, `Incus 资源同步失败: ${instance.name}`)
        }

        // 更新宿主机资源使用量
        const cpuDelta = newPlan.cpu - currentPlan.cpu
        const memoryDelta = newPlan.memory - currentPlan.memory
        const diskDelta = newPlan.disk - currentPlan.disk
        if (cpuDelta !== 0 || memoryDelta !== 0 || diskDelta !== 0) {
          await db.updateHostResources(instance.hostId, {
            cpuUsed: instance.host.cpuUsed + cpuDelta,
            memoryUsed: instance.host.memoryUsed + memoryDelta,
            diskUsed: instance.host.diskUsed + diskDelta
          })
        }
      }

      // 10. 记录操作日志
      await createLog(
        admin.id,
        'admin',
        'instance.upgrade_plan',
        `Admin upgraded instance "${instance.name}" plan: ${currentPlan.name} → ${newPlan.name} (User: ${instance.user?.username}, PriceDiff: ¥${priceDifference.toFixed(2)})`,
        'success',
        { instanceId }
      )

      // 11. 发送通知
      await sendNotification(instance.userId, 'instance_plan_changed', {
        instanceName: instance.name,
        oldPlanName: currentPlan.name,
        newPlanName: newPlan.name,
        priceDiff: priceDifference
      })

      return {
        success: true,
        message: `方案已升级，补差价 ¥${priceDifference.toFixed(2)}`,
        priceDifference,
        oldPlan: { id: currentPlan.id, name: currentPlan.name },
        newPlan: { id: newPlan.id, name: newPlan.name },
        resourcesSynced: resourcesChanged
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('BALANCE_CONFLICT')) {
        return reply.status(409).send({ error: '用户余额正在处理，请稍后重试' })
      }
      if (errorMessage.includes('BALANCE_INSUFFICIENT')) {
        return reply.status(400).send({ error: '用户余额不足' })
      }
      request.log.error(error, '升级方案失败')
      return reply.status(500).send({ error: '升级方案失败' })
    }
  })
}

// 异步创建实例函数（从 instances.ts 复制，简化版）
async function createInstanceAsync(
  instanceId: number,
  host: Host,
  config: {
    name: string
    image: string
    cpu: number
    memory: number
    disk: number
    swapEnabled?: boolean
    swapSize?: number | null
    cloudInitConfig?: Record<string, string>
    networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    nested?: boolean
    privileged?: boolean
    portLimit?: number
    instanceType?: 'container' | 'vm'
    sshPort?: number | null
    storagePool?: string | null
    ipv4Address?: string | null
    ipv6Address?: string | null
    ipv6Gateway?: string | null
    hostInterface?: string | null
    limitsRead?: string | null
    limitsWrite?: string | null
    limitsReadIops?: number | null
    limitsWriteIops?: number | null
    limitsIngress?: string | null
    limitsEgress?: string | null
    limitsProcesses?: number | null
    limitsCpuPriority?: number | null
    bootAutostart?: boolean | null
    bootAutostartPriority?: number | null
    bootAutostartDelay?: number | null
    bootHostShutdownTimeout?: number | null
  },
  userId: number,
  resources: { cpu: number; memory: number; disk: number }
): Promise<void> {
  try {
    console.log(`\n[Admin Provisioning] ===== 开始创建实例流程 =====`)
    console.log(`[Admin Provisioning] 实例ID: ${instanceId}, 名称: ${config.name}, 宿主机: ${host.name}`)

    const client = await getIncusClient(host)

    const ipv6Config = config.ipv6Address ? { primaryIp: config.ipv6Address } : null

    const incusConfig = buildInstanceConfig({
      name: config.name,
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      swapEnabled: config.swapEnabled,
      swapSize: config.swapSize,
      sshKey: '',
      password: '',
      cloudInitConfig: config.cloudInitConfig as { 'user.user-data': string } | undefined,
      networkMode: config.networkMode,
      nested: config.nested || false,
      privileged: config.privileged || false,
      instanceType: config.instanceType || 'container',
      storagePool: config.storagePool || 'default',
      ipv4Address: config.ipv4Address,
      ipv6Config,
      hostInterface: config.hostInterface || 'eth0',
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
      limitsRead: config.limitsRead,
      limitsWrite: config.limitsWrite,
      limitsReadIops: config.limitsReadIops,
      limitsWriteIops: config.limitsWriteIops,
      limitsIngress: config.limitsIngress,
      limitsEgress: config.limitsEgress,
      limitsProcesses: config.limitsProcesses,
      limitsCpuPriority: config.limitsCpuPriority,
      bootAutostart: config.bootAutostart,
      bootAutostartPriority: config.bootAutostartPriority,
      bootAutostartDelay: config.bootAutostartDelay,
      bootHostShutdownTimeout: config.bootHostShutdownTimeout
    })

    console.log(`[Admin Provisioning] 正在调用 Incus API 创建实例...`)
    await createInstance(client, incusConfig)

    // 等待实例创建完成
    let ready = false
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status) {
          ready = true
          break
        }
      } catch {
        // 继续等待
      }
    }

    if (!ready) {
      throw new Error('实例创建超时')
    }

    // 启动实例
    console.log(`[Admin Provisioning] 正在启动实例...`)
    await startInstance(client, config.name)

    // 等待启动完成
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status === 'Running') {
          break
        }
      } catch {
        // 继续等待
      }
    }

    // 获取 IP 地址
    let ipv4: string | null = config.ipv4Address || null
    let ipv6: string | null = config.ipv6Address || null

    try {
      const stateResp = await getInstanceState(client, config.name) as { network?: Record<string, { addresses?: Array<{ family: string; scope: string; address: string }> }> }
      const network = stateResp?.network
      if (network?.eth0?.addresses) {
        for (const addr of network.eth0.addresses) {
          if (addr.family === 'inet' && addr.scope === 'global') {
            ipv4 = addr.address
          } else if (addr.family === 'inet6' && addr.scope === 'global') {
            ipv6 = addr.address
          }
        }
      }
    } catch {
      // 使用预分配的 IP
    }

    // 更新数据库
    const updateResult = await prisma.instance.updateMany({
      where: { id: instanceId, status: 'creating' },
      data: {
        status: 'running',
        ipv4,
        ipv6,
        storagePoolName: config.storagePool || 'default'
      }
    })

    if (updateResult.count === 0) {
      console.log(`[Admin Provisioning] 实例 ${instanceId} 已被超时清理任务处理，清理已创建的 Incus 实例`)
      try {
        await stopInstance(client, config.name, true)
        await deleteInstance(client, config.name)
      } catch (cleanupErr) {
        console.error(`[Admin Provisioning] 清理超时实例失败:`, cleanupErr)
      }
      return
    }

    console.log(`[Admin Provisioning] 实例 ${instanceId} 创建成功`)

  } catch (error) {
    console.error(`[Admin Provisioning] 实例 ${instanceId} 创建失败:`, error)

    const updateResult = await prisma.instance.updateMany({
      where: { id: instanceId, status: 'creating' },
      data: { status: 'error' }
    }).catch(() => ({ count: 0 }))

    if (updateResult.count > 0) {
      try {
        await db.rollbackResources({
          hostId: host.id,
          cpu: resources.cpu,
          memory: resources.memory,
          disk: resources.disk,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(config.networkMode)
            ? (config.portLimit || 0)
            : 0
        })
      } catch (rollbackErr) {
        console.error(`[Admin Provisioning] 资源回滚失败:`, rollbackErr)
      }

      try {
        await db.compensateFailedInstancePurchase(instanceId, userId, host.id)
      } catch (compensationErr) {
        console.error(`[Admin Provisioning] 创建失败后的账务补偿失败:`, compensationErr)
      }
    }

    try {
      const client = await getIncusClient(host)
      await deleteInstance(client, config.name)
    } catch {
      // 实例可能尚未创建或已被超时清理流程删除。
    }

    throw error
  }
}
