/**
 * Agent 实例状态与流量批量上报处理。
 *
 * 设计原则：
 * - Agent 只上报本机 Incus 只读数据，业务规则仍由面板决定。
 * - 只更新数据库中属于该宿主机的实例，防止跨宿主机污染。
 * - 流量写入沿用实例级分布式锁，避免和旧定时采集重复记账。
 */

import pLimit from 'p-limit'
import type { InstanceStatus } from '@prisma/client'
import { isIP } from 'node:net'
import { prisma } from '../db/prisma.js'
import { withLock } from '../lib/distributed-lock.js'
import { mapInstanceStatus } from '../lib/incus/incus-utils.js'
import { calculateIncrement } from './traffic-utils.js'

interface NormalizedAgentInstanceItem {
  name: string
  status: InstanceStatus | null
  rxBytes: bigint | null
  txBytes: bigint | null
  ipv4?: string | null
  ipv6?: string | null
}

export interface AgentInstanceReportResult {
  received: number
  matched: number
  statusUpdated: number
  trafficUpdated: number
  trafficDeltaBytes: string
  skipped: number
  errors: number
}

type ReportedDbInstance = {
  id: number
  incusId: string
  userId: number
  status: InstanceStatus
}

const maxAgentInstanceReportItems = 2000
const agentReportConcurrency = 8
const trafficLockOptions = {
  expireMs: 30000,
  waitTimeoutMs: 3000,
  retryIntervalMs: 50
}

