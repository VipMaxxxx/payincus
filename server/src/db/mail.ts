/**
 * 域名邮箱模块数据库操作
 * 包含邮箱源、套餐方案、订阅、域名、账户的 CRUD 操作
 */

import { prisma } from './prisma.js'
import type { MailSource, MailPlan, MailSubscription, MailDomain, MailAccount, MailBillingCycle, MailDomainStatus, MailSubscriptionStatus, Prisma } from '@prisma/client'
import { decryptSensitiveData, encryptSensitiveData, isEncrypted } from '../lib/security.js'

export const MASKED_MAIL_SOURCE_API_KEY_VALUE = '__SECRET_SET__'

const MAIL_LIST_SEARCH_MAX_LENGTH = 128
const MAIL_LIST_MAX_PAGE_SIZE = 100
const MAIL_SUBSCRIPTION_STATUSES = new Set<MailSubscriptionStatus>(['active', 'expired', 'suspended'])
const MAIL_DOMAIN_STATUSES = new Set<MailDomainStatus>(['pending', 'verified', 'suspended'])

function clampMailListPagination(page: number | undefined, pageSize: number | undefined): {
  page: number
  pageSize: number
} {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), MAIL_LIST_MAX_PAGE_SIZE)
      : 20
  }
}

function normalizeMailListSearch(search: string | undefined): string | undefined {
  const trimmed = search?.trim()
  return trimmed ? trimmed.slice(0, MAIL_LIST_SEARCH_MAX_LENGTH) : undefined
}

