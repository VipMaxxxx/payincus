import { prisma } from '../db/prisma.js'
import { getTrafficCounters } from '../lib/incus/incus-traffic.js'
import { getIncusClientFromPool } from '../lib/incus/incus-pool.js'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { acquireLock, extendLock, releaseLock, withLock } from '../lib/distributed-lock.js'
import type { LockOptions } from '../lib/distributed-lock.js'
import { calculateIncrement } from './traffic-utils.js'

export interface CollectInstanceTrafficResult {
  success: boolean
  skipped: boolean
  totalDelta: bigint
  currentUsage: bigint
  error?: string
}

interface CollectTrafficWithClientInput {
  instanceId: number
  userId: number
  incusId: string
  client: IncusClient
  currentUsage?: bigint
}

const DEFAULT_TRAFFIC_LOCK_OPTIONS: LockOptions = {
  expireMs: 30000,
  waitTimeoutMs: 5000,
  retryIntervalMs: 50
}

function getTrafficLockKey(instanceId: number): string {
  return `traffic:instance:${instanceId}`
}

function getUserTrafficLockKey(userId: number): string {
  return `traffic:user:${userId}`
}

async function applyTrafficCounters(
  instanceId: number,
  userId: number,
  counters: { rxBytes: bigint; txBytes: bigint }
): Promise<{ totalDelta: bigint; currentUsage: bigint; skipped: boolean }> {
  const now = new Date()
  const normalizedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const userLockResult = await withLock(getUserTrafficLockKey(userId), async () => prisma.$transaction(async (tx) => {
    const instance = await tx.instance.findUnique({
      where: { id: instanceId },
      select: {
        monthlyTrafficUsed: true,
        status: true
      }
    })

    if (!instance) {
      throw new Error('实例不存在')
    }

    if (instance.status !== 'running') {
      return {
        totalDelta: 0n,
        currentUsage: instance.monthlyTrafficUsed,
        skipped: true
      }
    }

    const latestSnapshot = await tx.trafficSnapshot.findUnique({
      where: { instanceId }
    })

    const rxIncrement = latestSnapshot
      ? calculateIncrement(counters.rxBytes, latestSnapshot.rxRaw)
      : 0n
    const txIncrement = latestSnapshot
      ? calculateIncrement(counters.txBytes, latestSnapshot.txRaw)
      : 0n
    const totalDelta = rxIncrement + txIncrement

    await tx.trafficSnapshot.upsert({
      where: { instanceId },
      update: {
        rxRaw: counters.rxBytes,
        txRaw: counters.txBytes
      },
      create: {
        instanceId,
        rxRaw: counters.rxBytes,
        txRaw: counters.txBytes
      }
    })

    let currentUsage = instance.monthlyTrafficUsed

    if (totalDelta > 0n) {
      const updatedInstance = await tx.instance.update({
        where: { id: instanceId },
        data: {
          monthlyTrafficUsed: { increment: totalDelta }
        },
        select: {
          monthlyTrafficUsed: true
        }
      })
      currentUsage = updatedInstance.monthlyTrafficUsed

      await tx.userQuota.updateMany({
        where: { userId },
        data: {
          monthlyTrafficUsed: { increment: totalDelta }
        }
      })

      await tx.dailyTraffic.upsert({
        where: {
          instanceId_date: {
            instanceId,
            date: normalizedDate
          }
        },
        update: {
          rxTotal: { increment: rxIncrement },
          txTotal: { increment: txIncrement }
        },
        create: {
          instanceId,
          date: normalizedDate,
          rxTotal: rxIncrement,
          txTotal: txIncrement
        }
      })
    }

    return {
      totalDelta,
      currentUsage,
      skipped: false
    }
  }), {
    expireMs: 30000,
    waitTimeoutMs: 5000,
    retryIntervalMs: 50
  })

  if (!userLockResult.success || !userLockResult.result) {
    throw new Error(userLockResult.error || '用户流量重置锁获取失败')
  }

  return userLockResult.result
}

/**
 * 在实例级锁内完成一次完整的流量采集与基线提交。
 * 这会串行化同一实例上的即时采集与定时采集，避免读取同一旧基线导致重复记账。
 */
export async function collectTrafficForInstanceWithClient(
  input: CollectTrafficWithClientInput,
  lockOptions: LockOptions = {}
): Promise<CollectInstanceTrafficResult> {
  const { instanceId, userId, incusId, client, currentUsage = 0n } = input
  const lockKey = getTrafficLockKey(instanceId)
  const effectiveLockOptions = { ...DEFAULT_TRAFFIC_LOCK_OPTIONS, ...lockOptions }
  const lockResult = await acquireLock(lockKey, effectiveLockOptions)

  if (!lockResult.success || !lockResult.ownerId) {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage,
      error: lockResult.error || '流量采集锁获取失败'
    }
  }

  const renewIntervalMs = Math.max(1000, Math.floor((effectiveLockOptions.expireMs || DEFAULT_TRAFFIC_LOCK_OPTIONS.expireMs || 30000) / 3))
  let renewTimer: ReturnType<typeof setInterval> | null = null

  try {
    renewTimer = setInterval(() => {
      extendLock(lockKey, lockResult.ownerId!, effectiveLockOptions.expireMs).catch((error) => {
        console.warn(`[Traffic] Failed to extend lock ${lockKey}:`, error)
      })
    }, renewIntervalMs)

    const counters = await getTrafficCounters(client, incusId)
    const result = await applyTrafficCounters(instanceId, userId, counters)

    return {
      success: true,
      skipped: result.skipped,
      totalDelta: result.totalDelta,
      currentUsage: result.currentUsage
    }
  } catch (error) {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (renewTimer) clearInterval(renewTimer)
    await releaseLock(lockKey, lockResult.ownerId)
  }
}

/**
 * 立即采集单个运行中实例的流量并写回数据库。
 * 用于停机前补采最后一段增量，避免等待定时任务导致流量尾差丢失。
 */
export async function collectTrafficForRunningInstance(
  instanceId: number,
  lockOptions: LockOptions = {}
): Promise<CollectInstanceTrafficResult> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      status: true,
      userId: true,
      incusId: true,
      monthlyTrafficUsed: true,
      host: {
        select: {
          id: true,
          url: true,
          certPath: true,
          keyPath: true,
          status: true
        }
      }
    }
  })

  if (!instance) {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage: 0n,
      error: '实例不存在'
    }
  }

  if (instance.status !== 'running') {
    return {
      success: true,
      skipped: true,
      totalDelta: 0n,
      currentUsage: instance.monthlyTrafficUsed
    }
  }

  if (instance.host.status !== 'online') {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage: instance.monthlyTrafficUsed,
      error: '宿主机离线，无法立即采集流量'
    }
  }

  if (!instance.host.certPath || !instance.host.keyPath) {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage: instance.monthlyTrafficUsed,
      error: '宿主机证书未配置，无法立即采集流量'
    }
  }

  try {
    const client = await getIncusClientFromPool({
      id: instance.host.id,
      url: instance.host.url,
      certPath: instance.host.certPath,
      keyPath: instance.host.keyPath
    })

    return collectTrafficForInstanceWithClient({
      instanceId,
      userId: instance.userId,
      incusId: instance.incusId,
      client,
      currentUsage: instance.monthlyTrafficUsed
    }, lockOptions)
  } catch (error) {
    return {
      success: false,
      skipped: false,
      totalDelta: 0n,
      currentUsage: instance.monthlyTrafficUsed,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
