/**
 * 域名邮箱路由
 * 包含管理员配置和用户端管理功能
 */

import type { FastifyInstance } from 'fastify'
import type { MailAccount } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import * as db from '../db/mail.js'
import { calculateDiscountAmount, calculateDiscountedPrice } from '../lib/billing-calc.js'
import * as craneMailService from '../services/cranemail.js'
import * as smarterMailService from '../services/smartermail.js'
import { MAIL_DOMAIN_LOCK_NAMESPACE, MAIL_SUBSCRIPTION_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { assertSafeHttpUrl } from '../lib/outbound-security.js'

function normalizeBaseUrl(url: URL): string {
  return url.toString().replace(/\/+$/, '')
}

type MailPlanInput = {
  sourceId?: number
  name?: string
  description?: string
  domainLimit?: number
  diskLimitGb?: number
  billingCycle?: 'monthly' | 'yearly'
  price?: number
  enabled?: boolean
  sortOrder?: number
}

type MailSourceInput = {
  name?: string
  code?: string
  apiUrl?: string
  apiKey?: string
  smarterMailUrl?: string
  enabled?: boolean
  sortOrder?: number
}

type MailAccountInput = {
  username?: string
  password?: string
  displayName?: string
  diskLimitMb?: number
}

type MailSubscriptionCancelInput = {
  refundType: 'none' | 'full' | 'remaining'
  reason?: string
}

type MailSubscriptionPurchaseInput = {
  planId: number
  affCode?: string
}

const POSITIVE_ROUTE_ID_RE = /^[1-9]\d*$/
const MAIL_CANCEL_REASON_MAX_LENGTH = 500
const MAIL_SOURCE_CODE_RE = /^[a-z0-9_-]{2,32}$/
const MAIL_SOURCE_SECRET_MAX_LENGTH = 4096
const MAIL_AFF_CODE_MAX_LENGTH = 64

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  return value
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  return value
}

