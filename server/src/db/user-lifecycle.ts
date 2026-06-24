import type {
  Prisma,
  RedeemCodeType,
  UserLifecycleActionType,
  UserLifecycleEventType,
  UserLifecycleTagKey
} from '@prisma/client'
import { prisma } from './prisma.js'
import { createRedeemCode } from './redeem-codes.js'
import { createLog } from './logs.js'
import { createInboxMessage } from './inbox.js'

const PAGE_SIZE_MAX = 100
const HIGH_VALUE_RECHARGE_THRESHOLD = 500
const EXPIRING_SOON_DAYS = 7
const CHURN_RISK_DAYS = 30

export const USER_LIFECYCLE_TAGS: Array<{ key: UserLifecycleTagKey; label: string; description: string }> = [
  { key: 'new_user', label: '新用户', description: '近 14 天注册，适合引导首次购买。' },
  { key: 'paid_user', label: '已付费', description: '已有成功充值或付费实例。' },
  { key: 'high_value', label: '高价值', description: `累计充值不低于 ¥${HIGH_VALUE_RECHARGE_THRESHOLD}。` },
  { key: 'expiring_soon', label: '即将到期', description: `${EXPIRING_SOON_DAYS} 天内有实例到期。` },
  { key: 'churn_risk', label: '流失风险', description: `${CHURN_RISK_DAYS} 天内无登录且无运行实例。` },
  { key: 'risk_flag', label: '异常风险', description: '人工标记的异常或需要关注用户。' }
]

const DEFAULT_SEGMENTS: Array<{
  key: string
  name: string
  description: string
  rule: Prisma.InputJsonObject
}> = [
  {
    key: 'new_users',
    name: '新注册用户',
    description: '近 14 天注册，尚未形成稳定购买行为。',
    rule: { kind: 'registered_within_days', days: 14 }
  },
  {
    key: 'paid_users',
    name: '已付费用户',
    description: '有成功充值或付费实例的用户。',
    rule: { kind: 'has_successful_recharge_or_paid_instance' }
  },
  {
    key: 'high_value',
    name: '高价值用户',
    description: `累计充值不低于 ¥${HIGH_VALUE_RECHARGE_THRESHOLD} 的用户。`,
    rule: { kind: 'total_recharge_gte', amount: HIGH_VALUE_RECHARGE_THRESHOLD }
  },
  {
    key: 'expiring_soon',
    name: '即将到期用户',
    description: `${EXPIRING_SOON_DAYS} 天内有实例到期。`,
    rule: { kind: 'instance_expires_within_days', days: EXPIRING_SOON_DAYS }
  },
  {
    key: 'churn_risk',
    name: '流失风险用户',
    description: `${CHURN_RISK_DAYS} 天内无登录且没有运行中实例。`,
    rule: { kind: 'no_login_days_and_no_running_instance', days: CHURN_RISK_DAYS }
  }
]

type Actor = { id: number; username: string }

interface UserMetric {
  totalRecharge: number
  totalConsume: number
  instanceCount: number
  runningInstances: number
  expiringSoonInstances: number
  earliestExpiry: string | null
  lastLoginAt: string | null
}

function clampPage(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : 1
}

function clampPageSize(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined
    ? Math.min(Math.max(value, 1), PAGE_SIZE_MAX)
    : 20
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const [name, domain] = email.split('@')
  if (!domain) return '***'
  const prefix = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2)
  return `${prefix}***@${domain}`
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value) || 0
}

async function ensureDefaultSegments(): Promise<void> {
  for (const segment of DEFAULT_SEGMENTS) {
    await prisma.userLifecycleSegmentRule.upsert({
      where: { key: segment.key },
      create: segment,
      update: {
        name: segment.name,
        description: segment.description,
        rule: segment.rule
      }
    })
  }
}

