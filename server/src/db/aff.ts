/**
 * AFF 推荐计划相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { AffCode, AffLog, AffLogType, AffWithdrawal, AffWithdrawalStatus, Prisma, PrismaClient } from '@prisma/client'
import { nanoid } from 'nanoid'
import {
  USER_AFF_BALANCE_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock,
} from './advisory-locks.js'

const AFF_LOG_TYPES = new Set<AffLogType>(['new_purchase', 'renew', 'convert'])
const AFF_WITHDRAWAL_STATUSES = new Set<AffWithdrawalStatus>(['pending', 'approved', 'rejected'])

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

function normalizeAffLogType(type: AffLogType | undefined): AffLogType | undefined {
  return type && AFF_LOG_TYPES.has(type) ? type : undefined
}

function normalizeAffWithdrawalStatus(status: AffWithdrawalStatus | undefined): AffWithdrawalStatus | undefined {
  return status && AFF_WITHDRAWAL_STATUSES.has(status) ? status : undefined
}

// ==================== AFF 余额操作 ====================

/**
 * 获取用户 AFF 余额
 */
export async function getAffBalance(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { affBalance: true }
  })
  return user ? Number(user.affBalance) : 0
}

/**
 * 检查用户是否已激活 AFF
 */
export async function isAffActivated(userId: number): Promise<boolean> {
  // 由于需求变更，AFF 推荐计划现在无需充值即可使用
  // 所有用户都可以使用AFF推荐计划
  // 保留userId参数以保持API兼容性，但暂时不需要实际查询数据库
  userId; // 使用参数避免编译警告
  return true;
  
  // 原来的逻辑（已注释）
  // const user = await prisma.user.findUnique({
  //   where: { id: userId },
  //   select: { affActivatedAt: true }
  // })
  // return !!user?.affActivatedAt
}

/**
 * 激活用户的 AFF 推荐计划（首次充值时调用）
 */
export async function activateAff(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { affActivatedAt: new Date() }
  })
}

// AFF 余额变动输入
export interface AffBalanceChangeInput {
  userId: number
  type: AffLogType
  amount: number // 正数=收入，负数=转出
  affCodeId?: number
  instanceId?: number
  mailSubscriptionId?: number
  originalAmount?: number
  remark?: string
}

// AFF 余额变动结果
export interface AffBalanceChangeResult {
  success: boolean
  affLog?: AffLog
  newBalance?: number
  error?: string
}

async function changeAffBalanceInTransaction(
  tx: Prisma.TransactionClient,
  input: AffBalanceChangeInput
): Promise<AffBalanceChangeResult> {
  const { userId, type, amount, affCodeId, instanceId, mailSubscriptionId, originalAmount, remark } = input

  await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, userId)

  // 1. 获取当前 AFF 余额
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { affBalance: true }
  })

  if (!user) {
    throw new Error('用户不存在')
  }

  const balanceBefore = Number(user.affBalance)
  const balanceAfter = balanceBefore + amount

  // 2. 检查余额是否足够（如果是扣款）
  if (amount < 0 && balanceAfter < 0) {
    throw new Error('AFF 余额不足')
  }

  // 3. 更新用户 AFF 余额
  await tx.user.update({
    where: { id: userId },
    data: { affBalance: { increment: amount } }
  })

  // 4. 创建 AFF 余额变动日志
  const affLog = await tx.affLog.create({
    data: {
      userId,
      type,
      amount,
      affCodeId,
      instanceId,
      mailSubscriptionId,
      originalAmount,
      balanceBefore,
      balanceAfter,
      remark
    }
  })

  return {
    success: true,
    affLog,
    newBalance: balanceAfter
  }
}

/**
 * 变更用户 AFF 余额（事务安全）
 */
export async function changeAffBalance(
  input: AffBalanceChangeInput,
  tx?: Prisma.TransactionClient
): Promise<AffBalanceChangeResult> {
  try {
    return tx
      ? await changeAffBalanceInTransaction(tx, input)
      : await prisma.$transaction((transaction) => changeAffBalanceInTransaction(transaction, input))
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AFF 余额变动失败'
    }
  }
}

