/**
 * 计费业务逻辑操作
 * 处理付费实例开通、续费、升降级等核心计费业务
 */

import { prisma } from './prisma.js'
import type { Instance, PackagePlan, Prisma } from '@prisma/client'
import { getInstanceAffBinding, processAffCommission } from './aff.js'
import { getInstanceBillingLineageIds } from './billing-records.js'
import {
  calculateDiscountAmount,
  calculateDiscountedPrice,
  calculateRemainingDays,
  calculateRemainingDaysPrecise,
  calculatePriceDiff,
  calculateRemainingValue,
  calculatePlanChangeDetails,
  addMonths as calcAddMonths
} from '../lib/billing-calc.js'
import { shouldSyncInstanceSwapSizeWithPlan } from '../lib/instance-swap.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'
import {
  HOSTING_BALANCE_LOG_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  tryAdvisoryTransactionLock
} from './advisory-locks.js'

// ==================== 类型定义 ====================

export interface CreateBillingResult {
  plan: PackagePlan
  price: number
  billingCycle: number
  setupFee: number
  totalPrice: number
  expiresAt: Date
}

export interface RenewBillingResult {
  monthlyPrice: number
  months: number
  amount: number
  newExpiresAt: Date
}

export interface InstanceRefundResult {
  remainingDays: number
  remainingValue: number
  refundableValue: number
  refundAmount: number
  maxRefundable: number
  discountRate: number
  isPaid: boolean
}

export interface InstanceRemainingRefundQuote {
  remainingDays: number
  remainingValue: number
  refundableValue: number
  maxRefundable: number
  isPaid: boolean
}

export interface HostingBalanceDeductionResult {
  hostOwnerId: number
  deductedAmount: number
  fromFrozen: number
  fromAvailable: number
  fromBalance: number
}

export interface ChangePlanPreviewResult {
  oldPlan: PackagePlan
  newPlan: PackagePlan
  remainingDays: number
  // 计算详情（供前端展示）
  oldDailyPrice: number        // 原方案日价（元）
  newDailyPrice: number        // 新方案日价（元）
  remainingValue: number       // 剩余价值（元）
  newPlanCost: number          // 新方案费用（元）
  // 折扣信息
  discountRate: number         // 折扣率（0-1）
  discountAmount: number       // 折扣金额（元）
  // 最终费用
  priceDiff: number            // 差价（元，正数=补交，负数=退款）
  isUpgrade: boolean           // 是否升级（按日价判断）
  newExpiresAt: Date           // 新到期时间（保持不变）
  newConfig: { cpu: number; memory: number; disk: number }
  // 冷却期信息
  canChange: boolean           // 是否可以变更
  cannotChangeReason?: string  // 不能变更的原因
}

export interface PlanChangeOptions {
  preciseRemainingDays?: boolean
  minRemainingDays?: number | null
}

export interface InstancePriceAdjustmentQuote {
  oldPrice: number
  newPrice: number
  billingCycle: number
  remainingDays: number
  discountRate: number
  priceDiff: number
}

// ==================== 费用计算函数 ====================

/**
 * 计算开通费用
 * 注意：数据库中 price 存储的是分（cents），需要除以100转成元
 * 开通费已废弃，固定为0
 */
export function calculateCreateBilling(plan: PackagePlan): CreateBillingResult {
  const price = Number(plan.price) / 100  // 分转元
  const totalPrice = price  // 不再计算开通费

  // 计算到期时间（根据计费周期）
  const expiresAt = addMonths(new Date(), plan.billingCycle)

  return {
    plan,
    price,
    billingCycle: plan.billingCycle,
    setupFee: 0,  // 开通费已废弃
    totalPrice,
    expiresAt
  }
}

/**
 * 计算月价（将方案价格折算为月价）
 */
export function calculateMonthlyPrice(instance: { billingPrice: any; billingCycle: number | null }): number {
  const price = Number(instance.billingPrice) || 0
  const cycle = Math.max(instance.billingCycle || 1, 1) // 防止除零
  return price / cycle
}

/**
 * 查询实例的最大可退款金额（基于历史账单）
 * maxRefundable = 历史总消费 - 历史已退
 * lastPaymentAmount = 最近一次付款金额（用于按时间比例退款）
 *
 * @param instanceId 实例 ID
 * @returns { maxRefundable, lastPaymentAmount }
 */
