/**
 * 系统兑换码数据库操作
 * 宿主机所有者可以为其节点生成兑换码
 */

import { prisma } from './prisma.js'
import type { RedeemCodeType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, REDEEM_CODE_LOCK_NAMESPACE, advisoryTransactionLock, tryAdvisoryTransactionLock } from './advisory-locks.js'

// 系统兑换码前缀
const SYSTEM_CODE_PREFIX = 'h'
const REDEEM_CODE_LIST_MAX_LIMIT = 100

export type ResourceRedeemCodeType = Exclude<RedeemCodeType, 'p'>
export const RESOURCE_REDEEM_CODE_TYPES: readonly ResourceRedeemCodeType[] = ['c', 'r', 'd', 't']

function assertResourceRedeemCodeType(codeType: RedeemCodeType): asserts codeType is ResourceRedeemCodeType {
  if (!RESOURCE_REDEEM_CODE_TYPES.includes(codeType as ResourceRedeemCodeType)) {
    throw new Error('REDEEM_CODE_INVALID_TYPE')
  }
}

function clampRedeemCodeListBounds(limit: number | undefined, offset: number | undefined, defaultLimit: number): {
  limit: number
  offset: number
} {
  return {
    limit: Number.isInteger(limit) && limit !== undefined
      ? Math.min(Math.max(limit, 1), REDEEM_CODE_LIST_MAX_LIMIT)
      : defaultLimit,
    offset: Number.isInteger(offset) && offset !== undefined && offset >= 0 ? offset : 0
  }
}

// 签到系统使用的固定可选数值（不要修改）
export const CODE_VALUES: Record<ResourceRedeemCodeType, number[]> = {
  c: [1, 2, 3, 5],             // CPU: 1-5%
  r: [2, 4, 6, 12],            // 内存: 2/4/6/12 MB
  d: [16, 32, 64, 128],        // 硬盘: 16/32/64/128 MB
  t: [1, 2, 3, 5]              // 流量: 1/2/3/5 GB
}

// 宿主机兑换码的资源范围限制（允许用户自定义任意值）
export const CODE_VALUE_RANGES: Record<ResourceRedeemCodeType, { min: number; max: number; unit: string }> = {
  c: { min: 1, max: 100, unit: '%' },        // CPU: 1-100%
  r: { min: 1, max: 65536, unit: 'MB' },     // 内存: 1MB - 64GB
  d: { min: 1, max: 1048576, unit: 'MB' },   // 硬盘: 1MB - 1TB
  t: { min: 1, max: 10240, unit: 'GB' }      // 流量: 1GB - 10TB
}

/**
 * 验证兑换码数值是否在允许范围内（宿主机兑换码使用）
 */
export function isValidCodeValue(codeType: ResourceRedeemCodeType, value: number): boolean {
  const range = CODE_VALUE_RANGES[codeType]
  if (!range) return false
  return Number.isInteger(value) && value >= range.min && value <= range.max
}

/**
 * 生成系统兑换码
 */
function generateSystemCode(): string {
  const randomPart = crypto.randomBytes(12).toString('base64url').slice(0, 18)
  return `${SYSTEM_CODE_PREFIX}-${randomPart}`
}

/**
 * 判断兑换码是否为系统码（非签到码）
 */
export function isSystemCode(code: string): boolean {
  return code.startsWith(`${SYSTEM_CODE_PREFIX}-`)
}

/**
 * 创建系统兑换码
 */
export async function createRedeemCode(data: {
  hostId: number
  createdById: number
  codeType: ResourceRedeemCodeType
  codeValue: number
  maxUses?: number
  expiresAt?: Date | null
  remark?: string
  targetUserId?: number | null
}) {
  assertResourceRedeemCodeType(data.codeType)
  const code = generateSystemCode()

  return prisma.redeemCode.create({
    data: {
      code,
      hostId: data.hostId,
      createdById: data.createdById,
      codeType: data.codeType,
      codeValue: data.codeValue,
      maxUses: data.maxUses ?? 1,
      expiresAt: data.expiresAt,
      remark: data.remark,
      targetUserId: data.targetUserId ?? null
    }
  })
}

/**
 * 批量创建一次性兑换码
 */
