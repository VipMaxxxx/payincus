/**
 * Fastify 类型扩展
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import type { JwtSignPayload } from '@fastify/jwt'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }

  interface FastifyRequest {
    user: {
      id: number
      username: string
      role: 'admin' | 'user'
      sid?: string
      iat?: number
      exp?: number
    }
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: number
      username: string
      role: 'admin' | 'user'
      sid?: string  // 会话标识，用于会话级别的 token 失效
    }
    user: {
      id: number
      username: string
      role: 'admin' | 'user'
      sid?: string
      iat?: number
      exp?: number
    }
  }
}