// ==================== AFF 优惠码操作 ====================

/**
 * 生成优惠码（格式：AFF-用户ID-8位随机码）
 */
export function generateAffCode(userId: number): string {
  const random = nanoid(8).toUpperCase()
  return `AFF-${userId}-${random}`
}

// 优惠码带关联信息的类型（支持全局码，packagePlan 可为 null）
export type AffCodeWithPlan = AffCode & {
  packagePlan: {
    id: number
    name: string
    price: number
    package: { id: number; name: string }
  } | null
}

/**
 * 获取用户的所有优惠码（包括全局码）
 */
export async function getUserAffCodes(userId: number): Promise<AffCodeWithPlan[]> {
  const codes = await prisma.affCode.findMany({
    where: { userId },
    include: {
      packagePlan: {
        select: {
          id: true,
          name: true,
          price: true,
          package: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
  return codes.map(code => ({
    ...code,
    packagePlan: code.packagePlan ? {
      ...code.packagePlan,
      price: Number(code.packagePlan.price)
    } : null
  }))
}

/**
 * 获取用户可以创建优惠码的方案列表
 * 只返回用户购买过且尚未创建优惠码的付费方案
 * 同时返回全局码状态
 */
export async function getAvailablePlansForAffCode(userId: number): Promise<{
  plans: {
    id: number
    name: string
    price: number
    package: { id: number; name: string }
    hasCode: boolean
  }[]
  hasGlobalCode: boolean
}> {
  // 1. 检查用户是否已有全局码
  const globalCode = await prisma.affCode.findFirst({
    where: { userId, packagePlanId: null }
  })
  const hasGlobalCode = !!globalCode

  // 2. 获取用户购买过的付费方案 ID
  const purchasedInstances = await prisma.instance.findMany({
    where: {
      userId,
      packagePlanId: { not: null },
      packagePlan: { price: { gt: 0 } } // 只要付费方案
    },
    select: { packagePlanId: true },
    distinct: ['packagePlanId']
  })
  const purchasedPlanIds = purchasedInstances.map(i => i.packagePlanId!).filter(Boolean)

  if (purchasedPlanIds.length === 0) {
    return { plans: [], hasGlobalCode }
  }

  // 3. 获取这些方案的详细信息和是否已创建优惠码
  const plans = await prisma.packagePlan.findMany({
    where: {
      id: { in: purchasedPlanIds },
      isActive: true
    },
    include: {
      package: { select: { id: true, name: true } },
      affCodes: {
        where: { userId },
        select: { id: true }
      }
    }
  })

  return {
    plans: plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      price: Number(plan.price),
      package: plan.package,
      hasCode: plan.affCodes.length > 0
    })),
    hasGlobalCode
  }
}

/**
 * 创建优惠码（支持方案专有码和全局码）
 * @param packagePlanId 不传或传 undefined 则创建全局码
 * 折扣率和返利率固定为 5%/5%
 */
export async function createAffCode(
  userId: number,
  packagePlanId?: number
): Promise<{ success: boolean; affCode?: AffCode; error?: string }> {
  try {
    // 1. 检查是否已激活 AFF
    const activated = await isAffActivated(userId)
    if (!activated) {
      return { success: false, error: '推荐计划尚未激活，请先充值任意金额' }
    }

    // 固定折扣率和返利率为 5%/5%
    const discountRate = 0.05
    const commissionRate = 0.05

    // 全局码逻辑 - 允许创建多个
    if (packagePlanId === undefined) {
      try {
        const code = generateAffCode(userId)
        const affCode = await prisma.affCode.create({
          data: {
            code,
            userId,
            packagePlanId: null,
            discountRate,
            commissionRate
          }
        })
        return { success: true, affCode }
      } catch (error) {
        return { success: false, error: '创建全局优惠码失败' }
      }
    }

    // 方案专有码逻辑（原有逻辑）
    // 2. 检查方案是否存在且为付费方案
    const plan = await prisma.packagePlan.findUnique({
      where: { id: packagePlanId },
      select: { id: true, price: true, isActive: true }
    })
    if (!plan || Number(plan.price) <= 0) {
      return { success: false, error: '方案不存在或不是付费方案' }
    }
    if (!plan.isActive) {
      return { success: false, error: '方案已下架' }
    }

    // 3. 检查用户是否购买过该方案
    const hasPurchased = await prisma.instance.count({
      where: {
        userId,
        packagePlanId
      }
    })
    if (hasPurchased === 0) {
      return { success: false, error: '您尚未购买过此方案，无法创建优惠码' }
    }

    // 4. 检查是否已创建过（唯一约束会自动阻止，但这里提前检查给出友好提示）
    const existing = await prisma.affCode.findUnique({
      where: { userId_packagePlanId: { userId, packagePlanId } }
    })
    if (existing) {
      return { success: false, error: '该方案已创建过优惠码' }
    }

    // 5. 创建优惠码
    const code = generateAffCode(userId)
    const affCode = await prisma.affCode.create({
      data: {
        code,
        userId,
        packagePlanId,
        discountRate,
        commissionRate
      }
    })

    return { success: true, affCode }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '创建优惠码失败'
    }
  }
}

/**
 * 删除优惠码（仅允许删除未产生收益且未绑定任何订阅的优惠码）
 */
export async function deleteAffCode(
  userId: number,
  codeId: number
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    // 1. 查找优惠码
    const affCode = await prisma.affCode.findUnique({
      where: { id: codeId },
      select: { id: true, code: true, userId: true, usedCount: true }
    })

    if (!affCode) {
      return { success: false, error: '优惠码不存在' }
    }

    // 2. 检查所有权
    if (affCode.userId !== userId) {
      return { success: false, error: '无权删除此优惠码' }
    }

    // 3. 检查使用次数和现有绑定
    if (affCode.usedCount > 0) {
      return { success: false, error: '该优惠码已被使用，无法删除' }
    }

    const [instanceBindingCount, mailBindingCount] = await Promise.all([
      prisma.affBinding.count({ where: { affCodeId: codeId } }),
      prisma.mailSubscriptionAffBinding.count({ where: { affCodeId: codeId } })
    ])

    if (instanceBindingCount > 0 || mailBindingCount > 0) {
      return { success: false, error: '该优惠码已绑定订阅，无法删除' }
    }

    // 4. 删除优惠码
    await prisma.affCode.delete({
      where: { id: codeId }
    })

    return { success: true, code: affCode.code }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '删除优惠码失败'
    }
  }
}

