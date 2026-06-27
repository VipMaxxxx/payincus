import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { prisma } from '../db/prisma.js'
import { getIncusClientFromPool } from '../lib/incus/incus-pool.js'
import { restoreBandwidth } from '../lib/incus/incus-traffic.js'
import { stopInstance } from '../lib/incus/incus-instances.js'
import { createLog } from '../db/logs.js'
import { sendNotification } from '../lib/notifier.js'
import { restrictUserOrdersForRisk } from './user-order-restrictions.js'

const DEFAULT_SAMPLE_INTERVAL_MINUTES = 3
const MAX_SCORE = 100
const EVALUATION_CONCURRENCY = 8
let schedulerStarted = false

type RiskSeverity = 'low' | 'medium' | 'high' | 'critical'

interface QosTier {
  level: number
  bandwidthMbps: number
  score: number
}

interface RiskPolicy {
  id: number
  enabled: boolean
  bandwidthWindowMinutes: number
  bandwidthActiveMinutes: number
  bandwidthThresholdMbps: number
  cpuWindowMinutes: number
  cpuActiveMinutes: number
  cpuThresholdPercent: number
  ppsThreshold: number
  packetSmallRatioThreshold: number
  qosTiers: unknown
  scoreDecayPerHour: number
  orderRestrictScore: number
  autoSuspendScore: number
  autoSuspendEnabled: boolean
  accountOrderRestrictEnabled: boolean
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(value)))
}

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function parseQosTiers(value: unknown): QosTier[] {
  const raw = Array.isArray(value) ? value : []
  return raw
    .map((item): QosTier | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const level = Number(record.level)
      const bandwidthMbps = Number(record.bandwidthMbps)
      const score = Number(record.score)
      if (!Number.isInteger(level) || level <= 0) return null
      if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) return null
      if (!Number.isInteger(score) || score <= 0) return null
      return { level, bandwidthMbps, score }
    })
    .filter((item): item is QosTier => Boolean(item))
    .sort((a, b) => a.score - b.score)
}

function riskLevel(score: number): string {
  if (score >= 90) return 'critical'
  if (score >= 70) return 'high'
  if (score >= 50) return 'limited'
  if (score >= 30) return 'watch'
  return 'normal'
}

function severityForScore(score: number): RiskSeverity {
  if (score >= 90) return 'critical'
  if (score >= 70) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}

function getManualReason(value: string, fallback: string): string {
  const reason = value.trim()
  return reason || fallback
}

async function getDefaultPolicy(): Promise<RiskPolicy> {
  const policy = await prisma.resourceRiskPolicy.findFirst({
    orderBy: { id: 'asc' }
  })

  if (policy) return policy

  return prisma.resourceRiskPolicy.create({
    data: { name: '默认策略' }
  })
}

function sampleThresholdCount(minutes: number): number {
  return Math.max(1, Math.ceil(minutes / DEFAULT_SAMPLE_INTERVAL_MINUTES))
}

async function applyQosLimit(input: {
  instance: {
    id: number
    incusId: string
    limitsIngress: string | null
    limitsEgress: string | null
    host: {
      id: number
      url: string
      certPath: string | null
      keyPath: string | null
      status: string
    }
  }
  tier: QosTier
  state: {
    originalIngress: string | null
    originalEgress: string | null
  } | null
}): Promise<string | null> {
  if (input.instance.host.status !== 'online' || !input.instance.host.certPath || !input.instance.host.keyPath) {
    return null
  }

  const limit = `${input.tier.bandwidthMbps}Mbit`
  const client = await getIncusClientFromPool({
    id: input.instance.host.id,
    url: input.instance.host.url,
    certPath: input.instance.host.certPath,
    keyPath: input.instance.host.keyPath
  })

  await restoreBandwidth(client, input.instance.incusId, limit, limit)
  await prisma.instance.update({
    where: { id: input.instance.id },
    data: {
      limitsIngress: limit,
      limitsEgress: limit
    }
  })

  return limit
}

