import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PublicApiToken, User } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'

export const PUBLIC_API_TOKEN_PREFIX = 'pat_'
export const OAUTH_ACCESS_TOKEN_PREFIX = 'poa_'
export const PUBLIC_API_TOKEN_PREFIX_LENGTH = 16
export const PUBLIC_API_TOKEN_MAX_NAME_LENGTH = 80
export const PUBLIC_API_TOKEN_MAX_SCOPES = 24

export const PUBLIC_API_SCOPES = [
  'profile:read',
  'profile:write',
  'balance:read',
  'balance:write',
  'billing:read',
  'products:read',
  'services:read',
  'services:operate',
  'services:billing',
  'orders:read',
  'tickets:read',
  'tickets:write',
  'notifications:read',
  'notifications:send',
  'plugins:action'
] as const

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number]

export interface PublicApiScopeMetadata {
  scope: PublicApiScope
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
  access: 'read' | 'write' | 'operate'
  resources: string[]
  implemented: boolean
  notes: string[]
}

export const PUBLIC_API_SCOPE_METADATA: Record<PublicApiScope, PublicApiScopeMetadata> = {
  'profile:read': {
    scope: 'profile:read',
    title: '读取个人资料',
    description: '读取当前授权用户的基础资料摘要。',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/me'],
    implemented: true,
    notes: ['只返回 token 所属用户自己的资料字段。']
  },
  'profile:write': {
    scope: 'profile:write',
    title: '更新个人资料',
    description: '更新当前授权用户的低风险展示资料字段。',
    risk: 'medium',
    access: 'write',
    resources: ['/api/v1/me'],
    implemented: true,
    notes: ['仅允许更新 avatarStyle；邮箱、密码、角色、状态、余额和 2FA 设置不可写。']
  },
  'balance:read': {
    scope: 'balance:read',
    title: '读取余额',
    description: '读取当前授权用户的账户余额和安全余额流水。',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/balance', '/api/v1/balance/logs'],
    implemented: true,
    notes: ['不暴露支付 provider payload、调账对象、托管余额、AFF 余额或其他用户数据。']
  },
  'balance:write': {
    scope: 'balance:write',
    title: '提交余额调整申请',
    description: '提交并读取当前授权用户自己的待审批余额调整申请。',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/balance/adjustment-requests'],
    implemented: true,
    notes: ['不会直接修改余额、余额流水、支付记录或充值订单。']
  },
  'billing:read': {
    scope: 'billing:read',
    title: '读取账单',
    description: '读取当前授权用户的服务账单记录。',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/billing-records', '/api/v1/billing-records/:id'],
    implemented: true,
    notes: ['仅返回账单摘要；不返回 provider payload 和内部对账数据。']
  },
  'products:read': {
    scope: 'products:read',
    title: '读取产品目录',
    description: '读取已启用的公开产品和套餐目录。',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/products'],
    implemented: true,
    notes: ['仅返回已启用的套餐和方案。']
  },
  'services:read': {
    scope: 'services:read',
    title: '读取服务',
    description: '读取当前授权用户的服务摘要和安全关联信息。',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/services', '/api/v1/services/:id'],
    implemented: true,
    notes: ['不暴露 root 密码、Incus ID、节点内部配置或高权限连接材料。']
  },
  'services:operate': {
    scope: 'services:operate',
    title: '服务电源操作',
    description: '为当前授权用户的服务排队、查询和取消受控电源任务。',
    risk: 'high',
    access: 'operate',
    resources: ['/api/v1/services/:id/actions', '/api/v1/services/:id/tasks/:taskId'],
    implemented: true,
    notes: ['仅允许 start、stop、restart；不开放创建、暂停、续费、重装、删除、迁移和交付操作。']
  },
  'services:billing': {
    scope: 'services:billing',
    title: '服务计费操作',
    description: '通过内部计费状态机为当前授权用户的服务续费。',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/services/:id/renew'],
    implemented: true,
    notes: ['仅允许续费；余额扣减、账单记录、托管收益和过期服务解封由内部续费事务处理。']
  },
  'orders:read': {
    scope: 'orders:read',
    title: '读取订单',
    description: '读取当前授权用户的充值和实例账单订单。',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/orders', '/api/v1/orders/:id'],
    implemented: true,
    notes: ['不暴露支付回调、provider 配置快照、原始查询结果或完整交易号。']
  },
  'tickets:read': {
    scope: 'tickets:read',
    title: '读取工单',
    description: '读取当前授权用户的工单、消息和安全附件元数据。',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/tickets', '/api/v1/tickets/:id'],
    implemented: true,
    notes: ['不暴露内部备注、存储 provider ID 和其他用户工单。']
  },
  'tickets:write': {
    scope: 'tickets:write',
    title: '写入工单',
    description: '创建工单、添加公开回复、上传受控图片附件，并关闭或重新打开自己的工单。',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/tickets', '/api/v1/tickets/:id/replies', '/api/v1/tickets/:id/status'],
    implemented: true,
    notes: ['不允许内部备注、任意状态、优先级/分类覆盖、处理人变更或跨用户写入。']
  },
  'notifications:read': {
    scope: 'notifications:read',
    title: '读取通知',
    description: '读取当前授权用户的站内通知和未读数量。',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/notifications', '/api/v1/notifications/unread-count'],
    implemented: true,
    notes: ['不暴露渠道配置、外部投递日志、原始事件 payload、广播目标或其他用户消息。']
  },
  'notifications:send': {
    scope: 'notifications:send',
    title: '发送自有通知',
    description: '向当前授权用户自己发送短内容、受控模板通知。',
    risk: 'medium',
    access: 'write',
    resources: ['/api/v1/notifications'],
    implemented: true,
    notes: ['仅允许自有通知、平台模板和已启用扩展声明的模板；不允许广播、HTML、任意渠道或覆盖内部事件类型。']
  },
  'plugins:action': {
    scope: 'plugins:action',
    title: '扩展动作调用',
    description: '发现并调用已启用扩展声明的公开 webhook action。',
    risk: 'high',
    access: 'operate',
    resources: ['/api/v1/plugins', '/api/v1/plugins/:pluginId/actions', '/api/v1/plugins/:pluginId/actions/:action'],
    implemented: true,
    notes: ['不暴露 webhook URL、密钥、配置值、服务扩展 hook 或网关扩展 hook。']
  }
}