async function getMetricMaps(userIds: number[]): Promise<Map<number, UserMetric>> {
  const metrics = new Map<number, UserMetric>()
  for (const userId of userIds) {
    metrics.set(userId, {
      totalRecharge: 0,
      totalConsume: 0,
      instanceCount: 0,
      runningInstances: 0,
      expiringSoonInstances: 0,
      earliestExpiry: null,
      lastLoginAt: null
    })
  }

  if (userIds.length === 0) return metrics

  const now = new Date()
  const expiringBefore = addDays(EXPIRING_SOON_DAYS)

  const [rechargeRows, consumeRows, instances, lastLogins] = await Promise.all([
    prisma.rechargeRecord.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: 'completed' },
      _sum: { actualAmount: true, amount: true }
    }),
    prisma.balanceLog.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'consume' },
      _sum: { amount: true }
    }),
    prisma.instance.findMany({
      where: { userId: { in: userIds }, status: { not: 'deleted' } },
      select: { userId: true, status: true, expiresAt: true }
    }),
    prisma.loginRecord.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true }
    })
  ])

  for (const row of rechargeRows) {
    const metric = metrics.get(row.userId)
    if (metric) {
      metric.totalRecharge = roundMoney(toNumber(row._sum.actualAmount) || toNumber(row._sum.amount))
    }
  }

  for (const row of consumeRows) {
    const metric = metrics.get(row.userId)
    if (metric) {
      metric.totalConsume = roundMoney(Math.abs(toNumber(row._sum.amount)))
    }
  }

  for (const instance of instances) {
    const metric = metrics.get(instance.userId)
    if (!metric) continue
    metric.instanceCount += 1
    if (instance.status === 'running') metric.runningInstances += 1
    if (instance.expiresAt) {
      if (!metric.earliestExpiry || instance.expiresAt.toISOString() < metric.earliestExpiry) {
        metric.earliestExpiry = instance.expiresAt.toISOString()
      }
      if (instance.expiresAt >= now && instance.expiresAt <= expiringBefore) {
        metric.expiringSoonInstances += 1
      }
    }
  }

  for (const row of lastLogins) {
    const metric = metrics.get(row.userId)
    if (metric) {
      metric.lastLoginAt = row._max.createdAt?.toISOString() ?? null
    }
  }

  return metrics
}

async function recordLifecycleAction(data: {
  actionType: UserLifecycleActionType
  actor: Actor
  targetUserId?: number | null
  payload?: Prisma.InputJsonValue
  result?: Prisma.InputJsonValue
  message?: string | null
  status?: 'success' | 'failed'
}) {
  const action = await prisma.userLifecycleAction.create({
    data: {
      actionType: data.actionType,
      status: data.status ?? 'success',
      actorUserId: data.actor.id,
      actorUsername: data.actor.username,
      targetUserId: data.targetUserId ?? null,
      payload: data.payload ?? undefined,
      result: data.result ?? undefined,
      message: data.message ?? null
    }
  })

  await createLog(
    data.actor.id,
    'user_lifecycle',
    `user_lifecycle.${data.actionType}`,
    data.message ?? `执行用户生命周期动作 ${data.actionType}`,
    data.status ?? 'success'
  )

  return action
}

export async function listLifecycleTags() {
  return USER_LIFECYCLE_TAGS
}

