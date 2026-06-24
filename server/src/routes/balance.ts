/**
 * 余额管理路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sendBalanceAdjustedEmail } from '../lib/mailer.js'
import type {
  BalanceAdjustmentRequestStatus,
  BalanceAdjustmentRequestType,
  BalanceLogType,
  BillingRecordType
} from '@prisma/client'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const BALANCE_LOG_TYPES = new Set<BalanceLogType>([
  'recharge',
  'consume',
  'refund',
  'admin_adjust',
  'gift',
  'transfer_fee',
  'transfer_refund',
  'hosting_withdraw',
  'hosting_deduction',
  'invite_generate'
])
const BILLING_RECORD_TYPES = new Set<BillingRecordType>([
  'newPurchase',
  'renew',
  'upgrade',
  'downgrade',
  'refund',
  'transfer_fee'
])
const BALANCE_ADJUSTMENT_REQUEST_STATUSES = new Set<BalanceAdjustmentRequestStatus>([
  'pending',
  'approved',
  'rejected'
])
const BALANCE_ADJUSTMENT_REQUEST_TYPES = new Set<BalanceAdjustmentRequestType>([
  'manual_adjust',
  'refund'
])
const ADMIN_BALANCE_REMARK_MAX_LENGTH = 500
const ADMIN_BALANCE_SOURCE_MAX_LENGTH = 64
const ADMIN_BALANCE_ORDER_NO_MAX_LENGTH = 128

type AdminBalanceAdjustInput = {
  amount: number
  remark: string
}

type AdminBalanceAdjustmentRequestInput = {
  amount: number
  reason: string
  requestType: BalanceAdjustmentRequestType
  sourceType?: string
  sourceId?: number
  orderNo?: string
}

type AdminBalanceAdjustmentReviewInput = {
  remark?: string
}

type AdminBalanceGiftInput = {
  amount: number
  remark?: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveIntegerQuery(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_ROUTE_ID_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveIntegerQuery(value, fallback), max)
}

function normalizeBalanceLogType(value: string | undefined): BalanceLogType | undefined {
  return value && BALANCE_LOG_TYPES.has(value as BalanceLogType)
    ? value as BalanceLogType
    : undefined
}

function normalizeBillingRecordType(value: string | undefined): BillingRecordType | undefined {
  return value && BILLING_RECORD_TYPES.has(value as BillingRecordType)
    ? value as BillingRecordType
    : undefined
}

function normalizeBalanceAdjustmentRequestStatus(value: string | undefined): BalanceAdjustmentRequestStatus | undefined {
  return value && BALANCE_ADJUSTMENT_REQUEST_STATUSES.has(value as BalanceAdjustmentRequestStatus)
    ? value as BalanceAdjustmentRequestStatus
    : undefined
}

function normalizeAdminBalanceRemark(value: unknown, required: boolean, field: string): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw { error: `必须填写${field}` }
    }
    return undefined
  }
  if (typeof value !== 'string') {
    throw { error: `${field}必须是字符串` }
  }

  const remark = value.trim()
  if (!remark) {
    if (required) {
      throw { error: `必须填写${field}` }
    }
    return undefined
  }
  if (remark.length > ADMIN_BALANCE_REMARK_MAX_LENGTH) {
    throw { error: `${field}不能超过 ${ADMIN_BALANCE_REMARK_MAX_LENGTH} 字符` }
  }

  return remark
}

function normalizeOptionalShortText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw { error: `${field}必须是字符串` }
  }
  const text = value.trim()
  if (!text) return undefined
  if (text.length > maxLength) {
    throw { error: `${field}不能超过 ${maxLength} 字符` }
  }
  return text
}

function normalizeOptionalPositiveSafeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw { error: `${field}必须是正整数` }
  }
  return value
}

function normalizeAdminBalanceAdjustInput(input: unknown): AdminBalanceAdjustInput {
  if (!isPlainRecord(input)) {
    throw { error: '请求参数无效' }
  }

  const { amount } = input
  if (amount === null || amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw { error: '调整金额必须是有效的数字' }
  }
  if (amount === 0) {
    throw { error: '调整金额不能为 0' }
  }

  const remark = normalizeAdminBalanceRemark(input.remark, true, '调整原因')
  return { amount, remark: remark! }
}

function normalizeAdminBalanceAdjustmentRequestInput(input: unknown): AdminBalanceAdjustmentRequestInput {
  if (!isPlainRecord(input)) {
    throw { error: '请求参数无效' }
  }

  const { amount } = input
  if (amount === null || amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw { error: '调账金额必须是有效的数字' }
  }
  if (amount === 0) {
    throw { error: '调账金额不能为 0' }
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(amount))) {
    throw { error: '调账金额最多保留两位小数' }
  }

  const requestType = typeof input.requestType === 'string' && BALANCE_ADJUSTMENT_REQUEST_TYPES.has(input.requestType as BalanceAdjustmentRequestType)
    ? input.requestType as BalanceAdjustmentRequestType
    : 'manual_adjust'
  if (requestType === 'refund' && amount <= 0) {
    throw { error: '退款申请金额必须大于 0' }
  }

  return {
    amount,
    requestType,
    reason: normalizeAdminBalanceRemark(input.reason, true, '申请原因')!,
    sourceType: normalizeOptionalShortText(input.sourceType, '来源类型', ADMIN_BALANCE_SOURCE_MAX_LENGTH),
    sourceId: normalizeOptionalPositiveSafeInteger(input.sourceId, '来源 ID'),
    orderNo: normalizeOptionalShortText(input.orderNo, '订单号', ADMIN_BALANCE_ORDER_NO_MAX_LENGTH)
  }
}

function normalizeAdminBalanceAdjustmentReviewInput(input: unknown, required: boolean): AdminBalanceAdjustmentReviewInput {
  if (input === undefined || input === null) {
    if (required) {
      throw { error: '必须填写审核备注' }
    }
    return {}
  }
  if (!isPlainRecord(input)) {
    throw { error: '请求参数无效' }
  }

  const remark = normalizeAdminBalanceRemark(input.remark, required, '审核备注')
  return { remark }
}

function serializeBalanceAdjustmentRequest(request: db.BalanceAdjustmentRequestWithRelations) {
  return {
    id: request.id,
    userId: request.userId,
    user: request.user,
    requestedBy: request.requestedBy,
    reviewedBy: request.reviewedBy || null,
    amount: Number(request.amount),
    requestType: request.requestType,
    status: request.status,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    orderNo: request.orderNo,
    reason: request.reason,
    reviewRemark: request.reviewRemark,
    balanceLogId: request.balanceLogId,
    balanceLog: request.balanceLog ? {
      id: request.balanceLog.id,
      type: request.balanceLog.type,
      amount: Number(request.balanceLog.amount),
      balanceBefore: Number(request.balanceLog.balanceBefore),
      balanceAfter: Number(request.balanceLog.balanceAfter)
    } : null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() || null
  }
}

function normalizeAdminBalanceGiftInput(input: unknown): AdminBalanceGiftInput {
  if (!isPlainRecord(input)) {
    throw { error: '请求参数无效' }
  }

  const { amount } = input
  if (amount === null || amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw { error: '赠送金额必须是有效的数字' }
  }
  if (amount <= 0) {
    throw { error: '赠送金额必须大于 0' }
  }

  return {
    amount,
    remark: normalizeAdminBalanceRemark(input.remark, false, '赠送原因')
  }
}

export default async function balanceRoutes(fastify: FastifyInstance) {
  // ==================== 用户余额 API ====================

  // 获取当前用户余额
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request
    const balanceAmount = await db.getUserBalance(user.id)
    const stats = await db.getUserConsumeStats(user.id)

    return {
      balance: {
        balance: balanceAmount,
        frozen: 0,  // 暂无冻结功能
        totalRecharge: stats.totalRecharge,
        totalConsume: stats.totalConsume,
        destroyedValue: stats.totalDestroyedValue
      }
    }
  })

  // 获取当前用户余额变动日志
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
      lotteryGift?: string
    }
  }>('/me/logs', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; type?: string; lotteryGift?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', type, lotteryGift } = request.query

    const result = await db.getBalanceLogs(user.id, {
      page: parsePositiveIntegerQuery(page, 1),
      pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100),
      type: normalizeBalanceLogType(type),
      lotteryGift: (lotteryGift === 'exclude' || lotteryGift === 'only') ? lotteryGift : undefined
    })

    return {
      records: result.logs.map(log => ({
        id: log.id,
        type: log.type,
        amount: Number(log.amount),
        balanceBefore: Number(log.balanceBefore),
        balanceAfter: Number(log.balanceAfter),
        orderId: log.orderId,
        instanceId: log.instanceId,
        instanceName: log.instance?.name || null,
        remark: log.remark,
        createdAt: log.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // 获取当前用户计费记录
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
    }
  }>('/me/billing', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; type?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', type } = request.query

    const result = await db.getUserBillingRecords(user.id, {
      page: parsePositiveIntegerQuery(page, 1),
      pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100),
      type: normalizeBillingRecordType(type)
    })

    const stats = await db.getUserBillingStats(user.id)

    return {
      records: result.records.map(record => ({
        id: record.id,
        instanceId: record.instanceId,
        instance: (record as any).instance ? {
          id: (record as any).instance.id,
          name: (record as any).instance.name
        } : null,
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
      pageSize: result.pageSize,
      stats
    }
  })

  // ==================== 管理员余额管理 API ====================

  // 获取用户余额（管理员）
  fastify.get<{ Params: { userId: string } }>('/admin/:userId', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const userId = parsePositiveRouteId(request.params.userId)
    if (!userId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const targetUser = await db.findUserById(userId)
    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const balance = await db.getUserBalance(userId)
    const stats = await db.getUserConsumeStats(userId)

    return {
      userId,
      username: targetUser.username,
      balance,
      ...stats
    }
  })

  // 获取用户余额日志（管理员）
  fastify.get<{
    Params: { userId: string }
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
      lotteryGift?: string
    }
  }>('/admin/:userId/logs', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { userId: string }; Querystring: { page?: string; pageSize?: string; type?: string; lotteryGift?: string } }>, reply: FastifyReply) => {
    const userId = parsePositiveRouteId(request.params.userId)
    if (!userId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { page = '1', pageSize = '20', type, lotteryGift } = request.query

    const result = await db.getBalanceLogs(userId, {
      page: parsePositiveIntegerQuery(page, 1),
      pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100),
      type: normalizeBalanceLogType(type),
      lotteryGift: (lotteryGift === 'exclude' || lotteryGift === 'only') ? lotteryGift : undefined
    })

    return {
      logs: result.logs.map(log => ({
        id: log.id,
        type: log.type,
        amount: Number(log.amount),
        balanceBefore: Number(log.balanceBefore),
        balanceAfter: Number(log.balanceAfter),
        orderId: log.orderId,
        instanceId: log.instanceId,
        instanceName: log.instance?.name || null,
        remark: log.remark,
        createdAt: log.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // 获取调账审批列表（管理员）
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      status?: string
      userId?: string
    }
  }>('/admin/adjustment-requests', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string; userId?: string } }>) => {
    const { page = '1', pageSize = '20', status, userId } = request.query
    const result = await db.getBalanceAdjustmentRequests({
      page: parsePositiveIntegerQuery(page, 1),
      pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100),
      status: normalizeBalanceAdjustmentRequestStatus(status),
      userId: userId ? parsePositiveRouteId(userId) || undefined : undefined
    })

    return {
      requests: result.requests.map(serializeBalanceAdjustmentRequest),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // 创建调账审批申请（管理员）
  fastify.post<{
    Params: { userId: string }
    Body: {
      amount: number
      reason: string
      requestType?: string
      sourceType?: string
      sourceId?: number
      orderNo?: string
    }
  }>('/admin/:userId/adjustment-requests', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{
    Params: { userId: string }
    Body: { amount: number; reason: string; requestType?: string; sourceType?: string; sourceId?: number; orderNo?: string }
  }>, reply: FastifyReply) => {
    const userId = parsePositiveRouteId(request.params.userId)
    if (!userId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let input: AdminBalanceAdjustmentRequestInput
    try {
      input = normalizeAdminBalanceAdjustmentRequestInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }

    const targetUser = await db.findUserById(userId)
    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const adjustmentRequest = await db.createBalanceAdjustmentRequest({
      userId,
      requestedByUserId: request.user.id,
      amount: input.amount,
      requestType: input.requestType,
      reason: input.reason,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      orderNo: input.orderNo
    })

    await createLog(
      request.user.id,
      'admin',
      'balance.adjustment_request.create',
      `创建调账审批申请 #${adjustmentRequest.id}，用户 ${targetUser.username}，金额 ${input.amount > 0 ? '+' : ''}${input.amount}，原因：${input.reason}`,
      'success'
    )

    return reply.code(201).send({
      message: '调账申请已提交，等待审核执行',
      request: serializeBalanceAdjustmentRequest(adjustmentRequest)
    })
  })

  // 审批通过并执行调账（管理员）
  fastify.post<{
    Params: { requestId: string }
    Body: { remark?: string }
  }>('/admin/adjustment-requests/:requestId/approve', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { requestId: string }; Body: { remark?: string } }>, reply: FastifyReply) => {
    const requestId = parsePositiveRouteId(request.params.requestId)
    if (!requestId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let input: AdminBalanceAdjustmentReviewInput
    try {
      input = normalizeAdminBalanceAdjustmentReviewInput(request.body, false)
    } catch (error) {
      return reply.code(400).send(error)
    }

    try {
      const result = await db.approveBalanceAdjustmentRequest(requestId, request.user.id, input.remark)

      await createLog(
        request.user.id,
        'admin',
        'balance.adjustment_request.approve',
        `审批通过调账申请 #${requestId}，用户 ${result.request.user.username}，金额 ${Number(result.request.amount) > 0 ? '+' : ''}${Number(result.request.amount)}，新余额 ${result.newBalance}`,
        'success'
      )

      try {
        if (result.request.user.email) {
          await sendBalanceAdjustedEmail(result.request.user.email, {
            username: result.request.user.username,
            amount: Number(result.request.amount),
            remark: result.request.reason,
            newBalance: result.newBalance,
            time: new Date()
          })
        }
      } catch (emailErr) {
        console.warn(`[调账审批] 发送邮件失败:`, emailErr)
      }

      return {
        message: '调账申请已通过并执行',
        newBalance: result.newBalance,
        request: serializeBalanceAdjustmentRequest(result.request)
      }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : '调账审批失败' })
    }
  })

  // 驳回调账申请（管理员）
  fastify.post<{
    Params: { requestId: string }
    Body: { remark?: string }
  }>('/admin/adjustment-requests/:requestId/reject', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { requestId: string }; Body: { remark?: string } }>, reply: FastifyReply) => {
    const requestId = parsePositiveRouteId(request.params.requestId)
    if (!requestId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let input: AdminBalanceAdjustmentReviewInput
    try {
      input = normalizeAdminBalanceAdjustmentReviewInput(request.body, true)
    } catch (error) {
      return reply.code(400).send(error)
    }

    try {
      const adjustmentRequest = await db.rejectBalanceAdjustmentRequest(requestId, request.user.id, input.remark!)
      await createLog(
        request.user.id,
        'admin',
        'balance.adjustment_request.reject',
        `驳回调账申请 #${requestId}，用户 ${adjustmentRequest.user.username}，原因：${input.remark}`,
        'success'
      )

      return {
        message: '调账申请已驳回',
        request: serializeBalanceAdjustmentRequest(adjustmentRequest)
      }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : '调账申请驳回失败' })
    }
  })

  // 管理员调整用户余额
  fastify.post<{
    Params: { userId: string }
    Body: {
      amount: number
      remark: string
    }
  }>('/admin/:userId/adjust', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { userId: string }; Body: { amount: number; remark: string } }>, reply: FastifyReply) => {
    const { user } = request
    const userId = parsePositiveRouteId(request.params.userId)

    if (!userId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let balanceInput: AdminBalanceAdjustInput
    try {
      balanceInput = normalizeAdminBalanceAdjustInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { amount, remark } = balanceInput

    const targetUser = await db.findUserById(userId)
    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const result = await db.adminAdjustBalance(
      userId,
      amount,
      `[管理员 ${user.username}] ${remark}`
    )

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'admin',
      'balance.adjust',
      `Adjusted balance for user ${targetUser.username}: ${amount > 0 ? '+' : ''}${amount}, reason: ${remark}`,
      'success'
    )

    // 发送余额调整邮件通知
    try {
      if (targetUser.email) {
        await sendBalanceAdjustedEmail(targetUser.email, {
          username: targetUser.username,
          amount,
          remark,
          newBalance: result.newBalance!,
          time: new Date()
        })
      }
    } catch (emailErr) {
      // 邮件失败不影响主流程
      console.warn(`[余额调整] 发送邮件失败:`, emailErr)
    }

    return {
      message: '余额调整成功',
      newBalance: result.newBalance,
      balanceLog: result.balanceLog ? {
        id: result.balanceLog.id,
        type: result.balanceLog.type,
        amount: Number(result.balanceLog.amount),
        balanceBefore: Number(result.balanceLog.balanceBefore),
        balanceAfter: Number(result.balanceLog.balanceAfter)
      } : null
    }
  })

  // 管理员赠送余额
  fastify.post<{
    Params: { userId: string }
    Body: {
      amount: number
      remark?: string
    }
  }>('/admin/:userId/gift', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { userId: string }; Body: { amount: number; remark?: string } }>, reply: FastifyReply) => {
    const { user } = request
    const userId = parsePositiveRouteId(request.params.userId)

    if (!userId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let balanceInput: AdminBalanceGiftInput
    try {
      balanceInput = normalizeAdminBalanceGiftInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { amount, remark } = balanceInput

    const targetUser = await db.findUserById(userId)
    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const result = await db.giftBalance(
      userId,
      amount,
      remark || `管理员 ${user.username} 赠送`
    )

    if (!result.success) {
      return reply.code(400).send({ error: result.error })
    }

    await createLog(
      user.id,
      'admin',
      'balance.gift',
      `Gifted ${amount} to user ${targetUser.username}`,
      'success'
    )

    // 发送余额赠送邮件通知
    try {
      if (targetUser.email) {
        await sendBalanceAdjustedEmail(targetUser.email, {
          username: targetUser.username,
          amount,
          remark: remark || '管理员赠送',
          newBalance: result.newBalance!,
          time: new Date()
        })
      }
    } catch (emailErr) {
      // 邮件失败不影响主流程
      console.warn(`[余额赠送] 发送邮件失败:`, emailErr)
    }

    return {
      message: '赠送成功',
      newBalance: result.newBalance
    }
  })
}