/**
 * 验证优惠码（支持全局码）
 */
export async function validateAffCode(
  code: string,
  packagePlanId: number,
  userId: number
): Promise<{
  valid: boolean
  affCode?: AffCode
  discountRate?: number
  commissionRate?: number
  error?: string
}> {
  // 1. 查询优惠码
  const affCode = await prisma.affCode.findUnique({
    where: { code: code.toUpperCase() }
  })

  if (!affCode) {
    return { valid: false, error: '优惠码不存在' }
  }

  // 2. 检查方案是否匹配（全局码跳过此检查）
  if (affCode.packagePlanId !== null && affCode.packagePlanId !== packagePlanId) {
    return { valid: false, error: '优惠码不适用于此方案' }
  }

  // 3. 检查是否自己的优惠码
  if (affCode.userId === userId) {
    return { valid: false, error: '不能使用自己的优惠码' }
  }

  return {
    valid: true,
    affCode,
    discountRate: Number(affCode.discountRate),
    commissionRate: Number(affCode.commissionRate)
  }
}

// ==================== AFF 绑定与返利 ====================

/**
 * 创建实例与优惠码的绑定关系（开通时调用）
 */
export async function createAffBinding(
  instanceId: number,
  affCodeId: number,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma
  await client.affBinding.create({
    data: { instanceId, affCodeId }
  })
}

/**
 * 获取实例绑定的优惠码
 */
