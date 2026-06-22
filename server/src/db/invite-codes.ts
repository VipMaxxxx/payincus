/**
 * 邀请码相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { InviteCode } from '../types/database.js'

function clampInvitePagination(page: number, pageSize: number): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20
  }
}

/**
 * 查找邀请码
 */
export async function findInviteCode(code: string): Promise<InviteCode | null> {
  const inviteCode = await prisma.inviteCode.findFirst({
    where: {
      code,
      usedBy: null
    }
  })
  
  if (!inviteCode) return null
  
  return {
    id: inviteCode.id,
    code: inviteCode.code,
    created_by: inviteCode.createdBy,
    used_by: inviteCode.usedBy,
    used_at: inviteCode.usedAt?.toISOString() ?? null,
    expires_at: inviteCode.expiresAt?.toISOString() ?? null,
    cost_snapshot: inviteCode.costSnapshot ?? null,
    created_at: inviteCode.createdAt.toISOString()
  }
}

/**
 * 创建邀请码
 */
export async function createInviteCode(
  code: string,
  createdBy: number,
  expiresAt: string | null = null
): Promise<number> {
  const inviteCode = await prisma.inviteCode.create({
    data: {
      code,
      createdBy,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    }
  })
  
  return inviteCode.id
}

/**
 * 使用邀请码
 */
export async function useInviteCode(code: string, userId: number): Promise<void> {
  await prisma.inviteCode.updateMany({
    where: { code },
    data: {
      usedBy: userId,
      usedAt: new Date()
    }
  })
}

/**
 * 获取邀请码列表
 */
export async function getInviteCodes(createdBy: number | null = null): Promise<InviteCode[]> {
  const inviteCodes = await prisma.inviteCode.findMany({
    where: createdBy ? { createdBy } : undefined,
    orderBy: {
      id: 'desc'
    }
  })
  
  return inviteCodes.map(ic => ({
    id: ic.id,
    code: ic.code,
    created_by: ic.createdBy,
    used_by: ic.usedBy,
    used_at: ic.usedAt?.toISOString() ?? null,
    expires_at: ic.expiresAt?.toISOString() ?? null,
    cost_snapshot: ic.costSnapshot ?? null,
    created_at: ic.createdAt.toISOString()
  }))
}

/**
 * 获取邀请码列表（包含用户信息）
 */
export async function getInviteCodesWithUsers(
  page: number,
  pageSize: number,
  status?: 'used' | 'unused'
): Promise<{
  invites: Array<InviteCode & {
    usedByUsername?: string
    usedByEmail?: string | null
    usedByAvatarStyle?: string
    createdByUsername?: string
    createdByEmail?: string | null
    createdByAvatarStyle?: string
  }>
  total: number
}> {
  const where = status === 'used'
    ? { usedBy: { not: null } }
    : status === 'unused'
      ? { usedBy: null }
      : undefined
  const pagination = clampInvitePagination(page, pageSize)

  const [total, inviteCodes] = await Promise.all([
    prisma.inviteCode.count({ where }),
    prisma.inviteCode.findMany({
      where,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        creator: {
          select: {
            username: true,
            email: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        }
      },
      orderBy: {
        id: 'desc'
      }
    })
  ])
  
  return {
    invites: inviteCodes.map(ic => ({
      id: ic.id,
      code: ic.code,
      created_by: ic.createdBy,
      used_by: ic.usedBy,
      used_at: ic.usedAt?.toISOString() ?? null,
      expires_at: ic.expiresAt?.toISOString() ?? null,
      cost_snapshot: ic.costSnapshot ?? null,
      created_at: ic.createdAt.toISOString(),
      usedByUsername: ic.user?.username,
      usedByEmail: ic.user?.email ?? null,
      usedByAvatarStyle: ic.user?.avatarStyle,
      usedByAvatarBadgeId: ic.user?.avatarBadgeId ?? null,
      createdByUsername: ic.creator.username,
      createdByEmail: ic.creator.email ?? null,
      createdByAvatarStyle: ic.creator.avatarStyle,
      createdByAvatarBadgeId: ic.creator.avatarBadgeId ?? null
    })),
    total
  }
}

