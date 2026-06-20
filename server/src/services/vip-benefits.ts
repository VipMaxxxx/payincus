import { Prisma, type VipBenefitClaim, type VipBenefitClaimStatus, type VipBenefitReward } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import {
  MAX_VIP_LEVEL,
  calculateUserVipLevelByMetric,
  getUserVipMetric,
  getUserVipStats,
  getVipBadgeStyleForLevel,
  getVipRules,
  type UserVipMetric,
  type UserVipStats,
  type VipBadgeStyle
} from './vip-levels.js'

type DbClient = Prisma.TransactionClient | typeof prisma

export type VipBenefitRewardTypeValue = 'balance' | 'points' | 'instance'
export type VipBenefitRewardState = 'claimable' | 'claimed' | 'locked' | 'blocked'

export interface VipBenefitRewardInput {
  level?: number
  type?: VipBenefitRewardTypeValue
  title?: string
  description?: string | null
  claimLimit?: number
  sortOrder?: number
  enabled?: boolean
  config?: Record<string, unknown> | null
}

export interface VipBenefitRewardConfig {
  amount?: number
  packageId?: number | null
  packageName?: string | null
  planId?: number | null
  planName?: string | null
  days?: number
  quantity?: number
}

export interface VipBenefitClaimView {
  id: number
  rewardId: number
  level: number
  status: VipBenefitClaimStatus
  claimNo: number
  snapshot: Record<string, unknown>
  deliveredAt: string | null
  createdAt: string
}

export interface VipBenefitRewardView {
  id: number
  level: number
  type: VipBenefitRewardTypeValue
  title: string
  description: string | null
  claimLimit: number
  sortOrder: number
  enabled: boolean
  config: VipBenefitRewardConfig
  createdAt: string
  updatedAt: string
  claimedCount: number
  remainingClaims: number
  state: VipBenefitRewardState
  blockedByLevel: number | null
  claims: VipBenefitClaimView[]
}

export interface VipBenefitAmountSummary {
  balanceAmount: number
  pointsAmount: number
  instanceQuantity: number
}

export interface VipBenefitOverview {
  currentLevel: number
  userVipMetric: UserVipMetric
  userStats: UserVipStats
  userVipBadgeStyle: VipBadgeStyle | null
  rewards: VipBenefitRewardView[]
  summary: {
    totalRewards: number
    unlockedRewards: number
    claimableRewards: number
    claimedRewards: number
    lockedRewards: number
    blockedRewards: number
    pendingRewards: number
    entitlement: VipBenefitAmountSummary
    remaining: VipBenefitAmountSummary
  }
}

const REWARD_TYPES = new Set<VipBenefitRewardTypeValue>(['balance', 'points', 'instance'])
const MAX_MONEY_AMOUNT = 99999999.99
const MAX_POINTS_AMOUNT = 1000000000
const MAX_CLAIM_LIMIT = 100
const MAX_SORT_ORDER = 1000000
const MAX_INSTANCE_DAYS = 3650
const MAX_INSTANCE_QUANTITY = 10
const MAX_TITLE_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 300
const MAX_BULK_CLAIMS = 1000

export class VipBenefitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message)
  }
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeLevel(value: unknown): number {
  const level = Number(value)
  if (!Number.isInteger(level) || level < 1 || level > MAX_VIP_LEVEL) {
    throw new VipBenefitError('INVALID_LEVEL', `VIP level must be between 1 and ${MAX_VIP_LEVEL}`)
  }
  return level
}

function normalizeRewardType(value: unknown): VipBenefitRewardTypeValue {
  if (typeof value === 'string' && REWARD_TYPES.has(value as VipBenefitRewardTypeValue)) {
    return value as VipBenefitRewardTypeValue
  }
  throw new VipBenefitError('INVALID_REWARD_TYPE', 'Invalid VIP benefit reward type')
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new VipBenefitError('INVALID_TITLE', 'Reward title is required')
  }
  const title = value.trim()
  if (!title) {
    throw new VipBenefitError('INVALID_TITLE', 'Reward title is required')
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new VipBenefitError('INVALID_TITLE', `Reward title cannot exceed ${MAX_TITLE_LENGTH} characters`)
  }
  return title
}

function normalizeDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const description = value.trim()
  if (!description) return null
  return description.slice(0, MAX_DESCRIPTION_LENGTH)
}

function normalizePositiveInteger(value: unknown, field: string, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new VipBenefitError('INVALID_NUMBER', `${field} must be an integer between 1 and ${max}`)
  }
  return parsed
}

function normalizeOptionalPositiveInteger(value: unknown, fallback: number, field: string, max: number): number {
  if (value === null || value === undefined || value === '') return fallback
  return normalizePositiveInteger(value, field, max)
}

function normalizeMoney(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_MONEY_AMOUNT) {
    throw new VipBenefitError('INVALID_AMOUNT', `${field} must be between 0.01 and ${MAX_MONEY_AMOUNT}`)
  }
  return roundMoney(parsed)
}

function normalizeSortOrder(value: unknown): number {
  const parsed = Number(value ?? 0)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SORT_ORDER) {
    throw new VipBenefitError('INVALID_SORT_ORDER', `Sort order must be an integer between 0 and ${MAX_SORT_ORDER}`)
  }
  return parsed
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 100) : null
}

function normalizeRewardConfig(type: VipBenefitRewardTypeValue, value: unknown): VipBenefitRewardConfig {
  const config = getRecord(value)
  if (type === 'balance') {
    return { amount: normalizeMoney(config.amount, 'Balance reward amount') }
  }
  if (type === 'points') {
    return { amount: normalizePositiveInteger(config.amount, 'Points reward amount', MAX_POINTS_AMOUNT) }
  }

  return {
    packageId: normalizePositiveInteger(config.packageId, 'Package ID', 2147483647),
    packageName: normalizeLabel(config.packageName),
    planId: normalizePositiveInteger(config.planId, 'Plan ID', 2147483647),
    planName: normalizeLabel(config.planName),
    days: normalizeOptionalPositiveInteger(config.days, 30, 'Instance reward days', MAX_INSTANCE_DAYS),
    quantity: normalizeOptionalPositiveInteger(config.quantity, 1, 'Instance reward quantity', MAX_INSTANCE_QUANTITY)
  }
}

function normalizeStoredRewardConfig(type: VipBenefitRewardTypeValue, value: unknown): VipBenefitRewardConfig {
  const config = getRecord(value)
  if (type === 'balance') {
    return { amount: roundMoney(Math.max(0, toNumber(config.amount))) }
  }
  if (type === 'points') {
    return { amount: Math.max(0, Math.floor(toNumber(config.amount))) }
  }
  return {
    packageId: Number.isInteger(Number(config.packageId)) ? Number(config.packageId) : null,
    packageName: normalizeLabel(config.packageName),
    planId: Number.isInteger(Number(config.planId)) ? Number(config.planId) : null,
    planName: normalizeLabel(config.planName),
    days: Math.max(1, Math.min(MAX_INSTANCE_DAYS, Math.floor(toNumber(config.days) || 30))),
    quantity: Math.max(1, Math.min(MAX_INSTANCE_QUANTITY, Math.floor(toNumber(config.quantity) || 1)))
  }
}

