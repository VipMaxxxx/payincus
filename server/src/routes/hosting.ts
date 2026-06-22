/**
 * 托管余额路由
 * 处理托管余额查询、提现申请、管理员审核等
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { HostingActionType, WithdrawalStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { checkHostingAccess } from '../lib/hosting-access.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import {
  createHostingUserBlock,
  listHostingUserBlocks,
  removeHostingUserBlock
} from '../db/hosting-blocks.js'
import { HOSTING_BALANCE_LOG_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { calculateVipLevel, getVipBadgeStyleForLevel, getVipRules } from '../services/vip-levels.js'

// 提现配置常量
const WITHDRAWAL_CONFIG = {
  minAmount: 10,              // 最低提现金额（元）
  feeRateBalance: 0.05        // 提现到面板余额手续费率 5%
}

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const HOSTING_ACTION_TYPES = new Set<HostingActionType>([
  'purchase',
  'renew',
  'upgrade',
  'destroy',
  'unfreeze',
  'withdraw',
  'admin_adjust'
])
const WITHDRAWAL_STATUSES = new Set<WithdrawalStatus>([
  'pending',
  'approved',
  'rejected',
  'completed'
])

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveIntegerQuery(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_ROUTE_ID_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveIntegerQuery(value, fallback), max)
}

function normalizeHostingActionType(value: string | undefined): HostingActionType | undefined {
  return value && HOSTING_ACTION_TYPES.has(value as HostingActionType)
    ? value as HostingActionType
    : undefined
}

function normalizeWithdrawalStatus(value: string | undefined): WithdrawalStatus | undefined {
  return value && WITHDRAWAL_STATUSES.has(value as WithdrawalStatus)
    ? value as WithdrawalStatus
    : undefined
}

function normalizeSearch(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

export default async function hostingRoutes(fastify: FastifyInstance) {
  async function ensureCanManageHostingBlocks(userId: number, role: string): Promise<boolean> {
    if (role === 'admin') {
      return true
    }

    const result = await checkHostingAccess(userId)
    return result.allowed
  }

  // ==================== 托管准入检查 ====================

  // 检查当前用户是否满足托管准入条件
  fastify.get('/access-check', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request

    // 管理员直接放行
    if (user.role === 'admin') {
      return { allowed: true }
    }

    const result = await checkHostingAccess(user.id)
    return {
      allowed: result.allowed,
      reason: result.reason,
      details: result.details
    }
  })

  // ==================== 托管用户拉黑 ====================

  fastify.get('/blocks', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const { user } = request
    if (!await ensureCanManageHostingBlocks(user.id, user.role)) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const blocks = await listHostingUserBlocks(user.id)
    return { blocks }
  })

  fastify.get<{
    Querystring: { keyword?: string }
  }>('/blocks/search', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          keyword: { type: 'string', maxLength: 64 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { keyword?: string } }>, reply) => {
    const { user } = request
    const keyword = request.query.keyword?.trim() || ''
    if (!await ensureCanManageHostingBlocks(user.id, user.role)) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }
    if (keyword.length < 2) {
      return { users: [] }
    }
    const numericKeyword = /^\d+$/.test(keyword) ? Number(keyword) : null
    const userIdCondition = numericKeyword !== null && Number.isSafeInteger(numericKeyword)
      ? { id: numericKeyword }
      : undefined

    const users = await prisma.user.findMany({
      where: {
        id: { not: user.id },
        role: { not: 'admin' },
        status: 'active',
        OR: [
          userIdCondition,
          { username: { contains: keyword, mode: 'insensitive' } },
          { email: { contains: keyword, mode: 'insensitive' } }
        ].filter(Boolean) as any
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatarStyle: true,
        avatarBadgeId: true,
        hostingBlocksReceived: {
          where: { blockerId: user.id },
          select: { id: true }
        }
      },
      take: 10,
      orderBy: { id: 'asc' }
    })

    return {
      users: users.map(item => ({
        id: item.id,
        username: item.username,
        email: item.email,
        avatarStyle: item.avatarStyle,
        avatarBadgeId: item.avatarBadgeId ?? null,
        blocked: item.hostingBlocksReceived.length > 0
      }))
    }
  })

  fastify.post<{
    Body: { userId: number; remark?: string | null }
  }>('/blocks', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer', minimum: 1 },
          remark: { type: ['string', 'null'], maxLength: 200 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { userId: number; remark?: string | null } }>, reply) => {
    const { user } = request
    const { userId, remark } = request.body
    if (!await ensureCanManageHostingBlocks(user.id, user.role)) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }
    if (userId === user.id) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '不能拉黑自己'))
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, status: true }
    })
    if (!target || target.status !== 'active') {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }
    if (target.role === 'admin') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '不能拉黑管理员账户'))
    }

    const block = await createHostingUserBlock(user.id, userId, remark)
    await createLog(user.id, 'hosting', 'hosting.block_user', `Blocked user "${target.username}" (#${target.id})`, 'success')
    return { block }
  })

  fastify.delete<{
    Params: { userId: string }
  }>('/blocks/:userId', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', pattern: '^\\d+$' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const { user } = request
    const blockedUserId = parsePositiveRouteId(request.params.userId)
    if (!await ensureCanManageHostingBlocks(user.id, user.role)) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }
    if (!blockedUserId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const removed = await removeHostingUserBlock(user.id, blockedUserId)
    if (removed) {
      await createLog(user.id, 'hosting', 'hosting.unblock_user', `Unblocked user #${blockedUserId}`, 'success')
    }
    return { success: removed }
  })

  // ==================== 托管余额查询 ====================

  // 获取当前用户托管余额
  fastify.get('/balance', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request

    // 获取用户托管余额
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { hostingBalance: true }
    })

    // 获取冻结金额（未解冻的收入）
    const frozenResult = await prisma.hostingBalanceLog.aggregate({
      where: {
        userId: user.id,
        frozen: true,
        type: 'income'
      },
      _sum: { amount: true }
    })

    // 获取累计收入
    const totalIncomeResult = await prisma.hostingBalanceLog.aggregate({
      where: {
        userId: user.id,
        type: 'income'
      },
      _sum: { amount: true }
    })

    // 获取累计提现
    const totalWithdrawnResult = await prisma.hostingWithdrawal.aggregate({
      where: {
        userId: user.id,
        status: 'completed'
      },
      _sum: { actualAmount: true }
    })

    // 获取待审核提现
    const pendingWithdrawalResult = await prisma.hostingWithdrawal.aggregate({
      where: {
        userId: user.id,
        status: 'pending'
      },
      _sum: { amount: true }
    })

    return {
      balance: {
        available: Number(userData?.hostingBalance || 0),
        frozen: Number(frozenResult._sum.amount || 0),
        pendingWithdrawal: Number(pendingWithdrawalResult._sum.amount || 0),
        totalIncome: Number(totalIncomeResult._sum.amount || 0),
        totalWithdrawn: Number(totalWithdrawnResult._sum.actualAmount || 0)
      },
      config: {
        minWithdrawalAmount: WITHDRAWAL_CONFIG.minAmount,
        feeRateBalance: WITHDRAWAL_CONFIG.feeRateBalance
      }
    }
  })

  // 获取托管余额日志
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      actionType?: string
      frozen?: string
      search?: string
    }
  }>('/logs', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; actionType?: string; frozen?: string; search?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '30', actionType, frozen, search } = request.query

    const safePageSize = parseClampedPositiveIntegerQuery(pageSize, 30, 100)
    const pageNum = parsePositiveIntegerQuery(page, 1)
    const skip = (pageNum - 1) * safePageSize

    // 构建基础查询条件
    const baseWhere: any = { userId: user.id }
    const safeActionType = normalizeHostingActionType(actionType)
    if (safeActionType) {
      baseWhere.actionType = safeActionType
    }
    if (frozen === 'true') {
      baseWhere.frozen = true
    } else if (frozen === 'false') {
      baseWhere.frozen = false
    }

    // 搜索条件处理：在数据库层面进行搜索，而非内存过滤
    let where: any = baseWhere

    const searchTerm = normalizeSearch(search, 128)
    if (searchTerm) {

      // 查找匹配搜索条件的实例 ID（限制在当前托管商的宿主机上）
      const matchedInstances = await prisma.instance.findMany({
        where: {
          host: { userId: user.id }, // 只搜索当前托管商宿主机上的实例
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { user: { username: { contains: searchTerm, mode: 'insensitive' } } },
            { user: { email: { contains: searchTerm, mode: 'insensitive' } } },
            { host: { name: { contains: searchTerm, mode: 'insensitive' } } },
            { package: { name: { contains: searchTerm, mode: 'insensitive' } } },
            { packagePlan: { name: { contains: searchTerm, mode: 'insensitive' } } }
          ]
        },
        select: { id: true }
      })
      const matchedInstanceIds = matchedInstances.map(i => i.id)

      // 构建搜索条件：remark 包含搜索词 OR relatedId 在匹配的实例 ID 中 OR 快照字段匹配
      where = {
        ...baseWhere,
        OR: [
          { remark: { contains: searchTerm, mode: 'insensitive' } },
          // 匹配现存实例
          ...(matchedInstanceIds.length > 0 ? [
            {
              type: { in: ['income', 'deduction'] },
              relatedId: { in: matchedInstanceIds }
            }
          ] : []),
          // 匹配快照字段（实例已删除的情况）
          { snapshotBuyerName: { contains: searchTerm, mode: 'insensitive' } },
          { snapshotBuyerEmail: { contains: searchTerm, mode: 'insensitive' } },
          { snapshotInstanceName: { contains: searchTerm, mode: 'insensitive' } }
        ]
      }
    }

    const [logs, total] = await Promise.all([
      prisma.hostingBalanceLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safePageSize,
        select: {
          id: true,
          type: true,
          actionType: true,
          amount: true,
          frozen: true,
          unfreezeAt: true,
          relatedId: true,
          remark: true,
          createdAt: true,
          // 快照字段
          snapshotBuyerName: true,
          snapshotBuyerEmail: true,
          snapshotBuyerAvatar: true,
          snapshotInstanceName: true,
          snapshotHostName: true,
          snapshotPackageName: true,
          snapshotPlanName: true
        }
      }),
      prisma.hostingBalanceLog.count({ where })
    ])

    // 收集所有实例ID（income/deduction 类型的 relatedId 是实例ID）
    const instanceIds = logs
      .filter(log => ['income', 'deduction'].includes(log.type) && log.relatedId)
      .map(log => log.relatedId!)

    // 批量查询实例及关联信息
    const instances = instanceIds.length > 0 ? await prisma.instance.findMany({
      where: { id: { in: instanceIds } },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        host: {
          select: {
            id: true,
            name: true
          }
        },
        package: {
          select: {
            id: true,
            name: true
          }
        },
        packagePlan: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }) : []

    // 构建实例ID到实例信息的映射
    const instanceMap = new Map(instances.map(i => [i.id, i]))

    return {
      logs: logs.map(log => {
        const instance = ['income', 'deduction'].includes(log.type) && log.relatedId
          ? instanceMap.get(log.relatedId)
          : null

        // 构建实例信息：优先使用实际实例，否则使用快照兜底
        let instanceData = null
        if (instance) {
          // 实例存在，使用实际数据
          instanceData = {
            id: instance.id,
            name: instance.name,
            deleted: false,
            buyer: {
              id: instance.user.id,
              username: instance.user.username,
              email: instance.user.email,
              avatarStyle: instance.user.avatarStyle,
              avatarBadgeId: instance.user.avatarBadgeId ?? null
            },
            host: {
              id: instance.host.id,
              name: instance.host.name
            },
            package: instance.package ? {
              id: instance.package.id,
              name: instance.package.name
            } : null,
            plan: instance.packagePlan ? {
              id: instance.packagePlan.id,
              name: instance.packagePlan.name
            } : null
          }
        } else if (['income', 'deduction'].includes(log.type) && log.relatedId) {
          // 实例已删除，使用快照兜底
          instanceData = {
            id: log.relatedId,
            name: log.snapshotInstanceName || '',
            deleted: true,
            buyer: {
              id: 0,
              username: log.snapshotBuyerName || '',
              email: log.snapshotBuyerEmail || null,
              avatarStyle: log.snapshotBuyerAvatar || 'bigSmile',
              avatarBadgeId: null
            },
            host: {
              id: 0,
              name: log.snapshotHostName || ''
            },
            package: log.snapshotPackageName ? {
              id: 0,
              name: log.snapshotPackageName
            } : null,
            plan: log.snapshotPlanName ? {
              id: 0,
              name: log.snapshotPlanName
            } : null
          }
        }

        return {
          id: log.id,
          type: log.type,
          actionType: log.actionType,
          amount: Number(log.amount),
          frozen: log.frozen,
          unfreezeAt: log.unfreezeAt?.toISOString() || null,
          relatedId: log.relatedId,
          remark: log.remark,
          createdAt: log.createdAt.toISOString(),
          // 关联的实例信息
          instance: instanceData
        }
      }),
      total,
      page: pageNum,
      pageSize: safePageSize
    }
  })

  // ==================== 提现申请 ====================

  // 申请提现（仅支持提现到面板余额）
  fastify.post<{
    Body: {
      amount: number
    }
  }>('/withdraw', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: WITHDRAWAL_CONFIG.minAmount }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { amount } = request.body

    // 验证提现金额
    if (amount < WITHDRAWAL_CONFIG.minAmount) {
      return reply.code(400).send({ 
        error: `最低提现金额为 ¥${WITHDRAWAL_CONFIG.minAmount}`,
        code: 'AMOUNT_TOO_LOW'
      })
    }

    // 计算手续费
    const feeRate = WITHDRAWAL_CONFIG.feeRateBalance
    const feeAmount = Number((amount * feeRate).toFixed(2))
    const actualAmount = amount - feeAmount

    let withdrawal: Awaited<ReturnType<typeof prisma.hostingWithdrawal.create>>
    try {
      // 执行事务
      withdrawal = await prisma.$transaction(async (tx) => {
        const locked = await tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, user.id)
        if (!locked) {
          throw new Error('托管余额正在处理，请稍后重试')
        }
        const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, user.id)
        if (!balanceLocked) {
          throw new Error('用户余额正在处理，请稍后重试')
        }

        // 扣减托管余额
        const deductResult = await tx.user.updateMany({
          where: {
            id: user.id,
            hostingBalance: { gte: amount }
          },
          data: { hostingBalance: { decrement: amount } }
        })
        if (deductResult.count === 0) {
          throw new Error('可用托管余额不足')
        }

        // 创建提现记录
        const record = await tx.hostingWithdrawal.create({
          data: {
            userId: user.id,
            amount,
            feeRate,
            feeAmount,
            actualAmount,
            target: 'balance',
            status: 'completed',
            processedAt: new Date()
          }
        })

        // 获取当前面板余额
        const currentUser = await tx.user.findUnique({
          where: { id: user.id },
          select: { balance: true }
        })
        const oldBalance = Number(currentUser?.balance || 0)

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { balance: { increment: actualAmount } },
          select: { balance: true }
        })
        const newBalance = Number(updatedUser.balance)

        // 记录面板余额日志
        await tx.balanceLog.create({
          data: {
            userId: user.id,
            type: 'hosting_withdraw',
            amount: actualAmount,
            balanceBefore: oldBalance,
            balanceAfter: newBalance,
            remark: `托管余额提现（手续费 ${feeRate * 100}%: ¥${feeAmount.toFixed(2)}）`
          }
        })

        // 记录托管余额日志
        await tx.hostingBalanceLog.create({
          data: {
            userId: user.id,
            type: 'withdraw',
            actionType: 'withdraw',
            amount: -amount,
            frozen: false,
            relatedId: record.id,
            remark: `提现到面板余额 ¥${actualAmount.toFixed(2)}（手续费 ¥${feeAmount.toFixed(2)}）`
          }
        })

        return record
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('正在处理')) {
        return reply.code(409).send({ error: message, code: 'HOSTING_BALANCE_BUSY' })
      }
      if (message.includes('余额不足')) {
        return reply.code(400).send({ error: message, code: 'INSUFFICIENT_BALANCE' })
      }
      throw error
    }

    await createLog(
      user.id,
      'hosting',
      'hosting.withdraw',
      `Withdrawal to balance: amount=${amount}, actualAmount=${actualAmount}`,
      'success'
    )

    return {
      message: '提现成功',
      withdrawal: {
        id: withdrawal.id,
        amount: Number(withdrawal.amount),
        feeRate: Number(withdrawal.feeRate),
        feeAmount: Number(withdrawal.feeAmount),
        actualAmount: Number(withdrawal.actualAmount),
        target: withdrawal.target,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt.toISOString()
      }
    }
  })

  // 获取提现记录
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      status?: string
    }
  }>('/withdrawals', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; status?: string } }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', status } = request.query

    const safePageSize = parseClampedPositiveIntegerQuery(pageSize, 20, 100)
    const pageNum = parsePositiveIntegerQuery(page, 1)
    const skip = (pageNum - 1) * safePageSize

    const where: any = { userId: user.id }
    const safeStatus = normalizeWithdrawalStatus(status)
    if (safeStatus) {
      where.status = safeStatus
    }

    const [records, total] = await Promise.all([
      prisma.hostingWithdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safePageSize
      }),
      prisma.hostingWithdrawal.count({ where })
    ])

    return {
      records: records.map(r => ({
        id: r.id,
        amount: Number(r.amount),
        feeRate: Number(r.feeRate),
        feeAmount: Number(r.feeAmount),
        actualAmount: Number(r.actualAmount),
        target: r.target,
        status: r.status,
        rejectReason: r.rejectReason,
        processedAt: r.processedAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString()
      })),
      total,
      page: pageNum,
      pageSize: safePageSize
    }
  })

  // ==================== 托管统计 ====================

  // 获取托管统计（我的节点收益概览）
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const { user } = request

    // 我托管的节点数量
    const myHostsCount = await prisma.host.count({
      where: { userId: user.id }
    })

    // 我托管的节点上的实例数量（排除已删除的实例）
    const instancesOnMyHosts = await prisma.instance.count({
      where: {
        host: { userId: user.id },
        status: { not: 'deleted' }
      }
    })

    // 统计独立客户数：在我节点上购买过实例的去重用户数
    const uniqueCustomerGroups = await prisma.instance.groupBy({
      by: ['userId'],
      where: {
        host: { userId: user.id },
        userId: { not: user.id } // 排除宿主机所有者自己
      }
    })
    const uniqueCustomersCount = uniqueCustomerGroups.length

    // 本月收入
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthIncome = await prisma.hostingBalanceLog.aggregate({
      where: {
        userId: user.id,
        type: 'income',
        createdAt: { gte: monthStart }
      },
      _sum: { amount: true }
    })

    // 累计托管总收入（用于VIP等级计算）
    const totalHostingIncome = await prisma.hostingBalanceLog.aggregate({
      where: {
        userId: user.id,
        type: 'income'
      },
      _sum: { amount: true }
    })

    // 获取最近的收入记录
    const recentIncome = await prisma.hostingBalanceLog.findMany({
      where: {
        userId: user.id,
        type: 'income'
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        amount: true,
        relatedId: true,
        remark: true,
        createdAt: true
      }
    })

    // 计算VIP等级（基于后台配置的托管 VIP 规则）
    const totalIncome = Number(totalHostingIncome._sum.amount || 0)
    const vipRules = await getVipRules('hosting')
    const vipLevel = calculateVipLevel('hosting', vipRules, {
      totalHostingIncome: totalIncome,
      instanceCount: instancesOnMyHosts
    })
    const vipBadgeStyle = getVipBadgeStyleForLevel(vipRules, 'hosting', vipLevel)

    return {
      stats: {
        myHostsCount,
        instancesOnMyHosts,
        uniqueCustomersCount,
        monthIncome: Number(monthIncome._sum.amount || 0),
        vipLevel,
        vipBadgeStyle
      },
      recentIncome: recentIncome.map(r => ({
        id: r.id,
        amount: Number(r.amount),
        instanceId: r.relatedId,
        remark: r.remark,
        createdAt: r.createdAt.toISOString()
      }))
    }
  })

}
