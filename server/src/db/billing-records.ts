/**
 * 实例计费记录相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { InstanceBillingRecord, BillingRecordType, Prisma } from '@prisma/client'

type BillingRecordDbClient = Prisma.TransactionClient | typeof prisma
const BILLING_RECORD_TYPES = new Set<BillingRecordType>([
  'newPurchase',
  'renew',
  'upgrade',
  'downgrade',
  'refund',
  'transfer_fee'
])

interface BillingLineageSeed {
  id: number
  userId: number
  hostId: number
  name: string
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface MigrationMessageData {
  instanceId?: unknown
  oldHostId?: unknown
  newHostId?: unknown
  instanceName?: unknown
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function clampPagination(
  page: number | undefined,
  pageSize: number | undefined,
  fallbackPageSize: number = 20,
  maxPageSize: number = 100
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), maxPageSize)
      : fallbackPageSize
  }
}

function normalizeBillingRecordType(type: BillingRecordType | undefined): BillingRecordType | undefined {
  return type && BILLING_RECORD_TYPES.has(type) ? type : undefined
}

function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.getTime() === b.getTime()
}

async function getBillingLineageSeed(
  instanceId: number,
  client: BillingRecordDbClient
): Promise<BillingLineageSeed | null> {
  return client.instance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      userId: true,
      hostId: true,
      name: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true
    }
  })
}

async function resolveImmediateMigratedBillingSource(
  seed: BillingLineageSeed,
  client: BillingRecordDbClient
): Promise<number | null> {
  const migrationMessages = await client.inboxMessage.findMany({
    where: {
      userId: seed.userId,
      eventType: 'instance_migrated'
    },
    select: {
      id: true,
      data: true,
      createdAt: true
    },
    orderBy: { createdAt: 'desc' }
  })

  for (const message of migrationMessages) {
    const data = (message.data || {}) as MigrationMessageData

    if (!isInteger(data.instanceId) || data.instanceId !== seed.id) continue
    if (!isInteger(data.oldHostId)) continue
    if (isInteger(data.newHostId) && data.newHostId !== seed.hostId) continue

    const expectedName = isNonEmptyString(data.instanceName) ? data.instanceName : seed.name
    const windowStart = new Date(message.createdAt.getTime() - 30 * 60 * 1000)
    const windowEnd = new Date(message.createdAt.getTime() + 30 * 60 * 1000)

    const deletedCandidates = await client.instance.findMany({
      where: {
        userId: seed.userId,
        hostId: data.oldHostId,
        name: expectedName,
        status: 'deleted',
        id: { not: seed.id },
        updatedAt: {
          gte: windowStart,
          lte: windowEnd
        }
      },
      select: {
        id: true,
        expiresAt: true
      }
    })

    if (deletedCandidates.length === 0) continue

    const candidatesWithRecordCounts = await Promise.all(
      deletedCandidates.map(async candidate => ({
        candidate,
        recordCount: await client.instanceBillingRecord.count({
          where: { instanceId: candidate.id }
        })
      }))
    )

    if (candidatesWithRecordCounts.length === 1) {
      return candidatesWithRecordCounts[0].candidate.id
    }

    const preferredCandidates = candidatesWithRecordCounts.filter(item =>
      sameDate(item.candidate.expiresAt, seed.expiresAt)
    )
    if (preferredCandidates.length === 1) {
      return preferredCandidates[0].candidate.id
    }

    const candidatesWithRecords = candidatesWithRecordCounts.filter(item => item.recordCount > 0)
    if (candidatesWithRecords.length === 1) {
      return candidatesWithRecords[0].candidate.id
    }

    const finalCandidates = preferredCandidates.length > 0 ? preferredCandidates : candidatesWithRecordCounts

    if (finalCandidates.length === 1) {
      return finalCandidates[0].candidate.id
    }
  }

  return null
}

/**
 * 获取实例的计费血缘链（从最早祖先到当前实例）
 * 兼容旧数据中“改节点/迁移”后新建实例但未迁移账单记录的情况
 */