async function autoSuspendInstance(input: {
  instance: {
    id: number
    incusId: string
    name: string
    userId: number
    status: string
    host: {
      id: number
      url: string
      certPath: string | null
      keyPath: string | null
      status: string
    }
  }
  reason: string
}) {
  if (input.instance.status === 'suspended') return

  await prisma.instance.update({
    where: { id: input.instance.id },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy: null,
      suspendReason: input.reason,
      version: { increment: 1 }
    }
  })

  if (input.instance.host.status === 'online' && input.instance.host.certPath && input.instance.host.keyPath) {
    const client = await getIncusClientFromPool({
      id: input.instance.host.id,
      url: input.instance.host.url,
      certPath: input.instance.host.certPath,
      keyPath: input.instance.host.keyPath
    })
    await stopInstance(client, input.instance.incusId, true)
  }

  await sendNotification(input.instance.userId, 'instance_suspended', {
    instanceName: input.instance.name,
    suspendReason: input.reason
  }).catch((error) => {
    console.error('[ResourceRisk] Failed to send suspend notification:', error)
  })
}

export async function evaluateInstanceRisk(instanceId: number, policyInput?: RiskPolicy) {
  const policy = policyInput ?? await getDefaultPolicy()
  if (!policy.enabled) return null

  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          status: true,
          url: true,
          certPath: true,
          keyPath: true
        }
      },
      resourceRiskState: true
    }
  })

  if (!instance || instance.status === 'deleted') return null

  const now = new Date()
  const windowMinutes = Math.max(policy.bandwidthWindowMinutes, policy.cpuWindowMinutes)
  const samples = await prisma.instanceResourceSample.findMany({
    where: {
      instanceId,
      sampledAt: {
        gte: new Date(now.getTime() - windowMinutes * 60 * 1000)
      }
    },
    orderBy: { sampledAt: 'desc' },
    take: 500
  })

  const bandwidthHits = samples.filter(sample => decimalToNumber(sample.totalMbps) >= policy.bandwidthThresholdMbps)
  const cpuHits = samples.filter(sample => sample.cpuPercent !== null && decimalToNumber(sample.cpuPercent) >= policy.cpuThresholdPercent)
  const ppsHits = samples.filter(sample => decimalToNumber(sample.pps) >= policy.ppsThreshold)
  const smallPacketHits = samples.filter(sample => {
    const packets = Number(sample.totalPacketsDelta)
    if (packets <= 0) return false
    const averageBytes = Number(sample.totalBytesDelta) / packets
    return averageBytes > 0 && averageBytes <= 300 && decimalToNumber(sample.pps) >= policy.ppsThreshold * 0.5
  })

  const triggers: Array<{ type: string; message: string; delta: number; severity: RiskSeverity }> = []
  if (bandwidthHits.length >= sampleThresholdCount(policy.bandwidthActiveMinutes)) {
    triggers.push({
      type: 'bandwidth_sustained',
      message: `实例持续带宽超过 ${policy.bandwidthThresholdMbps} Mbps`,
      delta: 18,
      severity: 'medium'
    })
  }
  if (cpuHits.length >= sampleThresholdCount(policy.cpuActiveMinutes)) {
    triggers.push({
      type: 'cpu_sustained',
      message: `实例 CPU 持续超过 ${policy.cpuThresholdPercent}%`,
      delta: 15,
      severity: 'medium'
    })
  }
  if (ppsHits.length >= 3) {
    triggers.push({
      type: 'packet_anomaly',
      message: `实例 PPS 超过 ${policy.ppsThreshold}`,
      delta: 25,
      severity: 'high'
    })
  }
  if (smallPacketHits.length >= 3) {
    triggers.push({
      type: 'scan_suspected',
      message: '实例存在小包高频发包特征，疑似扫描或异常发包',
      delta: 25,
      severity: 'high'
    })
  }

  const previousScore = instance.resourceRiskState?.score ?? 0
  const lastEvaluatedAt = instance.resourceRiskState?.lastEvaluatedAt
  const elapsedHours = lastEvaluatedAt ? Math.max(0, (now.getTime() - lastEvaluatedAt.getTime()) / 3_600_000) : 0
  const decay = triggers.length === 0 ? Math.floor(elapsedHours * policy.scoreDecayPerHour) : 0
  const scoreDelta = triggers.reduce((sum, trigger) => sum + trigger.delta, 0)
  const nextScore = clampScore(previousScore + scoreDelta - decay)
  const nextLevel = riskLevel(nextScore)
  const qosTiers = parseQosTiers(policy.qosTiers)
  const targetTier = qosTiers.filter(tier => nextScore >= tier.score).at(-1) ?? null

  let actionTaken: string | null = null
  let bandwidthLimit: string | null = instance.resourceRiskState?.currentBandwidthLimit ?? null

  if (targetTier && targetTier.level > (instance.resourceRiskState?.qosLevel ?? 0)) {
    try {
      bandwidthLimit = await applyQosLimit({
        instance,
        tier: targetTier,
        state: instance.resourceRiskState
      })
      if (bandwidthLimit) {
        actionTaken = `qos_level_${targetTier.level}`
      }
    } catch (error) {
      console.error(`[ResourceRisk] Failed to apply QoS for instance ${instance.id}:`, error)
    }
  }

  const shouldRestrictOrders = policy.accountOrderRestrictEnabled && nextScore >= policy.orderRestrictScore
  const shouldAutoSuspend = policy.autoSuspendEnabled && nextScore >= policy.autoSuspendScore
  if (shouldAutoSuspend) {
    try {
      await autoSuspendInstance({
        instance,
        reason: 'resource_risk_auto_suspend'
      })
      actionTaken = actionTaken ? `${actionTaken},auto_suspend` : 'auto_suspend'
    } catch (error) {
      console.error(`[ResourceRisk] Failed to auto suspend instance ${instance.id}:`, error)
    }
  }

  const evidence = {
    sampleCount: samples.length,
    bandwidthHits: bandwidthHits.length,
    cpuHits: cpuHits.length,
    ppsHits: ppsHits.length,
    smallPacketHits: smallPacketHits.length,
    bandwidthThresholdMbps: policy.bandwidthThresholdMbps,
    cpuThresholdPercent: policy.cpuThresholdPercent,
    ppsThreshold: policy.ppsThreshold
  }

  const state = await prisma.instanceRiskState.upsert({
    where: { instanceId },
    update: {
      score: nextScore,
      level: nextLevel,
      status: shouldAutoSuspend ? 'suspended' : (targetTier ? 'qos_limited' : nextLevel),
      qosLevel: targetTier?.level ?? instance.resourceRiskState?.qosLevel ?? 0,
      currentBandwidthLimit: bandwidthLimit,
      originalIngress: instance.resourceRiskState?.originalIngress ?? instance.limitsIngress,
      originalEgress: instance.resourceRiskState?.originalEgress ?? instance.limitsEgress,
      lastEvaluatedAt: now,
      lastTriggeredAt: triggers.length > 0 ? now : undefined,
      reason: triggers.at(-1)?.message ?? instance.resourceRiskState?.reason ?? null,
      evidence
    },
    create: {
      instanceId,
      userId: instance.userId,
      hostId: instance.hostId,
      score: nextScore,
      level: nextLevel,
      status: shouldAutoSuspend ? 'suspended' : (targetTier ? 'qos_limited' : nextLevel),
      qosLevel: targetTier?.level ?? 0,
      currentBandwidthLimit: bandwidthLimit,
      originalIngress: instance.limitsIngress,
      originalEgress: instance.limitsEgress,
      lastEvaluatedAt: now,
      lastTriggeredAt: triggers.length > 0 ? now : null,
      reason: triggers.at(-1)?.message ?? null,
      evidence
    }
  })

  let latestEventId: number | null = null
  if (triggers.length > 0 || actionTaken || nextLevel !== (instance.resourceRiskState?.level ?? 'normal')) {
    const event = await prisma.instanceRiskEvent.create({
      data: {
        instanceId,
        userId: instance.userId,
        hostId: instance.hostId,
        type: triggers.at(-1)?.type ?? (actionTaken ? 'action_applied' : 'score_changed'),
        severity: triggers.at(-1)?.severity ?? severityForScore(nextScore),
        scoreDelta: nextScore - previousScore,
        scoreAfter: nextScore,
        actionTaken,
        message: triggers.map(trigger => trigger.message).join('；') || `实例风险分变更为 ${nextScore}`,
        evidence
      }
    })
    latestEventId = event.id
  }

  if (shouldRestrictOrders) {
    await restrictUserOrdersForRisk({
      userId: instance.userId,
      sourceInstanceId: instance.id,
      sourceRiskEventId: latestEventId,
      reason: `实例 ${instance.name} 触发高风险资源风控，需工单人工审核后恢复下单`
    })
  }

  return state
}

