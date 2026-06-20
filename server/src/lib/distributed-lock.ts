/**
 * 分布式锁实现
 * LOGIC004: 支持多实例部署的分布式锁
 * 
 * 基于数据库的分布式锁实现，适用于：
 * - 配额更新（防止超卖）
 * - 任务调度（防止重复执行）
 * - 资源分配（防止竞争）
 * 
 * 特性：
 * - 基于 PostgreSQL 行级锁
 * - 自动过期释放（防止死锁）
 * - 可重入锁支持
 * - 锁等待超时
 */

import { prisma } from '../db/prisma.js'
import { Prisma } from '@prisma/client'
import { nanoid } from 'nanoid'

/**
 * 锁配置选项
 */
export interface LockOptions {
  /** 锁过期时间（毫秒），默认 30 秒 */
  expireMs?: number
  /** 等待锁的超时时间（毫秒），默认 5 秒 */
  waitTimeoutMs?: number
  /** 重试间隔（毫秒），默认 100 毫秒 */
  retryIntervalMs?: number
  /** 锁持有者标识（默认自动生成） */
  ownerId?: string
}

/**
 * 锁结果
 */
export interface LockResult {
  success: boolean
  lockId?: string
  ownerId?: string
  error?: string
}

/**
 * 默认配置
 */
const DEFAULT_OPTIONS = {
  expireMs: 30000,           // 30 秒过期
  waitTimeoutMs: 5000,       // 5 秒等待超时
  retryIntervalMs: 100,      // 100 毫秒重试间隔
} as const

/**
 * 生成唯一的锁持有者 ID
 */
function generateOwnerId(): string {
  return `${process.pid}-${nanoid(8)}`
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 尝试获取分布式锁
 * 
 * @param lockKey 锁的唯一标识
 * @param options 锁配置
 * @returns 锁结果
 */
export async function acquireLock(
  lockKey: string,
  options: LockOptions = {}
): Promise<LockResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const ownerId = opts.ownerId || generateOwnerId()
  const startTime = Date.now()

  while (Date.now() - startTime < opts.waitTimeoutMs) {
    try {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + opts.expireMs)
      const result = await prisma.$queryRaw<Array<{ id: number; ownerId: string }>>(Prisma.sql`
        INSERT INTO "distributed_locks" ("lock_key", "owner_id", "acquired_at", "expires_at")
        VALUES (${lockKey}, ${ownerId}, ${now}, ${expiresAt})
        ON CONFLICT ("lock_key") DO UPDATE
        SET
          "owner_id" = EXCLUDED."owner_id",
          "acquired_at" = EXCLUDED."acquired_at",
          "expires_at" = EXCLUDED."expires_at"
        WHERE
          "distributed_locks"."expires_at" <= ${now}
          OR "distributed_locks"."owner_id" = EXCLUDED."owner_id"
        RETURNING "id", "owner_id" AS "ownerId"
      `)

      if (result.length > 0) {
        return {
          success: true,
          lockId: String(result[0].id),
          ownerId: result[0].ownerId
        }
      }
    } catch (error) {
      // 语句级竞争通常表现为短暂失败，等待后重试
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        await delay(opts.retryIntervalMs)
        continue
      }
      throw error
    }

    await delay(opts.retryIntervalMs)
  }

  return { success: false, error: 'Lock acquisition timeout' }
}

/**
 * 释放分布式锁
 * 
 * @param lockKey 锁的唯一标识
 * @param ownerId 锁持有者 ID
 * @returns 是否成功释放
 */
export async function releaseLock(
  lockKey: string,
  ownerId: string
): Promise<boolean> {
  try {
    const result = await prisma.distributedLock.deleteMany({
      where: {
        lockKey,
        ownerId
      }
    })
    return result.count > 0
  } catch (error) {
    console.error(`[DistributedLock] Failed to release lock ${lockKey}:`, error)
    return false
  }
}

/**
 * 延长锁的过期时间
 * 
 * @param lockKey 锁的唯一标识
 * @param ownerId 锁持有者 ID
 * @param extendMs 延长时间（毫秒）
 * @returns 是否成功延长
 */
export async function extendLock(
  lockKey: string,
  ownerId: string,
  extendMs: number = 30000
): Promise<boolean> {
  try {
    const result = await prisma.distributedLock.updateMany({
      where: {
        lockKey,
        ownerId,
        expiresAt: { gt: new Date() }  // 只能延长未过期的锁
      },
      data: {
        expiresAt: new Date(Date.now() + extendMs)
      }
    })
    return result.count > 0
  } catch (error) {
    console.error(`[DistributedLock] Failed to extend lock ${lockKey}:`, error)
    return false
  }
}

/**
 * 使用锁执行操作（自动获取和释放）
 * 
 * @param lockKey 锁的唯一标识
 * @param fn 要执行的函数
 * @param options 锁配置
 * @returns 执行结果
 * 
 * @example
 * ```typescript
 * const result = await withLock('user:123:quota', async () => {
 *   // 配额更新操作
 *   await updateUserQuota(userId, delta)
 *   return { success: true }
 * }, { expireMs: 10000 })
 * ```
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<{ success: boolean; result?: T; error?: string }> {
  const lockResult = await acquireLock(lockKey, options)
  
  if (!lockResult.success || !lockResult.ownerId) {
    return { success: false, error: lockResult.error || 'Failed to acquire lock' }
  }

  try {
    const result = await fn()
    return { success: true, result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await releaseLock(lockKey, lockResult.ownerId)
  }
}

/**
 * 清理过期的锁（定期调用）
 * 
 * @returns 清理的锁数量
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const result = await prisma.distributedLock.deleteMany({
    where: {
      expiresAt: { lt: new Date() }
    }
  })
  
  if (result.count > 0) {
    console.log(`[DistributedLock] Cleaned up ${result.count} expired locks`)
  }
  
  return result.count
}

/**
 * 获取锁状态
 * 
 * @param lockKey 锁的唯一标识
 * @returns 锁状态信息
 */
export async function getLockStatus(lockKey: string): Promise<{
  exists: boolean
  isExpired: boolean
  ownerId?: string
  expiresAt?: Date
  acquiredAt?: Date
} | null> {
  const lock = await prisma.distributedLock.findUnique({
    where: { lockKey }
  })

  if (!lock) {
    return { exists: false, isExpired: false }
  }

  return {
    exists: true,
    isExpired: lock.expiresAt < new Date(),
    ownerId: lock.ownerId,
    expiresAt: lock.expiresAt,
    acquiredAt: lock.acquiredAt
  }
}
