import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import {
  USER_BALANCE_LOCK_NAMESPACE,
  USER_POINTS_LOCK_NAMESPACE,
  advisoryTransactionLock
} from '../db/advisory-locks.js'
import { getSystemConfig, getSystemConfigNumber } from '../db/system-config.js'

export type InviteCostResource = 'balance' | 'points' | (string & {})

export interface InviteCostOption {
  resource: InviteCostResource
  amount: number
  enabled: boolean
}

export interface InviteCostQuote extends InviteCostOption {
  label: string
  unit: string
  displayAmount: string
}

export interface InviteGenerationCostSnapshot {
  resource: InviteCostResource
  amount: number
  label: string
  unit: string
  displayAmount: string
  chargedAt: string
}

interface InviteCostResourceHandler {
  resource: InviteCostResource
  label: string
  unit: string
  normalizeAmount(amount: number): number
  format(amount: number): string
  charge(tx: Prisma.TransactionClient, userId: number, amount: number, inviteCode: string): Promise<void>
}

const defaultInviteCostOptions: InviteCostOption[] = [
  { resource: 'balance', amount: 0, enabled: false },
  { resource: 'points', amount: 0, enabled: false }
]

const inviteCostResourceHandlers: Record<string, InviteCostResourceHandler> = {
  balance: {
    resource: 'balance',
    label: '余额',
    unit: '元',
    normalizeAmount(amount: number) {
      return Math.round(Math.max(0, amount) * 100) / 100
    },
    format(amount: number) {
      return `¥${amount.toFixed(2)}`
    },
    async charge(tx, userId, amount, inviteCode) {
      if (amount <= 0) return

      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)

      const rows = await tx.$queryRaw<Array<{ balanceBefore: unknown; balanceAfter: unknown }>>(Prisma.sql`
        UPDATE users
        SET balance = balance - ${amount}
        WHERE id = ${userId} AND balance >= ${amount}
        RETURNING (balance + ${amount})::numeric AS "balanceBefore", balance::numeric AS "balanceAfter"
      `)

      if (rows.length !== 1) {
        const userExists = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true }
        })
        if (!userExists) {
          throw new Error('USER_NOT_FOUND')
        }
        throw new Error('INSUFFICIENT_BALANCE')
      }

      const balanceBefore = Number(rows[0].balanceBefore)
      const balanceAfter = Number(rows[0].balanceAfter)

      await tx.balanceLog.create({
        data: {
          userId,
          type: 'invite_generate',
          amount: -amount,
          balanceBefore,
          balanceAfter,
          remark: `生成邀请码 ${inviteCode}`
        }
      })
    }
  },
  points: {
    resource: 'points',
    label: '积分',
    unit: '积分',
    normalizeAmount(amount: number) {
      return Math.max(0, Math.floor(amount))
    },
    format(amount: number) {
      return `${Math.floor(amount)} 积分`
    },
    async charge(tx, userId, amount, inviteCode) {
      if (amount <= 0) return

      await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)

      await tx.userPoints.upsert({
        where: { userId },
        update: {},
        create: { userId }
      })

      const rows = await tx.$queryRaw<Array<{ pointsBefore: number; pointsAfter: number }>>(Prisma.sql`
        UPDATE user_points
        SET points = points - ${amount},
            total_spent = total_spent + ${amount},
            updated_at = NOW()
        WHERE user_id = ${userId} AND points >= ${amount}
        RETURNING points + ${amount} AS "pointsBefore", points AS "pointsAfter"
      `)

      if (rows.length !== 1) {
        throw new Error('INSUFFICIENT_POINTS')
      }

      await tx.pointsLog.create({
        data: {
          userId,
          type: 'invite_generate',
          amount: -amount,
          pointsBefore: rows[0].pointsBefore,
          pointsAfter: rows[0].pointsAfter,
          remark: `生成邀请码 ${inviteCode}`
        }
      })
    }
  }
}

