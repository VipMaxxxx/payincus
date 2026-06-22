/**
 * 系统兑换码管理路由
 * 宿主机所有者可以管理其节点的兑换码
 */

import type { FastifyInstance } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { RedeemCodeType } from '@prisma/client'

const REDEEM_CODE_TYPES: RedeemCodeType[] = ['c', 'r', 'd', 't']
const MAX_REDEEM_CODE_BATCH_COUNT = 100
const MAX_REDEEM_CODE_MAX_USES = 1000
const MAX_REDEEM_CODE_REMARK_LENGTH = 200

// 资源类型名称映射
const CODE_TYPE_NAMES: Record<string, string> = {
  c: 'CPU',
  r: 'Memory',
  d: 'Disk',
  t: 'Traffic'
}

// 资源单位映射
const CODE_TYPE_UNITS: Record<string, string> = {
  c: '%',
  r: 'MB',
  d: 'MB',
  t: 'GB'
}

function parsePositiveId(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizePositiveUniqueIds(values: unknown[]): number[] | null {
  const ids = new Set<number>()

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || ids.has(value)) {
      return null
    }
    ids.add(value)
  }

  return Array.from(ids)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRedeemCodeInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw apiError(ErrorCode.INVALID_PARAMS, `${field} must be an integer`)
  }
  if (value < min || value > max) {
    throw apiError(ErrorCode.INVALID_PARAMS, `${field} must be between ${min} and ${max}`)
  }
  return value
}

function normalizeRedeemCodeType(value: unknown): RedeemCodeType {
  if (typeof value !== 'string' || !REDEEM_CODE_TYPES.includes(value as RedeemCodeType)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid redeem code type')
  }
  return value as RedeemCodeType
}

function normalizeOptionalRedeemCodeRemark(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid remark')
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_REDEEM_CODE_REMARK_LENGTH || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid remark')
  }
  return trimmed || undefined
}

function normalizeOptionalExpiryDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null || value.trim() === '') {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function normalizeRedeemCodeCreateBody(input: unknown): {
  codeType: RedeemCodeType
  codeValue: number
  maxUses?: number
  expiresAt?: string | null
  remark?: string
  batchCount?: number
} {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid request body')
  }

  const codeType = normalizeRedeemCodeType(input.codeType)
  const codeValueRange = db.CODE_VALUE_RANGES[codeType]
  const codeValue = requireRedeemCodeInteger(input.codeValue, 'codeValue', codeValueRange.min, codeValueRange.max)
  const maxUses = input.maxUses === undefined
    ? undefined
    : requireRedeemCodeInteger(input.maxUses, 'maxUses', 1, MAX_REDEEM_CODE_MAX_USES)
  const batchCount = input.batchCount === undefined
    ? undefined
    : requireRedeemCodeInteger(input.batchCount, 'batchCount', 1, MAX_REDEEM_CODE_BATCH_COUNT)
  if (input.expiresAt !== undefined && input.expiresAt !== null && typeof input.expiresAt !== 'string') {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date')
  }

  return {
    codeType,
    codeValue,
    maxUses,
    expiresAt: input.expiresAt as string | null | undefined,
    remark: normalizeOptionalRedeemCodeRemark(input.remark),
    batchCount
  }
}

function normalizeRedeemCodeUpdateBody(input: unknown): {
  enabled?: boolean
  remark?: string
  maxUses?: number
  expiresAt?: string | null
} {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid request body')
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw apiError(ErrorCode.INVALID_PARAMS, 'enabled must be a boolean')
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null && typeof input.expiresAt !== 'string') {
    throw apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date')
  }

  return {
    enabled: input.enabled as boolean | undefined,
    remark: normalizeOptionalRedeemCodeRemark(input.remark),
    maxUses: input.maxUses === undefined
      ? undefined
      : requireRedeemCodeInteger(input.maxUses, 'maxUses', 1, MAX_REDEEM_CODE_MAX_USES),
    expiresAt: input.expiresAt as string | null | undefined
  }
}

