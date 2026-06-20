/**
 * 公共计费计算模块
 * 所有涉及价格、日价、差价、剩余价值的计算必须使用本模块的方法
 * 确保全系统计算逻辑一致
 */

// ==================== 周期天数常量 ====================

/**
 * 标准周期天数
 * 统一定义：1个月 = 31 天
 * 月付: 31 天
 * 季付: 31 * 3 = 93 天
 * 半年付: 31 * 6 = 186 天
 * 年付: 31 * 12 = 372 天
 */
const CYCLE_DAYS: Record<number, number> = {
  1: 31,      // 月付
  3: 93,      // 季付
  6: 186,     // 半年付
  12: 372     // 年付
}

// ==================== 基础计算函数 ====================

/**
 * 获取周期天数
 * @param billingCycle 计费周期（月数）
 * @returns 周期天数
 */
export function getCycleDays(billingCycle: number): number {
  return CYCLE_DAYS[billingCycle] || (billingCycle * 31)
}

/**
 * 计算日价
 * @param price 周期价格（元）
 * @param billingCycle 计费周期（月数）
 * @returns 日价（元）
 */
export function calculateDailyPrice(price: number, billingCycle: number): number {
  const cycleDays = getCycleDays(billingCycle)
  return price / cycleDays
}

/**
 * 计算月价
 * @param price 周期价格（元）
 * @param billingCycle 计费周期（月数）
 * @returns 月价（元）
 */
export function calculateMonthlyPrice(price: number, billingCycle: number): number {
  const cycle = Math.max(billingCycle || 1, 1) // 防止除零
  return price / cycle
}

/**
 * 计算实际支付价格（应用折扣后）
 * @param originalPrice 原价（元）
 * @param discountRate 折扣率（0-1，如 0.05 表示 5% 折扣）
 * @returns 折扣后价格（元）
 */
export function calculateDiscountedPrice(originalPrice: number, discountRate: number): number {
  return Number((originalPrice * (1 - discountRate)).toFixed(2))
}

/**
 * 计算折扣金额
 * @param originalPrice 原价（元）
 * @param discountRate 折扣率（0-1）
 * @returns 折扣金额（元）
 */
export function calculateDiscountAmount(originalPrice: number, discountRate: number): number {
  return Number((originalPrice * discountRate).toFixed(2))
}

// ==================== 剩余天数计算 ====================

/**
 * 计算剩余天数（向上取整）
 * @param expiresAt 到期时间
 * @param now 当前时间（可选，默认为当前）
 * @returns 剩余天数（>=0）
 */
export function calculateRemainingDays(expiresAt: Date, now: Date = new Date()): number {
  const expiresDate = new Date(expiresAt)
  const remainingMs = expiresDate.getTime() - now.getTime()
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
}

/**
 * 计算剩余天数（精确到小数）
 * @param expiresAt 到期时间
 * @param now 当前时间（可选）
 * @returns 剩余天数（精确）
 */
export function calculateRemainingDaysPrecise(expiresAt: Date, now: Date = new Date()): number {
  const expiresDate = new Date(expiresAt)
  const remainingMs = expiresDate.getTime() - now.getTime()
  return Math.max(0, remainingMs / (24 * 60 * 60 * 1000))
}

// ==================== 剩余价值计算 ====================

/**
 * 计算剩余价值
 * 公式: 日价 × 剩余天数
 * 
 * @param price 周期价格（元，原价）
 * @param billingCycle 计费周期（月数）
 * @param remainingDays 剩余天数
 * @param discountRate 折扣率（0-1，可选）
 * @returns 剩余价值（元）
 */
export function calculateRemainingValue(
  price: number,
  billingCycle: number,
  remainingDays: number,
  discountRate: number = 0
): number {
  // 使用折扣后的价格计算剩余价值
  const effectivePrice = discountRate > 0
    ? calculateDiscountedPrice(price, discountRate)
    : price
  const dailyPrice = calculateDailyPrice(effectivePrice, billingCycle)
  return Number((dailyPrice * remainingDays).toFixed(2))
}

/**
 * 计算安全的剩余价值退款金额
 * 确保退款金额不超过实际支付金额
 * 
 * @param price 周期价格（元，原价）
 * @param billingCycle 计费周期（月数）
 * @param remainingDays 剩余天数
 * @param discountRate 折扣率（0-1）
 * @param maxRefundable 最大可退款金额（可选，用于限制）
 * @returns 安全的退款金额（元）
 */
export function calculateSafeRefundAmount(
  price: number,
  billingCycle: number,
  remainingDays: number,
  discountRate: number = 0,
  maxRefundable?: number
): number {
  const effectivePrice = discountRate > 0
    ? calculateDiscountedPrice(price, discountRate)
    : price

  // 计算剩余价值
  const cycleDays = getCycleDays(billingCycle)
  const remainingRatio = Math.min(remainingDays / cycleDays, 1) // 比例不能超过 1
  const refundAmount = Number((effectivePrice * remainingRatio).toFixed(2))

  // 如果提供了最大可退款金额，取较小值
  if (maxRefundable !== undefined) {
    return Math.min(refundAmount, maxRefundable)
  }

  return refundAmount
}

// ==================== 差价计算 ====================

