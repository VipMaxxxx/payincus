/**
 * 用户相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Prisma } from '@prisma/client'
import type { User, UserQuota } from '../types/database.js'
import {
  USER_BALANCE_LOCK_NAMESPACE,
  USER_EMAIL_REGISTRATION_LOCK_NAMESPACE,
  advisoryTransactionLockString,
  tryAdvisoryTransactionLock
} from './advisory-locks.js'

const MAX_REGISTER_GIFT_BALANCE = 99999999.99
const MAX_REGISTER_GIFT_POINTS = 2147483647

export interface RegisterGiftResult {
  balanceAmount: number
  pointsAmount: number
  newBalance: number
  newPoints: number
}

export interface CreateRegisteredUserResult {
  userId: number
  registerGift: RegisterGiftResult | null
}

/**
 * 根据用户名查找用户
 */
export async function findUserByUsername(username: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { username }
  })

  if (!user) return null

  // 转换 Prisma 类型到接口类型
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    password_hash: user.passwordHash,
    role: user.role,
    status: user.status,
    ban_reason: user.banReason,
    avatar_style: user.avatarStyle,
    avatar_badge_id: user.avatarBadgeId,
    has_created_host_before: user.hasCreatedHostBefore,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString()
  }
}

/**
 * 根据用户名或邮箱查找用户（用于登录）
 */
export async function findUserByUsernameOrEmail(identifier: string): Promise<User | null> {
  // 先尝试通过用户名查找
  const userByUsername = await prisma.user.findUnique({
    where: { username: identifier }
  })

  if (userByUsername) {
    return {
      id: userByUsername.id,
      username: userByUsername.username,
      email: userByUsername.email,
      password_hash: userByUsername.passwordHash,
      role: userByUsername.role,
      status: userByUsername.status,
      ban_reason: userByUsername.banReason,
      avatar_style: userByUsername.avatarStyle,
      avatar_badge_id: userByUsername.avatarBadgeId,
      has_created_host_before: userByUsername.hasCreatedHostBefore,
      created_at: userByUsername.createdAt.toISOString(),
      updated_at: userByUsername.updatedAt.toISOString()
    }
  }

  // 如果用户名查找失败，尝试通过邮箱查找
  // 使用大小写不敏感匹配，兼容旧数据中可能存在的混合大小写邮箱
  // 注意：虽然email字段没有unique约束，但注册时已检查邮箱唯一性，理论上不应该有重复
  // 使用findFirst以防万一，如果真的有重复，返回第一个匹配的用户
  const normalizedIdentifier = identifier.trim()
  const userByEmail = await prisma.user.findFirst({
    where: { 
      email: {
        equals: normalizedIdentifier,
        mode: 'insensitive'  // 大小写不敏感匹配
      }
    }
  })

  if (!userByEmail) return null

  // 转换 Prisma 类型到接口类型
  return {
    id: userByEmail.id,
    username: userByEmail.username,
    email: userByEmail.email,
    password_hash: userByEmail.passwordHash,
    role: userByEmail.role,
    status: userByEmail.status,
    ban_reason: userByEmail.banReason,
    avatar_style: userByEmail.avatarStyle,
    avatar_badge_id: userByEmail.avatarBadgeId,
    has_created_host_before: userByEmail.hasCreatedHostBefore,
    created_at: userByEmail.createdAt.toISOString(),
    updated_at: userByEmail.updatedAt.toISOString()
  }
}

/**
 * 根据 ID 查找用户
 */
export async function findUserById(id: number): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id }
  })

  if (!user) return null

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    password_hash: user.passwordHash,
    role: user.role,
    status: user.status,
    ban_reason: user.banReason,
    avatar_style: user.avatarStyle,
    avatar_badge_id: user.avatarBadgeId,
    has_created_host_before: user.hasCreatedHostBefore,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString()
  }
}

/**
 * 根据邮箱查找用户
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = email.trim()
  // 使用大小写不敏感匹配，兼容旧数据中可能存在的混合大小写邮箱
  const user = await prisma.user.findFirst({
    where: { 
      email: {
        equals: normalizedEmail,
        mode: 'insensitive'
      }
    }
  })

  if (!user) return null

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    password_hash: user.passwordHash,
    role: user.role,
    status: user.status,
    ban_reason: user.banReason,
    avatar_style: user.avatarStyle,
    avatar_badge_id: user.avatarBadgeId,
    has_created_host_before: user.hasCreatedHostBefore,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString()
  }
}

// 可用的头像风格
const AVATAR_STYLES = [
  'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
  'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
  'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
  'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
  'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
  'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
] as const

/**
 * 创建用户
 */
