import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  ExchangeError,
  checkExchangeListingEligibility,
  createExchangeDispute,
  createExchangeListing,
  createExchangeWithdrawal,
  delistExchangeListing,
  getExchangeListingDetail,
  getPublicExchangePolicy,
  getExchangeWallet,
  getUserExchangeOrder,
  getUserExchangeListingForInstance,
  listExchangeDisputes,
  listExchangeMarket,
  listExchangeWalletLogs,
  listExchangeWithdrawals,
  listUserExchangeListings,
  listUserExchangeOrders,
  purchaseExchangeListing,
  releaseExchangeOrderEscrow,
  transferExchangeBalanceToUserBalance,
  updateExchangeListing
} from '../services/exchange.js'
import {
  claimOperationVerificationRequirement,
  type OperationType
} from '../lib/operation-verification.js'
import { prisma } from '../db/prisma.js'
import { createInstanceTask, InstanceTaskConflictError } from '../db/instance-tasks.js'
import { createLog } from '../db/logs.js'
import { getExchangeOperationLock } from '../services/exchange-operation-lock.js'

const POSITIVE_ID_RE = /^[1-9]\d*$/
const MAX_PAGE_SIZE = 100

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !POSITIVE_ID_RE.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_PAGE_SIZE)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExchangeError('EXCHANGE_INVALID_AMOUNT', `${field}必须是有效金额`)
  }
  return value
}

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new ExchangeError('EXCHANGE_INVALID_TEXT', '文本参数必须是字符串')
  }
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function parseOptionalPositiveId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && POSITIVE_ID_RE.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  throw new ExchangeError('EXCHANGE_INVALID_ID', `${field}无效`)
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key) return null
  if (key.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    throw new ExchangeError('EXCHANGE_INVALID_IDEMPOTENCY_KEY', '幂等键格式无效')
  }
  return key
}

function getRequestIdempotencyKey(request: FastifyRequest): string | null {
  const header = request.headers['idempotency-key'] || request.headers['x-idempotency-key']
  const headerValue = Array.isArray(header) ? header[0] : header
  if (headerValue) return normalizeIdempotencyKey(headerValue)
  if (isPlainRecord(request.body)) {
    return normalizeIdempotencyKey(request.body.idempotencyKey)
  }
  return null
}

function sendExchangeError(reply: FastifyReply, error: unknown) {
  if (error instanceof ExchangeError) {
    return reply.code(error.httpStatus).send({
      error: error.message,
      code: error.code,
      detail: error.detail
    })
  }
  throw error
}

async function requireExchangeVerification(
  userId: number,
  operationType: OperationType,
  reply: FastifyReply,
  resourceId?: number,
  idempotencyKey?: string | null
): Promise<boolean> {
  if (idempotencyKey && await hasExistingIdempotentExchangeAction(userId, operationType, idempotencyKey, resourceId)) {
    return true
  }
  const verification = await claimOperationVerificationRequirement(userId, operationType, resourceId)
  if (verification.verified) return true
  reply.code(403).send({
    error: '交易所资金敏感操作需要先完成二次验证',
    code: 'EXCHANGE_OPERATION_VERIFICATION_REQUIRED',
    required: verification.required
  })
  return false
}

async function hasExistingIdempotentExchangeAction(
  userId: number,
  operationType: OperationType,
  idempotencyKey: string,
  resourceId?: number
): Promise<boolean> {
  if (operationType === 'exchange_purchase') {
    const order = await prisma.exchangeOrder.findUnique({
      where: { idempotencyKey },
      select: { buyerUserId: true, listingId: true }
    })
    return !!order && order.buyerUserId === userId && order.listingId === resourceId
  }
  if (operationType === 'exchange_withdrawal') {
    const withdrawal = await prisma.exchangeWithdrawal.findUnique({
      where: { idempotencyKey },
      select: { userId: true }
    })
    return !!withdrawal && withdrawal.userId === userId
  }
  if (operationType === 'exchange_balance_transfer') {
    const log = await prisma.exchangeWalletLog.findUnique({
      where: { idempotencyKey },
      select: { userId: true, type: true }
    })
    return !!log && log.userId === userId && log.type === 'balance_transfer'
  }
  return false
}