export async function releaseInstanceRisk(input: {
  instanceId: number
  actorUserId: number
  reason: string
}) {
  const state = await prisma.instanceRiskState.findUnique({
    where: { instanceId: input.instanceId },
    include: {
      instance: {
        include: {
          host: {
            select: { id: true, url: true, certPath: true, keyPath: true, status: true }
          }
        }
      }
    }
  })
  if (!state) return null

  if ((state.qosLevel > 0 || state.currentBandwidthLimit) && state.instance.host.status === 'online' && state.instance.host.certPath && state.instance.host.keyPath) {
    const client = await getIncusClientFromPool({
      id: state.instance.host.id,
      url: state.instance.host.url,
      certPath: state.instance.host.certPath,
      keyPath: state.instance.host.keyPath
    })
    await restoreBandwidth(client, state.instance.incusId, state.originalIngress, state.originalEgress)
    await prisma.instance.update({
      where: { id: state.instanceId },
      data: {
        limitsIngress: state.originalIngress,
        limitsEgress: state.originalEgress
      }
    })
  }

  const released = await prisma.instanceRiskState.update({
    where: { instanceId: input.instanceId },
    data: {
      score: 0,
      level: 'normal',
      status: 'normal',
      qosLevel: 0,
      currentBandwidthLimit: null,
      lastRecoveredAt: new Date(),
      reason: input.reason || '人工解除风控',
      evidence: {}
    }
  })

  await prisma.instanceRiskEvent.create({
    data: {
      instanceId: state.instanceId,
      userId: state.userId,
      hostId: state.hostId,
      type: 'manual_release',
      severity: 'low',
      scoreDelta: -state.score,
      scoreAfter: 0,
      actionTaken: 'release',
      message: input.reason || '管理员人工解除实例风控',
      evidence: { actorUserId: input.actorUserId }
    }
  })

  await createLog(input.actorUserId, 'instance', 'resource_risk.release', `Released resource risk for instance #${input.instanceId}`, 'success', { instanceId: input.instanceId })
  return released
}