export function isSupportedInviteCostResource(resource: string): boolean {
  return resource in inviteCostResourceHandlers
}

function parseInviteCostConfig(raw: string | null): InviteCostOption[] {
  if (!raw) return defaultInviteCostOptions

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultInviteCostOptions

    return parsed
      .map((item): InviteCostOption | null => {
        if (!item || typeof item !== 'object') return null
        const resource = String((item as { resource?: unknown }).resource || '').trim()
        if (!resource) return null
        const amount = Number((item as { amount?: unknown }).amount)
        const handler = inviteCostResourceHandlers[resource]
        const normalizedAmount = handler
          ? handler.normalizeAmount(Number.isFinite(amount) ? amount : 0)
          : Math.max(0, Number.isFinite(amount) ? amount : 0)

        return {
          resource,
          amount: normalizedAmount,
          enabled: (item as { enabled?: unknown }).enabled === true
        }
      })
      .filter((item): item is InviteCostOption => item !== null)
  } catch {
    return defaultInviteCostOptions
  }
}

function ensureDefaultCostOptions(options: InviteCostOption[]): InviteCostOption[] {
  const map = new Map(options.map(option => [option.resource, option]))
  for (const option of defaultInviteCostOptions) {
    if (!map.has(option.resource)) {
      map.set(option.resource, option)
    }
  }
  return Array.from(map.values())
}

export function normalizeInviteCostOptions(options: InviteCostOption[]): InviteCostOption[] {
  return ensureDefaultCostOptions(options).map(option => {
    const handler = inviteCostResourceHandlers[option.resource]
    const amount = handler
      ? handler.normalizeAmount(option.amount)
      : Math.max(0, Number.isFinite(option.amount) ? option.amount : 0)

    return {
      resource: option.resource,
      amount,
      enabled: option.enabled
    }
  })
}

export function serializeInviteCostOptions(options: InviteCostOption[]): string {
  return JSON.stringify(normalizeInviteCostOptions(options))
}

export async function getInviteCostOptions(): Promise<InviteCostOption[]> {
  const raw = await getSystemConfig('invite_generation_costs')
  return normalizeInviteCostOptions(parseInviteCostConfig(raw))
}

export async function getInviteExpiryDays(): Promise<number> {
  return Math.max(0, await getSystemConfigNumber('invite_default_expire_days', 0))
}

export async function getInviteCostQuotes(): Promise<InviteCostQuote[]> {
  return (await getInviteCostOptions()).map(option => {
    const handler = inviteCostResourceHandlers[option.resource]
    const label = handler?.label || option.resource
    const unit = handler?.unit || ''
    const displayAmount = handler?.format(option.amount) || `${option.amount}${unit}`

    return {
      ...option,
      label,
      unit,
      displayAmount
    }
  })
}

export async function chargeInviteGenerationCost(
  tx: Prisma.TransactionClient,
  userId: number,
  inviteCode: string,
  resource: string,
  costOptions?: InviteCostOption[]
): Promise<InviteGenerationCostSnapshot> {
  const options = costOptions ?? await getInviteCostOptions()
  const option = options.find(cost => cost.resource === resource && cost.enabled)
  if (!option) {
    throw new Error('INVITE_COST_OPTION_UNAVAILABLE')
  }

  const handler = inviteCostResourceHandlers[option.resource]
  if (!handler) {
    throw new Error('INVITE_COST_RESOURCE_UNSUPPORTED')
  }

  await handler.charge(tx, userId, option.amount, inviteCode)

  return {
    resource: option.resource,
    amount: option.amount,
    label: handler.label,
    unit: handler.unit,
    displayAmount: handler.format(option.amount),
    chargedAt: new Date().toISOString()
  }
}

export async function getUserInviteBalances(userId: number): Promise<{
  balance: number
  points: number
}> {
  const [user, userPoints] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    }),
    prisma.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })
  ])

  return {
    balance: user ? Number(user.balance) : 0,
    points: userPoints.points
  }
}
