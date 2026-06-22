/**
 * 好友系统 API 路由
 * 提供好友添加、删除、请求管理等功能
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sendNotification } from '../lib/notifier.js'

type FriendHistoryFilter = 'accepted' | 'rejected' | 'removed' | 'all'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const friendHistoryFilters = new Set<FriendHistoryFilter>(['accepted', 'rejected', 'removed', 'all'])

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseFriendHistoryFilter(value: string | undefined): FriendHistoryFilter | undefined | null {
  if (!value) {
    return undefined
  }

  return friendHistoryFilters.has(value as FriendHistoryFilter)
    ? value as FriendHistoryFilter
    : null
}

export default async function friendsRoutes(fastify: FastifyInstance) {
  // ==================== 好友列表 ====================

  /**
   * 获取好友列表
   * GET /api/friends
   */
  fastify.get('/', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request

    try {
      const friends = await db.getFriendList(user.id)
      return { friends }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to get friend list:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  // ==================== 好友请求 ====================

  /**
   * 发送好友请求
   * POST /api/friends/request
   */
  fastify.post<{
    Body: { username: string; remark?: string }
  }>('/request', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 },
          remark: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Body: { username: string; remark?: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { username, remark } = request.body

    try {
      // 搜索目标用户
      const targetUser = await db.searchUserByUsername(username, user.id)
      if (!targetUser) {
        return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
      }

      // 发送好友请求
      const result = await db.sendFriendRequest(user.id, targetUser.id, remark)

      // 如果是自动接受（对方已发送请求给我）
      if (result.status === 'accepted') {
        await createLog(
          user.id,
          'friend',
          'friend.request_auto_accepted',
          `Auto accepted friend request with user "${targetUser.username}"`,
          'success'
        )

        // 通知对方：他之前发的请求被接受了
        await sendNotification(targetUser.id, 'friend_accepted', {
          toUsername: user.username
        }).catch(err => console.error('[Friends] Notification error:', err))

        // 通知当前用户：你们成为好友了（使用 friend_request 通知表示对方之前发过请求）
        await sendNotification(user.id, 'friend_request', {
          fromUsername: targetUser.username
        }).catch(err => console.error('[Friends] Notification error:', err))

        return { message: '好友添加成功（对方已向您发送请求）', friendship: result }
      }

      await createLog(
        user.id,
        'friend',
        'friend.request_sent',
        `Sent friend request to user "${targetUser.username}"`,
        'success'
      )

      // 通知目标用户收到好友请求
      await sendNotification(targetUser.id, 'friend_request', {
        fromUsername: user.username
      }).catch(err => console.error('[Friends] Notification error:', err))

      return { message: '好友请求已发送', request: { id: result.id } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message === 'ALREADY_FRIENDS') {
        return reply.code(400).send(apiError(ErrorCode.ALREADY_FRIENDS))
      }
      if (message === 'REQUEST_PENDING') {
        return reply.code(400).send(apiError(ErrorCode.FRIEND_REQUEST_PENDING))
      }

      console.error('[Friends] Failed to send friend request:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 获取收到的待处理好友请求
   * GET /api/friends/requests
   */
  fastify.get('/requests', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request

    try {
      const requests = await db.getPendingFriendRequests(user.id)
      return { requests }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to get pending requests:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 获取已发送的待处理好友请求
   * GET /api/friends/requests/sent
   */
  fastify.get('/requests/sent', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request

    try {
      const requests = await db.getSentFriendRequests(user.id)
      return { requests }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to get sent requests:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 取消已发送的好友请求
   * DELETE /api/friends/request/:id
   */
  fastify.delete<{
    Params: { id: string }
  }>('/request/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const requestId = parsePositiveRouteId(request.params.id)

    if (!requestId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    try {
      await db.cancelFriendRequest(requestId, user.id)

      await createLog(
        user.id,
        'friend',
        'friend.request_cancelled',
        `Cancelled friend request #${requestId}`,
        'success'
      )

      return { message: '已取消好友请求' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message === 'REQUEST_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '请求不存在'))
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, '无权取消此请求'))
      }
      if (message === 'REQUEST_NOT_PENDING') {
        return reply.code(400).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_PENDING))
      }

      console.error('[Friends] Failed to cancel request:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  // ==================== 请求处理 ====================

  /**
   * 接受好友请求
   * POST /api/friends/:id/accept
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/accept', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const requestId = parsePositiveRouteId(request.params.id)

    if (!requestId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    try {
      // 获取请求信息
      const friendship = await db.getFriendshipById(requestId)
      if (!friendship) {
        return reply.code(404).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_FOUND))
      }

      // 接受请求
      const result = await db.acceptFriendRequest(requestId, user.id)

      await createLog(
        user.id,
        'friend',
        'friend.request_accepted',
        `Accepted friend request from user "${friendship.user.username}"`,
        'success'
      )

      // 通知发送者请求已被接受
      await sendNotification(friendship.userId, 'friend_accepted', {
        toUsername: user.username
      }).catch(err => console.error('[Friends] Notification error:', err))

      return { message: '已接受好友请求', friendship: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message === 'REQUEST_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_FOUND))
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, '无权处理此请求'))
      }
      if (message === 'REQUEST_NOT_PENDING') {
        return reply.code(400).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_PENDING))
      }

      console.error('[Friends] Failed to accept request:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 拒绝好友请求
   * POST /api/friends/:id/reject
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/reject', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const requestId = parsePositiveRouteId(request.params.id)

    if (!requestId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    try {
      // 获取请求信息用于日志
      const friendship = await db.getFriendshipById(requestId)
      if (!friendship) {
        return reply.code(404).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_FOUND))
      }

      await db.rejectFriendRequest(requestId, user.id)

      await createLog(
        user.id,
        'friend',
        'friend.request_rejected',
        `Rejected friend request from user "${friendship.user.username}"`,
        'success'
      )

      // 通知发送者请求已被拒绝
      await sendNotification(friendship.userId, 'friend_rejected', {
        toUsername: user.username
      }).catch(err => console.error('[Friends] Notification error:', err))

      return { message: '已拒绝好友请求' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message === 'REQUEST_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_FOUND))
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, '无权处理此请求'))
      }
      if (message === 'REQUEST_NOT_PENDING') {
        return reply.code(400).send(apiError(ErrorCode.FRIEND_REQUEST_NOT_PENDING))
      }

      console.error('[Friends] Failed to reject request:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  // ==================== 好友管理 ====================

  /**
   * 删除好友
   * DELETE /api/friends/:id
   */
  fastify.delete<{
    Params: { id: string }
  }>('/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const friendshipId = parsePositiveRouteId(request.params.id)

    if (!friendshipId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    try {
      // 获取好友关系信息
      const friendship = await db.getFriendshipById(friendshipId)
      if (!friendship) {
        return reply.code(404).send(apiError(ErrorCode.FRIENDSHIP_NOT_FOUND))
      }

      // 确定对方用户信息用于日志和通知
      const friendUsername = friendship.userId === user.id ? friendship.friend.username : friendship.user.username
      const friendUserId = friendship.userId === user.id ? friendship.friendId : friendship.userId

      await db.removeFriend(friendshipId, user.id)

      await createLog(
        user.id,
        'friend',
        'friend.removed',
        `Removed friend "${friendUsername}"`,
        'success'
      )

      // 通知被删除的好友
      await sendNotification(friendUserId, 'friend_removed', {
        fromUsername: user.username
      }).catch(err => console.error('[Friends] Notification error:', err))

      return { message: '已删除好友' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message === 'FRIENDSHIP_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.FRIENDSHIP_NOT_FOUND))
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, '无权删除此好友'))
      }

      console.error('[Friends] Failed to remove friend:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  // ==================== 历史记录与搜索 ====================

  /**
   * 获取好友请求历史记录
   * GET /api/friends/history
   */
  fastify.get<{
    Querystring: { filter?: 'accepted' | 'rejected' | 'removed' | 'all' }
  }>('/history', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Querystring: { filter?: 'accepted' | 'rejected' | 'removed' | 'all' }
  }>, reply: FastifyReply) => {
    const { user } = request
    const filter = parseFriendHistoryFilter(request.query.filter)

    if (filter === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid history filter'))
    }

    try {
      const history = await db.getRequestHistory(user.id, filter)
      return { history }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to get history:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 搜索用户（用于添加好友）
   * GET /api/friends/search
   */
  fastify.get<{
    Querystring: { username: string }
  }>('/search', {
    onRequest: [fastify.authenticateUser],
    schema: {
      querystring: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Querystring: { username: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { username } = request.query

    try {
      const targetUser = await db.searchUserByUsername(username, user.id)
      if (!targetUser) {
        return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND, '用户不存在'))
      }

      // 检查是否已是好友
      const isFriend = await db.areFriends(user.id, targetUser.id)

      return {
        user: {
          id: targetUser.id,
          username: targetUser.username,
          avatarStyle: targetUser.avatarStyle,
          isFriend
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to search user:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })

  /**
   * 获取好友的资源统计
   * GET /api/friends/:id/resources
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id/resources', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const friendshipId = parsePositiveRouteId(request.params.id)

    if (!friendshipId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    try {
      const friendship = await db.getFriendshipById(friendshipId)
      if (!friendship) {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '好友关系不存在'))
      }

      // 验证权限
      if (friendship.userId !== user.id && friendship.friendId !== user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 确定好友的用户ID
      const friendUserId = friendship.userId === user.id ? friendship.friendId : friendship.userId

      // 获取好友的资源统计 - 使用 prisma 直接查询
      const { prisma } = await import('../db/prisma.js')
      const [hostCount, packageCount] = await Promise.all([
        prisma.host.count({ where: { userId: friendUserId } }),
        prisma.package.count({ where: { userId: friendUserId } })
      ])

      return {
        resources: {
          hosts: hostCount,
          images: 0, // 镜像是节点级别的，不是用户级别
          packages: packageCount
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Friends] Failed to get friend resources:', message)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, message))
    }
  })
}
