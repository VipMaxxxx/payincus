import { Prisma, type VipLevelConditionMode, type VipLevelRule, type VipLevelRuleType } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { getUsersTotalConsumeMap } from '../db/balance.js'
import { getSystemConfig } from '../db/system-config.js'
import { invalidateCachedConfig } from '../lib/config-cache.js'

export const MAX_VIP_LEVEL = 10
const MAX_MONEY_THRESHOLD = 99999999.99
const MAX_INSTANCE_THRESHOLD = 1000000
const MAX_BENEFIT_POINTS = 1000000000
const MAX_BENEFIT_INSTANCE_DAYS = 3650
const MAX_BENEFIT_INSTANCE_QUANTITY = 10
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export type VipRuleType = VipLevelRuleType
export type VipConditionMode = VipLevelConditionMode
export type UserVipMetric = 'totalRecharge' | 'totalConsume'

export interface VipRuleInput {
  level: number
  enabled?: boolean
  conditionMode?: VipConditionMode
  userMetric?: UserVipMetric
  minRecharge?: number | null
  minConsume?: number | null
  minHostingIncome?: number | null
  minHostingInstances?: number | null
  benefits?: Record<string, unknown> | null
}

export interface VipBadgeStyle {
  backgroundColor: string
  textColor: string
}

export interface VipBenefitHallConfig {
  balance: {
    enabled: boolean
    amount: number
  }
  points: {
    enabled: boolean
    amount: number
  }
  instance: {
    enabled: boolean
    packageId: number | null
    packageName: string | null
    planId: number | null
    planName: string | null
    days: number
    quantity: number
  }
}

interface VipBenefitInstanceRef {
  level: number
  packageId: number
  planId: number
}

export interface NormalizedVipRule {
  id?: number
  type: VipRuleType
  level: number
  enabled: boolean
  conditionMode: VipConditionMode
  minRecharge: number | null
  minConsume: number | null
  minHostingIncome: number | null
  minHostingInstances: number | null
  benefits: Record<string, unknown>
  badgeStyle: VipBadgeStyle
}

export interface UserVipStats {
  totalRecharge: number
  totalConsume: number
}

export interface HostingVipStats {
  totalHostingIncome: number
  instanceCount: number
}

export type VipProgressMetric = 'totalRecharge' | 'totalConsume' | 'totalHostingIncome' | 'instanceCount'

export interface VipProgressCondition {
  metric: VipProgressMetric
  current: number
  target: number
  remaining: number
  matched: boolean
  progress: number
}

export interface VipLevelProgress {
  currentLevel: number
  nextLevel: number | null
  conditionMode: VipConditionMode | null
  userMetric?: UserVipMetric | null
  progress: number
  isMaxLevel: boolean
  conditions: VipProgressCondition[]
}

export interface VipOverview {
  userVipLevel: number
  hostingVipLevel: number
  userVipBadgeStyle: VipBadgeStyle | null
  hostingVipBadgeStyle: VipBadgeStyle | null
  userVipMetric: UserVipMetric
  userStats: UserVipStats
  hostingStats: HostingVipStats
  userVipProgress: VipLevelProgress
  hostingVipProgress: VipLevelProgress
}

type DbClient = Prisma.TransactionClient | typeof prisma
const USER_VIP_METRIC_CONFIG_KEY = 'user_vip_metric'

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  return Number.parseFloat(String(value)) || 0
}

function nullableMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MONEY_THRESHOLD) {
    throw new Error(`Money threshold must be between 0 and ${MAX_MONEY_THRESHOLD}`)
  }
  return Math.round(parsed * 100) / 100
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_INSTANCE_THRESHOLD) {
    throw new Error(`Instance threshold must be between 0 and ${MAX_INSTANCE_THRESHOLD}`)
  }
  if (!Number.isInteger(parsed)) {
    throw new Error('Instance threshold must be an integer')
  }
  return parsed
}

function hasThreshold(value: number | null): boolean {
  return value !== null && value > 0
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100
}