export async function getMaxRefundable(instanceId: number): Promise<{ maxRefundable: number; lastPaymentAmount: number }> {
  const billingLineageInstanceIds = await getInstanceBillingLineageIds(instanceId)
  const instanceIds = billingLineageInstanceIds.length > 0 ? billingLineageInstanceIds : [instanceId]

  const [totalConsumed, refundRecords, lastPayment] = await Promise.all([
    prisma.instanceBillingRecord.aggregate({
      where: {
        instanceId: { in: instanceIds },
        type: { in: ['newPurchase', 'renew', 'upgrade'] },
        amount: { gt: 0 }
      },
      _sum: { amount: true }
    }),
    prisma.instanceBillingRecord.findMany({
      where: {
        instanceId: { in: instanceIds },
        type: 'refund'
      },
      select: { amount: true }
    }),
    prisma.instanceBillingRecord.findFirst({
      where: {
        instanceId: { in: instanceIds },
        // 仅查询 newPurchase/renew（upgrade 记录的 amount 是差价，不是完整周期金额）
        type: { in: ['newPurchase', 'renew'] },
        amount: { gt: 0 }
      },
      orderBy: { createdAt: 'desc' },
      select: { amount: true }
    })
  ])

  const consumedAmount = totalConsumed._sum?.amount !== null && totalConsumed._sum?.amount !== undefined
    ? parseFloat(String(totalConsumed._sum.amount))
    : 0
  const refundedAmount = refundRecords.reduce((sum, record) => sum + Math.abs(Number(record.amount)), 0)
  const lastPaymentAmount = lastPayment?.amount !== null && lastPayment?.amount !== undefined
    ? parseFloat(String(lastPayment.amount))
    : 0

  return {
    maxRefundable: roundCurrency(Math.max(0, consumedAmount - refundedAmount)),
    lastPaymentAmount
  }
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * 按账单记录计算实例的剩余价值退款报价
 *
 * 正向计费记录（newPurchase / renew / upgrade）各自对应独立的服务期区间，
 * 退款时应按这些区间的未消耗比例逐条计算，而不是仅依赖实例当前 billingPrice。
 * 这样升级补差价、后续续费、管理员延期等场景都能正确纳入剩余价值。
 */
export async function calculateInstanceRemainingRefundQuote(instance: {
  id: number
  billingPrice: any
  billingCycle: number | null
  expiresAt: Date | null
  packagePlanId: number | null
}): Promise<InstanceRemainingRefundQuote> {
  const isPaid = !!(instance.packagePlanId && instance.expiresAt && instance.billingPrice)

  if (!isPaid) {
    return {
      remainingDays: 0,
      remainingValue: 0,
      refundableValue: 0,
      maxRefundable: 0,
      isPaid: false
    }
  }

  const now = new Date()
  const expiresAt = new Date(instance.expiresAt!)

  if (expiresAt <= now) {
    return {
      remainingDays: 0,
      remainingValue: 0,
      refundableValue: 0,
      maxRefundable: 0,
      isPaid: true
    }
  }

  const remainingDays = calculateRemainingDays(expiresAt, now)
  const billingLineageInstanceIds = await getInstanceBillingLineageIds(instance.id)
  const instanceIds = billingLineageInstanceIds.length > 0 ? billingLineageInstanceIds : [instance.id]
  const [maxRefundableInfo, positiveBillingRecords] = await Promise.all([
    getMaxRefundable(instance.id),
    prisma.instanceBillingRecord.findMany({
      where: {
        instanceId: { in: instanceIds },
        type: { in: ['newPurchase', 'renew', 'upgrade'] },
        amount: { gt: 0 }
      },
      select: {
        amount: true,
        periodStart: true,
        periodEnd: true
      },
      orderBy: { periodStart: 'asc' }
    })
  ])
  const { maxRefundable } = maxRefundableInfo

  let remainingValue = 0

  for (const record of positiveBillingRecords) {
    const periodStart = new Date(record.periodStart)
    const periodEnd = new Date(record.periodEnd)
    const totalMs = periodEnd.getTime() - periodStart.getTime()

    if (totalMs <= 0 || periodEnd <= now) {
      continue
    }

    const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime())
    const unusedRatio = Math.min(remainingMs / totalMs, 1)
    remainingValue += Number(record.amount) * unusedRatio
  }

  remainingValue = roundCurrency(remainingValue)

  // 兼容历史/异常数据：如果缺少正向计费记录，则回退到旧逻辑，
  // 避免老实例直接变成 0 退款。
  if (positiveBillingRecords.length === 0 && instance.billingPrice && instance.billingCycle) {
    let discountRate = 0
    const affBinding = await getInstanceAffBinding(instance.id)
    if (affBinding?.affCode?.enabled) {
      discountRate = Number(affBinding.affCode.discountRate) || 0
    }

    remainingValue = calculateRemainingValue(
      Number(instance.billingPrice),
      instance.billingCycle,
      remainingDays,
      discountRate
    )
  }

  const refundableValue = roundCurrency(Math.min(remainingValue, maxRefundable))

  return {
    remainingDays,
    remainingValue,
    refundableValue,
    maxRefundable,
    isPaid: true
  }
}

/**
 * 计算实例退款金额（用于节点所有者删除实例时）
 * 节点所有者删除时不收取手续费
 * 
 * @param instance 实例信息（需包含计费相关字段）
 * @returns 退款计算结果
 */
export async function calculateInstanceRefund(instance: {
  id: number
  billingPrice: any
  billingCycle: number | null
  expiresAt: Date | null
  packagePlanId: number | null
}): Promise<InstanceRefundResult> {
  const quote = await calculateInstanceRemainingRefundQuote(instance)

  return {
    remainingDays: quote.remainingDays,
    remainingValue: quote.remainingValue,
    refundableValue: quote.refundableValue,
    refundAmount: quote.refundableValue, // 节点所有者删除不收手续费
    maxRefundable: quote.maxRefundable,
    discountRate: 0,
    isPaid: quote.isPaid
  }
}

/**
 * 续费费用计算（支持任意月数）
 */
export function calculateRenewBilling(
  instance: { billingPrice: any; billingCycle: number | null; expiresAt: Date | null },
  months: number = 1
): RenewBillingResult {
  // 验证续费月数范围
  if (months < 1 || months > 24) {
    throw new Error('续费月数必须在 1-24 之间')
  }

  const monthlyPrice = calculateMonthlyPrice(instance)
  const amount = Number((monthlyPrice * months).toFixed(2)) // 保留两位小数

  // 从当前到期时间续期（如已过期则从现在开始）
  const now = new Date()
  const baseDate = instance.expiresAt && instance.expiresAt > now
    ? instance.expiresAt
    : now

  const newExpiresAt = addMonths(baseDate, months)

  return { monthlyPrice, months, amount, newExpiresAt }
}

// 周期天数常量和 getCycleDays 函数已移至公共模块 billing-calc.ts
// 从 ../lib/billing-calc.js 导入使用