function normalizeListingBody(body: unknown) {
  if (!isPlainRecord(body)) {
    throw new ExchangeError('EXCHANGE_INVALID_BODY', '请求参数无效')
  }
  const instanceId = parsePositiveId(body.instanceId)
  if (!instanceId) {
    throw new ExchangeError('EXCHANGE_INVALID_INSTANCE', '实例 ID 无效')
  }
  const autoDelistAt = parseOptionalDate(body.autoDelistAt)
  if (autoDelistAt === null) {
    throw new ExchangeError('EXCHANGE_INVALID_DATE', '自动下架时间无效')
  }
  return {
    instanceId,
    price: parseMoney(body.price, '出售价格'),
    description: normalizeText(body.description, 500),
    autoDelistAt,
    idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey)
  }
}

function normalizeListingUpdateBody(body: unknown) {
  if (!isPlainRecord(body)) {
    throw new ExchangeError('EXCHANGE_INVALID_BODY', '请求参数无效')
  }
  const autoDelistAt = parseOptionalDate(body.autoDelistAt)
  if (autoDelistAt === null) {
    throw new ExchangeError('EXCHANGE_INVALID_DATE', '自动下架时间无效')
  }
  const instanceId = body.instanceId === undefined || body.instanceId === null || body.instanceId === ''
    ? undefined
    : parsePositiveId(body.instanceId)
  if (instanceId === null) {
    throw new ExchangeError('EXCHANGE_INVALID_INSTANCE', '实例 ID 无效')
  }
  return {
    instanceId,
    price: parseMoney(body.price, '出售价格'),
    description: normalizeText(body.description, 500),
    autoDelistAt,
    idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey)
  }
}

function normalizePurchaseBody(body: unknown) {
  const record = isPlainRecord(body) ? body : {}
  return {
    idempotencyKey: normalizeIdempotencyKey(record.idempotencyKey),
    imageAlias: normalizeText(record.imageAlias, 200),
    sshKeyId: parseOptionalPositiveId(record.sshKeyId, 'SSH 密钥')
  }
}

