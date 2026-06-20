/**
 * 工单系统数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { TicketStatus, TicketPriority } from '@prisma/client'

// ==================== 类型定义 ====================

export interface CreateTicketData {
  userId: number
  hostId?: number | null  // 可选：不选实例时为 null，工单直接发给管理员
  instanceId?: number | null
  subject: string
  category?: string
  priority?: TicketPriority
  content: string  // 首条消息内容
  attachments?: CreateTicketMessageAttachmentData[]
}

export interface CreateTicketMessageAttachmentData {
  provider: string
  providerVersion: string
  providerFileId?: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width?: number | null
  height?: number | null
  url: string
  thumbnailUrl?: string | null
}

export interface TicketWithDetails {
  id: number
  userId: number
  hostId: number | null  // 可为 null，表示直接发给管理员
  instanceId: number | null
  subject: string
  category: string
  priority: TicketPriority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  closedAt: string | null
  user: {
    id: number
    username: string
    avatarStyle: string
    avatarBadgeId: string | null
  }
  host: {
    id: number
    name: string
    userId: number
    countryCode: string
  } | null  // 可为 null
  instance: {
    id: number
    name: string
    status: string
    iconBadgeId?: string | null
    incusId?: string | null
    ipv4?: string | null
    ipv6?: string | null
    cpu?: number
    memory?: number
    disk?: number
    image?: string
    imageName?: string | null  // 镜像显示名称
    packageName?: string | null
  } | null
  messageCount: number
  lastMessage?: {
    content: string
    isFromOwner: boolean
    createdAt: string
  } | null
}

export interface TicketMessage {
  id: number
  ticketId: number
  senderId: number
  content: string
  isFromOwner: boolean
  createdAt: string
  attachments: TicketMessageAttachment[]
  sender: {
    id: number
    username: string
    avatarStyle: string
    avatarBadgeId: string | null
  }
}

export interface TicketMessageAttachment {
  id: number
  ticketId: number
  messageId: number
  uploaderId: number
  provider: string
  providerVersion: string
  providerFileId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
}

// 扩展的工单详情（包含 needsReply 字段）
export interface TicketWithDetailsExtended extends TicketWithDetails {
  needsReply: boolean
}

function mapTicketMessageAttachment(attachment: {
  id: number
  ticketId: number
  messageId: number
  uploaderId: number
  provider: string
  providerVersion: string
  providerFileId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: Date
}): TicketMessageAttachment {
  return {
    id: attachment.id,
    ticketId: attachment.ticketId,
    messageId: attachment.messageId,
    uploaderId: attachment.uploaderId,
    provider: attachment.provider,
    providerVersion: attachment.providerVersion,
    providerFileId: attachment.providerFileId,
    filename: attachment.filename,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    width: attachment.width,
    height: attachment.height,
    createdAt: attachment.createdAt.toISOString()
  }
}

// ==================== 工单操作 ====================

/**
 * 创建工单
 */
export async function createTicket(data: CreateTicketData): Promise<{ ticketId: number; messageId: number }> {
  const result = await prisma.$transaction(async (tx) => {
    // 创建工单
    const ticket = await tx.ticket.create({
      data: {
        userId: data.userId,
        hostId: data.hostId ?? null,  // 允许为 null
        instanceId: data.instanceId ?? null,
        subject: data.subject,
        category: data.category || 'general',
        priority: data.priority || 'normal',
        status: 'open'
      }
    })

    // 创建首条消息
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: data.userId,
        content: data.content,
        isFromOwner: false
      }
    })

    if (data.attachments && data.attachments.length > 0) {
      await tx.ticketMessageAttachment.createMany({
        data: data.attachments.map(attachment => ({
          ticketId: ticket.id,
          messageId: message.id,
          uploaderId: data.userId,
          provider: attachment.provider,
          providerVersion: attachment.providerVersion,
          providerFileId: attachment.providerFileId ?? null,
          filename: attachment.filename,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          url: attachment.url,
          thumbnailUrl: attachment.thumbnailUrl ?? null
        }))
      })
    }

    return { ticketId: ticket.id, messageId: message.id }
  })

  return result
}

