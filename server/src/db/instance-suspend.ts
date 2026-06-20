/**
 * 实例封停/解封相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Instance } from '@prisma/client'

// ==================== 封停操作 ====================

/**
 * 封停实例（系统自动封停 - 到期）
 */
export async function suspendInstanceByExpiry(
  instanceId: number
): Promise<Instance> {
  return prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy: null, // null 表示系统自动
      suspendReason: 'expired'
    }
  })
}

/**
 * 封停实例（管理员或宿主机所有者手动封停）
 */
export async function suspendInstanceManually(
  instanceId: number,
  operatorId: number,
  reason: string
): Promise<Instance> {
  return prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy: operatorId,
      suspendReason: reason
    }
  })
}

/**
 * 解封实例
 */
export async function unsuspendInstance(
  instanceId: number
): Promise<Instance> {
  return prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: 'stopped', // 解封后设为停止状态
      suspendedAt: null,
      suspendedBy: null,
      suspendReason: null
    }
  })
}

// ==================== 查询操作 ====================

/**
 * 检查实例是否已封停
 */
export async function isInstanceSuspended(instanceId: number): Promise<boolean> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { status: true }
  })
  return instance?.status === 'suspended'
}

/**
 * 检查实例是否到期封停（可续费解封）
 */
export async function isExpiredSuspension(instanceId: number): Promise<boolean> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { status: true, suspendReason: true }
  })
  return instance?.status === 'suspended' && instance?.suspendReason === 'expired'
}

/**
 * 检查实例是否手动封停（不可续费解封）
 */
export async function isManualSuspension(instanceId: number): Promise<boolean> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { status: true, suspendReason: true, suspendedBy: true }
  })
  return instance?.status === 'suspended' && instance?.suspendedBy !== null
}

/**
 * 获取实例的封停信息
 */
export async function getSuspendInfo(instanceId: number): Promise<{
  isSuspended: boolean
  suspendedAt: Date | null
  suspendedBy: number | null
  suspendReason: string | null
  isExpiredSuspension: boolean
  isManualSuspension: boolean
} | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      status: true,
      suspendedAt: true,
      suspendedBy: true,
      suspendReason: true
    }
  })

  if (!instance) return null

  const isSuspended = instance.status === 'suspended'
  return {
    isSuspended,
    suspendedAt: instance.suspendedAt,
    suspendedBy: instance.suspendedBy,
    suspendReason: instance.suspendReason,
    isExpiredSuspension: isSuspended && instance.suspendReason === 'expired',
    isManualSuspension: isSuspended && instance.suspendedBy !== null
  }
}

/**
 * 获取即将到期的实例（用于发送提醒）
 * @param hoursBeforeExpiry 到期前多少小时
 * @param notifiedWithin 在多少小时内已通知过的不再返回
 */
export async function getExpiringInstances(
  hoursBeforeExpiry: number,
  notifiedWithin?: number
): Promise<Instance[]> {
  const now = new Date()
  const expiryThreshold = new Date(now.getTime() + hoursBeforeExpiry * 60 * 60 * 1000)

  const whereCondition: any = {
    expiresAt: {
      not: null,
      lte: expiryThreshold,
      gt: now // 还未到期
    },
    status: { notIn: ['suspended', 'deleted'] } // 未封停且未删除
  }

  // 如果指定了 notifiedWithin，排除最近已通知的
  if (notifiedWithin) {
    const notifiedThreshold = new Date(now.getTime() - notifiedWithin * 60 * 60 * 1000)
    whereCondition.OR = [
      { expiryNotifiedAt: null },
      { expiryNotifiedAt: { lt: notifiedThreshold } }
    ]
  }

  return prisma.instance.findMany({
    where: whereCondition
  })
}

/**
 * 获取已到期但未封停的实例
 * 注意：只查询付费实例（packagePlanId 不为 null）
 * 排除已删除和已封停的实例
 */
export async function getExpiredUnsuspendedInstances(): Promise<Instance[]> {
  return prisma.instance.findMany({
    where: {
      packagePlanId: { not: null },  // 明确排除免费实例
      expiresAt: {
        not: null,
        lt: new Date()
      },
      status: { notIn: ['suspended', 'deleted'] }  // 排除已封停和已删除
    }
  })
}

/**
 * 更新到期通知时间
 */
export async function updateExpiryNotifiedAt(instanceId: number): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: { expiryNotifiedAt: new Date() }
  })
}

/**
 * 获取需要自动续费的实例
 * @param hoursBeforeExpiry 到期前多少小时
 */
export async function getAutoRenewInstances(
  hoursBeforeExpiry: number
): Promise<Instance[]> {
  const now = new Date()
  const expiryThreshold = new Date(now.getTime() + hoursBeforeExpiry * 60 * 60 * 1000)

  return prisma.instance.findMany({
    where: {
      autoRenew: true,
      expiresAt: {
        not: null,
        lte: expiryThreshold,
        gt: now // 还未到期
      },
      status: { notIn: ['suspended', 'deleted'] } // 未封停且未删除
    }
  })
}

/**
 * 更新自动续费尝试记录
 */
export async function updateAutoRenewAttempt(
  instanceId: number,
  attempt: number,
  disableAutoRenew: boolean = false
): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      autoRenewAttempts: attempt,
      lastAutoRenewAttemptAt: new Date(),
      ...(disableAutoRenew ? { autoRenew: false } : {})
    }
  })
}

/**
 * 重置自动续费尝试记录（续费成功后）
 */
export async function resetAutoRenewAttempts(instanceId: number): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      autoRenewAttempts: 0,
      lastAutoRenewAttemptAt: null
    }
  })
}

/**
 * 获取封停超过指定天数的实例（用于自动删除）
 */
export async function getSuspendedInstancesOlderThan(days: number): Promise<Instance[]> {
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - days)

  return prisma.instance.findMany({
    where: {
      status: 'suspended',
      suspendedAt: {
        not: null,
        lt: threshold
      }
    }
  })
}