/**
 * 计算升降级差价（带优惠码折扣和冷却期检查）
 * 使用公共模块 billing-calc.ts 的计算方法确保一致性
 * 
 * 计算公式：
 * 1. 原方案日价 = 原方案周期价格 / 原方案周期天数
 * 2. 新方案日价 = 新方案周期价格 / 新方案周期天数
 * 3. 剩余价值 = 原方案日价 × 剩余天数 × (1 - 折扣率)
 * 4. 新方案费用 = 新方案日价 × 剩余天数 × (1 - 折扣率)
 * 5. 差价 = 新方案费用 - 剩余价值
 */
export async function calculatePlanChange(
  instance: Instance,
  newPlan: PackagePlan,
  options: PlanChangeOptions = {}
): Promise<ChangePlanPreviewResult> {
  const oldPlanId = instance.packagePlanId
  if (!oldPlanId) {
    throw new Error('免费实例不支持升降级')
  }

  const oldPlan = await prisma.packagePlan.findUnique({
    where: { id: oldPlanId }
  })

  if (!oldPlan) {
    throw new Error('原方案不存在')
  }

  const expiresAt = instance.expiresAt!
  const preciseRemainingDays = options.preciseRemainingDays ?? true
  const minRemainingDays = options.minRemainingDays === undefined ? 15 : options.minRemainingDays

  // ========== 检查剩余天数 ==========
  let canChange = true
  let cannotChangeReason: string | undefined

  // 使用统一方法计算剩余时间；金额口径默认使用精确剩余天数
  const remainingDays = preciseRemainingDays
    ? calculateRemainingDaysPrecise(expiresAt)
    : calculateRemainingDays(expiresAt)

  if (minRemainingDays !== null && remainingDays < minRemainingDays) {
    canChange = false
    cannotChangeReason = 'remaining_days_insufficient' // 剩余天数不足
  }

  // ========== 获取 AFF 折扣率 ==========
  let discountRate = 0
  const affBinding = await getInstanceAffBinding(instance.id)
  if (affBinding) {
    discountRate = Number(affBinding.affCode.discountRate) || 0
  }

  // ========== 使用公共方法计算差价 ==========
  const oldCyclePrice = Number(instance.billingPrice) || 0 // 已是元
  const newCyclePrice = Number(newPlan.price) / 100 // 分转元

  // 使用公共方法计算详情
  const calcResult = calculatePlanChangeDetails(
    oldCyclePrice,
    instance.billingCycle || 1,
    newCyclePrice,
    newPlan.billingCycle,
    remainingDays,
    discountRate
  )

  return {
    oldPlan,
    newPlan,
    remainingDays,
    oldDailyPrice: calcResult.oldDailyPrice,
    newDailyPrice: calcResult.newDailyPrice,
    remainingValue: calcResult.remainingValue,
    newPlanCost: calcResult.newPlanCost,
    discountRate,
    discountAmount: calcResult.discountAmount,
    priceDiff: calcResult.priceDiff,
    isUpgrade: calcResult.isUpgrade,
    newExpiresAt: expiresAt, // 到期时间保持不变
    newConfig: {
      cpu: newPlan.cpu,
      memory: newPlan.memory,
      disk: newPlan.disk
    },
    canChange,
    cannotChangeReason
  }
}

/**
 * 计算管理员调整实例续费价格时的差价结算报价
 * 统一使用精确剩余天数，避免与升级报价口径分叉。
 */
export async function calculateInstancePriceAdjustmentQuote(
  instance: {
    id: number
    billingPrice: any
    billingCycle: number | null
    expiresAt: Date | null
  },
  newPrice: number,
  settleBalance: boolean,
  tx?: Prisma.TransactionClient
): Promise<InstancePriceAdjustmentQuote> {
  const oldPrice = Number(instance.billingPrice) || 0
  const roundedNewPrice = roundCurrency(newPrice)
  const billingCycle = instance.billingCycle || 1

  let discountRate = 0
  const affBinding = await getInstanceAffBinding(instance.id, tx)
  if (affBinding?.affCode?.enabled) {
    discountRate = Number(affBinding.affCode.discountRate) || 0
  }

  let remainingDays = 0
  let priceDiff = 0

  if (settleBalance && instance.expiresAt) {
    remainingDays = calculateRemainingDaysPrecise(new Date(instance.expiresAt))
    if (remainingDays > 0) {
      priceDiff = calculatePriceDiff(
        oldPrice,
        billingCycle,
        roundedNewPrice,
        billingCycle,
        remainingDays,
        discountRate
      )
    }
  }

  return {
    oldPrice,
    newPrice: roundedNewPrice,
    billingCycle,
    remainingDays,
    discountRate,
    priceDiff
  }
}

/**
 * 续费价格预览（前端调用）
 */
export function previewRenewPrices(
  instance: { billingPrice: any; billingCycle: number | null; expiresAt: Date | null }
): Array<{ months: number; amount: number; expiresAt: Date }> {
  const options = [1, 3, 6, 12] // 常用续费选项
  return options.map(months => {
    const result = calculateRenewBilling(instance, months)
    return {
      months,
      amount: result.amount,
      expiresAt: result.newExpiresAt
    }
  })
}

// ==================== 业务操作函数 ====================

/**
 * 执行续费操作（带乐观锁并发控制）
 * 支持 AFF 优惠码折扣和返利
 */
