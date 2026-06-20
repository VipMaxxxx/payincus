/**
 * 站内信数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Prisma } from '@prisma/client'

export interface CreateInboxMessageData {
  userId: number
  eventType: string
  title: string
  content: string
  data?: Record<string, unknown>
}

export interface InboxMessage {
  id: number
  userId: number
  eventType: string
  title: string
  content: string
  isRead: boolean
  data: Record<string, unknown> | null
  createdAt: string
}

export interface PaginatedInboxMessages {
  messages: InboxMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface HostNotificationRecipient {
  userId: number
  username: string
  email: string | null
}

/**
 * 创建站内信
 */
export async function createInboxMessage(data: CreateInboxMessageData): Promise<number> {
  const message = await prisma.inboxMessage.create({
    data: {
      userId: data.userId,
      eventType: data.eventType,
      title: data.title,
      content: data.content,
      data: data.data as Prisma.InputJsonValue | undefined
    },
    select: { id: true }
  })
  return message.id
}

/**
 * 获取用户站内信列表（分页）
 */
export async function getInboxMessages(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    isRead?: boolean
  } = {}
): Promise<PaginatedInboxMessages> {
  // 分页参数边界验证
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20))
  const skip = (page - 1) * pageSize

  const where = {
    userId,
    ...(options.isRead !== undefined ? { isRead: options.isRead } : {})
  }

  const [messages, total] = await Promise.all([
    prisma.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.inboxMessage.count({ where })
  ])

  return {
    messages: messages.map(msg => ({
      id: msg.id,
      userId: msg.userId,
      eventType: msg.eventType,
      title: msg.title,
      content: msg.content,
      isRead: msg.isRead,
      data: msg.data as Record<string, unknown> | null,
      createdAt: msg.createdAt.toISOString()
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取用户未读消息数量
 */
export async function getUnreadCount(userId: number): Promise<number> {
  return prisma.inboxMessage.count({
    where: {
      userId,
      isRead: false
    }
  })
}

/**
 * 标记单条消息为已读
 * 返回是否成功（消息存在且属于该用户）
 */
export async function markAsRead(id: number, userId: number): Promise<boolean> {
  const result = await prisma.inboxMessage.updateMany({
    where: {
      id,
      userId
    },
    data: {
      isRead: true
    }
  })
  return result.count > 0
}

/**
 * 标记用户所有消息为已读
 * 返回更新的消息数量
 */
export async function markAllAsRead(userId: number): Promise<number> {
  const result = await prisma.inboxMessage.updateMany({
    where: {
      userId,
      isRead: false
    },
    data: {
      isRead: true
    }
  })
  return result.count
}

/**
 * 删除单条消息
 * 返回是否成功（消息存在且属于该用户）
 */
export async function deleteMessage(id: number, userId: number): Promise<boolean> {
  const result = await prisma.inboxMessage.deleteMany({
    where: {
      id,
      userId
    }
  })
  return result.count > 0
}

/**
 * 删除用户所有已读消息
 * 返回删除的消息数量
 */
export async function deleteReadMessages(userId: number): Promise<number> {
  const result = await prisma.inboxMessage.deleteMany({
    where: {
      userId,
      isRead: true
    }
  })
  return result.count
}

/**
 * 清理指定天数前的旧消息
 * 用于定时任务
 * 返回删除的消息数量
 */
export async function cleanupOldMessages(daysToKeep: number = 30): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  const result = await prisma.inboxMessage.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate
      }
    }
  })
  return result.count
}

/**
 * 获取单条消息详情
 */
export async function getMessageById(id: number, userId: number): Promise<InboxMessage | null> {
  const msg = await prisma.inboxMessage.findFirst({
    where: {
      id,
      userId
    }
  })

  if (!msg) return null

  return {
    id: msg.id,
    userId: msg.userId,
    eventType: msg.eventType,
    title: msg.title,
    content: msg.content,
    isRead: msg.isRead,
    data: msg.data as Record<string, unknown> | null,
    createdAt: msg.createdAt.toISOString()
  }
}

/**
 * 批量创建站内信（发送给多个用户）
 * @returns 创建的消息数量
 */
export async function createBulkMessages(data: {
  userIds: number[]
  eventType: string
  title: string
  content: string
  data?: Record<string, unknown>
}): Promise<number> {
  if (data.userIds.length === 0) return 0

  const result = await prisma.inboxMessage.createMany({
    data: data.userIds.map(userId => ({
      userId,
      eventType: data.eventType,
      title: data.title,
      content: data.content,
      data: data.data as Prisma.InputJsonValue | undefined
    }))
  })

  return result.count
}

/**
 * 获取所有活跃用户ID（用于发送全站通知）
 */
export async function getAllActiveUserIds(): Promise<number[]> {
  const users = await prisma.user.findMany({
    where: {
      status: 'active'
    },
    select: {
      id: true
    }
  })

  return users.map(u => u.id)
}

/**
 * 获取某个宿主机下所有实例用户的ID（去重）
 */
export async function getUniqueUserIdsByHostId(hostId: number): Promise<number[]> {
  const instances = await prisma.instance.findMany({
    where: {
      hostId,
      status: { not: 'deleted' }
    },
    select: {
      userId: true
    },
    distinct: ['userId']
  })

  return instances.map(inst => inst.userId)
}

/**
 * 获取指定实例ID列表中的用户ID（去重，且必须属于指定宿主机）
 */
export async function getUniqueUserIdsByInstanceIds(hostId: number, instanceIds: number[]): Promise<number[]> {
  const instances = await prisma.instance.findMany({
    where: {
      id: { in: instanceIds },
      hostId,
      status: { not: 'deleted' }
    },
    select: {
      userId: true
    },
    distinct: ['userId']
  })

  return instances.map(inst => inst.userId)
}

/**
 * 获取宿主机通知的目标用户（去重），包含用户名和邮箱
 */
export async function getUniqueRecipientsByHostId(
  hostId: number,
  instanceIds?: number[]
): Promise<HostNotificationRecipient[]> {
  const instances = await prisma.instance.findMany({
    where: {
      hostId,
      status: { not: 'deleted' },
      ...(instanceIds && instanceIds.length > 0 ? { id: { in: instanceIds } } : {})
    },
    select: {
      userId: true,
      user: {
        select: {
          username: true,
          email: true
        }
      }
    },
    distinct: ['userId'],
    orderBy: {
      userId: 'asc'
    }
  })

  return instances.map((instance) => ({
    userId: instance.userId,
    username: instance.user.username,
    email: instance.user.email
  }))
}
