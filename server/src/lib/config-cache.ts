/**
 * 系统配置缓存层
 * PERF001: 为系统配置添加缓存，减少频繁的数据库查询
 * 
 * 策略说明：
 * - 使用内存缓存，生产环境可扩展为 Redis
 * - TTL: 5分钟（配置变更不频繁）
 * - 配置更新时自动清除缓存
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// 缓存配置
const CACHE_CONFIG = {
  /** 缓存过期时间（毫秒）*/
  TTL: 5 * 60 * 1000,  // 5分钟
  /** 最大缓存条目数 */
  MAX_SIZE: 100,
} as const

// 内存缓存存储
const configCache = new Map<string, CacheEntry<string | null>>()

/**
 * 从缓存获取配置值
 */
export function getCachedConfig(key: string): string | null | undefined {
  const entry = configCache.get(key)
  if (!entry) return undefined
  
  // 检查是否过期
  if (Date.now() > entry.expiresAt) {
    configCache.delete(key)
    return undefined
  }
  
  return entry.value
}

/**
 * 设置配置缓存
 */
export function setCachedConfig(key: string, value: string | null): void {
  // 检查缓存大小，避免内存泄漏
  if (configCache.size >= CACHE_CONFIG.MAX_SIZE) {
    // 清理过期条目
    const now = Date.now()
    for (const [k, v] of configCache.entries()) {
      if (now > v.expiresAt) {
        configCache.delete(k)
      }
    }
    
    // 如果仍然超过限制，清除最旧的条目
    if (configCache.size >= CACHE_CONFIG.MAX_SIZE) {
      const keysToDelete = Array.from(configCache.keys()).slice(0, 10)
      for (const k of keysToDelete) {
        configCache.delete(k)
      }
    }
  }
  
  configCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_CONFIG.TTL,
  })
}

/**
 * 清除指定配置的缓存
 */
export function invalidateCachedConfig(key: string): void {
  configCache.delete(key)
}

/**
 * 清除所有配置缓存
 */
export function invalidateAllConfigCache(): void {
  configCache.clear()
}

/**
 * 批量清除配置缓存
 */
export function invalidateCachedConfigs(keys: string[]): void {
  for (const key of keys) {
    configCache.delete(key)
  }
}

/**
 * 获取缓存统计信息（用于调试）
 */
export function getCacheStats(): {
  size: number
  maxSize: number
  ttl: number
} {
  return {
    size: configCache.size,
    maxSize: CACHE_CONFIG.MAX_SIZE,
    ttl: CACHE_CONFIG.TTL,
  }
}
