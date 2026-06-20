/**
 * 前端计费计算工具函数
 * 与后端 billing-calc.ts 保持一致
 */

// 周期天数常量（统一定义：1个月 = 31 天）
const CYCLE_DAYS: Record<number, number> = {
  1: 31,      // 月付
  3: 93,      // 季付
  6: 186,     // 半年付
  12: 372     // 年付
}

/**
 * 获取周期天数
 */
export function getCycleDays(billingCycle: number): number {
  return CYCLE_DAYS[billingCycle] || (billingCycle * 31)
}

/**
 * 计算日价
 */
export function calculateDailyPrice(price: number, billingCycle: number): number {
  const cycleDays = getCycleDays(billingCycle)
  return price / cycleDays
}

/**
 * 计算折扣后价格
 */
export function calculateDiscountedPrice(originalPrice: number, discountRate: number): number {
  return Number((originalPrice * (1 - discountRate)).toFixed(2))
}

/**
 * 计算价格差价
 * @param oldPrice 旧价格（元）
 * @param oldBillingCycle 旧计费周期（月）
 * @param newPrice 新价格（元）
 * @param newBillingCycle 新计费周期（月）
 * @param remainingDays 剩余天数
 * @param discountRate 折扣率（0-1）
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