function toProgressPercent(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

function normalizeUserVipMetric(value: unknown): UserVipMetric {
  return value === 'totalConsume' ? 'totalConsume' : 'totalRecharge'
}

export async function getUserVipMetric(): Promise<UserVipMetric> {
  return normalizeUserVipMetric(await getSystemConfig(USER_VIP_METRIC_CONFIG_KEY))
}

export async function updateUserVipMetric(value: unknown): Promise<UserVipMetric> {
  const metric = normalizeUserVipMetric(value)
  await prisma.systemConfig.upsert({
    where: { key: USER_VIP_METRIC_CONFIG_KEY },
    create: {
      key: USER_VIP_METRIC_CONFIG_KEY,
      value: metric,
      type: 'string',
      label: '用户 VIP 统计口径',
      description: '用户 VIP 等级全局计算口径：totalRecharge=累计充值，totalConsume=累计消费'
    },
    update: { value: metric }
  })
  invalidateCachedConfig(USER_VIP_METRIC_CONFIG_KEY)
  return metric
}

function normalizeBenefits(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function getDefaultVipBadgeStyle(level: number): VipBadgeStyle {
  const styles: VipBadgeStyle[] = [
    { backgroundColor: '#FEF3C7', textColor: '#92400E' },
    { backgroundColor: '#D1FAE5', textColor: '#047857' },
    { backgroundColor: '#DBEAFE', textColor: '#1D4ED8' },
    { backgroundColor: '#EDE9FE', textColor: '#6D28D9' },
    { backgroundColor: '#FFEDD5', textColor: '#C2410C' },
    { backgroundColor: '#FCE7F3', textColor: '#BE185D' },
    { backgroundColor: '#FFE4E6', textColor: '#BE123C' },
    { backgroundColor: '#CFFAFE', textColor: '#0E7490' },
    { backgroundColor: '#FAE8FF', textColor: '#A21CAF' },
    { backgroundColor: '#FEF9C3', textColor: '#A16207' }
  ]
  return styles[(Math.max(1, Math.floor(level)) - 1) % styles.length]
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback
}

function normalizeBenefitMoney(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(MAX_MONEY_THRESHOLD, Math.round(parsed * 100) / 100)
}

function normalizeBenefitInteger(value: unknown, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(max, Math.floor(parsed))
}

function normalizeBenefitId(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeBenefitLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 100) : null
}

function normalizeBenefitHallConfig(value: unknown, strict = false): VipBenefitHallConfig {
  const raw = getRecord(value)
  const balance = getRecord(raw.balance)
  const points = getRecord(raw.points)
  const instance = getRecord(raw.instance)

  const balanceAmount = normalizeBenefitMoney(balance.amount)
  const pointsAmount = normalizeBenefitInteger(points.amount, MAX_BENEFIT_POINTS)
  const packageId = normalizeBenefitId(instance.packageId)
  const planId = normalizeBenefitId(instance.planId)
  const days = normalizeBenefitInteger(instance.days, MAX_BENEFIT_INSTANCE_DAYS) || 30
  const quantity = normalizeBenefitInteger(instance.quantity, MAX_BENEFIT_INSTANCE_QUANTITY) || 1

  const balanceEnabled = balance.enabled === true
  const pointsEnabled = points.enabled === true
  const instanceEnabled = instance.enabled === true

  if (strict) {
    if (balanceEnabled && balanceAmount <= 0) {
      throw new Error('VIP benefit balance amount must be greater than 0')
    }
    if (pointsEnabled && pointsAmount <= 0) {
      throw new Error('VIP benefit points amount must be a positive integer')
    }
    if (instanceEnabled && (!packageId || !planId)) {
      throw new Error('VIP benefit instance requires a package and plan')
    }
    if (instanceEnabled && normalizeBenefitInteger(instance.days, MAX_BENEFIT_INSTANCE_DAYS) <= 0) {
      throw new Error('VIP benefit instance days must be a positive integer')
    }
    if (instanceEnabled && normalizeBenefitInteger(instance.quantity, MAX_BENEFIT_INSTANCE_QUANTITY) <= 0) {
      throw new Error('VIP benefit instance quantity must be a positive integer')
    }
  }

  return {
    balance: {
      enabled: balanceEnabled && balanceAmount > 0,
      amount: balanceAmount
    },
    points: {
      enabled: pointsEnabled && pointsAmount > 0,
      amount: pointsAmount
    },
    instance: {
      enabled: instanceEnabled && !!packageId && !!planId,
      packageId,
      packageName: normalizeBenefitLabel(instance.packageName),
      planId,
      planName: normalizeBenefitLabel(instance.planName),
      days,
      quantity
    }
  }
}

function collectBenefitInstanceRefs(rules: NormalizedVipRule[]): VipBenefitInstanceRef[] {
  const refs: VipBenefitInstanceRef[] = []
  for (const rule of rules) {
    const benefitHall = normalizeBenefitHallConfig((rule.benefits as Record<string, unknown>).benefitHall)
    if (benefitHall.instance.enabled && benefitHall.instance.packageId && benefitHall.instance.planId) {
      refs.push({
        level: rule.level,
        packageId: benefitHall.instance.packageId,
        planId: benefitHall.instance.planId
      })
    }
  }
  return refs
}

async function validateBenefitInstanceRefs(refs: VipBenefitInstanceRef[]): Promise<void> {
  if (refs.length === 0) return

  const packageIds = Array.from(new Set(refs.map(ref => ref.packageId)))
  const planIds = Array.from(new Set(refs.map(ref => ref.planId)))

  const [packages, plans] = await Promise.all([
    prisma.package.findMany({
      where: {
        id: { in: packageIds },
        active: true
      },
      select: { id: true }
    }),
    prisma.packagePlan.findMany({
      where: {
        id: { in: planIds },
        isActive: true
      },
      select: {
        id: true,
        packageId: true
      }
    })
  ])

  const existingPackageIds = new Set(packages.map(pkg => pkg.id))
  const activePlanPackageMap = new Map(plans.map(plan => [plan.id, plan.packageId]))

  for (const ref of refs) {
    if (!existingPackageIds.has(ref.packageId)) {
      throw new Error(`VIP${ref.level} benefit package does not exist or is disabled`)
    }
    if (activePlanPackageMap.get(ref.planId) !== ref.packageId) {
      throw new Error(`VIP${ref.level} benefit plan does not exist, is disabled, or does not belong to the selected package`)
    }
  }
}

export function normalizeVipBadgeStyle(level: number, value: unknown): VipBadgeStyle {
  const fallback = getDefaultVipBadgeStyle(level)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const style = value as Record<string, unknown>
  return {
    backgroundColor: normalizeHexColor(style.backgroundColor, fallback.backgroundColor),
    textColor: normalizeHexColor(style.textColor, fallback.textColor)
  }
}

function sanitizeBenefits(level: number, benefits: unknown, strict = false): Record<string, unknown> {
  const normalized = normalizeBenefits(benefits)
  return {
    ...normalized,
    badgeStyle: normalizeVipBadgeStyle(level, normalized.badgeStyle),
    benefitHall: normalizeBenefitHallConfig(normalized.benefitHall, strict)
  }
}

export function getVipBadgeStyleForLevel(rules: NormalizedVipRule[], type: VipRuleType, level: number): VipBadgeStyle | null {
  if (!level) return null
  const rule = rules.find(item => item.type === type && item.level === level)
  return rule?.badgeStyle || getDefaultVipBadgeStyle(level)
}

export function normalizeVipRule(rule: VipLevelRule): NormalizedVipRule {
  const benefits = sanitizeBenefits(rule.level, rule.benefits)
  return {
    id: rule.id,
    type: rule.type,
    level: rule.level,
    enabled: rule.enabled,
    conditionMode: rule.conditionMode,
    minRecharge: rule.minRecharge === null ? null : toNumber(rule.minRecharge),
    minConsume: rule.minConsume === null ? null : toNumber(rule.minConsume),
    minHostingIncome: rule.minHostingIncome === null ? null : toNumber(rule.minHostingIncome),
    minHostingInstances: rule.minHostingInstances,
    benefits,
    badgeStyle: normalizeVipBadgeStyle(rule.level, benefits.badgeStyle)
  }
}

export function sanitizeVipRuleInput(type: VipRuleType, input: VipRuleInput, userMetric: UserVipMetric = 'totalRecharge'): NormalizedVipRule {
  const level = Number(input.level)
  if (!Number.isInteger(level) || level < 1 || level > MAX_VIP_LEVEL) {
    throw new Error(`VIP level must be between 1 and ${MAX_VIP_LEVEL}`)
  }

  const conditionMode = input.conditionMode === 'all' ? 'all' : 'any'
  const enabled = input.enabled !== false
  const normalized: NormalizedVipRule = {
    type,
    level,
    enabled,
    conditionMode: type === 'user' ? 'any' : conditionMode,
    minRecharge: type === 'user' && userMetric === 'totalRecharge' ? nullableMoney(input.minRecharge) : null,
    minConsume: type === 'user' && userMetric === 'totalConsume' ? nullableMoney(input.minConsume) : null,
    minHostingIncome: type === 'hosting' ? nullableMoney(input.minHostingIncome) : null,
    minHostingInstances: type === 'hosting' ? nullableCount(input.minHostingInstances) : null,
    benefits: sanitizeBenefits(level, input.benefits, true),
    badgeStyle: getDefaultVipBadgeStyle(level)
  }
  normalized.badgeStyle = normalizeVipBadgeStyle(level, normalized.benefits.badgeStyle)

  if (enabled && !hasActiveCondition(type, normalized)) {
    throw new Error(`VIP${level} requires at least one condition`)
  }

  return normalized
}

export function hasActiveCondition(type: VipRuleType, rule: Pick<NormalizedVipRule, 'minRecharge' | 'minConsume' | 'minHostingIncome' | 'minHostingInstances'>): boolean {
  if (type === 'user') {
    return hasThreshold(rule.minRecharge) || hasThreshold(rule.minConsume)
  }
  return hasThreshold(rule.minHostingIncome) || hasThreshold(rule.minHostingInstances)
}

function getRuleChecks(type: VipRuleType, rule: NormalizedVipRule, stats: UserVipStats | HostingVipStats): boolean[] {
  if (type === 'user') {
    const userStats = stats as UserVipStats
    return [
      hasThreshold(rule.minRecharge) ? userStats.totalRecharge >= rule.minRecharge! : null,
      hasThreshold(rule.minConsume) ? userStats.totalConsume >= rule.minConsume! : null
    ].filter((value): value is boolean => value !== null)
  }

  const hostingStats = stats as HostingVipStats
  return [
    hasThreshold(rule.minHostingIncome) ? hostingStats.totalHostingIncome >= rule.minHostingIncome! : null,
    hasThreshold(rule.minHostingInstances) ? hostingStats.instanceCount >= rule.minHostingInstances! : null
  ].filter((value): value is boolean => value !== null)
}

function getUserRuleChecks(rule: NormalizedVipRule, stats: UserVipStats, userMetric: UserVipMetric): boolean[] {
  return [
    userMetric === 'totalRecharge' && hasThreshold(rule.minRecharge) ? stats.totalRecharge >= rule.minRecharge! : null,
    userMetric === 'totalConsume' && hasThreshold(rule.minConsume) ? stats.totalConsume >= rule.minConsume! : null
  ].filter((value): value is boolean => value !== null)
}

function hasUserMetricCondition(rule: NormalizedVipRule, userMetric: UserVipMetric): boolean {
  return userMetric === 'totalRecharge' ? hasThreshold(rule.minRecharge) : hasThreshold(rule.minConsume)
}

export function isVipRuleMatched(type: VipRuleType, rule: NormalizedVipRule, stats: UserVipStats | HostingVipStats): boolean {
  if (!rule.enabled || !hasActiveCondition(type, rule)) return false
  const checks = getRuleChecks(type, rule, stats)
  if (checks.length === 0) return false
  return rule.conditionMode === 'all'
    ? checks.every(Boolean)
    : checks.some(Boolean)
}

export function isUserVipRuleMatched(rule: NormalizedVipRule, stats: UserVipStats, userMetric: UserVipMetric): boolean {
  if (!rule.enabled || rule.type !== 'user' || !hasUserMetricCondition(rule, userMetric)) return false
  const checks = getUserRuleChecks(rule, stats, userMetric)
  return checks.length > 0 && checks.some(Boolean)
}

export function calculateVipLevel(type: VipRuleType, rules: NormalizedVipRule[], stats: UserVipStats | HostingVipStats): number {
  const matchedRules = rules
    .filter(rule => rule.type === type && isVipRuleMatched(type, rule, stats))
    .sort((a, b) => b.level - a.level)

  return matchedRules[0]?.level || 0
}

export function calculateUserVipLevelByMetric(rules: NormalizedVipRule[], stats: UserVipStats, userMetric: UserVipMetric): number {
  const matchedRules = rules
    .filter(rule => isUserVipRuleMatched(rule, stats, userMetric))
    .sort((a, b) => b.level - a.level)

  return matchedRules[0]?.level || 0
}

function buildVipProgressCondition(metric: VipProgressMetric, current: number, target: number): VipProgressCondition {
  const normalizedCurrent = roundAmount(Math.max(current, 0))
  const normalizedTarget = roundAmount(Math.max(target, 0))
  return {
    metric,
    current: normalizedCurrent,
    target: normalizedTarget,
    remaining: roundAmount(Math.max(normalizedTarget - normalizedCurrent, 0)),
    matched: normalizedCurrent >= normalizedTarget,
    progress: toProgressPercent(normalizedCurrent, normalizedTarget)
  }
}

function getVipProgressConditions(
  type: VipRuleType,
  rule: NormalizedVipRule,
  stats: UserVipStats | HostingVipStats,
  userMetric: UserVipMetric = 'totalRecharge'
): VipProgressCondition[] {
  if (type === 'user') {
    const userStats = stats as UserVipStats
    return [
      userMetric === 'totalRecharge' && hasThreshold(rule.minRecharge)
        ? buildVipProgressCondition('totalRecharge', userStats.totalRecharge, rule.minRecharge!)
        : null,
      userMetric === 'totalConsume' && hasThreshold(rule.minConsume)
        ? buildVipProgressCondition('totalConsume', userStats.totalConsume, rule.minConsume!)
        : null
    ].filter((condition): condition is VipProgressCondition => condition !== null)
  }

  const hostingStats = stats as HostingVipStats
  return [
    hasThreshold(rule.minHostingIncome)
      ? buildVipProgressCondition('totalHostingIncome', hostingStats.totalHostingIncome, rule.minHostingIncome!)
      : null,
    hasThreshold(rule.minHostingInstances)
      ? buildVipProgressCondition('instanceCount', hostingStats.instanceCount, rule.minHostingInstances!)
      : null
  ].filter((condition): condition is VipProgressCondition => condition !== null)
}

export function calculateVipProgress(
  type: VipRuleType,
  rules: NormalizedVipRule[],
  currentLevel: number,
  stats: UserVipStats | HostingVipStats,
  userMetric: UserVipMetric = 'totalRecharge'
): VipLevelProgress {
  const nextRule = rules
    .filter(rule => {
      if (rule.type !== type || !rule.enabled || rule.level <= currentLevel) return false
      return type === 'user' ? hasUserMetricCondition(rule, userMetric) : hasActiveCondition(type, rule)
    })
    .sort((a, b) => a.level - b.level)[0]

  if (!nextRule) {
    return {
      currentLevel,
      nextLevel: null,
      conditionMode: null,
      userMetric: type === 'user' ? userMetric : null,
      progress: currentLevel > 0 ? 100 : 0,
      isMaxLevel: currentLevel > 0,
      conditions: []
    }
  }

  const conditions = getVipProgressConditions(type, nextRule, stats, userMetric)
  const conditionProgressValues = conditions.map(condition => condition.progress)
  const progress = conditionProgressValues.length === 0
    ? 0
    : nextRule.conditionMode === 'all'
      ? Math.min(...conditionProgressValues)
      : Math.max(...conditionProgressValues)

  return {
    currentLevel,
    nextLevel: nextRule.level,
    conditionMode: nextRule.conditionMode,
    userMetric: type === 'user' ? userMetric : null,
    progress,
    isMaxLevel: false,
    conditions
  }
}

export async function getVipRules(type: VipRuleType, client: DbClient = prisma): Promise<NormalizedVipRule[]> {
  const rules = await client.vipLevelRule.findMany({
    where: { type },
    orderBy: { level: 'asc' }
  })
  return rules.map(normalizeVipRule)
}

export async function replaceVipRules(type: VipRuleType, inputs: VipRuleInput[], userMetric?: UserVipMetric): Promise<NormalizedVipRule[]> {
  if (inputs.length > MAX_VIP_LEVEL) {
    throw new Error(`At most ${MAX_VIP_LEVEL} VIP rules can be saved`)
  }

  const byLevel = new Map<number, NormalizedVipRule>()
  const metricToSave = type === 'user' ? userMetric : undefined
  const effectiveUserMetric = type === 'user' ? (metricToSave || await getUserVipMetric()) : 'totalRecharge'
  for (const input of inputs) {
    const rule = sanitizeVipRuleInput(type, input, effectiveUserMetric)
    byLevel.set(rule.level, rule)
  }

  const normalizedRules = Array.from(byLevel.values()).sort((a, b) => a.level - b.level)
  await validateBenefitInstanceRefs(collectBenefitInstanceRefs(normalizedRules))

  await prisma.$transaction(async (tx) => {
    if (metricToSave) {
      await tx.systemConfig.upsert({
        where: { key: USER_VIP_METRIC_CONFIG_KEY },
        create: {
          key: USER_VIP_METRIC_CONFIG_KEY,
          value: metricToSave,
          type: 'string',
          label: '用户 VIP 统计口径',
          description: '用户 VIP 等级全局计算口径：totalRecharge=累计充值，totalConsume=累计消费'
        },
        update: { value: metricToSave }
      })
    }

    if (normalizedRules.length === 0) {
      await tx.vipLevelRule.deleteMany({ where: { type } })
      return
    }

    await tx.vipLevelRule.deleteMany({
      where: {
        type,
        level: { notIn: normalizedRules.map(rule => rule.level) }
      }
    })

    for (const rule of normalizedRules) {
      await tx.vipLevelRule.upsert({
        where: {
          type_level: {
            type,
            level: rule.level
          }
        },
        create: {
          type,
          level: rule.level,
          enabled: rule.enabled,
          conditionMode: rule.conditionMode,
          minRecharge: rule.minRecharge,
          minConsume: rule.minConsume,
          minHostingIncome: rule.minHostingIncome,
          minHostingInstances: rule.minHostingInstances,
          benefits: rule.benefits as Prisma.InputJsonObject
        },
        update: {
          enabled: rule.enabled,
          conditionMode: rule.conditionMode,
          minRecharge: rule.minRecharge,
          minConsume: rule.minConsume,
          minHostingIncome: rule.minHostingIncome,
          minHostingInstances: rule.minHostingInstances,
          benefits: rule.benefits as Prisma.InputJsonObject
        }
      })
    }
  })

  if (metricToSave) {
    invalidateCachedConfig(USER_VIP_METRIC_CONFIG_KEY)
  }

  return getVipRules(type)
}

export async function getUserVipStats(userId: number, client: DbClient = prisma): Promise<UserVipStats> {
  const [consumeMap, rechargeResult] = await Promise.all([
    getUsersTotalConsumeMap([userId], client),
    client.rechargeRecord.aggregate({
      where: { userId, status: 'completed' },
      _sum: { amount: true }
    })
  ])

  return {
    totalConsume: consumeMap.get(userId) || 0,
    totalRecharge: toNumber(rechargeResult._sum.amount)
  }
}

export async function getHostingVipStats(userId: number, client: DbClient = prisma): Promise<HostingVipStats> {
  const [incomeResult, instanceCount] = await Promise.all([
    client.hostingBalanceLog.aggregate({
      where: { userId, type: 'income' },
      _sum: { amount: true }
    }),
    client.instance.count({
      where: {
        host: { userId },
        status: { not: 'deleted' }
      }
    })
  ])

  return {
    totalHostingIncome: toNumber(incomeResult._sum.amount),
    instanceCount
  }
}

export async function calculateUserVipLevel(userId: number): Promise<{ level: number; stats: UserVipStats }> {
  const [rules, stats, userMetric] = await Promise.all([
    getVipRules('user'),
    getUserVipStats(userId),
    getUserVipMetric()
  ])
  return {
    level: calculateUserVipLevelByMetric(rules, stats, userMetric),
    stats
  }
}

export async function calculateHostingVipLevel(userId: number): Promise<{ level: number; stats: HostingVipStats }> {
  const [rules, stats] = await Promise.all([
    getVipRules('hosting'),
    getHostingVipStats(userId)
  ])
  return {
    level: calculateVipLevel('hosting', rules, stats),
    stats
  }
}

export async function getVipOverview(userId: number): Promise<VipOverview> {
  const [userRules, hostingRules, userStats, hostingStats, userVipMetric] = await Promise.all([
    getVipRules('user'),
    getVipRules('hosting'),
    getUserVipStats(userId),
    getHostingVipStats(userId),
    getUserVipMetric()
  ])

  const userVipLevel = calculateUserVipLevelByMetric(userRules, userStats, userVipMetric)
  const hostingVipLevel = calculateVipLevel('hosting', hostingRules, hostingStats)

  return {
    userVipLevel,
    hostingVipLevel,
    userVipBadgeStyle: getVipBadgeStyleForLevel(userRules, 'user', userVipLevel),
    hostingVipBadgeStyle: getVipBadgeStyleForLevel(hostingRules, 'hosting', hostingVipLevel),
    userVipMetric,
    userStats,
    hostingStats,
    userVipProgress: calculateVipProgress('user', userRules, userVipLevel, userStats, userVipMetric),
    hostingVipProgress: calculateVipProgress('hosting', hostingRules, hostingVipLevel, hostingStats)
  }
}

export function buildHostingVipSql(rules: NormalizedVipRule[]): Prisma.Sql {
  const orderedRules = rules
    .filter(rule => rule.enabled && hasActiveCondition('hosting', rule))
    .sort((a, b) => b.level - a.level)

  if (orderedRules.length === 0) {
    return Prisma.sql`"id" * 0`
  }

  const cases = orderedRules.map((rule) => {
    const conditions: Prisma.Sql[] = []
    if (hasThreshold(rule.minHostingIncome)) {
      conditions.push(Prisma.sql`"totalHostingIncome" >= ${rule.minHostingIncome}`)
    }
    if (hasThreshold(rule.minHostingInstances)) {
      conditions.push(Prisma.sql`"instanceCount" >= ${rule.minHostingInstances}`)
    }

    const conditionSql = rule.conditionMode === 'all'
      ? Prisma.join(conditions, ' AND ')
      : Prisma.join(conditions, ' OR ')

    return Prisma.sql`WHEN ${conditionSql} THEN ${rule.level}`
  })

  return Prisma.sql`CASE ${Prisma.join(cases, ' ')} ELSE 0 END`
}