function parseMailSearchUserId(searchTerm: string | undefined): number | undefined {
  if (!searchTerm || !/^\d+$/.test(searchTerm)) {
    return undefined
  }

  const id = Number(searchTerm)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function normalizePositiveMailSourceId(sourceId: number | undefined): number | undefined {
  return Number.isSafeInteger(sourceId) && sourceId !== undefined && sourceId > 0
    ? sourceId
    : undefined
}

function normalizeMailSubscriptionStatus(status: MailSubscriptionStatus | string | undefined): MailSubscriptionStatus | undefined {
  return MAIL_SUBSCRIPTION_STATUSES.has(status as MailSubscriptionStatus)
    ? status as MailSubscriptionStatus
    : undefined
}

function normalizeMailDomainStatus(status: MailDomainStatus | string | undefined): MailDomainStatus | undefined {
  return MAIL_DOMAIN_STATUSES.has(status as MailDomainStatus)
    ? status as MailDomainStatus
    : undefined
}

function decryptMailSecret(value: string): string {
  if (!value) return value
  return isEncrypted(value) ? (decryptSensitiveData(value) || value) : value
}

function encryptMailSecret(value: string): string {
  return isEncrypted(value) ? value : encryptSensitiveData(value)
}

function decryptMailSource<T extends MailSource>(source: T): T {
  return { ...source, apiKey: decryptMailSecret(source.apiKey) }
}

function decryptMailDomainAdminPassword<T extends { adminPassword: string | null }>(domain: T): T {
  return {
    ...domain,
    adminPassword: domain.adminPassword ? decryptMailSecret(domain.adminPassword) : domain.adminPassword
  }
}

function withDecryptedSource<T extends { source: MailSource }>(record: T): T {
  return { ...record, source: decryptMailSource(record.source) }
}

function withDecryptedDomainSource<T extends { source: MailSource; adminPassword: string | null }>(record: T): T {
  return withDecryptedSource(decryptMailDomainAdminPassword(record))
}

export function sanitizeMailSourceForResponse<T extends MailSource>(
  source: T
): Omit<T, 'apiKey'> & { apiKey: string; apiKeyConfigured: boolean } {
  return {
    ...source,
    apiKey: '',
    apiKeyConfigured: Boolean(source.apiKey)
  }
}

export function mergeMailSourceApiKeyForUpdate(nextApiKey: string | null | undefined): string | undefined {
  if (
    nextApiKey === undefined ||
    nextApiKey === null ||
    nextApiKey === '' ||
    nextApiKey === MASKED_MAIL_SOURCE_API_KEY_VALUE ||
    nextApiKey.startsWith('***')
  ) {
    return undefined
  }
  return nextApiKey
}

// ==================== 邮箱源 (MailSource) ====================

/**
 * 获取所有邮箱源
 */
export async function getAllMailSources(includeDisabled = false): Promise<MailSource[]> {
  const sources = await prisma.mailSource.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
  return sources.map(decryptMailSource)
}

/**
 * 根据 ID 获取邮箱源
 */
export async function getMailSourceById(id: number): Promise<MailSource | null> {
  const source = await prisma.mailSource.findUnique({ where: { id } })
  return source ? decryptMailSource(source) : null
}

/**
 * 根据代码获取邮箱源
 */
export async function getMailSourceByCode(code: string): Promise<MailSource | null> {
  const source = await prisma.mailSource.findUnique({ where: { code } })
  return source ? decryptMailSource(source) : null
}

/**
 * 创建邮箱源
 */
export async function createMailSource(data: {
  name: string
  code: string
  apiUrl: string
  apiKey: string
  smarterMailUrl: string
  enabled?: boolean
  sortOrder?: number
}): Promise<MailSource> {
  const source = await prisma.mailSource.create({
    data: { ...data, apiKey: encryptMailSecret(data.apiKey) }
  })
  return decryptMailSource(source)
}

/**
 * 更新邮箱源
 */
export async function updateMailSource(id: number, data: {
  name?: string
  code?: string
  apiUrl?: string
  apiKey?: string
  smarterMailUrl?: string
  enabled?: boolean
  sortOrder?: number
}): Promise<MailSource> {
  const source = await prisma.mailSource.update({
    where: { id },
    data: {
      ...data,
      ...(data.apiKey !== undefined ? { apiKey: encryptMailSecret(data.apiKey) } : {})
    }
  })
  return decryptMailSource(source)
}

/**
 * 删除邮箱源
 */
export async function deleteMailSource(id: number): Promise<void> {
  await prisma.mailSource.delete({ where: { id } })
}

/**
 * 获取邮箱源统计信息
 */
export async function getMailSourceStats(sourceId: number): Promise<{
  planCount: number
  subscriptionCount: number
  domainCount: number
}> {
  const [planCount, subscriptionCount, domainCount] = await Promise.all([
    prisma.mailPlan.count({ where: { sourceId } }),
    prisma.mailSubscription.count({ where: { sourceId } }),
    prisma.mailDomain.count({ where: { sourceId } })
  ])
  return { planCount, subscriptionCount, domainCount }
}

// ==================== 套餐方案 (MailPlan) ====================

/**
 * 获取指定邮箱源的所有方案
 */
export async function getMailPlansBySource(sourceId: number, includeDisabled = false): Promise<MailPlan[]> {
  return prisma.mailPlan.findMany({
    where: {
      sourceId,
      ...(includeDisabled ? {} : { enabled: true })
    },
    orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }]
  })
}

/**
 * 是否存在至少一个可购买的邮箱源和启用方案
 */
export async function hasAvailableMailOffering(): Promise<boolean> {
  const count = await prisma.mailPlan.count({
    where: {
      enabled: true,
      source: {
        enabled: true
      }
    }
  })
  return count > 0
}

/**
 * 获取所有方案（管理员用）
 */
export async function getAllMailPlans(): Promise<(MailPlan & { source: MailSource })[]> {
  const plans = await prisma.mailPlan.findMany({
    include: { source: true },
    orderBy: [{ sourceId: 'asc' }, { sortOrder: 'asc' }, { price: 'asc' }]
  })
  return plans.map(withDecryptedSource)
}

/**
 * 根据 ID 获取方案
 */
export async function getMailPlanById(id: number): Promise<(MailPlan & { source: MailSource }) | null> {
  const plan = await prisma.mailPlan.findUnique({
    where: { id },
    include: { source: true }
  })
  return plan ? withDecryptedSource(plan) : null
}

/**
 * 创建套餐方案
 */
export async function createMailPlan(data: {
  sourceId: number
  name: string
  description?: string
  domainLimit: number
  diskLimitGb: number
  billingCycle: MailBillingCycle
  price: number
  enabled?: boolean
  sortOrder?: number
}): Promise<MailPlan> {
  return prisma.mailPlan.create({ data: { ...data, price: data.price } })
}