/**
 * 获取工单详情
 */
export async function getTicketById(ticketId: number): Promise<TicketWithDetails | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      },
      host: {
        select: {
          id: true,
          name: true,
          userId: true,
          countryCode: true
        }
      },
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            iconBadgeId: true,
            incusId: true,
            ipv4: true,
            ipv6: true,
          cpu: true,
          memory: true,
          disk: true,
          image: true,
          package: {
            select: {
              name: true
            }
          }
        }
      },
      _count: {
        select: { messages: true }
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          content: true,
          isFromOwner: true,
          createdAt: true
        }
      }
    }
  })

  if (!ticket) return null

  // 查询镜像名称
  let imageName: string | null = null
  if (ticket.instance?.image) {
    const systemImage = await prisma.systemImage.findUnique({
      where: { remoteAlias: ticket.instance.image },
      select: { name: true }
    })
    imageName = systemImage?.name || null
  }

  return {
    id: ticket.id,
    userId: ticket.userId,
    hostId: ticket.hostId,
    instanceId: ticket.instanceId,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() || null,
    closedAt: ticket.closedAt?.toISOString() || null,
    user: ticket.user,
    host: ticket.host,
      instance: ticket.instance ? {
        id: ticket.instance.id,
        name: ticket.instance.name,
        status: ticket.instance.status,
        iconBadgeId: ticket.instance.iconBadgeId,
        incusId: ticket.instance.incusId,
        ipv4: ticket.instance.ipv4,
        ipv6: ticket.instance.ipv6,
      cpu: ticket.instance.cpu,
      memory: ticket.instance.memory,
      disk: ticket.instance.disk,
      image: ticket.instance.image,
      imageName,
      packageName: ticket.instance.package?.name || null
    } : null,
    messageCount: ticket._count.messages,
    lastMessage: ticket.messages[0] ? {
      content: ticket.messages[0].content,
      isFromOwner: ticket.messages[0].isFromOwner,
      createdAt: ticket.messages[0].createdAt.toISOString()
    } : null
  }
}

/**
 * 获取用户创建的工单列表
 * 支持 active 状态筛选（排除已关闭）、搜索
 */
