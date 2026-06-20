/**
 * 套餐方案相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { PackagePlan } from '@prisma/client'
import { applyTrafficMultiplier } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'

// ==================== 查询操作 ====================

/**
 * 根据 ID 获取方案
 */
export async function getPlanById(id: number): Promise<PackagePlan | null> {
  return prisma.packagePlan.findUnique({
    where: { id }
  })
}

/**
 * 获取套餐下的所有方案
 */
export async function getPlansByPackageId(
  packageId: number,
  options: {
    activeOnly?: boolean
  } = {}
): Promise<PackagePlan[]> {
  const { activeOnly = false } = options
  
  return prisma.packagePlan.findMany({
    where: {
      packageId,
      ...(activeOnly ? { isActive: true } : {})
    },
    orderBy: { sortOrder: 'asc' }
  })
}

/**
 * 获取套餐下的活跃方案
 */
export async function getActivePlansByPackageId(packageId: number): Promise<PackagePlan[]> {
  return getPlansByPackageId(packageId, { activeOnly: true })
}

/**
 * 检查套餐是否为付费套餐（有活跃方案）
 */
export async function isPaidPackage(packageId: number): Promise<boolean> {
  const count = await prisma.packagePlan.count({
    where: {
      packageId,
      isActive: true
    }
  })
  return count > 0
}

/**
 * 检查方案名称是否在套餐下唯一
 */
export async function isPlanNameUnique(
  packageId: number,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const existing = await prisma.packagePlan.findFirst({
    where: {
      packageId,
      name,
      ...(excludeId ? { id: { not: excludeId } } : {})
    }
  })
  return !existing
}

// ==================== 创建操作 ====================

export interface CreatePlanInput {
  packageId: number
  name: string
  description?: string
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  swapSize: number
  trafficLimit: bigint
  trafficLimitSpeed?: string
  price: number
  billingCycle?: number
  setupFee?: number
  isActive?: boolean
  isSoldOut?: boolean
  sortOrder?: number
  slaGuarantee?: number | null
}

/**
 * 创建套餐方案
 */
export async function createPlan(input: CreatePlanInput): Promise<PackagePlan> {
  const {
    packageId,
    name,
    description,
    cpu,
    memory,
    disk,
    portLimit,
    snapshotLimit,
    backupLimit,
    siteLimit,
    swapSize,
    trafficLimit,
    trafficLimitSpeed = '1Mbit',
    price,
    billingCycle = 1,
    setupFee = 0,
    isActive = true,
    isSoldOut = false,
    sortOrder = 0,
    slaGuarantee = null
  } = input

  return prisma.packagePlan.create({
    data: {
      packageId,
      name,
      description,
      cpu,
      memory,
      disk,
      portLimit,
      snapshotLimit,
      backupLimit,
      siteLimit,
      swapSize,
      trafficLimit,
      trafficLimitSpeed,
      price,
      billingCycle,
      setupFee,
      isActive,
      isSoldOut,
      sortOrder,
      slaGuarantee
    }
  })
}

// ==================== 更新操作 ====================

export interface UpdatePlanInput {
  name?: string
  description?: string
  cpu?: number
  memory?: number
  disk?: number
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  swapSize?: number
  trafficLimit?: bigint
  trafficLimitSpeed?: string
  price?: number
  billingCycle?: number
  setupFee?: number
  isActive?: boolean
  isSoldOut?: boolean
  sortOrder?: number
  slaGuarantee?: number | null
}

/**
 * 更新套餐方案
 */
export async function updatePlan(
  id: number,
  input: UpdatePlanInput
): Promise<PackagePlan> {
  return prisma.packagePlan.update({
    where: { id },
    data: input
  })
}

/**
 * 更新方案配额后，同步到所有关联实例
 * 注意：只同步配额字段，不同步资源配置（CPU/内存/磁盘）
 */