export async function createRedeemCodeBatch(data: {
  hostId: number
  createdById: number
  codeType: ResourceRedeemCodeType
  codeValue: number
  count: number
  expiresAt?: Date | null
  remark?: string
  targetUserId?: number | null
}): Promise<{ codes: string[]; batchId: string }> {
  assertResourceRedeemCodeType(data.codeType)
  const codes: string[] = []
  const createData = []
  // 生成批次ID，同批次的兑换码每用户只能使用一张
  const batchId = crypto.randomBytes(8).toString('hex')

  for (let i = 0; i < data.count; i++) {
    const code = generateSystemCode()
    codes.push(code)
    createData.push({
      code,
      hostId: data.hostId,
      createdById: data.createdById,
      codeType: data.codeType,
      codeValue: data.codeValue,
      maxUses: 1,
      expiresAt: data.expiresAt,
      remark: data.remark,
      batchId,
      targetUserId: data.targetUserId ?? null
    })
  }

  await prisma.redeemCode.createMany({ data: createData })
  return { codes, batchId }
}

/**
 * 获取宿主机的兑换码列表
 */
export async function getRedeemCodesByHost(
  hostId: number,
  options: {
    limit?: number
    offset?: number
    enabled?: boolean
  } = {}
) {
  const { limit, offset } = clampRedeemCodeListBounds(options.limit, options.offset, 50)
  const { enabled } = options

  const where = {
    hostId,
    ...(enabled !== undefined ? { enabled } : {})
  }

  const [codes, total] = await Promise.all([
    prisma.redeemCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        createdBy: {
          select: { id: true, username: true }
        },
        _count: {
          select: { usages: true }
        }
      }
    }),
    prisma.redeemCode.count({ where })
  ])

  return {
    codes: codes.map(c => ({
      id: c.id,
      code: c.code,
      codeType: c.codeType,
      codeValue: c.codeValue,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      enabled: c.enabled,
      remark: c.remark,
      batchId: c.batchId,
      targetUserId: c.targetUserId,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      isExpired: c.expiresAt ? c.expiresAt < new Date() : false,
      isExhausted: c.usedCount >= c.maxUses
    })),
    total
  }
}

/**
 * 根据兑换码获取记录
 */
export async function getRedeemCodeByCode(code: string) {
  return prisma.redeemCode.findUnique({
    where: { code },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          userId: true
        }
      },
      createdBy: {
        select: { id: true, username: true }
      }
    }
  })
}

/**
 * 检查用户是否已使用过某个兑换码
 */
export async function hasUserUsedCode(redeemCodeId: number, userId: number): Promise<boolean> {
  const usage = await prisma.redeemCodeUsage.findFirst({
    where: { redeemCodeId, userId }
  })
  return !!usage
}

/**
 * 检查用户是否已使用过同批次的其他兑换码
 */
export async function hasUserUsedBatch(batchId: string, userId: number): Promise<boolean> {
  // 找出同批次的所有兑换码ID
  const batchCodes = await prisma.redeemCode.findMany({
    where: { batchId },
    select: { id: true }
  })

  if (batchCodes.length === 0) return false

  // 检查用户是否使用过其中任何一个
  const usage = await prisma.redeemCodeUsage.findFirst({
    where: {
      redeemCodeId: { in: batchCodes.map(c => c.id) },
      userId
    }
  })
  return !!usage
}

/**
 * 使用系统兑换码（原子操作，防止并发超兑）
 * 
 * 使用条件更新确保 usedCount < maxUses 才能成功更新
 * 如果更新影响0行，说明已达上限或并发冲突
 * 
 * @throws Error 当兑换码已达上限或并发冲突时抛出错误
 */