export async function manualLimitInstanceRisk(input: {
  instanceId: number
  actorUserId: number
  bandwidthMbps: number
  reason: string
  restrictOrders?: boolean
}) {
  const reason = getManualReason(input.reason, '管理员人工限速')
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    include: {
      host: {
        select: { id: true, url: true, certPath: true, keyPath: true, status: true }
      },
      resourceRiskState: true
    }
  })
  if (!instance || instance.status === 'deleted') return null
  if (input.bandwidthMbps <= 0 || !Number.isFinite(input.bandwidthMbps)) {
    throw new Error('Invalid bandwidth limit')
  }

  const limit = `${Math.round(input.bandwidthMbps)}Mbit`
  if (instance.host.status === 'online' && instance.host.certPath && instance.host.keyPath) {
    const client = await getIncusClientFromPool({
      id: instance.host.id,
      url: instance.host.url,
      certPath: instance.host.certPath,
      keyPath: instance.host.keyPath
    })
    await restoreBandwidth(client, instance.incusId, limit, limit)
  }

  await prisma.instance.update({
    where: { id: instance.id },
    data: {
      limitsIngress: limit,
      limitsEgress: limit
    }
  })

  const previousScore = instance.resourceRiskState?.score ?? 0
  const nextScore = clampScore(Math.max(previousScore, 50))
  const evidence = {
    actorUserId: input.actorUserId,
    manualReason: reason,
    previousIngress: instance.limitsIngress,
    previousEgress: instance.limitsEgress,
    newBandwidthLimit: limit,
    restrictOrders: Boolean(input.restrictOrders)
  }

  const state = await prisma.instanceRiskState.upsert({
    where: { instanceId: instance.id },
    update: {
      score: nextScore,
      level: riskLevel(nextScore),
      status: 'manual_qos_limited',
      currentBandwidthLimit: limit,
      originalIngress: instance.resourceRiskState?.originalIngress ?? instance.limitsIngress,
      originalEgress: instance.resourceRiskState?.originalEgress ?? instance.limitsEgress,
      lastTriggeredAt: new Date(),
      reason,
      evidence
    },
    create: {
      instanceId: instance.id,
      userId: instance.userId,
      hostId: instance.hostId,
      score: nextScore,
      level: riskLevel(nextScore),
      status: 'manual_qos_limited',
      qosLevel: 0,
      currentBandwidthLimit: limit,
      originalIngress: instance.limitsIngress,
      originalEgress: instance.limitsEgress,
      lastTriggeredAt: new Date(),
      reason,
      evidence
    }
  })

  const event = await prisma.instanceRiskEvent.create({
    data: {
      instanceId: instance.id,
      userId: instance.userId,
      hostId: instance.hostId,
      type: 'manual_qos_limited',
      severity: 'medium',
      scoreDelta: nextScore - previousScore,
      scoreAfter: nextScore,
      actionTaken: 'manual_qos_limited',
      message: `管理员人工限速到 ${limit}：${reason}`,
      evidence
    }
  })

  if (input.restrictOrders) {
    await restrictUserOrdersForRisk({
      userId: instance.userId,
      sourceInstanceId: instance.id,
      sourceRiskEventId: event.id,
      reason: `实例 ${instance.name} 被人工资源风控限速，需工单人工审核后恢复下单`
    })
  }

  await createLog(input.actorUserId, 'instance', 'resource_risk.manual_qos', `Manually limited resource risk for instance #${input.instanceId} to ${limit}`, 'success', { instanceId: input.instanceId })
  return state
}

