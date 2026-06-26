/**
 * 礼品卡兑换码数据访问层
 */

import crypto from 'crypto'
import { Prisma, type GiftCardStatus } from '@prisma/client'
import { prisma } from './prisma.js'
import {
  GIFT_CARD_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock
} from './advisory-locks.js'

const GIFT_CARD_RANDOM_LENGTH = 24
const GIFT_CARD_CODE_PREFIX = 'gc-'
const MAX_GIFT_CARD_BATCH_COUNT = 500
const MAX_GIFT_CARD_REMARK_LENGTH = 200
const MAX_GIFT_CARD_FACE_VALUE = 10000
const MAX_GIFT_CARD_LIST_PAGE_SIZE = 100

export const GIFT_CARD_CONSTANTS = {
  CODE_LENGTH: GIFT_CARD_RANDOM_LENGTH,
  CODE_PREFIX: GIFT_CARD_CODE_PREFIX,
  MAX_BATCH_COUNT: MAX_GIFT_CARD_BATCH_COUNT,
  MAX_REMARK_LENGTH: MAX_GIFT_CARD_REMARK_LENGTH,
  MAX_FACE_VALUE: MAX_GIFT_CARD_FACE_VALUE
} as const

export interface GiftCardCreateInput {
  faceValue: number
  balanceValue: number
  createdById?: number | null
  ownerId?: number | null
  expiresAt?: Date | null
  remark?: string
  batchId?: string
}

export interface GiftCardAdminListOptions {
  page?: number
  pageSize?: number
  status?: GiftCardStatus
  batchId?: string
  revealCode?: boolean
}

export interface GiftCardUserListOptions {
  page?: number
  pageSize?: number
  status?: GiftCardStatus
}

export interface GiftCardBalanceResult {
  balanceValue: number
  balanceBefore: number
  balanceAfter: number
}

type GiftCardRedeemTransactionResult = GiftCardBalanceResult | { error: 'GIFT_CARD_EXPIRED' }

function generateGiftCardCode(): string {
  const encoded = crypto.randomBytes(18).toString('base64url')
  return GIFT_CARD_CODE_PREFIX + encoded.substring(0, GIFT_CARD_RANDOM_LENGTH)
}

function generateBatchId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function toMoney(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2))
}

function clampPage(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : 1
}

function clampPageSize(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined
    ? Math.min(Math.max(value, 1), MAX_GIFT_CARD_LIST_PAGE_SIZE)
    : 20
}

function maskGiftCardCode(code: string): string {
  if (code.length <= 12) return code
  return `${code.slice(0, 7)}...${code.slice(-4)}`
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function serializeGiftCard<T extends { faceValue: unknown; balanceValue: unknown; code?: string }>(
  record: T,
  options: { revealCode?: boolean } = {}
): T & { faceValue: number; balanceValue: number; codeMasked?: string } {
  const code = record.code
  return {
    ...record,
    ...(code && !options.revealCode ? { code: maskGiftCardCode(code) } : {}),
    ...(code ? { codeMasked: maskGiftCardCode(code) } : {}),
    faceValue: toMoney(record.faceValue),
    balanceValue: toMoney(record.balanceValue)
  }
}

async function createGiftCardInTransaction(
  tx: Prisma.TransactionClient,
  input: GiftCardCreateInput
) {
  return tx.giftCard.create({
    data: {
      code: generateGiftCardCode(),
      faceValue: toDecimal(input.faceValue),
      balanceValue: toDecimal(input.balanceValue),
      createdById: input.createdById ?? null,
      ownerId: input.ownerId ?? null,
      expiresAt: input.expiresAt ?? null,
      remark: input.remark,
      batchId: input.batchId
    },
    select: {
      id: true,
      code: true,
      faceValue: true,
      balanceValue: true,
      status: true,
      expiresAt: true,
      batchId: true,
      createdAt: true
    }
  })
}

export async function createGiftCard(input: GiftCardCreateInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const card = await prisma.$transaction((tx) => createGiftCardInTransaction(tx, input))
      return serializeGiftCard(card, { revealCode: true })
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error
    }
  }
  throw new Error('GIFT_CARD_CODE_COLLISION')
}

