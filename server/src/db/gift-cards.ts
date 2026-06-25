/**
 * 礼品卡兑换码 数据访问层
 */

import crypto from 'crypto'
import { prisma } from './prisma.js'
import type { GiftCardStatus } from '@prisma/client'

const GIFT_CARD_CODE_LENGTH = 24
const GIFT_CARD_CODE_PREFIX = 'gc-'
const MAX_GIFT_CARD_BATCH_COUNT = 500
const MAX_GIFT_CARD_REMARK_LENGTH = 200
const MAX_GIFT_CARD_FACE_VALUE = 10000 // CNY

export const GIFT_CARD_CONSTANTS = {
  CODE_LENGTH: GIFT_CARD_CODE_LENGTH,
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
}

export interface GiftCardUserListOptions {
  page?: number
  pageSize?: number
  status?: GiftCardStatus
}

function generateGiftCardCode(): string {
  const bytes = crypto.randomBytes(16)
  const encoded = bytes.toString('base64url')
  return GIFT_CARD_CODE_PREFIX + encoded.substring(0, GIFT_CARD_CODE_LENGTH)
}

function generateBatchId(): string {
  return crypto.randomBytes(6).toString('hex')
}

export async function createGiftCard(input: GiftCardCreateInput) {
  const code = generateGiftCardCode()
  return prisma.giftCard.create({
    data: {
      code,
      faceValue: input.faceValue,
      balanceValue: input.balanceValue,
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

export async function createGiftCardBatch(
  count: number,
  input: Omit<GiftCardCreateInput, 'batchId'>
) {
  const batchId = generateBatchId()
  const codes: Awaited<ReturnType<typeof createGiftCard>>[] = []

  for (let i = 0; i < count; i++) {
    const code = await createGiftCard({ ...input, batchId })
    codes.push(code)
  }

  return { codes, batchId, count: codes.length }
}

export async function findGiftCardByCode(code: string) {
  return prisma.giftCard.findUnique({
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
      createdBy: {
        select: { id: true, username: true }
      },
      owner: {
        select: { id: true, username: true }
      },
      usedBy: {
        select: { id: true, username: true }
      }
    }
  })
}

export async function findGiftCardById(id: number) {
  return prisma.giftCard.findUnique({
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
}

export async function redeemGiftCard(code: string, userId: number) {
  return prisma.$transaction(async (tx) => {
    const giftCard = await tx.giftCard.findUnique({
      where: { code },
      select: { id: true, status: true, balanceValue: true, expiresAt: true, usedById: true }
    })

    if (!giftCard) {
      throw new Error('GIFT_CARD_NOT_FOUND')
    }
    if (giftCard.status !== 'active') {
      throw new Error(giftCard.status === 'used' ? 'GIFT_CARD_USED' : 'GIFT_CARD_DISABLED')
    }
    if (giftCard.usedById === userId) {
      throw new Error('GIFT_CARD_ALREADY_USED_BY_USER')
    }
    if (giftCard.expiresAt && new Date(giftCard.expiresAt) < new Date()) {
      const expired = await tx.giftCard.updateMany({
        where: { id: giftCard.id, status: 'active' },
        data: { status: 'expired' }
      })
      if (expired.count === 0) {
        throw new Error('GIFT_CARD_USED')
      }
      throw new Error('GIFT_CARD_EXPIRED')
    }

    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    const balanceBefore = Number(currentUser!.balance)
    const balanceAfter = balanceBefore + Number(giftCard.balanceValue)

    const updated = await tx.giftCard.updateMany({
      where: { id: giftCard.id, status: 'active' },
      data: { status: 'used', usedById: userId, usedAt: new Date() }
    })
    if (updated.count === 0) {
      throw new Error('GIFT_CARD_USED')
    }

    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: giftCard.balanceValue } }
    })

    await tx.balanceLog.create({
      data: {
        userId,
        type: 'gift',
        amount: giftCard.balanceValue,
        balanceBefore,
        balanceAfter,
        remark: `Gift card redeem: ${code}`
      }
    })

    return {
      balanceValue: Number(giftCard.balanceValue),
      balanceBefore,
      balanceAfter
    }
  })
}

export async function disableGiftCard(id: number) {
  return prisma.giftCard.updateMany({
    where: { id, status: 'active' },
    data: { status: 'disabled' }
  })
}

export async function enableGiftCard(id: number) {
  return prisma.giftCard.updateMany({
    where: { id, status: 'disabled' },
    data: { status: 'active' }
  })
}

export async function deleteGiftCard(id: number) {
  return prisma.giftCard.deleteMany({
    where: { id, status: { in: ['active', 'disabled'] } }
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
  const { page = 1, pageSize = 20, status, batchId } = options
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (batchId) where.batchId = batchId

  const [total, records] = await Promise.all([
    prisma.giftCard.count({ where }),
    prisma.giftCard.findMany({
      where,
      select: {
        id: true, code: true, faceValue: true, balanceValue: true,
        status: true, expiresAt: true, remark: true, batchId: true,
        createdAt: true, usedAt: true,
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
    records: records.map(r => ({
      ...r,
      faceValue: Number(r.faceValue),
      balanceValue: Number(r.balanceValue)
    })),
    total, page, pageSize
  }
}

export async function listGiftCardsByUser(userId: number, options: GiftCardUserListOptions) {
  const { page = 1, pageSize = 20, status } = options
  const where: Record<string, unknown> = { OR: [{ ownerId: userId }, { createdById: userId }] }
  if (status) where.status = status

  const [total, records] = await Promise.all([
    prisma.giftCard.count({ where }),
    prisma.giftCard.findMany({
      where,
      select: {
        id: true, code: true, faceValue: true, balanceValue: true,
        status: true, expiresAt: true, createdAt: true, usedAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  return {
    records: records.map(r => ({
      ...r,
      faceValue: Number(r.faceValue),
      balanceValue: Number(r.balanceValue)
    })),
    total, page, pageSize
  }
}

export async function getGiftCardStats() {
  const [total, active, used, totalValue, redeemedValue] = await Promise.all([
    prisma.giftCard.count(),
    prisma.giftCard.count({ where: { status: 'active' } }),
    prisma.giftCard.count({ where: { status: 'used' } }),
    prisma.giftCard.aggregate({
      _sum: { faceValue: true },
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
    totalIssuedValue: Number(totalValue._sum.faceValue ?? 0),
    totalRedeemedValue: Number(redeemedValue._sum.balanceValue ?? 0)
  }
}
