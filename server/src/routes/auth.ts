/**
 * 认证路由
 */

// @ts-ignore - bcryptjs has its own types
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import {
  checkLoginLock,
  recordLoginFailure,
  clearLoginFailure,
  validatePassword,
  logSecurityEvent,
  SecurityEventType,
  generateRefreshToken,
  getRefreshTokenSessionId,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  updateSessionActivity,
  invalidateSessionAccessToken,
  invalidateUserAccessTokens,
  generate2FASecret,
  generate2FAQRCode,
  verify2FAToken,
  generateRecoveryCodes,
  encryptSensitiveData,
  decryptSensitiveData,
  validateIdentifier,
  containsDangerousChars,
  detectNewLoginLocation
} from '../lib/security.js'
import type { LoginRequest, RegisterRequest } from '../types/api.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { turnstileVerifier } from '../lib/turnstile.js'
import { isSmtpEnabled, sendVerificationEmail, sendLoginAlertEmail, sendFreeSiteRegisterGiftEmail } from '../lib/mailer.js'
import { createVerificationCode, verifyCode } from '../db/email-verification.js'
import { validateEmailDomain } from '../lib/email-domain.js'
import {
    claimOperationVerificationRequirement
} from '../lib/operation-verification.js'
import {
    getRefreshTokenCookieOptions,
    getClearCookieOptions
} from '../lib/cookie-config.js'
import { sendNotification } from '../lib/notifier.js'
import { getGeoIpInfo } from '../lib/geoip.js'
import { createLoginRecord } from '../db/login-records.js'
import { getUserLoginRecords } from '../db/login-records.js'
import { closeSessionTerminalSessions, closeUserSessions } from '../lib/terminal-proxy.js'
import { revokeActionTicketsForSession } from '../lib/action-ticket.js'
import { getUserHostingFeatureStatus } from '../lib/hosting-access.js'

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/
const LOGIN_IDENTIFIER_MAX_LENGTH = 254

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_INTEGER_PATTERN.test(value)) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

interface LoginWith2FARequest extends LoginRequest {
  totpCode?: string
  recoveryCode?: string
  turnstileToken?: string
}

async function buildAuthUserPayload(user: {
  id: number
  username: string
  email: string | null
  role: 'admin' | 'user'
  avatar_style: string
  avatar_badge_id?: string | null
  has_created_host_before?: boolean
}) {
  const hostingFeatureStatus = await getUserHostingFeatureStatus(user.id)

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatarStyle: user.avatar_style,
    avatarBadgeId: user.avatar_badge_id ?? null,
    hasCreatedHostBefore: hostingFeatureStatus.hasCreatedHostBefore,
    canAccessHostingFeature: hostingFeatureStatus.canAccessHostingFeature
  }
}