export async function manualSuspendInstanceRisk(input: {
  instanceId: number
  actorUserId: number
  reason: string
  restrictOrders?: boolean
  notifyUser?: boolean
}) {
  const reason = getManualReason(input.reason, '管理员人工资源风控封禁')
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    include: {
      host: {
        select: { id: true, name: true, url: true, certPath: true, keyPath: true, status: true }
      },
      resourceRiskState: true
    }
  })
  if (!instance || instance.status === 'deleted') return null

  const previousStatus = instance.status
  if (instance.status === 'running' && instance.host.status === 'online' && instance.host.certPath && instance.host.keyPath) {
    const client = await getIncusClientFromPool({
      id: instance.host.id,
      url: instance.host.url,
      certPath: instance.host.certPath,
      keyPath: instance.host.keyPath
    })
    await stopInstance(client, instance.incusId, true)
  }

  await prisma.instance.update({
    where: { id: instance.id },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy: input.actorUserId,
      suspendReason: reason,
      version: { increment: 1 }
    }
  })

  const previousScore = instance.resourceRiskState?.score ?? 0
  const nextScore = MAX_SCORE
  const evidence = {
    actorUserId: input.actorUserId,
    manualReason: reason,
    previousStatus,
    notifyUser: input.notifyUser !== false,
    restrictOrders: input.restrictOrders !== false
  }

  const state = await prisma.instanceRiskState.upsert({
    where: { instanceId: instance.id },
    update: {
      score: nextScore,
      level: 'critical',
      status: 'manual_suspended',
      lastTriggeredAt: new Date(),
      reason,
      evidence
    },
    create: {
      instanceId: instance.id,
      userId: instance.userId,
      hostId: instance.hostId,
      score: nextScore,
      level: 'critical',
      status: 'manual_suspended',
      qosLevel: 0,
      currentBandwidthLimit: instance.resourceRiskState?.currentBandwidthLimit ?? null,
      originalIngress: instance.resourceRiskState?.originalIngress ?? instance.limitsIngress,
      originalEgress: instance.resourceRiskState?.originalEgress ?? instance.limitsEgress,
      lastTriggeredAt: new Date(),
      reason,
      evidence
    }
  })

  const event = await prisma.instanceRiskEvent.create({
    data: {
      instanceId: instance.id,
      userId: instance.userId,
      hostId: instance.hostId,
      type: 'manual_suspend',
      severity: 'critical',
      scoreDelta: nextScore - previousScore,
      scoreAfter: nextScore,
      actionTaken: 'manual_suspend',
      message: `管理员人工封禁实例：${reason}`,
      evidence
    }
  })

  if (input.restrictOrders !== false) {
    await restrictUserOrdersForRisk({
      userId: instance.userId,
      sourceInstanceId: instance.id,
      sourceRiskEventId: event.id,
      reason: `实例 ${instance.name} 被人工资源风控封禁，需工单人工审核后恢复下单`
    })
  }

  if (input.notifyUser !== false) {
    await sendNotification(instance.userId, 'instance_suspended', {
      instanceName: instance.name,
      hostName: instance.host.name,
      suspendReason: reason
    }).catch((error) => {
      console.error('[ResourceRisk] Failed to send manual suspend notification:', error)
    })
  }

  await createLog(input.actorUserId, 'instance', 'resource_risk.manual_suspend', `Manually suspended resource risk instance #${input.instanceId}`, 'success', { instanceId: input.instanceId })
  return state
}