function normalizeMailPlanInput(input: MailPlanInput, requireAll: boolean): MailPlanInput {
  const normalized: MailPlanInput = {}

  if (requireAll && (!input.sourceId || !input.name || !input.domainLimit || !input.diskLimitGb || !input.billingCycle || input.price === undefined)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
  }

  if (input.sourceId !== undefined) {
    const sourceId = requireSafeInteger(input.sourceId, '邮箱源')
    if (sourceId <= 0) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '邮箱源无效')
    }
    normalized.sourceId = sourceId
  }

  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name || name.length > 100) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '方案名称需为 1-100 个字符')
    }
    normalized.name = name
  }

  if (input.description !== undefined) {
    const description = String(input.description).trim()
    if (description.length > 1000) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '方案描述不能超过 1000 个字符')
    }
    normalized.description = description || undefined
  }

  if (input.domainLimit !== undefined) {
    const domainLimit = requireSafeInteger(input.domainLimit, '域名数量限制')
    if (domainLimit <= 0 || domainLimit > 1000) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '域名数量限制需为 1-1000 的整数')
    }
    normalized.domainLimit = domainLimit
  }

  if (input.diskLimitGb !== undefined) {
    const diskLimitGb = requireSafeInteger(input.diskLimitGb, '磁盘容量')
    if (diskLimitGb <= 0 || diskLimitGb > 102400) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '磁盘容量需为 1-102400 GB 的整数')
    }
    normalized.diskLimitGb = diskLimitGb
  }

  if (input.billingCycle !== undefined) {
    if (input.billingCycle !== 'monthly' && input.billingCycle !== 'yearly') {
      throw apiError(ErrorCode.VALIDATION_ERROR, '计费周期无效')
    }
    normalized.billingCycle = input.billingCycle
  }

  if (input.price !== undefined) {
    const price = requireNumber(input.price, '价格')
    if (price <= 0 || price > 99999999.99) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '价格需大于 0 且不超过 99999999.99')
    }
    const roundedPrice = Math.round(price * 100) / 100
    if (Math.abs(price - roundedPrice) > 1e-8) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '价格最多支持两位小数')
    }
    normalized.price = roundedPrice
  }

  if (input.enabled !== undefined) {
    normalized.enabled = input.enabled === true
  }

  if (input.sortOrder !== undefined) {
    const sortOrder = requireSafeInteger(input.sortOrder, '排序值')
    if (sortOrder < -1000000 || sortOrder > 1000000) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '排序值无效')
    }
    normalized.sortOrder = sortOrder
  }

  return normalized
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 需为 1-${maxLength} 个字符`)
  }
  return trimmed
}

function normalizeMailSourceInput(input: unknown, requireAll: boolean): MailSourceInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  const normalized: MailSourceInput = {}

  if (requireAll && (!input.name || !input.code || !input.apiUrl || !input.apiKey || !input.smarterMailUrl)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
  }

  const name = optionalString(input.name, '邮箱源名称', 100)
  if (name !== undefined) {
    normalized.name = name
  }

  const code = optionalString(input.code, '地区代码', 32)
  if (code !== undefined) {
    const normalizedCode = code.toLowerCase()
    if (!MAIL_SOURCE_CODE_RE.test(normalizedCode)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '地区代码只能包含 2-32 位字母、数字、下划线和连字符')
    }
    normalized.code = normalizedCode
  }

  const apiUrl = optionalString(input.apiUrl, 'CraneMail API URL', 2048)
  if (apiUrl !== undefined) {
    normalized.apiUrl = apiUrl
  }

  const smarterMailUrl = optionalString(input.smarterMailUrl, 'SmarterMail URL', 2048)
  if (smarterMailUrl !== undefined) {
    normalized.smarterMailUrl = smarterMailUrl
  }

  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string') {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'API Key 无效')
    }
    const apiKey = input.apiKey.trim()
    if (requireAll && !apiKey) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'API Key 不能为空')
    }
    if (apiKey.length > MAIL_SOURCE_SECRET_MAX_LENGTH) {
      throw apiError(ErrorCode.VALIDATION_ERROR, `API Key 不能超过 ${MAIL_SOURCE_SECRET_MAX_LENGTH} 个字符`)
    }
    normalized.apiKey = apiKey
  }

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') {
      throw apiError(ErrorCode.VALIDATION_ERROR, '启用状态无效')
    }
    normalized.enabled = input.enabled
  }

  if (input.sortOrder !== undefined) {
    const sortOrder = requireSafeInteger(input.sortOrder, '排序值')
    if (sortOrder < -1000000 || sortOrder > 1000000) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '排序值无效')
    }
    normalized.sortOrder = sortOrder
  }

  return normalized
}

function normalizeMailAccountInput(input: MailAccountInput, options: {
  requireUsername?: boolean
  requirePassword?: boolean
  maxDiskLimitMb: number
}): MailAccountInput {
  const normalized: MailAccountInput = {}
  const maxDiskLimitMb = Math.floor(Number(options.maxDiskLimitMb))
  if (!Number.isInteger(maxDiskLimitMb) || maxDiskLimitMb <= 0) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '订阅磁盘配额无效')
  }

  if (options.requireUsername || input.username !== undefined) {
    const username = String(input.username || '').trim().toLowerCase()
    if (!username || username.length > 64 || !/^[a-z0-9._-]+$/i.test(username)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '用户名只能包含 1-64 位字母、数字、点、下划线和连字符')
    }
    normalized.username = username
  }

  if (options.requirePassword || input.password !== undefined) {
    const password = String(input.password || '')
    if (password.length < 8 || password.length > 128) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '密码长度需为 8-128 位')
    }
    normalized.password = password
  }

  if (input.displayName !== undefined) {
    const displayName = String(input.displayName).trim()
    if (displayName.length > 100) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '显示名称不能超过 100 个字符')
    }
    normalized.displayName = displayName || undefined
  }

  if (input.diskLimitMb !== undefined) {
    const diskLimitMb = requireSafeInteger(input.diskLimitMb, '邮箱容量')
    if (diskLimitMb <= 0 || diskLimitMb > maxDiskLimitMb) {
      throw apiError(ErrorCode.VALIDATION_ERROR, `邮箱容量需为 1-${maxDiskLimitMb} MB 的整数`)
    }
    normalized.diskLimitMb = diskLimitMb
  }

  return normalized
}

function normalizeMailRenewMonths(value: unknown): number {
  const months = requireSafeInteger(value, '续费月数')
  if (months < 1 || months > 12) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '续费月数需为 1-12 的整数')
  }
  return months
}

function normalizeMailSubscriptionPurchaseInput(input: unknown): MailSubscriptionPurchaseInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  const planId = requireSafeInteger(input.planId, '邮箱方案')
  if (planId <= 0) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '邮箱方案无效')
  }

  let affCode: string | undefined
  if (input.affCode !== undefined && input.affCode !== null) {
    if (typeof input.affCode !== 'string') {
      throw apiError(ErrorCode.VALIDATION_ERROR, '优惠码无效')
    }
    const normalizedAffCode = input.affCode.trim().toUpperCase()
    if (normalizedAffCode) {
      if (normalizedAffCode.length > MAIL_AFF_CODE_MAX_LENGTH) {
        throw apiError(ErrorCode.VALIDATION_ERROR, `优惠码不能超过 ${MAIL_AFF_CODE_MAX_LENGTH} 个字符`)
      }
      affCode = normalizedAffCode
    }
  }

  return { planId, affCode }
}

function normalizeMailSubscriptionRenewInput(input: unknown): number {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  return normalizeMailRenewMonths(input.months)
}

function normalizeMailSubscriptionCancelInput(input: unknown): MailSubscriptionCancelInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  const refundType = input.refundType
  if (refundType !== 'none' && refundType !== 'full' && refundType !== 'remaining') {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请选择退款方式')
  }

  if (input.reason !== undefined && typeof input.reason !== 'string') {
    throw apiError(ErrorCode.VALIDATION_ERROR, '退款原因无效')
  }

  const reason = input.reason?.trim()
  if (reason !== undefined && reason.length > MAIL_CANCEL_REASON_MAX_LENGTH) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `退款原因不能超过 ${MAIL_CANCEL_REASON_MAX_LENGTH} 个字符`)
  }

  if (refundType !== 'none' && !reason) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '退款时必须填写原因')
  }

  return {
    refundType,
    ...(reason ? { reason } : {})
  }
}

function parseOptionalPositiveQueryInteger(value: string | undefined, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (!value) {
    return undefined
  }

  if (!POSITIVE_ROUTE_ID_RE.test(value)) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : undefined
}

function parsePositiveQueryInteger(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  return parseOptionalPositiveQueryInteger(value, max) ?? fallback
}

function parsePositiveRouteId(value: unknown): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value
    throw apiError(ErrorCode.INVALID_PARAMS, 'ID 无效')
  }

  if (typeof value !== 'string' || !POSITIVE_ROUTE_ID_RE.test(value)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'ID 无效')
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'ID 无效')
  }

  return parsed
}

async function validateMailSourceOutboundUrls(input: {
  apiUrl?: string
  smarterMailUrl?: string
}): Promise<{ apiUrl?: string; smarterMailUrl?: string }> {
  try {
    return {
      ...(input.apiUrl !== undefined
        ? { apiUrl: normalizeBaseUrl(await assertSafeHttpUrl(input.apiUrl, 'CraneMail API URL')) }
        : {}),
      ...(input.smarterMailUrl !== undefined
        ? { smarterMailUrl: normalizeBaseUrl(await assertSafeHttpUrl(input.smarterMailUrl, 'SmarterMail URL')) }
        : {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮箱源地址无效'
    throw apiError(ErrorCode.VALIDATION_ERROR, message)
  }
}

export default async function mailRoutes(fastify: FastifyInstance) {
  // ==================== 管理员：邮箱源管理 ====================

  // 获取所有邮箱源
  fastify.get('/admin/sources', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    const sources = await db.getAllMailSources(true)
    
    // 获取每个源的统计信息
    const sourcesWithStats = await Promise.all(
      sources.map(async (source) => {
        const stats = await db.getMailSourceStats(source.id)
        return {
          ...db.sanitizeMailSourceForResponse(source),
          ...stats,
        }
      })
    )
    
    return { sources: sourcesWithStats }
  })

  // 创建邮箱源
  fastify.post<{
    Body: {
      name: string
      code: string
      apiUrl: string
      apiKey: string
      smarterMailUrl: string
      enabled?: boolean
      sortOrder?: number
    }
  }>('/admin/sources', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const sourceInput = normalizeMailSourceInput(request.body, true)

    // 检查代码是否已存在
    const existing = await db.getMailSourceByCode(sourceInput.code!)
    if (existing) {
      throw apiError(ErrorCode.SLUG_EXISTS, '该地区代码已存在')
    }

    const safeUrls = await validateMailSourceOutboundUrls({
      apiUrl: sourceInput.apiUrl,
      smarterMailUrl: sourceInput.smarterMailUrl
    })

    const source = await db.createMailSource({
      name: sourceInput.name!,
      code: sourceInput.code!,
      apiUrl: safeUrls.apiUrl!,
      apiKey: sourceInput.apiKey!,
      smarterMailUrl: safeUrls.smarterMailUrl!,
      enabled: sourceInput.enabled ?? true,
      sortOrder: sourceInput.sortOrder ?? 0
    })

    await createLog(
      request.user.id,
      'mail',
      'create_mail_source',
      `Created mail source: ${sourceInput.name}`,
      'success'
    )

    return { source: db.sanitizeMailSourceForResponse(source) }
  })

  // 更新邮箱源
  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      code?: string
      apiUrl?: string
      apiKey?: string
      smarterMailUrl?: string
      enabled?: boolean
      sortOrder?: number
    }
  }>('/admin/sources/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const id = parsePositiveRouteId(request.params.id)
    const sourceInput = normalizeMailSourceInput(request.body, false)

    const existing = await db.getMailSourceById(id)
    if (!existing) {
      throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
    }

    // 如果修改了代码，检查是否冲突
    if (sourceInput.code && sourceInput.code !== existing.code) {
      const codeExists = await db.getMailSourceByCode(sourceInput.code)
      if (codeExists) {
        throw apiError(ErrorCode.SLUG_EXISTS, '该地区代码已存在')
      }
    }

    const safeUrls = await validateMailSourceOutboundUrls({
      apiUrl: sourceInput.apiUrl,
      smarterMailUrl: sourceInput.smarterMailUrl
    })

    const source = await db.updateMailSource(id, {
      name: sourceInput.name,
      code: sourceInput.code,
      apiUrl: safeUrls.apiUrl,
      apiKey: db.mergeMailSourceApiKeyForUpdate(sourceInput.apiKey),
      smarterMailUrl: safeUrls.smarterMailUrl,
      enabled: sourceInput.enabled,
      sortOrder: sourceInput.sortOrder
    })

    await createLog(
      request.user.id,
      'mail',
      'update_mail_source',
      `Updated mail source #${id}`,
      'success'
    )

    return { source: db.sanitizeMailSourceForResponse(source) }
  })

  // 删除邮箱源
  fastify.delete<{
    Params: { id: string }
  }>('/admin/sources/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const id = parsePositiveRouteId(request.params.id)

    const source = await db.getMailSourceById(id)
    if (!source) {
      throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
    }

    // 检查是否有关联数据
    const stats = await db.getMailSourceStats(id)
    if (stats.subscriptionCount > 0 || stats.domainCount > 0) {
      throw apiError(ErrorCode.OPERATION_NOT_ALLOWED, '该邮箱源下有订阅或域名，无法删除')
    }

    await db.deleteMailSource(id)

    await createLog(
      request.user.id,
      'mail',
      'delete_mail_source',
      `Deleted mail source: ${source.name}`,
      'success'
    )

    return { success: true }
  })

  // ==================== 管理员：套餐方案管理 ====================

  // 获取所有方案
  fastify.get('/admin/plans', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    const plans = await db.getAllMailPlans()
    return { plans }
  })

  // 创建方案
  fastify.post<{
    Body: {
      sourceId: number
      name: string
      description?: string
      domainLimit: number
      diskLimitGb: number
      billingCycle: 'monthly' | 'yearly'
      price: number
      enabled?: boolean
      sortOrder?: number
    }
  }>('/admin/plans', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const planInput = normalizeMailPlanInput(request.body, true)

    // 检查邮箱源是否存在
    const source = await db.getMailSourceById(planInput.sourceId!)
    if (!source) {
      throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
    }

    const plan = await db.createMailPlan({
      sourceId: planInput.sourceId!,
      name: planInput.name!,
      description: planInput.description,
      domainLimit: planInput.domainLimit!,
      diskLimitGb: planInput.diskLimitGb!,
      billingCycle: planInput.billingCycle!,
      price: planInput.price!,
      enabled: planInput.enabled ?? true,
      sortOrder: planInput.sortOrder ?? 0
    })

    await createLog(
      request.user.id,
      'mail',
      'create_mail_plan',
      `Created mail plan: ${planInput.name}`,
      'success'
    )

    return { plan }
  })

  // 更新方案
  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      domainLimit?: number
      diskLimitGb?: number
      billingCycle?: 'monthly' | 'yearly'
      price?: number
      enabled?: boolean
      sortOrder?: number
    }
  }>('/admin/plans/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const id = parsePositiveRouteId(request.params.id)
    const data = normalizeMailPlanInput(request.body, false)

    const existing = await db.getMailPlanById(id)
    if (!existing) {
      throw apiError(ErrorCode.NOT_FOUND, '方案不存在')
    }

    if (data.sourceId !== undefined) {
      const source = await db.getMailSourceById(data.sourceId)
      if (!source) {
        throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
      }
    }

    const plan = await db.updateMailPlan(id, data)

    await createLog(
      request.user.id,
      'mail',
      'update_mail_plan',
      `Updated mail plan #${id}`,
      'success'
    )

    return { plan }
  })

  // 删除方案
  fastify.delete<{
    Params: { id: string }
  }>('/admin/plans/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const id = parsePositiveRouteId(request.params.id)

    const plan = await db.getMailPlanById(id)
    if (!plan) {
      throw apiError(ErrorCode.NOT_FOUND, '方案不存在')
    }

    // 检查是否有订阅使用此方案
    const subscriptionCount = await prisma.mailSubscription.count({ where: { planId: id } })
    if (subscriptionCount > 0) {
      throw apiError(ErrorCode.OPERATION_NOT_ALLOWED, '该方案下有订阅，无法删除')
    }

    await db.deleteMailPlan(id)

    await createLog(
      request.user.id,
      'mail',
      'delete_mail_plan',
      `Deleted mail plan: ${plan.name}`,
      'success'
    )

    return { success: true }
  })

  // ==================== 管理员：订阅管理 ====================

  // 获取所有订阅
  fastify.get<{
    Querystring: {
      sourceId?: string
      status?: string
      search?: string
      page?: string
      pageSize?: string
    }
  }>('/admin/subscriptions', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const { sourceId, status, search, page, pageSize } = request.query
    
    const result = await db.getAllMailSubscriptions({
      sourceId: parseOptionalPositiveQueryInteger(sourceId),
      status,
      search: search || undefined,
      page: parsePositiveQueryInteger(page, 1),
      pageSize: parsePositiveQueryInteger(pageSize, 20, 100)
    })
    
    return result
  })

  // 管理员退订（删除订阅）
  fastify.post<{
    Params: { id: string }
    Body: {
      refundType: 'none' | 'full' | 'remaining'
      reason?: string
    }
  }>('/admin/subscriptions/:id/cancel', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const subscriptionId = parsePositiveRouteId(request.params.id)
    const { refundType, reason } = normalizeMailSubscriptionCancelInput(request.body)

    // 获取订阅详情（包含域名和 source）
    const subscription = await prisma.mailSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: { select: { id: true, username: true, balance: true } },
        plan: true,
        source: true,
        domains: true
      }
    })

    if (!subscription) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '订阅不存在'))
    }

    const source = await db.getMailSourceById(subscription.sourceId)
    if (!source) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱源不存在'))
    }

    // 计算退款金额
    let refundAmount = 0
    const planPrice = Number(subscription.plan.price)

    if (refundType === 'full') {
      refundAmount = planPrice
    } else if (refundType === 'remaining') {
      const now = new Date()
      const expiresAt = new Date(subscription.expiresAt)
      if (expiresAt > now) {
        const totalMs = subscription.plan.billingCycle === 'monthly'
          ? 30 * 24 * 60 * 60 * 1000
          : 365 * 24 * 60 * 60 * 1000
        const remainingMs = expiresAt.getTime() - now.getTime()
        const ratio = Math.min(remainingMs / totalMs, 1)
        refundAmount = Number((planPrice * ratio).toFixed(2))
      }
      // 已过期则剩余价值为 0
    }

    // 删除 CraneMail 域名。远端删除失败时不能删除本地订阅，否则会隐藏残留资源。
    for (const domain of subscription.domains) {
      try {
        await craneMailService.deleteDomain(source, domain.domain)
      } catch (err: any) {
        console.error(`[AdminMailCancel] Failed to delete domain ${domain.domain} from CraneMail:`, err.message)
        return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `删除远端域名 ${domain.domain} 失败: ${err.message}`))
      }
    }

    // DB 事务：退款 + 删除订阅
    await prisma.$transaction(async (tx) => {
      if (refundAmount > 0) {
        const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, subscription.user.id)
        if (!balanceLocked) {
          throw apiError(ErrorCode.OPERATION_NOT_ALLOWED, '用户余额正在处理，请稍后重试')
        }

        const currentUser = await tx.user.findUnique({
          where: { id: subscription.user.id },
          select: { balance: true }
        })
        const oldBalance = Number(currentUser?.balance || 0)

        const updatedUser = await tx.user.update({
          where: { id: subscription.user.id },
          data: { balance: { increment: refundAmount } },
          select: { balance: true }
        })
        const newBalance = Number(updatedUser.balance)

        await tx.balanceLog.create({
          data: {
            userId: subscription.user.id,
            type: 'refund',
            amount: refundAmount,
            balanceBefore: oldBalance,
            balanceAfter: newBalance,
            remark: `管理员退订邮箱 - ${subscription.plan.name}（${refundType === 'full' ? '全额退款' : '剩余价值退款'}）原因：${reason}`
          }
        })
      }

      // 删除订阅（cascade 删除域名、账户、AFF 绑定）
      await tx.mailSubscription.delete({
        where: { id: subscriptionId }
      })
    })

    await createLog(
      request.user.id,
      'mail',
      'admin_cancel_mail_subscription',
      `Admin cancelled mail subscription #${subscriptionId} for user ${subscription.user.username} (refund: ${refundType}, amount: ${refundAmount})`,
      'success'
    )

    return {
      success: true,
      refundAmount,
      refundType
    }
  })

  // ==================== 管理员：域名管理 ====================

  // 获取所有域名
  fastify.get<{
    Querystring: {
      sourceId?: string
      status?: string
      search?: string
      page?: string
      pageSize?: string
    }
  }>('/admin/domains', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const { sourceId, status, search, page, pageSize } = request.query
    
    const result = await db.getAllMailDomains({
      sourceId: parseOptionalPositiveQueryInteger(sourceId),
      status,
      search: search || undefined,
      page: parsePositiveQueryInteger(page, 1),
      pageSize: parsePositiveQueryInteger(pageSize, 20, 100)
    })
    
    return result
  })

  // ==================== 用户端：公开接口 ====================

  // 获取可购买的邮箱源和方案
  fastify.get('/sources', {
    onRequest: [fastify.authenticate]
  }, async () => {
    if (!await db.hasAvailableMailOffering()) {
      return { sources: [] }
    }

    const sources = await db.getAllMailSources(false)
    
    const sourcesWithPlans = await Promise.all(
      sources.map(async (source) => {
        const plans = await db.getMailPlansBySource(source.id, false)
        return {
          id: source.id,
          name: source.name,
          code: source.code,
          plans: plans.map(plan => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            domainLimit: plan.domainLimit,
            diskLimitGb: plan.diskLimitGb,
            billingCycle: plan.billingCycle,
            price: Number(plan.price)
          }))
        }
      })
    )
    
    return { sources: sourcesWithPlans }
  })

  // ==================== 用户端：订阅管理 ====================

  // 验证邮件优惠码
  fastify.post<{
    Body: { code: string }
  }>('/validate-aff', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { code } = request.body
    const userId = request.user.id

    if (!code || !code.trim()) {
      return { valid: false, error: '请输入优惠码' }
    }

    const { validateMailAffCode } = await import('../db/aff.js')
    const validation = await validateMailAffCode(code.trim(), userId)
    
    return {
      valid: validation.valid,
      discountRate: validation.discountRate,
      commissionRate: validation.commissionRate,
      error: validation.error
    }
  })

  // 获取我的订阅
  fastify.get('/subscription', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const subscription = await db.getUserMailSubscription(request.user.id)
    
    if (!subscription) {
      return { subscription: null }
    }
    
    // 获取使用统计
    const usage = await db.getSubscriptionUsageStats(subscription.id)
    
    // 获取 AFF 绑定信息
    const { getMailSubscriptionAffBinding } = await import('../db/aff.js')
    const affBinding = await getMailSubscriptionAffBinding(subscription.id)
    
    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
        autoRenew: subscription.autoRenew,
        source: {
          id: subscription.source.id,
          name: subscription.source.name,
          code: subscription.source.code
        },
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          domainLimit: subscription.domainLimit,
          diskLimitGb: subscription.diskLimitGb,
          billingCycle: subscription.plan.billingCycle,
          price: Number(subscription.plan.price)
        },
        usage: {
          domainCount: usage.domainCount,
          accountCount: usage.accountCount,
          diskUsedGb: Math.round(usage.diskUsedMb / 1024 * 100) / 100
        },
        domains: subscription.domains.map(d => ({
          id: d.id,
          domain: d.domain,
          status: d.status,
          accountCount: (d as any).accounts?.length || 0,
          diskUsedMb: d.diskUsedMb,
          verifiedAt: d.verifiedAt,
          createdAt: d.createdAt
        })),
        affBinding: affBinding ? {
          affCode: {
            code: affBinding.affCode.code,
            discountRate: Number(affBinding.affCode.discountRate)
          }
        } : null
      }
    }
  })

  // 购买订阅
  fastify.post<{
    Body: {
      planId: number
      affCode?: string
    }
  }>('/subscription', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    let purchaseInput: MailSubscriptionPurchaseInput
    try {
      purchaseInput = normalizeMailSubscriptionPurchaseInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }

    const { planId, affCode: affCodeInput } = purchaseInput
    const userId = request.user.id

    // 检查是否已有订阅
    const existing = await db.getUserMailSubscription(userId)
    if (existing) {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '您已有邮箱订阅，请续费或等待过期后再购买'))
    }

    // 获取方案
    const plan = await db.getMailPlanById(planId)
    if (!plan || !plan.enabled) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '方案不存在或已下架'))
    }

    const source = plan.source
    if (!source.enabled) {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '该邮箱源已停用'))
    }

    // 计算费用
    const originalPrice = Number(plan.price)
    let finalPrice = originalPrice
    let discountAmount = 0
    let validatedAffCode: { id: number; userId: number; discountRate: number } | null = null

    // 验证优惠码
    if (affCodeInput) {
      const { validateMailAffCode } = await import('../db/aff.js')
      const validation = await validateMailAffCode(affCodeInput, userId)
      if (!validation.valid) {
        return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, validation.error || '优惠码无效'))
      }
      validatedAffCode = {
        id: validation.affCode!.id,
        userId: validation.affCode!.userId,
        discountRate: validation.discountRate!
      }
      // 计算折扣金额（折扣应用于方案价格）
      discountAmount = calculateDiscountAmount(originalPrice, validatedAffCode.discountRate)
      finalPrice = calculateDiscountedPrice(originalPrice, validatedAffCode.discountRate)
    }

    // 检查余额
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    if (!user || Number(user.balance) < finalPrice) {
      return reply.code(400).send(apiError(ErrorCode.INSUFFICIENT_BALANCE, `余额不足，需要 ¥${finalPrice.toFixed(2)}，当前余额 ¥${Number(user?.balance || 0).toFixed(2)}`))
    }

    // 计算到期时间
    const expiresAt = new Date()
    if (plan.billingCycle === 'monthly') {
      expiresAt.setMonth(expiresAt.getMonth() + 1)
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1)
    }

    // 事务：扣费 + 创建订阅 + 处理AFF
    const purchaseResult = await prisma.$transaction(async (tx) => {
      const locked = await tryAdvisoryTransactionLock(tx, MAIL_SUBSCRIPTION_LOCK_NAMESPACE, userId)
      if (!locked) {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '邮箱订阅正在处理，请稍后重试') }
      }
      const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
      if (!balanceLocked) {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '用户余额正在处理，请稍后重试') }
      }

      const existingInTx = await tx.mailSubscription.findFirst({
        where: { userId }
      })
      if (existingInTx) {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '您已有邮箱订阅，请续费或等待过期后再购买') }
      }

      const deductResult = await tx.user.updateMany({
        where: {
          id: userId,
          balance: { gte: finalPrice }
        },
        data: { balance: { decrement: finalPrice } }
      })
      if (deductResult.count === 0) {
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true }
        })
        return { error: apiError(ErrorCode.INSUFFICIENT_BALANCE, `余额不足，需要 ¥${finalPrice.toFixed(2)}，当前余额 ¥${Number(currentUser?.balance || 0).toFixed(2)}`) }
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })
      const balanceAfter = Number(updatedUser?.balance || 0)
      const balanceBefore = Number((balanceAfter + finalPrice).toFixed(2))

      await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -finalPrice,
          balanceBefore,
          balanceAfter,
          remark: validatedAffCode 
            ? `购买域名邮箱 - ${plan.name} (折扣 ¥${discountAmount.toFixed(2)})`
            : `购买域名邮箱 - ${plan.name} (${source.name})`
        }
      })

      // 创建订阅
      const newSubscription = await tx.mailSubscription.create({
        data: {
          userId,
          sourceId: source.id,
          planId: plan.id,
          domainLimit: plan.domainLimit,
          diskLimitGb: plan.diskLimitGb,
          expiresAt
        },
        include: {
          source: true,
          plan: true
        }
      })

      // 如果使用了优惠码，创建 AFF 绑定并处理返利
      if (validatedAffCode) {
        const { createMailAffBinding, processMailAffCommission } = await import('../db/aff.js')
        // 创建订阅与优惠码的永久绑定
        await createMailAffBinding(newSubscription.id, validatedAffCode.id, tx as any)
        // 给优惠码创建者返利（基于原价，不是折扣后价格）
        await processMailAffCommission(
          validatedAffCode.id,
          newSubscription.id,
          originalPrice,
          'new_purchase',
          tx as any
        )
      }

      return { subscription: newSubscription }
    })

    if ('error' in purchaseResult) {
      return reply.code(400).send(purchaseResult.error)
    }

    const subscription = purchaseResult.subscription

    await createLog(
      userId,
      'mail',
      'purchase_mail_subscription',
      `Purchased mail subscription: planId=${planId}, price=${finalPrice}${validatedAffCode ? `, affDiscount=${discountAmount}` : ''}`,
      'success'
    )

    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
        source: { id: subscription.source.id, name: subscription.source.name },
        plan: { id: subscription.plan.id, name: subscription.plan.name }
      },
      discountApplied: discountAmount > 0,
      discountAmount,
      finalPrice
    }
  })

  // 续费订阅
  fastify.post<{
    Body: { months: unknown }
  }>('/subscription/renew', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id
    let renewMonths: number
    try {
      renewMonths = normalizeMailSubscriptionRenewInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }

    const subscription = await db.getUserMailSubscription(userId)
    if (!subscription) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '您没有邮箱订阅'))
    }

    // 检查订阅状态
    if (subscription.status === 'suspended') {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '订阅已被暂停，无法续费'))
    }

    const plan = subscription.plan
    const monthlyPrice = plan.billingCycle === 'monthly' 
      ? Number(plan.price) 
      : Number(plan.price) / 12
    
    const originalPrice = Math.round(monthlyPrice * renewMonths * 100) / 100

    // 检查 AFF 绑定，计算折扣
    const { getMailSubscriptionAffBinding, processMailAffCommission } = await import('../db/aff.js')
    const affBinding = await getMailSubscriptionAffBinding(subscription.id)
    let discountRate = 0
    let discountAmount = 0
    let finalPrice = originalPrice

    if (affBinding && affBinding.affCode.enabled) {
      discountRate = Number(affBinding.affCode.discountRate)
      discountAmount = calculateDiscountAmount(originalPrice, discountRate)
      finalPrice = calculateDiscountedPrice(originalPrice, discountRate)
    }

    // 检查余额
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    if (!user || Number(user.balance) < finalPrice) {
      return reply.code(400).send(apiError(ErrorCode.INSUFFICIENT_BALANCE, `余额不足，需要 ¥${finalPrice.toFixed(2)}，当前余额 ¥${Number(user?.balance || 0).toFixed(2)}`))
    }

    // 事务：扣费 + 续费 + 返利
    const renewResult = await prisma.$transaction(async (tx) => {
      const locked = await tryAdvisoryTransactionLock(tx, MAIL_SUBSCRIPTION_LOCK_NAMESPACE, userId)
      if (!locked) {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '邮箱订阅正在处理，请稍后重试') }
      }
      const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
      if (!balanceLocked) {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '用户余额正在处理，请稍后重试') }
      }

      const currentSubscription = await tx.mailSubscription.findUnique({
        where: { id: subscription.id },
        include: { plan: true }
      })
      if (!currentSubscription || currentSubscription.userId !== userId) {
        return { error: apiError(ErrorCode.NOT_FOUND, '您没有邮箱订阅') }
      }
      if (currentSubscription.status === 'suspended') {
        return { error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '订阅已被暂停，无法续费') }
      }

      const deductResult = await tx.user.updateMany({
        where: {
          id: userId,
          balance: { gte: finalPrice }
        },
        data: { balance: { decrement: finalPrice } }
      })
      if (deductResult.count === 0) {
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true }
        })
        return { error: apiError(ErrorCode.INSUFFICIENT_BALANCE, `余额不足，需要 ¥${finalPrice.toFixed(2)}，当前余额 ¥${Number(currentUser?.balance || 0).toFixed(2)}`) }
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })
      const balanceAfter = Number(updatedUser?.balance || 0)
      const balanceBefore = Number((balanceAfter + finalPrice).toFixed(2))
      const remarkText = discountAmount > 0
        ? `续费域名邮箱 ${renewMonths} 个月（优惠码折扣 -¥${discountAmount.toFixed(2)}）`
        : `续费域名邮箱 ${renewMonths} 个月`
      
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -finalPrice,
          balanceBefore,
          balanceAfter,
          remark: remarkText
        }
      })

      // 计算新的过期时间
      const currentExpiry = currentSubscription.expiresAt > new Date() ? currentSubscription.expiresAt : new Date()
      const newExpiry = new Date(currentExpiry)
      newExpiry.setMonth(newExpiry.getMonth() + renewMonths)

      // 更新订阅
      const result = await tx.mailSubscription.update({
        where: { id: subscription.id },
        data: { expiresAt: newExpiry, status: 'active' }
      })

      // 如果有 AFF 绑定，给推荐人返利
      if (affBinding) {
        await processMailAffCommission(
          affBinding.affCode.id,
          subscription.id,
          originalPrice, // 基于原价计算返利
          'renew',
          tx as any
        )
      }

      return { subscription: result }
    })

    if ('error' in renewResult) {
      return reply.code(400).send(renewResult.error)
    }

    const updated = renewResult.subscription

    await createLog(
      userId,
      'mail',
      'renew_mail_subscription',
      `Renewed mail subscription for ${renewMonths} months, price=${finalPrice}${discountAmount > 0 ? `, affDiscount=${discountAmount}` : ''}`,
      'success'
    )

    return { 
      expiresAt: updated.expiresAt,
      discountApplied: discountAmount > 0,
      discountAmount,
      finalPrice
    }
  })

  // ==================== 用户端：域名管理 ====================

  // 获取我的域名列表
  fastify.get('/domains', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const subscription = await db.getUserMailSubscription(request.user.id)
    if (!subscription) {
      return { domains: [] }
    }

    const domains = await db.getMailDomainsBySubscription(subscription.id)
    return {
      domains: domains.map(d => ({
        id: d.id,
        domain: d.domain,
        status: d.status,
        accountCount: d.accounts.length,
        diskUsedMb: d.diskUsedMb,
        verifiedAt: d.verifiedAt,
        createdAt: d.createdAt
      }))
    }
  })

  // 获取域名详情
  fastify.get<{
    Params: { id: string }
  }>('/domains/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.id)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    return {
      domain: {
        id: domain.id,
        domain: domain.domain,
        status: domain.status,
        diskUsedMb: domain.diskUsedMb,
        verifiedAt: domain.verifiedAt,
        createdAt: domain.createdAt,
        adminUsername: domain.adminUsername,
        adminPassword: domain.adminPassword,
        sourceCode: domain.source.code,
        accounts: domain.accounts.map((a: MailAccount) => ({
          id: a.id,
          email: a.email,
          username: a.username,
          displayName: a.displayName,
          diskLimitMb: a.diskLimitMb,
          diskUsedMb: a.diskUsedMb,
          isAdmin: a.isAdmin,
          createdAt: a.createdAt
        }))
      }
    }
  })

  // 添加域名
  fastify.post<{
    Body: { domain: string }
  }>('/domains', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { domain: domainName } = request.body
    const userId = request.user.id
    const normalizedDomain = domainName?.toLowerCase()

    if (!normalizedDomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(normalizedDomain)) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '请输入有效的域名'))
    }

    const subscription = await db.getUserMailSubscription(userId)
    if (!subscription) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '您没有邮箱订阅'))
    }

    if (subscription.status !== 'active') {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '订阅已过期或暂停'))
    }

    const createResult = await prisma.$transaction(async (tx) => {
      const subscriptionLocked = await tryAdvisoryTransactionLock(tx, MAIL_SUBSCRIPTION_LOCK_NAMESPACE, userId)
      if (!subscriptionLocked) {
        return { statusCode: 400, error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '邮箱订阅正在处理，请稍后重试') }
      }

      const domainLocked = await tryAdvisoryTransactionLock(tx, MAIL_DOMAIN_LOCK_NAMESPACE, subscription.sourceId)
      if (!domainLocked) {
        return { statusCode: 400, error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '邮箱域名正在处理，请稍后重试') }
      }

      const currentSubscription = await tx.mailSubscription.findUnique({
        where: { id: subscription.id }
      })
      if (!currentSubscription || currentSubscription.userId !== userId) {
        return { statusCode: 404, error: apiError(ErrorCode.NOT_FOUND, '您没有邮箱订阅') }
      }
      if (currentSubscription.status !== 'active') {
        return { statusCode: 400, error: apiError(ErrorCode.OPERATION_NOT_ALLOWED, '订阅已过期或暂停') }
      }

      const domainCount = await tx.mailDomain.count({
        where: { subscriptionId: currentSubscription.id }
      })
      if (domainCount >= currentSubscription.domainLimit) {
        return { statusCode: 400, error: apiError(ErrorCode.QUOTA_EXCEEDED, '已达域名数量上限') }
      }

      const exists = await tx.mailDomain.findUnique({
        where: {
          domain_sourceId: {
            domain: normalizedDomain,
            sourceId: currentSubscription.sourceId
          }
        }
      })
      if (exists) {
        return { statusCode: 400, error: apiError(ErrorCode.RESOURCE_EXISTS, '该域名已被使用') }
      }

      let craneResult: { username?: string; password?: string; server?: string } = {}
      try {
        craneResult = await craneMailService.createDomain(subscription.source, normalizedDomain, currentSubscription.diskLimitGb)
      } catch (err: any) {
        return { statusCode: 502, error: apiError(ErrorCode.UPSTREAM_ERROR, `创建域名失败: ${err.message}`) }
      }

      const mailDomain = await db.createMailDomainWithTx(tx, {
        subscriptionId: currentSubscription.id,
        sourceId: currentSubscription.sourceId,
        domain: normalizedDomain,
        adminUsername: craneResult.username,
        adminPassword: craneResult.password
      })

      if (craneResult.username && craneResult.password) {
        const usernameWithoutDomain = craneResult.username.split('@')[0] || 'postmaster'
        await tx.mailAccount.create({
          data: {
            domainId: mailDomain.id,
            email: craneResult.username,
            username: usernameWithoutDomain,
            displayName: 'Administrator',
            isAdmin: true,
            diskLimitMb: currentSubscription.diskLimitGb * 1024
          }
        })
      }

      return { mailDomain }
    })

    if ('error' in createResult) {
      return reply.code(createResult.statusCode!).send(createResult.error)
    }

    const mailDomain = createResult.mailDomain

    await createLog(
      userId,
      'mail',
      'add_mail_domain',
      `Added mail domain: ${normalizedDomain}`,
      'success'
    )

    return {
      domain: {
        id: mailDomain.id,
        domain: mailDomain.domain,
        status: mailDomain.status,
        createdAt: mailDomain.createdAt
      }
    }
  })

  // 刷新域名验证状态
  fastify.post<{
    Params: { id: string }
  }>('/domains/:id/verify', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.id)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    // 调用 CraneMail API 检查验证状态
    try {
      const info = await craneMailService.getDomainInfo(domain.source, domain.domain)
      
      if (info.verified) {
        await db.updateMailDomain(domainId, {
          status: 'verified',
          verifiedAt: new Date()
        })
        return { status: 'verified', verified: true }
      }
      
      return {
        status: 'pending',
        verified: false,
        txtRecord: info.txtRecord
      }
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `检查验证状态失败: ${err.message}`))
    }
  })

  // 获取域名 DNS 配置信息
  fastify.get<{
    Params: { id: string }
  }>('/domains/:id/dns', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.id)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    // 获取 DNS 配置信息
    try {
      const info = await craneMailService.getDomainInfo(domain.source, domain.domain)
      return {
        verified: info.verified,
        txtRecord: info.txtRecord,
        dnsRecords: info.dnsRecords,
        mxRecords: info.mxRecords,
        spfRecord: info.spfRecord,
        dkimRecord: info.dkimRecord,
        cnameRecords: info.cnameRecords
      }
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `获取 DNS 配置失败: ${err.message}`))
    }
  })

  // 删除域名
  fastify.delete<{
    Params: { id: string }
  }>('/domains/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.id)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    // 调用 CraneMail API 删除域名
    try {
      await craneMailService.deleteDomain(domain.source, domain.domain)
    } catch (err: any) {
      console.error('CraneMail delete domain error:', err)
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `删除远端域名失败: ${err.message}`))
    }

    await db.deleteMailDomain(domainId)

    await createLog(
      request.user.id,
      'mail',
      'delete_mail_domain',
      `Deleted mail domain: ${domain.domain}`,
      'success'
    )

    return { success: true }
  })

  // ==================== 用户端：邮箱账户管理 ====================

  // 获取域名下的邮箱账户
  fastify.get<{
    Params: { domainId: string }
  }>('/domains/:domainId/accounts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.domainId)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const accounts = await db.getMailAccountsByDomain(domainId)
    return {
      accounts: accounts.map(a => ({
        id: a.id,
        email: a.email,
        username: a.username,
        displayName: a.displayName,
        diskLimitMb: a.diskLimitMb,
        diskUsedMb: a.diskUsedMb,
        isAdmin: a.isAdmin,
        createdAt: a.createdAt
      }))
    }
  })

  // 创建邮箱账户
  fastify.post<{
    Params: { domainId: string }
    Body: {
      username: string
      password: string
      displayName?: string
      diskLimitMb?: number
      isAdmin?: boolean
    }
  }>('/domains/:domainId/accounts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.domainId)
    const { username, password, displayName, diskLimitMb } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    if (domain.status !== 'verified') {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '请先完成域名验证'))
    }

    const maxDiskLimitMb = domain.subscription.diskLimitGb * 1024
    const accountInput = normalizeMailAccountInput({ username, password, displayName, diskLimitMb }, {
      requireUsername: true,
      requirePassword: true,
      maxDiskLimitMb
    })
    const accountDiskLimitMb = accountInput.diskLimitMb ?? Math.min(2048, maxDiskLimitMb)

    // 检查账户是否已存在
    const exists = await db.checkMailAccountExists(domainId, accountInput.username!)
    if (exists) {
      return reply.code(400).send(apiError(ErrorCode.RESOURCE_EXISTS, '该邮箱账户已存在'))
    }

    const email = `${accountInput.username!}@${domain.domain}`

    // 调用 SmarterMail API 创建账户
    try {
      await smarterMailService.createAccount(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        {
          username: accountInput.username!,
          password: accountInput.password!,
          displayName: accountInput.displayName || accountInput.username!,
          diskLimitMb: accountDiskLimitMb
        }
      )
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `创建邮箱账户失败: ${err.message}`))
    }

    // 保存到数据库；如果本地落库失败，需要补偿删除已创建的远端账号，避免产生面板不可见的孤儿邮箱。
    let account: Awaited<ReturnType<typeof db.createMailAccount>>
    try {
      account = await db.createMailAccount({
        domainId,
        email,
        username: accountInput.username!,
        displayName: accountInput.displayName || accountInput.username!,
        diskLimitMb: accountDiskLimitMb,
        isAdmin: false
      })
    } catch (err: any) {
      try {
        await smarterMailService.deleteAccount(
          domain.source,
          domain.domain,
          domain.adminUsername!,
          domain.adminPassword!,
          accountInput.username!
        )
      } catch (compensationError) {
        console.error('SmarterMail account create compensation failed:', compensationError)
        return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, '邮箱账户已在远端创建，但本地记录保存失败且远端补偿删除失败，请联系管理员处理'))
      }

      console.error('Mail account local create failed after upstream create:', err)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, '邮箱账户创建失败，已回滚远端账号，请重试'))
    }

    await createLog(
      request.user.id,
      'mail',
      'create_mail_account',
      `Created mail account: ${email}`,
      'success'
    )

    return {
      account: {
        id: account.id,
        email: account.email,
        username: account.username,
        displayName: account.displayName,
        diskLimitMb: account.diskLimitMb,
        isAdmin: account.isAdmin
      }
    }
  })

  // 更新邮箱账户
  fastify.put<{
    Params: { domainId: string; accountId: string }
    Body: {
      displayName?: string
      diskLimitMb?: number
    }
  }>('/domains/:domainId/accounts/:accountId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.domainId)
    const accountId = parsePositiveRouteId(request.params.accountId)
    const { displayName, diskLimitMb } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const account = await db.getMailAccountById(accountId)
    if (!account || account.domainId !== domainId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱账户不存在'))
    }

    const accountInput = normalizeMailAccountInput({ displayName, diskLimitMb }, {
      maxDiskLimitMb: domain.subscription.diskLimitGb * 1024
    })

    // 调用 SmarterMail API 更新账户
    try {
      await smarterMailService.updateAccount(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        account.username,
        {
          displayName: accountInput.displayName,
          diskLimitMb: accountInput.diskLimitMb
        }
      )
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `更新邮箱账户失败: ${err.message}`))
    }

    const updated = await db.updateMailAccount(accountId, {
      displayName: accountInput.displayName,
      diskLimitMb: accountInput.diskLimitMb
    })

    return {
      account: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        diskLimitMb: updated.diskLimitMb
      }
    }
  })

  // 重置邮箱账户密码
  fastify.post<{
    Params: { domainId: string; accountId: string }
    Body: { password: string }
  }>('/domains/:domainId/accounts/:accountId/reset-password', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.domainId)
    const accountId = parsePositiveRouteId(request.params.accountId)
    const { password } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const account = await db.getMailAccountById(accountId)
    if (!account || account.domainId !== domainId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱账户不存在'))
    }

    const passwordInput = normalizeMailAccountInput({ password }, {
      requirePassword: true,
      maxDiskLimitMb: domain.subscription.diskLimitGb * 1024
    })

    // 调用 SmarterMail API 重置密码
    try {
      await smarterMailService.resetPassword(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        account.username,
        passwordInput.password!
      )
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `重置密码失败: ${err.message}`))
    }

    await createLog(
      request.user.id,
      'mail',
      'reset_mail_account_password',
      `Reset password for mail account: ${account.email}`,
      'success'
    )

    return { success: true }
  })

  // 删除邮箱账户
  fastify.delete<{
    Params: { domainId: string; accountId: string }
  }>('/domains/:domainId/accounts/:accountId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const domainId = parsePositiveRouteId(request.params.domainId)
    const accountId = parsePositiveRouteId(request.params.accountId)
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const account = await db.getMailAccountById(accountId)
    if (!account || account.domainId !== domainId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱账户不存在'))
    }

    // 调用 SmarterMail API 删除账户
    try {
      await smarterMailService.deleteAccount(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        account.username
      )
    } catch (err: any) {
      console.error('SmarterMail delete account error:', err)
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `删除远端邮箱账户失败: ${err.message}`))
    }

    await db.deleteMailAccount(accountId)

    await createLog(
      request.user.id,
      'mail',
      'delete_mail_account',
      `Deleted mail account: ${account.email}`,
      'success'
    )

    return { success: true }
  })
}
