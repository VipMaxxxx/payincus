/**
 * 系统兑换码管理路由
 * 宿主机所有者可以管理其节点的兑换码
 */

import type { FastifyInstance } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { RedeemCodeType } from '@prisma/client'

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
    const hostId = parseInt(request.params.hostId)
    const { limit = 50, offset = 0, enabled } = request.query

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
    const hostId = parseInt(request.params.hostId)
    const { codeType, codeValue, maxUses, expiresAt, remark, batchCount } = request.body

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证数值是否在允许范围内（使用范围验证，允许自定义值）
    if (!db.isValidCodeValue(codeType as RedeemCodeType, codeValue)) {
      const range = db.CODE_VALUE_RANGES[codeType as RedeemCodeType]
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, `Value must be between ${range.min} and ${range.max} for type ${codeType}`))
    }

    const expiresAtDate = expiresAt ? new Date(expiresAt) : null

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
    const hostId = parseInt(request.params.hostId)
    const codeId = parseInt(request.params.codeId)
    const { enabled, remark, maxUses, expiresAt } = request.body

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      await db.updateRedeemCode(codeId, {
        enabled,
        remark,
        maxUses,
        expiresAt: expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : undefined
      })

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
    const hostId = parseInt(request.params.hostId)
    const codeId = parseInt(request.params.codeId)

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      await db.deleteRedeemCode(codeId)
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
          ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parseInt(request.params.hostId)
    const { ids } = request.body

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      await db.deleteRedeemCodeBatch(ids)
      return { message: 'Batch deleted successfully', count: ids.length }
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
    const hostId = parseInt(request.params.hostId)
    const codeId = parseInt(request.params.codeId)
    const { limit = 20, offset = 0 } = request.query

    // 检查宿主机是否存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const result = await db.getRedeemCodeUsages(codeId, { limit, offset })
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
