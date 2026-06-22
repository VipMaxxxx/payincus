/**
 * 镜像管理路由
 * 系统镜像列表从数据库读取，支持管理员 CRUD
 */

import type { FastifyInstance } from 'fastify'
import {
  getVisibleSystemImages,
  getAllSystemImages,
  createSystemImage,
  updateSystemImage,
  deleteSystemImage,
  getSystemImageById
} from '../db/images.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { logSuccess } from '../db/logs.js'

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/

function parsePositiveInteger(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveRouteId(value: string): number | null {
  return parsePositiveInteger(value) ?? null
}

export default async function imageRoutes(fastify: FastifyInstance) {
  /**
   * 获取系统镜像列表（用户端 - 只返回未隐藏的）
   * @query type - 可选，按实例类型过滤 (container/vm)
   * @query memory - 可选，内存大小(MB)，128MB 时只返回 Alpine/Debian
   * @query hostId - 可选，按节点架构和镜像白名单过滤
   */
  fastify.get<{
    Querystring: { type?: 'container' | 'vm'; memory?: string; hostId?: string }
  }>('/system', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type, memory, hostId } = request.query
    const memoryNum = parsePositiveInteger(memory)
    const hostIdNum = parsePositiveInteger(hostId)

    if (memoryNum === null || hostIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const images = await getVisibleSystemImages(type, memoryNum, hostIdNum)
    return {
      success: true,
      images: images.map(img => ({
        id: img.id,
        name: img.name,
        remoteAlias: img.remoteAlias,
        osType: img.osType,
        architecture: img.architecture,
        instanceType: (img as { instanceType?: string }).instanceType || 'both',
        icon: img.icon
      }))
    }
  })

  /**
   * 管理员：获取所有镜像（包含隐藏的）
   */
  fastify.get('/admin', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    const images = await getAllSystemImages()
    return { success: true, images }
  })

  /**
   * 管理员：创建镜像
   */
  fastify.post<{
    Body: {
      name: string
      remoteAlias: string
      osType?: string
      architecture?: 'x86_64' | 'aarch64'
      instanceType?: 'container' | 'vm' | 'both'
      icon: string
      sortOrder?: number
      hidden?: boolean
    }
  }>('/admin', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const { name, remoteAlias, osType, architecture, instanceType, icon, sortOrder, hidden } = request.body

    if (!name || !remoteAlias || !icon) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_NAME))
    }

    try {
      const image = await createSystemImage({
        name,
        remoteAlias,
        osType,
        architecture,
        instanceType,
        icon,
        sortOrder,
        hidden
      })

      await logSuccess(
        request.user!.id,
        'images',
        'create',
        `Created system image: ${name} (${remoteAlias})`
      )

      return { success: true, image }
    } catch (error: any) {
      if (error.code === 'P2002') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_NAME, 'Remote alias already exists'))
      }
      throw error
    }
  })

  /**
   * 管理员：更新镜像
   */
  fastify.patch<{
    Params: { id: string }
    Body: {
      name?: string
      remoteAlias?: string
      osType?: string
      architecture?: 'x86_64' | 'aarch64'
      instanceType?: 'container' | 'vm' | 'both'
      icon?: string
      sortOrder?: number
      hidden?: boolean
    }
  }>('/admin/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const id = parsePositiveRouteId(request.params.id)
    const { name, remoteAlias, osType, architecture, instanceType, icon, sortOrder, hidden } = request.body

    if (!id) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const existing = await getSystemImageById(id)
    if (!existing) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    try {
      const image = await updateSystemImage(id, {
        name,
        remoteAlias,
        osType,
        architecture,
        instanceType,
        icon,
        sortOrder,
        hidden
      })

      await logSuccess(
        request.user!.id,
        'images',
        'update',
        `Updated system image: ${image.name}`
      )

      return { success: true, image }
    } catch (error: any) {
      if (error.code === 'P2002') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_NAME, 'Remote alias already exists'))
      }
      throw error
    }
  })

  /**
   * 管理员：删除镜像
   */
  fastify.delete<{
    Params: { id: string }
  }>('/admin/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const id = parsePositiveRouteId(request.params.id)

    if (!id) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const existing = await getSystemImageById(id)
    if (!existing) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    await deleteSystemImage(id)

    await logSuccess(
      request.user!.id,
      'images',
      'delete',
      `Deleted system image: ${existing.name}`
    )

    return { success: true }
  })
}
