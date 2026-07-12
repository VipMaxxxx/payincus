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
import {
  USER_BALANCE_LOCK_NAMESPACE,
  USER_POINTS_LOCK_NAMESPACE,
  USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE,
  advisoryTransactionLock,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'

type DbClient = Prisma.TransactionClient | typeof prisma

export type VipBenefitRewardTypeValue = 'balance' | 'points' | 'instance'
export type VipBenefitRewardState = 'claimable' | 'claimed' | 'locked' | 'blocked'

export const VIP_BENEFITS_CONFIG_KEY = 'vip_benefits_config'
export const MAX_VIP_BENEFIT_PERCENT = 100
export const MAX_CONTINUOUS_VIP_LEVEL = 5

export interface VipContinuousBenefitLevel {
  orderDiscountPercent: number
  extraTrafficPercent: number
  resourcePoolBonusPercent: number
}

export interface VipContinuousBenefitsConfig {
  levels: Record<string, VipContinuousBenefitLevel>
}

export const DEFAULT_VIP_BENEFITS_CONFIG: VipContinuousBenefitsConfig = {
  levels: {
    '1': { orderDiscountPercent: 1, extraTrafficPercent: 2, resourcePoolBonusPercent: 2 },
    '2': { orderDiscountPercent: 2, extraTrafficPercent: 4, resourcePoolBonusPercent: 4 },
    '3': { orderDiscountPercent: 3, extraTrafficPercent: 6, resourcePoolBonusPercent: 6 },
    '4': { orderDiscountPercent: 4, extraTrafficPercent: 8, resourcePoolBonusPercent: 8 },
    '5': { orderDiscountPercent: 5, extraTrafficPercent: 10, resourcePoolBonusPercent: 10 }
  }
}

export const DEFAULT_VIP_BENEFITS_CONFIG_JSON = JSON.stringify(DEFAULT_VIP_BENEFITS_CONFIG)

function normalizeBenefitPercent(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_VIP_BENEFIT_PERCENT) {
    throw new VipBenefitError(
      'INVALID_CONTINUOUS_BENEFIT_CONFIG',
      `${field} must be between 0 and ${MAX_VIP_BENEFIT_PERCENT}`
    )
  }
  return Math.round(value * 100) / 100
}

export function normalizeVipBenefitsConfig(value: unknown): VipContinuousBenefitsConfig {
  const input = getRecord(value)
  const levels = getRecord(input.levels)
  const normalized: Record<string, VipContinuousBenefitLevel> = {}

  for (let level = 1; level <= MAX_CONTINUOUS_VIP_LEVEL; level++) {
    const levelConfig = getRecord(levels[String(level)])
    normalized[String(level)] = {
      orderDiscountPercent: normalizeBenefitPercent(levelConfig.orderDiscountPercent, `VIP${level} order discount`),
      extraTrafficPercent: normalizeBenefitPercent(levelConfig.extraTrafficPercent, `VIP${level} extra traffic`),
      resourcePoolBonusPercent: normalizeBenefitPercent(levelConfig.resourcePoolBonusPercent, `VIP${level} resource pool bonus`)
    }
  }

  return { levels: normalized }
}

export function parseVipBenefitsConfigJson(value: string | null | undefined): VipContinuousBenefitsConfig {
  if (!value) return DEFAULT_VIP_BENEFITS_CONFIG
  try {
    return normalizeVipBenefitsConfig(JSON.parse(value))
  } catch {
    return DEFAULT_VIP_BENEFITS_CONFIG
  }
}

export async function getVipBenefitsConfig(client: DbClient = prisma): Promise<VipContinuousBenefitsConfig> {
  const config = await client.systemConfig.findUnique({
    where: { key: VIP_BENEFITS_CONFIG_KEY },
    select: { value: true }
  })
  return parseVipBenefitsConfigJson(config?.value)
}

export async function getUserContinuousVipBenefit(
  userId: number,
  client: DbClient = prisma
): Promise<{ level: number; benefit: VipContinuousBenefitLevel }> {
  const [vip, config] = await Promise.all([
    getCurrentUserVip(userId, client),
    getVipBenefitsConfig(client)
  ])
  return {
    level: vip.level,
    benefit: vip.level > 0
      ? config.levels[String(Math.min(vip.level, MAX_CONTINUOUS_VIP_LEVEL))]
      : { orderDiscountPercent: 0, extraTrafficPercent: 0, resourcePoolBonusPercent: 0 }
  }
}

export type VipPriceSource = 'base' | 'aff' | 'vip' | 'flash_sale'

