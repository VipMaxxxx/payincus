/**
 * 用户管理路由
 */

// @ts-ignore - bcryptjs has its own types
import bcrypt from 'bcryptjs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import type { UpdateUserRequest } from '../types/api.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { containsDangerousChars, revokeAllUserRefreshTokens, getUserSessions, logAdminAction, validatePassword, invalidateUserAccessTokens } from '../lib/security.js'
import {
    isOperationVerified,
    consumeOperationVerification
} from '../lib/operation-verification.js'
import { isSmtpEnabled, sendBanNotificationEmail, sendVerificationEmail } from '../lib/mailer.js'
import { sendNotification } from '../lib/notifier.js'
import { closeUserSessions } from '../lib/terminal-proxy.js'
import { createVerificationCode, verifyCode } from '../db/email-verification.js'
import { validateEmailDomain } from '../lib/email-domain.js'
import { HOSTING_BALANCE_LOG_LOCK_NAMESPACE, USER_ADMIN_ROLE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'

const USER_SEARCH_FIELDS = ['username', 'id', 'email'] as const
type UserSearchField = (typeof USER_SEARCH_FIELDS)[number]

function parseUserSearchFields(rawValue?: string): UserSearchField[] {
  if (!rawValue) {
    return [...USER_SEARCH_FIELDS]
  }

  const validFields = new Set<string>(USER_SEARCH_FIELDS)
  const fields = rawValue
    .split(',')
    .map(field => field.trim())
    .filter((field): field is UserSearchField => validFields.has(field))

  return fields.length > 0
    ? USER_SEARCH_FIELDS.filter(field => fields.includes(field))
    : [...USER_SEARCH_FIELDS]
}

function parseBooleanQuery(rawValue?: string): boolean {
  if (!rawValue) {
    return false
  }

  return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase())
}