function normalizeRedeemCodeBatchDeleteBody(input: unknown): number[] | null {
  if (!isPlainRecord(input) || !Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 100) {
    return null
  }
  return normalizePositiveUniqueIds(input.ids)
}

export default async function redeemCodesRoutes(fastify: FastifyInstance) {
  // ==================== 获取宿主机的兑换码列表 ====================
  fastify.get<{
    Params: { hostId: string }
    Querystring: { limit?: number; offset?: number; enabled?: string }
  }>('/hosts/:hostId/redeem-codes', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          enabled: { type: 'string', enum: ['true', 'false'] }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    const { limit = 50, offset = 0, enabled } = request.query

    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host ID'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const result = await db.getRedeemCodesByHost(hostId, {
      limit,
      offset,
      enabled: enabled !== undefined ? enabled === 'true' : undefined
    })

    return result
  })

  // ==================== 创建兑换码 ====================
  fastify.post<{
    Params: { hostId: string }
    Body: {
      codeType: RedeemCodeType
      codeValue: number
      maxUses?: number
      expiresAt?: string | null
      remark?: string
      batchCount?: number
    }
  }>('/hosts/:hostId/redeem-codes', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' }
        }
      },
      body: {
        type: 'object',
        required: ['codeType', 'codeValue'],
        properties: {
          codeType: { type: 'string', enum: ['c', 'r', 'd', 't'] },
          codeValue: { type: 'integer', minimum: 1 },
          maxUses: { type: 'integer', minimum: 1, maximum: 1000 },
          expiresAt: { type: ['string', 'null'] },
          remark: { type: 'string', maxLength: 200 },
          batchCount: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    let body: ReturnType<typeof normalizeRedeemCodeCreateBody>
    try {
      body = normalizeRedeemCodeCreateBody(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { codeType, codeValue, maxUses, expiresAt, remark, batchCount } = body

    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host ID'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const normalizedExpiresAt = normalizeOptionalExpiryDate(expiresAt)
    if (normalizedExpiresAt === undefined && expiresAt !== undefined) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date'))
    }
    const expiresAtDate = normalizedExpiresAt ?? null

    try {
      if (batchCount && batchCount > 1) {
        // 批量创建一次性兑换码
        const { codes, batchId } = await db.createRedeemCodeBatch({
          hostId,
          createdById: user.id,
          codeType: codeType as RedeemCodeType,
          codeValue,
          count: batchCount,
          expiresAt: expiresAtDate,
          remark
        })

        const typeName = CODE_TYPE_NAMES[codeType] || codeType
        const unit = CODE_TYPE_UNITS[codeType] || ''
        await createLog(
          user.id,
          'redeem_code',
          'batch_create',
          `Created ${batchCount} redeem codes for host "${host.name}" (ID: ${hostId}): ${typeName} +${codeValue}${unit}, batch: ${batchId}`,
          'success'
        )

        return {
          message: 'Batch created successfully',
          codes,
          batchId,
          count: batchCount
        }
      } else {
        // 创建单个兑换码（可多次使用）
        const code = await db.createRedeemCode({
          hostId,
          createdById: user.id,
          codeType: codeType as RedeemCodeType,
          codeValue,
          maxUses: maxUses ?? 1,
          expiresAt: expiresAtDate,
          remark
        })

        const typeName = CODE_TYPE_NAMES[codeType] || codeType
        const unit = CODE_TYPE_UNITS[codeType] || ''
        await createLog(
          user.id,
          'redeem_code',
          'create',
          `Created redeem code for host "${host.name}" (ID: ${hostId}): ${typeName} +${codeValue}${unit}, max uses: ${maxUses ?? 1}`,
          'success'
        )

        return {
          message: 'Created successfully',
          code: code.code,
          id: code.id
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        'redeem_code',
        'create.failed',
        `Failed to create redeem code for host (ID: ${hostId}): ${errorMessage}`,
        'failed'
      )
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 更新兑换码 ====================
  fastify.patch<{
    Params: { hostId: string; codeId: string }
    Body: {
      enabled?: boolean
      remark?: string
      maxUses?: number
      expiresAt?: string | null
    }
  }>('/hosts/:hostId/redeem-codes/:codeId', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId', 'codeId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' },
          codeId: { type: 'string', pattern: '^\\d+$' }
        }
      },
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          remark: { type: 'string', maxLength: 200 },
          maxUses: { type: 'integer', minimum: 1, maximum: 1000 },
          expiresAt: { type: ['string', 'null'] }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    const codeId = parsePositiveId(request.params.codeId)
    let body: ReturnType<typeof normalizeRedeemCodeUpdateBody>
    try {
      body = normalizeRedeemCodeUpdateBody(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { enabled, remark, maxUses, expiresAt } = body

    if (hostId === null || codeId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host or redeem code ID'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const expiresAtDate = normalizeOptionalExpiryDate(expiresAt)
      if (expiresAtDate === undefined && expiresAt !== undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date'))
      }

      const updated = await db.updateRedeemCodeForHost(hostId, codeId, {
        enabled,
        remark,
        maxUses,
        expiresAt: expiresAtDate
      })
      if (!updated) {
        return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
      }

      return { message: 'Updated successfully' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 删除兑换码 ====================
  fastify.delete<{
    Params: { hostId: string; codeId: string }
  }>('/hosts/:hostId/redeem-codes/:codeId', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId', 'codeId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' },
          codeId: { type: 'string', pattern: '^\\d+$' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    const codeId = parsePositiveId(request.params.codeId)

    if (hostId === null || codeId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host or redeem code ID'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const deleted = await db.deleteRedeemCodeForHost(hostId, codeId)
      if (!deleted) {
        return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
      }
      return { message: 'Deleted successfully' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 批量删除兑换码 ====================
  fastify.post<{
    Params: { hostId: string }
    Body: { ids: number[] }
  }>('/hosts/:hostId/redeem-codes/batch-delete', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' }
        }
      },
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)

    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host ID'))
    }

    const normalizedIds = normalizeRedeemCodeBatchDeleteBody(request.body)
    if (!normalizedIds) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid redeem code IDs'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const deletedCount = await db.deleteRedeemCodeBatchForHost(hostId, normalizedIds)
      if (deletedCount !== normalizedIds.length) {
        return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
      }
      return { message: 'Batch deleted successfully', count: deletedCount }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 获取兑换码使用记录 ====================
  fastify.get<{
    Params: { hostId: string; codeId: string }
    Querystring: { limit?: number; offset?: number }
  }>('/hosts/:hostId/redeem-codes/:codeId/usages', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['hostId', 'codeId'],
        properties: {
          hostId: { type: 'string', pattern: '^\\d+$' },
          codeId: { type: 'string', pattern: '^\\d+$' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    const codeId = parsePositiveId(request.params.codeId)
    const { limit = 20, offset = 0 } = request.query

    if (hostId === null || codeId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host or redeem code ID'))
    }

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!await db.isRedeemCodeBelongsToHost(codeId, hostId)) {
      return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
    }

    const result = await db.getRedeemCodeUsagesForHost(hostId, codeId, { limit, offset })
    return result
  })

  // ==================== 获取可选的资源类型和范围 ====================
  fastify.get('/redeem-code-options', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return {
      types: [
        { value: 'c', label: 'CPU', unit: '%' },
        { value: 'r', label: 'Memory', unit: 'MB' },
        { value: 'd', label: 'Disk', unit: 'MB' },
        { value: 't', label: 'Traffic', unit: 'GB' }
      ],
      // 返回范围限制，允许前端自定义输入
      ranges: db.CODE_VALUE_RANGES
    }
  })
}