export async function createUser(
  username: string,
  email: string | null,
  passwordHash: string,
  role: 'admin' | 'user' = 'user'
): Promise<number> {
  // 从系统配置获取默认配额
  const { getDefaultQuotaConfig } = await import('./system-config.js')
  const defaultQuota = await getDefaultQuotaConfig()

  // 随机选择头像风格
  const avatarStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)]

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role,
      avatarStyle,
      quota: {
        create: {
          hostLimit: defaultQuota.hostLimit,
          friendLimit: defaultQuota.friendLimit,
          packageLimit: defaultQuota.packageLimit
        }
      }
    }
  })

  return user.id
}

async function getFreeSiteRegisterGiftConfig(): Promise<{
  balanceAmount: number
  pointsAmount: number
} | null> {
  const {
    getSystemConfigBoolean,
    getSystemConfigFloat,
    getSystemConfigNumber
  } = await import('./system-config.js')

  const [freeSiteMode, giftEnabled] = await Promise.all([
    getSystemConfigBoolean('free_site_mode', false),
    getSystemConfigBoolean('free_site_register_gift_enabled', false)
  ])

  if (!freeSiteMode || !giftEnabled) {
    return null
  }

  const [rawBalanceAmount, rawPointsAmount] = await Promise.all([
    getSystemConfigFloat('free_site_register_gift_balance', 0),
    getSystemConfigNumber('free_site_register_gift_points', 0)
  ])
  const balanceAmount = Math.min(
    MAX_REGISTER_GIFT_BALANCE,
    Math.max(0, Math.round(rawBalanceAmount * 100) / 100)
  )
  const pointsAmount = Math.min(
    MAX_REGISTER_GIFT_POINTS,
    Math.max(0, Math.floor(rawPointsAmount))
  )

  if (balanceAmount <= 0 && pointsAmount <= 0) {
    return null
  }

  return { balanceAmount, pointsAmount }
}

function buildRegisterGiftMessage(gift: RegisterGiftResult): { summary: string; content: string } {
  const giftParts: string[] = []
  if (gift.balanceAmount > 0) {
    giftParts.push(`余额 ¥${gift.balanceAmount.toFixed(2)}`)
  }
  if (gift.pointsAmount > 0) {
    giftParts.push(`${gift.pointsAmount} 积分`)
  }

  const summary = giftParts.join(' + ')
  const arrivalLabel = giftParts.length > 1 ? '余额和积分' : giftParts[0] || '白嫖补给'

  return {
    summary,
    content: `欢迎加入白嫖站！系统已经把 ${summary} 塞进你的账户背包，${arrivalLabel}到账了。快去逛逛能薅点什么，优雅白嫖，从注册成功这一刻开始。`
  }
}

async function applyFreeSiteRegisterGiftInTransaction(
  tx: Prisma.TransactionClient,
  userId: number,
  giftConfig: { balanceAmount: number; pointsAmount: number }
): Promise<RegisterGiftResult> {
  const { balanceAmount, pointsAmount } = giftConfig
  let newBalance = 0
  let newPoints = 0

  if (balanceAmount > 0) {
    const balanceLocked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
    if (!balanceLocked) {
      throw new Error('余额正在处理，请稍后重试')
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })

    if (!user) {
      throw new Error('用户不存在')
    }

    const balanceBefore = Number(user.balance)

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: balanceAmount } },
      select: { balance: true }
    })
    const balanceAfter = Number(updatedUser.balance)

    await tx.balanceLog.create({
      data: {
        userId,
        type: 'gift',
        amount: balanceAmount,
        balanceBefore,
        balanceAfter,
        remark: '白嫖站注册自动赠送：白嫖启动资金'
      }
    })

    newBalance = balanceAfter
  } else {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    newBalance = user ? Number(user.balance) : 0
  }

  if (pointsAmount > 0) {
    const userPoints = await tx.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })

    const updatedPoints = await tx.userPoints.update({
      where: { userId },
      data: {
        points: { increment: pointsAmount },
        totalEarned: { increment: pointsAmount }
      }
    })

    await tx.pointsLog.create({
      data: {
        userId,
        type: 'admin_adjust',
        amount: pointsAmount,
        pointsBefore: userPoints.points,
        pointsAfter: updatedPoints.points,
        remark: '白嫖站注册自动赠送：白嫖能量包'
      }
    })

    newPoints = updatedPoints.points
  } else {
    const userPoints = await tx.userPoints.findUnique({ where: { userId } })
    newPoints = userPoints?.points ?? 0
  }

  const gift = {
    balanceAmount,
    pointsAmount,
    newBalance,
    newPoints
  }
  const message = buildRegisterGiftMessage(gift)

  await tx.inboxMessage.create({
    data: {
      userId,
      eventType: 'free_site_register_gift',
      title: '白嫖补给到账啦',
      content: message.content,
      data: {
        balanceAmount,
        pointsAmount,
        newBalance,
        newPoints
      }
    }
  })

  return gift
}

