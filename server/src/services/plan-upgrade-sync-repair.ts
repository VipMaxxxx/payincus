import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { getIncusClient, patchInstanceResources } from '../lib/incus/index.js'
import { restoreBandwidth } from '../lib/incus/incus-traffic.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'

const ACTIVE_CASE_STATUSES = ['pending_manual', 'auto_retryable', 'in_progress'] as const

type PlanSummary = {
  id: number
  name: string
  price?: unknown
  billingCycle?: number | null
}

export type PlanUpgradeSyncSource = 'user' | 'admin'

export interface RecordPlanUpgradeSyncFailureInput {
  source: PlanUpgradeSyncSource
  actorUserId: number
  instance: {
    id: number
    name: string
    userId: number
    hostId: number
    incusId: string
  }
  oldPlan: PlanSummary | null
  newPlan: PlanSummary & {
    cpu: number
    memory: number
    disk: number
  }
  target: {
    cpu: number
    memory: number
    disk: number
    ingress: string | null
    egress: string | null
  }
  priceDiff: number
  error: unknown
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return sanitizeTokensInString(raw).slice(0, 1000)
}

function planForDetail(plan: PlanSummary | null) {
  if (!plan) return null
  const price = plan.price === undefined || plan.price === null
    ? null
    : typeof plan.price === 'bigint'
      ? plan.price.toString()
      : typeof plan.price === 'number' || typeof plan.price === 'string' || typeof plan.price === 'boolean'
        ? plan.price
        : String(plan.price)
  return {
    id: plan.id,
    name: plan.name,
    price,
    billingCycle: plan.billingCycle ?? null
  }
}

export async function recordPlanUpgradeSyncFailure(input: RecordPlanUpgradeSyncFailureInput) {
  const lastError = safeErrorMessage(input.error)
  const detail = {
    source: input.source,
    actorUserId: input.actorUserId,
    incusId: input.instance.incusId,
    oldPlan: planForDetail(input.oldPlan),
    newPlan: planForDetail(input.newPlan),
    target: input.target,
    priceDiff: input.priceDiff,
    failedAt: new Date().toISOString()
  } satisfies Prisma.InputJsonObject

  const existing = await prisma.deliveryAssuranceCase.findFirst({
    where: {
      instanceId: input.instance.id,
      issueType: 'plan_upgrade_sync_failed',
      status: { in: [...ACTIVE_CASE_STATUSES] }
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })

  const title = `实例升级资源同步失败：${input.instance.name}`
  const data = {
    taskId: null,
    instanceId: input.instance.id,
    hostId: input.instance.hostId,
    userId: input.instance.userId,
    status: 'auto_retryable' as const,
    issueType: 'plan_upgrade_sync_failed' as const,
    severity: 'critical',
    retryable: true,
    title,
    lastError,
    detail
  }

  const deliveryCase = existing
    ? await prisma.deliveryAssuranceCase.update({
        where: { id: existing.id },
        data
      })
    : await prisma.deliveryAssuranceCase.create({ data })

  await prisma.deliveryAssuranceAction.create({
    data: {
      caseId: deliveryCase.id,
      actionType: 'detected',
      actorUserId: input.actorUserId,
      actorUsername: null,
      note: '套餐升级已写入数据库和账务，但 Incus 资源同步失败，等待后台重试或人工确认。',
      detail
    }
  })

  await createLog(
    input.actorUserId,
    'delivery',
    'delivery.plan_upgrade_sync_failed',
    `Recorded plan upgrade sync repair case #${deliveryCase.id} for instance #${input.instance.id}`,
    'warning',
    { instanceId: input.instance.id }
  )

  return deliveryCase
}

export async function retryPlanUpgradeSyncCase(
  caseId: number,
  actor: { id: number; username?: string | null },
  note?: string | null
) {
  const deliveryCase = await prisma.deliveryAssuranceCase.findUnique({
    where: { id: caseId }
  })
  if (!deliveryCase) {
    throw new Error('修复任务不存在')
  }
  if (deliveryCase.issueType !== 'plan_upgrade_sync_failed') {
    throw new Error('该交付保障问题不是实例升级同步修复任务')
  }
  if (deliveryCase.status === 'recovered' || deliveryCase.status === 'closed') {
    throw new Error('该修复任务已结束')
  }

  const instance = await prisma.instance.findUnique({
    where: { id: deliveryCase.instanceId },
    include: { host: true }
  })
  if (!instance || instance.status === 'deleted') {
    throw new Error('实例不存在或已删除')
  }
  if (!instance.host) {
    throw new Error('实例节点不存在，无法同步 Incus 配置')
  }

  await prisma.deliveryAssuranceCase.update({
    where: { id: deliveryCase.id },
    data: {
      status: 'in_progress',
      handledByUserId: actor.id,
      handledByUsername: actor.username ?? null,
      handledAt: new Date(),
      note: note || deliveryCase.note
    }
  })

  try {
    const client = await getIncusClient(instance.host)
    await patchInstanceResources(client, instance.incusId, {
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk
    })
    await restoreBandwidth(client, instance.incusId, instance.limitsIngress, instance.limitsEgress)

    const updated = await prisma.deliveryAssuranceCase.update({
      where: { id: deliveryCase.id },
      data: {
        status: 'recovered',
        lastError: null,
        retryable: false,
        handledByUserId: actor.id,
        handledByUsername: actor.username ?? null,
        handledAt: new Date(),
        note: note || deliveryCase.note
      }
    })

    await prisma.deliveryAssuranceAction.create({
      data: {
        caseId: deliveryCase.id,
        actionType: 'retry',
        actorUserId: actor.id,
        actorUsername: actor.username ?? null,
        note: note || null,
        detail: {
          result: 'success',
          target: {
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            ingress: instance.limitsIngress,
            egress: instance.limitsEgress
          }
        }
      }
    })
    await prisma.deliveryAssuranceAction.create({
      data: {
        caseId: deliveryCase.id,
        actionType: 'mark_recovered',
        actorUserId: actor.id,
        actorUsername: actor.username ?? null,
        note: note || null,
        detail: { result: 'plan_upgrade_sync_repaired' }
      }
    })
    await createLog(actor.id, 'delivery', 'delivery.plan_upgrade_sync_retry', `Retried plan upgrade sync case #${deliveryCase.id}`, 'success', {
      instanceId: instance.id
    })
    return updated
  } catch (error) {
    const lastError = safeErrorMessage(error)
    const updated = await prisma.deliveryAssuranceCase.update({
      where: { id: deliveryCase.id },
      data: {
        status: 'auto_retryable',
        lastError,
        retryable: true,
        handledByUserId: actor.id,
        handledByUsername: actor.username ?? null,
        handledAt: new Date(),
        note: note || deliveryCase.note
      }
    })
    await prisma.deliveryAssuranceAction.create({
      data: {
        caseId: deliveryCase.id,
        actionType: 'retry',
        actorUserId: actor.id,
        actorUsername: actor.username ?? null,
        note: note || null,
        detail: {
          result: 'failed',
          error: lastError
        }
      }
    })
    await createLog(actor.id, 'delivery', 'delivery.plan_upgrade_sync_retry_failed', `Plan upgrade sync case #${deliveryCase.id} retry failed`, 'failed', {
      instanceId: instance.id
    })
    const wrapped = new Error(lastError)
    ;(wrapped as Error & { deliveryCase?: typeof updated }).deliveryCase = updated
    throw wrapped
  }
}