function getUserTrafficLockKey(userId: number): string {
  return `traffic:user:${userId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeShortString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function parseCounter(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : null
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      return null
    }
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d{1,30}$/.test(value.trim())) {
    return BigInt(value.trim())
  }
  return null
}

function normalizeStatus(value: unknown): InstanceStatus | null {
  const raw = sanitizeShortString(value, 40)
  if (!raw) {
    return null
  }

  if (raw === 'running' || raw === 'stopped' || raw === 'error') {
    return raw
  }

  const mapped = mapInstanceStatus(raw)
  if (mapped === 'running' || mapped === 'stopped' || mapped === 'error') {
    return mapped
  }
  return null
}

function normalizeNetworkAddress(value: unknown, family: 4 | 6): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const address = value.trim()
  if (!address) {
    return null
  }

  if (address.length > 128 || isIP(address) !== family) {
    return undefined
  }

  return address
}

function normalizeAgentInstanceItems(payload: unknown): NormalizedAgentInstanceItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return []
  }

  const items: NormalizedAgentInstanceItem[] = []
  for (const rawItem of payload.items.slice(0, maxAgentInstanceReportItems)) {
    if (!isRecord(rawItem)) {
      continue
    }

    const name = sanitizeShortString(rawItem.name, 256)
    if (!name) {
      continue
    }

    const traffic = isRecord(rawItem.traffic) ? rawItem.traffic : {}
    const network = isRecord(rawItem.network) ? rawItem.network : {}
    items.push({
      name,
      status: normalizeStatus(rawItem.status),
      rxBytes: parseCounter(traffic.rxBytes),
      txBytes: parseCounter(traffic.txBytes),
      ipv4: normalizeNetworkAddress(network.ipv4, 4),
      ipv6: normalizeNetworkAddress(network.ipv6, 6)
    })
  }

  return items
}

function shouldSyncStatus(currentStatus: InstanceStatus, reportedStatus: InstanceStatus | null): reportedStatus is InstanceStatus {
  if (!reportedStatus) {
    return false
  }

  // 不让只读 Agent 心跳改动创建失败、封停、删除和创建中实例，避免绕过业务流程。
  return currentStatus === 'running' || currentStatus === 'stopped'
}

function shouldApplyTraffic(currentStatus: InstanceStatus, item: NormalizedAgentInstanceItem): boolean {
  if (item.status !== 'running' || item.rxBytes === null || item.txBytes === null) {
    return false
  }

  // 流量属于计费数据，只允许当前业务状态为 running 的实例写入。
  return currentStatus === 'running'
}

function buildStatusUpdateData(item: NormalizedAgentInstanceItem, now: Date): {
  status: InstanceStatus
  lastSyncedAt: Date
  ipv4?: string | null
  ipv6?: string | null
} | null {
  if (!item.status) {
    return null
  }

  const data: {
    status: InstanceStatus
    lastSyncedAt: Date
    ipv4?: string | null
    ipv6?: string | null
  } = {
    status: item.status,
    lastSyncedAt: now
  }

  if (item.ipv4 !== undefined) {
    data.ipv4 = item.ipv4
  }
  if (item.ipv6 !== undefined) {
    data.ipv6 = item.ipv6
  }

  return data
}

async function applyReportedTrafficCounters(
  instance: ReportedDbInstance,
  item: NormalizedAgentInstanceItem,
  now: Date
): Promise<{ updated: boolean; delta: bigint }> {
  if (!shouldApplyTraffic(instance.status, item)) {
    return { updated: false, delta: 0n }
  }

  const lockKey = `traffic:instance:${instance.id}`
  const lockResult = await withLock(lockKey, async () => {
    const normalizedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const userLockResult = await withLock(getUserTrafficLockKey(instance.userId), async () => prisma.$transaction(async (tx) => {
      const currentInstance = await tx.instance.findUnique({
        where: { id: instance.id },
        select: { status: true }
      })
      if (!currentInstance || !shouldApplyTraffic(currentInstance.status, item)) {
        return {
          updated: false,
          delta: 0n
        }
      }

      const latestSnapshot = await tx.trafficSnapshot.findUnique({
        where: { instanceId: instance.id }
      })

      const rxIncrement = latestSnapshot
        ? calculateIncrement(item.rxBytes!, latestSnapshot.rxRaw)
        : 0n
      const txIncrement = latestSnapshot
        ? calculateIncrement(item.txBytes!, latestSnapshot.txRaw)
        : 0n
      const totalDelta = rxIncrement + txIncrement

      await tx.trafficSnapshot.upsert({
        where: { instanceId: instance.id },
        update: {
          rxRaw: item.rxBytes!,
          txRaw: item.txBytes!
        },
        create: {
          instanceId: instance.id,
          rxRaw: item.rxBytes!,
          txRaw: item.txBytes!
        }
      })

      if (totalDelta > 0n) {
        await tx.instance.update({
          where: { id: instance.id },
          data: {
            monthlyTrafficUsed: { increment: totalDelta }
          }
        })

        await tx.userQuota.updateMany({
          where: { userId: instance.userId },
          data: {
            monthlyTrafficUsed: { increment: totalDelta }
          }
        })

        await tx.dailyTraffic.upsert({
          where: {
            instanceId_date: {
              instanceId: instance.id,
              date: normalizedDate
            }
          },
          update: {
            rxTotal: { increment: rxIncrement },
            txTotal: { increment: txIncrement }
          },
          create: {
            instanceId: instance.id,
            date: normalizedDate,
            rxTotal: rxIncrement,
            txTotal: txIncrement
          }
        })
      }

      return {
        updated: true,
        delta: totalDelta
      }
    }), trafficLockOptions)

    if (!userLockResult.success || !userLockResult.result) {
      throw new Error(userLockResult.error || 'Agent user traffic lock acquisition failed')
    }

    return userLockResult.result
  }, trafficLockOptions)

  if (!lockResult.success || !lockResult.result) {
    throw new Error(lockResult.error || 'Agent traffic lock acquisition failed')
  }

  return lockResult.result
}

async function processOneAgentInstanceReport(
  instance: ReportedDbInstance,
  item: NormalizedAgentInstanceItem,
  now: Date
): Promise<Pick<AgentInstanceReportResult, 'statusUpdated' | 'trafficUpdated' | 'trafficDeltaBytes' | 'skipped' | 'errors'>> {
  let statusUpdated = 0
  let trafficUpdated = 0
  let trafficDelta = 0n
  let skipped = 0
  let errors = 0

  try {
    let trafficInstance = instance
    if (shouldSyncStatus(instance.status, item.status)) {
      const updateData = buildStatusUpdateData(item, now)
      if (updateData) {
        const updateResult = await prisma.instance.updateMany({
          where: {
            id: instance.id,
            status: { in: ['running', 'stopped'] }
          },
          data: updateData
        })
        statusUpdated = updateResult.count
        if (statusUpdated > 0) {
          trafficInstance = {
            ...instance,
            status: updateData.status
          }
        }
      }
    } else {
      skipped += 1
    }

    const trafficResult = await applyReportedTrafficCounters(trafficInstance, item, now)
    if (trafficResult.updated) {
      trafficUpdated = 1
      trafficDelta = trafficResult.delta
    }
  } catch (error) {
    errors += 1
    console.warn('[AgentReport] Failed to process reported instance', {
      instanceId: instance.id,
      incusId: instance.incusId,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return {
    statusUpdated,
    trafficUpdated,
    trafficDeltaBytes: trafficDelta.toString(),
    skipped,
    errors
  }
}

export async function processAgentInstanceReport(hostId: number, payload: unknown): Promise<AgentInstanceReportResult> {
  const items = normalizeAgentInstanceItems(payload)
  const result: AgentInstanceReportResult = {
    received: items.length,
    matched: 0,
    statusUpdated: 0,
    trafficUpdated: 0,
    trafficDeltaBytes: '0',
    skipped: 0,
    errors: 0
  }

  if (items.length === 0) {
    return result
  }

  const incusIds = Array.from(new Set(items.map(item => item.name)))
  const instances = await prisma.instance.findMany({
    where: {
      hostId,
      incusId: { in: incusIds },
      status: { not: 'deleted' }
    },
    select: {
      id: true,
      incusId: true,
      userId: true,
      status: true
    }
  })
  const instanceByIncusId = new Map(instances.map(instance => [instance.incusId, instance]))
  const limit = pLimit(agentReportConcurrency)

  const itemResults = await Promise.all(items.map(item => limit(async () => {
    const instance = instanceByIncusId.get(item.name)
    if (!instance) {
      return {
        matched: 0,
        statusUpdated: 0,
        trafficUpdated: 0,
        trafficDeltaBytes: '0',
        skipped: 1,
        errors: 0
      }
    }

    const itemResult = await processOneAgentInstanceReport(instance, item, new Date())
    return {
      matched: 1,
      ...itemResult
    }
  })))

  let trafficDelta = 0n
  for (const itemResult of itemResults) {
    result.matched += itemResult.matched
    result.statusUpdated += itemResult.statusUpdated
    result.trafficUpdated += itemResult.trafficUpdated
    result.skipped += itemResult.skipped
    result.errors += itemResult.errors
    trafficDelta += BigInt(itemResult.trafficDeltaBytes)
  }
  result.trafficDeltaBytes = trafficDelta.toString()

  return result
}
