import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'

const BYTES_PER_TB = 1024 ** 4
const MAX_COST = 100000000
const LOW_CAPACITY_WARNING_RATIO = 0.75
const LOW_CAPACITY_CRITICAL_RATIO = 0.9
const MIN_PLAN_SLOTS = 0

type AlertSeverity = 'warning' | 'critical'

interface HostCapacitySnapshot {
  cpuTotal: number
  cpuUsed: number
  cpuAvailable: number
  cpuUsageRatio: number
  memoryTotal: number
  memoryUsed: number
  memoryAvailable: number
  memoryUsageRatio: number
  diskTotal: number
  diskUsed: number
  diskAvailable: number
  diskUsageRatio: number
  natPortTotal: number
  natPortUsed: number
  natPortAvailable: number
  natPortUsageRatio: number
  instanceCount: number
  trafficUsedBytes: string
}

interface CapacityAlert {
  key: string
  severity: AlertSeverity
  objectType: 'host' | 'package_plan'
  objectId: number
  title: string
  message: string
}

const CAPACITY_SLA_RULE_CODE = 'capacity.host_pressure'

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Prisma.Decimal) return value.toNumber()
  return Number.parseFloat(String(value)) || 0
}

function toMoney(value: unknown): number {
  return Math.round(toNumber(value) * 100) / 100
}

function usageRatio(used: number, total: number): number {
  if (total <= 0) return used > 0 ? 1 : 0
  return Math.min(Math.max(used / total, 0), 1)
}

function positiveAvailable(total: number, used: number): number {
  return Math.max(total - used, 0)
}

function getNatPortTotal(host: { natPortStart: number | null; natPortEnd: number | null }): number {
  if (!host.natPortStart || !host.natPortEnd || host.natPortEnd < host.natPortStart) return 0
  return host.natPortEnd - host.natPortStart + 1
}

function getDiskTotalMb(host: { storageSize: number }): number {
  return Math.max((host.storageSize || 0) * 1024, 0)
}

function getTodayDateOnly(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function normalizeCostInput(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_COST) {
    throw apiError(ErrorCode.INVALID_PARAMS, `${field} 必须是 0-${MAX_COST} 之间的数字`)
  }
  return Math.round(parsed * 100) / 100
}

function normalizeNotes(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.INVALID_PARAMS, '成本备注无效')
  }
  const trimmed = value.trim()
  if (trimmed.length > 500) {
    throw apiError(ErrorCode.INVALID_PARAMS, '成本备注不能超过 500 个字符')
  }
  return trimmed || null
}

function buildHostCapacity(host: {
  cpuAllowanceMax: number
  cpuUsed: number
  memoryMax: number
  memoryUsed: number
  storageSize: number
  diskUsed: number
  natPortStart: number | null
  natPortEnd: number | null
  natPortsUsedCount: number
  instances: Array<{ monthlyTrafficUsed: bigint }>
}): HostCapacitySnapshot {
  const cpuTotal = Math.max(host.cpuAllowanceMax || 0, 0)
  const cpuUsed = Math.max(host.cpuUsed || 0, 0)
  const memoryTotal = Math.max(host.memoryMax || 0, 0)
  const memoryUsed = Math.max(host.memoryUsed || 0, 0)
  const diskTotal = getDiskTotalMb(host)
  const diskUsed = Math.max(host.diskUsed || 0, 0)
  const natPortTotal = getNatPortTotal(host)
  const natPortUsed = Math.max(host.natPortsUsedCount || 0, 0)
  const trafficUsed = host.instances.reduce((sum, instance) => sum + (instance.monthlyTrafficUsed || 0n), 0n)

  return {
    cpuTotal,
    cpuUsed,
    cpuAvailable: positiveAvailable(cpuTotal, cpuUsed),
    cpuUsageRatio: usageRatio(cpuUsed, cpuTotal),
    memoryTotal,
    memoryUsed,
    memoryAvailable: positiveAvailable(memoryTotal, memoryUsed),
    memoryUsageRatio: usageRatio(memoryUsed, memoryTotal),
    diskTotal,
    diskUsed,
    diskAvailable: positiveAvailable(diskTotal, diskUsed),
    diskUsageRatio: usageRatio(diskUsed, diskTotal),
    natPortTotal,
    natPortUsed,
    natPortAvailable: positiveAvailable(natPortTotal, natPortUsed),
    natPortUsageRatio: usageRatio(natPortUsed, natPortTotal),
    instanceCount: host.instances.length,
    trafficUsedBytes: trafficUsed.toString()
  }
}