export async function getInstanceAffBinding(instanceId: number, tx?: Prisma.TransactionClient): Promise<{
  affCode: AffCode
  userId: number // 优惠码创建者
} | null> {
  const client = tx || prisma
  const binding = await client.affBinding.findUnique({
    where: { instanceId },
    include: {
      affCode: true
    }
  })

  if (!binding) return null

  return {
    affCode: binding.affCode,
    userId: binding.affCode.userId
  }
}

/**
 * 处理 AFF 返利（新购或续费时调用）
 * @param originalAmount 订单原始金额（未打折前）
 */
export async function processAffCommission(
  affCodeId: number,
  instanceId: number,
  originalAmount: number,
  type: 'new_purchase' | 'renew',
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma

  // 1. 获取优惠码信息
  const affCode = await client.affCode.findUnique({
    where: { id: affCodeId }
  })

  if (!affCode) return

  // 2. 计算返利金额
  const commissionRate = Number(affCode.commissionRate)
  const commission = Math.round(originalAmount * commissionRate * 100) / 100

  if (commission <= 0) return

  // 3. 给优惠码创建者增加 AFF 余额
  await changeAffBalance({
    userId: affCode.userId,
    type,
    amount: commission,
    affCodeId,
    instanceId,
    originalAmount,
    remark: type === 'new_purchase' ? '新购返利' : '续费返利'
  }, client as PrismaClient)

  // 4. 更新优惠码统计
  await client.affCode.update({
    where: { id: affCodeId },
    data: {
      usedCount: type === 'new_purchase' ? { increment: 1 } : undefined,
      totalEarnings: { increment: commission }
    }
  })
}

// ==================== AFF 日志查询 ====================

// AFF 日志带关联信息的类型
export type AffLogWithDetails = AffLog & {
  affCode?: { code: string } | null
}

/**
 * 获取用户的 AFF 收益日志（分页）
 */
export async function getAffLogs(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    type?: AffLogType
  } = {}
): Promise<{
  logs: AffLogWithDetails[]
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const type = normalizeAffLogType(options.type)
  const skip = (page - 1) * pageSize

  const where: Prisma.AffLogWhereInput = {
    userId,
    ...(type ? { type } : {})
  }

  const [logs, total] = await Promise.all([
    prisma.affLog.findMany({
      where,
      include: {
        affCode: { select: { code: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.affLog.count({ where })
  ])

  return { logs, total, page, pageSize }
}

/**
 * 获取用户 AFF 统计
 */
export async function getAffStats(userId: number): Promise<{
  totalEarnings: number
  totalConverted: number
  currentBalance: number
  totalCodes: number
  totalUsed: number
}> {
  const [user, codes, earningsResult, convertResult] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { affBalance: true }
    }),
    prisma.affCode.aggregate({
      where: { userId },
      _count: true,
      _sum: { usedCount: true, totalEarnings: true }
    }),
    prisma.affLog.aggregate({
      where: { userId, amount: { gt: 0 } },
      _sum: { amount: true }
    }),
    prisma.affLog.aggregate({
      where: { userId, type: 'convert' },
      _sum: { amount: true }
    })
  ])

  return {
    // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
    totalEarnings: earningsResult._sum.amount !== null
      ? parseFloat(String(earningsResult._sum.amount))
      : 0,
    totalConverted: convertResult._sum.amount !== null
      ? Math.abs(parseFloat(String(convertResult._sum.amount)))
      : 0,
    currentBalance: user?.affBalance !== null && user?.affBalance !== undefined
      ? parseFloat(String(user.affBalance))
      : 0,
    totalCodes: codes._count || 0,
    totalUsed: codes._sum.usedCount || 0
  }
}

// ==================== AFF 转化申请 ====================

/**
 * 创建转化申请（自动审批通过）
 * 提交申请后系统自动完成审批，无需管理员手动操作
 * 管理员后台仍可查看所有转化记录
 */
export async function createAffWithdrawal(
  userId: number,
  amount: number
): Promise<{ success: boolean; withdrawal?: AffWithdrawal; error?: string }> {
  try {
    // 1. 检查最低转化金额（0.1 元起）
    if (!Number.isFinite(amount) || amount < 0.1) {
      return { success: false, error: '最低转化金额为 0.1 元' }
    }

    // 2. 在事务中完成：创建申请 + 自动审批
    const withdrawal = await prisma.$transaction(async (tx) => {
      await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, userId)
      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)

      // 2.1 获取用户当前余额
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { affBalance: true, balance: true }
      })

      if (!user) {
        throw new Error('用户不存在')
      }

      const affBalanceBefore = Number(user.affBalance)
      const balanceBefore = Number(user.balance)

      // 2.2 检查 AFF 余额
      if (affBalanceBefore < amount) {
        throw new Error('AFF 余额不足')
      }

      // 2.3 创建申请记录（直接标记为已通过，方便管理员后台查看）
      const newWithdrawal = await tx.affWithdrawal.create({
        data: {
          userId,
          amount,
          status: 'approved',
          reviewedBy: null, // 系统自动审批，无审核人
          reviewedAt: new Date()
        }
      })

      // 2.4 扣除 AFF 余额并增加用户主余额
      const affBalanceAfter = affBalanceBefore - amount
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          affBalance: { decrement: amount },
          balance: { increment: amount }
        },
        select: { balance: true }
      })
      const balanceAfter = Number(updatedUser.balance)

      // 2.5 记录 AFF 日志
      await tx.affLog.create({
        data: {
          userId,
          type: 'convert',
          amount: -amount,
          balanceBefore: affBalanceBefore,
          balanceAfter: affBalanceAfter,
          remark: `转化申请 #${newWithdrawal.id} 审核通过`
        }
      })

      // 2.6 记录余额日志
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'gift',
          amount,
          balanceBefore,
          balanceAfter,
          remark: `AFF 余额转化 #${newWithdrawal.id}`
        }
      })

      return newWithdrawal
    })

    return { success: true, withdrawal }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '转化失败'
    }
  }
}

