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

export function normalizePlanTrafficLimitSpeed(trafficLimitSpeed: string | null | undefined): string | null {
  if (!trafficLimitSpeed || trafficLimitSpeed === '0') {
    return null
  }

  if (/^\d+$/.test(trafficLimitSpeed)) {
    const bytes = BigInt(trafficLimitSpeed)
    const mbps = Number(bytes / MB_IN_BYTES)
    return mbps > 0 ? `${mbps}Mbit` : null
  }

  return trafficLimitSpeed
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
