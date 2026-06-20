/**
 * 好友关系数据库操作模块
 */

import { prisma } from './prisma.js'
import type { FriendshipStatus } from '@prisma/client'

// ==================== 类型定义 ====================

export interface FriendInfo {
    id: number  // 好友的用户ID（前端期望的格式）
    friendshipId: number  // friendship 记录的ID
    friendId: number  // 好友的用户ID（与 id 相同，为了向后兼容和清晰性）
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    status: FriendshipStatus
    createdAt: Date
    acceptedAt: Date | null
    // 标识是谁发起的好友请求
    initiatedByMe: boolean
    // 好友的资源统计
    hostCount: number
    instanceCount: number
}

export interface FriendRequest {
    id: number
    userId: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    remark: string | null
    createdAt: Date
}

export interface FriendRequestHistory {
    id: number
    userId: number  // 对方用户的ID（如果是收到的请求，这是发送者；如果是发送的请求，这是接收者）
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    remark: string | null
    status: FriendshipStatus
    createdAt: Date
    acceptedAt: Date | null
    rejectedAt: Date | null
    initiatedByMe: boolean  // 是否是我发起的请求
}

// ==================== 好友请求操作 ====================

/**
 * 发送好友请求
 */
export async function sendFriendRequest(userId: number, friendId: number, remark?: string) {
    // 检查是否已经存在关系（任一方向）
    const existing = await prisma.friendship.findFirst({
        where: {
            OR: [
                { userId, friendId },
                { userId: friendId, friendId: userId }
            ]
        }
    })

    if (existing) {
        if (existing.status === 'accepted') {
            throw new Error('ALREADY_FRIENDS')
        }
        if (existing.status === 'pending') {
            // 如果对方已经向我发送了请求，直接接受
            if (existing.userId === friendId && existing.friendId === userId) {
                return acceptFriendRequest(existing.id, userId)
            }
            throw new Error('REQUEST_PENDING')
        }
        // 如果之前被拒绝过，允许重新发送请求
        if (existing.status === 'rejected') {
            return prisma.friendship.update({
                where: { id: existing.id },
                data: {
                    status: 'pending',
                    remark: remark || null,
                    rejectedAt: null
                }
            })
        }
    }

    return prisma.friendship.create({
        data: {
            userId,
            friendId,
            status: 'pending',
            remark: remark || null
        }
    })
}

/**
 * 接受好友请求
 */
export async function acceptFriendRequest(requestId: number, userId: number) {
    const request = await prisma.friendship.findUnique({
        where: { id: requestId }
    })

    if (!request) {
        throw new Error('REQUEST_NOT_FOUND')
    }

    // 只有接收者才能接受
    if (request.friendId !== userId) {
        throw new Error('FORBIDDEN')
    }

    if (request.status !== 'pending') {
        throw new Error('REQUEST_NOT_PENDING')
    }

    return prisma.friendship.update({
        where: { id: requestId },
        data: {
            status: 'accepted',
            acceptedAt: new Date()
        }
    })
}

/**
 * 拒绝好友请求（更新状态为 rejected）
 */
export async function rejectFriendRequest(requestId: number, userId: number) {
    const request = await prisma.friendship.findUnique({
        where: { id: requestId }
    })

    if (!request) {
        throw new Error('REQUEST_NOT_FOUND')
    }

    // 只有接收者才能拒绝
    if (request.friendId !== userId) {
        throw new Error('FORBIDDEN')
    }

    if (request.status !== 'pending') {
        throw new Error('REQUEST_NOT_PENDING')
    }

    return prisma.friendship.update({
        where: { id: requestId },
        data: {
            status: 'rejected',
            rejectedAt: new Date()
        }
    })
}

/**
 * 取消已发送的好友请求
 */