export default async function authRoutes(fastify: FastifyInstance) {
  async function ensureRegistrationEnabled(reply: FastifyReply): Promise<boolean> {
    const registrationEnabled = await db.isRegistrationEnabled()
    if (!registrationEnabled) {
      reply.code(403).send(apiError(ErrorCode.REGISTRATION_DISABLED))
      return false
    }
    return true
  }

  // 检查用户是否启用了 2FA（登录前检查）
  fastify.post<{ Body: { username: string } }>('/check-2fa', {
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: LOGIN_IDENTIFIER_MAX_LENGTH }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { username: string } }>, _reply: FastifyReply) => {
    const { username } = request.body

    // 查询用户（支持用户名或邮箱）
    const user = await db.findUserByUsernameOrEmail(username)
    if (!user) {
      // 为了安全，不透露用户是否存在，统一返回不需要2FA
      return { requires2FA: false }
    }

    if (user.status === 'banned') {
      // 封禁账号也不暴露 2FA 配置，真正登录时会返回封禁错误。
      return { requires2FA: false }
    }

    // 检查是否启用了 2FA
    const twoFAEnabled = await db.is2FAEnabled(user.id)
    return { requires2FA: twoFAEnabled }
  })

  // 用户登录 (支持 2FA)
  fastify.post<{ Body: LoginWith2FARequest }>('/login', {
    preHandler: [turnstileVerifier],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: LOGIN_IDENTIFIER_MAX_LENGTH },
          password: { type: 'string', minLength: 6, maxLength: 128 },
          totpCode: { type: 'string', minLength: 6, maxLength: 6 },
          recoveryCode: { type: 'string', minLength: 8, maxLength: 20 },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: LoginWith2FARequest }>, reply: FastifyReply) => {
    const { username, password, totpCode, recoveryCode } = request.body
    const clientIp = request.ip

    // 调试日志（生产环境可通过 LOG_LEVEL=debug 启用）
    request.log.debug({ username, passwordLength: password?.length, has2FA: !!totpCode || !!recoveryCode }, '[login] 登录请求')

    // 查询用户（支持用户名或邮箱登录）
    // 注意：先查询用户，以便后续使用用户ID进行锁定检查（更准确）
    const user = await db.findUserByUsernameOrEmail(username)
    
    // 检查是否被锁定（使用用户ID或identifier作为key）
    // 如果用户存在，使用用户ID；如果不存在，使用identifier（用户名或邮箱）
    // 这样确保无论使用用户名还是邮箱登录，都能正确锁定同一个账户
    const lockStatus = checkLoginLock(clientIp, user ? `user:${user.id}` : username.toLowerCase().trim())
    if (lockStatus.locked) {
      await logSecurityEvent(SecurityEventType.RATE_LIMIT_EXCEEDED, user?.id || null, {
        ip: clientIp,
        username: user?.username || username,
        action: 'login',
        reason: 'Account locked due to too many failed attempts'
      })
      return reply.code(429).send(apiError(ErrorCode.TOO_MANY_ATTEMPTS, `${Math.ceil((lockStatus.retryAfter || 0) / 60)} minutes`))
    }

    if (!user) {
      request.log.debug({ username }, '[login] 用户不存在')
      recordLoginFailure(clientIp, username)
      await logSecurityEvent(SecurityEventType.LOGIN_FAILED, null, {
        ip: clientIp,
        username,
        reason: 'User not found'
      })
      return reply.code(401).send(apiError(ErrorCode.INVALID_CREDENTIALS))
    }
    request.log.debug({ userId: user.id, username: user.username, status: user.status }, '[login] 找到用户')

    // 检查账户状态
    if (user.status === 'banned') {
      await logSecurityEvent(SecurityEventType.LOGIN_FAILED, user.id, {
        ip: clientIp,
        username,
        reason: 'Account banned'
      })
      // 如果有封禁原因，返回该原因
      if (user.ban_reason) {
        return reply.code(403).send({
          error: user.ban_reason,
          code: ErrorCode.ACCOUNT_BANNED
        })
      }
      return reply.code(403).send(apiError(ErrorCode.ACCOUNT_BANNED))
    }

    // 验证密码
    request.log.debug({
      passwordLength: password?.length,
      hashPrefix: user.password_hash?.substring(0, 10),
      hashLength: user.password_hash?.length
    }, '[login] 开始验证密码')

    const validPassword = await bcrypt.compare(password, user.password_hash)
    request.log.debug({ validPassword }, '[login] 密码验证结果')

    if (!validPassword) {
      // 使用用户ID进行锁定，确保无论使用用户名还是邮箱登录，都能正确锁定
      recordLoginFailure(clientIp, `user:${user.id}`)
      await logSecurityEvent(SecurityEventType.LOGIN_FAILED, user.id, {
        ip: clientIp,
        username: user.username,
        reason: 'Invalid password'
      })
      return reply.code(401).send(apiError(ErrorCode.INVALID_CREDENTIALS))
    }

    // 检查是否启用了 2FA
    const twoFAEnabled = await db.is2FAEnabled(user.id)
    if (twoFAEnabled) {
      // 用户启用了2FA，必须提供验证码或恢复码
      if (!totpCode && !recoveryCode) {
        recordLoginFailure(clientIp, `user:${user.id}`)
        await logSecurityEvent(SecurityEventType.LOGIN_FAILED, user.id, {
          ip: clientIp,
          username: user.username,
          reason: '2FA required but not provided'
        })
        return reply.code(401).send(apiError(ErrorCode.TWO_FA_REQUIRED))
      }

      let verified = false

      // 优先验证 TOTP 码
      if (totpCode) {
        const secret = await db.get2FASecret(user.id)
        if (secret) {
          const decryptedSecret = decryptSensitiveData(secret)
          if (decryptedSecret && verify2FAToken(totpCode, decryptedSecret)) {
            verified = true
          }
        }
      }

      // 如果 TOTP 验证失败，尝试恢复码
      if (!verified && recoveryCode) {
        const encryptedCodes = await db.get2FARecoveryCodes(user.id)
        if (encryptedCodes) {
          const decryptedCodesJson = decryptSensitiveData(encryptedCodes)
          if (decryptedCodesJson) {
            try {
              const codes: string[] = JSON.parse(decryptedCodesJson)
              const codeIndex = codes.indexOf(recoveryCode.toUpperCase())
              if (codeIndex !== -1) {
                // 恢复码有效，移除已使用的恢复码
                codes.splice(codeIndex, 1)
                const newEncryptedCodes = encryptSensitiveData(JSON.stringify(codes))
                await db.save2FARecoveryCodes(user.id, newEncryptedCodes)
                verified = true

                await logSecurityEvent(SecurityEventType.LOGIN_SUCCESS, user.id, {
                  ip: clientIp,
                  username,
                  reason: `Used recovery code, ${codes.length} remaining`
                })
              }
            } catch {
              // JSON 解析失败，忽略
            }
          }
        }
      }

      if (!verified) {
        // 使用用户ID进行锁定，确保无论使用用户名还是邮箱登录，都能正确锁定
        recordLoginFailure(clientIp, `user:${user.id}`)
        await logSecurityEvent(SecurityEventType.LOGIN_FAILED, user.id, {
          ip: clientIp,
          username: user.username,
          reason: 'Invalid 2FA code or recovery code'
        })
        return reply.code(401).send(apiError(ErrorCode.INVALID_2FA_CODE))
      }
    }
    // 如果用户没有启用2FA，即使提供了2FA代码也忽略（不验证）

    // 登录成功，清除失败记录（使用用户ID）
    clearLoginFailure(clientIp, `user:${user.id}`)

    // 在创建新会话之前检测异地登录（修复时序问题）
    const userAgent = request.headers['user-agent'] || 'unknown'
    let loginAlertInfo: { isNewIp: boolean; isNewDevice: boolean } | null = null
    if (user.email) {
      try {
        loginAlertInfo = await detectNewLoginLocation(user.id, clientIp, userAgent)
      } catch (err) {
        console.error('[Login Alert] Detection failed:', err)
      }
    }

    // 生成 Refresh Token (长期，存储到 Redis)
    const refreshToken = await generateRefreshToken(user.id, user.username, user.role, clientIp, userAgent)

    // 提取会话标识（Refresh Token 的前20个字符）
    const sessionId = getRefreshTokenSessionId(refreshToken)

    // 生成 Access Token (简化版：延长有效期到 7 天)
    const accessToken = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      role: user.role,
      sid: sessionId  // 会话标识，用于会话级别的 token 失效
    }, { expiresIn: '7d' })

    // 设置 Refresh Token Cookie (HttpOnly)
    // SEC005: 使用统一的 Cookie 配置
    reply.setCookie('refreshToken', refreshToken, getRefreshTokenCookieOptions())

    // 记录登录成功
    await logSecurityEvent(SecurityEventType.LOGIN_SUCCESS, user.id, {
      ip: clientIp,
      username
    })

    // 异步记录登录信息（后台执行，不阻塞登录流程）
    getGeoIpInfo(clientIp).then(geoInfo => {
      createLoginRecord({
        userId: user.id,
        ip: clientIp,
        country: geoInfo.country,
        region: geoInfo.region,
        city: geoInfo.city,
        isp: geoInfo.isp,
        timezone: geoInfo.timezone,
        userAgent: userAgent
      }).catch(err => {
        console.error('[Login Record] Failed to create login record:', err)
      })
    }).catch(err => {
      // GeoIP 查询失败时仍然记录登录（没有地理信息）
      console.error('[Login Record] GeoIP lookup failed:', err)
      createLoginRecord({
        userId: user.id,
        ip: clientIp,
        userAgent: userAgent
      }).catch(err2 => {
        console.error('[Login Record] Failed to create login record:', err2)
      })
    })

    // 异地登录提醒（后台执行，不阻塞登录流程）
    // 修复：使用之前检测的结果，避免时序问题
    if (user.email && loginAlertInfo && (loginAlertInfo.isNewIp || loginAlertInfo.isNewDevice)) {
      sendLoginAlertEmail(user.email, {
        username: user.username,
        ip: clientIp,
        userAgent: userAgent,
        loginTime: new Date(),
        isNewIp: loginAlertInfo.isNewIp,
        isNewDevice: loginAlertInfo.isNewDevice
      }).catch(err => {
        console.error('[Login Alert] Failed to send login alert email:', err)
      })

      // 发送推送通知
      sendNotification(user.id, 'login_new_device', {
        instanceName: '',
        deviceInfo: userAgent,
        ipAddress: clientIp,
        loginTime: new Date().toISOString()
      })
    }

    return {
      token: accessToken,
      user: await buildAuthUserPayload(user)
    }
  })

  // 发送邮件验证码
  fastify.post<{ Body: { email: string; turnstileToken?: string } }>('/send-verification-code', {
    preHandler: [turnstileVerifier],
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { email: string; turnstileToken?: string } }>, reply: FastifyReply) => {
    const { email } = request.body

    if (!await ensureRegistrationEnabled(reply)) {
      return
    }

    // Check if email verification is enabled
    const smtpEnabled = await isSmtpEnabled()
    if (!smtpEnabled) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_VERIFICATION_DISABLED))
    }

    // Validate email format
    if (!email || !email.includes('@')) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL))
    }

    // Check for dangerous characters
    const emailWithoutAllowed = email.replace(/@/g, '').replace(/\./g, '')
    if (containsDangerousChars(emailWithoutAllowed)) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_CONTAINS_ILLEGAL))
    }

    // Check if email is already registered
    const existingUser = await db.findUserByEmail(email)
    if (existingUser) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_ALREADY_REGISTERED))
    }

    // Check email domain whitelist
    const domainValidation = await validateEmailDomain(email)
    if (!domainValidation.valid) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_DOMAIN_NOT_ALLOWED, domainValidation.domain))
    }

    // Create verification code
    const result = await createVerificationCode(email, 'register')
    if (!result) {
      return reply.code(429).send(apiError(ErrorCode.TOO_MANY_VERIFICATION_REQUESTS))
    }

    // Send email
    const sendResult = await sendVerificationEmail(email, result.code, 10)
    if (!sendResult.success) {
      return reply.code(500).send(apiError(ErrorCode.EMAIL_SEND_FAILED))
    }

    return { message: 'Verification code sent', expiresAt: result.expiresAt.toISOString() }
  })

  // 用户注册 (支持邀请码可选，支持邮件验证码)
  fastify.post<{ Body: RegisterRequest & { turnstileToken?: string; emailCode?: string } }>('/register', {
    preHandler: [turnstileVerifier],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password', 'email'],
        properties: {
          username: {
            type: 'string',
            minLength: 3,
            maxLength: 32,
            pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$'  // 必须以字母开头
          },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          email: { type: 'string', format: 'email' },
          inviteCode: { type: 'string' },
          turnstileToken: { type: 'string' },
          emailCode: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: RegisterRequest & { turnstileToken?: string; emailCode?: string } }>, reply: FastifyReply) => {
    const { username, password, email, inviteCode, emailCode } = request.body
    const clientIp = request.ip

    if (!await ensureRegistrationEnabled(reply)) {
      return
    }

    // Validate username (prevent dangerous character injection)
    const usernameValidation = validateIdentifier(username, 'Username', 3, 32)
    if (!usernameValidation.valid) {
      return reply.code(400).send({ error: usernameValidation.message })
    }

    // 检查用户名是否包含危险字符
    if (containsDangerousChars(username)) {
      return reply.code(400).send(apiError(ErrorCode.USERNAME_CONTAINS_ILLEGAL))
    }

    // 验证密码强度
    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) {
      return reply.code(400).send({ error: passwordCheck.message })
    }

    // 验证邮箱格式
    if (!email || !email.includes('@')) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL))
    }

    // 检查邮箱是否包含危险字符（除了 @ 和 .)
    const emailWithoutAllowed = email.replace(/@/g, '').replace(/\./g, '')
    if (containsDangerousChars(emailWithoutAllowed)) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_CONTAINS_ILLEGAL))
    }

    // Check email domain whitelist
    const domainValidation = await validateEmailDomain(email)
    if (!domainValidation.valid) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_DOMAIN_NOT_ALLOWED, domainValidation.domain))
    }

    // Check if email verification is required
    const smtpEnabled = await isSmtpEnabled()
    if (smtpEnabled) {
      if (!emailCode) {
        return reply.code(400).send(apiError(ErrorCode.EMAIL_CODE_REQUIRED))
      }
      const isValid = await verifyCode(email, emailCode, 'register')
      if (!isValid) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL_CODE))
      }
    }

    // 检查是否需要邀请码
    const { isInviteCodeRequired } = await import('../db/system-config.js')
    const requireInvite = await isInviteCodeRequired()

    let invite = null
    if (requireInvite) {
      // 需要邀请码时，验证邀请码
      if (!inviteCode) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_INVITE_CODE))
      }
      invite = await db.findInviteCode(inviteCode)
      if (!invite) {
        await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, null, {
          ip: clientIp,
          action: 'register',
          reason: 'Invalid invite code',
          username
        })
        return reply.code(400).send(apiError(ErrorCode.INVALID_INVITE_CODE))
      }

      // 检查邀请码是否过期
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return reply.code(400).send(apiError(ErrorCode.INVITE_CODE_EXPIRED))
      }
    }

    // 检查用户名是否存在
    const existingUser = await db.findUserByUsername(username)
    if (existingUser) {
      return reply.code(400).send(apiError(ErrorCode.USER_EXISTS))
    }

    // 检查邮箱是否已被注册
    const existingUserByEmail = await db.findUserByEmail(email)
    if (existingUserByEmail) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_ALREADY_REGISTERED))
    }

    // 哈希密码 (使用更高的 cost factor)
    const passwordHash = await bcrypt.hash(password, 12)

    // 规范化邮箱（转为小写），确保与登录查询时的处理一致
    const normalizedEmail = email.toLowerCase().trim()

    let userId: number
    let registerGift: db.RegisterGiftResult | null
    try {
      const created = await db.createRegisteredUser({
        username,
        email: normalizedEmail,
        passwordHash,
        inviteCode: invite && inviteCode ? inviteCode : undefined
      })
      userId = created.userId
      registerGift = created.registerGift
    } catch (createErr) {
      if (createErr instanceof Error) {
        if (createErr.message === 'INVITE_CODE_UNAVAILABLE') {
          return reply.code(400).send(apiError(ErrorCode.INVALID_INVITE_CODE))
        }
        if (createErr.message === 'USER_EXISTS') {
          return reply.code(400).send(apiError(ErrorCode.USER_EXISTS))
        }
        if (createErr.message === 'EMAIL_ALREADY_REGISTERED') {
          return reply.code(400).send(apiError(ErrorCode.EMAIL_ALREADY_REGISTERED))
        }
      }
      throw createErr
    }

    // 记录注册成功
    await logSecurityEvent(SecurityEventType.REGISTER_SUCCESS, userId, {
      ip: clientIp,
      username
    })

    // 获取新创建的用户信息
    const newUser = await db.findUserById(userId)
    if (!newUser) {
      return reply.code(500).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    if (registerGift) {
      const giftTime = new Date()

      if (newUser.email) {
        sendFreeSiteRegisterGiftEmail(newUser.email, {
          username: newUser.username,
          balanceAmount: registerGift.balanceAmount,
          pointsAmount: registerGift.pointsAmount,
          newBalance: registerGift.newBalance,
          newPoints: registerGift.newPoints,
          time: giftTime
        }).then(result => {
          if (!result.success) {
            console.warn('[Register] Free site register gift email was not sent:', result.error)
          }
        }).catch(err => {
          console.error('[Register] Failed to send free site register gift email:', err)
        })
      }
    }

    // 生成 Refresh Token (长期，存储到 Redis)
    const userAgent = request.headers['user-agent'] || 'unknown'
    const refreshToken = await generateRefreshToken(newUser.id, newUser.username, newUser.role, clientIp, userAgent)

    // 提取会话标识（Refresh Token 的前20个字符）
    const sessionId = getRefreshTokenSessionId(refreshToken)

    // 生成 Access Token (简化版：延长有效期到 7 天)
    const accessToken = fastify.jwt.sign({
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      sid: sessionId  // 会话标识，用于会话级别的 token 失效
    }, { expiresIn: '7d' })

    // 设置 Refresh Token Cookie (HttpOnly)
    // SEC005: 使用统一的 Cookie 配置
    reply.setCookie('refreshToken', refreshToken, getRefreshTokenCookieOptions())

    // 异步记录注册/登录信息（后台执行，不阻塞注册流程）
    getGeoIpInfo(clientIp).then(geoInfo => {
      createLoginRecord({
        userId: newUser.id,
        ip: clientIp,
        country: geoInfo.country,
        region: geoInfo.region,
        city: geoInfo.city,
        isp: geoInfo.isp,
        timezone: geoInfo.timezone,
        userAgent: userAgent
      }).catch(err => {
        console.error('[Register] Failed to create login record:', err)
      })
    }).catch(err => {
      // GeoIP 查询失败时仍然记录登录（没有地理信息）
      console.error('[Register] GeoIP lookup failed:', err)
      createLoginRecord({
        userId: newUser.id,
        ip: clientIp,
        userAgent: userAgent
      }).catch(err2 => {
        console.error('[Register] Failed to create login record:', err2)
      })
    })

    reply.code(201).send({
      token: accessToken,
      user: await buildAuthUserPayload(newUser)
    })
  })

  // 获取当前用户信息
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await db.findUserById(request.user.id)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const quota = await db.getUserQuota(user.id)

    return {
      user: {
        ...(await buildAuthUserPayload(user)),
        quota: quota ? {
          // 新配额系统
          hostLimit: quota.host_limit,
          hostUsed: quota.host_used,
          friendLimit: quota.friend_limit,
          friendUsed: quota.friend_used,
          packageLimit: quota.package_limit,
          packageUsed: quota.package_used
        } : null
      }
    }
  })

  // 用户登出
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies.refreshToken
    const sessionIdsToInvalidate = new Set<string>()
    let userId: number | null = null
    let username: string | undefined

    try {
      await request.jwtVerify()
      const jwtUser = request.user as { id?: number; username?: string; sid?: string }
      if (jwtUser?.id) {
        userId = jwtUser.id
        username = jwtUser.username
      }
      if (jwtUser?.sid) {
        sessionIdsToInvalidate.add(jwtUser.sid)
      }
    } catch {
      // Logout must still clear the HttpOnly refresh cookie when the access token is expired or invalid.
    }

    if (refreshToken) {
      sessionIdsToInvalidate.add(getRefreshTokenSessionId(refreshToken))
      const tokenData = await verifyRefreshToken(refreshToken)
      if (tokenData) {
        userId = tokenData.userId
        username = tokenData.username
      }
    }

    // 撤销 Refresh Token (从 Redis 删除)
    if (refreshToken) {
      await revokeRefreshToken(refreshToken)
    }

    if (userId) {
      for (const sessionId of sessionIdsToInvalidate) {
        await invalidateSessionAccessToken(userId, sessionId)
        revokeActionTicketsForSession(sessionId)
        closeSessionTerminalSessions(sessionId, 'Session logged out')
      }
    }

    // 清除 Cookie - SEC005: 使用统一配置
    reply.clearCookie('refreshToken', getClearCookieOptions())

    if (userId) {
      await logSecurityEvent(SecurityEventType.LOGOUT, userId, {
        username
      })
    }
    return { message: 'Logged out' }
  })

  // 刷新 Access Token
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const refreshToken = request.cookies?.refreshToken

      if (!refreshToken) {
        // 记录日志以便调试
        fastify.log.debug('Refresh token missing in cookies')
        return reply.code(401).send(apiError(ErrorCode.REFRESH_TOKEN_MISSING))
      }

      // 验证 Refresh Token (从数据库读取)
      // AUTH002: 传入设备信息用于绑定校验
      // 添加错误处理和重试机制，防止数据库连接问题导致频繁登出
      let tokenData: { userId: number; username: string; role: string; expiresAt: number } | null = null
      const clientIp = request.ip
      const userAgent = request.headers['user-agent'] || undefined
      try {
        tokenData = await verifyRefreshToken(refreshToken, clientIp, userAgent)
      } catch (error) {
        // 数据库连接错误或其他错误，记录日志并尝试重试一次
        fastify.log.error({ err: error }, 'Refresh token verification error')
        try {
          // 等待一小段时间后重试
          await new Promise(resolve => setTimeout(resolve, 100))
          tokenData = await verifyRefreshToken(refreshToken, clientIp, userAgent)
        } catch (retryError) {
          fastify.log.error({ err: retryError }, 'Refresh token verification retry failed')
        }
      }

      if (!tokenData) {
        reply.clearCookie('refreshToken', getClearCookieOptions())
        return reply.code(401).send(apiError(ErrorCode.REFRESH_TOKEN_INVALID))
      }

      // 检查用户状态
      const user = await db.findUserById(tokenData.userId)
      if (!user || user.status === 'banned') {
        await revokeRefreshToken(refreshToken)
        reply.clearCookie('refreshToken', getClearCookieOptions())
        // 如果有封禁原因，返回该原因
        if (user?.ban_reason) {
          return reply.code(401).send({
            error: user.ban_reason,
            code: ErrorCode.ACCOUNT_BANNED
          })
        }
        return reply.code(401).send(apiError(ErrorCode.ACCOUNT_BANNED))
      }

      // 提取会话标识
      const sessionId = getRefreshTokenSessionId(refreshToken)

      // 更新会话活跃时间并延长过期时间
      const sessionUpdate = await updateSessionActivity(refreshToken)

      // 生成新的 Access Token，包含会话标识（简化版：7天有效期）
      const newAccessToken = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        role: user.role,
        sid: sessionId
      }, { expiresIn: '7d' })

      // 如果会话成功延期，同步更新 Cookie 有效期
      // SEC005: 使用统一的 Cookie 配置
      if (sessionUpdate) {
        reply.setCookie('refreshToken', refreshToken, getRefreshTokenCookieOptions())
      }

      return { token: newAccessToken }
    } catch (error) {
      // 捕获所有未预期的错误，避免返回 400
      fastify.log.error({ err: error }, 'Unexpected error in refresh endpoint')
      // 如果是已知的错误，已经返回了相应的状态码
      // 如果是未知错误，返回 500
      if (!reply.sent) {
        return reply.code(500).send({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        })
      }
      throw error
    }
  })

  // 生成邀请码 (管理员)
  fastify.post<{ Body: { expiresInDays?: number; count?: number } }>('/invite', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          expiresInDays: { type: 'integer', minimum: 1 },
          count: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { expiresInDays?: number; count?: number } }>, reply: FastifyReply) => {
    // 检查管理员权限
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.ADMIN_REQUIRED))
    }

    const { expiresInDays, count = 1 } = request.body || {}

    let expiresAt: string | null = null
    if (expiresInDays) {
      const date = new Date()
      date.setDate(date.getDate() + expiresInDays)
      expiresAt = date.toISOString()
    }

    // 批量生成邀请码
    const codes: string[] = []
    for (let i = 0; i < count; i++) {
      const code = nanoid(12)
      await db.createInviteCode(code, request.user.id, expiresAt)
      codes.push(code)
    }

    // 兼容单个和批量返回
    if (count === 1) {
      return {
        code: codes[0],
        expiresAt,
        url: `/register/${codes[0]}`
      }
    }

    return {
      codes,
      count: codes.length,
      expiresAt
    }
  })

  // 获取邀请码列表 (管理员)
  fastify.get<{
    Querystring: { page?: string; pageSize?: string; status?: string }
  }>('/invites', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string } }>, reply: FastifyReply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.ADMIN_REQUIRED))
    }

    const page = parsePositiveInteger(request.query.page, 1)
    const pageSize = Math.min(100, parsePositiveInteger(request.query.pageSize, 20))
    const status = request.query.status === 'used' || request.query.status === 'unused'
      ? request.query.status
      : undefined

    const { invites, total } = await db.getInviteCodesWithUsers(page, pageSize, status)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return {
      invites: invites.map(i => ({
        id: i.id,
        code: i.code,
        createdBy: i.created_by,
        createdByUsername: i.createdByUsername || null,
        createdByEmail: i.createdByEmail || null,
        createdByAvatarStyle: i.createdByAvatarStyle || null,
        usedBy: i.used_by,
        usedByUsername: i.usedByUsername || null,
        usedByEmail: i.usedByEmail || null,
        usedByAvatarStyle: i.usedByAvatarStyle || null,
        usedAt: i.used_at,
        expiresAt: i.expires_at,
        costSnapshot: i.cost_snapshot || null,
        createdAt: i.created_at
      })),
      total,
      page,
      pageSize,
      totalPages
    }
  })

  // 删除邀请码 (管理员)
  fastify.delete<{ Params: { id: string } }>('/invites/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.ADMIN_REQUIRED))
    }

    const inviteId = parsePositiveRouteId(request.params.id)
    if (inviteId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 检查邀请码是否存在
    const invite = await db.getInviteCodeById(inviteId)
    if (!invite) {
      return reply.code(404).send(apiError(ErrorCode.INVITE_CODE_NOT_FOUND))
    }

    // 允许删除已使用的邀请码
    await db.deleteInviteCode(inviteId)
    return { message: 'Invite code deleted' }
  })

  // ==================== 2FA 双因素认证 ====================

  // 获取 2FA 状态
  fastify.get('/2fa/status', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const status = await db.getUser2FAStatus(request.user.id)
    return { enabled: status.enabled }
  })

  // 初始化 2FA 设置 (生成密钥和二维码)
  fastify.post('/2fa/setup', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // 检查是否已启用
    const status = await db.getUser2FAStatus(request.user.id)
    if (status.enabled) {
      return reply.code(400).send(apiError(ErrorCode.TWO_FA_ALREADY_ENABLED))
    }

    // 生成新密钥
    const secret = generate2FASecret()

    // 加密后保存密钥
    const encryptedSecret = encryptSensitiveData(secret)
    await db.save2FASecret(request.user.id, encryptedSecret)

    // 生成二维码
    const qrCode = await generate2FAQRCode(request.user.username, secret)

    // 生成备用恢复码并加密保存（临时保存，启用时才生效）
    const recoveryCodes = generateRecoveryCodes()
    const encryptedCodes = encryptSensitiveData(JSON.stringify(recoveryCodes))
    await db.save2FARecoveryCodes(request.user.id, encryptedCodes)

    await createLog(request.user.id, 'security', '2fa.setup', 'Started 2FA setup', 'success')

    return {
      secret,  // 返回明文密钥供手动输入
      qrCode,  // Base64 二维码图片
      recoveryCodes  // 备用恢复码（用户需要保存）
    }
  })

  // 验证并启用 2FA
  fastify.post<{ Body: { code: string } }>('/2fa/enable', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) => {
    const { code } = request.body

    // 获取已保存的密钥
    const encryptedSecret = await db.get2FASecret(request.user.id)
    if (!encryptedSecret) {
      return reply.code(400).send(apiError(ErrorCode.TWO_FA_NOT_ENABLED))
    }

    // 解密并验证
    const secret = decryptSensitiveData(encryptedSecret)
    if (!secret || !verify2FAToken(code, secret)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_2FA_CODE))
    }

    // 启用 2FA
    await db.enable2FA(request.user.id)

    await revokeAllUserRefreshTokens(request.user.id)
    await invalidateUserAccessTokens(request.user.id)
    closeUserSessions(request.user.id, '2FA enabled')

    await createLog(request.user.id, 'security', '2fa.enable', 'Enabled two-factor authentication', 'success')

    // 发送通知
    await sendNotification(request.user.id, '2fa_enabled', {
      instanceName: ''
    })

    return { message: '2FA enabled' }
  })

  // 禁用 2FA
  fastify.post<{ Body: { password: string; code: string } }>('/2fa/disable', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['password', 'code'],
        properties: {
          password: { type: 'string' },
          code: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { password: string; code: string } }>, reply: FastifyReply) => {
    const { password, code } = request.body

    // 获取用户信息验证密码
    const user = await db.findUserById(request.user.id)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password_hash)
    if (!validPassword) {
      return reply.code(401).send(apiError(ErrorCode.INVALID_CREDENTIALS))
    }

    // 验证 2FA 码
    const encryptedSecret = await db.get2FASecret(request.user.id)
    if (encryptedSecret) {
      const secret = decryptSensitiveData(encryptedSecret)
      if (!secret || !verify2FAToken(code, secret)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_2FA_CODE))
      }
    }

    // 敏感操作二次验证：在密码和 TOTP 通过后原子领取，避免错误输入消耗验证码。
    const verification = await claimOperationVerificationRequirement(request.user.id, 'disable_2fa')
    if (!verification.verified) {
      return reply.code(403).send({
        error: 'Sensitive operation requires verification',
        code: 'VERIFICATION_REQUIRED',
        operationType: 'disable_2fa'
      })
    }

    // 禁用 2FA（清除所有 2FA 数据包括恢复码）
    await db.disable2FAComplete(request.user.id)

    await revokeAllUserRefreshTokens(request.user.id)
    await invalidateUserAccessTokens(request.user.id)
    closeUserSessions(request.user.id, '2FA disabled')

    await createLog(request.user.id, 'security', '2fa.disable', 'Disabled two-factor authentication', 'success')

    // 发送通知
    await sendNotification(request.user.id, '2fa_disabled', {
      instanceName: ''
    })

    return { message: '2FA disabled' }
  })

  // 获取剩余恢复码数量
  fastify.get('/2fa/recovery-codes', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const status = await db.getUser2FAStatus(request.user.id)
    if (!status.enabled) {
      return reply.code(400).send(apiError(ErrorCode.TWO_FA_NOT_ENABLED))
    }

    const encryptedCodes = await db.get2FARecoveryCodes(request.user.id)
    if (!encryptedCodes) {
      return { total: 8, remaining: 0, used: 8 }
    }

    const decryptedCodesJson = decryptSensitiveData(encryptedCodes)
    if (!decryptedCodesJson) {
      return { total: 8, remaining: 0, used: 8 }
    }

    try {
      const codes: string[] = JSON.parse(decryptedCodesJson)
      return { total: 8, remaining: codes.length, used: 8 - codes.length }
    } catch {
      return { total: 8, remaining: 0, used: 8 }
    }
  })

  // 重新生成恢复码
  fastify.post<{ Body: { password: string; code: string } }>('/2fa/regenerate-recovery-codes', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['password', 'code'],
        properties: {
          password: { type: 'string' },
          code: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { password: string; code: string } }>, reply: FastifyReply) => {
    const { password, code } = request.body

    // 检查 2FA 是否启用
    const status = await db.getUser2FAStatus(request.user.id)
    if (!status.enabled) {
      return reply.code(400).send(apiError(ErrorCode.TWO_FA_NOT_ENABLED))
    }

    // 获取用户信息验证密码
    const user = await db.findUserById(request.user.id)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password_hash)
    if (!validPassword) {
      return reply.code(401).send(apiError(ErrorCode.INVALID_CREDENTIALS))
    }

    // 验证 2FA 码
    const encryptedSecret = await db.get2FASecret(request.user.id)
    if (encryptedSecret) {
      const secret = decryptSensitiveData(encryptedSecret)
      if (!secret || !verify2FAToken(code, secret)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_2FA_CODE))
      }
    }

    // 生成新的恢复码
    const recoveryCodes = generateRecoveryCodes()
    const encryptedCodes = encryptSensitiveData(JSON.stringify(recoveryCodes))
    await db.save2FARecoveryCodes(request.user.id, encryptedCodes)

    await createLog(request.user.id, 'security', '2fa.recovery_reset', 'Regenerated 2FA recovery codes', 'success')

    return { recoveryCodes }
  })

  // 发送找回密码验证码
  fastify.post<{ Body: { email: string; turnstileToken?: string } }>('/forgot-password/send-code', {
    preHandler: [turnstileVerifier],
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { email: string; turnstileToken?: string } }>, reply: FastifyReply) => {
    const { email } = request.body

    // 检查 SMTP 是否启用
    const smtpEnabled = await isSmtpEnabled()
    if (!smtpEnabled) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_VERIFICATION_DISABLED))
    }

    // 验证邮箱格式
    if (!email || !email.includes('@')) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL))
    }

    // 检查邮箱是否包含危险字符
    const emailWithoutAllowed = email.replace(/@/g, '').replace(/\./g, '')
    if (containsDangerousChars(emailWithoutAllowed)) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_CONTAINS_ILLEGAL))
    }

    // 检查邮箱是否已注册（找回密码需要邮箱已注册）
    const user = await db.findUserByEmail(email)
    if (!user) {
      // 为了安全，不透露邮箱是否已注册，统一返回成功
      // 但实际不发送邮件
      return { message: 'If the email is registered, a verification code will be sent', expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
    }
    if (user.status === 'banned') {
      if (user.ban_reason) {
        return reply.code(403).send({
          error: user.ban_reason,
          code: ErrorCode.ACCOUNT_BANNED
        })
      }
      return reply.code(403).send(apiError(ErrorCode.ACCOUNT_BANNED))
    }

    // 创建验证码
    const result = await createVerificationCode(email, 'password_reset')
    if (!result) {
      return reply.code(429).send(apiError(ErrorCode.TOO_MANY_VERIFICATION_REQUESTS))
    }

    // 发送邮件（使用 reset_password 用途）
    const sendResult = await sendVerificationEmail(email, result.code, 10, 'reset_password')
    if (!sendResult.success) {
      return reply.code(500).send(apiError(ErrorCode.EMAIL_SEND_FAILED))
    }

    return { message: 'Verification code sent', expiresAt: result.expiresAt.toISOString() }
  })

  // 重置密码
  fastify.post<{ Body: { email: string; code: string; password: string; turnstileToken?: string } }>('/forgot-password/reset', {
    preHandler: [turnstileVerifier],
    schema: {
      body: {
        type: 'object',
        required: ['email', 'code', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { email: string; code: string; password: string; turnstileToken?: string } }>, reply: FastifyReply) => {
    const { email, code, password } = request.body

    // 检查 SMTP 是否启用
    const smtpEnabled = await isSmtpEnabled()
    if (!smtpEnabled) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_VERIFICATION_DISABLED))
    }

    // 验证邮箱格式
    if (!email || !email.includes('@')) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL))
    }

    // 检查邮箱是否包含危险字符
    const emailWithoutAllowed = email.replace(/@/g, '').replace(/\./g, '')
    if (containsDangerousChars(emailWithoutAllowed)) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_CONTAINS_ILLEGAL))
    }

    // 验证新密码强度，先校验再消费邮箱验证码
    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) {
      return reply.code(400).send({ error: passwordCheck.message })
    }

    // 查找用户并先检查状态，避免封禁账号消耗验证码
    const user = await db.findUserByEmail(email)
    if (!user) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL_CODE))
    }

    if (user.status === 'banned') {
      // 如果有封禁原因，返回该原因
      if (user.ban_reason) {
        return reply.code(403).send({
          error: user.ban_reason,
          code: ErrorCode.ACCOUNT_BANNED
        })
      }
      return reply.code(403).send(apiError(ErrorCode.ACCOUNT_BANNED))
    }

    // 验证验证码
    const isValid = await verifyCode(email, code, 'password_reset')
    if (!isValid) {
      // 记录验证码验证失败的安全事件（防止暴力破解）
      // 注意：不透露用户是否存在，统一返回错误
      await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, null, {
        ip: request.ip,
        action: 'forgot_password_verify_code',
        reason: 'Invalid verification code',
        username: email // 记录邮箱用于追踪，但不透露用户是否存在
      })
      return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL_CODE))
    }

    const passwordHash = await bcrypt.hash(password, 12)

    // 检查用户是否启用了2FA
    const is2FAEnabled = await db.is2FAEnabled(user.id)
    let twoFactorDisabled = false

    // 如果启用了2FA，则禁用
    if (is2FAEnabled) {
      await db.disable2FAComplete(user.id)
      twoFactorDisabled = true
      
      // 记录日志
      await createLog(user.id, 'security', '2fa.disable', '2FA disabled due to password reset', 'success')
    }

    // 更新密码
    await db.updateUser(user.id, { passwordHash })

    // 撤销用户所有会话，强制重新登录（安全措施）
    await revokeAllUserRefreshTokens(user.id)
    await invalidateUserAccessTokens(user.id)
    closeUserSessions(user.id, 'Password reset')

    // 记录安全事件
    await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, user.id, {
      ip: request.ip,
      username: user.username,
      action: 'password_reset',
      reason: 'Password reset via forgot password'
    })

    return {
      message: 'Password reset successfully. Please log in with your new password.',
      twoFactorDisabled: twoFactorDisabled
    }
  })

  // 获取用户登录历史记录
  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/login-history', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; pageSize?: string }
  }>, _reply: FastifyReply) => {
    const page = parsePositiveInteger(request.query.page, 1)
    const pageSize = Math.min(parsePositiveInteger(request.query.pageSize, 20), 50) // 最多50条

    const loginRecordsResult = await getUserLoginRecords(request.user.id, page, pageSize)

    return {
      records: loginRecordsResult.records.map(r => ({
        id: r.id,
        ip: r.ip,
        country: r.country,
        region: r.region,
        city: r.city,
        isp: r.isp,
        timezone: r.timezone,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString()
      })),
      total: loginRecordsResult.total,
      page: loginRecordsResult.page,
      pageSize: loginRecordsResult.pageSize,
      totalPages: loginRecordsResult.totalPages
    }
  })
}