export async function getUserTickets(
  userId: number,
  options: {
    status?: TicketStatus | 'active'
    search?: string
    page?: number
    pageSize?: number
  } = {}
): Promise<{
  tickets: TicketWithDetailsExtended[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = options.page || 1
  const pageSize = options.pageSize || 10
  const skip = (page - 1) * pageSize

  const where: any = { userId }
  
  // 状态筛选：active 表示排除 closed
  if (options.status === 'active') {
    where.status = { not: 'closed' }
  } else if (options.status) {
    where.status = options.status
  }

  // 搜索：支持主题和工单ID
  if (options.search && options.search.trim()) {
    const searchTerm = options.search.trim()
    const searchId = parseInt(searchTerm)
    if (!isNaN(searchId)) {
      // 如果是数字，同时搜索 ID 和主题
      where.OR = [
        { id: searchId },
        { subject: { contains: searchTerm, mode: 'insensitive' } }
      ]
    } else {
      where.subject = { contains: searchTerm, mode: 'insensitive' }
    }
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        host: {
          select: {
            id: true,
            name: true,
            userId: true,
            countryCode: true
          }
        },
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            iconBadgeId: true
          }
        },
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            isFromOwner: true,
            createdAt: true
          }
        }
      },
      // 用户视角：需要回复的（宿主机回复了）排前面，按更新时间降序
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.ticket.count({ where })
  ])

  return {
    tickets: tickets.map(ticket => {
      // 用户视角：如果最后一条消息来自宿主机主人，说明需要用户回复
      const lastMsg = ticket.messages[0]
      const needsReply = ticket.status !== 'closed' && lastMsg?.isFromOwner === true
      
      return {
        id: ticket.id,
        userId: ticket.userId,
        hostId: ticket.hostId,
        instanceId: ticket.instanceId,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        resolvedAt: ticket.resolvedAt?.toISOString() || null,
        closedAt: ticket.closedAt?.toISOString() || null,
        user: ticket.user,
        host: ticket.host,
        instance: ticket.instance,
        messageCount: ticket._count.messages,
        lastMessage: lastMsg ? {
          content: lastMsg.content,
          isFromOwner: lastMsg.isFromOwner,
          createdAt: lastMsg.createdAt.toISOString()
        } : null,
        needsReply
      }
    }),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取宿主机的工单列表（宿主机所有者）
 * 支持 active 状态筛选、搜索、智能排序
 */
export async function getHostTickets(
  hostId: number,
  options: {
    status?: TicketStatus | 'active'
    search?: string
    page?: number
    pageSize?: number
  } = {}
): Promise<{
  tickets: TicketWithDetailsExtended[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = options.page || 1
  const pageSize = options.pageSize || 10
  const skip = (page - 1) * pageSize

  const where: any = { hostId }
  
  // 状态筛选
  if (options.status === 'active') {
    where.status = { not: 'closed' }
  } else if (options.status) {
    where.status = options.status
  }

  // 搜索
  if (options.search && options.search.trim()) {
    const searchTerm = options.search.trim()
    const searchId = parseInt(searchTerm)
    if (!isNaN(searchId)) {
      where.OR = [
        { id: searchId },
        { subject: { contains: searchTerm, mode: 'insensitive' } },
        { user: { username: { contains: searchTerm, mode: 'insensitive' } } }
      ]
    } else {
      where.OR = [
        { subject: { contains: searchTerm, mode: 'insensitive' } },
        { user: { username: { contains: searchTerm, mode: 'insensitive' } } }
      ]
    }
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        host: {
          select: {
            id: true,
            name: true,
            userId: true,
            countryCode: true
          }
        },
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            iconBadgeId: true
          }
        },
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            isFromOwner: true,
            createdAt: true
          }
        }
      },
      // 排序策略：按更新时间降序，便于在内存中排序
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.ticket.count({ where })
  ])

  // 构建返回数据，添加 needsReply 字段
  const ticketsWithNeedsReply = tickets.map(ticket => {
    const lastMsg = ticket.messages[0]
    // 宿主机视角：如果最后一条消息来自用户（isFromOwner=false），说明需要宿主机主人回复
    const needsReply = ticket.status !== 'closed' && lastMsg?.isFromOwner === false
    
    return {
      id: ticket.id,
      userId: ticket.userId,
      hostId: ticket.hostId,
      instanceId: ticket.instanceId,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() || null,
      closedAt: ticket.closedAt?.toISOString() || null,
      user: ticket.user,
      host: ticket.host,
      instance: ticket.instance,
      messageCount: ticket._count.messages,
      lastMessage: lastMsg ? {
        content: lastMsg.content,
        isFromOwner: lastMsg.isFromOwner,
        createdAt: lastMsg.createdAt.toISOString()
      } : null,
      needsReply
    }
  })

  // 智能排序：需要回复的排前面，再按优先级和更新时间
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
  const statusOrder: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, closed: 3 }
  
  ticketsWithNeedsReply.sort((a, b) => {
    // 1. 需要回复的排前面
    if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1
    // 2. 按状态排序
    if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status]
    // 3. 按优先级排序
    if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority]
    // 4. 按更新时间排序：需要回复的按旧到新，其他按新到旧
    const aTime = new Date(a.updatedAt).getTime()
    const bTime = new Date(b.updatedAt).getTime()
    return a.needsReply ? aTime - bTime : bTime - aTime
  })

  return {
    tickets: ticketsWithNeedsReply,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取用户所有宿主机的工单（汇总视图）
 * 支持 active 状态筛选、搜索、智能排序
 */
export async function getOwnerAllTickets(
  ownerId: number | undefined,
  options: {
    status?: TicketStatus | 'active'
    hostId?: number
    sourceType?: 'user' | 'official' | 'hosted'
    search?: string
    page?: number
    pageSize?: number
  } = {}
): Promise<{
  tickets: TicketWithDetailsExtended[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = options.page || 1
  const pageSize = options.pageSize || 10
  const skip = (page - 1) * pageSize

  const where: any = {}
  
  // 如果指定了 ownerId，只查询该用户的节点工单；否则查询所有工单（管理员）
  if (ownerId !== undefined) {
    where.host = { userId: ownerId }
  } else if (options.sourceType === 'user') {
    where.hostId = null
  } else if (options.sourceType === 'official') {
    where.host = { user: { role: 'admin' } }
  } else if (options.sourceType === 'hosted') {
    where.host = { user: { role: { not: 'admin' } } }
  }
  
  // 状态筛选
  if (options.status === 'active') {
    where.status = { not: 'closed' }
  } else if (options.status) {
    where.status = options.status
  }
  
  if (options.hostId && options.sourceType !== 'user') {
    where.hostId = options.hostId
  }

  // 搜索
  if (options.search && options.search.trim()) {
    const searchTerm = options.search.trim()
    const searchId = parseInt(searchTerm)
    if (!isNaN(searchId)) {
      where.OR = [
        { id: searchId },
        { subject: { contains: searchTerm, mode: 'insensitive' } },
        { user: { username: { contains: searchTerm, mode: 'insensitive' } } }
      ]
    } else {
      where.OR = [
        { subject: { contains: searchTerm, mode: 'insensitive' } },
        { user: { username: { contains: searchTerm, mode: 'insensitive' } } }
      ]
    }
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        host: {
          select: {
            id: true,
            name: true,
            userId: true,
            countryCode: true
          }
        },
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            iconBadgeId: true
          }
        },
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            isFromOwner: true,
            createdAt: true
          }
        }
      },
      // 排序策略：按更新时间降序，便于在内存中排序
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.ticket.count({ where })
  ])

  // 构建返回数据，添加 needsReply 字段
  const ticketsWithNeedsReply = tickets.map(ticket => {
    const lastMsg = ticket.messages[0]
    // 宿主机视角：如果最后一条消息来自用户（isFromOwner=false），说明需要宿主机主人回复
    const needsReply = ticket.status !== 'closed' && lastMsg?.isFromOwner === false
    
    return {
      id: ticket.id,
      userId: ticket.userId,
      hostId: ticket.hostId,
      instanceId: ticket.instanceId,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() || null,
      closedAt: ticket.closedAt?.toISOString() || null,
      user: ticket.user,
      host: ticket.host,
      instance: ticket.instance,
      messageCount: ticket._count.messages,
      lastMessage: lastMsg ? {
        content: lastMsg.content,
        isFromOwner: lastMsg.isFromOwner,
        createdAt: lastMsg.createdAt.toISOString()
      } : null,
      needsReply
    }
  })

  // 智能排序：需要回复的排前面，再按优先级和更新时间
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
  const statusOrder: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, closed: 3 }
  
  ticketsWithNeedsReply.sort((a, b) => {
    // 1. 需要回复的排前面
    if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1
    // 2. 按状态排序
    if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status]
    // 3. 按优先级排序
    if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority]
    // 4. 按更新时间排序：需要回复的按旧到新，其他按新到旧
    const aTime = new Date(a.updatedAt).getTime()
    const bTime = new Date(b.updatedAt).getTime()
    return a.needsReply ? aTime - bTime : bTime - aTime
  })

  return {
    tickets: ticketsWithNeedsReply,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取工单消息列表
 */
export async function getTicketMessages(
  ticketId: number,
  options: { page?: number; pageSize?: number } = {}
): Promise<{
  messages: TicketMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = options.page || 1
  const pageSize = options.pageSize || 50
  const skip = (page - 1) * pageSize

  const [messages, total] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        attachments: {
          orderBy: { id: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: pageSize
    }),
    prisma.ticketMessage.count({ where: { ticketId } })
  ])

  return {
    messages: messages.map(msg => ({
      id: msg.id,
      ticketId: msg.ticketId,
      senderId: msg.senderId,
      content: msg.content,
      isFromOwner: msg.isFromOwner,
      createdAt: msg.createdAt.toISOString(),
      attachments: msg.attachments.map(mapTicketMessageAttachment),
      sender: msg.sender
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 添加工单消息
 */
export async function addTicketMessage(
  ticketId: number,
  senderId: number,
  content: string,
  isFromOwner: boolean,
  attachments: CreateTicketMessageAttachmentData[] = []
): Promise<TicketMessage> {
  const message = await prisma.$transaction(async tx => {
    const createdMessage = await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId,
        content,
        isFromOwner
      }
    })

    if (attachments.length > 0) {
      await tx.ticketMessageAttachment.createMany({
        data: attachments.map(attachment => ({
          ticketId,
          messageId: createdMessage.id,
          uploaderId: senderId,
          provider: attachment.provider,
          providerVersion: attachment.providerVersion,
          providerFileId: attachment.providerFileId ?? null,
          filename: attachment.filename,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          url: attachment.url,
          thumbnailUrl: attachment.thumbnailUrl ?? null
        }))
      })
    }

    await tx.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() }
    })

    return tx.ticketMessage.findUniqueOrThrow({
      where: { id: createdMessage.id },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        },
        attachments: {
          orderBy: { id: 'asc' }
        }
      }
    })
  })

  return {
    id: message.id,
    ticketId: message.ticketId,
    senderId: message.senderId,
    content: message.content,
    isFromOwner: message.isFromOwner,
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments.map(mapTicketMessageAttachment),
    sender: message.sender
  }
}