export async function performRenewal(
  userId: number,
  instance: Instance,
  months: number
): Promise<{ newExpiresAt: Date; amount: number; balanceLogId: number; discountAmount?: number; hostingIncomeResult?: { hostOwnerId: number; hostName: string } | null }> {
  // 验证付费实例
  if (!instance.packagePlanId) {
    throw new Error('免费实例无需续费')
  }

  // 验证续费月数
  if (months < 1 || months > 24) {
    throw new Error('续费月数必须在 1-24 之间')
  }

  // 手动封停的实例不允许续费
  if (instance.status === 'suspended' && instance.suspendReason !== 'expired') {
    throw new Error('实例已被手动封停，请联系宿主机所有者解封后再续费')
  }

  const { amount: originalAmount, newExpiresAt } = calculateRenewBilling(instance, months)

  // 检查 AFF 绑定，计算折扣
  const affBinding = await getInstanceAffBinding(instance.id)
  let discountRate = 0
  let discountAmount = 0
  let finalAmount = originalAmount

  if (affBinding) {
    discountRate = Number(affBinding.affCode.discountRate)
    discountAmount = calculateDiscountAmount(originalAmount, discountRate)
    finalAmount = calculateDiscountedPrice(originalAmount, discountRate)
  }

  // 执行事务（带乐观锁）
  const result = await prisma.$transaction(async (tx) => {
    const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
    if (!balanceLocked) {
      throw new Error('余额正在处理，请稍后重试')
    }

    // 获取用户当前余额
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })

    if (!user) {
      throw new Error('用户不存在')
    }

    const oldBalance = Number(user.balance)
    if (oldBalance < finalAmount) {
      throw new Error('余额不足')
    }

    // 扣除余额（使用条件更新确保并发安全）
    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        balance: { gte: finalAmount }
      },
      data: { balance: { decrement: finalAmount } }
    })

    if (updateResult.count === 0) {
      throw new Error('余额不足或并发冲突')
    }

    const updatedUser = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    if (!updatedUser) {
      throw new Error('用户不存在')
    }
    const newBalance = Number(updatedUser.balance)

    // 乐观锁：检查实例版本号并更新
    const instanceUpdateResult = await tx.instance.updateMany({
      where: {
        id: instance.id,
        version: instance.version  // 确保版本号未变
      },
      data: {
        expiresAt: newExpiresAt,
        autoRenewAttempts: 0,
        version: { increment: 1 },  // 增加版本号
        // 如果因到期被封停，续费后解除封停（恢复为 stopped）
        ...(instance.status === 'suspended' && instance.suspendReason === 'expired' ? {
          status: 'stopped',
          suspendedAt: null,
          suspendedBy: null,
          suspendReason: null
        } : {})
      }
    })

    if (instanceUpdateResult.count === 0) {
      throw new Error('实例状态已变更，请重试')
    }

    // 记录余额日志
    const remarkText = discountAmount > 0
      ? `续费（${months}个月）：${instance.name}，优惠码折扣 -¥${discountAmount.toFixed(2)}`
      : `续费（${months}个月）：${instance.name}`

    const balanceLog = await tx.balanceLog.create({
      data: {
        userId,
        type: 'consume',
        amount: -finalAmount,
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        instanceId: instance.id,
        remark: remarkText
      }
    })

    // 记录扣费记录
    await tx.instanceBillingRecord.create({
      data: {
        instanceId: instance.id,
        userId,
        type: 'renew',
        amount: finalAmount,
        months,
        periodStart: instance.expiresAt || new Date(),
        periodEnd: newExpiresAt,
        balanceLogId: balanceLog.id,
        remark: discountAmount > 0
          ? `续费 ${months} 个月，优惠码折扣 -¥${discountAmount.toFixed(2)}`
          : `续费 ${months} 个月`
      }
    })

    // 如果有 AFF 绑定，给优惠码创建者返利
    if (affBinding) {
      await processAffCommission(
        affBinding.affCode.id,
        instance.id,
        originalAmount, // 基于原价计算返利
        'renew',
        tx as any
      )
    }

    let hostingIncomeResult: { hostOwnerId: number; hostName: string } | null = null

    const hostingOwner = await resolveHostedIncomeOwner(tx, instance.hostId)
    if (hostingOwner) {
      // 用户托管节点，记录托管收入（带快照）
      const unfreezeAt = addMonths(new Date(), 1)
      await createHostingLogWithSnapshot(tx, {
        userId: hostingOwner.userId,
        type: 'income',
        actionType: 'renew',
        amount: finalAmount,
        instanceId: instance.id,
        frozen: true,
        unfreezeAt,
        remark: `用户续费实例收入（冻结30天）`
      })
      console.log(`[HostingIncome] 记录续费托管收入: hostOwnerId=${hostingOwner.userId}, amount=${finalAmount}, instanceId=${instance.id}`)
      hostingIncomeResult = { hostOwnerId: hostingOwner.userId, hostName: hostingOwner.hostName }
    }

    return { balanceLogId: balanceLog.id, hostingIncomeResult }
  })

  return {
    newExpiresAt,
    amount: finalAmount,
    balanceLogId: result.balanceLogId,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    hostingIncomeResult: result.hostingIncomeResult
  }
}

/**
 * 执行升降级操作（带乐观锁并发控制）
 * 
 * 升级：从余额扣除差价
 * 降级：差价退款到余额
 */
