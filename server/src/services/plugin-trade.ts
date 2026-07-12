import { randomUUID } from 'crypto'
import { Prisma, type PluginDeveloperWithdrawalStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import {
  USER_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock,
  advisoryTransactionLockString
} from '../db/advisory-locks.js'
import {
  PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT,
  normalizePluginMarketPricing
} from '../lib/plugin-market.js'

export const PLUGIN_REFUND_WINDOW_DAYS = 7
export const PLUGIN_DEVELOPER_WITHDRAWAL_MIN_CENTS = 1000
export const PLUGIN_TRADE_CURRENCIES = ['CNY', 'USD'] as const
const PLUGIN_TRADE_LOCK_NAMESPACE = 4124
const MAX_MONEY_CENTS = 2_000_000_000

export class PluginTradeError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message)
  }
}

function normalizeCurrency(value: string): typeof PLUGIN_TRADE_CURRENCIES[number] {
  const currency = value.trim().toUpperCase()
  if (!PLUGIN_TRADE_CURRENCIES.includes(currency as typeof PLUGIN_TRADE_CURRENCIES[number])) {
    throw new PluginTradeError('PLUGIN_TRADE_CURRENCY_UNSUPPORTED', 'Plugin trade currency must be CNY or USD')
  }
  return currency as typeof PLUGIN_TRADE_CURRENCIES[number]
}

function assertMoneyCents(value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_MONEY_CENTS) {
    throw new PluginTradeError('PLUGIN_TRADE_AMOUNT_INVALID', 'Amount must be a valid integer in the currency minimum unit')
  }
  return value
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100)
}

function calculateRevenueShare(grossCents: number): { platformFeeCents: number; netCents: number } {
  const platformFeeCents = Math.floor(
    grossCents * PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT / 100
  )
  const netCents = grossCents - platformFeeCents
  if (grossCents !== platformFeeCents + netCents) {
    throw new PluginTradeError('PLUGIN_TRADE_ACCOUNTING_MISMATCH', 'Plugin trade accounting is inconsistent', 500)
  }
  return { platformFeeCents, netCents }
}

