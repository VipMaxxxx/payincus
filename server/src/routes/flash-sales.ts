import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { FlashSaleCampaignStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import {
  FlashSaleError,
  adjustFlashSaleItemStock,
  changeFlashSaleStatus,
  createFlashSaleCampaign,
  getAdminFlashSale,
  getAdminFlashSaleReservations,
  listAdminFlashSales,
  listPublicFlashSales,
  normalizeFlashSaleListParams,
  updateFlashSaleCampaign
} from '../services/flash-sales.js'

const POSITIVE_ID_RE = /^[1-9]\d*$/
const CAMPAIGN_STATUSES = new Set<FlashSaleCampaignStatus>(['draft', 'scheduled', 'active', 'paused', 'ended', 'cancelled'])

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !POSITIVE_ID_RE.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function parseOptionalDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseRequiredDate(value: unknown): Date | null {
  const parsed = parseOptionalDate(value)
  return parsed instanceof Date ? parsed : null
}

function parseStatus(value: unknown): FlashSaleCampaignStatus | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return typeof value === 'string' && CAMPAIGN_STATUSES.has(value as FlashSaleCampaignStatus)
    ? value as FlashSaleCampaignStatus
    : null
}

function parseNonNegativeInteger(value: unknown, fallback = 0): number | null {
  if (value === undefined || value === null || value === '') return fallback
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parsePositiveInteger(value: unknown, fallback = 1): number | null {
  if (value === undefined || value === null || value === '') return fallback
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function parseMoneyCents(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function sendRouteError(reply: FastifyReply, error: unknown) {
  if (error instanceof FlashSaleError) {
    return reply.code(error.httpStatus).send({ error: error.message, code: error.code })
  }
  throw error
}

function buildCampaignInput(body: Record<string, unknown>, actorUserId: number, partial = false) {
  const name = normalizeText(body.name)
  const startAt = parseOptionalDate(body.startAt)
  const endAt = parseOptionalDate(body.endAt)
  const status = parseStatus(body.status)
  const minAccountAgeHours = parseNonNegativeInteger(body.minAccountAgeHours, 0)
  const maxPerUser = parsePositiveInteger(body.maxPerUser, 1)

  if (!partial && !name) {
    throw new FlashSaleError('FLASH_SALE_NAME_REQUIRED', '活动名称不能为空')
  }
  if (!partial && !(startAt instanceof Date)) {
    throw new FlashSaleError('FLASH_SALE_START_REQUIRED', '开始时间无效')
  }
  if (!partial && !(endAt instanceof Date)) {
    throw new FlashSaleError('FLASH_SALE_END_REQUIRED', '结束时间无效')
  }
  if (status === null || minAccountAgeHours === null || maxPerUser === null) {
    throw new FlashSaleError('FLASH_SALE_INVALID_PARAMS', '活动参数无效')
  }

  const input: Record<string, unknown> = {
    actorUserId
  }
  if (name !== null) input.name = name
  if (body.description !== undefined) input.description = normalizeText(body.description, 1000)
  if (status !== undefined) input.status = status
  if (startAt instanceof Date) input.startAt = startAt
  if (endAt instanceof Date) input.endAt = endAt
  if (typeof body.requireTurnstile === 'boolean') input.requireTurnstile = body.requireTurnstile
  if (minAccountAgeHours !== undefined) input.minAccountAgeHours = minAccountAgeHours
  if (typeof body.requireEmail === 'boolean') input.requireEmail = body.requireEmail
  if (typeof body.blockRiskRestricted === 'boolean') input.blockRiskRestricted = body.blockRiskRestricted
  if (maxPerUser !== undefined) input.maxPerUser = maxPerUser
  if (body.notes !== undefined) input.notes = normalizeText(body.notes, 2000)
  return input
}

function parseItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new FlashSaleError('FLASH_SALE_ITEM_REQUIRED', '至少需要一个秒杀商品')
  }

  return value.map((raw) => {
    const item = raw as Record<string, unknown>
    const packagePlanId = parsePositiveId(item.packagePlanId)
    const flashPrice = parseMoneyCents(item.flashPrice)
    const totalStock = parsePositiveInteger(item.totalStock, 1)
    const perUserLimit = parsePositiveInteger(item.perUserLimit, 1)
    const sortOrder = parseNonNegativeInteger(item.sortOrder, 0)

    if (!packagePlanId || flashPrice === null || totalStock === null || perUserLimit === null || sortOrder === null) {
      throw new FlashSaleError('FLASH_SALE_INVALID_ITEM', '秒杀商品配置无效')
    }

    return {
      packagePlanId,
      flashPrice,
      totalStock,
      perUserLimit,
      allowCoupon: item.allowCoupon === true,
      allowAff: item.allowAff === true,
      sortOrder
    }
  })
}

export default async function flashSaleRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/flash-sales', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return listPublicFlashSales()
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/flash-sales/my-reservations', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>) => {
    const page = Math.max(1, Number(request.query.page || 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20) || 20))
    const where = { userId: request.user.id }
    const [total, reservations] = await Promise.all([
      prisma.flashSaleReservation.count({ where }),
      prisma.flashSaleReservation.findMany({
        where,
        include: {
          campaign: { select: { id: true, name: true } },
          item: {
            include: {
              packagePlan: {
                include: { package: true }
              }
            }
          },
          instance: { select: { id: true, name: true, status: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    return {
      reservations: reservations.map((reservation) => ({
        id: reservation.id,
        campaignId: reservation.campaignId,
        campaignName: reservation.campaign.name,
        itemId: reservation.itemId,
        packageName: reservation.item.packagePlan.package.name,
        planName: reservation.item.packagePlan.name,
        instance: reservation.instance,
        status: reservation.status,
        amount: Number(reservation.amount),
        failureReason: reservation.failureReason,
        createdAt: reservation.createdAt.toISOString(),
        paidAt: reservation.paidAt?.toISOString() ?? null,
        deliveredAt: reservation.deliveredAt?.toISOString() ?? null,
        refundedAt: reservation.refundedAt?.toISOString() ?? null
      })),
      total,
      page,
      pageSize
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string; status?: string }
  }>('/admin/flash-sales', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string } }>) => {
    return listAdminFlashSales(normalizeFlashSaleListParams(request.query))
  })

  fastify.get<{
    Params: { id: string }
  }>('/admin/flash-sales/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ID', code: 'INVALID_ID' })
    const campaign = await getAdminFlashSale(id)
    if (!campaign) return reply.code(404).send({ error: 'Flash sale not found', code: 'FLASH_SALE_NOT_FOUND' })
    return { campaign }
  })

  fastify.post<{
    Body: Record<string, unknown>
  }>('/admin/flash-sales', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    try {
      const startAt = parseRequiredDate(request.body.startAt)
      const endAt = parseRequiredDate(request.body.endAt)
      if (!startAt || !endAt) {
        return reply.code(400).send({ error: 'Invalid start or end time', code: 'FLASH_SALE_INVALID_TIME' })
      }
      const input = buildCampaignInput(request.body, request.user.id, false) as Parameters<typeof createFlashSaleCampaign>[0]
      input.startAt = startAt
      input.endAt = endAt
      input.items = parseItems(request.body.items)
      const campaign = await createFlashSaleCampaign(input)
      await createLog(request.user.id, 'admin', 'flash-sale.create', `Created flash sale "${input.name}"`, 'success')
      return { success: true, campaign }
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  fastify.patch<{
    Params: { id: string }
    Body: Record<string, unknown>
  }>('/admin/flash-sales/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ID', code: 'INVALID_ID' })
    try {
      const input = buildCampaignInput(request.body, request.user.id, true) as Parameters<typeof updateFlashSaleCampaign>[1]
      const campaign = await updateFlashSaleCampaign(id, input)
      if (!campaign) return reply.code(404).send({ error: 'Flash sale not found', code: 'FLASH_SALE_NOT_FOUND' })
      await createLog(request.user.id, 'admin', 'flash-sale.update', `Updated flash sale #${id}`, 'success')
      return { success: true, campaign }
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  fastify.post<{
    Params: { id: string }
    Body: { status?: string; reason?: string }
  }>('/admin/flash-sales/:id/status', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { status?: string; reason?: string } }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    const status = parseStatus(request.body.status)
    if (!id || !status) return reply.code(400).send({ error: 'Invalid status', code: 'FLASH_SALE_INVALID_STATUS' })
    const campaign = await changeFlashSaleStatus(id, status, request.user.id, request.body.reason)
    if (!campaign) return reply.code(404).send({ error: 'Flash sale not found', code: 'FLASH_SALE_NOT_FOUND' })
    await createLog(request.user.id, 'admin', 'flash-sale.status', `Changed flash sale #${id} to ${status}`, 'success')
    return { success: true, campaign }
  })

  fastify.post<{
    Params: { itemId: string }
    Body: { totalStock?: number; reason?: string }
  }>('/admin/flash-sales/items/:itemId/stock', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { itemId: string }; Body: { totalStock?: number; reason?: string } }>, reply: FastifyReply) => {
    const itemId = parsePositiveId(request.params.itemId)
    if (!itemId) return reply.code(400).send({ error: 'Invalid ID', code: 'INVALID_ID' })
    try {
      const item = await adjustFlashSaleItemStock(itemId, Number(request.body.totalStock), request.user.id, request.body.reason)
      if (!item) return reply.code(404).send({ error: 'Flash sale item not found', code: 'FLASH_SALE_ITEM_NOT_FOUND' })
      await createLog(request.user.id, 'admin', 'flash-sale.stock', `Adjusted flash sale item #${itemId} stock to ${request.body.totalStock}`, 'success')
      return { success: true, item }
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>('/admin/flash-sales/:id/reservations', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ID', code: 'INVALID_ID' })
    return getAdminFlashSaleReservations(id, request.query)
  })

  fastify.get<{
    Params: { id: string }
  }>('/admin/flash-sales/:id/audit-logs', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ID', code: 'INVALID_ID' })
    const logs = await prisma.flashSaleAuditLog.findMany({
      where: { campaignId: id },
      include: { actor: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    return {
      logs: logs.map(log => ({
        id: log.id,
        campaignId: log.campaignId,
        itemId: log.itemId,
        actor: log.actor,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt.toISOString()
      }))
    }
  })
}