export async function manualUnsuspendInstanceRisk(input: {
  instanceId: number
  actorUserId: number
  reason: string
  notifyUser?: boolean
}) {
  const reason = getManualReason(input.reason, '管理员人工解除资源风控封禁')
  const state = await prisma.instanceRiskState.findUnique({
    where: { instanceId: input.instanceId },
    include: {
      instance: {
        include: {
          host: {
            select: { id: true, name: true, url: true, certPath: true, keyPath: true, status: true }
          }
        }
      }
    }
  })
  if (!state) return null

  const previousStatus = state.instance.status
  if (state.qosLevel > 0 || state.currentBandwidthLimit) {
    if (state.instance.host.status === 'online' && state.instance.host.certPath && state.instance.host.keyPath) {
      const client = await getIncusClientFromPool({
        id: state.instance.host.id,
        url: state.instance.host.url,
        certPath: state.instance.host.certPath,
        keyPath: state.instance.host.keyPath
      })
      await restoreBandwidth(client, state.instance.incusId, state.originalIngress, state.originalEgress)
    }
  }

  await prisma.instance.update({
    where: { id: state.instanceId },
    data: {
      status: previousStatus === 'suspended' ? 'stopped' : previousStatus,
      suspendedAt: null,
      suspendedBy: null,
      suspendReason: null,
      limitsIngress: state.originalIngress,
      limitsEgress: state.originalEgress,
      version: { increment: 1 }
    }
  })

  const released = await prisma.instanceRiskState.update({
    where: { instanceId: input.instanceId },
    data: {
      score: 0,
      level: 'normal',
      status: 'normal',
      qosLevel: 0,
      currentBandwidthLimit: null,
      lastRecoveredAt: new Date(),
      reason,
      evidence: {}
    }
  })

  await prisma.instanceRiskEvent.create({
    data: {
      instanceId: state.instanceId,
      userId: state.userId,
      hostId: state.hostId,
      type: 'manual_unsuspend',
      severity: 'low',
      scoreDelta: -state.score,
      scoreAfter: 0,
      actionTaken: 'manual_unsuspend',
      message: `管理员人工解除资源风控封禁：${reason}`,
      evidence: { actorUserId: input.actorUserId, previousStatus, notifyUser: input.notifyUser !== false }
    }
  })

  if (input.notifyUser !== false) {
    await sendNotification(state.userId, 'instance_unsuspended', {
      instanceName: state.instance.name,
      hostName: state.instance.host.name
    }).catch((error) => {
      console.error('[ResourceRisk] Failed to send manual unsuspend notification:', error)
    })
  }

  await createLog(input.actorUserId, 'instance', 'resource_risk.manual_unsuspend', `Manually unsuspended resource risk instance #${input.instanceId}`, 'success', { instanceId: input.instanceId })
  return released
}

export async function manualRestrictOrdersForInstanceRisk(input: {
  instanceId: number
  actorUserId: number
  reason: string
}) {
  const reason = getManualReason(input.reason, '管理员人工限制账号下单')
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    select: {
      id: true,
      name: true,
      userId: true,
      hostId: true
    }
  })
  if (!instance) return null

  const event = await prisma.instanceRiskEvent.create({
    data: {
      instanceId: instance.id,
      userId: instance.userId,
      hostId: instance.hostId,
      type: 'manual_order_restrict',
      severity: 'high',
      scoreDelta: 0,
      scoreAfter: 0,
      actionTaken: 'manual_order_restrict',
      message: `管理员人工限制账号下单：${reason}`,
      evidence: { actorUserId: input.actorUserId, manualReason: reason }
    }
  })

  const restriction = await restrictUserOrdersForRisk({
    userId: instance.userId,
    sourceInstanceId: instance.id,
    sourceRiskEventId: event.id,
    reason: `实例 ${instance.name} 被人工资源风控标记，需工单人工审核后恢复下单：${reason}`
  })

  await createLog(input.actorUserId, 'instance', 'resource_risk.manual_order_restrict', `Manually restricted orders from resource risk instance #${input.instanceId}`, 'success', { instanceId: input.instanceId })
  return restriction
}

export async function runResourceRiskJob(): Promise<void> {
  const policy = await getDefaultPolicy()
  if (!policy.enabled) return

  const instances = await prisma.instance.findMany({
    where: {
      status: { in: ['running', 'suspended'] }
    },
    select: { id: true }
  })

  const limit = pLimit(EVALUATION_CONCURRENCY)
  await Promise.all(instances.map(instance => limit(() => evaluateInstanceRisk(instance.id, policy))))

  await prisma.instanceResourceSample.deleteMany({
    where: {
      sampledAt: {
        lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      }
    }
  })
}

export function startResourceRiskScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  schedule('*/5 * * * *', () => {
    runResourceRiskJob().catch((error) => {
      console.error('[ResourceRisk] Scheduled job failed:', error)
    })
  })

  console.log('[ResourceRisk] Scheduler started')
  console.log('[ResourceRisk] - Instance risk evaluation: every 5 minutes')
}
