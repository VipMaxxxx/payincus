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
          ...source,
          ...stats,
          // 隐藏敏感信息
          apiKey: '***' + source.apiKey.slice(-4)
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
    const { name, code, apiUrl, apiKey, smarterMailUrl, enabled, sortOrder } = request.body

    if (!name || !code || !apiUrl || !apiKey || !smarterMailUrl) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
    }

    // 检查代码是否已存在
    const existing = await db.getMailSourceByCode(code)
    if (existing) {
      throw apiError(ErrorCode.SLUG_EXISTS, '该地区代码已存在')
    }

    const source = await db.createMailSource({
      name,
      code: code.toLowerCase(),
      apiUrl,
      apiKey,
      smarterMailUrl,
      enabled: enabled ?? true,
      sortOrder: sortOrder ?? 0
    })

    await createLog(
      request.user.id,
      'mail',
      'create_mail_source',
      `Created mail source: ${name}`,
      'success'
    )

    return { source }
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
    const id = parseInt(request.params.id)
    const { name, code, apiUrl, apiKey, smarterMailUrl, enabled, sortOrder } = request.body

    const existing = await db.getMailSourceById(id)
    if (!existing) {
      throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
    }

    // 如果修改了代码，检查是否冲突
    if (code && code !== existing.code) {
      const codeExists = await db.getMailSourceByCode(code)
      if (codeExists) {
        throw apiError(ErrorCode.SLUG_EXISTS, '该地区代码已存在')
      }
    }

    const source = await db.updateMailSource(id, {
      name,
      code: code?.toLowerCase(),
      apiUrl,
      apiKey,
      smarterMailUrl,
      enabled,
      sortOrder
    })

    await createLog(
      request.user.id,
      'mail',
      'update_mail_source',
      `Updated mail source #${id}`,
      'success'
    )

    return { source }
  })

  // 删除邮箱源
  fastify.delete<{
    Params: { id: string }
  }>('/admin/sources/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request) => {
    const id = parseInt(request.params.id)

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
    const { sourceId, name, description, domainLimit, diskLimitGb, billingCycle, price, enabled, sortOrder } = request.body

    if (!sourceId || !name || !domainLimit || !diskLimitGb || !billingCycle || price === undefined) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
    }

    // 检查邮箱源是否存在
    const source = await db.getMailSourceById(sourceId)
    if (!source) {
      throw apiError(ErrorCode.NOT_FOUND, '邮箱源不存在')
    }

    const plan = await db.createMailPlan({
      sourceId,
      name,
      description,
      domainLimit,
      diskLimitGb,
      billingCycle,
      price,
      enabled: enabled ?? true,
      sortOrder: sortOrder ?? 0
    })

    await createLog(
      request.user.id,
      'mail',
      'create_mail_plan',
      `Created mail plan: ${name}`,
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
    const id = parseInt(request.params.id)
    const data = request.body

    const existing = await db.getMailPlanById(id)
    if (!existing) {
      throw apiError(ErrorCode.NOT_FOUND, '方案不存在')
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
    const id = parseInt(request.params.id)

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
      sourceId: sourceId ? parseInt(sourceId) : undefined,
      status: status as any,
      search: search || undefined,
      page: parseInt(page || '1'),
      pageSize: parseInt(pageSize || '20')
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
    const subscriptionId = parseInt(request.params.id)
    const { refundType, reason } = request.body

    if (!refundType || !['none', 'full', 'remaining'].includes(refundType)) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '请选择退款方式'))
    }

    if (refundType !== 'none' && (!reason || !reason.trim())) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '退款时必须填写原因'))
    }

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

    // 删除 CraneMail 域名
    for (const domain of subscription.domains) {
      try {
        await craneMailService.deleteDomain(subscription.source, domain.domain)
      } catch (err: any) {
        console.error(`[AdminMailCancel] Failed to delete domain ${domain.domain} from CraneMail:`, err.message)
        // 继续处理，不阻塞
      }
    }

    // DB 事务：退款 + 删除订阅
    await prisma.$transaction(async (tx) => {
      if (refundAmount > 0) {
        const oldBalance = Number(subscription.user.balance)
        const newBalance = oldBalance + refundAmount

        await tx.user.update({
          where: { id: subscription.user.id },
          data: { balance: { increment: refundAmount } }
        })

        await tx.balanceLog.create({
          data: {
            userId: subscription.user.id,
            type: 'refund',
            amount: refundAmount,
            balanceBefore: oldBalance,
            balanceAfter: newBalance,
            remark: `管理员退订邮箱 - ${subscription.plan.name}（${refundType === 'full' ? '全额退款' : '剩余价值退款'}）原因：${reason!.trim()}`
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
      sourceId: sourceId ? parseInt(sourceId) : undefined,
      status: status as any,
      search: search || undefined,
      page: parseInt(page || '1'),
      pageSize: parseInt(pageSize || '20')
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
    const { planId, affCode: affCodeInput } = request.body
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
    if (affCodeInput && affCodeInput.trim()) {
      const { validateMailAffCode } = await import('../db/aff.js')
      const validation = await validateMailAffCode(affCodeInput.trim(), userId)
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
    const subscription = await prisma.$transaction(async (tx) => {
      // 扣除余额
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: finalPrice } }
      })

      // 记录余额日志
      const userBalance = Number(user.balance)
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -finalPrice,
          balanceBefore: userBalance,
          balanceAfter: Number((userBalance - finalPrice).toFixed(2)),
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

      return newSubscription
    })

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
    Body: { months: number }
  }>('/subscription/renew', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { months } = request.body
    const userId = request.user.id

    if (!months || months < 1 || months > 12) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '续费月数需在 1-12 之间'))
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
    
    const originalPrice = Math.round(monthlyPrice * months * 100) / 100

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
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: finalPrice } }
      })

      const userBalance = Number(user.balance)
      const remarkText = discountAmount > 0
        ? `续费域名邮箱 ${months} 个月（优惠码折扣 -¥${discountAmount.toFixed(2)}）`
        : `续费域名邮箱 ${months} 个月`
      
      await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -finalPrice,
          balanceBefore: userBalance,
          balanceAfter: Number((userBalance - finalPrice).toFixed(2)),
          remark: remarkText
        }
      })

      // 计算新的过期时间
      const currentExpiry = subscription.expiresAt > new Date() ? subscription.expiresAt : new Date()
      const newExpiry = new Date(currentExpiry)
      newExpiry.setMonth(newExpiry.getMonth() + months)

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

      return result
    })

    await createLog(
      userId,
      'mail',
      'renew_mail_subscription',
      `Renewed mail subscription for ${months} months, price=${finalPrice}${discountAmount > 0 ? `, affDiscount=${discountAmount}` : ''}`,
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
    const domainId = parseInt(request.params.id)
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

    if (!domainName || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(domainName)) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '请输入有效的域名'))
    }

    const subscription = await db.getUserMailSubscription(userId)
    if (!subscription) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '您没有邮箱订阅'))
    }

    if (subscription.status !== 'active') {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '订阅已过期或暂停'))
    }

    // 检查域名数量限制
    const usage = await db.getSubscriptionUsageStats(subscription.id)
    if (usage.domainCount >= subscription.domainLimit) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_EXCEEDED, '已达域名数量上限'))
    }

    // 检查域名是否已存在
    const exists = await db.checkMailDomainExists(domainName.toLowerCase(), subscription.sourceId)
    if (exists) {
      return reply.code(400).send(apiError(ErrorCode.RESOURCE_EXISTS, '该域名已被使用'))
    }

    // 调用 CraneMail API 创建域名
    const source = subscription.source
    let craneResult: { username?: string; password?: string; server?: string } = {}
    
    try {
      craneResult = await craneMailService.createDomain(source, domainName.toLowerCase(), subscription.diskLimitGb)
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `创建域名失败: ${err.message}`))
    }

    // 保存域名
    const mailDomain = await db.createMailDomain({
      subscriptionId: subscription.id,
      sourceId: subscription.sourceId,
      domain: domainName.toLowerCase(),
      adminUsername: craneResult.username,
      adminPassword: craneResult.password
    })

    // 如果 API 返回了管理员账号，自动创建账户记录
    if (craneResult.username && craneResult.password) {
      const usernameWithoutDomain = craneResult.username.split('@')[0] || 'postmaster'
      await db.createMailAccount({
        domainId: mailDomain.id,
        email: craneResult.username,
        username: usernameWithoutDomain,
        displayName: 'Administrator',
        isAdmin: true,
        diskLimitMb: subscription.diskLimitGb * 1024 // 管理员账号使用全部配额
      })
    }

    await createLog(
      userId,
      'mail',
      'add_mail_domain',
      `Added mail domain: ${domainName}`,
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
    const domainId = parseInt(request.params.id)
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
    const domainId = parseInt(request.params.id)
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
    const domainId = parseInt(request.params.id)
    const domain = await db.getMailDomainById(domainId)
    
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    // 调用 CraneMail API 删除域名
    try {
      await craneMailService.deleteDomain(domain.source, domain.domain)
    } catch (err: any) {
      console.error('CraneMail delete domain error:', err)
      // 继续删除本地记录
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
    const domainId = parseInt(request.params.domainId)
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
    const domainId = parseInt(request.params.domainId)
    const { username, password, displayName, diskLimitMb, isAdmin } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    if (domain.status !== 'verified') {
      return reply.code(400).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, '请先完成域名验证'))
    }

    // 验证用户名
    if (!username || !/^[a-z0-9._-]+$/i.test(username)) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '用户名只能包含字母、数字、点、下划线和连字符'))
    }

    // 验证密码
    if (!password || password.length < 8) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '密码至少需要 8 位'))
    }

    // 检查账户是否已存在
    const exists = await db.checkMailAccountExists(domainId, username.toLowerCase())
    if (exists) {
      return reply.code(400).send(apiError(ErrorCode.RESOURCE_EXISTS, '该邮箱账户已存在'))
    }

    const email = `${username.toLowerCase()}@${domain.domain}`

    // 调用 SmarterMail API 创建账户
    try {
      await smarterMailService.createAccount(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        {
          username: username.toLowerCase(),
          password,
          displayName: displayName || username,
          diskLimitMb: diskLimitMb || 2048
        }
      )
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `创建邮箱账户失败: ${err.message}`))
    }

    // 保存到数据库
    const account = await db.createMailAccount({
      domainId,
      email,
      username: username.toLowerCase(),
      displayName: displayName || username,
      diskLimitMb: diskLimitMb || 2048,
      isAdmin: isAdmin || false
    })

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
    const domainId = parseInt(request.params.domainId)
    const accountId = parseInt(request.params.accountId)
    const { displayName, diskLimitMb } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const account = await db.getMailAccountById(accountId)
    if (!account || account.domainId !== domainId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱账户不存在'))
    }

    // 调用 SmarterMail API 更新账户
    try {
      await smarterMailService.updateAccount(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        account.username,
        { displayName, diskLimitMb }
      )
    } catch (err: any) {
      return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR, `更新邮箱账户失败: ${err.message}`))
    }

    const updated = await db.updateMailAccount(accountId, { displayName, diskLimitMb })

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
    const domainId = parseInt(request.params.domainId)
    const accountId = parseInt(request.params.accountId)
    const { password } = request.body
    
    const domain = await db.getMailDomainById(domainId)
    if (!domain || domain.subscription.userId !== request.user.id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '域名不存在'))
    }

    const account = await db.getMailAccountById(accountId)
    if (!account || account.domainId !== domainId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '邮箱账户不存在'))
    }

    if (!password || password.length < 8) {
      return reply.code(400).send(apiError(ErrorCode.VALIDATION_ERROR, '密码至少需要 8 位'))
    }

    // 调用 SmarterMail API 重置密码
    try {
      await smarterMailService.resetPassword(
        domain.source,
        domain.domain,
        domain.adminUsername!,
        domain.adminPassword!,
        account.username,
        password
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
    const domainId = parseInt(request.params.domainId)
    const accountId = parseInt(request.params.accountId)
    
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
      // 继续删除本地记录
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
