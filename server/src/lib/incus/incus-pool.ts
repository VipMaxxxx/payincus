/**
 * Incus 客户端连接池管理 (高可用优化版)
 * 
 * 优化特性：
 * 1. 连接缓存复用：避免重复创建连接
 * 2. 自动重连：连接断开时自动重新连接
 * 3. 健康检查：记录连接状态和响应时间
 * 4. 过期清理：自动清理长时间未使用的连接
 */

import type { IncusClient } from './incus-client.js'
import { IncusClient as Client } from './incus-client.js'
import { recordHostSuccess, recordHostError as recordHostHealthError } from './host-health.js'

interface Host {
  id: number
  url: string
  cert_path?: string | null
  key_path?: string | null
  certPath?: string | null
  keyPath?: string | null
}

interface PooledClient {
  client: IncusClient
  lastUsed: number        // 最后使用时间戳
  lastResponseTime: number // 最后响应时间 (ms)
  errorCount: number       // 连续错误次数
}

const clientPool = new Map<string, PooledClient>()

// 连接过期时间 (30分钟未使用)
const CONNECTION_EXPIRE_MS = 30 * 60 * 1000

// 连接锁（防止并发重连）
const connectingLocks = new Map<string, Promise<IncusClient>>()

// 定期清理过期连接
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * 启动连接池清理定时器
 */
function ensureCleanupStarted(): void {
  if (cleanupInterval) return
  
  cleanupInterval = setInterval(async () => {
    const now = Date.now()
    const expiredKeys: string[] = []
    
    for (const [key, pooled] of clientPool) {
      if (now - pooled.lastUsed > CONNECTION_EXPIRE_MS) {
        expiredKeys.push(key)
      }
    }
    
    for (const key of expiredKeys) {
      // 先从池中移除，避免竞态条件（其他请求在 close 期间使用该连接）
      const pooled = clientPool.get(key)
      if (pooled) {
        clientPool.delete(key)
        try {
          await pooled.client.close()
        } catch {
          // 忽略关闭错误
        }
        console.log(`[IncusPool] Closed expired connection: ${key}`)
      }
    }
  }, 5 * 60 * 1000) // 每5分钟检查一次
}

/**
 * 获取或创建 Incus 客户端（带并发保护）
 */
export async function getIncusClient(host: Host): Promise<IncusClient> {
  ensureCleanupStarted()
  
  const key = `${host.id}`
  const now = Date.now()
  
  // 检查是否有正在进行的连接操作
  const existingLock = connectingLocks.get(key)
  if (existingLock) {
    return existingLock
  }
  
  if (clientPool.has(key)) {
    const pooled = clientPool.get(key)!
    pooled.lastUsed = now
    
    if (pooled.client.connected) {
      return pooled.client
    }
    
    // 重新连接（带锁保护）
    const reconnectPromise = (async () => {
      try {
        await pooled.client.connect()
        pooled.errorCount = 0
        return pooled.client
      } catch (error) {
        pooled.errorCount++
        throw error
      } finally {
        connectingLocks.delete(key)
      }
    })()
    
    connectingLocks.set(key, reconnectPromise)
    return reconnectPromise
  }

  // 创建新连接（带锁保护）
  const connectPromise = (async () => {
    try {
      const client = new Client({
        url: host.url,
        certPath: host.cert_path || host.certPath || null,
        keyPath: host.key_path || host.keyPath || null
      })

      await client.connect()
      
      clientPool.set(key, {
        client,
        lastUsed: now,
        lastResponseTime: 0,
        errorCount: 0
      })
      
      return client
    } finally {
      connectingLocks.delete(key)
    }
  })()
  
  connectingLocks.set(key, connectPromise)
  return connectPromise
}

/**
 * 更新客户端响应时间（用于性能监控，并重置错误计数）
 */
export function updateClientResponseTime(hostId: number, responseTime: number): void {
  const key = `${hostId}`
  const pooled = clientPool.get(key)
  if (pooled) {
    pooled.lastResponseTime = responseTime
    pooled.lastUsed = Date.now()
    // 成功响应时重置错误计数
    pooled.errorCount = 0
  }
  // 同步到统一健康状态模块
  recordHostSuccess(hostId, responseTime)
}

/**
 * 记录客户端错误
 */
export function recordClientError(hostId: number): void {
  const key = `${hostId}`
  const pooled = clientPool.get(key)
  if (pooled) {
    pooled.errorCount++
  }
  // 同步到统一健康状态模块
  recordHostHealthError(hostId)
}

/**
 * 获取连接池状态（用于监控）
 */
export function getPoolStatus(): Map<string, {
  connected: boolean
  lastUsed: number
  lastResponseTime: number
  errorCount: number
}> {
  const result = new Map()
  for (const [key, pooled] of clientPool) {
    result.set(key, {
      connected: pooled.client.connected,
      lastUsed: pooled.lastUsed,
      lastResponseTime: pooled.lastResponseTime,
      errorCount: pooled.errorCount
    })
  }
  return result
}

/**
 * 移除客户端连接
 */
export async function removeIncusClient(hostId: number): Promise<void> {
  const key = `${hostId}`
  if (clientPool.has(key)) {
    const pooled = clientPool.get(key)!
    await pooled.client.close()
    clientPool.delete(key)
  }
}

/**
 * 获取 Incus 客户端（别名，用于流量调度器等服务）
 */
export const getIncusClientFromPool = getIncusClient

/**
 * 关闭所有连接
 */
export async function closeAllClients(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
  
  for (const pooled of clientPool.values()) {
    try {
      await pooled.client.close()
    } catch {
      // 忽略关闭错误
    }
  }
  clientPool.clear()
}
