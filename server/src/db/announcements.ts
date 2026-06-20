/**
 * 公告/通知历史记录数据库操作
 */

import { prisma } from './index.js'
import type { AnnouncementType, Prisma } from '@prisma/client'

/**
 * 创建公告记录
 */
export async function createAnnouncement(data: {
  type: AnnouncementType
  senderId: number
  title: string
  content: string
  recipientCount: number
  hostId?: number
  targetUserId?: number
  instanceId?: number
}) {
  return prisma.announcement.create({
    data: {
      type: data.type,
      senderId: data.senderId,
      title: data.title,
      content: data.content,
      recipientCount: data.recipientCount,
      hostId: data.hostId,
      targetUserId: data.targetUserId,
      instanceId: data.instanceId,
    },
  })
}

/**
 * 获取公告历史列表（管理员）
 */
export async function getAnnouncementList(options: {
  page?: number
  pageSize?: number
  type?: AnnouncementType
  senderId?: number
}) {
  const { page = 1, pageSize = 20, type, senderId } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.AnnouncementWhereInput = {}
  if (type) where.type = type
  if (senderId) where.senderId = senderId

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        recipientCount: true,
        hostId: true,
        targetUserId: true,
        instanceId: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
        host: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.announcement.count({ where }),
  ])

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/**
 * 获取宿主机所有者的公告历史
 */
export async function getHostOwnerAnnouncementList(
  senderId: number,
  options: {
    page?: number
    pageSize?: number
    hostId?: number
  }
) {
  const { page = 1, pageSize = 20, hostId } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.AnnouncementWhereInput = {
    senderId,
    type: { in: ['host_broadcast', 'host_message'] },
  }
  if (hostId) where.hostId = hostId

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        recipientCount: true,
        hostId: true,
        targetUserId: true,
        instanceId: true,
        createdAt: true,
        host: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.announcement.count({ where }),
  ])

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/**
 * 获取公告详情
 */
export async function getAnnouncementById(id: number) {
  return prisma.announcement.findUnique({
    where: { id },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
        },
      },
      host: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })
}
