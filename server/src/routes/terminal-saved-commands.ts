import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createTerminalSavedCommand,
  deleteTerminalSavedCommand,
  getTerminalSavedCommandsByUserId,
  updateTerminalSavedCommand
} from '../db/terminal-saved-commands.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export default async function terminalSavedCommandRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const commands = await getTerminalSavedCommandsByUserId(request.user.id)

    return { commands }
  })

  fastify.post<{
    Body: {
      name: string
      command: string
      description?: string | null
    }
  }>('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'command'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          command: { type: 'string', minLength: 1, maxLength: 16384 },
          description: { type: ['string', 'null'], maxLength: 300 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Body: {
      name: string
      command: string
      description?: string | null
    }
  }>, reply: FastifyReply) => {
    const result = await createTerminalSavedCommand({
      userId: request.user.id,
      name: request.body.name,
      command: request.body.command,
      description: request.body.description
    })

    if (!result.success) {
      const errorMap: Record<string, { status: number; message: string }> = {
        INVALID_NAME: { status: 400, message: 'Command name is required' },
        INVALID_COMMAND: { status: 400, message: 'Command content is required' },
        COMMAND_TOO_LARGE: { status: 400, message: 'Command content too large (max 16KB)' },
        MAX_COMMANDS_REACHED: { status: 400, message: 'Maximum saved terminal commands reached (100)' }
      }
      const target = errorMap[result.error] || { status: 400, message: result.error }
      return reply.code(target.status).send({ error: target.message, code: result.error })
    }

    await createLog(
      request.user.id,
      'terminal',
      'terminal.saved_command.create',
      `Created terminal saved command "${result.command.name}"`,
      'success'
    )

    return reply.code(201).send({
      message: 'Saved terminal command created',
      command: result.command
    })
  })

  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      command?: string
      description?: string | null
    }
  }>('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          command: { type: 'string', minLength: 1, maxLength: 16384 },
          description: { type: ['string', 'null'], maxLength: 300 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      name?: string
      command?: string
      description?: string | null
    }
  }>, reply: FastifyReply) => {
    const commandId = parsePositiveRouteId(request.params.id)
    if (!commandId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await updateTerminalSavedCommand(commandId, request.user.id, request.body)
    if (!result.success) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: 'Saved command not found' },
        INVALID_NAME: { status: 400, message: 'Command name is required' },
        INVALID_COMMAND: { status: 400, message: 'Command content is required' },
        COMMAND_TOO_LARGE: { status: 400, message: 'Command content too large (max 16KB)' }
      }
      const target = errorMap[result.error] || { status: 400, message: result.error }
      return reply.code(target.status).send({ error: target.message, code: result.error })
    }

    await createLog(
      request.user.id,
      'terminal',
      'terminal.saved_command.update',
      `Updated terminal saved command "${result.command.name}" (#${commandId})`,
      'success'
    )

    return {
      message: 'Saved terminal command updated',
      command: result.command
    }
  })

  fastify.delete<{
    Params: { id: string }
  }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const commandId = parsePositiveRouteId(request.params.id)
    if (!commandId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const deleted = await deleteTerminalSavedCommand(commandId, request.user.id)
    if (!deleted) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    await createLog(
      request.user.id,
      'terminal',
      'terminal.saved_command.delete',
      `Deleted terminal saved command #${commandId}`,
      'success'
    )

    return { message: 'Saved terminal command deleted' }
  })
}
