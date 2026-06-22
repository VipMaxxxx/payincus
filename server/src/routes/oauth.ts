/**
 * OAuth 认证路由
 * 支持 GitHub 和 Google 快捷登录/绑定
 * 
 * 安全增强：使用 Redis 存储的一次性 state token 防止 CSRF 和重放攻击
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import {
  generateOAuthState,
  verifyAndConsumeOAuthState,
  logSecurityEvent,
  SecurityEventType,
  generateRefreshToken,
  getRefreshTokenSessionId,
  detectNewLoginLocation,
  generateOAuthLoginCode,
  verifyAndConsumeOAuthLoginCode,
  isAccessTokenInvalidated,
  revokeAllUserRefreshTokens,
  invalidateUserAccessTokens
} from '../lib/security.js'
import { sendLoginAlertEmail } from '../lib/mailer.js'
import { getRefreshTokenCookieOptions } from '../lib/cookie-config.js'
import { getSafeRedirectUrl } from '../lib/redirect-validator.js'
import { consumeOAuthBindTicket, generateOAuthBindTicket } from '../lib/action-ticket.js'
import { sanitizeObject, sanitizeTokensInString } from '../lib/log-sanitizer.js'
import { readLimitedTextResponse } from '../lib/http-response.js'
import { closeUserSessions } from '../lib/terminal-proxy.js'


// OAuth 提供商配置
const OAUTH_PROVIDERS = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scope: 'read:user user:email'
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile'
  }
} as const

type OAuthProvider = keyof typeof OAUTH_PROVIDERS
const OAUTH_SECRET_UNCHANGED_PLACEHOLDER = 'UNCHANGED'
const OAUTH_PROVIDER_FETCH_TIMEOUT_MS = 15_000
const OAUTH_PROVIDER_MAX_RESPONSE_BYTES = 128 * 1024

function normalizePublicBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function getConfiguredPublicBaseUrl(): string | null {
  const configured = process.env.SITE_URL?.trim()
    || process.env.FRONTEND_URL?.split(',')[0]?.trim()

  if (!configured) {
    return null
  }

  const normalized = normalizePublicBaseUrl(configured)
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function getOAuthCallbackBaseUrl(request: FastifyRequest): string {
  const configured = getConfiguredPublicBaseUrl()
  if (configured) {
    return configured
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SITE_URL or FRONTEND_URL must be configured before OAuth can be used in production')
  }

  return `${request.protocol}://${request.hostname}`
}

function buildOAuthCallbackUrl(request: FastifyRequest, provider: OAuthProvider): string {
  return `${getOAuthCallbackBaseUrl(request)}/api/oauth/callback/${provider}`
}

async function readOAuthJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await readLimitedTextResponse(response, label, OAUTH_PROVIDER_MAX_RESPONSE_BYTES)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

export default async function oauthRoutes(fastify: FastifyInstance) {

  // ==================== 管理员配置 API ====================

  /**
   * 获取所有 OAuth 配置（管理员）
   */
  fastify.get('/configs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const configs = await db.getOAuthConfigs()

    return {
      configs: configs.map(c => ({
        provider: c.provider,
        clientId: c.client_id,
        // Client Secret 只返回部分，用于确认已配置
        clientSecretMasked: c.client_secret ? '****' + c.client_secret.slice(-4) : null,
        enabled: Boolean(c.enabled),
        updatedAt: c.updated_at
      }))
    }
  })

  /**
   * 更新 OAuth 配置（管理员）
   */
  fastify.put<{
    Params: { provider: OAuthProvider }
    Body: { clientId: string; clientSecret?: string; enabled?: boolean }
  }>('/configs/:provider', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      params: {
        type: 'object',
        required: ['provider'],
        properties: {
          provider: { type: 'string', enum: ['github', 'google'] }
        }
      },
      body: {
        type: 'object',
        required: ['clientId'],
        properties: {
          clientId: { type: 'string', minLength: 1 },
          clientSecret: { type: 'string' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { provider: OAuthProvider }
    Body: { clientId: string; clientSecret?: string; enabled?: boolean }
  }>, _reply: FastifyReply) => {
    const { provider } = request.params
    const { clientId, clientSecret, enabled = false } = request.body
    const existingConfig = await db.getOAuthConfig(provider)
    const shouldKeepExistingSecret = existingConfig && (
      clientSecret === undefined ||
      clientSecret === '' ||
      clientSecret === OAUTH_SECRET_UNCHANGED_PLACEHOLDER
    )

    if (!existingConfig && !clientSecret) {
      return _reply.code(400).send({ error: 'Client Secret is required', code: 'OAUTH_CLIENT_SECRET_REQUIRED' })
    }

    await db.upsertOAuthConfig(provider, {
      clientId,
      clientSecret: shouldKeepExistingSecret ? existingConfig.client_secret : clientSecret!,
      enabled
    })

    return { message: `${provider} OAuth 配置已更新` }
  })

  /**
   * 删除 OAuth 配置（管理员）
   */
  fastify.delete<{ Params: { provider: OAuthProvider } }>('/configs/:provider', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { provider: OAuthProvider } }>, _reply: FastifyReply) => {
    const { provider } = request.params
    await db.deleteOAuthConfig(provider)

    return { message: `${provider} OAuth 配置已删除` }
  })

  // ==================== 公共 API ====================

  /**
   * 获取启用的 OAuth 提供商（用于登录页显示）
   */
  fastify.get('/providers', async () => {
    const configs = await db.getEnabledOAuthConfigs()
    return {
      providers: configs.map(c => c.provider)
    }
  })

  // ==================== OAuth 认证流程 ====================

  fastify.post('/bind-ticket', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user.iat) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    return {
      ticket: generateOAuthBindTicket(
        request.user.id,
        request.user.iat,
        request.user.sid
      ),
      expiresIn: 60
    }
  })

  /**
   * 发起 OAuth 认证
   * mode: 'login' (登录) | 'bind' (绑定)
   * 
   * 安全增强：使用一次性 state token
   * 绑定模式使用短期 bind ticket，避免在 URL 中传递登录 JWT
   */
  fastify.get<{
    Params: { provider: OAuthProvider }
    Querystring: { mode?: string; redirect?: string; bindTicket?: string }
  }>('/authorize/:provider', async (request: FastifyRequest<{
    Params: { provider: OAuthProvider }
    Querystring: { mode?: string; redirect?: string; bindTicket?: string }
  }>, reply: FastifyReply) => {
    const { provider } = request.params
    const { mode = 'login', redirect, bindTicket } = request.query

    if (!OAUTH_PROVIDERS[provider]) {
      return reply.code(400).send({ error: 'Unsupported OAuth provider', code: 'INVALID_PROVIDER' })
    }

    const config = await db.getOAuthConfig(provider)
    if (!config || !config.enabled) {
      return reply.code(400).send(apiError(ErrorCode.OAUTH_NOT_ENABLED, provider))
    }

    const providerConfig = OAUTH_PROVIDERS[provider]

    // 生成安全的一次性 state token（存储到 Redis）
    const validMode = mode === 'bind' ? 'bind' : 'login'

    // 绑定模式下需要验证短期票据
    let bindSession: { userId: number; issuedAt: number; sessionId?: string } | undefined
    if (validMode === 'bind') {
      if (!bindTicket) {
        return reply.redirect(`/profile?error=not_logged_in`)
      }

      const ticketData = consumeOAuthBindTicket(bindTicket)
      if (!ticketData.valid || !ticketData.userId || !ticketData.issuedAt) {
        return reply.redirect(`/profile?error=invalid_session`)
      }

      const invalidated = await isAccessTokenInvalidated(
        ticketData.userId,
        ticketData.issuedAt,
        ticketData.sessionId
      )
      if (invalidated) {
        return reply.redirect(`/profile?error=invalid_session`)
      }

      const bindUser = await db.findUserById(ticketData.userId)
      if (!bindUser || bindUser.status !== 'active') {
        return reply.redirect(`/profile?error=invalid_session`)
      }

      bindSession = {
        userId: bindUser.id,
        issuedAt: ticketData.issuedAt,
        sessionId: ticketData.sessionId
      }
    }

    const state = await generateOAuthState(validMode, getSafeRedirectUrl(redirect, '/'), bindSession)

    // 构建回调 URL
    let callbackUrl: string
    try {
      callbackUrl = buildOAuthCallbackUrl(request, provider)
    } catch (error) {
      request.log.error({ err: error, provider }, 'OAuth public callback URL is not configured')
      return reply.code(500).send({ error: 'OAuth callback URL is not configured', code: 'OAUTH_CALLBACK_URL_NOT_CONFIGURED' })
    }

    // 构建授权 URL
    const params = new URLSearchParams({
      client_id: config.client_id,
      redirect_uri: callbackUrl,
      scope: providerConfig.scope,
      state,
      response_type: 'code'
    })

    // Google 需要额外参数
    if (provider === 'google') {
      params.append('access_type', 'offline')
      params.append('prompt', 'consent')
    }

    const authUrl = `${providerConfig.authUrl}?${params.toString()}`

    return reply.redirect(authUrl)
  })

  /**
   * OAuth 回调处理
   * 
   * 安全增强：验证并消费一次性 state token，防止 CSRF 和重放攻击
   */
  fastify.get<{
    Params: { provider: OAuthProvider }
    Querystring: { code?: string; state?: string; error?: string }
  }>('/callback/:provider', async (request: FastifyRequest<{
    Params: { provider: OAuthProvider }
    Querystring: { code?: string; state?: string; error?: string }
  }>, reply: FastifyReply) => {
    const { provider } = request.params
    const { code, state, error } = request.query

    // 错误处理
    if (error) {
      await logSecurityEvent(SecurityEventType.LOGIN_FAILED, null, {
        ip: request.ip,
        action: 'oauth_callback',
        reason: `OAuth error: ${error}`
      })
      return reply.redirect(`/login?error=${encodeURIComponent(error)}`)
    }

    if (!state) {
      await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, null, {
        ip: request.ip,
        action: 'oauth_callback',
        reason: 'Missing state parameter'
      })
      return reply.redirect(`/login?error=invalid_state`)
    }

    // 验证并消费一次性 state token
    const stateData = await verifyAndConsumeOAuthState(state)
    if (!stateData) {
      await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, null, {
        ip: request.ip,
        action: 'oauth_callback',
        reason: 'Invalid or expired state token'
      })
      return reply.redirect(`/login?error=state_expired`)
    }

    // 安全检查：验证 redirect URL 防止开放重定向漏洞
    const redirectUrl = getSafeRedirectUrl(stateData.redirect, '/')
    
    // 根据 mode 确定错误跳转目标
    const errorRedirectBase = stateData.mode === 'bind' ? '/profile' : '/login'

    if (!code) {
      return reply.redirect(`${errorRedirectBase}?error=missing_code`)
    }

    try {
      const config = await db.getOAuthConfig(provider)
      if (!config || !config.enabled) {
        return reply.redirect(`${errorRedirectBase}?error=provider_disabled`)
      }

      const providerConfig = OAUTH_PROVIDERS[provider]
      const callbackUrl = buildOAuthCallbackUrl(request, provider)

      // 1. 获取 access_token
      const tokenRes = await fetch(providerConfig.tokenUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(OAUTH_PROVIDER_FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          client_id: config.client_id,
          client_secret: config.client_secret,
          code,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code'
        })
      })

      const tokenData = await readOAuthJsonResponse<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }>(
        tokenRes,
        `${provider} OAuth token response`
      )

      if (!tokenRes.ok || !tokenData.access_token) {
        // 记录详细错误信息便于调试
        fastify.log.error({ statusCode: tokenRes.status, tokenData: sanitizeObject(tokenData), provider }, 'OAuth token exchange failed')
        return reply.redirect(`${errorRedirectBase}?error=token_error`)
      }

      // 2. 获取用户信息
      const userRes = await fetch(providerConfig.userUrl, {
        signal: AbortSignal.timeout(OAUTH_PROVIDER_FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      })

      const userData = await readOAuthJsonResponse<Record<string, unknown>>(
        userRes,
        `${provider} OAuth userinfo response`
      )

      if (!userRes.ok) {
        throw new Error(`OAuth userinfo failed with status ${userRes.status}: ${sanitizeTokensInString(JSON.stringify(userData).slice(0, 2048))}`)
      }

      // 解析用户信息（不同提供商格式不同）
      const oauthUser = parseOAuthUser(provider, userData)
      if (!oauthUser.id) {
        throw new Error('OAuth userinfo response did not include a provider user id')
      }

      // 3. 根据 mode 处理
      if (stateData.mode === 'bind') {
        // 绑定模式：从 state 中获取用户 ID
        const userId = stateData.userId
        if (!userId || !stateData.userIssuedAt) {
          return reply.redirect(`/profile?error=not_logged_in`)
        }

        const bindSessionInvalidated = await isAccessTokenInvalidated(
          userId,
          stateData.userIssuedAt,
          stateData.userSessionId
        )
        if (bindSessionInvalidated) {
          return reply.redirect(`/profile?error=invalid_session`)
        }

        const bindUser = await db.findUserById(userId)
        if (!bindUser || bindUser.status !== 'active') {
          return reply.redirect(`/profile?error=invalid_session`)
        }

        // 检查是否已有其他用户绑定了这个 OAuth 账号
        const existingBinding = await db.findOAuthBinding(provider, oauthUser.id)
        if (existingBinding && existingBinding.user_id !== userId) {
          return reply.redirect(`/profile?error=already_bound_other`)
        }

        // 检查当前用户是否已绑定该提供商
        const hasBound = await db.hasOAuthBinding(userId, provider)
        if (hasBound) {
          // 更新 token
          await db.updateOAuthBindingToken(userId, provider, tokenData.access_token, tokenData.refresh_token || null)
        } else {
          // 创建绑定
          await db.createOAuthBinding(userId, {
            provider,
            providerUserId: oauthUser.id,
            providerUsername: oauthUser.username,
            providerEmail: oauthUser.email,
            providerAvatar: oauthUser.avatar,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || null
          })
        }

        return reply.redirect(`/profile?success=bound_${provider}`)
      } else {
        // 登录模式：查找绑定的用户
        const binding = await db.findOAuthBinding(provider, oauthUser.id)

        if (!binding) {
          // 没有绑定，不允许注册，提示先绑定
          return reply.redirect(`/login?error=not_bound&provider=${provider}`)
        }

        // 查找用户
        const user = await db.findUserById(binding.user_id)
        if (!user) {
          return reply.redirect(`/login?error=user_not_found`)
        }

        if (user.status !== 'active') {
          return reply.redirect(`/login?error=account_banned`)
        }

        // 更新 OAuth token
        await db.updateOAuthBindingToken(user.id, provider, tokenData.access_token, tokenData.refresh_token || null)

        // 在创建新会话之前检测异地登录（修复时序问题）
        const userAgent = request.headers['user-agent'] || 'OAuth Login'
        let loginAlertInfo: { isNewIp: boolean; isNewDevice: boolean } | null = null
        if (user.email) {
          try {
            loginAlertInfo = await detectNewLoginLocation(user.id, request.ip, userAgent)
          } catch (err) {
            console.error('[OAuth Login Alert] Detection failed:', err)
          }
        }

        // 记录登录成功
        await logSecurityEvent(SecurityEventType.LOGIN_SUCCESS, user.id, {
          ip: request.ip,
          username: user.username,
          action: `oauth_${provider}`
        })

        // 异地登录提醒（后台执行）
        if (user.email && loginAlertInfo && (loginAlertInfo.isNewIp || loginAlertInfo.isNewDevice)) {
          sendLoginAlertEmail(user.email, {
            username: user.username,
            ip: request.ip,
            userAgent: userAgent,
            loginTime: new Date(),
            isNewIp: loginAlertInfo.isNewIp,
            isNewDevice: loginAlertInfo.isNewDevice
          }).catch(err => {
            console.error('[OAuth Login Alert] Failed to send:', err)
          })
        }

        // 安全改进：登录码只传递用户标识，refreshToken 在 exchange-code 时生成
        const loginCode = generateOAuthLoginCode({
          userId: user.id,
          username: user.username,
          role: user.role
        })

        // 通过 URL 参数传递一次性登录码给前端
        const separator = redirectUrl.includes('?') ? '&' : '?'
        return reply.redirect(`${redirectUrl}${separator}oauth_code=${encodeURIComponent(loginCode)}`)
      }
    } catch (err) {
      fastify.log.error({ err, provider }, 'OAuth callback error')
      return reply.redirect(`${errorRedirectBase}?error=oauth_error`)
    }
  })

  // ==================== 用户绑定管理 API ====================

  /**
   * 获取当前用户的 OAuth 绑定
   */
  fastify.get('/bindings', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const bindings = await db.getUserOAuthBindings(request.user.id)

    return {
      bindings: bindings.map(b => ({
        provider: b.provider,
        username: b.provider_username,
        email: b.provider_email,
        avatar: b.provider_avatar,
        boundAt: b.created_at
      }))
    }
  })

  /**
   * 解除 OAuth 绑定
   */
  fastify.delete<{ Params: { provider: OAuthProvider } }>('/bindings/:provider', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { provider: OAuthProvider } }>, reply: FastifyReply) => {
    const { provider } = request.params

    // 检查是否有绑定
    const hasBound = await db.hasOAuthBinding(request.user.id, provider)
    if (!hasBound) {
      return reply.code(400).send({ error: 'Account not bound', code: 'OAUTH_NOT_BOUND' })
    }

    await db.deleteOAuthBinding(request.user.id, provider)
    await revokeAllUserRefreshTokens(request.user.id)
    await invalidateUserAccessTokens(request.user.id)
    closeUserSessions(request.user.id, `${provider} OAuth unbound`)

    await createLog(
      request.user.id,
      'security',
      'oauth.unbind',
      `Unbound ${provider} OAuth account`,
      'success'
    )

    return { message: `已解除 ${provider} 绑定` }
  })

  // ==================== OAuth 登录码交换 ====================

  /**
   * 交换 OAuth 登录码获取 Access Token
   * 安全改进：使用一次性登录码替代直接在 URL 中传递 Token
   */
  fastify.post<{ Body: { code: string } }>('/exchange-code', {
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 10 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) => {
    const { code } = request.body

    // 验证并消费一次性登录码
    const loginData = verifyAndConsumeOAuthLoginCode(code)
    if (!loginData) {
      await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, null, {
        ip: request.ip,
        action: 'oauth_exchange_code',
        reason: 'Invalid or expired login code'
      })
      return reply.code(401).send({ error: 'Invalid or expired login code', code: 'INVALID_LOGIN_CODE' })
    }

    // 安全检查：验证用户状态（防止用户在 OAuth 回调后、登录码交换前被封禁）
    const user = await db.findUserById(loginData.userId)
    if (!user) {
      await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, loginData.userId, {
        ip: request.ip,
        action: 'oauth_exchange_code',
        reason: 'User not found during code exchange'
      })
      return reply.code(401).send({ error: 'User not found', code: 'USER_NOT_FOUND' })
    }

    if (user.status === 'banned') {
      await logSecurityEvent(SecurityEventType.LOGIN_FAILED, loginData.userId, {
        ip: request.ip,
        username: loginData.username,
        action: 'oauth_exchange_code',
        reason: 'Account banned during code exchange'
      })
      // 如果有封禁原因，返回该原因
      if (user.ban_reason) {
        return reply.code(403).send({ error: user.ban_reason, code: 'ACCOUNT_BANNED' })
      }
      return reply.code(403).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
    }

    // 安全改进：在 exchange-code 时重新生成 refreshToken，而不是从登录码传递
    const userAgent = request.headers['user-agent'] || 'OAuth Login'
    const refreshToken = await generateRefreshToken(user.id, user.username, user.role, request.ip, userAgent)

    // 设置 Refresh Token Cookie
    reply.setCookie('refreshToken', refreshToken, getRefreshTokenCookieOptions())

    // 提取会话标识
    const sessionId = getRefreshTokenSessionId(refreshToken)

    // 生成 Access Token（简化版：7天有效期）
    const accessToken = fastify.jwt.sign({
      id: loginData.userId,
      username: loginData.username,
      role: loginData.role as 'admin' | 'user',
      sid: sessionId
    }, { expiresIn: '7d' })

    return {
      token: accessToken,
      user: {
        id: loginData.userId,
        username: loginData.username,
        role: loginData.role
      }
    }
  })
}

/**
 * 解析不同提供商的用户信息
 */
function parseOAuthUser(
  provider: OAuthProvider,
  data: Record<string, unknown>
): {
  id: string
  username: string | null
  email: string | null
  avatar: string | null
} {
  if (provider === 'github') {
    return {
      id: String(data.id || ''),
      username: (data.login as string) || null,
      email: (data.email as string) || null,
      avatar: (data.avatar_url as string) || null
    }
  } else if (provider === 'google') {
    return {
      id: String(data.id || ''),
      username: (data.name as string) || (typeof data.email === 'string' ? data.email.split('@')[0] : null),
      email: (data.email as string) || null,
      avatar: (data.picture as string) || null
    }
  }

  return { id: String(data.id || ''), username: null, email: null, avatar: null }
}