export async function useSystemRedeemCode(
  redeemCodeId: number,
  userId: number,
  instanceId: number,
  batchId: string | null
): Promise<void> {
  const LOCK_RETRY_LIMIT = 10
  const LOCK_RETRY_DELAY_MS = 50

  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt++) {
    const completed = await prisma.$transaction(async (tx) => {
      const locked = await tryAdvisoryTransactionLock(tx, REDEEM_CODE_LOCK_NAMESPACE, redeemCodeId)
      if (!locked) return null

      const existingUsage = await tx.redeemCodeUsage.findFirst({
        where: { redeemCodeId, userId }
      })
      if (existingUsage) {
        throw new Error('REDEEM_CODE_ALREADY_USED_BY_USER')
      }

      if (batchId) {
        const existingBatchUsage = await tx.redeemCodeUsage.findFirst({
          where: { userId, batchId }
        })
        if (existingBatchUsage) {
          throw new Error('REDEEM_CODE_BATCH_LIMIT')
        }
      }

      const result = await tx.$executeRaw`
        UPDATE "redeem_codes" 
        SET "used_count" = "used_count" + 1 
        WHERE "id" = ${redeemCodeId} 
          AND ("target_user_id" IS NULL OR "target_user_id" = ${userId})
          AND "used_count" < "max_uses"
      `

      if (result === 0) {
        throw new Error('REDEEM_CODE_EXHAUSTED')
      }

      try {
        await tx.redeemCodeUsage.create({
          data: {
            redeemCodeId,
            userId,
            instanceId,
            batchId
          }
        })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && batchId) {
          throw new Error('REDEEM_CODE_BATCH_LIMIT')
        }
        throw error
      }

      return true
    })

    if (completed) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS * (attempt + 1)))
  }

  throw new Error('REDEEM_CODE_BUSY')
}

/**
 * 记录系统兑换码应用结果。
 *
 * 外部 Incus 资源变更成功后调用；兑换码消费、实例资源和宿主机用量必须在同一事务中提交，
 * 避免出现兑换码已消耗但面板资源状态未落库的半成功状态。
 */
export async function applySystemRedeemCodeToInstance(data: {
  redeemCodeId: number
  userId: number
  instanceId: number
  hostId: number
  batchId: string | null
  instanceResources?: {
    cpu?: number
    memory?: number
    disk?: number
  }
  hostResourceDelta?: {
    cpuUsed?: number
    memoryUsed?: number
    diskUsed?: number
  }
  extraTrafficQuotaDelta?: bigint
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, REDEEM_CODE_LOCK_NAMESPACE, data.redeemCodeId)
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)

    const existingUsage = await tx.redeemCodeUsage.findFirst({
      where: { redeemCodeId: data.redeemCodeId, userId: data.userId }
    })
    if (existingUsage) {
      throw new Error('REDEEM_CODE_ALREADY_USED_BY_USER')
    }

    if (data.batchId) {
      const existingBatchUsage = await tx.redeemCodeUsage.findFirst({
        where: { userId: data.userId, batchId: data.batchId }
      })
      if (existingBatchUsage) {
        throw new Error('REDEEM_CODE_BATCH_LIMIT')
      }
    }

    const now = new Date()
    const result = await tx.$executeRaw`
      UPDATE "redeem_codes"
      SET "used_count" = "used_count" + 1
      WHERE "id" = ${data.redeemCodeId}
        AND "enabled" = true
        AND ("expires_at" IS NULL OR "expires_at" > ${now})
        AND ("target_user_id" IS NULL OR "target_user_id" = ${data.userId})
        AND "used_count" < "max_uses"
    `

    if (result === 0) {
      throw new Error('REDEEM_CODE_EXHAUSTED')
    }

    if (data.hostResourceDelta) {
      await tx.host.update({
        where: { id: data.hostId },
        data: {
          ...(data.hostResourceDelta.cpuUsed !== undefined ? { cpuUsed: { increment: data.hostResourceDelta.cpuUsed } } : {}),
          ...(data.hostResourceDelta.memoryUsed !== undefined ? { memoryUsed: { increment: data.hostResourceDelta.memoryUsed } } : {}),
          ...(data.hostResourceDelta.diskUsed !== undefined ? { diskUsed: { increment: data.hostResourceDelta.diskUsed } } : {})
        }
      })
    }

    if (data.instanceResources) {
      await tx.instance.update({
        where: { id: data.instanceId },
        data: data.instanceResources
      })
    }

    if (data.extraTrafficQuotaDelta !== undefined) {
      await tx.userQuota.update({
        where: { userId: data.userId },
        data: {
          extraTrafficQuota: { increment: data.extraTrafficQuotaDelta }
        }
      })
    }

    try {
      await tx.redeemCodeUsage.create({
        data: {
          redeemCodeId: data.redeemCodeId,
          userId: data.userId,
          instanceId: data.instanceId,
          batchId: data.batchId
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && data.batchId) {
        throw new Error('REDEEM_CODE_BATCH_LIMIT')
      }
      throw error
    }
  })
}

/**
 * 更新指定宿主机下的兑换码。
 */
