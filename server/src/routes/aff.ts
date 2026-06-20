/**
 * AFF 推荐计划路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { createInboxMessage } from '../db/inbox.js'
import { apiError, ErrorCode } from '../lib/errors.js'

export default async function affRoutes(fastify: FastifyInstance) {
  // ==================== 用户 AFF API ====================

  // 获取 AFF 状态和统计
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request
    const [activated, stats] = await Promise.all([
      db.isAffActivated(user.id),
      db.getAffStats(user.id)
    ])

    return {
      activated,
      ...stats
    }
  })

  // 获取我的优惠码列表（包括全局码）
  fastify.get('/me/codes', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request
    const codes = await db.getUserAffCodes(user.id)

    return {
      codes: codes.map(code => ({
        id: code.id,
        code: code.code,
        packagePlanId: code.packagePlanId,
        planName: code.packagePlan?.name || null,
        packageName: code.packagePlan?.package.name || null,
        price: code.packagePlan?.price || null,
        isGlobal: code.packagePlanId === null,
        discountRate: Number(code.discountRate),
        commissionRate: Number(code.commissionRate),
        usedCount: code.usedCount,
        totalEarnings: Number(code.totalEarnings),
        createdAt: code.createdAt.toISOString()
      }))
    }
  })

  // 获取可创建优惠码的方案列表（包含全局码状态）
  fastify.get('/me/available-plans', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request

    // 检查是否已激活
    const activated = await db.isAffActivated(user.id)
    if (!activated) {
      return reply.code(400).send({ error: '推荐计划尚未激活，请先充值任意金额' })
    }

    const result = await db.getAvailablePlansForAffCode(user.id)

    return {
      plans: result.plans.map(plan => ({
        id: plan.id,
        name: plan.name,
        price: plan.price,
        packageName: plan.package.name,
        hasCode: plan.hasCode
      })),
      hasGlobalCode: result.hasGlobalCode
    }
  })

  // 创建优惠码（支持方案专有码和全局码，固定 5% 折扣/5% 返利）
  fastify.post<{
    Body: { packagePlanId?: number }
  }>('/me/codes', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Body: { packagePlanId?: number } }>, reply: FastifyReply) => {
    const { user } = request
    const { packagePlanId } = request.body

    // 验证 packagePlanId 如果提供必须是正整数
    if (packagePlanId !== undefined) {
      if (typeof packagePlanId !== 'number' || !Number.isInteger(packagePlanId) || packagePlanId <= 0) {
        return reply.code(400).send({ error: '方案 ID 无效' })
      }
    }

    // packagePlanId 为 undefined 时创建全局码
    const result = await db.createAffCode(user.id, packagePlanId)

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    const isGlobal = result.affCode!.packagePlanId === null
    await createLog(
      user.id,
      'user',
      'aff.create_code',
      isGlobal 
        ? `Created global AFF code ${result.affCode!.code}`
        : `Created AFF code ${result.affCode!.code} for plan #${packagePlanId}`,
      'success'
    )

    return {
      message: isGlobal ? '全局优惠码创建成功' : '优惠码创建成功',
      code: {
        id: result.affCode!.id,
        code: result.affCode!.code,
        packagePlanId: result.affCode!.packagePlanId,
        isGlobal,
        discountRate: Number(result.affCode!.discountRate),
        commissionRate: Number(result.affCode!.commissionRate),
        createdAt: result.affCode!.createdAt.toISOString()
      }
    }
  })

  // 删除优惠码（仅允许删除使用次数为 0 的优惠码）
  fastify.delete<{
    Params: { codeId: string }
  }>('/me/codes/:codeId', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { codeId: string } }>, reply: FastifyReply) => {
    const { user } = request
    const codeId = Number(request.params.codeId)

    if (isNaN(codeId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await db.deleteAffCode(user.id, codeId)

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'user',
      'aff.delete_code',
      `Deleted AFF code ${result.code}`,
      'success'
    )

    return { message: '优惠码已删除' }
  })

  // 获取 AFF 收益日志
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
    }
  }>('/me/logs', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; type?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', type } = request.query

    const result = await db.getAffLogs(user.id, {
      page: Number(page),
      pageSize: Number(pageSize),
      type: type as any
    })

    return {
      logs: result.logs.map(log => ({
        id: log.id,
        type: log.type,
        amount: Number(log.amount),
        originalAmount: log.originalAmount ? Number(log.originalAmount) : null,
        balanceBefore: Number(log.balanceBefore),
        balanceAfter: Number(log.balanceAfter),
        affCodeId: log.affCodeId,
        affCode: log.affCode?.code || null,
        instanceId: log.instanceId,
        remark: log.remark,
        createdAt: log.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // 获取 AFF 收益榜单 TOP 10
  fastify.get('/leaderboard', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest) => {
    const { user } = request
    const leaderboard = await db.getAffLeaderboard(user.id)
    return { leaderboard }
  })

  // 验证优惠码（开通实例时调用）
  fastify.post<{
    Body: {
      code: string
      packagePlanId: number
    }
  }>('/validate', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Body: { code: string; packagePlanId: number } }>, reply: FastifyReply) => {
    const { user } = request
    const { code, packagePlanId } = request.body

    if (!code || !code.trim()) {
      return reply.code(400).send({ error: '请输入优惠码' })
    }

    if (!packagePlanId || typeof packagePlanId !== 'number') {
      return reply.code(400).send({ error: '方案 ID 无效' })
    }

    const result = await db.validateAffCode(code.trim(), packagePlanId, user.id)

    if (!result.valid) {
      return reply.code(400).send({ error: result.error })
    }

    return {
      valid: true,
      discountRate: result.discountRate,
      commissionRate: result.commissionRate
    }
  })

  // ==================== 转化申请 API ====================

  // 创建转化申请
  fastify.post<{
    Body: { amount: number }
  }>('/me/convert', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Body: { amount: number } }>, reply: FastifyReply) => {
    const { user } = request
    const { amount } = request.body

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return reply.code(400).send({ error: '请输入有效的转化金额' })
    }

    // 规范化金额（两位小数）
    const normalizedAmount = Math.round(amount * 100) / 100

    const result = await db.createAffWithdrawal(user.id, normalizedAmount)

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'user',
      'aff.convert_request',
      `AFF balance converted: ${normalizedAmount}`,
      'success'
    )

    return {
      message: '转化成功，已转入账户余额',
      withdrawal: {
        id: result.withdrawal!.id,
        amount: Number(result.withdrawal!.amount),
        status: result.withdrawal!.status,
        createdAt: result.withdrawal!.createdAt.toISOString()
      }
    }
  })

  // 获取我的转化申请
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      status?: string
    }
  }>('/me/withdrawals', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', status } = request.query

    const result = await db.getUserAffWithdrawals(user.id, {
      page: Number(page),
      pageSize: Number(pageSize),
      status: status as any
    })

    return {
      withdrawals: result.withdrawals.map(w => ({
        id: w.id,
        amount: Number(w.amount),
        status: w.status,
        rejectReason: w.rejectReason,
        reviewedAt: w.reviewedAt?.toISOString() || null,
        createdAt: w.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // ==================== 管理员 API ====================

  // 获取所有转化申请（管理员）
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      status?: string
    }
  }>('/admin/withdrawals', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string } }>) => {
    const { page = '1', pageSize = '20', status } = request.query

    const result = await db.getPendingAffWithdrawals({
      page: Number(page),
      pageSize: Number(pageSize),
      status: status as any
    })

    return {
      withdrawals: result.withdrawals.map(w => ({
        id: w.id,
        userId: w.userId,
        username: w.user.username,
        userAffBalance: w.user.affBalance,
        amount: Number(w.amount),
        status: w.status,
        rejectReason: w.rejectReason,
        reviewedBy: w.reviewedBy,
        reviewedAt: w.reviewedAt?.toISOString() || null,
        createdAt: w.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // 审核通过转化申请（管理员）
  fastify.post<{
    Params: { withdrawalId: string }
  }>('/admin/withdrawals/:withdrawalId/approve', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { withdrawalId: string } }>, reply: FastifyReply) => {
    const { user } = request
    const withdrawalId = Number(request.params.withdrawalId)

    if (isNaN(withdrawalId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 先查询申请信息以获取用户ID和金额
    const withdrawal = await db.getAffWithdrawalById(withdrawalId)
    if (!withdrawal) {
      return reply.code(400).send({ error: '申请不存在' })
    }

    const result = await db.approveAffWithdrawal(withdrawalId, user.id)

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'admin',
      'aff.approve_convert',
      `Approved AFF convert request #${withdrawalId}`,
      'success'
    )

    // 发送站内信通知用户
    await createInboxMessage({
      userId: withdrawal.userId,
      eventType: 'aff_convert_approved',
      title: 'AFF 转化审核通过',
      content: `您的 AFF 余额转化申请已审核通过，¥${Number(withdrawal.amount).toFixed(2)} 已转入您的账户余额。`,
      data: { withdrawalId, amount: Number(withdrawal.amount) }
    })

    return { message: '审核通过，已转入用户余额' }
  })

  // 审核拒绝转化申请（管理员）
  fastify.post<{
    Params: { withdrawalId: string }
    Body: { reason: string }
  }>('/admin/withdrawals/:withdrawalId/reject', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { withdrawalId: string }; Body: { reason: string } }>, reply: FastifyReply) => {
    const { user } = request
    const withdrawalId = Number(request.params.withdrawalId)
    const { reason } = request.body

    if (isNaN(withdrawalId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (!reason || !reason.trim()) {
      return reply.code(400).send({ error: '请填写拒绝原因' })
    }

    // 先查询申请信息以获取用户ID和金额
    const withdrawal = await db.getAffWithdrawalById(withdrawalId)
    if (!withdrawal) {
      return reply.code(400).send({ error: '申请不存在' })
    }

    const result = await db.rejectAffWithdrawal(withdrawalId, user.id, reason.trim())

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'admin',
      'aff.reject_convert',
      `Rejected AFF convert request #${withdrawalId}: ${reason}`,
      'success'
    )

    // 发送站内信通知用户
    await createInboxMessage({
      userId: withdrawal.userId,
      eventType: 'aff_convert_rejected',
      title: 'AFF 转化申请被拒绝',
      content: `您的 AFF 余额转化申请（¥${Number(withdrawal.amount).toFixed(2)}）已被拒绝。\n拒绝原因：${reason.trim()}`,
      data: { withdrawalId, amount: Number(withdrawal.amount), reason: reason.trim() }
    })

    return { message: '已拒绝' }
  })
}