/**
 * 根据 ID 获取转化申请
 */
export async function getAffWithdrawalById(withdrawalId: number): Promise<AffWithdrawal | null> {
  return prisma.affWithdrawal.findUnique({
    where: { id: withdrawalId }
  })
}

/**
 * 获取用户的转化申请（分页）
 */
export async function getUserAffWithdrawals(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    status?: AffWithdrawalStatus
  } = {}
): Promise<{
  withdrawals: AffWithdrawal[]
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const status = normalizeAffWithdrawalStatus(options.status)
  const skip = (page - 1) * pageSize

  const where: Prisma.AffWithdrawalWhereInput = {
    userId,
    ...(status ? { status } : {})
  }

  const [withdrawals, total] = await Promise.all([
    prisma.affWithdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.affWithdrawal.count({ where })
  ])

  return { withdrawals, total, page, pageSize }
}

// ==================== 管理员操作 ====================

/**
 * 获取所有待审核的转化申请（管理员）
 */
export async function getPendingAffWithdrawals(options: {
  page?: number
  pageSize?: number
  status?: AffWithdrawalStatus
} = {}): Promise<{
  withdrawals: (AffWithdrawal & { user: { id: number; username: string; affBalance: number } })[]
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const status = normalizeAffWithdrawalStatus(options.status)
  const skip = (page - 1) * pageSize

  const where: Prisma.AffWithdrawalWhereInput = status ? { status } : {}

  const [withdrawals, total] = await Promise.all([
    prisma.affWithdrawal.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, affBalance: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.affWithdrawal.count({ where })
  ])

  return {
    withdrawals: withdrawals.map(w => ({
      ...w,
      user: { ...w.user, affBalance: Number(w.user.affBalance) }
    })),
    total,
    page,
    pageSize
  }
}

/**
 * 审核通过转化申请（管理员）
 */