export async function cancelFriendRequest(requestId: number, userId: number) {
    const request = await prisma.friendship.findUnique({
        where: { id: requestId }
    })

    if (!request) {
        throw new Error('REQUEST_NOT_FOUND')
    }

    // 只有发起者才能取消
    if (request.userId !== userId) {
        throw new Error('FORBIDDEN')
    }

    if (request.status !== 'pending') {
        throw new Error('REQUEST_NOT_PENDING')
    }

    return prisma.friendship.delete({
        where: { id: requestId }
    })
}

// ==================== 好友关系操作 ====================

/**
 * 删除好友关系（双向删除：将状态更新为 removed，保留历史记录）
 */
export async function removeFriend(friendshipId: number, userId: number) {
    const friendship = await prisma.friendship.findUnique({
        where: { id: friendshipId }
    })

    if (!friendship) {
        throw new Error('FRIENDSHIP_NOT_FOUND')
    }

    // 任一方都可以删除好友
    if (friendship.userId !== userId && friendship.friendId !== userId) {
        throw new Error('FORBIDDEN')
    }

    // 不删除记录，而是更新状态为 removed，以保留历史记录
    // 这样可以实现双向删除：双方的好友列表都不会显示对方，但历史记录仍然保留
    return prisma.friendship.update({
        where: { id: friendshipId },
        data: {
            status: 'removed'
        }
    })
}

// ==================== 查询操作 ====================

/**
 * 获取用户的好友列表（已接受的）
 */
export async function getFriendList(userId: number): Promise<FriendInfo[]> {
    const friendships = await prisma.friendship.findMany({
        where: {
            status: 'accepted',
            OR: [
                { userId },
                { friendId: userId }
            ]
        },
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    email: true,
                    avatarStyle: true,
                    avatarBadgeId: true,
                    _count: {
                        select: {
                            hosts: true
                        }
                    }
                }
            },
            friend: {
                select: {
                    id: true,
                    username: true,
                    email: true,
                    avatarStyle: true,
                    avatarBadgeId: true,
                    _count: {
                        select: {
                            hosts: true
                        }
                    }
                }
            }
        },
        orderBy: { acceptedAt: 'desc' }
    })

    // 收集所有好友的用户ID
    const friendIds = friendships.map(f => {
        const iAmInitiator = f.userId === userId
        return iAmInitiator ? f.friend.id : f.user.id
    })

    // 批量查询所有好友的未删除实例数量
    const instanceCounts = await Promise.all(
        friendIds.map(friendId =>
            prisma.instance.count({
                where: {
                    userId: friendId,
                    status: { not: 'deleted' }
                }
            })
        )
    )

    // 创建好友ID到实例数量的映射
    const instanceCountMap = new Map<number, number>()
    friendIds.forEach((friendId, index) => {
        instanceCountMap.set(friendId, instanceCounts[index])
    })

    return friendships.map(f => {
        const iAmInitiator = f.userId === userId
        const friendUser = iAmInitiator ? f.friend : f.user
        return {
            id: friendUser.id,  // 好友的用户ID（前端期望的格式）
            friendshipId: f.id,  // friendship 记录的ID
            friendId: friendUser.id,  // 好友的用户ID（与 id 相同，为了向后兼容和清晰性）
            username: friendUser.username,
            email: friendUser.email,
            avatarStyle: friendUser.avatarStyle,
            avatarBadgeId: friendUser.avatarBadgeId,
            status: f.status,
            createdAt: f.createdAt,
            acceptedAt: f.acceptedAt,
            initiatedByMe: iAmInitiator,
            hostCount: friendUser._count.hosts,
            instanceCount: instanceCountMap.get(friendUser.id) || 0
        }
    })
}

/**
 * 获取收到的待处理好友请求
 */