/**
 * 获取用户的邀请码列表（包含用户信息）
 */
export async function getUserInviteCodesWithUsers(
  userId: number,
  page: number,
  pageSize: number
): Promise<{
  invites: Array<InviteCode & {
    usedByUsername?: string
    usedByEmail?: string | null
    usedByAvatarStyle?: string
  }>
  total: number
}> {
  const pagination = clampInvitePagination(page, pageSize)

  const [total, inviteCodes] = await Promise.all([
    prisma.inviteCode.count({
      where: {
        createdBy: userId
      }
    }),
    prisma.inviteCode.findMany({
      where: {
        createdBy: userId
      },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        }
      },
      orderBy: {
        id: 'desc'
      }
    })
  ])
  
  return {
    invites: inviteCodes.map(ic => ({
      id: ic.id,
      code: ic.code,
      created_by: ic.createdBy,
      used_by: ic.usedBy,
      used_at: ic.usedAt?.toISOString() ?? null,
      expires_at: ic.expiresAt?.toISOString() ?? null,
      cost_snapshot: ic.costSnapshot ?? null,
      created_at: ic.createdAt.toISOString(),
      usedByUsername: ic.user?.username,
      usedByEmail: ic.user?.email ?? null,
      usedByAvatarStyle: ic.user?.avatarStyle,
      usedByAvatarBadgeId: ic.user?.avatarBadgeId ?? null
    })),
    total
  }
}

/**
 * 获取用户邀请码统计信息
 */
export async function getUserInviteCodeStats(userId: number): Promise<{
  total: number
  used: number
  unused: number
  usageRate: number
}> {
  const [total, used] = await Promise.all([
    prisma.inviteCode.count({
      where: { createdBy: userId }
    }),
    prisma.inviteCode.count({
      where: {
        createdBy: userId,
        usedBy: { not: null }
      }
    })
  ])
  
  const unused = total - used
  const usageRate = total > 0 ? (used / total) * 100 : 0
  
  return {
    total,
    used,
    unused,
    usageRate
  }
}

/**
 * 根据 ID 获取邀请码
 */
export async function getInviteCodeById(id: number): Promise<InviteCode | null> {
  const inviteCode = await prisma.inviteCode.findUnique({
    where: { id }
  })
  
  if (!inviteCode) return null
  
  return {
    id: inviteCode.id,
    code: inviteCode.code,
    created_by: inviteCode.createdBy,
    used_by: inviteCode.usedBy,
    used_at: inviteCode.usedAt?.toISOString() ?? null,
    expires_at: inviteCode.expiresAt?.toISOString() ?? null,
    cost_snapshot: inviteCode.costSnapshot ?? null,
    created_at: inviteCode.createdAt.toISOString()
  }
}

/**
 * 删除邀请码（允许删除已使用的）
 */
export async function deleteInviteCode(id: number): Promise<void> {
  await prisma.inviteCode.delete({
    where: { id }
  })
}

/**
 * 检查用户是否可以生成邀请码
 * 规则：当已生成的邀请码个数大于10个且注册使用率不足80%时，不允许再生成
 */
export async function canUserGenerateInviteCode(userId: number): Promise<{ allowed: boolean; reason?: string }> {
  const stats = await getUserInviteCodeStats(userId)
  
  // 如果邀请码数量 <= 10，允许生成
  if (stats.total <= 10) {
    return { allowed: true }
  }
  
  // 如果使用率 >= 80%，允许生成
  if (stats.usageRate >= 80) {
    return { allowed: true }
  }
  
  // 否则不允许生成
  return {
    allowed: false,
    reason: `邀请码使用率小于80%，无法创建更多邀请码。您已有 ${stats.total} 个邀请码，使用率为 ${stats.usageRate.toFixed(1)}%，需要达到 80% 才能继续生成`
  }
}
