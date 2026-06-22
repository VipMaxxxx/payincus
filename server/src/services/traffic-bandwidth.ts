import { THROTTLE_BANDWIDTH } from '../lib/incus/incus-traffic.js'

const MB_IN_BYTES = 1024n * 1024n

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

export function resolveTrafficBandwidthLimits(
  instance: TrafficBandwidthSource,
  options: { stripThrottleOverride?: boolean } = {}
): ResolvedTrafficBandwidthLimits {
  const planLimit = normalizePlanTrafficLimitSpeed(instance.packagePlan?.trafficLimitSpeed)
  if (planLimit) {
    return {
      incusIngress: planLimit,
      incusEgress: planLimit,
      dbIngress: planLimit,
      dbEgress: planLimit
    }
  }

  const stripThrottleOverride = options.stripThrottleOverride === true
  const configuredIngress = stripThrottleOverride && instance.limitsIngress === THROTTLE_BANDWIDTH
    ? null
    : instance.limitsIngress
  const configuredEgress = stripThrottleOverride && instance.limitsEgress === THROTTLE_BANDWIDTH
    ? null
    : instance.limitsEgress

  return {
    incusIngress: configuredIngress ?? instance.package?.limitsIngress ?? null,
    incusEgress: configuredEgress ?? instance.package?.limitsEgress ?? null,
    dbIngress: configuredIngress ?? null,
    dbEgress: configuredEgress ?? null
  }
}