export async function refreshLifecycleSegments() {
  await ensureDefaultSegments()

  const users = await prisma.user.findMany({
    select: { id: true, createdAt: true },
    where: { role: 'user' }
  })
  const userIds = users.map(user => user.id)
  const metrics = await getMetricMaps(userIds)
  const now = new Date()
  const newAfter = addDays(-14)
  const staleBefore = addDays(-CHURN_RISK_DAYS)

  const membershipByKey = new Map<string, Array<{ userId: number; snapshot: Prisma.InputJsonObject }>>()
  for (const segment of DEFAULT_SEGMENTS) {
    membershipByKey.set(segment.key, [])
  }

  for (const user of users) {
    const metric = metrics.get(user.id)
    if (!metric) continue

    if (user.createdAt >= newAfter) {
      membershipByKey.get('new_users')?.push({ userId: user.id, snapshot: { registeredAt: user.createdAt.toISOString() } })
    }
    if (metric.totalRecharge > 0 || metric.instanceCount > 0) {
      membershipByKey.get('paid_users')?.push({ userId: user.id, snapshot: metric as unknown as Prisma.InputJsonObject })
    }
    if (metric.totalRecharge >= HIGH_VALUE_RECHARGE_THRESHOLD) {
      membershipByKey.get('high_value')?.push({ userId: user.id, snapshot: { totalRecharge: metric.totalRecharge } })
    }
    if (metric.expiringSoonInstances > 0) {
      membershipByKey.get('expiring_soon')?.push({ userId: user.id, snapshot: metric as unknown as Prisma.InputJsonObject })
    }
    const lastLogin = metric.lastLoginAt ? new Date(metric.lastLoginAt) : null
    const stale = !lastLogin || lastLogin < staleBefore
    if (stale && metric.runningInstances === 0) {
      membershipByKey.get('churn_risk')?.push({ userId: user.id, snapshot: { lastLoginAt: metric.lastLoginAt, runningInstances: metric.runningInstances } })
    }
  }

  const rules = await prisma.userLifecycleSegmentRule.findMany({ where: { enabled: true } })
  for (const rule of rules) {
    const members = membershipByKey.get(rule.key) ?? []
    await prisma.$transaction([
      prisma.userLifecycleSegmentMember.deleteMany({ where: { segmentRuleId: rule.id } }),
      ...(members.length > 0
        ? [prisma.userLifecycleSegmentMember.createMany({
            data: members.map(member => ({
              segmentRuleId: rule.id,
              userId: member.userId,
              snapshot: member.snapshot
            })),
            skipDuplicates: true
          })]
        : [])
    ])
  }

  return { refreshedAt: now.toISOString(), segmentCount: rules.length }
}

export async function syncLifecycleEvents() {
  const [users, firstLogins, firstRecharges, firstPurchases, renewals, expiringInstances] = await Promise.all([
    prisma.user.findMany({ where: { role: 'user' }, select: { id: true, createdAt: true } }),
    prisma.loginRecord.groupBy({ by: ['userId'], _min: { createdAt: true } }),
    prisma.rechargeRecord.groupBy({ by: ['userId'], where: { status: 'completed' }, _min: { completedAt: true, createdAt: true } }),
    prisma.instance.groupBy({ by: ['userId'], where: { packagePlanId: { not: null } }, _min: { createdAt: true } }),
    prisma.instanceBillingRecord.groupBy({ by: ['userId'], where: { type: 'renew' }, _min: { createdAt: true } }),
    prisma.instance.findMany({
      where: { status: { not: 'deleted' }, expiresAt: { gte: new Date(), lte: addDays(EXPIRING_SOON_DAYS) } },
      select: { id: true, userId: true, expiresAt: true }
    })
  ])

  const events: Array<{
    userId: number
    eventType: UserLifecycleEventType
    eventKey: string
    sourceType?: string
    sourceId?: number
    occurredAt: Date
    metadata?: Prisma.InputJsonObject
  }> = []

  for (const user of users) {
    events.push({ userId: user.id, eventType: 'registered', eventKey: `${user.id}:registered:user:${user.id}`, sourceType: 'user', sourceId: user.id, occurredAt: user.createdAt })
  }
  for (const row of firstLogins) {
    if (row._min.createdAt) events.push({ userId: row.userId, eventType: 'first_login', eventKey: `${row.userId}:first_login`, sourceType: 'login_record', occurredAt: row._min.createdAt })
  }
  for (const row of firstRecharges) {
    const occurredAt = row._min.completedAt ?? row._min.createdAt
    if (occurredAt) events.push({ userId: row.userId, eventType: 'first_recharge', eventKey: `${row.userId}:first_recharge`, sourceType: 'recharge_record', occurredAt })
  }
  for (const row of firstPurchases) {
    if (row._min.createdAt) events.push({ userId: row.userId, eventType: 'first_purchase', eventKey: `${row.userId}:first_purchase`, sourceType: 'instance', occurredAt: row._min.createdAt })
  }
  for (const row of renewals) {
    if (row._min.createdAt) events.push({ userId: row.userId, eventType: 'renewed', eventKey: `${row.userId}:renewed:first`, sourceType: 'instance_billing_record', occurredAt: row._min.createdAt })
  }
  for (const instance of expiringInstances) {
    events.push({
      userId: instance.userId,
      eventType: 'expiring',
      eventKey: `${instance.userId}:expiring:instance:${instance.id}`,
      sourceType: 'instance',
      sourceId: instance.id,
      occurredAt: instance.expiresAt ?? new Date(),
      metadata: { instanceId: instance.id, expiresAt: instance.expiresAt?.toISOString() ?? null }
    })
  }

  for (const event of events) {
    await prisma.userLifecycleEvent.upsert({
      where: { eventKey: event.eventKey },
      create: event,
      update: {
        occurredAt: event.occurredAt,
        metadata: event.metadata ?? undefined
      }
    })
  }

  return { synced: events.length, syncedAt: new Date().toISOString() }
}