/**
 * 更新套餐方案
 */
export async function updateMailPlan(id: number, data: {
  name?: string
  description?: string
  domainLimit?: number
  diskLimitGb?: number
  billingCycle?: MailBillingCycle
  price?: number
  enabled?: boolean
  sortOrder?: number
}): Promise<MailPlan> {
  return prisma.mailPlan.update({ where: { id }, data })
}

/**
 * 删除套餐方案
 */
export async function deleteMailPlan(id: number): Promise<void> {
  await prisma.mailPlan.delete({ where: { id } })
}

// ==================== 用户订阅 (MailSubscription) ====================

/**
 * 获取用户的订阅
 */
export async function getUserMailSubscription(userId: number): Promise<(MailSubscription & {
  source: MailSource
  plan: MailPlan
  domains: MailDomain[]
}) | null> {
  const subscription = await prisma.mailSubscription.findFirst({
    where: { userId, status: 'active' },
    include: {
      source: true,
      plan: true,
      domains: {
        include: { accounts: true }
      }
    }
  })
  return subscription ? withDecryptedSource(subscription) : null
}

/**
 * 获取所有订阅（管理员用）
 */
export async function getAllMailSubscriptions(options?: {
  sourceId?: number
  status?: MailSubscriptionStatus | string
  search?: string
  page?: number
  pageSize?: number
}): Promise<{
  subscriptions: (MailSubscription & { user: { id: number; username: string; email: string | null; avatarStyle: string | null; avatarBadgeId: string | null }; source: MailSource; plan: MailPlan })[]
  total: number
}> {
  const { page, pageSize } = clampMailListPagination(options?.page, options?.pageSize)
  const sourceId = normalizePositiveMailSourceId(options?.sourceId)
  const status = normalizeMailSubscriptionStatus(options?.status)
  const searchTerm = normalizeMailListSearch(options?.search)
  const searchUserId = parseMailSearchUserId(searchTerm)
  
  const where: any = {
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {})
  }
  
  // 搜索条件：用户名、邮箱、用户ID
  if (searchTerm) {
    where.OR = [
      { user: { username: { contains: searchTerm, mode: 'insensitive' } } },
      { user: { email: { contains: searchTerm, mode: 'insensitive' } } },
      ...(searchUserId ? [{ userId: searchUserId }] : [])
    ]
  }
  
  const [subscriptions, total] = await Promise.all([
    prisma.mailSubscription.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true } },
        source: true,
        plan: true
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.mailSubscription.count({ where })
  ])
  
  return { subscriptions: subscriptions.map(withDecryptedSource), total }
}

/**
 * 根据 ID 获取订阅
 */
export async function getMailSubscriptionById(id: number): Promise<(MailSubscription & {
  source: MailSource
  plan: MailPlan
  domains: (MailDomain & { accounts: MailAccount[] })[]
}) | null> {
  const subscription = await prisma.mailSubscription.findUnique({
    where: { id },
    include: {
      source: true,
      plan: true,
      domains: {
        include: { accounts: true }
      }
    }
  })
  return subscription ? withDecryptedSource(subscription) : null
}

/**
 * 创建订阅
 */
export async function createMailSubscription(data: {
  userId: number
  sourceId: number
  planId: number
  domainLimit: number
  diskLimitGb: number
  expiresAt: Date
  autoRenew?: boolean
}): Promise<MailSubscription> {
  return prisma.mailSubscription.create({ data })
}

/**
 * 更新订阅
 */
export async function updateMailSubscription(id: number, data: {
  status?: MailSubscriptionStatus
  expiresAt?: Date
  autoRenew?: boolean
}): Promise<MailSubscription> {
  return prisma.mailSubscription.update({ where: { id }, data })
}

/**
 * 续费订阅
 */
