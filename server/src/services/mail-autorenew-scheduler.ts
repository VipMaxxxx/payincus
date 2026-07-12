/**
 * 邮箱订阅自动续费任务：每天扫描临期订阅，并统一按 1 个月从余额续费。
 */

import { schedule } from 'node-cron'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { getExpiringSubscriptions, renewMailSubscription } from '../db/mail.js'
import {
  MAIL_SUBSCRIPTION_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { calculateDiscountAmount, calculateDiscountedPrice } from '../lib/billing-calc.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'
import { processMailAffCommission } from '../db/aff.js'

const MAIL_AUTORENEW_CRON = '43 2 * * *'
const MAIL_AUTORENEW_DAYS_AHEAD = 3
const MAIL_AUTORENEW_MONTHS = 1
const MAIL_RENEW_REMARK_PREFIX = '续费域名邮箱 '

let schedulerStarted = false
let autoRenewRunning = false

type AutoRenewResult =
  | { status: 'renewed'; amount: number; expiresAt: Date }
  | { status: 'insufficient_balance'; amount: number; balance: number }
  | { status: 'duplicate' | 'ineligible' | 'busy' }

function safeErrorMessage(error: unknown): string {
  return sanitizeTokensInString(error instanceof Error ? error.message : String(error))
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function buildPeriodKey(subscriptionId: number, expiresAt: Date): string {
  return `mail-auto-renew:${subscriptionId}:${expiresAt.toISOString()}`
}

async function processMailAutoRenew(candidate: {
  id: number
  userId: number
  expiresAt: Date
}, scanNow: Date, deadline: Date): Promise<AutoRenewResult> {
  return prisma.$transaction(async (tx) => {
    const subscriptionLocked = await tryAdvisoryTransactionLock(
      tx,
      MAIL_SUBSCRIPTION_LOCK_NAMESPACE,
      candidate.userId
    )
    if (!subscriptionLocked) return { status: 'busy' as const }

    const balanceLocked = await tryAdvisoryTransactionLock(
      tx,
      USER_BALANCE_LOCK_NAMESPACE,
      candidate.userId
    )
    if (!balanceLocked) return { status: 'busy' as const }

    const subscription = await tx.mailSubscription.findUnique({
      where: { id: candidate.id },
      include: {
        plan: true,
        affBinding: { include: { affCode: true } }
      }
    })

    if (
      !subscription ||
      subscription.userId !== candidate.userId ||
      subscription.status !== 'active' ||
      !subscription.autoRenew ||
      subscription.expiresAt.getTime() !== candidate.expiresAt.getTime() ||
      subscription.expiresAt <= scanNow ||
      subscription.expiresAt > deadline
    ) {
      return { status: 'ineligible' as const }
    }

    const periodKey = buildPeriodKey(subscription.id, subscription.expiresAt)
    const periodMarker = `[${periodKey}]`
    const existingCharge = await tx.balanceLog.findFirst({
      where: {
        userId: subscription.userId,
        type: 'consume',
        remark: { contains: periodMarker }
      },
      select: { id: true }
    })
    if (existingCharge) return { status: 'duplicate' as const }

    const monthlyPrice = subscription.plan.billingCycle === 'monthly'
      ? Number(subscription.plan.price)
      : Number(subscription.plan.price) / 12
    const originalPrice = roundCurrency(monthlyPrice * MAIL_AUTORENEW_MONTHS)
    const affCode = subscription.affBinding?.affCode
    const discountAmount = affCode?.enabled
      ? calculateDiscountAmount(originalPrice, Number(affCode.discountRate))
      : 0
    const finalPrice = affCode?.enabled
      ? calculateDiscountedPrice(originalPrice, Number(affCode.discountRate))
      : originalPrice

    const deducted = await tx.user.updateMany({
      where: {
        id: subscription.userId,
        balance: { gte: finalPrice }
      },
      data: { balance: { decrement: finalPrice } }
    })

    if (deducted.count === 0) {
      const user = await tx.user.findUnique({
        where: { id: subscription.userId },
        select: { balance: true }
      })
      const balance = Number(user?.balance ?? 0)
      const existingReminder = await tx.inboxMessage.findFirst({
        where: {
          userId: subscription.userId,
          eventType: 'mail_auto_renew_insufficient_balance',
          data: { path: ['periodKey'], equals: periodKey }
        },
        select: { id: true }
      })

      if (!existingReminder) {
        await tx.inboxMessage.create({
          data: {
            userId: subscription.userId,
            eventType: 'mail_auto_renew_insufficient_balance',
            title: '邮箱自动续费余额不足',
            content: `邮箱订阅自动续费需要 ¥${finalPrice.toFixed(2)}，当前余额 ¥${balance.toFixed(2)}。请充值后手动续费。`,
            data: {
              subscriptionId: subscription.id,
              periodKey,
              renewMonths: MAIL_AUTORENEW_MONTHS,
              renewAmount: finalPrice,
              expiresAt: subscription.expiresAt.toISOString()
            } satisfies Prisma.InputJsonObject
          }
        })
        await tx.log.create({
          data: {
            userId: subscription.userId,
            module: 'mail',
            action: 'mail_auto_renew_insufficient_balance',
            content: `Mail subscription #${subscription.id} auto-renew skipped: insufficient balance`,
            result: 'failed'
          }
        })
      }

      return { status: 'insufficient_balance' as const, amount: finalPrice, balance }
    }

    const updatedUser = await tx.user.findUnique({
      where: { id: subscription.userId },
      select: { balance: true }
    })
    const balanceAfter = Number(updatedUser?.balance ?? 0)
    const balanceBefore = roundCurrency(balanceAfter + finalPrice)
    const remark = discountAmount > 0
      ? `${MAIL_RENEW_REMARK_PREFIX}${MAIL_AUTORENEW_MONTHS} 个月（自动续费，优惠码折扣 -¥${discountAmount.toFixed(2)}） ${periodMarker}`
      : `${MAIL_RENEW_REMARK_PREFIX}${MAIL_AUTORENEW_MONTHS} 个月（自动续费） ${periodMarker}`

    await tx.balanceLog.create({
      data: {
        userId: subscription.userId,
        type: 'consume',
        amount: -finalPrice,
        balanceBefore,
        balanceAfter,
        remark
      }
    })

    const renewed = await renewMailSubscription(
      subscription.id,
      MAIL_AUTORENEW_MONTHS,
      tx
    )

    if (subscription.affBinding) {
      await processMailAffCommission(
        subscription.affBinding.affCodeId,
        subscription.id,
        originalPrice,
        'renew',
        tx
      )
    }

    return { status: 'renewed' as const, amount: finalPrice, expiresAt: renewed.expiresAt }
  })
}

export async function runMailAutoRenew(): Promise<void> {
  if (autoRenewRunning) {
    console.log('[MailAutoRenew] Previous run is still active, skipping')
    return
  }

  autoRenewRunning = true
  const scanNow = new Date()
  const deadline = new Date(scanNow)
  deadline.setDate(deadline.getDate() + MAIL_AUTORENEW_DAYS_AHEAD)

  try {
    const candidates = await getExpiringSubscriptions(MAIL_AUTORENEW_DAYS_AHEAD, scanNow)
    for (const candidate of candidates) {
      try {
        const result = await processMailAutoRenew(candidate, scanNow, deadline)
        if (result.status === 'renewed') {
          await createLog(
            candidate.userId,
            'mail',
            'mail_auto_renew',
            `Auto-renewed mail subscription #${candidate.id} for ${MAIL_AUTORENEW_MONTHS} month, amount=${result.amount}`,
            'success'
          )
        }
      } catch (error) {
        const message = safeErrorMessage(error)
        console.error(`[MailAutoRenew] Subscription #${candidate.id} failed: ${message}`)
        await createLog(
          candidate.userId,
          'mail',
          'mail_auto_renew_failed',
          `Mail subscription #${candidate.id} auto-renew failed: ${message}`,
          'failed'
        )
      }
    }
  } finally {
    autoRenewRunning = false
  }
}

export function startMailAutoRenewScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true
  schedule(MAIL_AUTORENEW_CRON, () => {
    runMailAutoRenew().catch(error => {
      console.error(`[MailAutoRenew] Scheduled run failed: ${safeErrorMessage(error)}`)
    })
  })

  console.log('[MailAutoRenew] Scheduler started (daily at 02:43)')
}