export async function syncPlanQuotaToInstances(
  planId: number,
  plan: PackagePlan,
  previousPlanSwapSize?: number
): Promise<{ count: number; instanceIds: number[] }> {
  const pkg = await prisma.package.findUnique({
    where: { id: plan.packageId },
    select: {
      instanceType: true,
      packageHosts: {
        select: {
          hostId: true,
          trafficMultiplier: true
        }
      }
    }
  })

  const multiplierByHostId = new Map((pkg?.packageHosts || []).map(binding => [
    binding.hostId,
    binding.trafficMultiplier
  ]))

  const updatedTrafficInstanceIds: number[] = []

  async function applyTrafficLimitsToPlanInstances(): Promise<void> {
    const instances = await prisma.instance.findMany({
      where: { packagePlanId: planId },
      select: { id: true, hostId: true, monthlyTrafficUsed: true }
    })

    await Promise.all(instances.map(instance => {
      const monthlyTrafficLimit = applyTrafficMultiplier(plan.trafficLimit, multiplierByHostId.get(instance.hostId) ?? 1)
      updatedTrafficInstanceIds.push(instance.id)
      return prisma.instance.update({
        where: { id: instance.id },
        data: {
          monthlyTrafficLimit,
          trafficStatus: calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, monthlyTrafficLimit)
        }
      })
    }))
  }

  if (pkg?.instanceType === 'vm') {
    const vmResult = await prisma.instance.updateMany({
      where: { packagePlanId: planId },
      data: {
        portLimit: plan.portLimit,
        snapshotLimit: plan.snapshotLimit,
        backupLimit: plan.backupLimit,
        siteLimit: plan.siteLimit,
        swapEnabled: false,
        swapSize: null
      }
    })
    await applyTrafficLimitsToPlanInstances()
    return { count: vmResult.count, instanceIds: updatedTrafficInstanceIds }
  }

  const enabledResult = await prisma.instance.updateMany({
    where: { packagePlanId: planId, swapEnabled: true },
    data: {
      portLimit: plan.portLimit,
      snapshotLimit: plan.snapshotLimit,
      backupLimit: plan.backupLimit,
      siteLimit: plan.siteLimit
    }
  })

  const disabledQuotaResult = await prisma.instance.updateMany({
    where: {
      packagePlanId: planId,
      swapEnabled: false
    },
    data: {
      portLimit: plan.portLimit,
      snapshotLimit: plan.snapshotLimit,
      backupLimit: plan.backupLimit,
      siteLimit: plan.siteLimit
    }
  })

  await prisma.instance.updateMany({
    where: {
      packagePlanId: planId,
      swapEnabled: false,
      OR: [
        { swapSize: null },
        { swapSize: previousPlanSwapSize ?? 0 }
      ]
    },
    data: {
      swapSize: plan.swapSize,
    }
  })
  await applyTrafficLimitsToPlanInstances()
  return { count: enabledResult.count + disabledQuotaResult.count, instanceIds: updatedTrafficInstanceIds }
}

/**
 * 启用/禁用方案
 */
export async function togglePlanActive(
  id: number,
  isActive: boolean
): Promise<PackagePlan> {
  return prisma.packagePlan.update({
    where: { id },
    data: { isActive }
  })
}

// ==================== 删除操作 ====================

/**
 * 检查方案是否可以删除
 * 如果方案还有关联的实例，则不能删除
 */
export async function canDeletePlan(id: number): Promise<{
  canDelete: boolean
  reason?: string
  instanceCount?: number
}> {
  const instanceCount = await prisma.instance.count({
    where: { packagePlanId: id }
  })
  
  if (instanceCount > 0) {
    return {
      canDelete: false,
      reason: `该方案下还有 ${instanceCount} 个实例，无法删除`,
      instanceCount
    }
  }
  
  return { canDelete: true }
}

/**
 * 删除套餐方案
 */
export async function deletePlan(id: number): Promise<void> {
  await prisma.packagePlan.delete({
    where: { id }
  })
}

// ==================== 辅助函数 ====================

/**
 * 计算方案月价
 * 注意：PackagePlan.price 存储的是分（cents），此函数返回的也是分
 * 如需显示为元，调用方需要 / 100
 */
export function calculateMonthlyPrice(plan: PackagePlan): number {
  const price = Number(plan.price) || 0  // 分
  const cycle = Math.max(plan.billingCycle || 1, 1) // 防止除零
  return price / cycle  // 返回分/月
}

/**
 * 获取方案包含的资源配置（用于前端展示）
 */
export function getPlanResources(plan: PackagePlan) {
  return {
    cpu: plan.cpu,
    memory: plan.memory,
    disk: plan.disk,
    portLimit: plan.portLimit,
    snapshotLimit: plan.snapshotLimit,
    backupLimit: plan.backupLimit,
    siteLimit: plan.siteLimit,
    swapSize: plan.swapSize,
    trafficLimit: plan.trafficLimit.toString(),
    trafficLimitSpeed: plan.trafficLimitSpeed
  }
}

/**
 * 获取方案计费信息（用于前端展示）
 */
export function getPlanBilling(plan: PackagePlan) {
  return {
    price: Number(plan.price),
    billingCycle: plan.billingCycle,
    setupFee: Number(plan.setupFee),
    monthlyPrice: calculateMonthlyPrice(plan)
  }
}