export async function getLifecycleOverview() {
  await refreshLifecycleSegments()

  const [totalUsers, activeUsers, tagRows, segmentRules, recentActions, expiringInstances] = await Promise.all([
    prisma.user.count({ where: { role: 'user' } }),
    prisma.user.count({ where: { role: 'user', status: 'active' } }),
    prisma.userLifecycleTag.groupBy({ by: ['tagKey'], where: { active: true }, _count: { _all: true } }),
    prisma.userLifecycleSegmentRule.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { id: 'asc' }
    }),
    prisma.userLifecycleAction.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.instance.count({ where: { status: { not: 'deleted' }, expiresAt: { gte: new Date(), lte: addDays(EXPIRING_SOON_DAYS) } } })
  ])

  return {
    totalUsers,
    activeUsers,
    expiringInstances,
    tags: USER_LIFECYCLE_TAGS.map(tag => ({
      ...tag,
      count: tagRows.find(row => row.tagKey === tag.key)?._count._all ?? 0
    })),
    segments: segmentRules.map(rule => ({
      id: rule.id,
      key: rule.key,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      count: rule._count.members,
      rule: rule.rule
    })),
    recentActions
  }
}

export async function listLifecycleUsers(options: {
  page?: number
  pageSize?: number
  search?: string
  tag?: string
  segment?: string
  minRecharge?: number
  maxRecharge?: number
  minInstances?: number
  maxInstances?: number
  registeredFrom?: Date
  registeredTo?: Date
  activeState?: 'active' | 'inactive'
}) {
  await ensureDefaultSegments()

  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const where: Prisma.UserWhereInput = { role: 'user' }

  if (options.search?.trim()) {
    const search = options.search.trim()
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      ...(/^\d+$/.test(search) ? [{ id: Number(search) }] : [])
    ]
  }
  if (options.registeredFrom || options.registeredTo) {
    where.createdAt = {
      ...(options.registeredFrom ? { gte: options.registeredFrom } : {}),
      ...(options.registeredTo ? { lte: options.registeredTo } : {})
    }
  }
  if (USER_LIFECYCLE_TAGS.some(tag => tag.key === options.tag)) {
    where.lifecycleTags = { some: { tagKey: options.tag as UserLifecycleTagKey, active: true } }
  }
  if (options.segment) {
    where.lifecycleSegmentMembers = { some: { segmentRule: { key: options.segment } } }
  }

  const candidates = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      createdAt: true,
      lifecycleTags: { where: { active: true }, select: { tagKey: true, note: true, assignedAt: true } },
      lifecycleSegmentMembers: { include: { segmentRule: { select: { key: true, name: true } } } }
    },
    orderBy: { createdAt: 'desc' },
    take: 1000
  })

  const metrics = await getMetricMaps(candidates.map(user => user.id))
  const filtered = candidates.filter(user => {
    const metric = metrics.get(user.id)
    if (!metric) return false
    if (options.minRecharge !== undefined && metric.totalRecharge < options.minRecharge) return false
    if (options.maxRecharge !== undefined && metric.totalRecharge > options.maxRecharge) return false
    if (options.minInstances !== undefined && metric.instanceCount < options.minInstances) return false
    if (options.maxInstances !== undefined && metric.instanceCount > options.maxInstances) return false
    if (options.activeState === 'active' && !metric.lastLoginAt && metric.runningInstances === 0) return false
    if (options.activeState === 'inactive' && (metric.lastLoginAt || metric.runningInstances > 0)) return false
    return true
  })

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  return {
    users: items.map(user => ({
      id: user.id,
      username: user.username,
      emailMasked: maskEmail(user.email),
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      metrics: metrics.get(user.id),
      tags: user.lifecycleTags,
      segments: user.lifecycleSegmentMembers.map(member => ({
        key: member.segmentRule.key,
        name: member.segmentRule.name,
        matchedAt: member.matchedAt.toISOString()
      }))
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  }
}

export async function getLifecycleUserSummary(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      createdAt: true,
      lifecycleTags: { orderBy: { assignedAt: 'desc' } },
      lifecycleSegmentMembers: { include: { segmentRule: true }, orderBy: { matchedAt: 'desc' } },
      lifecycleEvents: { orderBy: { occurredAt: 'desc' }, take: 30 },
      lifecycleActionsTargeted: { orderBy: { createdAt: 'desc' }, take: 30 }
    }
  })
  if (!user) return null

  const metrics = await getMetricMaps([user.id])
  const [tickets, openTickets, offers] = await Promise.all([
    prisma.ticket.count({ where: { userId } }),
    prisma.ticket.count({ where: { userId, status: { in: ['open', 'in_progress'] } } }),
    getUserLifecycleOffers(userId)
  ])

  return {
    id: user.id,
    username: user.username,
    emailMasked: maskEmail(user.email),
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    metrics: metrics.get(user.id),
    tickets: { total: tickets, open: openTickets },
    tags: user.lifecycleTags,
    segments: user.lifecycleSegmentMembers.map(member => ({
      key: member.segmentRule.key,
      name: member.segmentRule.name,
      matchedAt: member.matchedAt.toISOString(),
      snapshot: member.snapshot
    })),
    events: user.lifecycleEvents,
    actions: user.lifecycleActionsTargeted,
    offers
  }
}