export default async function userRoutes(fastify: FastifyInstance) {
  async function validateEmailChangeTarget(
    rawEmail: string,
    currentEmail: string | null,
    userId: number
  ): Promise<{ normalizedEmail: string } | { error: ReturnType<typeof apiError> }> {
    if (!rawEmail || !rawEmail.includes('@')) {
      return { error: apiError(ErrorCode.INVALID_EMAIL) }
    }

    const emailWithoutAllowed = rawEmail.replace(/@/g, '').replace(/\./g, '')
    if (containsDangerousChars(emailWithoutAllowed)) {
      return { error: apiError(ErrorCode.EMAIL_CONTAINS_ILLEGAL) }
    }

    const normalizedEmail = rawEmail.toLowerCase().trim()
    const normalizedCurrentEmail = currentEmail?.toLowerCase().trim() || null
    if (normalizedCurrentEmail && normalizedEmail === normalizedCurrentEmail) {
      return { error: apiError(ErrorCode.INVALID_PARAMS, 'New email must be different from current email') }
    }

    const domainValidation = await validateEmailDomain(normalizedEmail)
    if (!domainValidation.valid) {
      return { error: apiError(ErrorCode.EMAIL_DOMAIN_NOT_ALLOWED, domainValidation.domain || undefined) }
    }

    const existingUser = await db.findUserByEmail(normalizedEmail)
    if (existingUser && existingUser.id !== userId) {
      return { error: apiError(ErrorCode.EMAIL_ALREADY_REGISTERED) }
    }

    return { normalizedEmail }
  }

  // 获取用户列表 (管理员，支持分页和搜索)
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      searchFields?: string
      exact?: string
    }
  }>('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      searchFields?: string
      exact?: string
    }
  }>, _reply: FastifyReply) => {

    const { page = '1', pageSize = '20', search = '', searchFields, exact } = request.query

    const result = await db.getUsersPaginated({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      search,
      searchFields: parseUserSearchFields(searchFields),
      exactMatch: parseBooleanQuery(exact)
    })

    // 获取所有用户的 2FA 状态
    const userIds = result.items.map((u: any) => u.id)
    const twoFAStatuses = await Promise.all(
      userIds.map(async (id: number) => ({
        id,
        enabled: await db.is2FAEnabled(id)
      }))
    )
    const twoFAMap = new Map(twoFAStatuses.map(s => [s.id, s.enabled]))

    // 获取所有用户的实例数量
    const instanceCounts = await Promise.all(
      userIds.map(async (id: number) => {
        const instances = await db.getInstancesByUserId(id)
        return { id, count: instances.length }
      })
    )
    const instanceCountMap = new Map(instanceCounts.map(ic => [ic.id, ic.count]))

    // 获取所有用户的 GitHub 绑定状态
    const githubBindings = await Promise.all(
      userIds.map(async (id: number) => ({
        id,
        hasGithub: await db.hasOAuthBinding(id, 'github')
      }))
    )
    const githubBindingMap = new Map(githubBindings.map(gb => [gb.id, gb.hasGithub]))

    // 获取所有用户的最后登录记录
    const lastLoginMap = await db.getLastLoginRecordsForUsers(userIds)

    // 获取所有用户的余额
    const userBalances = await Promise.all(
      userIds.map(async (id: number) => ({
        id,
        balance: await db.getUserBalance(id)
      }))
    )
    const balanceMap = new Map(userBalances.map(ub => [ub.id, ub.balance]))

    // 获取所有用户的实际消费统计（兼容历史 consume 日志 amount 正负号不一致）
    const consumeMap = await db.getUsersTotalConsumeMap(userIds)

    // 获取所有用户的积分信息
    const userPointsList = await prisma.userPoints.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, points: true, totalEarned: true }
    })
    const pointsMap = new Map(userPointsList.map(up => [up.userId, { points: up.points, totalEarned: up.totalEarned }]))

    // 获取所有用户的托管余额信息
    const hostingBalances = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, hostingBalance: true }
    })
    const hostingBalanceMap = new Map(hostingBalances.map(u => [u.id, Number(u.hostingBalance || 0)]))

    // 获取所有用户的冻结托管余额
    const frozenHostingBalances = await prisma.hostingBalanceLog.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, frozen: true },
      _sum: { amount: true }
    })
    const frozenHostingMap = new Map(frozenHostingBalances.map(f => [f.userId, Number(f._sum.amount || 0)]))

    return {
      users: result.items.map((u: unknown) => {
        const user = u as {
          id: number
          username: string
          email: string | null
          role: string
          status: string
          avatar_style: string
          avatar_badge_id?: string | null
          // 新配额系统
          host_limit?: number
          host_used?: number
          friend_limit?: number
          friend_used?: number
          package_limit?: number
          package_used?: number
          // 流量配额
          monthly_traffic_limit?: string | null
          monthly_traffic_used?: string
          extra_traffic_quota?: string
          traffic_status?: string
          created_at: string
        }
        return {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          status: user.status,
          avatarStyle: user.avatar_style,
          avatarBadgeId: user.avatar_badge_id ?? null,
          twoFAEnabled: twoFAMap.get(user.id) || false,
          instanceCount: instanceCountMap.get(user.id) || 0,
          hasGithubBinding: githubBindingMap.get(user.id) || false,
          quota: {
            // 新配额系统
            hostLimit: user.host_limit || 0,
            hostUsed: user.host_used || 0,
            friendLimit: user.friend_limit || 0,
            friendUsed: user.friend_used || 0,
            packageLimit: user.package_limit || 0,
            packageUsed: user.package_used || 0,
            // 流量配额
            monthlyTrafficLimit: user.monthly_traffic_limit ?? null,
            monthlyTrafficUsed: user.monthly_traffic_used || '0',
            extraTrafficQuota: user.extra_traffic_quota || '0',
            trafficStatus: user.traffic_status || 'NORMAL'
          },
          createdAt: user.created_at,
          lastLogin: lastLoginMap.get(user.id) ? {
            ip: lastLoginMap.get(user.id)!.ip,
            country: lastLoginMap.get(user.id)!.country,
            city: lastLoginMap.get(user.id)!.city,
            createdAt: lastLoginMap.get(user.id)!.createdAt.toISOString()
          } : null,
          balance: balanceMap.get(user.id) || 0,
          totalConsume: consumeMap.get(user.id) || 0,
          points: pointsMap.get(user.id)?.points || 0,
          totalEarnedPoints: pointsMap.get(user.id)?.totalEarned || 0,
          hostingBalance: hostingBalanceMap.get(user.id) || 0,
          hostingBalanceFrozen: frozenHostingMap.get(user.id) || 0
        }
      }),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  })

  // 按用户名精确查找用户（管理员，用于创建实例等场景）
  fastify.get<{
    Querystring: { username: string }
  }>('/lookup', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Querystring: { username: string }
  }>, reply: FastifyReply) => {
    const { username } = request.query

    if (!username || !username.trim()) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Username is required'))
    }

    // 直接用 prisma 查询以获取 balance 字段
    const user = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        balance: true
      }
    })
    
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        balance: Number(user.balance)  // 返回余额（元），用于管理员创建付费实例时检查
      }
    }
  })

  // 获取用户详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 普通用户只能查看自己
    if (request.user.role !== 'admin' && request.user.id !== userId) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const quota = await db.getUserQuota(user.id)
    const instances = await db.getInstancesByUserId(user.id)

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        avatarStyle: user.avatar_style,
        avatarBadgeId: user.avatar_badge_id ?? null,
        quota: quota ? {
          // 新配额系统
          hostLimit: quota.host_limit,
          hostUsed: quota.host_used,
          friendLimit: quota.friend_limit,
          friendUsed: quota.friend_used,
          packageLimit: quota.package_limit,
          packageUsed: quota.package_used,
          // 流量配额
          monthlyTrafficLimit: quota.monthly_traffic_limit?.toString() ?? null,
          monthlyTrafficUsed: quota.monthly_traffic_used.toString(),
          extraTrafficQuota: quota.extra_traffic_quota.toString(),
          trafficStatus: quota.traffic_status
        } : null,
        instanceCount: instances.length,
        createdAt: user.created_at
      }
    }
  })

  // 发送修改邮箱验证码（登录态，发送到新邮箱）
  fastify.post<{
    Params: { id: string }
    Body: { email: string }
  }>('/:id/change-email/send-code', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { email: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (request.user.id !== userId) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const smtpEnabled = await isSmtpEnabled()
    if (!smtpEnabled) {
      return reply.code(400).send(apiError(ErrorCode.EMAIL_VERIFICATION_DISABLED))
    }

    if (user.email) {
      const verified = await isOperationVerified(userId, 'change_email')
      if (!verified) {
        return reply.code(403).send({
          error: 'Sensitive operation requires verification',
          code: 'VERIFICATION_REQUIRED',
          operationType: 'change_email'
        })
      }
    }

    const validationResult = await validateEmailChangeTarget(request.body.email, user.email, userId)
    if ('error' in validationResult) {
      return reply.code(400).send(validationResult.error)
    }

    const result = await createVerificationCode(validationResult.normalizedEmail)
    if (!result) {
      return reply.code(429).send(apiError(ErrorCode.TOO_MANY_VERIFICATION_REQUESTS))
    }

    const sendResult = await sendVerificationEmail(
      validationResult.normalizedEmail,
      result.code,
      10,
      'change_email'
    )

    if (!sendResult.success) {
      return reply.code(500).send(apiError(ErrorCode.EMAIL_SEND_FAILED))
    }

    return {
      message: 'Verification code sent',
      expiresAt: result.expiresAt.toISOString()
    }
  })

  // 更新用户信息
  fastify.patch<{
    Params: { id: string }
    Body: UpdateUserRequest & { password?: string; currentPassword?: string; avatarStyle?: string; emailCode?: string }
  }>('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          emailCode: { type: 'string', minLength: 6, maxLength: 6 },
          avatarStyle: {
            type: 'string',
            enum: [
              'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
              'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
              'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
              'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
              'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
              'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
            ]
          }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: UpdateUserRequest & { password?: string; currentPassword?: string; avatarStyle?: string; emailCode?: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 只能修改自己或管理员可修改任意用户
    if (request.user.role !== 'admin' && request.user.id !== userId) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const { email, password, avatarStyle, currentPassword, emailCode } = request.body

    // 敏感操作二次验证：修改密码或邮箱时需要验证（管理员修改他人时跳过）
    if (request.user.id === userId) {
      // 修改密码需要验证当前密码和二次验证
      if (password) {
        // 验证当前密码（防止会话劫持）
        if (!currentPassword) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Current password is required'))
        }
        
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash)
        if (!validPassword) {
          return reply.code(401).send(apiError(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect'))
        }
        
        // 二次验证
        const verified = await isOperationVerified(request.user.id, 'change_password')
        if (!verified) {
          return reply.code(403).send({
            error: 'Sensitive operation requires verification',
            code: 'VERIFICATION_REQUIRED',
            operationType: 'change_password'
          })
        }
      }
      // 修改邮箱需要二次验证
      if (email !== undefined && email !== user.email) {
        if (user.email) {
          const verified = await isOperationVerified(request.user.id, 'change_email')
          if (!verified) {
            return reply.code(403).send({
              error: 'Sensitive operation requires verification',
              code: 'VERIFICATION_REQUIRED',
              operationType: 'change_email'
            })
          }
        }

        if (!emailCode) {
          return reply.code(400).send(apiError(ErrorCode.EMAIL_CODE_REQUIRED))
        }
      }
    }

    const updates: { email?: string; passwordHash?: string; avatarStyle?: string } = {}

    if (email !== undefined) {
      const validationResult = await validateEmailChangeTarget(email, user.email, userId)
      if ('error' in validationResult) {
        return reply.code(400).send(validationResult.error)
      }

      if (request.user.id === userId && email !== user.email) {
        const verified = await verifyCode(validationResult.normalizedEmail, emailCode!)
        if (!verified) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_EMAIL_CODE))
        }
      }

      updates.email = validationResult.normalizedEmail
    }

    if (password) {
      // 验证新密码强度
      const passwordCheck = validatePassword(password)
      if (!passwordCheck.valid) {
        return reply.code(400).send(apiError(ErrorCode.PASSWORD_TOO_WEAK, passwordCheck.message))
      }
      
      updates.passwordHash = await bcrypt.hash(password, 12)
    }

    if (avatarStyle) {
      updates.avatarStyle = avatarStyle
    }

    if (Object.keys(updates).length > 0) {
      await db.updateUser(userId, updates)

      if (password) {
        await revokeAllUserRefreshTokens(userId)
        await invalidateUserAccessTokens(userId)
        closeUserSessions(userId, 'Password updated')
      }

      const updateActions: string[] = []
      if (email !== undefined) updateActions.push('email')
      if (password) updateActions.push('password')
      if (avatarStyle) updateActions.push('avatarStyle')

      await createLog(
        request.user.id,
        'personal',
        'profile.update',
        `${request.user.role === 'admin' && request.user.id !== userId ? `Admin updated user "${user.username}":` : ''} ${updateActions.join(', ')}`,
        'success'
      )

      // 清理已使用的验证记录
      if (request.user.id === userId) {
        if (password) {
          await consumeOperationVerification(request.user.id, 'change_password')
          // 发送密码修改通知
          await sendNotification(userId, 'password_changed', {
            instanceName: ''
          })
        }
        if (email !== undefined && email !== user.email) {
          if (user.email) {
            await consumeOperationVerification(request.user.id, 'change_email')
          }
        }
      }
    }

    return {
      message: 'User info updated',
      reauthRequired: Boolean(password && request.user.id === userId)
    }
  })

  // Change user role (admin)
  fastify.patch<{
    Params: { id: string }
    Body: { role: 'admin' | 'user' }
  }>('/:id/role', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['admin', 'user'] }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { role: 'admin' | 'user' }
  }>, reply: FastifyReply) => {
    const userId = Number(request.params.id)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (request.user.id === userId) {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_MODIFY_SELF))
    }

    const { role } = request.body
    const invalidatedAt = Math.floor(Date.now() / 1000)
    const userLevelSessionId = '__USER_LEVEL__'

    type RoleUpdateResult = {
      changed: boolean
      username: string
      previousRole: 'admin' | 'user'
      role: 'admin' | 'user'
      revokedSessions: number
    }

    let roleUpdate: RoleUpdateResult
    try {
      roleUpdate = await prisma.$transaction(async (tx): Promise<RoleUpdateResult> => {
        const locked = await tryAdvisoryTransactionLock(tx, USER_ADMIN_ROLE_LOCK_NAMESPACE, 1)
        if (!locked) {
          throw new Error('USER_ADMIN_ROLE_LOCK_BUSY')
        }

        const targetUser = await tx.user.findUnique({
          where: { id: userId },
          select: {
            username: true,
            role: true,
            status: true
          }
        })

        if (!targetUser) {
          throw new Error('USER_NOT_FOUND')
        }

        if (role === targetUser.role) {
          return {
            changed: false,
            username: targetUser.username,
            previousRole: targetUser.role,
            role: targetUser.role,
            revokedSessions: 0
          }
        }

        if (role === 'admin' && targetUser.status !== 'active') {
          throw new Error('TARGET_NOT_ACTIVE')
        }

        if (targetUser.role === 'admin' && role === 'user' && targetUser.status === 'active') {
          const activeAdminCount = await tx.user.count({
            where: {
              role: 'admin',
              status: 'active'
            }
          })

          if (activeAdminCount <= 1) {
            throw new Error('LAST_ACTIVE_ADMIN')
          }
        }

        await tx.user.update({
          where: { id: userId },
          data: { role }
        })

        const revoked = await tx.refreshToken.deleteMany({
          where: { userId }
        })

        await tx.tokenInvalidation.upsert({
          where: {
            userId_sessionId: {
              userId,
              sessionId: userLevelSessionId
            }
          },
          create: {
            userId,
            sessionId: userLevelSessionId,
            invalidatedAt
          },
          update: {
            invalidatedAt
          }
        })

        return {
          changed: true,
          username: targetUser.username,
          previousRole: targetUser.role,
          role,
          revokedSessions: revoked.count
        }
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'USER_NOT_FOUND') {
          return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
        }

        if (error.message === 'TARGET_NOT_ACTIVE') {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Only active users can be promoted to admin'))
        }

        if (error.message === 'LAST_ACTIVE_ADMIN') {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Cannot remove the last active admin'))
        }

        if (error.message === 'USER_ADMIN_ROLE_LOCK_BUSY') {
          return reply.code(409).send(apiError(ErrorCode.INVALID_PARAMS, 'Another admin role update is in progress, please retry'))
        }
      }

      throw error
    }

    if (!roleUpdate.changed) {
      return {
        message: 'User role unchanged',
        role: roleUpdate.role
      }
    }

    const closedTerminals = closeUserSessions(userId, 'User role changed by admin')
    if (closedTerminals > 0) {
      console.log(`[Role] Closed ${closedTerminals} terminal session(s) for user ${userId}`)
    }

    await createLog(
      request.user.id,
      'user',
      'user.role.update',
      `Changed user "${roleUpdate.username}" (ID: ${userId}) role from ${roleUpdate.previousRole} to ${roleUpdate.role}`,
      'success'
    )

    await logAdminAction(request.user.id, 'user.role.update', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: roleUpdate.username,
      resourceType: 'user',
      metadata: {
        previousRole: roleUpdate.previousRole,
        nextRole: roleUpdate.role,
        revokedSessions: roleUpdate.revokedSessions
      },
      reason: `Admin changed user role from ${roleUpdate.previousRole} to ${roleUpdate.role}`
    })

    return {
      message: 'User role updated',
      role: roleUpdate.role,
      revokedSessions: roleUpdate.revokedSessions
    }
  })

  // 设置用户配额 (管理员)
  // 新配额系统：控制宿主机数量、实例数量、好友数量、套餐数量
  // 重算用户配额使用量 (管理员)
  // 新配额系统：重算宿主机/实例/好友使用量
  fastify.post<{ Params: { id: string } }>('/:id/quota/recalculate', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)

    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 新配额系统：重新计算用户的资源使用量
    // 注意：不再计算实例配额使用量
    const actualUsed = await db.calculateUserQuotaUsed(userId)

    await db.updateUserQuotaUsed(userId, {
      hostUsed: actualUsed.hostUsed,
      friendUsed: actualUsed.friendUsed,
      packageUsed: actualUsed.packageUsed
    })

    return {
      message: 'Quota recalculated',
      quota: actualUsed
    }
  })

  // 用户自行增加配额
  // 规则：只有当使用率达到80%时才能增加，每次只能增加一种配额
  // 宿主机每次可增加5个，好友每次可增加10名
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  fastify.post<{
    Body: {
      hostLimit?: number
      friendLimit?: number
    }
  }>('/me/quota/increase', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          hostLimit: { type: 'integer', minimum: 0 },
          friendLimit: { type: 'integer', minimum: 0 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Body: {
      hostLimit?: number
      friendLimit?: number
    }
  }>, reply: FastifyReply) => {
    const userId = request.user.id
    const { hostLimit, friendLimit } = request.body

    // 检查是否只提供了一种配额类型
    const providedTypes = [hostLimit !== undefined, friendLimit !== undefined].filter(Boolean).length
    if (providedTypes !== 1) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '每次只能增加一种配额类型'))
    }

    // 获取当前配额
    const currentQuota = await db.getUserQuota(userId)
    if (!currentQuota) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND, '配额信息不存在'))
    }

    // 确定要增加的配额类型和数量
    let quotaType: 'host' | 'friend' | null = null
    let increaseAmount = 0
    let currentUsed = 0
    let currentLimit = 0
    let expectedIncrease = 0

    if (hostLimit !== undefined) {
      quotaType = 'host'
      currentUsed = currentQuota.host_used
      currentLimit = currentQuota.host_limit
      increaseAmount = hostLimit - currentLimit
      expectedIncrease = 5
    } else if (friendLimit !== undefined) {
      quotaType = 'friend'
      currentUsed = currentQuota.friend_used
      currentLimit = currentQuota.friend_limit
      increaseAmount = friendLimit - currentLimit
      expectedIncrease = 10
    }

    // 验证增加数量是否正确
    if (increaseAmount !== expectedIncrease) {
      const typeNames = { host: '宿主机', friend: '好友' }
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, `${typeNames[quotaType!]}每次只能增加 ${expectedIncrease} 个`))
    }

    // 检查使用率是否达到50%
    if (currentLimit === 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '配额限制为0，无法计算使用率'))
    }

    const usagePercent = (currentUsed / currentLimit) * 100
    if (usagePercent < 50) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, `当前使用率为 ${Math.round(usagePercent)}%，需要达到50%（含）才能增加配额`))
    }

    // 更新配额
    if (quotaType === 'host') {
      await db.updateUserQuotaLimits(userId, { hostLimit })
    } else if (quotaType === 'friend') {
      await db.updateUserQuotaLimits(userId, { friendLimit })
    }

    // 记录日志
    const typeNames = { host: '宿主机', friend: '好友' }
    await createLog(
      userId,
      'personal',
      'quota.increase',
      `用户自行增加${typeNames[quotaType!]}配额：${currentLimit} → ${quotaType === 'host' ? hostLimit : friendLimit}`,
      'success'
    )

    return { message: '配额增加成功' }
  })

  // 封禁/解封用户 (管理员)
  fastify.patch<{
    Params: { id: string }
    Body: { status: 'active' | 'banned'; reason?: string }
  }>('/:id/status', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['active', 'banned'] },
          reason: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { status: 'active' | 'banned'; reason?: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { status, reason } = request.body

    // 不能封禁自己
    if (request.user.id === userId) {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_MODIFY_SELF))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 不能封禁管理员
    if (user.role === 'admin' && status === 'banned') {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_BAN_ADMIN))
    }

    await db.updateUserStatus(userId, status, reason)

    // 如果是封禁用户，关闭该用户的所有终端连接
    if (status === 'banned') {
      await revokeAllUserRefreshTokens(userId)
      await invalidateUserAccessTokens(userId)
      const closedSessions = closeUserSessions(userId, 'User account banned')
      if (closedSessions > 0) {
        console.log(`[Ban] Closed ${closedSessions} terminal session(s) for user ${userId}`)
      }
    }

    await createLog(
      request.user.id,
      'user',
      status === 'banned' ? 'user.ban' : 'user.unban',
      `${status === 'banned' ? 'Banned' : 'Unbanned'} user "${user.username}" (ID: ${userId}, email: ${user.email || 'N/A'})${reason ? ` - Reason: ${reason}` : ''}`,
      'success'
    )

    // AUTH003: 管理员操作审计日志
    await logAdminAction(request.user.id, status === 'banned' ? 'user.ban' : 'user.unban', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: 'user',
      reason: status === 'banned' ? (reason || 'Admin banned user') : 'Admin unbanned user'
    })

    // 如果是封禁且提供了原因，发送封禁邮件通知
    if (status === 'banned' && reason && user.email) {
      sendBanNotificationEmail(user.email, {
        username: user.username,
        reason: reason
      }).then(result => {
        if (result.success) {
          console.log(`[Ban] Sent ban notification email to ${user.email}`)
        } else {
          console.error(`[Ban] Failed to send ban notification email:`, result.error)
        }
      }).catch(err => {
        console.error(`[Ban] Failed to send ban notification email:`, err)
      })
    }

    return { message: status === 'banned' ? 'User banned' : 'User unbanned' }
  })

  // 删除用户 (管理员)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const userId = Number(id)

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 不能删除自己
    if (request.user.id === userId) {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_DELETE_SELF))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 不能删除管理员
    if (user.role === 'admin') {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_DELETE_ADMIN))
    }

    // 检查是否有实例
    const instances = await db.getInstancesByUserId(userId)
    if (instances.length > 0) {
      return reply.code(400).send(apiError(ErrorCode.USER_HAS_INSTANCES, `${instances.length}`))
    }

    await db.deleteUser(userId)

    await createLog(
      request.user.id,
      'user',
      'user.delete',
      `Deleted user "${user.username}" (ID: ${userId}, email: ${user.email || 'N/A'}, role: ${user.role})`,
      'success'
    )

    // AUTH003: 管理员操作审计日志 - 删除用户是高危操作
    await logAdminAction(request.user.id, 'user.delete', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: 'user',
      reason: 'Admin deleted user account'
    })

    return { message: 'User deleted' }
  })

  // 管理员获取指定用户的所有会话
  fastify.get<{ Params: { id: string } }>('/:id/sessions', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const sessions = await getUserSessions(userId)
    return { sessions }
  })

  // 管理员撤销指定用户的所有会话
  fastify.post<{ Params: { id: string } }>('/:id/revoke-sessions', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const count = await revokeAllUserRefreshTokens(userId)
    await invalidateUserAccessTokens(userId)

    // 关闭该用户的所有终端连接
    const closedTerminals = closeUserSessions(userId, 'Sessions revoked by admin')
    if (closedTerminals > 0) {
      console.log(`[RevokeSession] Closed ${closedTerminals} terminal session(s) for user ${userId}`)
    }

    await createLog(
      request.user.id,
      'user',
      'user.revoke_sessions',
      `Revoked ${count} sessions for user "${user.username}" (ID: ${userId})`,
      'success'
    )

    // AUTH003: 管理员操作审计日志
    await logAdminAction(request.user.id, 'user.revoke_sessions', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: 'session',
      metadata: { revokedCount: count }
    })

    return { message: `已撤销 ${count} 个会话` }
  })

  // 管理员重置用户密码（自动生成随机密码）
  fastify.post<{
    Params: { id: string }
  }>('/:id/reset-password', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 生成随机密码：12位，包含大小写字母和数字
    // 使用密码学安全的随机数生成器
    const { generateRandomPassword } = await import('../lib/incus-config-generator.js')
    const newPassword = generateRandomPassword(12)

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await db.updateUser(userId, { passwordHash })

    // 撤销用户所有会话，强制重新登录
    await revokeAllUserRefreshTokens(userId)
    await invalidateUserAccessTokens(userId)
    closeUserSessions(userId, 'Password reset by admin')

    await createLog(
      request.user.id,
      'user',
      'user.reset_password',
      `Admin reset password for user "${user.username}" (ID: ${userId}) - new password generated`,
      'success'
    )

    // AUTH003: 管理员操作审计日志 - 重置密码是敏感操作
    await logAdminAction(request.user.id, 'user.reset_password', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: 'credential',
      reason: 'Admin initiated password reset'
    })

    return {
      message: 'Password reset successfully',
      newPassword,
      username: user.username
    }
  })

  // 管理员取消用户的 2FA
  fastify.post<{ Params: { id: string } }>('/:id/disable-2fa', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 检查用户是否启用了 2FA
    const is2FAEnabled = await db.is2FAEnabled(userId)
    if (!is2FAEnabled) {
      return reply.code(400).send(apiError(ErrorCode.TWO_FA_NOT_ENABLED))
    }

    // 禁用 2FA（清除所有 2FA 数据）
    await db.disable2FAComplete(userId)

    await createLog(
      request.user.id,
      'user',
      'user.disable_2fa',
      `Admin disabled 2FA for user "${user.username}" (ID: ${userId})`,
      'success'
    )

    // AUTH003: 管理员操作审计日志 - 禁用 2FA 是敏感操作
    await logAdminAction(request.user.id, 'user.disable_2fa', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: '2fa',
      reason: 'Admin disabled user 2FA'
    })

    return { message: '2FA disabled successfully' }
  })

  // 管理员解除用户的 OAuth 绑定
  fastify.delete<{
    Params: { id: string; provider: string }
  }>('/:id/oauth/:provider', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string; provider: string }
  }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    const { provider } = request.params

    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证 provider 参数
    if (provider !== 'github' && provider !== 'google') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid OAuth provider'))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 检查用户是否绑定了该 OAuth
    const hasBound = await db.hasOAuthBinding(userId, provider as 'github' | 'google')
    if (!hasBound) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'User has not bound this OAuth provider'))
    }

    // 删除 OAuth 绑定
    await db.deleteOAuthBinding(userId, provider as 'github' | 'google')

    await createLog(
      request.user.id,
      'user',
      'user.unbind_oauth',
      `Admin unbound ${provider} OAuth for user "${user.username}" (ID: ${userId})`,
      'success'
    )

    // AUTH003: 管理员操作审计日志 - 解除 OAuth 绑定是敏感操作
    await logAdminAction(request.user.id, 'user.unbind_oauth', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      targetUserId: userId,
      targetUsername: user.username,
      resourceType: 'oauth',
      metadata: { provider },
      reason: `Admin unbound ${provider} OAuth`
    })

    return { message: `${provider} OAuth binding removed successfully` }
  })

  // 管理员获取用户登录记录
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>('/:id/login-records', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>, reply: FastifyReply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const user = await db.findUserById(userId)
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const page = parseInt(request.query.page || '1', 10)
    const pageSize = parseInt(request.query.pageSize || '20', 10)

    const { records, total } = await db.getUserLoginRecords(userId, page, pageSize)

    return {
      records: records.map(r => ({
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
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  })

  // 管理员检测关联账号
  // 安全：仅管理员可访问，使用 authenticateAdmin 中间件
  fastify.get<{
    Querystring: { days?: string }
  }>('/detect-linked-accounts', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Querystring: { days?: string }
  }>, _reply: FastifyReply) => {
    const startTime = Date.now()
    // 参数校验：限制检测范围在 1-365 天之间，防止查询性能问题
    const rawDays = parseInt(request.query.days || '90', 10)
    const days = Math.min(365, Math.max(1, isNaN(rawDays) ? 90 : rawDays))

    // 并行执行三种检测
    const [ipGroups, emailGroups, usernameGroups] = await Promise.all([
      db.getSharedIPGroups(days, 2),
      db.getSimilarEmailGroups(),
      db.getSimilarUsernameGroups()
    ])

    const durationMs = Date.now() - startTime

    // 记录管理员操作日志
    await createLog(
      request.user.id,
      'user',
      'admin.detect_linked_accounts',
      `Admin detected linked accounts: ${ipGroups.length} IP groups, ${emailGroups.length} email groups, ${usernameGroups.length} username groups (${durationMs}ms)`,
      'success'
    )

    return {
      detectedAt: new Date().toISOString(),
      durationMs,
      days,
      summary: {
        ipGroups: ipGroups.length,
        emailGroups: emailGroups.length,
        usernameGroups: usernameGroups.length
      },
      ipGroups: ipGroups.map(g => ({
        ip: g.ip,
        userCount: g.users.length,
        totalLogins: g.totalLogins,
        users: g.users.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          status: u.status,
          loginCount: u.loginCount,
          lastLogin: u.lastLogin.toISOString()
        }))
      })),
      emailGroups: emailGroups.map(g => ({
        pattern: g.pattern,
        userCount: g.users.length,
        users: g.users.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          status: u.status,
          createdAt: u.createdAt.toISOString()
        }))
      })),
      usernameGroups: usernameGroups.map(g => ({
        pattern: g.pattern,
        userCount: g.users.length,
        users: g.users.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          status: u.status,
          createdAt: u.createdAt.toISOString()
        }))
      }))
    }
  })

  // 获取用户托管余额明细（管理员）
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>('/:id/hosting-balance/logs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid user ID'))
    }

    const { page = '1', pageSize = '20' } = request.query
    const pageNum = parseInt(page, 10)
    const size = Math.min(parseInt(pageSize, 10), 100)
    const skip = (pageNum - 1) * size

    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, hostingBalance: true }
    })
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND, 'User not found'))
    }

    // 获取托管余额明细
    const [logs, total] = await Promise.all([
      prisma.hostingBalanceLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size
      }),
      prisma.hostingBalanceLog.count({ where: { userId } })
    ])

    // 获取冻结余额总额
    const frozenResult = await prisma.hostingBalanceLog.aggregate({
      where: { userId, frozen: true },
      _sum: { amount: true }
    })

    return {
      user: {
        id: user.id,
        username: user.username
      },
      available: Number(user.hostingBalance || 0),
      frozen: Number(frozenResult._sum.amount || 0),
      logs: logs.map(log => ({
        id: log.id,
        type: log.type,
        actionType: log.actionType,
        amount: Number(log.amount),
        frozen: log.frozen,
        unfreezeAt: log.unfreezeAt?.toISOString() || null,
        description: log.remark,
        createdAt: log.createdAt.toISOString()
      })),
      total,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(total / size)
    }
  })

  // 调整用户托管余额（管理员）
  fastify.post<{
    Params: { id: string }
    Body: { type: 'available' | 'frozen'; amount: number; reason: string }
  }>('/:id/hosting-balance/adjust', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parseInt(request.params.id, 10)
    if (isNaN(userId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid user ID'))
    }

    const { type, amount, reason } = request.body
    if (!type || !['available', 'frozen'].includes(type)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid type, must be "available" or "frozen"'))
    }
    if (typeof amount !== 'number' || amount === 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Amount must be a non-zero number'))
    }
    if (!reason || !reason.trim()) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Reason is required'))
    }

    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, hostingBalance: true }
    })
    if (!user) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND, 'User not found'))
    }

    const isAdd = amount > 0
    const absAmount = Math.abs(amount)

    try {
      if (type === 'available') {
        await prisma.$transaction(async (tx) => {
          const locked = await tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, userId)
          if (!locked) {
            throw new Error('Hosting balance is being processed')
          }

          // 更新用户托管余额
          const updateResult = await tx.user.updateMany({
            where: {
              id: userId,
              ...(isAdd ? {} : { hostingBalance: { gte: absAmount } })
            },
            data: {
              hostingBalance: isAdd
                ? { increment: absAmount }
                : { decrement: absAmount }
            }
          })
          if (updateResult.count === 0) {
            throw new Error('Insufficient hosting balance')
          }

          // 记录日志
          await tx.hostingBalanceLog.create({
            data: {
              userId,
              type: isAdd ? 'income' : 'deduction',
              actionType: 'admin_adjust',
              amount: absAmount,
              frozen: false,
              remark: `[Admin] ${reason.trim()}`
            }
          })
        })
      } else {
        // 调整冻结余额
        if (isAdd) {
          // 增加冻结余额：创建一条冻结记录
          await prisma.$transaction(async (tx) => {
            const locked = await tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, userId)
            if (!locked) {
              throw new Error('Hosting balance is being processed')
            }

            await tx.hostingBalanceLog.create({
              data: {
                userId,
                type: 'income',
                actionType: 'admin_adjust',
                amount: absAmount,
                frozen: true,
                unfreezeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天后解冻
                remark: `[Admin Frozen] ${reason.trim()}`
              }
            })
          })
        } else {
          await prisma.$transaction(async (tx) => {
            const locked = await tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, userId)
            if (!locked) {
              throw new Error('Hosting balance is being processed')
            }

            // 扣减冻结余额：从冻结记录中扣除
            const frozenLogs = await tx.hostingBalanceLog.findMany({
              where: { userId, frozen: true, amount: { gt: 0 } },
              orderBy: { createdAt: 'asc' }
            })
            const frozenTotal = frozenLogs.reduce((sum, log) => sum + Number(log.amount), 0)
            if (frozenTotal < absAmount) {
              throw new Error('Insufficient frozen hosting balance')
            }

            // 从最早的冻结记录开始扣减
            let remaining = absAmount
            for (const log of frozenLogs) {
              if (remaining <= 0) break
              const logAmount = Number(log.amount)
              if (logAmount <= remaining) {
                // 完全扣除这条记录
                await tx.hostingBalanceLog.delete({ where: { id: log.id } })
                remaining -= logAmount
              } else {
                // 部分扣除
                await tx.hostingBalanceLog.update({
                  where: { id: log.id },
                  data: { amount: { decrement: remaining } }
                })
                remaining = 0
              }
            }

            // 记录扣减日志
            await tx.hostingBalanceLog.create({
              data: {
                userId,
                type: 'deduction',
                actionType: 'admin_adjust',
                amount: 0, // 不计入实际余额，仅作为记录
                frozen: false,
                remark: `[Admin Frozen Deduct] ${reason.trim()} (¥${absAmount.toFixed(2)})`
              }
            })
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'Hosting balance is being processed') {
        return reply.code(409).send({ error: '托管余额正在处理，请稍后重试', code: 'HOSTING_BALANCE_BUSY' })
      }
      if (message === 'Insufficient hosting balance') {
        return reply.code(400).send(apiError(ErrorCode.BALANCE_INSUFFICIENT, 'Insufficient hosting balance'))
      }
      if (message === 'Insufficient frozen hosting balance') {
        return reply.code(400).send(apiError(ErrorCode.BALANCE_INSUFFICIENT, 'Insufficient frozen hosting balance'))
      }
      throw error
    }

    // 记录管理员操作日志
    await createLog(
      request.user.id,
      'user',
      'admin.adjust_hosting_balance',
      `Admin adjusted user #${userId} hosting balance: type=${type}, amount=${amount}, reason=${reason}`,
      'success'
    )

    // 返回更新后的托管余额信息
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { hostingBalance: true }
    })
    const frozenResult = await prisma.hostingBalanceLog.aggregate({
      where: { userId, frozen: true },
      _sum: { amount: true }
    })

    return {
      success: true,
      available: Number(updatedUser?.hostingBalance || 0),
      frozen: Number(frozenResult._sum.amount || 0)
    }
  })
}