async function validateInstanceConfig(config: VipBenefitRewardConfig, client: DbClient = prisma): Promise<VipBenefitRewardConfig> {
  const packageId = config.packageId
  const planId = config.planId
  if (!packageId || !planId) {
    throw new VipBenefitError('INVALID_INSTANCE_REWARD', 'Instance reward requires a package and plan')
  }

  const [pkg, plan] = await Promise.all([
    client.package.findFirst({
      where: {
        id: packageId,
        active: true
      },
      select: {
        id: true,
        name: true
      }
    }),
    client.packagePlan.findFirst({
      where: {
        id: planId,
        packageId,
        isActive: true
      },
      select: {
        id: true,
        name: true
      }
    })
  ])

  if (!pkg) {
    throw new VipBenefitError('INVALID_INSTANCE_REWARD', 'Selected package does not exist or is disabled')
  }
  if (!plan) {
    throw new VipBenefitError('INVALID_INSTANCE_REWARD', 'Selected plan does not exist, is disabled, or does not belong to the package')
  }

  return {
    ...config,
    packageId,
    packageName: config.packageName || pkg.name,
    planId,
    planName: config.planName || plan.name
  }
}

async function normalizeRewardData(
  input: VipBenefitRewardInput,
  base?: VipBenefitReward
): Promise<{
  level: number
  type: VipBenefitRewardTypeValue
  title: string
  description: string | null
  claimLimit: number
  sortOrder: number
  enabled: boolean
  config: VipBenefitRewardConfig
}> {
  const type = normalizeRewardType(input.type ?? base?.type)
  const rawConfig = input.config !== undefined ? input.config : base?.config
  let config = normalizeRewardConfig(type, rawConfig)
  if (type === 'instance') {
    config = await validateInstanceConfig(config)
  }

  return {
    level: normalizeLevel(input.level ?? base?.level),
    type,
    title: normalizeTitle(input.title ?? base?.title),
    description: normalizeDescription(input.description ?? base?.description),
    claimLimit: normalizeOptionalPositiveInteger(input.claimLimit ?? base?.claimLimit, 1, 'Claim limit', MAX_CLAIM_LIMIT),
    sortOrder: normalizeSortOrder(input.sortOrder ?? base?.sortOrder ?? 0),
    enabled: input.enabled === undefined ? (base?.enabled ?? true) : input.enabled === true,
    config
  }
}

function claimToView(claim: VipBenefitClaim): VipBenefitClaimView {
  return {
    id: claim.id,
    rewardId: claim.rewardId,
    level: claim.level,
    status: claim.status,
    claimNo: claim.claimNo,
    snapshot: getRecord(claim.snapshot),
    deliveredAt: claim.deliveredAt ? claim.deliveredAt.toISOString() : null,
    createdAt: claim.createdAt.toISOString()
  }
}

function rewardToAdminView(reward: VipBenefitReward): VipBenefitRewardView {
  return {
    id: reward.id,
    level: reward.level,
    type: reward.type as VipBenefitRewardTypeValue,
    title: reward.title,
    description: reward.description,
    claimLimit: reward.claimLimit,
    sortOrder: reward.sortOrder,
    enabled: reward.enabled,
    config: normalizeStoredRewardConfig(reward.type as VipBenefitRewardTypeValue, reward.config),
    createdAt: reward.createdAt.toISOString(),
    updatedAt: reward.updatedAt.toISOString(),
    claimedCount: 0,
    remainingClaims: reward.claimLimit,
    state: 'locked',
    blockedByLevel: null,
    claims: []
  }
}

function addRewardAmount(summary: VipBenefitAmountSummary, reward: VipBenefitRewardView, multiplier: number): void {
  if (multiplier <= 0) return
  const amount = toNumber(reward.config.amount)
  if (reward.type === 'balance') {
    summary.balanceAmount = roundMoney(summary.balanceAmount + amount * multiplier)
  } else if (reward.type === 'points') {
    summary.pointsAmount += Math.floor(amount) * multiplier
  } else if (reward.type === 'instance') {
    summary.instanceQuantity += Math.max(1, Math.floor(toNumber(reward.config.quantity) || 1)) * multiplier
  }
}