export async function addLifecycleTag(userId: number, tagKey: UserLifecycleTagKey, actor: Actor, note?: string) {
  const tag = await prisma.userLifecycleTag.upsert({
    where: { userId_tagKey: { userId, tagKey } },
    create: {
      userId,
      tagKey,
      active: true,
      note: note ?? null,
      assignedByUserId: actor.id,
      assignedByUsername: actor.username
    },
    update: {
      active: true,
      note: note ?? null,
      assignedByUserId: actor.id,
      assignedByUsername: actor.username,
      assignedAt: new Date(),
      removedAt: null
    }
  })

  await recordLifecycleAction({
    actionType: 'add_tag',
    actor,
    targetUserId: userId,
    payload: { tagKey, note: note ?? null },
    result: { tagId: tag.id },
    message: `为用户 #${userId} 添加生命周期标签 ${tagKey}`
  })

  return tag
}

export async function removeLifecycleTag(userId: number, tagKey: UserLifecycleTagKey, actor: Actor) {
  const tag = await prisma.userLifecycleTag.update({
    where: { userId_tagKey: { userId, tagKey } },
    data: { active: false, removedAt: new Date() }
  })

  await recordLifecycleAction({
    actionType: 'remove_tag',
    actor,
    targetUserId: userId,
    payload: { tagKey },
    result: { tagId: tag.id },
    message: `移除用户 #${userId} 的生命周期标签 ${tagKey}`
  })

  return tag
}

