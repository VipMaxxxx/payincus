/**
 * 用户自定义初始化命令路由
 * 用户可以管理自己的初始化命令模板
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  getCustomInitCommandsByUserId,
  getCustomInitCommandById,
  getEnabledCommandsByDistro,
  createCustomInitCommand,
  updateCustomInitCommand,
  deleteCustomInitCommand
} from '../db/custom-init-commands.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'

// 有效的发行版列表
const VALID_DISTROS = ['ubuntu', 'debian', 'rhel', 'alpine', 'arch', 'suse', 'all']

export default async function customInitCommandRoutes(fastify: FastifyInstance) {

  // 获取用户的所有初始化命令模板
  fastify.get('/', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest) => {
    const commands = await getCustomInitCommandsByUserId(request.user.id)

    return {
      commands: commands.map(cmd => ({
        id: cmd.id,
        name: cmd.name,
        // 命令内容截断显示
        commandPreview: truncateText(cmd.command, 100),
        commandLineCount: cmd.command.split('\n').filter(line => line.trim()).length,
        distros: cmd.distros,
        description: cmd.description,
        enabled: cmd.enabled,
        createdAt: cmd.createdAt,
        updatedAt: cmd.updatedAt
      }))
    }
  })

  // 获取适配指定发行版的命令列表（用于创建/重装实例时）
  fastify.get<{ Querystring: { distro: string } }>('/available', {
    onRequest: [fastify.authenticateUser],
    schema: {
      querystring: {
        type: 'object',
        required: ['distro'],
        properties: {
          distro: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { distro: string } }>) => {
    const { distro } = request.query
    
    const commands = await getEnabledCommandsByDistro(request.user.id, distro)

    return {
      commands: commands.map(cmd => ({
        id: cmd.id,
        name: cmd.name,
        commandLineCount: cmd.command.split('\n').filter(line => line.trim()).length,
        distros: cmd.distros,
        description: cmd.description
      }))
    }
  })

  // 获取单个命令详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const cmdId = Number(id)

    if (isNaN(cmdId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const cmd = await getCustomInitCommandById(cmdId)
    if (!cmd) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    // 只能查看自己的命令
    if (cmd.userId !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    return {
      command: {
        id: cmd.id,
        name: cmd.name,
        command: cmd.command,
        distros: cmd.distros,
        description: cmd.description,
        enabled: cmd.enabled,
        createdAt: cmd.createdAt,
        updatedAt: cmd.updatedAt
      }
    }
  })

  // 创建初始化命令模板
  fastify.post<{ Body: { name: string; command: string; distros: string[]; description?: string } }>('/', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'command', 'distros'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          command: { type: 'string', minLength: 1 },
          distros: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1
          },
          description: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { name: string; command: string; distros: string[]; description?: string } }>, reply: FastifyReply) => {
    const { name, command, distros, description } = request.body

    // 验证发行版列表
    const invalidDistros = distros.filter(d => !VALID_DISTROS.includes(d))
    if (invalidDistros.length > 0) {
      return reply.code(400).send({
        error: 'Invalid distros',
        details: { invalidDistros, validDistros: VALID_DISTROS }
      })
    }

    const result = await createCustomInitCommand({
      userId: request.user.id,
      name,
      command,
      distros,
      description
    })

    if (!result.success) {
      const errorMap: Record<string, { code: number; message: string }> = {
        'COMMAND_TOO_LARGE': { code: 400, message: 'Command content too large (max 64KB)' },
        'MAX_COMMANDS_REACHED': { code: 400, message: 'Maximum command templates reached (50)' },
        'INVALID_DISTROS': { code: 400, message: 'Invalid distros' }
      }
      const errInfo = errorMap[result.error] || { code: 400, message: result.error }
      return reply.code(errInfo.code).send({ error: errInfo.message })
    }

    await createLog(
      request.user.id,
      'custom_init_command',
      'custom_init_command.create',
      `Created init command template "${name}"`,
      'success'
    )

    reply.code(201).send({
      message: 'Init command created',
      id: result.id
    })
  })

  // 更新初始化命令模板
  fastify.put<{
    Params: { id: string }
    Body: { name?: string; command?: string; distros?: string[]; description?: string | null; enabled?: boolean }
  }>('/:id', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          command: { type: 'string', minLength: 1 },
          distros: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1
          },
          description: { type: ['string', 'null'], maxLength: 500 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { name?: string; command?: string; distros?: string[]; description?: string | null; enabled?: boolean }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const cmdId = Number(id)

    if (isNaN(cmdId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { name, command, distros, description, enabled } = request.body

    // 验证发行版列表
    if (distros) {
      const invalidDistros = distros.filter(d => !VALID_DISTROS.includes(d))
      if (invalidDistros.length > 0) {
        return reply.code(400).send({
          error: 'Invalid distros',
          details: { invalidDistros, validDistros: VALID_DISTROS }
        })
      }
    }

    const result = await updateCustomInitCommand(cmdId, request.user.id, {
      name,
      command,
      distros,
      description,
      enabled
    })

    if (!result.success) {
      const errorMap: Record<string, { code: number; message: string }> = {
        'NOT_FOUND': { code: 404, message: 'Command not found' },
        'COMMAND_TOO_LARGE': { code: 400, message: 'Command content too large (max 64KB)' },
        'INVALID_DISTROS': { code: 400, message: 'Invalid distros' }
      }
      const errInfo = errorMap[result.error] || { code: 400, message: result.error }
      return reply.code(errInfo.code).send({ error: errInfo.message })
    }

    await createLog(
      request.user.id,
      'custom_init_command',
      'custom_init_command.update',
      `Updated init command template ID ${cmdId}`,
      'success'
    )

    return { message: 'Init command updated' }
  })

  // 删除初始化命令模板
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const cmdId = Number(id)

    if (isNaN(cmdId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const deleted = await deleteCustomInitCommand(cmdId, request.user.id)
    if (!deleted) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    await createLog(
      request.user.id,
      'custom_init_command',
      'custom_init_command.delete',
      `Deleted init command template ID ${cmdId}`,
      'success'
    )

    return { message: 'Init command deleted' }
  })

  // 获取可用的发行版列表（前端使用）
  // 注意：名称由前端根据 id 进行翻译
  fastify.get('/distros', {
    onRequest: [fastify.authenticateUser]
  }, async () => {
    return {
      distros: [
        { id: 'ubuntu', icon: 'ubuntu' },
        { id: 'debian', icon: 'debian' },
        { id: 'rhel', icon: 'almalinux' },
        { id: 'alpine', icon: 'alpine' },
        { id: 'arch', icon: 'arch' },
        { id: 'suse', icon: 'opensuse' },
        { id: 'all', icon: 'linux' }
      ]
    }
  })
}

/**
 * 截断文本用于预览
 */
function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}