export async function approveAffWithdrawal(
  withdrawalId: number,
  adminId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. 获取申请信息
      const withdrawal = await tx.affWithdrawal.findUnique({
        where: { id: withdrawalId },
        select: { id: true, userId: true, amount: true, status: true }
      })

      if (!withdrawal) {
        throw new Error('申请不存在')
      }
      if (withdrawal.status !== 'pending') {
        throw new Error('申请已处理')
      }

      await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, withdrawal.userId)
      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, withdrawal.userId)

      const pendingWithdrawal = await tx.affWithdrawal.findUnique({
        where: { id: withdrawalId },
        select: { id: true, userId: true, amount: true, status: true }
      })

      if (!pendingWithdrawal) {
        throw new Error('申请不存在')
      }
      if (pendingWithdrawal.status !== 'pending') {
        throw new Error('申请已处理')
      }

      const user = await tx.user.findUnique({
        where: { id: pendingWithdrawal.userId },
        select: { affBalance: true, balance: true }
      })

      if (!user) {
        throw new Error('用户不存在')
      }

      const amount = Number(withdrawal.amount)
      const affBalanceBefore = Number(user.affBalance)
      const balanceBefore = Number(user.balance)

      if (affBalanceBefore < amount) {
        throw new Error('AFF 余额不足')
      }

      const updatedWithdrawal = await tx.affWithdrawal.updateMany({
        where: { id: withdrawalId, status: 'pending' },
        data: {
          status: 'approved',
          reviewedBy: adminId,
          reviewedAt: new Date()
        }
      })

      if (updatedWithdrawal.count !== 1) {
        throw new Error('申请已处理')
      }

      // 2. 扣除 AFF 余额并增加用户主余额
      const affBalanceAfter = affBalanceBefore - amount
      const updatedUser = await tx.user.update({
        where: { id: pendingWithdrawal.userId },
        data: {
          affBalance: { decrement: amount },
          balance: { increment: amount }
        },
        select: { balance: true }
      })
      const balanceAfter = Number(updatedUser.balance)

      // 3. 记录 AFF 日志
      await tx.affLog.create({
        data: {
          userId: pendingWithdrawal.userId,
          type: 'convert',
          amount: -amount,
          balanceBefore: affBalanceBefore,
          balanceAfter: affBalanceAfter,
          remark: `转化申请 #${withdrawalId} 审核通过`
        }
      })

      // 4. 记录余额日志
      await tx.balanceLog.create({
        data: {
          userId: pendingWithdrawal.userId,
          type: 'gift',
          amount,
          balanceBefore,
          balanceAfter,
          remark: `AFF 余额转化 #${withdrawalId}`
        }
      })
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '审核失败'
    }
  }
}

/**
 * 审核拒绝转化申请（管理员）
 */
export async function rejectAffWithdrawal(
  withdrawalId: number,
  adminId: number,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updatedWithdrawal = await prisma.affWithdrawal.updateMany({
      where: { id: withdrawalId, status: 'pending' },
      data: {
        status: 'rejected',
        rejectReason: reason,
        reviewedBy: adminId,
        reviewedAt: new Date()
      }
    })

    if (updatedWithdrawal.count !== 1) {
      const withdrawal = await prisma.affWithdrawal.findUnique({
        where: { id: withdrawalId },
        select: { id: true }
      })

      return { success: false, error: withdrawal ? '申请已处理' : '申请不存在' }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '拒绝失败'
    }
  }
}

// ==================== AFF 榜单 ====================

export interface AffLeaderboardEntry {
  rank: number
  username: string  // 打码后的用户名
  totalEarnings: number
  isCurrentUser: boolean
}

/**
 * 获取 AFF 收益榜单 TOP 10
 * @param currentUserId 当前用户ID（用于标记是否为当前用户）
 */
export async function getAffLeaderboard(currentUserId?: number): Promise<AffLeaderboardEntry[]> {
  // 聚合查询：按用户分组，统计 amount > 0 的总收益
  const results = await prisma.affLog.groupBy({
    by: ['userId'],
    where: {
      amount: { gt: 0 }
    },
    _sum: {
      amount: true
    },
    orderBy: {
      _sum: {
        amount: 'desc'
      }
    },
    take: 10
  })

  if (results.length === 0) {
    return []
  }

  // 获取用户名
  const userIds = results.map(r => r.userId)
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  })

  const userMap = new Map(users.map(u => [u.id, u.username]))

  // 组装榜单数据
  return results.map((r, index) => {
    const username = userMap.get(r.userId) || 'Unknown'
    const totalEarnings = r._sum.amount !== null
      ? parseFloat(String(r._sum.amount))
      : 0

    return {
      rank: index + 1,
      username: maskUsername(username),
      totalEarnings,
      isCurrentUser: r.userId === currentUserId
    }
  })
}

