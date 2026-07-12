import type { IncusClient } from '../lib/incus/incus-client.js'
import { prisma } from '../db/prisma.js'
import { getSystemConfig } from '../db/system-config.js'
import { withLock } from '../lib/distributed-lock.js'
import { getIncusClientFromPool } from '../lib/incus/incus-pool.js'
import { restoreBandwidth } from '../lib/incus/incus-traffic.js'

const MB_IN_BYTES = 1024n * 1024n
export const TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY = 'traffic_overage_throttle_speed'
export const DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED = '1Mbit'

interface TrafficBandwidthSource {
  limitsIngress: string | null
  limitsEgress: string | null
  package?: {
    limitsIngress: string | null
    limitsEgress: string | null
  } | null
  packagePlan?: {
    trafficLimitSpeed: string | null
  } | null
}

export interface ResolvedTrafficBandwidthLimits {
  incusIngress: string | null
  incusEgress: string | null
  dbIngress: string | null
  dbEgress: string | null
}

interface BandwidthArbitrationSource {
  trafficStatus: string
  package?: {
    limitsIngress: string | null
    limitsEgress: string | null
  } | null
  packagePlan?: {
    trafficLimitSpeed: string | null
  } | null
  resourceRiskState?: {
    currentBandwidthLimit: string | null
  } | null
}

export interface EffectiveBandwidth {
  ingress: string | null
  egress: string | null
}

/**
 * `trafficLimitSpeed` 是套餐正常线速（normal line speed），不是流量超量后的限速值。
 * 数据库列名保持不变；超量限速由 traffic_overage_throttle_speed 独立配置。
 */
export function normalizePlanTrafficLimitSpeed(trafficLimitSpeed: unknown): string | null | undefined {
  if (trafficLimitSpeed === null || trafficLimitSpeed === undefined || trafficLimitSpeed === '') {
    return null
  }

  if (typeof trafficLimitSpeed !== 'string') {
    return undefined
  }

  const trimmed = trafficLimitSpeed.trim()
  if (trimmed === '' || trimmed === '0') {
    return null
  }

  const unitMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(Mbit|Gbit)$/i)
  if (unitMatch) {
    const numeric = Number(unitMatch[1])
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return undefined
    }
    const multiplier = unitMatch[2].toLowerCase() === 'gbit' ? 1000 : 1
    const mbps = Math.round(numeric * multiplier)
    return mbps > 0 ? `${mbps}Mbit` : undefined
  }

  if (/^\d+$/.test(trimmed)) {
    const bytes = BigInt(trimmed)
    const mbps = bytes / MB_IN_BYTES
    return mbps > 0n ? `${mbps.toString()}Mbit` : null
  }

  return undefined
}

function bandwidthMbps(value: string | null | undefined): number | null {
  const normalized = normalizePlanTrafficLimitSpeed(value)
  if (!normalized) return null
  return Number(normalized.slice(0, -'Mbit'.length))
}

function mostRestrictiveBandwidth(...values: Array<string | null | undefined>): string | null {
  const candidates = values
    .map(value => bandwidthMbps(value))
    .filter((value): value is number => value !== null)
  if (candidates.length === 0) return null
  return `${Math.min(...candidates)}Mbit`
}

/**
 * 单一带宽仲裁点：配置线速、流量超量和资源风控三者取最严格值。
 * 正常线速只读取套餐/实例方案配置，绝不从当前实际 limits 字段捕获。
 */
export function computeEffectiveBandwidth(
  instance: BandwidthArbitrationSource,
  overageThrottleSpeed = DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED
): EffectiveBandwidth {
  const normalLineSpeed = normalizePlanTrafficLimitSpeed(instance.packagePlan?.trafficLimitSpeed)
  const baselineIngress = normalLineSpeed ?? instance.package?.limitsIngress ?? null
  const baselineEgress = normalLineSpeed ?? instance.package?.limitsEgress ?? null
  const trafficConstraint = instance.trafficStatus === 'LIMITED' ? overageThrottleSpeed : null
  const riskConstraint = instance.resourceRiskState?.currentBandwidthLimit ?? null

  return {
    ingress: mostRestrictiveBandwidth(baselineIngress, trafficConstraint, riskConstraint),
    egress: mostRestrictiveBandwidth(baselineEgress, trafficConstraint, riskConstraint)
  }
}

/** 按数据库中仍生效的约束重算并落地实际带宽。 */
export async function reconcileEffectiveBandwidth(instanceId: number, existingClient?: IncusClient): Promise<EffectiveBandwidth> {
  const locked = await withLock(`bandwidth:instance:${instanceId}`, async () => {
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        host: {
          select: { id: true, url: true, certPath: true, keyPath: true, status: true }
        },
        package: {
          select: { limitsIngress: true, limitsEgress: true }
        },
        packagePlan: {
          select: { trafficLimitSpeed: true }
        },
        resourceRiskState: {
          select: { currentBandwidthLimit: true }
        }
      }
    })
    if (!instance || instance.status === 'deleted') {
      throw new Error(`Instance ${instanceId} is unavailable for bandwidth arbitration`)
    }

    const configuredOverageThrottleSpeed = normalizePlanTrafficLimitSpeed(
      await getSystemConfig(TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY)
    ) ?? DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED
    const effective = computeEffectiveBandwidth(instance, configuredOverageThrottleSpeed)
    if (instance.host.status === 'online' && instance.host.certPath && instance.host.keyPath) {
      const client = existingClient ?? await getIncusClientFromPool({
        id: instance.host.id,
        url: instance.host.url,
        certPath: instance.host.certPath,
        keyPath: instance.host.keyPath
      })
      await restoreBandwidth(client, instance.incusId, effective.ingress, effective.egress)
    }

    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        limitsIngress: effective.ingress,
        limitsEgress: effective.egress
      }
    })
    return effective
  }, { expireMs: 30_000, waitTimeoutMs: 10_000, retryIntervalMs: 50 })

  if (!locked.success || !locked.result) {
    throw new Error(locked.error || `Failed to arbitrate bandwidth for instance ${instanceId}`)
  }
  return locked.result
}

export function resolveTrafficBandwidthLimits(
  instance: TrafficBandwidthSource,
  options: { stripThrottleOverride?: boolean; overageThrottleSpeed?: string } = {}
): ResolvedTrafficBandwidthLimits {
  const normalLineSpeed = normalizePlanTrafficLimitSpeed(instance.packagePlan?.trafficLimitSpeed)
  if (normalLineSpeed) {
    return {
      incusIngress: normalLineSpeed,
      incusEgress: normalLineSpeed,
      dbIngress: normalLineSpeed,
      dbEgress: normalLineSpeed
    }
  }

  const stripThrottleOverride = options.stripThrottleOverride === true
  const overageThrottleSpeed = options.overageThrottleSpeed ?? DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED
  const configuredIngress = stripThrottleOverride && instance.limitsIngress === overageThrottleSpeed
    ? null
    : instance.limitsIngress
  const configuredEgress = stripThrottleOverride && instance.limitsEgress === overageThrottleSpeed
    ? null
    : instance.limitsEgress

  return {
    incusIngress: configuredIngress ?? instance.package?.limitsIngress ?? null,
    incusEgress: configuredEgress ?? instance.package?.limitsEgress ?? null,
    dbIngress: configuredIngress ?? null,
    dbEgress: configuredEgress ?? null
  }
}