export async function getInstanceBillingLineageIds(
  instanceId: number,
  client: BillingRecordDbClient = prisma
): Promise<number[]> {
  const lineage: number[] = []
  const visited = new Set<number>()

  let current = await getBillingLineageSeed(instanceId, client)

  while (current && !visited.has(current.id)) {
    lineage.unshift(current.id)
    visited.add(current.id)

    const predecessorId = await resolveImmediateMigratedBillingSource(current, client)
    if (!predecessorId || visited.has(predecessorId)) {
      break
    }

    current = await getBillingLineageSeed(predecessorId, client)
  }

  return lineage.length > 0 ? lineage : [instanceId]
}

// ==================== 查询操作 ====================

/**
 * 获取实例的计费记录
 */
export async function getInstanceBillingRecords(
  instanceId: number,
  options: {
    page?: number
    pageSize?: number
    type?: BillingRecordType
  } = {}
): Promise<{
  records: InstanceBillingRecord[]
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const type = normalizeBillingRecordType(options.type)
  const skip = (page - 1) * pageSize
  const billingLineageInstanceIds = await getInstanceBillingLineageIds(instanceId)

  const where: Prisma.InstanceBillingRecordWhereInput = {
    instanceId: { in: billingLineageInstanceIds },
    ...(type ? { type } : {})
  }

  const [records, total] = await Promise.all([
    prisma.instanceBillingRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.instanceBillingRecord.count({ where })
  ])

  return { records, total, page, pageSize }
}

/**
 * 获取用户的所有计费记录
 */
export async function getUserBillingRecords(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    type?: BillingRecordType
  } = {}
): Promise<{
  records: InstanceBillingRecord[]
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const type = normalizeBillingRecordType(options.type)
  const skip = (page - 1) * pageSize

  const where: Prisma.InstanceBillingRecordWhereInput = {
    userId,
    ...(type ? { type } : {})
  }

  const [records, total] = await Promise.all([
    prisma.instanceBillingRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        instance: {
          select: { id: true, name: true }
        }
      }
    }),
    prisma.instanceBillingRecord.count({ where })
  ])

  return { records, total, page, pageSize }
}

// ==================== 创建操作 ====================

export interface CreateBillingRecordInput {
  instanceId: number
  userId: number
  type: BillingRecordType
  amount: number
  months: number
  periodStart: Date
  periodEnd: Date
  balanceLogId?: number
  remark?: string
}

/**
 * 创建计费记录
 */
export async function createBillingRecord(
  input: CreateBillingRecordInput
): Promise<InstanceBillingRecord> {
  return prisma.instanceBillingRecord.create({
    data: {
      instanceId: input.instanceId,
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      months: input.months,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      balanceLogId: input.balanceLogId,
      remark: input.remark
    }
  })
}

/**
 * 创建新开通记录
 */
export async function createNewPurchaseRecord(
  instanceId: number,
  userId: number,
  amount: number,
  months: number,
  periodStart: Date,
  periodEnd: Date,
  balanceLogId?: number
): Promise<InstanceBillingRecord> {
  return createBillingRecord({
    instanceId,
    userId,
    type: 'newPurchase',
    amount,
    months,
    periodStart,
    periodEnd,
    balanceLogId,
    remark: `新开通 ${months} 个月`
  })
}

/**
 * 创建续费记录
 */
export async function createRenewRecord(
  instanceId: number,
  userId: number,
  amount: number,
  months: number,
  periodStart: Date,
  periodEnd: Date,
  balanceLogId?: number
): Promise<InstanceBillingRecord> {
  return createBillingRecord({
    instanceId,
    userId,
    type: 'renew',
    amount,
    months,
    periodStart,
    periodEnd,
    balanceLogId,
    remark: `续费 ${months} 个月`
  })
}

/**
 * 创建升级记录
 */