export function listPublicApiScopeMetadata(scopes: readonly PublicApiScope[] = PUBLIC_API_SCOPES): PublicApiScopeMetadata[] {
  return scopes.map(scope => PUBLIC_API_SCOPE_METADATA[scope])
}

export interface AuthenticatedPublicApiToken {
  id: number
  source: 'api_token' | 'oauth_access_token'
  userId: number
  name: string
  tokenPrefix: string
  scopes: PublicApiScope[]
  user: {
    id: number
    username: string
    email: string | null
    role: 'admin' | 'user'
    status: string
    avatarStyle: string
    avatarBadgeId: string | null
  }
}

type PublicApiTokenWithUser = PublicApiToken & {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'status' | 'avatarStyle' | 'avatarBadgeId'>
}

type OAuthAccessTokenWithUserAndApp = NonNullable<Awaited<ReturnType<typeof prisma.oAuthAccessToken.findUnique>>> & {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'status' | 'avatarStyle' | 'avatarBadgeId'>
  app: { name: string; clientId: string; enabled: boolean }
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

export function generatePublicApiToken(): string {
  return `${PUBLIC_API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashPublicApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getPublicApiTokenPrefix(token: string): string {
  return token.slice(0, PUBLIC_API_TOKEN_PREFIX_LENGTH)
}

export function normalizePublicApiTokenName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > PUBLIC_API_TOKEN_MAX_NAME_LENGTH) return null
  return trimmed
}

export function normalizePublicApiScopes(value: unknown): PublicApiScope[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > PUBLIC_API_TOKEN_MAX_SCOPES) {
    return null
  }

  const allowedScopes = new Set<string>(PUBLIC_API_SCOPES)
  const scopes = Array.from(new Set(value.map(scope => typeof scope === 'string' ? scope.trim() : '')))
    .filter((scope): scope is PublicApiScope => allowedScopes.has(scope))

  return scopes.length === value.length ? scopes : null
}

export function readPublicApiBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null

  const token = auth.slice('Bearer '.length).trim()
  const isPublicApiToken = token.startsWith(PUBLIC_API_TOKEN_PREFIX)
  const isOAuthAccessToken = token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
  if ((!isPublicApiToken && !isOAuthAccessToken) || token.length < 32) {
    return null
  }
  return token
}

function serializeScopes(value: unknown): PublicApiScope[] {
  const normalized = normalizePublicApiScopes(value)
  return normalized ?? []
}

function serializeAuthenticatedToken(token: PublicApiTokenWithUser): AuthenticatedPublicApiToken {
  return {
    id: token.id,
    source: 'api_token',
    userId: token.userId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: serializeScopes(token.scopes),
    user: {
      id: token.user.id,
      username: token.user.username,
      email: token.user.email,
      role: token.user.role as 'admin' | 'user',
      status: token.user.status,
      avatarStyle: token.user.avatarStyle,
      avatarBadgeId: token.user.avatarBadgeId
    }
  }
}

function serializeAuthenticatedOAuthToken(token: OAuthAccessTokenWithUserAndApp): AuthenticatedPublicApiToken {
  return {
    id: token.id,
    source: 'oauth_access_token',
    userId: token.userId,
    name: `OAuth app ${token.app.name}`,
    tokenPrefix: token.tokenPrefix,
    scopes: serializeScopes(token.scopes),
    user: {
      id: token.user.id,
      username: token.user.username,
      email: token.user.email,
      role: token.user.role as 'admin' | 'user',
      status: token.user.status,
      avatarStyle: token.user.avatarStyle,
      avatarBadgeId: token.user.avatarBadgeId
    }
  }
}

export async function authenticatePublicApiRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScope: PublicApiScope
): Promise<AuthenticatedPublicApiToken | null> {
  const rawToken = readPublicApiBearerToken(request)
  if (!rawToken) {
    reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_REQUIRED' })
    return null
  }

  if (rawToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    const tokenHash = hashPublicApiToken(rawToken)
    const tokenPrefix = getPublicApiTokenPrefix(rawToken)
    const token = await prisma.oAuthAccessToken.findUnique({
      where: { tokenHash },
      include: {
        app: { select: { name: true, clientId: true, enabled: true } },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        }
      }
    })

    if (!token || !safeTimingEqual(token.tokenHash, tokenHash) || token.tokenPrefix !== tokenPrefix) {
      reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_INVALID' })
      return null
    }

    if (!token.app.enabled) {
      reply.code(401).send({ error: 'OAuth app disabled', code: 'OAUTH_APP_DISABLED' })
      return null
    }

    if (token.revokedAt) {
      reply.code(401).send({ error: 'Token revoked', code: 'PUBLIC_API_TOKEN_REVOKED' })
      return null
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      reply.code(401).send({ error: 'Token expired', code: 'PUBLIC_API_TOKEN_EXPIRED' })
      return null
    }

    if (token.user.status !== 'active') {
      reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
      return null
    }

    const scopes = serializeScopes(token.scopes)
    if (!scopes.includes(requiredScope)) {
      await createLog(
        token.userId,
        LogModule.SECURITY,
        'oauth_provider.token_scope_denied',
        `OAuth app "${token.app.name}" missing required scope "${requiredScope}"`,
        LogResult.FAILED
      )
      reply.code(403).send({ error: 'Missing required API scope', code: 'PUBLIC_API_SCOPE_REQUIRED' })
      return null
    }

    await prisma.oAuthAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    })

    return serializeAuthenticatedOAuthToken(token)
  }

  const tokenHash = hashPublicApiToken(rawToken)
  const tokenPrefix = getPublicApiTokenPrefix(rawToken)
  const token = await prisma.publicApiToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      }
    }
  })

  if (!token || !safeTimingEqual(token.tokenHash, tokenHash) || token.tokenPrefix !== tokenPrefix) {
    reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_INVALID' })
    return null
  }

  if (token.revokedAt) {
    reply.code(401).send({ error: 'Token revoked', code: 'PUBLIC_API_TOKEN_REVOKED' })
    return null
  }

  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    reply.code(401).send({ error: 'Token expired', code: 'PUBLIC_API_TOKEN_EXPIRED' })
    return null
  }

  if (token.user.status !== 'active') {
    reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
    return null
  }

  const scopes = serializeScopes(token.scopes)
  if (!scopes.includes(requiredScope)) {
    await createLog(
      token.userId,
      LogModule.SECURITY,
      'public_api.token_scope_denied',
      `Public API token "${token.name}" missing required scope "${requiredScope}"`,
      LogResult.FAILED
    )
    reply.code(403).send({ error: 'Missing required API scope', code: 'PUBLIC_API_SCOPE_REQUIRED' })
    return null
  }

  await prisma.publicApiToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() }
  })

  return serializeAuthenticatedToken(token)
}