export function arbitrateVipPrice(input: {
  basePrice: number
  affDiscountRate?: number
  vipDiscountPercent?: number
  flashSalePrice?: number | null
}): { finalPrice: number; discountAmount: number; source: VipPriceSource } {
  const basePrice = Number(input.basePrice.toFixed(2))
  if (input.flashSalePrice !== null && input.flashSalePrice !== undefined) {
    const finalPrice = Number(input.flashSalePrice.toFixed(2))
    return {
      finalPrice,
      discountAmount: Number(Math.max(0, basePrice - finalPrice).toFixed(2)),
      source: 'flash_sale'
    }
  }

  const affRate = Math.max(0, Math.min(1, input.affDiscountRate ?? 0))
  const vipRate = Math.max(0, Math.min(1, (input.vipDiscountPercent ?? 0) / 100))
  const candidates: Array<{ price: number; source: VipPriceSource }> = [
    { price: basePrice, source: 'base' },
    { price: Number((basePrice * (1 - affRate)).toFixed(2)), source: 'aff' },
    { price: Number((basePrice * (1 - vipRate)).toFixed(2)), source: 'vip' }
  ]
  const winner = candidates.reduce((best, candidate) => candidate.price < best.price ? candidate : best)
  return {
    finalPrice: winner.price,
    discountAmount: Number((basePrice - winner.price).toFixed(2)),
    source: winner.source
  }
}

export function calculateVipExtraTraffic(baseLimit: bigint | null, percent: number): bigint {
  if (baseLimit === null || baseLimit <= 0n || percent <= 0) return 0n
  const basisPoints = BigInt(Math.round(Math.min(MAX_VIP_BENEFIT_PERCENT, percent) * 100))
  return (baseLimit * basisPoints) / 10_000n
}

export function calculateVipResourcePoolCost(amount: number, bonusPercent: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new VipBenefitError('INVALID_RESOURCE_POOL_AMOUNT', 'Resource pool amount must be a positive safe integer')
  }
  const boundedBonus = Math.max(0, Math.min(MAX_VIP_BENEFIT_PERCENT, bonusPercent))
  return Math.max(1, Math.ceil((amount * 100) / (100 + boundedBonus)))
}

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

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new VipBenefitError('INVALID_NUMBER', `${field} must be a safe integer`)
  }
  return value
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VipBenefitError('INVALID_NUMBER', `${field} must be a finite number`)
  }
  return value
}

function normalizeLevel(value: unknown): number {
  const level = requireSafeInteger(value, 'VIP level')
  if (level < 1 || level > MAX_VIP_LEVEL) {
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
  const parsed = requireSafeInteger(value, field)
  if (parsed <= 0 || parsed > max) {
    throw new VipBenefitError('INVALID_NUMBER', `${field} must be an integer between 1 and ${max}`)
  }
  return parsed
}

function normalizeOptionalPositiveInteger(value: unknown, fallback: number, field: string, max: number): number {
  if (value === null || value === undefined || value === '') return fallback
  return normalizePositiveInteger(value, field, max)
}

function normalizeMoney(value: unknown, field: string): number {
  const parsed = requireFiniteNumber(value, field)
  if (parsed <= 0 || parsed > MAX_MONEY_AMOUNT) {
    throw new VipBenefitError('INVALID_AMOUNT', `${field} must be between 0.01 and ${MAX_MONEY_AMOUNT}`)
  }
  return roundMoney(parsed)
}

function normalizeSortOrder(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = requireSafeInteger(value, 'Sort order')
  if (parsed < 0 || parsed > MAX_SORT_ORDER) {
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
    await prisma.vipBenefitReward.update({
      where: { id },
      data: { enabled: false }
    })
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
  if (!Number.isSafeInteger(rewardId) || rewardId <= 0) {
    throw new VipBenefitError('INVALID_REWARD_ID', 'Invalid VIP benefit reward ID')
  }

  let createdClaim: VipBenefitClaim | null = null
  try {
    createdClaim = await prisma.$transaction(async (tx) => {
      await advisoryTransactionLock(tx, USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE, userId)

      const vip = await getCurrentUserVip(userId, tx)
      const reward = await tx.vipBenefitReward.findFirst({
        where: {
          id: rewardId,
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
        const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
        if (!balanceLocked) {
          throw new VipBenefitError('BALANCE_CONFLICT', 'Balance is being processed, please try again later', 409)
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true }
        })
        if (!user) {
          throw new VipBenefitError('USER_NOT_FOUND', 'User not found', 404)
        }
        const balanceBefore = toNumber(user.balance)
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: amount } },
          select: { balance: true }
        })
        const balanceAfter = toNumber(updatedUser.balance)
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
        await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)

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