/**
 * 用户名打码：保留首尾各2字符，中间用 *** 替换
 */
function maskUsername(username: string): string {
  if (username.length <= 4) {
    // 太短的用户名，只显示首字符
    return username.charAt(0) + '***'
  }
  const first = username.slice(0, 2)
  const last = username.slice(-2)
  return `${first}***${last}`
}

// ==================== 邮箱订阅 AFF 支持 ====================

/**
 * 验证邮箱订阅优惠码
 * 邮箱订阅仅支持全局码
 */
export async function validateMailAffCode(
  code: string,
  userId: number
): Promise<{
  valid: boolean
  affCode?: AffCode
  discountRate?: number
  commissionRate?: number
  error?: string
}> {
  // 1. 查询优惠码
  const affCode = await prisma.affCode.findUnique({
    where: { code: code.toUpperCase() }
  })

  if (!affCode) {
    return { valid: false, error: '优惠码不存在' }
  }

  // 2. 检查是否为全局码（邮箱订阅仅支持全局码）
  if (affCode.packagePlanId !== null) {
    return { valid: false, error: '该优惠码仅适用于特定实例套餐，不支持邮箱订阅' }
  }

  // 3. 检查是否为自己的优惠码（禁止自返利）
  if (affCode.userId === userId) {
    return { valid: false, error: '不能使用自己的优惠码' }
  }

  // 4. 检查优惠码是否启用
  if (!affCode.enabled) {
    return { valid: false, error: '优惠码已禁用' }
  }

  return {
    valid: true,
    affCode,
    discountRate: Number(affCode.discountRate),
    commissionRate: Number(affCode.commissionRate)
  }
}

/**
 * 创建邮箱订阅与优惠码的绑定
 */
export async function createMailAffBinding(
  mailSubscriptionId: number,
  affCodeId: number,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma
  await client.mailSubscriptionAffBinding.create({
    data: { mailSubscriptionId, affCodeId }
  })
}

/**
 * 处理邮箱订阅的 AFF 返利
 */
export async function processMailAffCommission(
  affCodeId: number,
  mailSubscriptionId: number,
  originalAmount: number,
  type: 'new_purchase' | 'renew',
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma

  // 1. 获取优惠码信息
  const affCode = await client.affCode.findUnique({
    where: { id: affCodeId }
  })

  if (!affCode) return

  // 2. 计算返利金额
  const commissionRate = Number(affCode.commissionRate)
  const commission = Math.round(originalAmount * commissionRate * 100) / 100

  if (commission <= 0) return

  // 3. 给优惠码创建者增加 AFF 余额
  await changeAffBalance({
    userId: affCode.userId,
    type,
    amount: commission,
    affCodeId,
    mailSubscriptionId,
    originalAmount,
    remark: type === 'new_purchase' ? '邮箱新购返利' : '邮箱续费返利'
  }, client as PrismaClient)

  // 4. 更新优惠码统计
  await client.affCode.update({
    where: { id: affCodeId },
    data: {
      usedCount: type === 'new_purchase' ? { increment: 1 } : undefined,
      totalEarnings: { increment: commission }
    }
  })
}

/**
 * 获取邮箱订阅绑定的优惠码
 */
export async function getMailSubscriptionAffBinding(mailSubscriptionId: number): Promise<{
  affCode: AffCode
  userId: number
} | null> {
  const binding = await prisma.mailSubscriptionAffBinding.findUnique({
    where: { mailSubscriptionId },
    include: {
      affCode: true
    }
  })

  if (!binding) return null

  return {
    affCode: binding.affCode,
    userId: binding.affCode.userId
  }
}