/**
 * 计算方案切换差价
 * 公式: (新方案日价 - 旧方案日价) × 剩余天数
 * 
 * 重要：
 * - 如果用户原本用优惠码购买，剩余价值应该用折扣后价格计算
 * - 新方案费用也应该用折扣后价格计算
 * - 确保公平性：用户实际支付了多少，剩余价值就按比例退多少
 * 
 * @param oldPrice 旧方案周期价格（元）
 * @param oldBillingCycle 旧方案计费周期
 * @param newPrice 新方案周期价格（元）
 * @param newBillingCycle 新方案计费周期
 * @param remainingDays 剩余天数
 * @param discountRate 折扣率（0-1，应用于新旧方案）
 * @returns 差价（正数=补交，负数=退款）
 */
export function calculatePriceDiff(
  oldPrice: number,
  oldBillingCycle: number,
  newPrice: number,
  newBillingCycle: number,
  remainingDays: number,
  discountRate: number = 0
): number {
  // 应用折扣后的实际价格
  const actualOldPrice = discountRate > 0
    ? calculateDiscountedPrice(oldPrice, discountRate)
    : oldPrice
  const actualNewPrice = discountRate > 0
    ? calculateDiscountedPrice(newPrice, discountRate)
    : newPrice

  // 计算日价
  const oldDailyPrice = calculateDailyPrice(actualOldPrice, oldBillingCycle)
  const newDailyPrice = calculateDailyPrice(actualNewPrice, newBillingCycle)

  // 差价 = (新日价 - 旧日价) × 剩余天数
  const priceDiff = (newDailyPrice - oldDailyPrice) * remainingDays

  // 最低金额门槛：低于 0.01 元按 0 处理
  return Math.abs(priceDiff) < 0.01 ? 0 : Number(priceDiff.toFixed(2))
}

/**
 * 计算完整的方案切换结果
 * 包含所有计算细节，供前端展示和后端处理
 */
export interface PlanChangeCalcResult {
  /** 旧方案日价（元） */
  oldDailyPrice: number
  /** 新方案日价（元） */
  newDailyPrice: number
  /** 剩余价值（元，折扣后） */
  remainingValue: number
  /** 新方案费用（元，折扣后） */
  newPlanCost: number
  /** 折扣金额（元） */
  discountAmount: number
  /** 差价（元，正数=补交，负数=退款） */
  priceDiff: number
  /** 是否升级 */
  isUpgrade: boolean
}

export function calculatePlanChangeDetails(
  oldPrice: number,
  oldBillingCycle: number,
  newPrice: number,
  newBillingCycle: number,
  remainingDays: number,
  discountRate: number = 0
): PlanChangeCalcResult {
  // 计算折扣后的价格
  const actualOldPrice = discountRate > 0
    ? calculateDiscountedPrice(oldPrice, discountRate)
    : oldPrice
  const actualNewPrice = discountRate > 0
    ? calculateDiscountedPrice(newPrice, discountRate)
    : newPrice

  // 计算日价
  const oldDailyPrice = calculateDailyPrice(actualOldPrice, oldBillingCycle)
  const newDailyPrice = calculateDailyPrice(actualNewPrice, newBillingCycle)

  // 剩余价值 = 旧日价 × 剩余天数
  const remainingValue = Number((oldDailyPrice * remainingDays).toFixed(2))

  // 新方案费用 = 新日价 × 剩余天数
  const newPlanCost = Number((newDailyPrice * remainingDays).toFixed(2))

  // 折扣金额（基于新方案原价）
  const discountAmount = discountRate > 0
    ? Number(((newPrice / getCycleDays(newBillingCycle)) * remainingDays * discountRate).toFixed(2))
    : 0

  // 差价
  const priceDiff = Number((newPlanCost - remainingValue).toFixed(2))
  const finalPriceDiff = Math.abs(priceDiff) < 0.01 ? 0 : priceDiff

  return {
    oldDailyPrice: Number(oldDailyPrice.toFixed(4)),
    newDailyPrice: Number(newDailyPrice.toFixed(4)),
    remainingValue,
    newPlanCost,
    discountAmount,
    priceDiff: finalPriceDiff,
    isUpgrade: newDailyPrice > oldDailyPrice
  }
}

// ==================== 续费计算 ====================

/**
 * 计算续费金额
 * @param monthlyPrice 月价（元）
 * @param months 续费月数
 * @param discountRate 折扣率（0-1）
 * @returns { originalAmount, discountAmount, finalAmount }
 */
export function calculateRenewAmount(
  monthlyPrice: number,
  months: number,
  discountRate: number = 0
): { originalAmount: number; discountAmount: number; finalAmount: number } {
  const originalAmount = Number((monthlyPrice * months).toFixed(2))
  const discountAmount = discountRate > 0
    ? Number((originalAmount * discountRate).toFixed(2))
    : 0
  const finalAmount = Number((originalAmount - discountAmount).toFixed(2))

  return { originalAmount, discountAmount, finalAmount }
}

// ==================== 辅助函数 ====================

/**
 * 添加月份到日期
 * 统一按天数计算：1个月 = 31 天
 * @param date 基准日期
 * @param months 月数
 * @returns 新日期
 */
export function addMonths(date: Date, months: number): Date {
  const daysToAdd = months * 31
  const result = new Date(date)
  result.setDate(result.getDate() + daysToAdd)
  return result
}
