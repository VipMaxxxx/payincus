/**
 * 域名邮箱模块数据库操作
 * 包含邮箱源、套餐方案、订阅、域名、账户的 CRUD 操作
 */

import { prisma } from './prisma.js'
import type { MailSource, MailPlan, MailSubscription, MailDomain, MailAccount, MailBillingCycle, MailDomainStatus, MailSubscriptionStatus } from '@prisma/client'

// ==================== 邮箱源 (MailSource) ====================

/**
 * 获取所有邮箱源
 */
export async function getAllMailSources(includeDisabled = false): Promise<MailSource[]> {
  return prisma.mailSource.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
}

/**
 * 根据 ID 获取邮箱源
 */
export async function getMailSourceById(id: number): Promise<MailSource | null> {
  return prisma.mailSource.findUnique({ where: { id } })
}

/**
 * 根据代码获取邮箱源
 */
export async function getMailSourceByCode(code: string): Promise<MailSource | null> {
  return prisma.mailSource.findUnique({ where: { code } })
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
  return prisma.mailSource.create({ data })
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
  return prisma.mailSource.update({ where: { id }, data })
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
  return prisma.mailPlan.findMany({
    include: { source: true },
    orderBy: [{ sourceId: 'asc' }, { sortOrder: 'asc' }, { price: 'asc' }]
  })
}

/**
 * 根据 ID 获取方案
 */
export async function getMailPlanById(id: number): Promise<(MailPlan & { source: MailSource }) | null> {
  return prisma.mailPlan.findUnique({
    where: { id },
    include: { source: true }
  })
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
  return prisma.mailSubscription.findFirst({
    where: { userId, status: 'active' },
    include: {
      source: true,
      plan: true,
      domains: {
        include: { accounts: true }
      }
    }
  })
}

/**
 * 获取所有订阅（管理员用）
 */
export async function getAllMailSubscriptions(options?: {
  sourceId?: number
  status?: MailSubscriptionStatus
  search?: string
  page?: number
  pageSize?: number
}): Promise<{
  subscriptions: (MailSubscription & { user: { id: number; username: string; email: string | null; avatarStyle: string | null; avatarBadgeId: string | null }; source: MailSource; plan: MailPlan })[]
  total: number
}> {
  const page = options?.page || 1
  const pageSize = options?.pageSize || 20
  
  const where: any = {
    ...(options?.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options?.status ? { status: options.status } : {})
  }
  
  // 搜索条件：用户名、邮箱、用户ID
  if (options?.search) {
    const searchTerm = options.search.trim()
    const searchId = parseInt(searchTerm)
    where.OR = [
      { user: { username: { contains: searchTerm, mode: 'insensitive' } } },
      { user: { email: { contains: searchTerm, mode: 'insensitive' } } },
      ...(isNaN(searchId) ? [] : [{ userId: searchId }])
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
  
  return { subscriptions, total }
}

/**
 * 根据 ID 获取订阅
 */
export async function getMailSubscriptionById(id: number): Promise<(MailSubscription & {
  source: MailSource
  plan: MailPlan
  domains: (MailDomain & { accounts: MailAccount[] })[]
}) | null> {
  return prisma.mailSubscription.findUnique({
    where: { id },
    include: {
      source: true,
      plan: true,
      domains: {
        include: { accounts: true }
      }
    }
  })
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
  return prisma.mailDomain.findMany({
    where: { subscriptionId },
    include: { accounts: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 根据 ID 获取域名
 */
export async function getMailDomainById(id: number): Promise<(MailDomain & {
  subscription: MailSubscription & { user: { id: number; username: string } }
  source: MailSource
  accounts: MailAccount[]
}) | null> {
  return prisma.mailDomain.findUnique({
    where: { id },
    include: {
      subscription: {
        include: { user: { select: { id: true, username: true } } }
      },
      source: true,
      accounts: true
    }
  })
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
  return prisma.mailDomain.create({ data })
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
  return prisma.mailDomain.update({ where: { id }, data })
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
  status?: MailDomainStatus
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
  const page = options?.page || 1
  const pageSize = options?.pageSize || 20
  
  const where: any = {
    ...(options?.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options?.status ? { status: options.status } : {})
  }
  
  // 搜索条件：域名、用户名、邮箱、用户ID
  if (options?.search) {
    const searchTerm = options.search.trim()
    const searchId = parseInt(searchTerm)
    where.OR = [
      { domain: { contains: searchTerm, mode: 'insensitive' } },
      { subscription: { user: { username: { contains: searchTerm, mode: 'insensitive' } } } },
      { subscription: { user: { email: { contains: searchTerm, mode: 'insensitive' } } } },
      ...(isNaN(searchId) ? [] : [{ subscription: { userId: searchId } }])
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
  
  return { domains, total }
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