export async function getPendingFriendRequests(userId: number): Promise<FriendRequest[]> {
    const requests = await prisma.friendship.findMany({
        where: {
            friendId: userId,
            status: 'pending'
        },
        include: {
            user: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return requests.map(r => ({
        id: r.id,
        userId: r.user.id,
        username: r.user.username,
        email: r.user.email,
        avatarStyle: r.user.avatarStyle,
        avatarBadgeId: r.user.avatarBadgeId,
        remark: r.remark,
        createdAt: r.createdAt
    }))
}

/**
 * 获取已发送的待处理好友请求
 */
export async function getSentFriendRequests(userId: number): Promise<FriendRequest[]> {
    const requests = await prisma.friendship.findMany({
        where: {
            userId,
            status: 'pending'
        },
        include: {
            friend: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return requests.map(r => ({
        id: r.id,
        userId: r.friend.id,
        username: r.friend.username,
        email: r.friend.email,
        avatarStyle: r.friend.avatarStyle,
        avatarBadgeId: r.friend.avatarBadgeId,
        remark: r.remark,
        createdAt: r.createdAt
    }))
}

/**
 * 检查两个用户是否是好友
 */
export async function areFriends(userId1: number, userId2: number): Promise<boolean> {
    const friendship = await prisma.friendship.findFirst({
        where: {
            status: 'accepted',
            OR: [
                { userId: userId1, friendId: userId2 },
                { userId: userId2, friendId: userId1 }
            ]
        }
    })

    return !!friendship
}

/**
 * 获取用户的所有好友ID列表（用于资源查询）
 */
export async function getFriendIds(userId: number): Promise<number[]> {
    const friendships = await prisma.friendship.findMany({
        where: {
            status: 'accepted',
            OR: [
                { userId },
                { friendId: userId }
            ]
        },
        select: {
            userId: true,
            friendId: true
        }
    })

    const friendIds = friendships.map(f =>
        f.userId === userId ? f.friendId : f.userId
    )

    return [...new Set(friendIds)]
}

/**
 * 根据用户名搜索用户（用于添加好友）
 */
export async function searchUserByUsername(username: string, excludeUserId: number) {
    return prisma.user.findFirst({
        where: {
            username: {
                equals: username,
                mode: 'insensitive'
            },
            id: { not: excludeUserId },
            status: 'active'
        },
        select: {
            id: true,
            username: true,
            email: true,
            avatarStyle: true,
            avatarBadgeId: true
        }
    })
}

/**
 * 获取好友关系详情
 */
export async function getFriendshipById(friendshipId: number) {
    return prisma.friendship.findUnique({
        where: { id: friendshipId },
        include: {
            user: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            },
            friend: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            }
        }
    })
}

/**
 * 获取好友请求历史记录（已接受、已拒绝或已删除）
 * 包括：我收到的请求和我发送的请求
 * 已删除的好友关系也会出现在历史记录中（双向）
 */
export async function getRequestHistory(
    userId: number,
    filter?: 'accepted' | 'rejected' | 'removed' | 'all'
): Promise<FriendRequestHistory[]> {
    const statusFilter = filter === 'all' || !filter
        ? { in: ['accepted' as const, 'rejected' as const, 'removed' as const] }
        : filter

    // 查询所有相关的好友请求：我收到的和我发送的
    const requests = await prisma.friendship.findMany({
        where: {
            status: statusFilter,
            OR: [
                { friendId: userId },  // 我收到的请求
                { userId: userId }     // 我发送的请求
            ]
        },
        include: {
            user: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            },
            friend: {
                select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return requests.map(r => {
        const iAmInitiator = r.userId === userId
        const otherUser = iAmInitiator ? r.friend : r.user
        
        return {
            id: r.id,
            userId: otherUser.id,
            username: otherUser.username,
            email: otherUser.email,
            avatarStyle: otherUser.avatarStyle,
            avatarBadgeId: otherUser.avatarBadgeId,
            remark: r.remark,
            status: r.status,
            createdAt: r.createdAt,
            acceptedAt: r.acceptedAt,
            rejectedAt: r.rejectedAt,
            initiatedByMe: iAmInitiator
        }
    })
}