function tradeNo(): string {
  return `PT${Date.now()}${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

export async function purchasePlugin(input: {
  userId: number
  pluginId: string
  version: string
  idempotencyKey: string
}) {
  return prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)
    await advisoryTransactionLockString(tx, PLUGIN_TRADE_LOCK_NAMESPACE, `purchase:${input.userId}:${input.pluginId}:${input.version}`)

    const idempotentPurchase = await tx.pluginPurchase.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      include: { license: true, earning: true }
    })
    if (idempotentPurchase) {
      if (idempotentPurchase.pluginId !== input.pluginId || idempotentPurchase.version !== input.version) {
        throw new PluginTradeError('PLUGIN_TRADE_IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another purchase', 409)
      }
      return idempotentPurchase
    }
    const existingVersionPurchase = await tx.pluginPurchase.findUnique({
      where: { userId_pluginId_version: { userId: input.userId, pluginId: input.pluginId, version: input.version } }
    })
    if (existingVersionPurchase) {
      throw new PluginTradeError('PLUGIN_VERSION_ALREADY_PURCHASED', 'This plugin version was already purchased', 409)
    }

    const submission = await tx.pluginMarketSubmission.findUnique({
      where: { pluginId_version: { pluginId: input.pluginId, version: input.version } }
    })
    if (!submission || submission.reviewStatus !== 'listed') {
      throw new PluginTradeError('PLUGIN_MARKET_ENTRY_NOT_LISTED', 'Plugin version is not listed', 404)
    }

    let pricing: ReturnType<typeof normalizePluginMarketPricing>
    try {
      pricing = normalizePluginMarketPricing(submission.pricing)
    } catch {
      throw new PluginTradeError('PLUGIN_MARKET_PRICING_INVALID', 'Plugin pricing is incomplete or invalid', 409)
    }
    if (pricing.type !== 'paid') {
      throw new PluginTradeError('PLUGIN_MARKET_ENTRY_FREE', 'Free plugins do not require a purchase', 409)
    }

    if (pricing.price === undefined || pricing.currency === undefined) {
      throw new PluginTradeError('PLUGIN_MARKET_PRICING_INVALID', 'Plugin pricing is incomplete or invalid', 409)
    }
    const grossCents = assertMoneyCents(pricing.price)
    const currency = normalizeCurrency(pricing.currency)
    const { platformFeeCents, netCents } = calculateRevenueShare(grossCents)
    const amount = centsToDecimal(grossCents)
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { balance: true } })
    if (!user) throw new PluginTradeError('USER_NOT_FOUND', 'User not found', 404)

    const deducted = await tx.user.updateMany({
      where: { id: input.userId, balance: { gte: amount } },
      data: { balance: { decrement: amount } }
    })
    if (deducted.count !== 1) {
      throw new PluginTradeError('INSUFFICIENT_BALANCE', 'Insufficient balance', 400)
    }
    const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { balance: true } })
    const now = new Date()
    const refundableUntil = new Date(now.getTime() + PLUGIN_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const purchase = await tx.pluginPurchase.create({
      data: {
        tradeNo: tradeNo(),
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        developerId: submission.submittedByUserId,
        submissionId: submission.id,
        pluginId: input.pluginId,
        version: input.version,
        grossCents,
        platformFeeCents,
        netCents,
        currency,
        refundableUntil
      }
    })
    const [license, earning] = await Promise.all([
      tx.pluginLicense.create({
        data: { purchaseId: purchase.id, userId: input.userId, pluginId: input.pluginId, version: input.version }
      }),
      tx.pluginDeveloperEarning.create({
        data: {
          purchaseId: purchase.id,
          developerId: submission.submittedByUserId,
          pluginId: input.pluginId,
          grossCents,
          platformFeeCents,
          netCents,
          currency,
          availableAt: refundableUntil
        }
      })
    ])
    await tx.balanceLog.create({
      data: {
        userId: input.userId,
        type: 'consume',
        amount: amount.negated(),
        balanceBefore: user.balance,
        balanceAfter: updatedUser.balance,
        orderId: purchase.tradeNo,
        remark: `Plugin purchase ${input.pluginId}@${input.version} (${currency})`
      }
    })
    return { ...purchase, license, earning }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function refundPluginPurchase(input: { userId: number; purchaseId: number; reason?: string }) {
  return prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)
    const purchase = await tx.pluginPurchase.findUnique({
      where: { id: input.purchaseId },
      include: { license: true, earning: true, refund: true }
    })
    if (!purchase || purchase.userId !== input.userId) {
      throw new PluginTradeError('PLUGIN_PURCHASE_NOT_FOUND', 'Plugin purchase not found', 404)
    }
    await advisoryTransactionLockString(tx, PLUGIN_TRADE_LOCK_NAMESPACE, `developer:${purchase.developerId}:${purchase.currency}`)
    await advisoryTransactionLockString(tx, PLUGIN_TRADE_LOCK_NAMESPACE, `refund:${purchase.id}`)
    if (purchase.refund) return { purchase, refund: purchase.refund, idempotent: true }
    if (purchase.status !== 'completed') {
      throw new PluginTradeError('PLUGIN_PURCHASE_ALREADY_REFUNDED', 'Plugin purchase was already refunded', 409)
    }
    if (purchase.refundableUntil.getTime() < Date.now()) {
      throw new PluginTradeError('PLUGIN_REFUND_WINDOW_EXPIRED', 'The 7-day plugin refund window has expired', 409)
    }
    if (!purchase.license || !purchase.earning) {
      throw new PluginTradeError('PLUGIN_TRADE_ACCOUNTING_MISMATCH', 'Plugin purchase ledger is incomplete', 500)
    }

    const refundedAt = new Date()
    const [purchaseClaim, licenseClaim, earningClaim] = await Promise.all([
      tx.pluginPurchase.updateMany({
        where: { id: purchase.id, status: 'completed' },
        data: { status: 'refunded', refundedAt }
      }),
      tx.pluginLicense.updateMany({
        where: { id: purchase.license.id, status: 'active', revokedAt: null },
        data: { status: 'revoked', revokedAt: refundedAt }
      }),
      tx.pluginDeveloperEarning.updateMany({
        where: { id: purchase.earning.id, status: 'pending', reversedAt: null },
        data: { status: 'reversed', reversedAt: refundedAt }
      })
    ])
    if (purchaseClaim.count !== 1 || licenseClaim.count !== 1 || earningClaim.count !== 1) {
      throw new PluginTradeError('PLUGIN_REFUND_CONFLICT', 'Plugin refund was processed concurrently', 409)
    }

    const amount = centsToDecimal(purchase.grossCents)
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { balance: true } })
    await tx.user.update({ where: { id: input.userId }, data: { balance: { increment: amount } } })
    const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { balance: true } })
    const refund = await tx.pluginRefund.create({
      data: {
        purchaseId: purchase.id,
        amountCents: purchase.grossCents,
        currency: purchase.currency,
        reason: input.reason?.trim() || null
      }
    })
    await tx.balanceLog.create({
      data: {
        userId: input.userId,
        type: 'refund',
        amount,
        balanceBefore: user.balance,
        balanceAfter: updatedUser.balance,
        orderId: purchase.tradeNo,
        remark: `Plugin refund ${purchase.pluginId}@${purchase.version} (${purchase.currency})`
      }
    })
    return { purchase: { ...purchase, status: 'refunded' as const, refundedAt }, refund, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function hasActivePluginLicense(userId: number, pluginId: string, version: string): Promise<boolean> {
  return (await prisma.pluginLicense.count({
    where: { userId, pluginId, version, status: 'active', revokedAt: null }
  })) > 0
}

export async function assertPaidPluginLicense(input: {
  userId: number
  pluginId: string
  version: string
  pricing?: unknown
}): Promise<void> {
  let pricing = input.pricing
  if (pricing === undefined) {
    const submission = await prisma.pluginMarketSubmission.findUnique({
      where: { pluginId_version: { pluginId: input.pluginId, version: input.version } },
      select: { pricing: true }
    })
    pricing = submission?.pricing
  }
  if (pricing === undefined) return
  let normalized: ReturnType<typeof normalizePluginMarketPricing>
  try {
    normalized = normalizePluginMarketPricing(pricing)
  } catch {
    throw new PluginTradeError('PLUGIN_MARKET_PRICING_INVALID', 'Plugin pricing is incomplete or invalid', 409)
  }
  if (normalized.type === 'free') return
  if (!await hasActivePluginLicense(input.userId, input.pluginId, input.version)) {
    throw new PluginTradeError('PLUGIN_LICENSE_REQUIRED', 'An active license is required for this paid plugin', 403)
  }
}

export async function getDeveloperEarnings(developerId: number, currencyValue?: string) {
  const currency = currencyValue ? normalizeCurrency(currencyValue) : undefined
  const now = new Date()
  const earnings = await prisma.pluginDeveloperEarning.findMany({
    where: { developerId, ...(currency ? { currency } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200
  })
  const withdrawals = await prisma.pluginDeveloperWithdrawal.findMany({
    where: { developerId, ...(currency ? { currency } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200
  })
  const currencies = currency ? [currency] : [...PLUGIN_TRADE_CURRENCIES]
  const balances = await Promise.all(currencies.map(async item => {
    const [earned, reserved] = await Promise.all([
      prisma.pluginDeveloperEarning.aggregate({
        where: { developerId, currency: item, status: 'pending', reversedAt: null, availableAt: { lte: now } },
        _sum: { netCents: true }
      }),
      prisma.pluginDeveloperWithdrawal.aggregate({
        where: { developerId, currency: item, status: { in: ['pending', 'completed'] } },
        _sum: { amountCents: true }
      })
    ])
    const earnedCents = earned._sum.netCents || 0
    const reservedCents = reserved._sum.amountCents || 0
    return { currency: item, earnedCents, reservedCents, availableCents: Math.max(0, earnedCents - reservedCents) }
  }))
  return { earnings, withdrawals: withdrawals.map(serializeWithdrawal), balances }
}

export async function createDeveloperWithdrawal(input: {
  developerId: number
  amountCents: number
  currency: string
  payoutMethod: string
  payoutTarget: string
  idempotencyKey: string
}) {
  const amountCents = assertMoneyCents(input.amountCents, PLUGIN_DEVELOPER_WITHDRAWAL_MIN_CENTS)
  const currency = normalizeCurrency(input.currency)
  return prisma.$transaction(async tx => {
    await advisoryTransactionLockString(tx, PLUGIN_TRADE_LOCK_NAMESPACE, `developer:${input.developerId}:${currency}`)
    const existing = await tx.pluginDeveloperWithdrawal.findUnique({
      where: { developerId_idempotencyKey: { developerId: input.developerId, idempotencyKey: input.idempotencyKey } }
    })
    if (existing) {
      if (
        existing.amountCents !== amountCents ||
        existing.currency !== currency ||
        existing.payoutMethod !== input.payoutMethod ||
        existing.payoutTarget !== input.payoutTarget
      ) {
        throw new PluginTradeError('PLUGIN_TRADE_IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another withdrawal', 409)
      }
      return existing
    }

    const now = new Date()
    const [earned, reserved] = await Promise.all([
      tx.pluginDeveloperEarning.aggregate({
        where: { developerId: input.developerId, currency, status: 'pending', reversedAt: null, availableAt: { lte: now } },
        _sum: { netCents: true }
      }),
      tx.pluginDeveloperWithdrawal.aggregate({
        where: { developerId: input.developerId, currency, status: { in: ['pending', 'completed'] } },
        _sum: { amountCents: true }
      })
    ])
    const availableCents = (earned._sum.netCents || 0) - (reserved._sum.amountCents || 0)
    if (availableCents < amountCents) {
      throw new PluginTradeError('PLUGIN_EARNING_INSUFFICIENT', 'Insufficient settled plugin earnings', 400)
    }
    return tx.pluginDeveloperWithdrawal.create({
      data: {
        developerId: input.developerId,
        amountCents,
        currency,
        payoutMethod: input.payoutMethod,
        payoutTarget: input.payoutTarget,
        idempotencyKey: input.idempotencyKey
      }
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function listDeveloperWithdrawals(status?: PluginDeveloperWithdrawalStatus) {
  return prisma.pluginDeveloperWithdrawal.findMany({
    where: status ? { status } : undefined,
    include: { developer: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200
  })
}

export async function reviewDeveloperWithdrawal(input: {
  withdrawalId: number
  reviewerUserId: number
  decision: 'approve' | 'reject'
  reason?: string
}) {
  const reviewedAt = new Date()
  const claimed = await prisma.pluginDeveloperWithdrawal.updateMany({
    where: { id: input.withdrawalId, status: 'pending' },
    data: {
      status: input.decision === 'approve' ? 'completed' : 'rejected',
      reviewedByUserId: input.reviewerUserId,
      reviewedAt,
      rejectReason: input.decision === 'reject' ? input.reason?.trim() || 'Rejected by administrator' : null
    }
  })
  if (claimed.count !== 1) {
    throw new PluginTradeError('PLUGIN_WITHDRAWAL_ALREADY_PROCESSED', 'Withdrawal was already processed or does not exist', 409)
  }
  return prisma.pluginDeveloperWithdrawal.findUniqueOrThrow({ where: { id: input.withdrawalId } })
}

export function serializeWithdrawal(withdrawal: {
  id: number
  developerId: number
  amountCents: number
  currency: string
  payoutMethod: string
  payoutTarget: string
  status: PluginDeveloperWithdrawalStatus
  rejectReason: string | null
  reviewedByUserId: number | null
  reviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  const target = withdrawal.payoutTarget
  return {
    ...withdrawal,
    payoutTarget: target.length <= 8 ? '***' : `${target.slice(0, 4)}***${target.slice(-4)}`,
    reviewedAt: withdrawal.reviewedAt?.toISOString() || null,
    createdAt: withdrawal.createdAt.toISOString(),
    updatedAt: withdrawal.updatedAt.toISOString()
  }
}