export async function renewMailSubscription(id: number, months: number): Promise<MailSubscription> {
  if (!Number.isSafeInteger(months) || months < 1 || months > 12) {
    throw new Error('Invalid mail renewal months')
  }

  const subscription = await prisma.mailSubscription.findUnique({ where: { id } })
  if (!subscription) throw new Error('Subscription not found')
  
  const currentExpiry = subscription.expiresAt > new Date() ? subscription.expiresAt : new Date()
  const newExpiry = new Date(currentExpiry)
  newExpiry.setMonth(newExpiry.getMonth() + months)
  
  return prisma.mailSubscription.update({
    where: { id },
    data: { expiresAt: newExpiry, status: 'active' }
  })
}

// ==================== 域名 (MailDomain) ====================

/**
 * 获取订阅下的所有域名
 */
export async function getMailDomainsBySubscription(subscriptionId: number): Promise<(MailDomain & { accounts: MailAccount[] })[]> {
  const domains = await prisma.mailDomain.findMany({
    where: { subscriptionId },
    include: { accounts: true },
    orderBy: { createdAt: 'desc' }
  })
  return domains.map(decryptMailDomainAdminPassword)
}

/**
 * 根据 ID 获取域名
 */
export async function getMailDomainById(id: number): Promise<(MailDomain & {
  subscription: MailSubscription & { user: { id: number; username: string } }
  source: MailSource
  accounts: MailAccount[]
}) | null> {
  const domain = await prisma.mailDomain.findUnique({
    where: { id },
    include: {
      subscription: {
        include: { user: { select: { id: true, username: true } } }
      },
      source: true,
      accounts: true
    }
  })
  return domain ? withDecryptedDomainSource(domain) : null
}

/**
 * 检查域名是否已存在
 */
export async function checkMailDomainExists(domain: string, sourceId: number): Promise<boolean> {
  const count = await prisma.mailDomain.count({
    where: { domain, sourceId }
  })
  return count > 0
}

/**
 * 创建域名
 */
export async function createMailDomain(data: {
  subscriptionId: number
  sourceId: number
  domain: string
  adminUsername?: string
  adminPassword?: string
}): Promise<MailDomain> {
  const domain = await prisma.mailDomain.create({
    data: {
      ...data,
      ...(data.adminPassword !== undefined
        ? { adminPassword: data.adminPassword ? encryptMailSecret(data.adminPassword) : data.adminPassword }
        : {})
    }
  })
  return decryptMailDomainAdminPassword(domain)
}

/**
 * 在调用方事务中创建域名
 */
export async function createMailDomainWithTx(tx: Prisma.TransactionClient, data: {
  subscriptionId: number
  sourceId: number
  domain: string
  adminUsername?: string
  adminPassword?: string
}): Promise<MailDomain> {
  const domain = await tx.mailDomain.create({
    data: {
      ...data,
      ...(data.adminPassword !== undefined
        ? { adminPassword: data.adminPassword ? encryptMailSecret(data.adminPassword) : data.adminPassword }
        : {})
    }
  })
  return decryptMailDomainAdminPassword(domain)
}

/**
 * 更新域名
 */
export async function updateMailDomain(id: number, data: {
  status?: MailDomainStatus
  adminUsername?: string
  adminPassword?: string
  diskUsedMb?: number
  verifiedAt?: Date
}): Promise<MailDomain> {
  const domain = await prisma.mailDomain.update({
    where: { id },
    data: {
      ...data,
      ...(data.adminPassword !== undefined
        ? { adminPassword: data.adminPassword ? encryptMailSecret(data.adminPassword) : data.adminPassword }
        : {})
    }
  })
  return decryptMailDomainAdminPassword(domain)
}

/**
 * 删除域名
 */
export async function deleteMailDomain(id: number): Promise<void> {
  await prisma.mailDomain.delete({ where: { id } })
}

/**
 * 获取所有域名（管理员用）
 */
