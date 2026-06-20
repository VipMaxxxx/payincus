/**
 * 实例计费相关路由
 * 处理续费、升降级、自动续费等计费操作
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { getIncusClient, patchInstanceResources } from '../lib/incus/index.js'
import { sendRenewSuccessEmail } from '../lib/mailer.js'
import { calculateDailyPrice } from '../lib/billing-calc.js'

interface BatchRenewPreviewItem {
  id: number
  name: string
  canRenew: boolean
  autoRenew: boolean
  reason?: string
  isHostedInstance: boolean
  daysUntilExpire: number | null
  options: Array<{
    months: number
    price: number
    discountedPrice: number
    expiresAt: string
  }>
}

interface BatchRenewResultItem {
  id: number
  name: string
  success: boolean
  skipped?: boolean
  reason?: string
  amount?: number
  newExpiresAt?: string
}

const BATCH_HIDDEN_REASON = '实例不存在或无权操作'

async function buildBatchRenewPreviewItem(userId: number, instanceId: number): Promise<BatchRenewPreviewItem> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      name: true,
      userId: true,
      packagePlanId: true
    }
  })

  if (!instance) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canRenew: false,
      autoRenew: false,
      reason: BATCH_HIDDEN_REASON,
      isHostedInstance: false,
      daysUntilExpire: null,
      options: []
    }
  }

  if (instance.userId !== userId) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canRenew: false,
      autoRenew: false,
      reason: BATCH_HIDDEN_REASON,
      isHostedInstance: false,
      daysUntilExpire: null,
      options: []
    }
  }

  if (!instance.packagePlanId) {
    return {
      id: instance.id,
      name: instance.name,
      canRenew: false,
      autoRenew: false,
      reason: '免费实例无需续费',
      isHostedInstance: false,
      daysUntilExpire: null,
      options: []
    }
  }

  const billingInfo = await db.getInstanceBillingInfo(instance.id)
  if (!billingInfo) {
    return {
      id: instance.id,
      name: instance.name,
      canRenew: false,
      autoRenew: false,
      reason: '无法获取实例计费信息',
      isHostedInstance: false,
      daysUntilExpire: null,
      options: []
    }
  }

  const restriction = billingInfo.hostingRenewRestriction
  const daysUntilExpire = billingInfo.daysUntilExpire
  if (billingInfo.isHostedInstance && restriction && daysUntilExpire !== null && daysUntilExpire > restriction.daysBeforeExpire) {
    return {
      id: instance.id,
      name: instance.name,
      canRenew: false,
      autoRenew: billingInfo.autoRenew,
      reason: `仅可在到期前 ${restriction.daysBeforeExpire} 天内续费`,
      isHostedInstance: billingInfo.isHostedInstance,
      daysUntilExpire,
      options: []
    }
  }

  const options = (billingInfo.renewPreview || []).map(option => ({
    months: option.months,
    price: option.amount,
    discountedPrice: option.discountedAmount,
    expiresAt: option.expiresAt.toISOString()
  }))

  return {
    id: instance.id,
    name: instance.name,
    canRenew: options.length > 0,
    autoRenew: billingInfo.autoRenew,
    reason: options.length > 0 ? undefined : '暂无可用续费选项',
    isHostedInstance: billingInfo.isHostedInstance,
    daysUntilExpire,
    options
  }
}

async function executeRenewForUser(
  user: { id: number; username: string },
  instanceId: number,
  months: number
): Promise<BatchRenewResultItem> {
  const preview = await buildBatchRenewPreviewItem(user.id, instanceId)
  if (!preview.canRenew) {
    return {
      id: preview.id,
      name: preview.name,
      success: false,
      skipped: true,
      reason: preview.reason
    }
  }

  const option = preview.options.find(item => item.months === months)
  if (!option) {
    return {
      id: preview.id,
      name: preview.name,
      success: false,
      skipped: true,
      reason: '该实例不支持当前续费时长'
    }
  }

  const instance = await prisma.instance.findUnique({
    where: { id: instanceId }
  })

  if (!instance || instance.userId !== user.id) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      success: false,
      skipped: true,
      reason: BATCH_HIDDEN_REASON
    }
  }

  try {
    const result = await db.performRenewal(user.id, instance, months)

    await sendNotification(user.id, 'instance_renewed', {
      instanceName: instance.name,
      renewAmount: result.amount,
      renewMonths: months,
      newExpiresAt: result.newExpiresAt.toISOString()
    })

    if (result.hostingIncomeResult) {
      sendHostManagedInstanceNotification(
        instance.hostId,
        'renew',
        {
          username: user.username,
          instanceName: instance.name,
          amount: result.amount
        }
      ).catch(err => {
        console.warn('[批量续费] 发送托管收入通知失败:', err)
      })
    }

    try {
      const userInfo = await db.findUserById(user.id)
      if (userInfo?.email) {
        await sendRenewSuccessEmail(userInfo.email, {
          username: userInfo.username,
          instanceName: instance.name,
          amount: result.amount,
          months,
          newExpiresAt: result.newExpiresAt
        })
      }
    } catch (emailErr) {
      console.warn('[批量续费] 发送续费成功邮件失败:', emailErr)
    }

    await createLog(
      user.id,
      'instance',
      'instance.renew',
      `Renewed instance "${instance.name}" for ${months} month(s), amount: ${result.amount}`,
      'success',
      { instanceId: instance.id }
    )

    return {
      id: instance.id,
      name: instance.name,
      success: true,
      amount: result.amount,
      newExpiresAt: result.newExpiresAt.toISOString()
    }
  } catch (error) {
    return {
      id: preview.id,
      name: preview.name,
      success: false,
      reason: '续费失败'
    }
  }
}

export default async function instanceBillingRoutes(fastify: FastifyInstance) {
  // ==================== 获取实例计费信息 ====================
  // GET /api/instances/:id/billing
  fastify.get<{ Params: { id: string } }>('/:id/billing', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = Number(request.params.id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：实例所有者或节点所有者
    const isOwner = instance.user_id === user.id
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = host && host.user_id === user.id

    if (!isOwner && !isHostOwner) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const billingInfo = await db.getInstanceBillingInfo(instanceId)
    if (!billingInfo) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 转换为前端期望的格式
    return {
      billing: {
        instanceId,
        instanceName: instance.name,
        planId: billingInfo.packagePlan?.id || null,
        planName: billingInfo.packagePlan?.name || null,
        price: billingInfo.billingPrice,  // 元（数据库存储的是元）
        billingCycle: billingInfo.billingCycle,
        expiresAt: billingInfo.expiresAt?.toISOString() || null,
        autoRenew: billingInfo.autoRenew,
        // 将 amount 转换为 price（前端期望的字段名），包含折扣价
        renewPreview: billingInfo.renewPreview?.map(p => ({
          months: p.months,
          price: p.amount,  // 原价（元）
          discountedPrice: p.discountedAmount,  // 折扣价（元）
          expiresAt: p.expiresAt.toISOString()
        })) || null,
        // AFF 折扣信息
        affDiscount: billingInfo.affDiscount ? {
          discountRate: billingInfo.affDiscount.discountRate,
          discountPercent: Math.round(billingInfo.affDiscount.discountRate * 100)  // 百分比，如 5 表示 5%
        } : null,
        // 托管实例相关信息
        isHostedInstance: billingInfo.isHostedInstance,
        daysUntilExpire: billingInfo.daysUntilExpire,
        hostingRenewRestriction: billingInfo.hostingRenewRestriction
      }
    }
  })

  // ==================== 绑定 AFF 优惠码（仅影响后续续费） ====================
  // POST /api/instances/:id/apply-aff
  fastify.post<{
    Params: { id: string }
    Body: { affCode: string }
  }>('/:id/apply-aff', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['affCode'],
        properties: {
          affCode: { type: 'string', minLength: 3, maxLength: 64 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const affCodeInput = request.body.affCode?.trim()

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (!affCodeInput || affCodeInput.length < 3) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '请输入有效的AFF优惠码'))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        affBinding: true,
        host: {
          select: {
            name: true,
            user: {
              select: { role: true }
            }
          }
        }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以自行绑定优惠码
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status === 'deleted') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '实例已删除'))
    }

    if (!instance.packagePlanId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '免费实例不支持使用优惠码'))
    }

    // 用户托管节点不允许使用优惠码；角色判断为准，名称规则兼容历史 PEER 节点
    const isHostedInstance = instance.host?.user.role === 'user'
      || instance.host?.name.toLowerCase().startsWith('peer')
    if (isHostedInstance) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '用户托管节点不支持使用优惠码'))
    }

    if (instance.affBinding) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '该实例已绑定优惠码，无法重复绑定'))
    }

    const validation = await db.validateAffCode(affCodeInput, instance.packagePlanId, user.id)
    if (!validation.valid || !validation.affCode) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, validation.error || '优惠码无效'))
    }

    try {
      await db.createAffBinding(instance.id, validation.affCode.id)
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '该实例已绑定优惠码，无法重复绑定'))
      }
      if (error?.code === 'P2003') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '优惠码无效'))
      }
      request.log.error(error, '用户绑定AFF优惠码失败')
      return reply.code(500).send({ error: '绑定优惠码失败' })
    }

    const discountRate = Number(validation.discountRate ?? validation.affCode.discountRate)
    const discountPercent = Math.round(discountRate * 100)

    await createLog(
      user.id,
      'instance',
      'instance.apply_aff',
      `Applied AFF code "${validation.affCode.code}" to instance "${instance.name}" for future renewals`,
      'success',
      { instanceId: instance.id }
    )

    return {
      success: true,
      message: `优惠码绑定成功，后续续费将享受 ${discountPercent}% 折扣`,
      discountRate,
      discountPercent
    }
  })

  // ==================== 手动续费 ====================
  // POST /api/instances/:id/renew
  fastify.post<{
    Params: { id: string }
    Body: { months: number }
  }>('/:id/renew', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['months'],
        properties: {
          months: { type: 'integer', minimum: 1, maximum: 24 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const { months } = request.body

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以续费
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 免费实例无需续费
    if (!instance.packagePlanId) {
      return reply.code(400).send({ error: '免费实例无需续费', code: 'FREE_INSTANCE' })
    }

    // 检查是否为用户托管节点的续费限制
    const host = await prisma.host.findUnique({
      where: { id: instance.hostId },
      select: {
        user: {
          select: {
            role: true
          }
        }
      }
    })
    const isHostedInstance = host?.user.role === 'user'
    if (isHostedInstance) {
      // 用户托管节点的实例只能续费1个月
      if (months !== 1) {
        return reply.code(400).send({
          error: '用户托管节点的实例仅支持按月续费',
          code: 'HOSTING_MONTHLY_ONLY'
        })
      }
      
      // 只能在到期前7天内续费
      if (instance.expiresAt) {
        const now = new Date()
        const daysUntilExpire = Math.ceil((instance.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        if (daysUntilExpire > 7) {
          return reply.code(400).send({
            error: `用户托管节点的实例仅可在到期前7天内续费（当前剩余 ${daysUntilExpire} 天）`,
            code: 'HOSTING_RENEW_TOO_EARLY'
          })
        }
      }
    }

    try {
      const result = await db.performRenewal(user.id, instance, months)

      // 发送续费成功通知
      await sendNotification(user.id, 'instance_renewed', {
        instanceName: instance.name,
        renewAmount: result.amount, // 元（performRenewal 返回的是元）
        renewMonths: months,
        newExpiresAt: result.newExpiresAt.toISOString()
      })
      
      // 发送托管收入通知给节点所有者（仅发送到外部渠道，不创建站内信）
      if (result.hostingIncomeResult) {
        sendHostManagedInstanceNotification(
          instance.hostId,
          'renew',
          {
            username: user.username,
            instanceName: instance.name,
            amount: result.amount
          }
        ).catch(err => {
          console.warn(`[续费] 发送托管收入通知失败:`, err)
        })
      }

      // 发送续费成功邮件通知
      try {
        const userInfo = await db.findUserById(user.id)
        if (userInfo && userInfo.email) {
          await sendRenewSuccessEmail(userInfo.email, {
            username: userInfo.username,
            instanceName: instance.name,
            amount: result.amount,
            months,
            newExpiresAt: result.newExpiresAt
          })
        }
      } catch (emailErr) {
        // 邮件失败不影响主流程
        console.warn(`[续费] 发送续费成功邮件失败:`, emailErr)
      }

      await createLog(
        user.id,
        'instance',
        'instance.renew',
        `Renewed instance "${instance.name}" for ${months} month(s), amount: ${result.amount}`,
        'success',
        { instanceId }
      )

      return {
        message: '续费成功',
        amount: result.amount,
        months,
        newExpiresAt: result.newExpiresAt.toISOString()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '续费失败'
      return reply.code(400).send({ error: errorMessage })
    }
  })

  fastify.post<{
    Body: { instanceIds: number[] }
  }>('/batch/renew-preview', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const items = await Promise.all(uniqueIds.map(id => buildBatchRenewPreviewItem(request.user.id, id)))
    return { items }
  })

  fastify.post<{
    Body: { instanceIds: number[]; months: number }
  }>('/batch/renew', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'months'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          },
          months: { type: 'integer', minimum: 1, maximum: 24 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const userMeta = {
      id: request.user.id,
      username: request.user.username
    }

    const results: BatchRenewResultItem[] = []
    for (const instanceId of uniqueIds) {
      const item = await executeRenewForUser(userMeta, instanceId, request.body.months)
      results.push(item)
    }

    const successCount = results.filter(item => item.success).length
    const skippedCount = results.filter(item => item.skipped).length
    const failedCount = results.length - successCount - skippedCount

    await createLog(
      request.user.id,
      'instance',
      'instance.batch_renew',
      `Batch renew processed ${results.length} instance(s): success=${successCount}, skipped=${skippedCount}, failed=${failedCount}`,
      failedCount > 0 ? 'warning' : 'success'
    )

    return {
      message: successCount > 0 ? '批量续费已处理' : '没有实例完成续费',
      successCount,
      skippedCount,
      failedCount,
      results
    }
  })

  // ==================== 升降级预览 ====================
  // GET /api/instances/:id/change-plan/preview
  fastify.get<{
    Params: { id: string }
    Querystring: { newPlanId: string }
  }>('/:id/change-plan/preview', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const newPlanId = Number(request.query.newPlanId)

    if (isNaN(instanceId) || isNaN(newPlanId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以预览升降级
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 免费实例不支持升降级
    if (!instance.packagePlanId) {
      return reply.code(400).send({ error: '免费实例不支持升降级', code: 'FREE_INSTANCE' })
    }

    // 获取新方案
    const newPlan = await db.getPlanById(newPlanId)
    if (!newPlan) {
      return reply.code(404).send({ error: '方案不存在', code: 'PLAN_NOT_FOUND' })
    }

    // 验证方案属于同一套餐
    if (newPlan.packageId !== instance.packageId) {
      return reply.code(400).send({ error: '新方案必须属于同一套餐', code: 'PLAN_NOT_IN_PACKAGE' })
    }

    // 不能切换到相同方案
    if (instance.packagePlanId === newPlanId) {
      return reply.code(400).send({ error: '不能切换到相同方案', code: 'SAME_PLAN' })
    }

    // 新方案必须是上架状态
    if (!newPlan.isActive) {
      return reply.code(400).send({ error: '该方案已下架', code: 'PLAN_INACTIVE' })
    }
    if (newPlan.isSoldOut) {
      return reply.code(400).send({ error: '该方案已售罄', code: 'PLAN_SOLD_OUT' })
    }

    // 检查实例状态（running/stopped 才能升降级）
    const statusCanChange = ['running', 'stopped'].includes(instance.status)

    try {
      const preview = await db.calculatePlanChange(instance, newPlan)

      // 只允许升级，不允许降级
      if (!preview.isUpgrade) {
        return reply.code(400).send({ error: '不支持降级，只能升级到更高配置的方案', code: 'DOWNGRADE_NOT_ALLOWED' })
      }

      return {
        preview: {
          oldPlan: {
            id: preview.oldPlan.id,
            name: preview.oldPlan.name,
            price: Number(instance.billingPrice) || Number(preview.oldPlan.price),
            billingCycle: instance.billingCycle || preview.oldPlan.billingCycle
          },
          newPlan: {
            id: preview.newPlan.id,
            name: preview.newPlan.name,
            price: Number(preview.newPlan.price),
            billingCycle: preview.newPlan.billingCycle,
            isActive: preview.newPlan.isActive,
            isSoldOut: preview.newPlan.isSoldOut
          },
          remainingDays: preview.remainingDays,
          // 计算详情（供前端展示）
          oldDailyPrice: preview.oldDailyPrice,
          newDailyPrice: preview.newDailyPrice,
          remainingValue: preview.remainingValue,
          newPlanCost: preview.newPlanCost,
          // 折扣信息
          discountRate: preview.discountRate,
          discountAmount: preview.discountAmount,
          // 最终结果
          priceDiff: preview.priceDiff,
          isUpgrade: preview.isUpgrade,
          newExpiresAt: preview.newExpiresAt.toISOString(),
          newConfig: preview.newConfig,
          // 升级不需要资源警告
          resourceWarnings: null,
          // 可变更状态（综合考虑实例状态和 db 层返回的剩余天数检查）
          canChange: statusCanChange && preview.canChange,
          cannotChangeReason: !statusCanChange 
            ? 'instance_status_invalid'  // 实例状态不允许变更
            : preview.cannotChangeReason
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '计算升级差价失败'
      return reply.code(400).send({ error: errorMessage })
    }
  })

  // ==================== 执行升降级 ====================
  // POST /api/instances/:id/change-plan
  fastify.post<{
    Params: { id: string }
    Body: { newPlanId: number }
  }>('/:id/change-plan', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['newPlanId'],
        properties: {
          newPlanId: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const { newPlanId } = request.body

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        package: { select: { instanceType: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以升降级
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 免费实例不支持升降级
    if (!instance.packagePlanId) {
      return reply.code(400).send({ error: '免费实例不支持升降级', code: 'FREE_INSTANCE' })
    }

    // 获取新方案
    const newPlan = await db.getPlanById(newPlanId)
    if (!newPlan) {
      return reply.code(404).send({ error: '方案不存在', code: 'PLAN_NOT_FOUND' })
    }

    // 验证方案属于同一套餐
    if (newPlan.packageId !== instance.packageId) {
      return reply.code(400).send({ error: '新方案必须属于同一套餐', code: 'PLAN_NOT_IN_PACKAGE' })
    }

    // 不能切换到相同方案
    if (instance.packagePlanId === newPlanId) {
      return reply.code(400).send({ error: '不能切换到相同方案', code: 'SAME_PLAN' })
    }

    // 新方案必须是上架状态
    if (!newPlan.isActive) {
      return reply.code(400).send({ error: '该方案已下架', code: 'PLAN_INACTIVE' })
    }
    if (newPlan.isSoldOut) {
      return reply.code(400).send({ error: '该方案已售罄', code: 'PLAN_SOLD_OUT' })
    }

    // 检查实例状态（仅 running/stopped 可以升级）
    if (!['running', 'stopped'].includes(instance.status)) {
      return reply.code(400).send({ error: '当前实例状态不允许升级，仅运行中或已停止的实例可以操作', code: 'INSTANCE_STATUS_INVALID' })
    }

    // 检查是否为升级（不允许降级）
    const oldPlan = instance.packagePlanId ? await db.getPlanById(instance.packagePlanId) : null
    if (oldPlan) {
      // 使用公共方法计算日价
      const oldDailyPrice = calculateDailyPrice(Number(instance.billingPrice), instance.billingCycle || 1)
      const newDailyPrice = calculateDailyPrice(Number(newPlan.price) / 100, newPlan.billingCycle)
      if (newDailyPrice <= oldDailyPrice) {
        return reply.code(400).send({ error: '不支持降级，只能升级到更高配置的方案', code: 'DOWNGRADE_NOT_ALLOWED' })
      }
    }

    try {
      const result = await db.performPlanChange(user.id, instance, newPlan)
      try {
        const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
        await reconcileTrafficStateForInstanceIds([instance.id])
      } catch (err) {
        request.log.warn(err, '实例方案已更新，流量状态即时复核失败')
      }

      // 计算资源变化量并更新宿主机资源统计
      const cpuDelta = newPlan.cpu - instance.cpu
      const memoryDelta = newPlan.memory - instance.memory
      const diskDelta = newPlan.disk - instance.disk
      
      if (cpuDelta !== 0 || memoryDelta !== 0 || diskDelta !== 0) {
        const host = await db.getHostById(instance.hostId)
        if (host) {
          await db.updateHostResources(instance.hostId, {
            cpuUsed: host.cpu_used + cpuDelta,
            memoryUsed: host.memory_used + memoryDelta,
            diskUsed: host.disk_used + diskDelta
          })
          console.log(`[ChangePlan] 实例 ${instance.name} 资源变化: CPU ${cpuDelta > 0 ? '+' : ''}${cpuDelta}%, Memory ${memoryDelta > 0 ? '+' : ''}${memoryDelta}MB, Disk ${diskDelta > 0 ? '+' : ''}${diskDelta}MB`)
        }
      }

      // 同步配置到 Incus
      let incusSyncSuccess = false
      let incusSyncError: string | null = null
      try {
        const host = await db.getHostById(instance.hostId)
        if (host) {
          const client = await getIncusClient(host)
          // 同步 CPU/内存/磁盘配置到 Incus
          await patchInstanceResources(client, instance.incusId, {
            cpu: newPlan.cpu,
            memory: newPlan.memory,
            disk: newPlan.disk
          })
          incusSyncSuccess = true
          console.log(`[ChangePlan] 实例 ${instance.name} Incus 配置同步成功: CPU=${newPlan.cpu}%, Memory=${newPlan.memory}MB, Disk=${newPlan.disk}MB`)
        }
      } catch (incusErr) {
        incusSyncError = incusErr instanceof Error ? incusErr.message : String(incusErr)
        console.error(`[ChangePlan] 实例 ${instance.name} Incus 配置同步失败:`, incusSyncError)
      }

      // 发送升降级通知
      await sendNotification(user.id, 'instance_plan_changed', {
        instanceName: instance.name,
        oldPlanName: oldPlan?.name || '未知',
        newPlanName: newPlan.name,
        priceDiff: result.priceDiff // 元（与其他通知保持一致）
      })

      await createLog(
        user.id,
        'instance',
        'instance.change_plan',
        `Changed plan for instance "${instance.name}": ${oldPlan?.name || 'unknown'} → ${newPlan.name}, priceDiff: ${result.priceDiff}`,
        'success',
        { instanceId }
      )

      // 判断实例类型：KVM 需要重启，LXC 即时生效
      const instanceType = (instance.package as { instanceType?: string } | null)?.instanceType || 'container'
      const isVm = instanceType === 'vm'

      return {
        message: '方案升级成功',
        priceDiff: result.priceDiff,
        refundAmount: result.refundAmount,
        newConfig: result.newConfig,
        // KVM 实例需要重启才能应用新配置，LXC 实例即时生效
        needRestart: isVm || !incusSyncSuccess,
        restartMessage: !incusSyncSuccess
          ? (incusSyncError 
            ? `Incus配置同步失败: ${incusSyncError}，请重启实例以应用新配置` 
            : '配置已更新，请重启实例以应用新配置')
          : (isVm ? 'KVM_RESTART_REQUIRED' : null)  // 特殊标记，前端根据此显示本地化文本
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '升降级失败'
      return reply.code(400).send({ error: errorMessage })
    }
  })

  // ==================== 自动续费开关 ====================
  // PATCH /api/instances/:id/auto-renew
  fastify.patch<{
    Params: { id: string }
    Body: { autoRenew: boolean }
  }>('/:id/auto-renew', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['autoRenew'],
        properties: {
          autoRenew: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const { autoRenew } = request.body

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以修改自动续费设置
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 免费实例不支持自动续费
    if (!instance.packagePlanId) {
      return reply.code(400).send({ error: '免费实例不支持自动续费', code: 'FREE_INSTANCE' })
    }

    await db.updateAutoRenew(instanceId, autoRenew)

    await createLog(
      user.id,
      'instance',
      'instance.auto_renew',
      `${autoRenew ? 'Enabled' : 'Disabled'} auto-renew for instance "${instance.name}"`,
      'success',
      { instanceId }
    )

    return {
      message: autoRenew ? '已开启自动续费' : '已关闭自动续费',
      autoRenew
    }
  })

  fastify.patch<{
    Body: { instanceIds: number[]; autoRenew: boolean }
  }>('/batch/auto-renew', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'autoRenew'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          },
          autoRenew: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const results: Array<{ id: number; name: string; success: boolean; skipped?: boolean; reason?: string; autoRenew?: boolean }> = []

    for (const instanceId of uniqueIds) {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: {
          id: true,
          name: true,
          userId: true,
          packagePlanId: true,
          autoRenew: true
        }
      })

      if (!instance) {
        results.push({ id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON })
        continue
      }

      if (instance.userId !== request.user.id) {
        results.push({ id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON })
        continue
      }

      if (!instance.packagePlanId) {
        results.push({ id: instance.id, name: instance.name, success: false, skipped: true, reason: '免费实例不支持自动续费' })
        continue
      }

      if (instance.autoRenew === request.body.autoRenew) {
        results.push({ id: instance.id, name: instance.name, success: false, skipped: true, reason: request.body.autoRenew ? '已经开启自动续费' : '已经关闭自动续费' })
        continue
      }

      try {
        await db.updateAutoRenew(instance.id, request.body.autoRenew)
        await createLog(
          request.user.id,
          'instance',
          'instance.auto_renew',
          `${request.body.autoRenew ? 'Enabled' : 'Disabled'} auto-renew for instance "${instance.name}"`,
          'success',
          { instanceId: instance.id }
        )
        results.push({ id: instance.id, name: instance.name, success: true, autoRenew: request.body.autoRenew })
      } catch (error) {
        results.push({
          id: instance.id,
          name: instance.name,
          success: false,
          reason: '自动续费设置失败'
        })
      }
    }

    const successCount = results.filter(item => item.success).length
    const skippedCount = results.filter(item => item.skipped).length
    const failedCount = results.length - successCount - skippedCount

    return {
      message: request.body.autoRenew ? '批量开启自动续费已处理' : '批量关闭自动续费已处理',
      successCount,
      skippedCount,
      failedCount,
      results
    }
  })

  // ==================== 获取实例计费记录 ====================
  // GET /api/instances/:id/billing/records
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; type?: string }
  }>('/:id/billing/records', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)
    const { page = '1', pageSize = '20', type } = request.query

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：实例所有者或节点所有者
    const isOwner = instance.user_id === user.id
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = host && host.user_id === user.id

    if (!isOwner && !isHostOwner) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const result = await db.getInstanceBillingRecords(instanceId, {
      page: Number(page),
      pageSize: Number(pageSize),
      type: type as any
    })

    return {
      records: result.records.map(record => ({
        id: record.id,
        type: record.type,
        amount: Number(record.amount),
        months: record.months,
        periodStart: record.periodStart.toISOString(),
        periodEnd: record.periodEnd.toISOString(),
        remark: record.remark,
        createdAt: record.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })
}