function estimatePlanSlots(plan: { cpu: number; memory: number; disk: number; portLimit: number }, capacity: HostCapacitySnapshot): number {
  const slots = [
    plan.cpu > 0 ? Math.floor(capacity.cpuAvailable / plan.cpu) : Number.POSITIVE_INFINITY,
    plan.memory > 0 ? Math.floor(capacity.memoryAvailable / plan.memory) : Number.POSITIVE_INFINITY,
    plan.disk > 0 ? Math.floor(capacity.diskAvailable / plan.disk) : Number.POSITIVE_INFINITY,
    plan.portLimit > 0 && capacity.natPortTotal > 0 ? Math.floor(capacity.natPortAvailable / plan.portLimit) : Number.POSITIVE_INFINITY
  ]
  const finiteSlots = slots.filter(Number.isFinite)
  if (finiteSlots.length === 0) return MIN_PLAN_SLOTS
  return Math.max(Math.min(...finiteSlots), MIN_PLAN_SLOTS)
}

function estimatePlanMonthlyCost(
  plan: { cpu: number; memory: number; disk: number; trafficLimit: bigint },
  host: {
    cpuAllowanceMax: number
    memoryMax: number
    storageSize: number
    costProfile: { monthlyCost: Prisma.Decimal; ipv4MonthlyCost: Prisma.Decimal; trafficTbCost: Prisma.Decimal } | null
  }
): number {
  const profile = host.costProfile
  if (!profile) return 0

  const monthlyCost = toMoney(profile.monthlyCost)
  const cpuShare = host.cpuAllowanceMax > 0 ? plan.cpu / host.cpuAllowanceMax : 0
  const memoryShare = host.memoryMax > 0 ? plan.memory / host.memoryMax : 0
  const diskShare = getDiskTotalMb(host) > 0 ? plan.disk / getDiskTotalMb(host) : 0
  const weightedShare = (cpuShare + memoryShare + diskShare) / 3
  const resourceCost = monthlyCost * Math.max(weightedShare, 0)
  const trafficCost = Number(plan.trafficLimit || 0n) > 0
    ? (Number(plan.trafficLimit) / BYTES_PER_TB) * toMoney(profile.trafficTbCost)
    : 0

  return toMoney(resourceCost + trafficCost + toMoney(profile.ipv4MonthlyCost))
}

function pushUsageAlert(
  alerts: CapacityAlert[],
  key: string,
  ratio: number,
  objectType: 'host' | 'package_plan',
  objectId: number,
  title: string,
  message: string
): void {
  if (ratio >= LOW_CAPACITY_CRITICAL_RATIO) {
    alerts.push({ key, severity: 'critical', objectType, objectId, title, message })
  } else if (ratio >= LOW_CAPACITY_WARNING_RATIO) {
    alerts.push({ key, severity: 'warning', objectType, objectId, title, message })
  }
}

async function syncHostCapacityAlertsToSla(alerts: CapacityAlert[]): Promise<void> {
  const hostAlerts = alerts.filter(alert => alert.objectType === 'host')
  if (hostAlerts.length === 0) return

  const rule = await prisma.slaAlertRule.upsert({
    where: { code: CAPACITY_SLA_RULE_CODE },
    update: {},
    create: {
      code: CAPACITY_SLA_RULE_CODE,
      module: 'capacity',
      title: 'Host 容量压力',
      description: 'Host CPU、内存、磁盘或 NAT 端口水位过高时触发。',
      severity: 'warning',
      dedupeMinutes: 30
    }
  })

  if (!rule.enabled) return
  const now = new Date()
  if (rule.silenceUntil && rule.silenceUntil > now) return

  await Promise.all(hostAlerts.map(async alert => {
    const existing = await prisma.slaAlertEvent.findUnique({
      where: {
        ruleCode_fingerprint: {
          ruleCode: CAPACITY_SLA_RULE_CODE,
          fingerprint: alert.key
        }
      }
    })

    const data = {
      module: 'capacity',
      severity: alert.severity,
      objectType: 'host' as const,
      objectId: alert.objectId,
      objectLabel: alert.title.replace(/ (CPU|内存|磁盘|NAT 端口) 余量不足$/, ''),
      title: alert.title,
      message: alert.message,
      detail: {
        source: 'capacity-cost-overview',
        capacityAlertKey: alert.key
      },
      lastTriggeredAt: now
    }

    if (!existing) {
      const created = await prisma.slaAlertEvent.create({
        data: {
          ruleCode: CAPACITY_SLA_RULE_CODE,
          fingerprint: alert.key,
          status: 'open',
          ...data
        }
      })
      await prisma.slaAlertAction.create({
        data: {
          eventId: created.id,
          actionType: 'detected',
          detail: { ruleCode: CAPACITY_SLA_RULE_CODE, source: 'capacity-cost-overview' }
        }
      })
      return
    }

    if (existing.status === 'ignored') return
    const updated = await prisma.slaAlertEvent.update({
      where: { id: existing.id },
      data: {
        ...data,
        status: existing.status === 'recovered' ? 'open' : existing.status,
        recoveredAt: existing.status === 'recovered' ? null : existing.recoveredAt,
        triggerCount: { increment: 1 }
      }
    })
    await prisma.slaAlertAction.create({
      data: {
        eventId: updated.id,
        actionType: 'merged',
        detail: { ruleCode: CAPACITY_SLA_RULE_CODE, source: 'capacity-cost-overview', triggerCount: updated.triggerCount }
      }
    })
  }))
}