export default async function exchangeRoutes(fastify: FastifyInstance) {
  fastify.get('/config', async () => getPublicExchangePolicy())

  fastify.get<{
    Querystring: { page?: string; pageSize?: string; packageId?: string }
  }>('/market', async (request, reply) => {
    try {
      return await listExchangeMarket({
        page: parsePage(request.query.page),
        pageSize: parsePageSize(request.query.pageSize),
        packageId: parseOptionalPositiveId(request.query.packageId, '套餐')
      })
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{ Params: { listingId: string } }>('/market/:listingId', async (request, reply) => {
    const listingId = parsePositiveId(request.params.listingId)
    if (!listingId) {
      return reply.code(400).send({ error: '挂牌 ID 无效' })
    }
    try {
      return await getExchangeListingDetail(listingId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{ Params: { instanceId: string } }>('/instances/:instanceId/eligibility', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveId(request.params.instanceId)
    if (!instanceId) {
      return reply.code(400).send({ error: '实例 ID 无效' })
    }
    try {
      return await checkExchangeListingEligibility(request.user.id, instanceId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{ Params: { instanceId: string } }>('/instances/:instanceId/listing-state', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveId(request.params.instanceId)
    if (!instanceId) {
      return reply.code(400).send({ error: '实例 ID 无效' })
    }
    try {
      return await getUserExchangeListingForInstance(request.user.id, instanceId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.post<{ Params: { instanceId: string } }>('/instances/:instanceId/stop-for-listing', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveId(request.params.instanceId)
    if (!instanceId) {
      return reply.code(400).send({ error: '实例 ID 无效' })
    }

    try {
      const eligibility = await checkExchangeListingEligibility(request.user.id, instanceId)
      if (eligibility.status === 'can_list') {
        return {
          message: '实例已暂停，可继续挂牌',
          status: 'already_stopped',
          eligibility
        }
      }
      if (eligibility.status !== 'must_stop_first') {
        return reply.code(400).send({
          error: '当前实例不能通过暂停进入交易所挂牌',
          code: 'EXCHANGE_INSTANCE_CANNOT_STOP_FOR_LISTING',
          eligibility
        })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, userId: request.user.id },
        select: { id: true, hostId: true, name: true, status: true }
      })
      if (!instance || instance.status !== 'running') {
        return reply.code(409).send({
          error: '只有运行中的实例可以先暂停后挂牌',
          code: 'EXCHANGE_INSTANCE_NOT_RUNNING',
          eligibility
        })
      }
      const exchangeLock = await getExchangeOperationLock(instanceId)
      if (exchangeLock.locked) {
        return reply.code(409).send({
          error: exchangeLock.message || '实例已上架交易所或处于交易锁定中，不能提交暂停后挂牌任务',
          code: exchangeLock.code || 'EXCHANGE_INSTANCE_LOCKED',
          listingId: exchangeLock.listingId,
          orderId: exchangeLock.orderId,
          eligibility
        })
      }

      const task = await createInstanceTask({
        instanceId,
        hostId: instance.hostId,
        userId: request.user.id,
        taskType: 'stop'
      })
      await createLog(request.user.id, 'instance', 'exchange.stop_for_listing', `Queued exchange listing stop task #${task.id} for instance "${instance.name}"`, 'success', { instanceId })
      return reply.code(202).send({
        message: '已提交暂停任务，完成后可继续检测并挂牌',
        taskId: task.id,
        status: task.status,
        nextAction: 'recheck_listing_eligibility'
      })
    } catch (error) {
      if (error instanceof InstanceTaskConflictError) {
        return reply.code(409).send({
          error: '实例存在执行中任务，暂停后挂牌任务无法提交',
          code: 'EXCHANGE_INSTANCE_HAS_ACTIVE_TASK',
          activeTask: error.activeTask
        })
      }
      if (!(error instanceof ExchangeError)) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : '提交暂停后挂牌任务失败',
          code: 'EXCHANGE_STOP_FOR_LISTING_FAILED'
        })
      }
      return sendExchangeError(reply, error)
    }
  })

  fastify.post('/listings', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    try {
      const input = normalizeListingBody(request.body)
      const listing = await createExchangeListing({ userId: request.user.id, ...input })
      return reply.code(201).send(listing)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.patch<{ Params: { listingId: string } }>('/listings/:listingId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const listingId = parsePositiveId(request.params.listingId)
    if (!listingId) {
      return reply.code(400).send({ error: '挂牌 ID 无效' })
    }
    try {
      const input = normalizeListingUpdateBody(request.body)
      const listing = await updateExchangeListing({ userId: request.user.id, listingId, ...input })
      return listing
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.delete<{ Params: { listingId: string } }>('/listings/:listingId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const listingId = parsePositiveId(request.params.listingId)
    if (!listingId) {
      return reply.code(400).send({ error: '挂牌 ID 无效' })
    }
    try {
      return await delistExchangeListing(request.user.id, listingId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/my/listings', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listUserExchangeListings(request.user.id, {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })

  fastify.post<{ Params: { listingId: string } }>('/market/:listingId/purchase', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const listingId = parsePositiveId(request.params.listingId)
    if (!listingId) {
      return reply.code(400).send({ error: '挂牌 ID 无效' })
    }
    try {
      const input = normalizePurchaseBody(request.body)
      const idempotencyKey = input.idempotencyKey || getRequestIdempotencyKey(request)
      const verified = await requireExchangeVerification(request.user.id, 'exchange_purchase', reply, listingId, idempotencyKey)
      if (!verified) return
      return await purchaseExchangeListing({
        userId: request.user.id,
        listingId,
        idempotencyKey,
        imageAlias: input.imageAlias,
        sshKeyId: input.sshKeyId
      })
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/my/buys', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listUserExchangeOrders(request.user.id, 'buyer', {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/my/sales', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listUserExchangeOrders(request.user.id, 'seller', {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })

  fastify.get<{ Params: { orderId: string } }>('/orders/:orderId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const orderId = parsePositiveId(request.params.orderId)
    if (!orderId) {
      return reply.code(400).send({ error: '交易订单 ID 无效' })
    }
    try {
      return await getUserExchangeOrder(request.user.id, orderId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.post<{ Params: { orderId: string } }>('/orders/:orderId/confirm', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const orderId = parsePositiveId(request.params.orderId)
    if (!orderId) {
      return reply.code(400).send({ error: '交易订单 ID 无效' })
    }
    try {
      await releaseExchangeOrderEscrow(orderId, {
        actorUserId: request.user.id,
        action: 'order.buyer_confirm',
        remark: `买家确认收货，交易所订单 ${orderId} 立即放款`,
        allowedStatuses: ['confirming'],
        expectedBuyerUserId: request.user.id
      })
      return await getUserExchangeOrder(request.user.id, orderId)
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get('/wallet', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return getExchangeWallet(request.user.id)
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/wallet/logs', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listExchangeWalletLogs(request.user.id, {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })

  fastify.post('/wallet/transfer', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    try {
      if (!isPlainRecord(request.body)) {
        throw new ExchangeError('EXCHANGE_INVALID_BODY', '请求参数无效')
      }
      const idempotencyKey = getRequestIdempotencyKey(request)
      const verified = await requireExchangeVerification(request.user.id, 'exchange_balance_transfer', reply, undefined, idempotencyKey)
      if (!verified) return
      return await transferExchangeBalanceToUserBalance({
        userId: request.user.id,
        amount: parseMoney(request.body.amount, '划转金额'),
        idempotencyKey
      })
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.post('/withdrawals', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    try {
      if (!isPlainRecord(request.body)) {
        throw new ExchangeError('EXCHANGE_INVALID_BODY', '请求参数无效')
      }
      const accountSnapshot = isPlainRecord(request.body.accountSnapshot)
        ? request.body.accountSnapshot
        : {}
      const idempotencyKey = getRequestIdempotencyKey(request)
      const verified = await requireExchangeVerification(request.user.id, 'exchange_withdrawal', reply, undefined, idempotencyKey)
      if (!verified) return
      return await createExchangeWithdrawal({
        userId: request.user.id,
        amount: parseMoney(request.body.amount, '提现金额'),
        method: normalizeText(request.body.method, 64),
        accountSnapshot,
        applicantRemark: normalizeText(request.body.applicantRemark, 500),
        idempotencyKey
      })
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/withdrawals', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listExchangeWithdrawals(request.user.id, {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })

  fastify.post<{ Params: { orderId: string } }>('/orders/:orderId/disputes', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const orderId = parsePositiveId(request.params.orderId)
    if (!orderId) {
      return reply.code(400).send({ error: '交易订单 ID 无效' })
    }
    try {
      if (!isPlainRecord(request.body)) {
        throw new ExchangeError('EXCHANGE_INVALID_BODY', '请求参数无效')
      }
      const reason = normalizeText(request.body.reason, 100)
      if (!reason) {
        throw new ExchangeError('EXCHANGE_DISPUTE_REASON_REQUIRED', '必须填写争议原因')
      }
      return await createExchangeDispute(
        request.user.id,
        orderId,
        reason,
        normalizeText(request.body.detail, 1000),
        getRequestIdempotencyKey(request)
      )
    } catch (error) {
      return sendExchangeError(reply, error)
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/disputes', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    return listExchangeDisputes(request.user.id, {
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize)
    })
  })
}