export async function createUpgradeRecord(
  instanceId: number,
  userId: number,
  amount: number,
  periodStart: Date,
  periodEnd: Date,
  balanceLogId?: number,
  remark?: string
): Promise<InstanceBillingRecord> {
  return createBillingRecord({
    instanceId,
    userId,
    type: 'upgrade',
    amount,
    months: 0, // 升级不涉及月数变化
    periodStart,
    periodEnd,
    balanceLogId,
    remark: remark || '升级方案'
  })
}

/**
 * 创建降级记录
 */
export async function createDowngradeRecord(
  instanceId: number,
  userId: number,
  periodStart: Date,
  periodEnd: Date,
  remark?: string
): Promise<InstanceBillingRecord> {
  return createBillingRecord({
    instanceId,
    userId,
    type: 'downgrade',
    amount: 0, // 降级不扣费
    months: 0,
    periodStart,
    periodEnd,
    remark: remark || '降级方案'
  })
}

/**
 * 将实例计费记录整体迁移到新的实例 ID
 * 用于“改节点/迁移实例”后保持退款与计费历史连续
 */
export async function reassignInstanceBillingRecords(
  sourceInstanceId: number,
  targetInstanceId: number,
  client: BillingRecordDbClient = prisma
): Promise<number> {
  if (sourceInstanceId === targetInstanceId) return 0

  const result = await client.instanceBillingRecord.updateMany({
    where: { instanceId: sourceInstanceId },
    data: { instanceId: targetInstanceId }
  })

  return result.count
}

/**
 * 创建退款记录
 */
export async function createRefundRecord(
  instanceId: number,
  userId: number,
  amount: number,
  balanceLogId?: number,
  remark?: string
): Promise<InstanceBillingRecord> {
  const now = new Date()
  return createBillingRecord({
    instanceId,
    userId,
    type: 'refund',
    amount: -Math.abs(amount),
    months: 0,
    periodStart: now,
    periodEnd: now,
    balanceLogId,
    remark: remark || '管理员退款'
  })
}

// ==================== 统计操作 ====================

/**
 * 获取实例的总消费金额
 */
export async function getInstanceTotalSpent(instanceId: number): Promise<number> {
  const result = await prisma.instanceBillingRecord.aggregate({
    where: {
      instanceId,
      type: { in: ['newPurchase', 'renew', 'upgrade'] }
    },
    _sum: { amount: true }
  })
  // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
  return result._sum.amount !== null
    ? parseFloat(String(result._sum.amount))
    : 0
}

/**
 * 获取实例的总退款金额
 */
export async function getInstanceTotalRefunded(instanceId: number): Promise<number> {
  const records = await prisma.instanceBillingRecord.findMany({
    where: {
      instanceId,
      type: 'refund'
    },
    select: { amount: true }
  })
  return records.reduce((sum, record) => sum + Math.abs(Number(record.amount)), 0)
}

/**
 * 获取用户的消费统计
 */
export async function getUserBillingStats(userId: number): Promise<{
  totalSpent: number
  totalRefunded: number
  purchaseCount: number
  renewCount: number
}> {
  const [spending, refunds, purchaseCount, renewCount] = await Promise.all([
    prisma.instanceBillingRecord.aggregate({
      where: {
        userId,
        type: { in: ['newPurchase', 'renew', 'upgrade'] }
      },
      _sum: { amount: true }
    }),
    prisma.instanceBillingRecord.findMany({
      where: {
        userId,
        type: 'refund'
      },
      select: { amount: true }
    }),
    prisma.instanceBillingRecord.count({
      where: { userId, type: 'newPurchase' }
    }),
    prisma.instanceBillingRecord.count({
      where: { userId, type: 'renew' }
    })
  ])

  return {
    // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
    totalSpent: spending._sum.amount !== null
      ? parseFloat(String(spending._sum.amount))
      : 0,
    totalRefunded: refunds.reduce((sum, record) => sum + Math.abs(Number(record.amount)), 0),
    purchaseCount,
    renewCount
  }
}