export async function createRegisteredUser(
  input: {
    username: string
    email: string | null
    passwordHash: string
    inviteCode?: string
  }
): Promise<CreateRegisteredUserResult> {
  const { getDefaultQuotaConfig } = await import('./system-config.js')
  const [defaultQuota, giftConfig] = await Promise.all([
    getDefaultQuotaConfig(),
    getFreeSiteRegisterGiftConfig()
  ])
  const avatarStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)]
  const normalizedEmail = input.email?.toLowerCase().trim() || null

  try {
    return await prisma.$transaction(async (tx) => {
      if (normalizedEmail) {
        await advisoryTransactionLockString(tx, USER_EMAIL_REGISTRATION_LOCK_NAMESPACE, normalizedEmail)
      }

      const existingUsername = await tx.user.findUnique({
        where: { username: input.username },
        select: { id: true }
      })
      if (existingUsername) {
        throw new Error('USER_EXISTS')
      }

      if (normalizedEmail) {
        const existingEmail = await tx.user.findFirst({
          where: {
            email: {
              equals: normalizedEmail,
              mode: 'insensitive'
            }
          },
          select: { id: true }
        })
        if (existingEmail) {
          throw new Error('EMAIL_ALREADY_REGISTERED')
        }
      }

      const user = await tx.user.create({
        data: {
          username: input.username,
          email: normalizedEmail,
          passwordHash: input.passwordHash,
          role: 'user',
          avatarStyle,
          quota: {
            create: {
              hostLimit: defaultQuota.hostLimit,
              friendLimit: defaultQuota.friendLimit,
              packageLimit: defaultQuota.packageLimit
            }
          }
        }
      })

      if (input.inviteCode) {
        const inviteUpdate = await tx.inviteCode.updateMany({
          where: {
            code: input.inviteCode,
            usedBy: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } }
            ]
          },
          data: {
            usedBy: user.id,
            usedAt: new Date()
          }
        })

        if (inviteUpdate.count !== 1) {
          throw new Error('INVITE_CODE_UNAVAILABLE')
        }
      }

      const registerGift = giftConfig
        ? await applyFreeSiteRegisterGiftInTransaction(tx, user.id, giftConfig)
        : null

      return {
        userId: user.id,
        registerGift
      }
    })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      throw new Error('USER_EXISTS')
    }
    throw error
  }
}

/**
 * 获取所有用户
 */
export async function getAllUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      banReason: true,
      avatarStyle: true,
      avatarBadgeId: true,
      createdAt: true
    },
    orderBy: {
      id: 'asc'
    }
  })

  return users.map(user => ({
    id: user.id,
    username: user.username,
    email: user.email,
    password_hash: '', // 不返回密码哈希
    role: user.role,
    status: user.status,
    ban_reason: user.banReason,
    avatar_style: user.avatarStyle,
    avatar_badge_id: user.avatarBadgeId,
    created_at: user.createdAt.toISOString(),
    updated_at: user.createdAt.toISOString() // 这里没有 updatedAt，使用 createdAt
  }))
}

/**
 * 获取所有用户及其配额
 */
export async function getAllUsersWithQuota(): Promise<Array<User & Partial<UserQuota>>> {
  const users = await prisma.user.findMany({
    include: {
      quota: true
    },
    orderBy: {
      id: 'asc'
    }
  })

  return users.map(user => {
    const base: User = {
      id: user.id,
      username: user.username,
      email: user.email,
      password_hash: '', // 不返回密码哈希
      role: user.role,
      status: user.status,
      ban_reason: user.banReason,
      avatar_style: user.avatarStyle,
      avatar_badge_id: user.avatarBadgeId,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString()
    }

    if (user.quota) {
      return {
        ...base,
        host_limit: user.quota.hostLimit,
        host_used: user.quota.hostUsed,
        friend_limit: user.quota.friendLimit,
        friend_used: user.quota.friendUsed,
        package_limit: user.quota.packageLimit,
        package_used: user.quota.packageUsed
      }
    }

    return base
  })
}

/**
 * 获取用户配额
 */
export async function getUserQuota(userId: number): Promise<UserQuota | null> {
  const quota = await prisma.userQuota.findUnique({
    where: { userId }
  })

  if (!quota) return null

  return {
    id: quota.id,
    user_id: quota.userId,
    host_limit: quota.hostLimit,
    host_used: quota.hostUsed,
    friend_limit: quota.friendLimit,
    friend_used: quota.friendUsed,
    package_limit: quota.packageLimit,
    package_used: quota.packageUsed,
    monthly_traffic_limit: quota.monthlyTrafficLimit,
    monthly_traffic_used: quota.monthlyTrafficUsed,
    extra_traffic_quota: quota.extraTrafficQuota,
    traffic_status: quota.trafficStatus
  }
}