/**
 * 更新工单状态
 */
export async function updateTicketStatus(
  ticketId: number,
  status: TicketStatus
): Promise<void> {
  const updateData: {
    status: TicketStatus
    resolvedAt?: Date | null
    closedAt?: Date | null
  } = { status }

  if (status === 'resolved') {
    updateData.resolvedAt = new Date()
  } else if (status === 'closed') {
    updateData.closedAt = new Date()
  } else if (status === 'open' || status === 'in_progress') {
    updateData.resolvedAt = null
    updateData.closedAt = null
  }

  await prisma.ticket.update({
    where: { id: ticketId },
    data: updateData
  })
}

/**
 * 检查用户是否可以创建工单（必须在该宿主机上有实例）
 */
export async function canUserCreateTicket(userId: number, hostId: number): Promise<boolean> {
  const count = await prisma.instance.count({
    where: {
      userId,
      hostId,
      status: { not: 'deleted' }
    }
  })
  return count > 0
}

/**
 * 检查用户是否可以访问工单
 * @param userId 用户ID
 * @param ticketId 工单ID
 * @param userRole 用户角色，可选，管理员可以访问所有工单
 */
export async function canUserAccessTicket(userId: number, ticketId: number, userRole?: 'admin' | 'user'): Promise<{
  canAccess: boolean
  isOwner: boolean
  isCreator: boolean
  isAdmin: boolean
}> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      host: {
        select: { userId: true }
      }
    }
  })

  if (!ticket) {
    return { canAccess: false, isOwner: false, isCreator: false, isAdmin: false }
  }

  const isCreator = ticket.userId === userId
  const isOwner = ticket.host?.userId === userId  // host 可能为 null（无实例工单直接发给管理员）
  const isAdmin = userRole === 'admin'

  return {
    canAccess: isCreator || isOwner || isAdmin,
    isOwner: isOwner || isAdmin, // 管理员视为所有者
    isCreator,
    isAdmin
  }
}