async function getCurrentUserVip(userId: number, client: DbClient = prisma): Promise<{
  level: number
  metric: UserVipMetric
  stats: UserVipStats
  badgeStyle: VipBadgeStyle | null
}> {
  const metric = await getUserVipMetric()
  const [rules, stats] = await Promise.all([
    getVipRules('user', client),
    getUserVipStats(userId, client)
  ])
  const level = calculateUserVipLevelByMetric(rules, stats, metric)
  return {
    level,
    metric,
    stats,
    badgeStyle: getVipBadgeStyleForLevel(rules, 'user', level)
  }
}

export async function listAdminVipBenefitRewards(): Promise<VipBenefitRewardView[]> {
  const rewards = await prisma.vipBenefitReward.findMany({
    orderBy: [
      { level: 'asc' },
      { sortOrder: 'asc' },
      { id: 'asc' }
    ]
  })
  return rewards.map(rewardToAdminView)
}

export async function createVipBenefitReward(input: VipBenefitRewardInput): Promise<VipBenefitRewardView> {
  const data = await normalizeRewardData(input)
  const reward = await prisma.vipBenefitReward.create({
    data: {
      ...data,
      config: data.config as Prisma.InputJsonObject
    }
  })
  return rewardToAdminView(reward)
}

export async function updateVipBenefitReward(id: number, input: VipBenefitRewardInput): Promise<VipBenefitRewardView> {
  const existing = await prisma.vipBenefitReward.findUnique({ where: { id } })
  if (!existing) {
    throw new VipBenefitError('REWARD_NOT_FOUND', 'VIP benefit reward not found', 404)
  }

  const data = await normalizeRewardData(input, existing)
  const reward = await prisma.vipBenefitReward.update({
    where: { id },
    data: {
      ...data,
      config: data.config as Prisma.InputJsonObject
    }
  })
  return rewardToAdminView(reward)
}

export async function deleteVipBenefitReward(id: number): Promise<void> {
  try {
    await prisma.vipBenefitReward.delete({ where: { id } })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      throw new VipBenefitError('REWARD_NOT_FOUND', 'VIP benefit reward not found', 404)
    }
    throw error
  }
}

export async function getVipBenefitOverview(userId: number): Promise<VipBenefitOverview> {
  const [vip, rewards, claims] = await Promise.all([
    getCurrentUserVip(userId),
    prisma.vipBenefitReward.findMany({
      where: { enabled: true },
      orderBy: [
        { level: 'asc' },
        { sortOrder: 'asc' },
        { id: 'asc' }
      ]
    }),
    prisma.vipBenefitClaim.findMany({
      where: { userId },
      orderBy: [
        { level: 'asc' },
        { rewardId: 'asc' },
        { claimNo: 'asc' }
      ]
    })
  ])

  const claimsByReward = new Map<number, VipBenefitClaim[]>()
  for (const claim of claims) {
    const list = claimsByReward.get(claim.rewardId) || []
    list.push(claim)
    claimsByReward.set(claim.rewardId, list)
  }

  const outstandingLevels = new Set<number>()
  const baseViews = rewards.map((reward) => {
    const rewardClaims = claimsByReward.get(reward.id) || []
    const claimedCount = rewardClaims.length
    const remainingClaims = Math.max(0, reward.claimLimit - claimedCount)
    if (reward.level <= vip.level && remainingClaims > 0) {
      outstandingLevels.add(reward.level)
    }
    return {
      reward,
      claimedCount,
      remainingClaims,
      claims: rewardClaims
    }
  })

  const rewardViews: VipBenefitRewardView[] = baseViews.map((item) => {
    const type = item.reward.type as VipBenefitRewardTypeValue
    const lowerOutstanding = Array.from(outstandingLevels)
      .filter(level => level < item.reward.level)
      .sort((a, b) => a - b)[0] ?? null
    const state: VipBenefitRewardState = item.remainingClaims <= 0
      ? 'claimed'
      : item.reward.level > vip.level
        ? 'locked'
        : lowerOutstanding
          ? 'blocked'
          : 'claimable'

    return {
      id: item.reward.id,
      level: item.reward.level,
      type,
      title: item.reward.title,
      description: item.reward.description,
      claimLimit: item.reward.claimLimit,
      sortOrder: item.reward.sortOrder,
      enabled: item.reward.enabled,
      config: normalizeStoredRewardConfig(type, item.reward.config),
      createdAt: item.reward.createdAt.toISOString(),
      updatedAt: item.reward.updatedAt.toISOString(),
      claimedCount: item.claimedCount,
      remainingClaims: item.remainingClaims,
      state,
      blockedByLevel: state === 'blocked' ? lowerOutstanding : null,
      claims: item.claims.map(claimToView)
    }
  })

  const entitlement: VipBenefitAmountSummary = { balanceAmount: 0, pointsAmount: 0, instanceQuantity: 0 }
  const remaining: VipBenefitAmountSummary = { balanceAmount: 0, pointsAmount: 0, instanceQuantity: 0 }
  for (const reward of rewardViews) {
    if (reward.level <= vip.level) {
      addRewardAmount(entitlement, reward, reward.claimLimit)
      addRewardAmount(remaining, reward, reward.remainingClaims)
    }
  }

  return {
    currentLevel: vip.level,
    userVipMetric: vip.metric,
    userStats: vip.stats,
    userVipBadgeStyle: vip.badgeStyle,
    rewards: rewardViews,
    summary: {
      totalRewards: rewardViews.length,
      unlockedRewards: rewardViews.filter(reward => reward.level <= vip.level).length,
      claimableRewards: rewardViews.filter(reward => reward.state === 'claimable').length,
      claimedRewards: rewardViews.filter(reward => reward.state === 'claimed').length,
      lockedRewards: rewardViews.filter(reward => reward.state === 'locked').length,
      blockedRewards: rewardViews.filter(reward => reward.state === 'blocked').length,
      pendingRewards: claims.filter(claim => claim.status === 'pending').length,
      entitlement,
      remaining
    }
  }
}

