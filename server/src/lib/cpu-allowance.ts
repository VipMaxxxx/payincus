/**
 * CPU额配转换工具
 * 将CPU额配（allowance）转换为实际核心数
 * 
 * 规则：
 * - 小于100% = 1核
 * - 150% = 2核
 * - 200% = 3核
 * - 250% = 3核（向上取整）
 * 
 * 计算公式：核心数 = Math.ceil(额配 / 100)
 */

/**
 * 将CPU额配转换为实际核心数
 * @param allowance - CPU额配（例如：100, 150, 200）
 * @returns 核心数
 * 
 * 规则：
 * - 额配 ≤ 100% → 1核
 * - 100% < 额配 ≤ 200% → 2核
 * - 200% < 额配 ≤ 300% → 3核
 * - 以此类推...
 */
export function allowanceToCores(allowance: number): number {
  if (allowance <= 0) return 1
  if (allowance <= 100) return 1
  // 大于100时，向上取整到下一个100的倍数
  return Math.ceil(allowance / 100)
}

/**
 * 验证CPU额配是否有效
 * @param allowance - CPU额配
 * @param minAllowance - 最小额配（默认1）
 * @param maxAllowance - 最大额配
 * @returns 是否有效
 */
export function isValidAllowance(
  allowance: number,
  minAllowance: number = 15,
  maxAllowance: number = Infinity
): boolean {
  if (allowance < minAllowance || allowance > maxAllowance) return false
  // 额配必须是5的倍数（步长为5）
  return allowance % 5 === 0
}

/**
 * 规范化CPU额配（确保是5的倍数，且在范围内）
 * @param allowance - CPU额配
 * @param minAllowance - 最小额配（默认1）
 * @param maxAllowance - 最大额配
 * @returns 规范化后的额配
 */
export function normalizeAllowance(
  allowance: number,
  minAllowance: number = 15,
  maxAllowance: number = Infinity
): number {
  // 确保不小于最小值
  allowance = Math.max(allowance, minAllowance)
  // 确保不超过最大值
  allowance = Math.min(allowance, maxAllowance)
  // 向下取整到5的倍数
  allowance = Math.floor(allowance / 5) * 5
  // 确保不小于最小值
  return Math.max(allowance, minAllowance)
}