export async function getAllMailDomains(options?: {
  sourceId?: number
  status?: MailDomainStatus | string
  search?: string
  page?: number
  pageSize?: number
}): Promise<{
  domains: (MailDomain & {
    subscription: MailSubscription & { user: { id: number; username: string; email: string | null; avatarStyle: string | null; avatarBadgeId: string | null } }
    source: MailSource
    _count: { accounts: number }
  })[]
  total: number
}> {
  const { page, pageSize } = clampMailListPagination(options?.page, options?.pageSize)
  const sourceId = normalizePositiveMailSourceId(options?.sourceId)
  const status = normalizeMailDomainStatus(options?.status)
  const searchTerm = normalizeMailListSearch(options?.search)
  const searchUserId = parseMailSearchUserId(searchTerm)
  
  const where: any = {
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {})
  }
  
  // 搜索条件：域名、用户名、邮箱、用户ID
  if (searchTerm) {
    where.OR = [
      { domain: { contains: searchTerm, mode: 'insensitive' } },
      { subscription: { user: { username: { contains: searchTerm, mode: 'insensitive' } } } },
      { subscription: { user: { email: { contains: searchTerm, mode: 'insensitive' } } } },
      ...(searchUserId ? [{ subscription: { userId: searchUserId } }] : [])
    ]
  }
  
  const [domains, total] = await Promise.all([
    prisma.mailDomain.findMany({
      where,
      include: {
        subscription: {
          include: { user: { select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true } } }
        },
        source: true,
        _count: { select: { accounts: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.mailDomain.count({ where })
  ])
  
  return { domains: domains.map(withDecryptedDomainSource), total }
}

// ==================== 邮箱账户 (MailAccount) ====================

/**
 * 获取域名下的所有账户
 */
export async function getMailAccountsByDomain(domainId: number): Promise<MailAccount[]> {
  return prisma.mailAccount.findMany({
    where: { domainId },
    orderBy: [{ isAdmin: 'desc' }, { createdAt: 'asc' }]
  })
}

/**
 * 根据 ID 获取账户
 */
export async function getMailAccountById(id: number): Promise<(MailAccount & { domain: MailDomain }) | null> {
  return prisma.mailAccount.findUnique({
    where: { id },
    include: { domain: true }
  })
}

/**
 * 检查账户是否已存在
 */
export async function checkMailAccountExists(domainId: number, username: string): Promise<boolean> {
  const count = await prisma.mailAccount.count({
    where: { domainId, username }
  })
  return count > 0
}

/**
 * 创建邮箱账户
 */
export async function createMailAccount(data: {
  domainId: number
  email: string
  username: string
  displayName?: string
  diskLimitMb?: number
  isAdmin?: boolean
}): Promise<MailAccount> {
  return prisma.mailAccount.create({ data })
}

/**
 * 更新邮箱账户
 */
export async function updateMailAccount(id: number, data: {
  displayName?: string
  diskLimitMb?: number
  diskUsedMb?: number
  isAdmin?: boolean
}): Promise<MailAccount> {
  return prisma.mailAccount.update({ where: { id }, data })
}

/**
 * 删除邮箱账户
 */
export async function deleteMailAccount(id: number): Promise<void> {
  await prisma.mailAccount.delete({ where: { id } })
}

/**
 * 获取域名下的账户数量
 */
export async function getMailAccountCount(domainId: number): Promise<number> {
  return prisma.mailAccount.count({ where: { domainId } })
}

// ==================== 统计查询 ====================

/**
 * 获取订阅的使用统计
 */
export async function getSubscriptionUsageStats(subscriptionId: number): Promise<{
  domainCount: number
  accountCount: number
  diskUsedMb: number
}> {
  const domains = await prisma.mailDomain.findMany({
    where: { subscriptionId },
    include: {
      _count: { select: { accounts: true } }
    }
  })
  
  return {
    domainCount: domains.length,
    accountCount: domains.reduce((sum, d) => sum + d._count.accounts, 0),
    diskUsedMb: domains.reduce((sum, d) => sum + d.diskUsedMb, 0)
  }
}

/**
 * 检查即将过期的订阅（用于自动续费）
 */
export async function getExpiringSubscriptions(daysAhead: number): Promise<MailSubscription[]> {
  const deadline = new Date()
  deadline.setDate(deadline.getDate() + daysAhead)
  
  return prisma.mailSubscription.findMany({
    where: {
      status: 'active',
      autoRenew: true,
      expiresAt: { lte: deadline }
    }
  })
}