function buildClaimSnapshot(reward: VipBenefitReward, config: VipBenefitRewardConfig): Prisma.InputJsonObject {
  return {
    rewardId: reward.id,
    level: reward.level,
    type: reward.type,
    title: reward.title,
    description: reward.description,
    claimLimit: reward.claimLimit,
    config: config as Prisma.InputJsonObject
  }
}

function getDeliveryStatus(type: VipBenefitRewardTypeValue): VipBenefitClaimStatus {
  return type === 'instance' ? 'pending' : 'delivered'
}

export async function claimVipBenefitReward(userId: number, rewardId: number): Promise<{
  claim: VipBenefitClaimView
  overview: VipBenefitOverview
}> {
  const parsedRewardId = Number(rewardId)
  if (!Number.isInteger(parsedRewardId) || parsedRewardId <= 0) {
    throw new VipBenefitError('INVALID_REWARD_ID', 'Invalid VIP benefit reward ID')
  }

  let createdClaim: VipBenefitClaim | null = null
  try {
    createdClaim = await prisma.$transaction(async (tx) => {
      const vip = await getCurrentUserVip(userId, tx)
      const reward = await tx.vipBenefitReward.findFirst({
        where: {
          id: parsedRewardId,
          enabled: true
        }
      })

      if (!reward) {
        throw new VipBenefitError('REWARD_NOT_FOUND', 'VIP benefit reward not found', 404)
      }
      if (reward.level > vip.level) {
        throw new VipBenefitError('VIP_LEVEL_REQUIRED', `VIP${reward.level} is required to claim this reward`, 403)
      }

      const lowerRewards = await tx.vipBenefitReward.findMany({
        where: {
          enabled: true,
          level: {
            lt: reward.level,
            lte: vip.level
          }
        },
        orderBy: [
          { level: 'asc' },
          { sortOrder: 'asc' },
          { id: 'asc' }
        ]
      })

      const rewardIdsToCheck = [...lowerRewards.map(item => item.id), reward.id]
      const relevantClaims = await tx.vipBenefitClaim.findMany({
        where: {
          userId,
          rewardId: { in: rewardIdsToCheck }
        },
        select: {
          rewardId: true
        }
      })
      const claimCounts = new Map<number, number>()
      for (const claim of relevantClaims) {
        claimCounts.set(claim.rewardId, (claimCounts.get(claim.rewardId) || 0) + 1)
      }

      const blockingReward = lowerRewards.find(item => (claimCounts.get(item.id) || 0) < item.claimLimit)
      if (blockingReward) {
        throw new VipBenefitError(
          'LOWER_LEVEL_REWARD_REQUIRED',
          `Please claim all VIP${blockingReward.level} rewards first`,
          409
        )
      }

      const existingCount = claimCounts.get(reward.id) || 0
      if (existingCount >= reward.claimLimit) {
        throw new VipBenefitError('CLAIM_LIMIT_REACHED', 'This VIP benefit reward has already been fully claimed', 409)
      }

      const type = reward.type as VipBenefitRewardTypeValue
      const config = normalizeStoredRewardConfig(type, reward.config)
      const claim = await tx.vipBenefitClaim.create({
        data: {
          userId,
          rewardId: reward.id,
          level: reward.level,
          status: getDeliveryStatus(type),
          claimNo: existingCount + 1,
          snapshot: buildClaimSnapshot(reward, config),
          deliveredAt: type === 'instance' ? null : new Date()
        }
      })

      if (type === 'balance') {
        const amount = normalizeMoney(config.amount, 'Balance reward amount')
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true }
        })
        if (!user) {
          throw new VipBenefitError('USER_NOT_FOUND', 'User not found', 404)
        }
        const balanceBefore = toNumber(user.balance)
        const balanceAfter = roundMoney(balanceBefore + amount)
        await tx.user.update({
          where: { id: userId },
          data: { balance: balanceAfter }
        })
        await tx.balanceLog.create({
          data: {
            userId,
            type: 'gift',
            amount,
            balanceBefore,
            balanceAfter,
            remark: `VIP benefit: ${reward.title}`
          }
        })
      } else if (type === 'points') {
        const amount = normalizePositiveInteger(config.amount, 'Points reward amount', MAX_POINTS_AMOUNT)
        const userPoints = await tx.userPoints.upsert({
          where: { userId },
          update: {},
          create: { userId }
        })
        const updatedPoints = await tx.userPoints.update({
          where: { userId },
          data: {
            points: { increment: amount },
            totalEarned: { increment: amount }
          }
        })
        await tx.pointsLog.create({
          data: {
            userId,
            type: 'vip_benefit',
            amount,
            pointsBefore: userPoints.points,
            pointsAfter: updatedPoints.points,
            relatedId: claim.id,
            remark: `VIP benefit: ${reward.title}`
          }
        })
      }

      return claim
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new VipBenefitError('CLAIM_CONFLICT', 'This VIP benefit reward was already claimed, please refresh and try again', 409)
    }
    throw error
  }

  return {
    claim: claimToView(createdClaim),
    overview: await getVipBenefitOverview(userId)
  }
}

export async function claimAllAvailableVipBenefitRewards(userId: number): Promise<{
  claims: VipBenefitClaimView[]
  overview: VipBenefitOverview
}> {
  const claims: VipBenefitClaimView[] = []
  let overview = await getVipBenefitOverview(userId)

  for (let attempt = 0; attempt < MAX_BULK_CLAIMS; attempt++) {
    const nextReward = overview.rewards
      .filter(reward => reward.state === 'claimable')
      .sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder || a.id - b.id)[0]

    if (!nextReward) {
      return { claims, overview }
    }

    const result = await claimVipBenefitReward(userId, nextReward.id)
    claims.push(result.claim)
    overview = result.overview
  }

  throw new VipBenefitError('BULK_CLAIM_LIMIT_EXCEEDED', 'Too many VIP benefit rewards to claim at once', 409)
}