export async function createGiftCardBatch(
  count: number,
  input: Omit<GiftCardCreateInput, 'batchId'>
) {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GIFT_CARD_BATCH_COUNT) {
    throw new Error('GIFT_CARD_BATCH_TOO_LARGE')
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const batchId = generateBatchId()
        const cards = []
        for (let i = 0; i < count; i++) {
          cards.push(await createGiftCardInTransaction(tx, { ...input, batchId }))
        }
        return {
          codes: cards.map(card => serializeGiftCard(card, { revealCode: true })),
          batchId,
          count: cards.length
        }
      })
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error
    }
  }
  throw new Error('GIFT_CARD_CODE_COLLISION')
}

export async function generateGiftCardFromBalance(input: {
  userId: number
  faceValue: number
  remark?: string
}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)

        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: { balance: true }
        })
        if (!user) throw new Error('USER_NOT_FOUND')

        const balanceBefore = toMoney(user.balance)
        const amount = toMoney(input.faceValue)
        const updateResult = await tx.user.updateMany({
          where: { id: input.userId, balance: { gte: amount } },
          data: { balance: { decrement: toDecimal(amount) } }
        })
        if (updateResult.count !== 1) {
          throw new Error('GIFT_CARD_INSUFFICIENT_BALANCE')
        }

        const updatedUser = await tx.user.findUnique({
          where: { id: input.userId },
          select: { balance: true }
        })
        if (!updatedUser) throw new Error('USER_NOT_FOUND')

        const balanceAfter = toMoney(updatedUser.balance)
        const balanceLog = await tx.balanceLog.create({
          data: {
            userId: input.userId,
            type: 'consume',
            amount: toDecimal(-amount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            remark: input.remark || '生成礼品卡'
          }
        })

        const giftCard = await createGiftCardInTransaction(tx, {
          faceValue: amount,
          balanceValue: amount,
          createdById: input.userId,
          ownerId: input.userId,
          remark: input.remark || '用户余额生成礼品卡'
        })

        return {
          giftCard: serializeGiftCard(giftCard, { revealCode: true }),
          balanceLog,
          balanceBefore,
          balanceAfter
        }
      })
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error
    }
  }
  throw new Error('GIFT_CARD_CODE_COLLISION')
}

export async function findGiftCardByCode(code: string) {
  const card = await prisma.giftCard.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      faceValue: true,
      balanceValue: true,
      status: true,
      createdById: true,
      ownerId: true,
      usedById: true,
      usedAt: true,
      expiresAt: true,
      remark: true,
      batchId: true,
      createdAt: true,
      createdBy: { select: { id: true, username: true } },
      owner: { select: { id: true, username: true } },
      usedBy: { select: { id: true, username: true } }
    }
  })
  return card ? serializeGiftCard(card, { revealCode: true }) : null
}

export async function findGiftCardById(id: number, options: { revealCode?: boolean } = {}) {
  const card = await prisma.giftCard.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      faceValue: true,
      balanceValue: true,
      status: true,
      createdById: true,
      ownerId: true,
      usedById: true,
      usedAt: true,
      expiresAt: true,
      remark: true,
      batchId: true,
      createdAt: true
    }
  })
  return card ? serializeGiftCard(card, options) : null
}

export async function redeemGiftCard(code: string, userId: number): Promise<GiftCardBalanceResult> {
  const result = await prisma.$transaction(async (tx): Promise<GiftCardRedeemTransactionResult> => {
    const initialGiftCard = await tx.giftCard.findUnique({
      where: { code },
      select: { id: true }
    })
    if (!initialGiftCard) {
      throw new Error('GIFT_CARD_NOT_FOUND')
    }

    await advisoryTransactionLock(tx, GIFT_CARD_LOCK_NAMESPACE, initialGiftCard.id)
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)

    const giftCard = await tx.giftCard.findUnique({
      where: { id: initialGiftCard.id },
      select: {
        id: true,
        code: true,
        status: true,
        balanceValue: true,
        expiresAt: true,
        ownerId: true
      }
    })

    if (!giftCard) {
      throw new Error('GIFT_CARD_NOT_FOUND')
    }
    if (giftCard.status !== 'active') {
      throw new Error(giftCard.status === 'used' ? 'GIFT_CARD_USED' : 'GIFT_CARD_DISABLED')
    }
    if (giftCard.ownerId === userId) {
      throw new Error('GIFT_CARD_SELF_REDEEM')
    }
    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      const expired = await tx.giftCard.updateMany({
        where: { id: giftCard.id, status: 'active' },
        data: { status: 'expired' }
      })
      if (expired.count === 0) {
        throw new Error('GIFT_CARD_USED')
      }
      return { error: 'GIFT_CARD_EXPIRED' }
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    if (!user) throw new Error('USER_NOT_FOUND')

    const amount = toMoney(giftCard.balanceValue)
    const balanceBefore = toMoney(user.balance)
    const updated = await tx.giftCard.updateMany({
      where: { id: giftCard.id, status: 'active' },
      data: { status: 'used', usedById: userId, usedAt: new Date() }
    })
    if (updated.count !== 1) {
      throw new Error('GIFT_CARD_USED')
    }

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: toDecimal(amount) } },
      select: { balance: true }
    })
    const balanceAfter = toMoney(updatedUser.balance)

    await tx.balanceLog.create({
      data: {
        userId,
        type: 'gift',
        amount: toDecimal(amount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(balanceAfter),
        remark: `礼品卡兑换：${maskGiftCardCode(giftCard.code)}`
      }
    })

    return { balanceValue: amount, balanceBefore, balanceAfter }
  })

  if ('error' in result) {
    throw new Error(result.error)
  }

  return result
}