export async function performPlanChange(
  userId: number,
  instance: Instance,
  newPlan: PackagePlan
): Promise<{
  priceDiff: number
  newConfig: { cpu: number; memory: number; disk: number }
  needRestart: boolean  // 标记是否需要重启
  refundAmount?: number // 降级时的退款金额
  hostingIncomeResult?: { hostOwnerId: number; hostName: string } | null // 托管收入结果
}> {
  const pkg = await prisma.package.findUnique({
    where: { id: newPlan.packageId },
    select: { instanceType: true }
  })
  const isVmPackage = pkg?.instanceType === 'vm'

  // 验证
  if (!instance.packagePlanId) {
    throw new Error('免费实例不支持升降级')
  }

  // 升降级状态限制：仅 running 和 stopped 可以升降级
  if (!['running', 'stopped'].includes(instance.status)) {
    throw new Error('当前实例状态不允许升降级，仅运行中或已停止的实例可以升降级')
  }

  if (newPlan.packageId !== instance.packageId) {
    throw new Error('新方案必须属于同一套餐')
  }
  if (!newPlan.isActive) {
    throw new Error('新方案已下架')
  }
  if (newPlan.isSoldOut) {
    throw new Error('新方案已售罄')
  }
  if (instance.packagePlanId === newPlan.id) {
    throw new Error('不能切换到相同方案')
  }

  // 计算升级差价
  const changeResult = await calculatePlanChange(instance, newPlan)

  // 检查是否可以变更
  if (!changeResult.canChange) {
    if (changeResult.cannotChangeReason === 'remaining_days_insufficient') {
      throw new Error('剩余时间不足 15 天，无法变更方案')
    }
    throw new Error('当前不能变更方案')
  }

  let refundAmount: number | undefined

  // 执行事务（带乐观锁）
  const txResult = await prisma.$transaction(async (tx) => {
    if (changeResult.priceDiff !== 0) {
      const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
      if (!balanceLocked) {
        throw new Error('余额正在处理，请稍后重试')
      }
    }

    // 获取用户当前余额
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })

    if (!user) {
      throw new Error('用户不存在')
    }

    const oldBalance = Number(user.balance)
    let hostingIncomeResult: { hostOwnerId: number; hostName: string } | null = null

    // 升级需要补差价
    if (changeResult.priceDiff > 0) {
      if (oldBalance < changeResult.priceDiff) {
        throw new Error(`余额不足，需补差价 ${changeResult.priceDiff} 元`)
      }

      const balanceUpdateResult = await tx.user.updateMany({
        where: { id: userId, balance: { gte: changeResult.priceDiff } },
        data: { balance: { decrement: changeResult.priceDiff } }
      })

      if (balanceUpdateResult.count === 0) {
        throw new Error('余额不足或并发冲突')
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })
      if (!updatedUser) {
        throw new Error('用户不存在')
      }
      const newBalance = Number(updatedUser.balance)

      // 升级扣费记录
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -changeResult.priceDiff,
          balanceBefore: oldBalance,
          balanceAfter: newBalance,
          instanceId: instance.id,
          remark: `升级方案：${changeResult.oldPlan.name} → ${newPlan.name}`
        }
      })

      const hostingOwner = await resolveHostedIncomeOwner(tx, instance.hostId)
      if (hostingOwner) {
        // 用户托管节点，记录托管收入（升级差价，带快照）
        const unfreezeAt = addMonths(new Date(), 1)
        await createHostingLogWithSnapshot(tx, {
          userId: hostingOwner.userId,
          type: 'income',
          actionType: 'upgrade',
          amount: changeResult.priceDiff,
          instanceId: instance.id,
          frozen: true,
          unfreezeAt,
          remark: `用户升级实例方案收入（冻结30天）`
        })
        console.log(`[HostingIncome] 记录升级托管收入: hostOwnerId=${hostingOwner.userId}, amount=${changeResult.priceDiff}, instanceId=${instance.id}`)
        hostingIncomeResult = { hostOwnerId: hostingOwner.userId, hostName: hostingOwner.hostName }
      }
    }

    // 降级退款到余额
    if (changeResult.priceDiff < 0) {
      refundAmount = Math.abs(changeResult.priceDiff)

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: refundAmount } },
        select: { balance: true }
      })
      const newBalance = Number(updatedUser.balance)

      // 降级退款记录
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'refund',
          amount: refundAmount,
          balanceBefore: oldBalance,
          balanceAfter: newBalance,
          instanceId: instance.id,
          remark: `降级方案退款：${changeResult.oldPlan.name} → ${newPlan.name}`
        }
      })
    }

    const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
      packageId: instance.packageId,
      hostId: instance.hostId,
      baseTrafficLimit: newPlan.trafficLimit
    })

    // 乐观锁：更新实例配置，同时检查版本号
    const instanceUpdateResult = await tx.instance.updateMany({
      where: {
        id: instance.id,
        version: instance.version  // 确保版本号未变
      },
      data: {
        packagePlanId: newPlan.id,
        cpu: newPlan.cpu,
        memory: newPlan.memory,
        disk: newPlan.disk,
        // 更新计费信息（注意：newPlan.price 是分，需要除以100转元）
        billingPrice: Number(newPlan.price) / 100,
        billingCycle: newPlan.billingCycle,
        // 配额限制
        portLimit: newPlan.portLimit,
        snapshotLimit: newPlan.snapshotLimit,
        backupLimit: newPlan.backupLimit,
        siteLimit: newPlan.siteLimit,
        swapEnabled: isVmPackage ? false : instance.swapEnabled,
        swapSize: isVmPackage
          ? null
          : (shouldSyncInstanceSwapSizeWithPlan(instance.swapSize, changeResult.oldPlan.swapSize)
              ? newPlan.swapSize
              : instance.swapSize),
        monthlyTrafficLimit,
        trafficStatus: calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, monthlyTrafficLimit),
        // 更新冷却期时间
        lastPlanChangeAt: new Date(),
        // 版本号递增
        version: { increment: 1 }
        // 注意：到期时间保持不变
      }
    })

    if (instanceUpdateResult.count === 0) {
      throw new Error('实例状态已变更，请重试')
    }

    // 记录计费记录
    await tx.instanceBillingRecord.create({
      data: {
        instanceId: instance.id,
        userId,
        type: changeResult.isUpgrade ? 'upgrade' : 'downgrade',
        amount: changeResult.priceDiff > 0 ? changeResult.priceDiff : 0,
        months: 0, // 升降级不改变时长
        periodStart: new Date(),
        periodEnd: instance.expiresAt!,
        remark: `${changeResult.oldPlan.name} → ${newPlan.name}${refundAmount ? `，退款 ¥${refundAmount.toFixed(2)}` : ''}`
      }
    })

    return { hostingIncomeResult }
  })

  return {
    priceDiff: changeResult.priceDiff,
    newConfig: changeResult.newConfig,
    needRestart: true,  // 升降级后需要重启实例才能生效
    refundAmount,
    hostingIncomeResult: txResult.hostingIncomeResult
  }
}

