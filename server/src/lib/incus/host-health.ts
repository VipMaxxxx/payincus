/**
 * 统一宿主机健康状态管理
 * 
 * 整合 status-scheduler.ts 和 incus-pool.ts 的健康状态追踪
 * 提供统一的接口供各模块使用
 */

interface HostHealth {
  lastResponseTime: number  // 最近响应时间 (ms)
  errorCount: number        // 连续错误次数
  lastCheck: number         // 最后检查时间戳
  lastSuccess: number       // 最后成功时间戳
}

// 统一的健康状态缓存
const hostHealthCache = new Map<number, HostHealth>()

// 配置常量
const ERROR_THRESHOLD = 3           // 连续错误阈值
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000  // 5分钟恢复冷却期

/**
 * 检查宿主机是否健康
 */
export function isHostHealthy(hostId: number): boolean {
  const health = hostHealthCache.get(hostId)
  if (!health) return true

  // 连续错误超过阈值，认为不健康
  if (health.errorCount >= ERROR_THRESHOLD) {
    // 冷却期后重试
    if (Date.now() - health.lastCheck > RECOVERY_COOLDOWN_MS) {
      health.errorCount = 0
      return true
    }
    return false
  }

  return true
}

/**
 * 记录成功操作
 */
export function recordHostSuccess(hostId: number, responseTimeMs: number): void {
  const now = Date.now()
  const health = hostHealthCache.get(hostId) || {
    lastResponseTime: 0,
    errorCount: 0,
    lastCheck: now,
    lastSuccess: now
  }

  health.lastResponseTime = responseTimeMs
  health.errorCount = 0
  health.lastCheck = now
  health.lastSuccess = now

  hostHealthCache.set(hostId, health)
}

/**
 * 记录失败操作
 */
export function recordHostError(hostId: number): void {
  const now = Date.now()
  const health = hostHealthCache.get(hostId) || {
    lastResponseTime: 0,
    errorCount: 0,
    lastCheck: now,
    lastSuccess: 0
  }

  health.errorCount++
  health.lastCheck = now

  hostHealthCache.set(hostId, health)
}

/**
 * 获取宿主机健康状态
 */
export function getHostHealth(hostId: number): HostHealth | undefined {
  return hostHealthCache.get(hostId)
}

/**
 * 获取所有宿主机健康状态（用于监控）
 */
export function getAllHostHealth(): Map<number, HostHealth> {
  return new Map(hostHealthCache)
}

/**
 * 获取不健康的宿主机列表
 */
export function getUnhealthyHosts(): number[] {
  const unhealthy: number[] = []
  for (const [hostId, health] of hostHealthCache) {
    if (health.errorCount >= ERROR_THRESHOLD) {
      unhealthy.push(hostId)
    }
  }
  return unhealthy
}

/**
 * 清除宿主机健康状态（宿主机被删除时调用）
 */
export function clearHostHealth(hostId: number): void {
  hostHealthCache.delete(hostId)
}

/**
 * 获取健康状态摘要（用于监控）
 */
export function getHealthSummary(): {
  totalHosts: number
  healthyHosts: number
  unhealthyHosts: number
  avgResponseTime: number
} {
  let healthyCount = 0
  let unhealthyCount = 0
  let totalResponseTime = 0
  let responseCount = 0

  for (const health of hostHealthCache.values()) {
    if (health.errorCount >= ERROR_THRESHOLD) {
      unhealthyCount++
    } else {
      healthyCount++
    }
    
    if (health.lastResponseTime > 0) {
      totalResponseTime += health.lastResponseTime
      responseCount++
    }
  }

  return {
    totalHosts: hostHealthCache.size,
    healthyHosts: healthyCount,
    unhealthyHosts: unhealthyCount,
    avgResponseTime: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0
  }
}