/**
 * 创建用户配额（新配额系统）
 */
export async function createUserQuota(userId: number, data: {
  hostLimit?: number
  friendLimit?: number
  packageLimit?: number
}): Promise<void> {
  await prisma.userQuota.create({
    data: {
      userId,
      hostLimit: data.hostLimit ?? 0,
      friendLimit: data.friendLimit ?? 0,
      packageLimit: data.packageLimit ?? 0
    }
  })
}

/**
 * 更新用户配额限制（新配额系统）
 */
export async function updateUserQuotaLimits(userId: number, data: {
  hostLimit?: number
  friendLimit?: number
  packageLimit?: number
}): Promise<void> {
  // 构建更新数据对象，只包含定义的字段
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  const updateData: {
    hostLimit?: number
    friendLimit?: number
    packageLimit?: number
  } = {}

  if (data.hostLimit !== undefined) updateData.hostLimit = data.hostLimit
  if (data.friendLimit !== undefined) updateData.friendLimit = data.friendLimit
  if (data.packageLimit !== undefined) updateData.packageLimit = data.packageLimit

  if (Object.keys(updateData).length === 0) return

  await prisma.userQuota.update({
    where: { userId },
    data: updateData
  })
}

/**
 * 更新用户信息
 */
export async function updateUser(id: number, data: {
  email?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'banned'
  passwordHash?: string
  avatarStyle?: string
}): Promise<void> {
  const updateData: {
    email?: string
    role?: 'admin' | 'user'
    status?: 'active' | 'banned'
    passwordHash?: string
    avatarStyle?: string
  } = {}

  if (data.email !== undefined) updateData.email = data.email
  if (data.role !== undefined) updateData.role = data.role
  if (data.status !== undefined) updateData.status = data.status
  if (data.passwordHash !== undefined) updateData.passwordHash = data.passwordHash
  if (data.avatarStyle !== undefined) updateData.avatarStyle = data.avatarStyle

  if (Object.keys(updateData).length === 0) return

  await prisma.user.update({
    where: { id },
    data: updateData
  })
}

/**
 * 更新用户状态
 * @param banReason 封禁原因（仅当 status='banned' 时有意义）
 */
export async function updateUserStatus(id: number, status: 'active' | 'banned', banReason?: string): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: {
      status,
      // 封禁时保存原因，解封时清除原因
      banReason: status === 'banned' ? (banReason || null) : null
    }
  })
}

/**
 * 删除用户
 */
export async function deleteUser(id: number): Promise<void> {
  await prisma.user.delete({
    where: { id }
  })
}


// ==================== 2FA 相关操作 ====================

/**
 * 获取用户 2FA 状态
 */
export async function getUser2FAStatus(userId: number): Promise<{ enabled: boolean; hasSecret: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      twoFactorSecret: true
    }
  })

  if (!user) {
    return { enabled: false, hasSecret: false }
  }

  return {
    enabled: user.twoFactorEnabled,
    hasSecret: !!user.twoFactorSecret
  }
}

/**
 * 保存 2FA 密钥 (启用前的临时保存)
 */
export async function save2FASecret(userId: number, secret: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret }
  })
}

/**
 * 启用 2FA
 */
export async function enable2FA(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true }
  })
}

/**
 * 禁用 2FA
 */
export async function disable2FA(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null
    }
  })
}

/**
 * 获取用户 2FA 密钥
 */
export async function get2FASecret(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true }
  })

  return user?.twoFactorSecret ?? null
}

/**
 * 检查用户是否启用了 2FA
 */
export async function is2FAEnabled(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true }
  })

  return user?.twoFactorEnabled ?? false
}

/**
 * 保存 2FA 恢复码
 */
export async function save2FARecoveryCodes(userId: number, encryptedCodes: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorRecoveryCodes: encryptedCodes }
  })
}

/**
 * 获取 2FA 恢复码
 */
export async function get2FARecoveryCodes(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorRecoveryCodes: true }
  })

  return user?.twoFactorRecoveryCodes ?? null
}

/**
 * 启用 2FA 并保存恢复码
 */
export async function enable2FAWithRecoveryCodes(userId: number, encryptedCodes: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorRecoveryCodes: encryptedCodes
    }
  })
}

/**
 * 禁用 2FA (清除所有2FA数据)
 */
export async function disable2FAComplete(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: null
    }
  })
}

/**
 * 获取所有管理员用户的 ID
 * 用于工单系统等需要通知所有管理员的场景
 */
export async function getAllAdminUserIds(): Promise<number[]> {
  const admins = await prisma.user.findMany({
    where: {
      role: 'admin',
      status: 'active'
    },
    select: {
      id: true
    }
  })

  return admins.map(admin => admin.id)
}