/**
 * 获取宿主机所有者待处理工单数量
 */
export async function getOwnerPendingTicketCount(ownerId: number | undefined): Promise<number> {
  const where: any = {
    status: { in: ['open', 'in_progress'] }
  }
  
  // 如果指定了 ownerId，只查询该用户的节点工单；否则查询所有工单（管理员）
  if (ownerId !== undefined) {
    where.host = { userId: ownerId }
  }
  
  return prisma.ticket.count({ where })
}

/**
 * 获取用户待处理工单数量
 */
export async function getUserOpenTicketCount(userId: number): Promise<number> {
  return prisma.ticket.count({
    where: {
      userId,
      status: { in: ['open', 'in_progress'] }
    }
  })
}

/**
 * 获取需要自动关闭的工单
 * 条件：
 * 1. 状态为 resolved（已解决）
 * 2. resolvedAt 早于指定时间（默认24小时前）
 * 3. 最后一条消息来自宿主机主人（isFromOwner = true），表示不需要管理员再回复
 */
export async function getTicketsForAutoClose(timeoutMs: number = 24 * 60 * 60 * 1000): Promise<{
  id: number
  subject: string
  userId: number
  hostId: number | null
  resolvedAt: Date
}[]> {
  const cutoffTime = new Date(Date.now() - timeoutMs)

  // 查询符合条件的工单
  const tickets = await prisma.ticket.findMany({
    where: {
      status: 'resolved',
      resolvedAt: {
        lt: cutoffTime
      }
    },
    select: {
      id: true,
      subject: true,
      userId: true,
      hostId: true,
      resolvedAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          isFromOwner: true
        }
      }
    }
  })

  // 过滤：只保留最后一条消息来自宿主机主人的工单
  return tickets
    .filter(ticket => ticket.messages[0]?.isFromOwner === true)
    .map(ticket => ({
      id: ticket.id,
      subject: ticket.subject,
      userId: ticket.userId,
      hostId: ticket.hostId,
      resolvedAt: ticket.resolvedAt!
    }))
}