/**
 * 更新自动续费设置
 */
export async function updateAutoRenew(
  instanceId: number,
  autoRenew: boolean
): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: { autoRenew }
  })
}

/**
 * 获取实例计费信息
 */
export async function getInstanceBillingInfo(instanceId: number): Promise<{
  isPaid: boolean
  expiresAt: Date | null
  billingPrice: number | null
  billingCycle: number | null
  monthlyPrice: number | null
  autoRenew: boolean
  status: string
  suspendReason: string | null
  packagePlan: {
    id: number
    name: string
    isActive: boolean
  } | null
  renewPreview: Array<{ months: number; amount: number; discountedAmount: number; expiresAt: Date }> | null
  affDiscount: {
    discountRate: number  // 折扣率，如 0.05 表示 5%
    affCodeId: number
  } | null
  // 托管实例相关信息
  isHostedInstance: boolean
  daysUntilExpire: number | null
  hostingRenewRestriction: { monthsOnly: number; daysBeforeExpire: number } | null
} | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      packagePlan: {
        select: { id: true, name: true, isActive: true }
      },
      host: {
        select: {
          userId: true,
          user: {
            select: {
              role: true
            }
          }
        }
      }
    }
  })

  if (!instance) return null

  const isPaid = instance.packagePlanId !== null

  // 判断是否为托管实例（节点所有者不是管理员）
  const isHostedInstance = instance.host?.user.role === 'user'

  // 计算剩余天数
  let daysUntilExpire: number | null = null
  if (instance.expiresAt) {
    const now = new Date()
    daysUntilExpire = Math.ceil((instance.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  // 托管续费限制
  const hostingRenewRestriction = isHostedInstance ? { monthsOnly: 1, daysBeforeExpire: 7 } : null

  let monthlyPrice: number | null = null
  let renewPreview: Array<{ months: number; amount: number; discountedAmount: number; expiresAt: Date }> | null = null
  let affDiscount: { discountRate: number; affCodeId: number } | null = null

  if (isPaid && instance.billingPrice) {
    monthlyPrice = calculateMonthlyPrice({
      billingPrice: instance.billingPrice,
      billingCycle: instance.billingCycle
    })

    // 获取 AFF 绑定信息，计算折扣
    const affBinding = await getInstanceAffBinding(instanceId)
    let discountRate = 0
    if (affBinding) {
      discountRate = Number(affBinding.affCode.discountRate)
      affDiscount = {
        discountRate,
        affCodeId: affBinding.affCode.id
      }
    }

    // 计算续费预览（包含折扣价）
    const originalPreview = previewRenewPrices({
      billingPrice: instance.billingPrice,
      billingCycle: instance.billingCycle,
      expiresAt: instance.expiresAt
    })

    // 托管实例只返回1个月的续费选项
    const filteredPreview = isHostedInstance
      ? originalPreview.filter(p => p.months === 1)
      : originalPreview

    renewPreview = filteredPreview.map(p => ({
      months: p.months,
      amount: p.amount,  // 原价（元）
      discountedAmount: discountRate > 0
        ? Number((p.amount * (1 - discountRate)).toFixed(2))  // 折扣价（元，保留两位小数）
        : p.amount,
      expiresAt: p.expiresAt
    }))
  }

  return {
    isPaid,
    expiresAt: instance.expiresAt,
    billingPrice: instance.billingPrice ? Number(instance.billingPrice) : null,
    billingCycle: instance.billingCycle,
    monthlyPrice,
    autoRenew: instance.autoRenew,
    status: instance.status,
    suspendReason: instance.suspendReason,
    packagePlan: instance.packagePlan,
    renewPreview,
    affDiscount,
    isHostedInstance,
    daysUntilExpire,
    hostingRenewRestriction
  }
}

// ==================== 辅助函数 ====================

/**
 * 添加月份到日期
 * 使用公共方法 calcAddMonths
 */
function addMonths(date: Date, months: number): Date {
  return calcAddMonths(date, months)
}

/**
 * 检查实例是否为免费实例
 */
export function isFreeInstance(instance: { packagePlanId: number | null }): boolean {
  return instance.packagePlanId === null
}

/**
 * 检查实例是否为付费实例
 */
export function isPaidInstance(instance: { packagePlanId: number | null }): boolean {
  return instance.packagePlanId !== null
}

/**
 * 检查实例是否已过期
 */
export function isExpired(instance: { expiresAt: Date | null }): boolean {
  if (instance.expiresAt === null) return false
  return new Date() > instance.expiresAt
}

// ==================== 托管余额结算 ====================

/**
 * 内部辅助函数：统一创建带快照的托管日志
 * 用于所有实例相关托管日志的写入，确保快照字段一致性
 */
async function createHostingLogWithSnapshot(
  client: any,
  params: {
    userId: number
    type: 'income' | 'deduction'
    actionType: string
    amount: number
    instanceId: number
    frozen: boolean
    unfreezeAt?: Date | null
    remark: string
  }
) {
  // 查询实例及关联信息用于快照
  const instance = await client.instance.findUnique({
    where: { id: params.instanceId },
    select: {
      name: true,
      user: { select: { username: true, email: true, avatarStyle: true } },
      host: { select: { name: true } },
      package: { select: { name: true } },
      packagePlan: { select: { name: true } }
    }
  })

  await client.hostingBalanceLog.create({
    data: {
      userId: params.userId,
      type: params.type,
      actionType: params.actionType,
      amount: params.amount,
      frozen: params.frozen,
      unfreezeAt: params.unfreezeAt ?? null,
      relatedId: params.instanceId,
      remark: params.remark,
      snapshotBuyerName: instance?.user.username ?? null,
      snapshotBuyerEmail: instance?.user.email ?? null,
      snapshotBuyerAvatar: instance?.user.avatarStyle ?? null,
      snapshotInstanceName: instance?.name ?? null,
      snapshotHostName: instance?.host.name ?? null,
      snapshotPackageName: instance?.package?.name ?? null,
      snapshotPlanName: instance?.packagePlan?.name ?? null
    }
  })
}

async function resolveHostedIncomeOwner(
  client: any,
  hostId: number,
  options: {
    instanceId?: number | null
    allowHistoricalFallback?: boolean
  } = {}
): Promise<{ userId: number; hostName: string } | null> {
  const { instanceId = null, allowHistoricalFallback = false } = options

  const host = await client.host.findUnique({
    where: { id: hostId },
    select: {
      userId: true,
      name: true,
      user: {
        select: {
          role: true
        }
      }
    }
  })

  if (!host) {
    return null
  }

  if (host.user.role !== 'admin') {
    return {
      userId: host.userId,
      hostName: host.name
    }
  }

  if (!allowHistoricalFallback || !instanceId) {
    return null
  }

  const latestIncomeLog = await client.hostingBalanceLog.findFirst({
    where: {
      relatedId: instanceId,
      type: 'income'
    },
    orderBy: {
      createdAt: 'desc'
    },
    select: {
      userId: true
    }
  })

  if (!latestIncomeLog) {
    return null
  }

  const historicalOwner = await client.user.findUnique({
    where: { id: latestIncomeLog.userId },
    select: {
      role: true
    }
  })

  if (!historicalOwner || historicalOwner.role === 'admin') {
    return null
  }

  return {
    userId: latestIncomeLog.userId,
    hostName: host.name
  }
}

/**
 * 判断节点是否为用户托管节点（非管理员节点）
 */
export async function isUserHostedNode(hostId: number): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      user: {
        select: {
          role: true
        }
      }
    }
  })
  return host?.user.role === 'user'
}