export async function disableGiftCard(id: number) {
  return prisma.giftCard.updateMany({
    where: { id, status: 'active' },
    data: { status: 'disabled' }
  })
}

export async function enableGiftCard(id: number) {
  return prisma.giftCard.updateMany({
    where: {
      id,
      status: 'disabled',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    data: { status: 'active' }
  })
}

export async function deleteGiftCard(id: number) {
  return prisma.giftCard.deleteMany({
    where: { id, status: { in: ['active', 'disabled', 'expired'] } }
  })
}

export async function batchDisableGiftCards(ids: number[]) {
  return prisma.giftCard.updateMany({
    where: { id: { in: ids }, status: 'active' },
    data: { status: 'disabled' }
  })
}

export async function batchDeleteGiftCards(ids: number[]) {
  return prisma.giftCard.deleteMany({
    where: { id: { in: ids }, status: { in: ['active', 'disabled', 'expired'] } }
  })
}

export async function listGiftCardsByAdmin(options: GiftCardAdminListOptions) {
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const where: Prisma.GiftCardWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(options.batchId ? { batchId: options.batchId } : {})
  }

  const [total, records] = await Promise.all([
    prisma.giftCard.count({ where }),
    prisma.giftCard.findMany({
      where,
      select: {
        id: true,
        code: true,
        faceValue: true,
        balanceValue: true,
        status: true,
        expiresAt: true,
        remark: true,
        batchId: true,
        createdAt: true,
        usedAt: true,
        createdBy: { select: { id: true, username: true } },
        owner: { select: { id: true, username: true } },
        usedBy: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  return {
    records: records.map(record => serializeGiftCard(record, { revealCode: options.revealCode === true })),
    total,
    page,
    pageSize
  }
}

export async function listGiftCardsByUser(userId: number, options: GiftCardUserListOptions) {
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const where: Prisma.GiftCardWhereInput = {
    OR: [{ ownerId: userId }, { createdById: userId }, { usedById: userId }],
    ...(options.status ? { status: options.status } : {})
  }

  const [total, records] = await Promise.all([
    prisma.giftCard.count({ where }),
    prisma.giftCard.findMany({
      where,
      select: {
        id: true,
        code: true,
        faceValue: true,
        balanceValue: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        usedAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  return {
    records: records.map(record => serializeGiftCard(record, { revealCode: true })),
    total,
    page,
    pageSize
  }
}

export async function getGiftCardStats() {
  const [total, active, used, disabled, expired, outstandingValue, redeemedValue] = await Promise.all([
    prisma.giftCard.count(),
    prisma.giftCard.count({ where: { status: 'active' } }),
    prisma.giftCard.count({ where: { status: 'used' } }),
    prisma.giftCard.count({ where: { status: 'disabled' } }),
    prisma.giftCard.count({ where: { status: 'expired' } }),
    prisma.giftCard.aggregate({
      _sum: { balanceValue: true },
      where: { status: { in: ['active', 'disabled'] } }
    }),
    prisma.giftCard.aggregate({
      _sum: { balanceValue: true },
      where: { status: 'used' }
    })
  ])

  return {
    total,
    active,
    used,
    disabled,
    expired,
    outstandingValue: toMoney(outstandingValue._sum.balanceValue),
    totalRedeemedValue: toMoney(redeemedValue._sum.balanceValue)
  }
}