export default async function adminCapacityCostRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async () => {
    const today = getTodayDateOnly()
    const hosts = await prisma.host.findMany({
      orderBy: { id: 'asc' },
      include: {
        costProfile: true,
        instances: {
          where: { status: { not: 'deleted' } },
          select: { id: true, packagePlanId: true, monthlyTrafficUsed: true }
        },
        packageHosts: {
          include: {
            package: {
              include: {
                plans: {
                  where: { isActive: true },
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    _count: {
                      select: {
                        instances: { where: { status: { not: 'deleted' } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })

    const hostViews = hosts.map(host => {
      const capacity = buildHostCapacity(host)
      return {
        id: host.id,
        name: host.name,
        location: host.location,
        countryCode: host.countryCode,
        status: host.status,
        instanceType: host.instanceType,
        capacity,
        costProfile: host.costProfile
          ? {
              monthlyCost: toMoney(host.costProfile.monthlyCost),
              ipv4MonthlyCost: toMoney(host.costProfile.ipv4MonthlyCost),
              trafficTbCost: toMoney(host.costProfile.trafficTbCost),
              currency: host.costProfile.currency,
              notes: host.costProfile.notes,
              updatedAt: host.costProfile.updatedAt
            }
          : {
              monthlyCost: 0,
              ipv4MonthlyCost: 0,
              trafficTbCost: 0,
              currency: 'CNY',
              notes: null,
              updatedAt: null
            }
      }
    })

    await Promise.all(hostViews.map(host =>
      prisma.capacitySnapshot.upsert({
        where: {
          hostId_capturedDate: {
            hostId: host.id,
            capturedDate: today
          }
        },
        create: {
          hostId: host.id,
          capturedDate: today,
          cpuTotal: host.capacity.cpuTotal,
          cpuUsed: host.capacity.cpuUsed,
          memoryTotal: host.capacity.memoryTotal,
          memoryUsed: host.capacity.memoryUsed,
          diskTotal: host.capacity.diskTotal,
          diskUsed: host.capacity.diskUsed,
          natPortTotal: host.capacity.natPortTotal,
          natPortUsed: host.capacity.natPortUsed,
          instanceCount: host.capacity.instanceCount,
          trafficUsedBytes: BigInt(host.capacity.trafficUsedBytes)
        },
        update: {
          cpuTotal: host.capacity.cpuTotal,
          cpuUsed: host.capacity.cpuUsed,
          memoryTotal: host.capacity.memoryTotal,
          memoryUsed: host.capacity.memoryUsed,
          diskTotal: host.capacity.diskTotal,
          diskUsed: host.capacity.diskUsed,
          natPortTotal: host.capacity.natPortTotal,
          natPortUsed: host.capacity.natPortUsed,
          instanceCount: host.capacity.instanceCount,
          trafficUsedBytes: BigInt(host.capacity.trafficUsedBytes)
        }
      })
    ))

    const packagePlanMap = new Map<number, {
      packageId: number
      packageName: string
      planId: number
      planName: string
      price: number
      billingCycle: number
      revenueMonthly: number
      estimatedCostMonthlyValues: number[]
      availableSlots: number
      soldCount: number
    }>()

    const alerts: CapacityAlert[] = []
    const hostCapacityMap = new Map(hostViews.map(host => [host.id, host.capacity]))

    for (const host of hosts) {
      const capacity = hostCapacityMap.get(host.id)
      if (!capacity) continue
      pushUsageAlert(alerts, `host:${host.id}:cpu`, capacity.cpuUsageRatio, 'host', host.id, `${host.name} CPU 余量不足`, `CPU 使用率 ${(capacity.cpuUsageRatio * 100).toFixed(1)}%`)
      pushUsageAlert(alerts, `host:${host.id}:memory`, capacity.memoryUsageRatio, 'host', host.id, `${host.name} 内存余量不足`, `内存使用率 ${(capacity.memoryUsageRatio * 100).toFixed(1)}%`)
      pushUsageAlert(alerts, `host:${host.id}:disk`, capacity.diskUsageRatio, 'host', host.id, `${host.name} 磁盘余量不足`, `磁盘使用率 ${(capacity.diskUsageRatio * 100).toFixed(1)}%`)
      pushUsageAlert(alerts, `host:${host.id}:ports`, capacity.natPortUsageRatio, 'host', host.id, `${host.name} NAT 端口余量不足`, `端口使用率 ${(capacity.natPortUsageRatio * 100).toFixed(1)}%`)

      for (const binding of host.packageHosts) {
        for (const plan of binding.package.plans) {
          const existing = packagePlanMap.get(plan.id)
          const monthlyRevenue = toMoney(plan.price) / Math.max(plan.billingCycle || 1, 1)
          const slots = estimatePlanSlots(plan, capacity)
          const cost = estimatePlanMonthlyCost(plan, host)
          if (existing) {
            existing.estimatedCostMonthlyValues.push(cost)
            existing.availableSlots += slots
          } else {
            packagePlanMap.set(plan.id, {
              packageId: binding.package.id,
              packageName: binding.package.name,
              planId: plan.id,
              planName: plan.name,
              price: toMoney(plan.price),
              billingCycle: plan.billingCycle,
              revenueMonthly: toMoney(monthlyRevenue),
              estimatedCostMonthlyValues: [cost],
              availableSlots: slots,
              soldCount: plan._count.instances
            })
          }
        }
      }
    }

    const plans = Array.from(packagePlanMap.values()).map(plan => {
      const estimatedCostMonthly = plan.estimatedCostMonthlyValues.length > 0
        ? toMoney(plan.estimatedCostMonthlyValues.reduce((sum, value) => sum + value, 0) / plan.estimatedCostMonthlyValues.length)
        : 0
      const estimatedMarginMonthly = toMoney(plan.revenueMonthly - estimatedCostMonthly)
      const marginRatio = plan.revenueMonthly > 0 ? Math.round((estimatedMarginMonthly / plan.revenueMonthly) * 10000) / 10000 : 0
      if (estimatedMarginMonthly < 0) {
        alerts.push({
          key: `plan:${plan.planId}:negative-margin`,
          severity: 'warning',
          objectType: 'package_plan',
          objectId: plan.planId,
          title: `${plan.packageName} / ${plan.planName} 预计亏损`,
          message: `月收入 ¥${plan.revenueMonthly.toFixed(2)}，预计成本 ¥${estimatedCostMonthly.toFixed(2)}`
        })
      }
      if (plan.availableSlots <= 0) {
        alerts.push({
          key: `plan:${plan.planId}:sold-out-risk`,
          severity: 'critical',
          objectType: 'package_plan',
          objectId: plan.planId,
          title: `${plan.packageName} / ${plan.planName} 可售余量为 0`,
          message: '所有绑定 Host 的当前余量都不足以承载此方案'
        })
      }
      return {
        ...plan,
        estimatedCostMonthly,
        estimatedMarginMonthly,
        marginRatio
      }
    }).sort((a, b) => a.estimatedMarginMonthly - b.estimatedMarginMonthly)

    await syncHostCapacityAlertsToSla(alerts)

    const snapshotStart = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
    const snapshots = await prisma.capacitySnapshot.findMany({
      where: { capturedDate: { gte: snapshotStart } },
      orderBy: [{ capturedDate: 'asc' }, { hostId: 'asc' }]
    })
    const trendMap = new Map<string, { label: string; instanceCount: number; cpuUsed: number; memoryUsed: number; diskUsed: number; trafficUsedBytes: bigint }>()
    for (const snapshot of snapshots) {
      const label = snapshot.capturedDate.toISOString().slice(0, 10)
      const row = trendMap.get(label) || { label, instanceCount: 0, cpuUsed: 0, memoryUsed: 0, diskUsed: 0, trafficUsedBytes: 0n }
      row.instanceCount += snapshot.instanceCount
      row.cpuUsed += snapshot.cpuUsed
      row.memoryUsed += snapshot.memoryUsed
      row.diskUsed += snapshot.diskUsed
      row.trafficUsedBytes += snapshot.trafficUsedBytes
      trendMap.set(label, row)
    }

    const totals = hostViews.reduce((acc, host) => {
      acc.cpuTotal += host.capacity.cpuTotal
      acc.cpuUsed += host.capacity.cpuUsed
      acc.memoryTotal += host.capacity.memoryTotal
      acc.memoryUsed += host.capacity.memoryUsed
      acc.diskTotal += host.capacity.diskTotal
      acc.diskUsed += host.capacity.diskUsed
      acc.natPortTotal += host.capacity.natPortTotal
      acc.natPortUsed += host.capacity.natPortUsed
      acc.instanceCount += host.capacity.instanceCount
      acc.monthlyCost += host.costProfile.monthlyCost
      return acc
    }, {
      cpuTotal: 0,
      cpuUsed: 0,
      memoryTotal: 0,
      memoryUsed: 0,
      diskTotal: 0,
      diskUsed: 0,
      natPortTotal: 0,
      natPortUsed: 0,
      instanceCount: 0,
      monthlyCost: 0
    })

    return {
      totals: {
        ...totals,
        cpuAvailable: positiveAvailable(totals.cpuTotal, totals.cpuUsed),
        memoryAvailable: positiveAvailable(totals.memoryTotal, totals.memoryUsed),
        diskAvailable: positiveAvailable(totals.diskTotal, totals.diskUsed),
        natPortAvailable: positiveAvailable(totals.natPortTotal, totals.natPortUsed),
        cpuUsageRatio: usageRatio(totals.cpuUsed, totals.cpuTotal),
        memoryUsageRatio: usageRatio(totals.memoryUsed, totals.memoryTotal),
        diskUsageRatio: usageRatio(totals.diskUsed, totals.diskTotal),
        natPortUsageRatio: usageRatio(totals.natPortUsed, totals.natPortTotal)
      },
      hosts: hostViews,
      plans,
      alerts: alerts.sort((a, b) => a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1).slice(0, 50),
      trends: Array.from(trendMap.values()).map(row => ({
        ...row,
        trafficUsedBytes: row.trafficUsedBytes.toString()
      }))
    }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      monthlyCost?: unknown
      ipv4MonthlyCost?: unknown
      trafficTbCost?: unknown
      notes?: unknown
    }
  }>('/hosts/:id/cost-profile', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const hostId = Number(request.params.id)
    if (!Number.isSafeInteger(hostId) || hostId <= 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, name: true } })
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const body = request.body || {}
    const notes = normalizeNotes(body.notes)
    const data: {
      monthlyCost?: number
      ipv4MonthlyCost?: number
      trafficTbCost?: number
      notes?: string | null
      updatedByUserId: number
    } = {
      updatedByUserId: request.user.id
    }

    if (body.monthlyCost !== undefined) data.monthlyCost = normalizeCostInput(body.monthlyCost, '宿主机月成本')
    if (body.ipv4MonthlyCost !== undefined) data.ipv4MonthlyCost = normalizeCostInput(body.ipv4MonthlyCost, 'IPv4 月成本')
    if (body.trafficTbCost !== undefined) data.trafficTbCost = normalizeCostInput(body.trafficTbCost, '每 TB 流量成本')
    if (notes !== undefined) data.notes = notes

    const profile = await prisma.hostCostProfile.upsert({
      where: { hostId },
      create: {
        hostId,
        monthlyCost: data.monthlyCost ?? 0,
        ipv4MonthlyCost: data.ipv4MonthlyCost ?? 0,
        trafficTbCost: data.trafficTbCost ?? 0,
        notes: data.notes ?? null,
        updatedByUserId: data.updatedByUserId
      },
      update: data
    })

    await createLog(
      request.user.id,
      'capacity',
      'capacity.cost_profile.update',
      `Updated capacity cost profile for host "${host.name}"`,
      'success'
    )

    return {
      hostId,
      monthlyCost: toMoney(profile.monthlyCost),
      ipv4MonthlyCost: toMoney(profile.ipv4MonthlyCost),
      trafficTbCost: toMoney(profile.trafficTbCost),
      currency: profile.currency,
      notes: profile.notes,
      updatedAt: profile.updatedAt
    }
  })
}