/**
 * 获取节点所有者ID
 */
export async function getHostOwnerId(hostId: number): Promise<number | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { userId: true }
  })
  return host?.userId ?? null
}

/**
 * 记录托管收入（用户购买/续费用户托管节点上的实例时调用）
 * 
 * @param hostOwnerId 节点所有者用户ID
 * @param amount 金额（元）
 * @param instanceId 关联的实例ID
 * @param remark 备注
 * @param actionType 操作类型（purchase/renew/upgrade/destroy等）
 * @param tx 可选的事务客户端
 */
export async function recordHostingIncome(
  hostOwnerId: number,
  amount: number,
  instanceId: number,
  remark: string,
  actionType: 'purchase' | 'renew' | 'upgrade' | 'destroy' | 'unfreeze' | 'withdraw',
  tx?: any
): Promise<void> {
  const client = tx || prisma

  // 计算解冻时间（30天后）
  const unfreezeAt = addMonths(new Date(), 1) // 使用 1 个月作为 30 天的近似

  await createHostingLogWithSnapshot(client, {
    userId: hostOwnerId,
    type: 'income',
    actionType,
    amount,
    instanceId,
    frozen: true,
    unfreezeAt,
    remark
  })
}

/**
 * 处理托管收入结算
 * 在用户购买或续费实例时调用，检查节点是否为用户托管，如是则记录收入
 * 
 * @param hostId 节点ID
 * @param amount 金额（元）
 * @param instanceId 实例ID
 * @param type 类型：'purchase' | 'renew'
 * @param tx 可选的事务客户端
 * @returns 如果是用户托管节点，返回节点所有者信息；否则返回 null
 */
export async function processHostingIncome(
  hostId: number,
  amount: number,
  instanceId: number,
  type: 'purchase' | 'renew',
  tx?: any
): Promise<{ hostOwnerId: number; hostName: string } | null> {
  const client = tx || prisma

  // 获取节点所有者和节点名称
  const host = await client.host.findUnique({
    where: { id: hostId },
    select: {
      userId: true,
      name: true,
      user: {
        select: {
          role: true
        }
      }
    }
  })

  if (!host || host.user.role === 'admin') {
    // 管理员所有的节点不需要记录托管收入
    return null
  }

  // 用户托管节点，记录托管收入
  const remark = type === 'purchase'
    ? `用户购买实例收入（冻结30天）`
    : `用户续费实例收入（冻结30天）`

  await recordHostingIncome(host.userId, amount, instanceId, remark, type, client)

  console.log(`[HostingIncome] 记录托管收入: hostOwnerId=${host.userId}, amount=${amount}, instanceId=${instanceId}, type=${type}`)

  return { hostOwnerId: host.userId, hostName: host.name }
}

/**
 * 获取实例剩余天数
 * 使用公共方法 calculateRemainingDays
 */
export function getRemainingDays(instance: { expiresAt: Date | null }): number | null {
  if (instance.expiresAt === null) return null
  return calculateRemainingDays(instance.expiresAt)
}

/**
 * 托管实例销毁时扣除节点所有者的托管余额
 * 
 * 优先从该实例相关的冻结收入中扣除，不足部分从可用余额扣除
 * 
 * @param hostId 节点ID
 * @param amount 扣除金额（元）
 * @param instanceId 实例ID
 * @param remark 备注
 * @param tx 可选的事务客户端
 * @returns 如果是用户托管节点，返回扣除结果；否则返回 null
 */