/**
 * 批量自动关闭工单
 * 返回关闭的工单数量
 */
export async function autoCloseTickets(ticketIds: number[]): Promise<number> {
  if (ticketIds.length === 0) return 0

  const result = await prisma.ticket.updateMany({
    where: {
      id: { in: ticketIds },
      status: 'resolved' // 安全检查：确保只关闭 resolved 状态的工单
    },
    data: {
      status: 'closed',
      closedAt: new Date()
    }
  })

  return result.count
}

/**
 * 删除工单消息（仅管理员）
 */
export async function deleteTicketMessage(messageId: number): Promise<boolean> {
  const result = await prisma.ticketMessage.delete({
    where: { id: messageId }
  })
  return !!result
}

export async function getTicketMessageAttachments(messageId: number): Promise<Array<{
  id: number
  ticketId: number
  messageId: number
  providerVersion: string
  providerFileId: string | null
  url: string
}>> {
  return prisma.ticketMessageAttachment.findMany({
    where: { messageId },
    select: {
      id: true,
      ticketId: true,
      messageId: true,
      providerVersion: true,
      providerFileId: true,
      url: true
    }
  })
}

/**
 * 获取工单消息详情
 */
export async function getTicketMessageById(messageId: number): Promise<{
  id: number
  ticketId: number
  senderId: number
} | null> {
  const message = await prisma.ticketMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      ticketId: true,
      senderId: true
    }
  })
  return message
}

export async function getTicketMessageAttachmentById(attachmentId: number): Promise<{
  id: number
  ticketId: number
  messageId: number
  mimeType: string
  filename: string
  url: string
} | null> {
  return prisma.ticketMessageAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      ticketId: true,
      messageId: true,
      mimeType: true,
      filename: true,
      url: true
    }
  })
}