export async function issueLifecycleRedeemCode(data: {
  userId: number
  hostId: number
  codeType: RedeemCodeType
  codeValue: number
  expiresInDays: number
  remark?: string
  actor: Actor
}) {
  const expiresAt = addDays(Math.min(Math.max(data.expiresInDays, 1), 365))
  const code = await createRedeemCode({
    hostId: data.hostId,
    createdById: data.actor.id,
    codeType: data.codeType,
    codeValue: data.codeValue,
    maxUses: 1,
    expiresAt,
    remark: data.remark ?? '生命周期运营定向发放',
    targetUserId: data.userId
  })

  await createInboxMessage({
    userId: data.userId,
    eventType: 'user_lifecycle_offer',
    title: '您有一张可用资源兑换码',
    content: `管理员为您发放了一张定向资源兑换码：${code.code}，请在有效期内使用。`,
    data: { redeemCodeId: code.id, expiresAt: expiresAt.toISOString() }
  })

  await recordLifecycleAction({
    actionType: 'issue_redeem_code',
    actor: data.actor,
    targetUserId: data.userId,
    payload: {
      hostId: data.hostId,
      codeType: data.codeType,
      codeValue: data.codeValue,
      expiresInDays: data.expiresInDays
    },
    result: { redeemCodeId: code.id, expiresAt: expiresAt.toISOString() },
    message: `为用户 #${data.userId} 发放定向资源兑换码`
  })

  return {
    id: code.id,
    code: code.code,
    expiresAt: expiresAt.toISOString()
  }
}

export async function sendLifecycleReminder(data: {
  userIds: number[]
  title: string
  content: string
  actor: Actor
}) {
  const userIds = Array.from(new Set(data.userIds.filter(id => Number.isSafeInteger(id) && id > 0))).slice(0, 100)
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, role: 'user' }, select: { id: true } })

  for (const user of users) {
    await createInboxMessage({
      userId: user.id,
      eventType: 'user_lifecycle_reminder',
      title: data.title,
      content: data.content,
      data: { source: 'admin_user_lifecycle' }
    })
    await recordLifecycleAction({
      actionType: 'send_reminder',
      actor: data.actor,
      targetUserId: user.id,
      payload: { title: data.title },
      message: `向用户 #${user.id} 发送生命周期提醒`
    })
  }

  return { sent: users.length }
}

export async function sendLifecycleReminderToSegment(data: {
  segmentKey: string
  title: string
  content: string
  actor: Actor
}) {
  const members = await prisma.userLifecycleSegmentMember.findMany({
    where: { segmentRule: { key: data.segmentKey } },
    select: { userId: true },
    take: 100
  })

  return sendLifecycleReminder({
    userIds: members.map(member => member.userId),
    title: data.title,
    content: data.content,
    actor: data.actor
  })
}

export async function getUserLifecycleOffers(userId: number) {
  const now = new Date()
  const codes = await prisma.redeemCode.findMany({
    where: {
      targetUserId: userId,
      enabled: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    select: {
      id: true,
      code: true,
      codeType: true,
      codeValue: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      remark: true,
      host: { select: { id: true, name: true } },
      usages: { where: { userId }, select: { id: true, usedAt: true }, take: 1 }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  })

  return codes.filter(code => code.usedCount < code.maxUses).map(code => ({
    id: code.id,
    code: code.code,
    codeType: code.codeType,
    codeValue: code.codeValue,
    expiresAt: code.expiresAt?.toISOString() ?? null,
    remark: code.remark,
    host: code.host,
    used: code.usages.length > 0,
    usedAt: code.usages[0]?.usedAt.toISOString() ?? null
  }))
}