export async function deductHostingBalance(
  hostId: number,
  amount: number,
  instanceId: number,
  remark: string,
  tx?: any
): Promise<HostingBalanceDeductionResult | null> {
  const run = async (client: Prisma.TransactionClient): Promise<HostingBalanceDeductionResult | null> => {
    const hostingOwner = await resolveHostedIncomeOwner(client, hostId, {
      instanceId,
      allowHistoricalFallback: true
    })
    if (!hostingOwner) {
      return null
    }
    const hostOwnerId = hostingOwner.userId

    const locked = await tryAdvisoryTransactionLock(client, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, hostOwnerId)
    if (!locked) {
      throw new Error('托管余额正在处理，请稍后重试')
    }

    const userBalanceLocked = await tryAdvisoryTransactionLock(client, USER_BALANCE_LOCK_NAMESPACE, hostOwnerId)
    if (!userBalanceLocked) {
      throw new Error('余额正在处理，请稍后重试')
    }

    // 查找该实例相关的冻结托管收入记录
    const frozenLogs = await client.hostingBalanceLog.findMany({
      where: {
        userId: hostOwnerId,
        relatedId: instanceId,
        type: 'income',
        frozen: true
      },
      orderBy: { createdAt: 'asc' }
    })

    let remainingToDeduct = amount
    let fromFrozen = 0
    let fromAvailable = 0
    let fromBalance = 0

    // 第一步：优先从冻结收入中扣除
    // 冻结记录尚未计入 hostingBalance，通过删除/减少原记录来确保这部分钱不会被计入，
    // 即账务上正确地抵消了这笔收入。同时在下方统一新建一条独立的审计扣除记录。
    for (const log of frozenLogs) {
      if (remainingToDeduct <= 0) break

      const logAmount = Number(log.amount)
      const deductFromThis = Math.min(logAmount, remainingToDeduct)

      if (deductFromThis >= logAmount) {
        // 全额抵扣：删除整条冻结收入记录（此笔收入永远不会进入 hostingBalance）
        await client.hostingBalanceLog.delete({
          where: { id: log.id }
        })
      } else {
        // 部分抵扣：减少冻结记录金额，剩余部分继续冻结等待解冻
        await client.hostingBalanceLog.update({
          where: { id: log.id },
          data: { amount: { decrement: deductFromThis } }
        })
      }

      fromFrozen += deductFromThis
      remainingToDeduct -= deductFromThis
    }

    // 第二步：如果冻结收入不足，从已解冻的托管余额扣除
    if (remainingToDeduct > 0) {
      const user = await client.user.findUnique({
        where: { id: hostOwnerId },
        select: { hostingBalance: true, balance: true }
      })

      const availableHostingBalance = Number(user?.hostingBalance || 0)
      const deductFromAvailable = Math.min(availableHostingBalance, remainingToDeduct)

      if (deductFromAvailable > 0) {
        const hostingBalanceUpdateResult = await client.user.updateMany({
          where: {
            id: hostOwnerId,
            hostingBalance: { gte: deductFromAvailable }
          },
          data: { hostingBalance: { decrement: deductFromAvailable } }
        })
        if (hostingBalanceUpdateResult.count === 0) {
          throw new Error('托管余额不足，请稍后重试')
        }

        fromAvailable = deductFromAvailable
        remainingToDeduct -= deductFromAvailable
      }

      // 第三步：如果托管余额仍不足，从面板余额扣除
      if (remainingToDeduct > 0) {
        const availableBalance = Number(user?.balance || 0)
        const deductFromBalance = Math.min(availableBalance, remainingToDeduct)

        if (deductFromBalance > 0) {
          const balanceUpdateResult = await client.user.updateMany({
            where: {
              id: hostOwnerId,
              balance: { gte: deductFromBalance }
            },
            data: { balance: { decrement: deductFromBalance } }
          })
          if (balanceUpdateResult.count === 0) {
            throw new Error('余额不足，请稍后重试')
          }
          const updatedUser = await client.user.findUniqueOrThrow({
            where: { id: hostOwnerId },
            select: { balance: true }
          })
          const balanceAfter = Number(updatedUser.balance)

          // 记录面板余额变动日志
          await client.balanceLog.create({
            data: {
              userId: hostOwnerId,
              type: 'hosting_deduction',
              amount: -deductFromBalance,
              balanceBefore: availableBalance,
              balanceAfter,
              instanceId,
              remark: `托管实例销毁扣款：用户退款需从面板余额补扣`
            }
          })

          fromBalance = deductFromBalance
          remainingToDeduct -= deductFromBalance
        }
      }
    }

    const totalDeducted = fromFrozen + fromAvailable + fromBalance

    // 始终创建一条独立的销毁扣除审计记录（无论扣款来自冻结、托管余额还是面板余额）
    // 原来的条件 (fromFrozen>0 || fromAvailable>0) 遗漏了纯从面板余额扣款的情况，
    // 且金额也未包含 fromBalance，现统一修正。
    if (totalDeducted > 0) {
      const parts: string[] = []
      if (fromFrozen > 0) parts.push(`冻结抵扣 ¥${fromFrozen.toFixed(2)}`)
      if (fromAvailable > 0) parts.push(`托管余额扣除 ¥${fromAvailable.toFixed(2)}`)
      if (fromBalance > 0) parts.push(`面板余额补扣 ¥${fromBalance.toFixed(2)}`)

      await createHostingLogWithSnapshot(client, {
        userId: hostOwnerId,
        type: 'deduction',
        actionType: 'destroy',
        amount: -totalDeducted,
        instanceId,
        frozen: false,
        remark: `${remark}（${parts.join('，')}）`
      })
    }

    console.log(`[HostingBalance] 扣除托管余额: hostOwnerId=${hostOwnerId}, amount=${amount}, deducted=${totalDeducted}, fromFrozen=${fromFrozen}, fromAvailable=${fromAvailable}, fromBalance=${fromBalance}, instanceId=${instanceId}`)

    return { hostOwnerId, deductedAmount: totalDeducted, fromFrozen, fromAvailable, fromBalance }
  }

  if (tx) {
    return run(tx)
  }

  return prisma.$transaction(async (transaction) => run(transaction))
}