export async function updateRedeemCodeForHost(
  hostId: number,
  id: number,
  data: {
    enabled?: boolean
    remark?: string
    maxUses?: number
    expiresAt?: Date | null
  }
): Promise<boolean> {
  const result = await prisma.redeemCode.updateMany({
    where: { id, hostId },
    data
  })

  return result.count > 0
}

/**
 * 删除指定宿主机下的兑换码。
 */
export async function deleteRedeemCodeForHost(
  hostId: number,
  id: number
): Promise<'deleted' | 'disabled' | 'not_found'> {
  return prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, REDEEM_CODE_LOCK_NAMESPACE, id)

    const code = await tx.redeemCode.findFirst({
      where: { id, hostId },
      select: { id: true }
    })
    if (!code) return 'not_found'

    const usageCount = await tx.redeemCodeUsage.count({ where: { redeemCodeId: id } })
    if (usageCount > 0) {
      await tx.redeemCode.updateMany({
        where: { id, hostId },
        data: { enabled: false }
      })
      return 'disabled'
    }

    await tx.redeemCode.deleteMany({ where: { id, hostId } })
    return 'deleted'
  })
}

/**
 * 批量删除指定宿主机下的兑换码。
 */
export async function deleteRedeemCodeBatchForHost(
  hostId: number,
  ids: number[]
): Promise<{ foundCount: number; deletedCount: number; disabledCount: number }> {
  if (ids.length === 0) {
    return { foundCount: 0, deletedCount: 0, disabledCount: 0 }
  }

  return prisma.$transaction(async (tx) => {
    const sortedIds = [...ids].sort((a, b) => a - b)
    for (const id of sortedIds) {
      await advisoryTransactionLock(tx, REDEEM_CODE_LOCK_NAMESPACE, id)
    }

    const codes = await tx.redeemCode.findMany({
      where: { id: { in: sortedIds }, hostId },
      select: { id: true }
    })
    const foundIds = codes.map(code => code.id)
    if (foundIds.length === 0) {
      return { foundCount: 0, deletedCount: 0, disabledCount: 0 }
    }

    const usages = await tx.redeemCodeUsage.groupBy({
      by: ['redeemCodeId'],
      where: { redeemCodeId: { in: foundIds } }
    })
    const usedIds = usages.map(usage => usage.redeemCodeId)
    const unusedIds = foundIds.filter(id => !usedIds.includes(id))

    if (usedIds.length > 0) {
      await tx.redeemCode.updateMany({
        where: { id: { in: usedIds }, hostId },
        data: { enabled: false }
      })
    }
    if (unusedIds.length > 0) {
      await tx.redeemCode.deleteMany({
        where: { id: { in: unusedIds }, hostId }
      })
    }

    return {
      foundCount: foundIds.length,
      deletedCount: unusedIds.length,
      disabledCount: usedIds.length
    }
  })
}

/**
 * 获取指定宿主机下某个兑换码的使用记录。
 */
export async function getRedeemCodeUsagesForHost(
  hostId: number,
  redeemCodeId: number,
  options: { limit?: number; offset?: number } = {}
) {
  const { limit, offset } = clampRedeemCodeListBounds(options.limit, options.offset, 20)
  const where = { redeemCodeId, redeemCode: { hostId } }

  const [usages, total] = await Promise.all([
    prisma.redeemCodeUsage.findMany({
      where,
      orderBy: { usedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: {
          select: { id: true, username: true }
        },
        instance: {
          select: { id: true, name: true }
        }
      }
    }),
    prisma.redeemCodeUsage.count({ where })
  ])

  return {
    usages: usages.map(u => ({
      id: u.id,
      user: u.user,
      instance: u.instance,
      usedAt: u.usedAt.toISOString()
    })),
    total
  }
}

/**
 * 检查兑换码是否属于指定宿主机。
 */
export async function isRedeemCodeBelongsToHost(redeemCodeId: number, hostId: number): Promise<boolean> {
  const count = await prisma.redeemCode.count({
    where: { id: redeemCodeId, hostId }
  })
  return count > 0
}

/**
 * 检查实例是否属于该宿主机
 */
export async function isInstanceBelongsToHost(instanceId: number, hostId: number): Promise<boolean> {
  const instance = await prisma.instance.findFirst({
    where: { id: instanceId, hostId }
  })
  return !!instance
}
