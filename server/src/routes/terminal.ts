/**
 * 终端 WebSocket 路由
 * 
 * 提供实例终端的 WebSocket 连接支持
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import {
    getClientIP,
    checkIPConnectionLimit,
    checkUserConnectionLimit,
    registerConnection
} from '../lib/websocket-security.js'
import {
    createTerminalSession,
    getActiveSessionStats
} from '../lib/terminal-proxy.js'
import type { WebSocket } from 'ws'
import { consumeTerminalAccessTicket, generateTerminalAccessTicket } from '../lib/action-ticket.js'
import { isAccessTokenInvalidated } from '../lib/security.js'

// 终端专用连接限制
const TERMINAL_LIMITS = {
    maxPerUser: 5,      // 单用户最多 5 个终端连接（跨所有实例）
    maxPerInstance: 3,  // 单实例最多 3 个终端连接
}

// 注意：不再维护独立的 instanceTerminalCount 计数器
// 统一使用 terminal-proxy.ts 的 getActiveSessionStats 来获取实时连接数
// 这样可以避免 closeInstanceSessions 等操作导致的计数不同步问题

/**
 * 安全发送 WebSocket 消息（捕获发送异常）
 */
function safeSend(socket: WebSocket, data: string): boolean {
    try {
        if (socket.readyState === socket.OPEN) {
            socket.send(data)
            return true
        }
    } catch (err) {
        console.debug('[Terminal] Failed to send message:', err)
    }
    return false
}

/**
 * 检查用户对实例的终端操作权限
 * 权限规则：
 * 1. 管理员可以访问所有实例的终端
 * 2. 实例所有者可以访问自己实例的终端
 * 3. 节点所有者可以访问其节点上所有实例的终端
 */
async function checkTerminalPermission(
    user: { id: number; role: string },
    instance: { user_id: number; host_id: number }
): Promise<boolean> {
    // 管理员有权限访问所有实例
    if (user.role === 'admin') return true

    // 实例所有者有权限
    if (instance.user_id === user.id) return true

    // 检查是否是节点所有者
    const host = await db.getHostById(instance.host_id)
    if (host && host.user_id === user.id) return true

    return false
}

export default async function terminalRoutes(fastify: FastifyInstance) {
    /**
     * 创建终端访问票据
     * POST /ws/instances/:id/terminal-ticket
     */
    fastify.post<{
        Params: { id: string }
    }>('/:id/terminal-ticket', {
        onRequest: [fastify.authenticate]
    }, async (request, reply) => {
        const instanceId = Number(request.params.id)
        if (isNaN(instanceId)) {
            return reply.code(400).send({ error: 'Invalid instance ID', code: 'INVALID_ID' })
        }

        const issuedAt = request.user.iat
        if (!issuedAt) {
            return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
        }

        const ticket = generateTerminalAccessTicket(
            request.user.id,
            instanceId,
            issuedAt,
            request.user.sid
        )

        return { ticket, expiresIn: 60 }
    })

    /**
     * WebSocket 终端连接
     * GET /ws/instances/:id/terminal
     */
    fastify.get<{
        Params: { id: string }
        Querystring: { ticket?: string }
    }>('/:id/terminal', {
        websocket: true
    }, async (socket, request: FastifyRequest<{
        Params: { id: string }
        Querystring: { ticket?: string }
    }>) => {
        const { id } = request.params
        const instanceId = Number(id)
        const clientIP = getClientIP(request)

        // 1. 验证实例 ID
        if (isNaN(instanceId)) {
            safeSend(socket, JSON.stringify({ type: 'error', code: 'INVALID_ID', message: 'Invalid instance ID' }))
            socket.close(4000, 'Invalid instance ID')
            return
        }

        // 2. IP 连接限制检查
        const ipCheck = checkIPConnectionLimit(clientIP)
        if (!ipCheck.allowed) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'IP_LIMIT_EXCEEDED',
                message: `Too many connections from this IP (${ipCheck.current}/${ipCheck.limit})`
            }))
            socket.close(4003, 'IP connection limit exceeded')
            return
        }

        // 3. 终端短期票据认证
        const ticket = request.query.ticket
        if (!ticket) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'UNAUTHORIZED',
                message: 'Authentication ticket is required'
            }))
            socket.close(4001, 'Unauthorized')
            return
        }

        const authResult = consumeTerminalAccessTicket(ticket, instanceId)
        if (!authResult.valid || !authResult.userId || !authResult.issuedAt) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'UNAUTHORIZED',
                message: authResult.error || 'Authentication failed'
            }))
            socket.close(4001, 'Unauthorized')
            return
        }

        const tokenInvalidated = await isAccessTokenInvalidated(
            authResult.userId,
            authResult.issuedAt,
            authResult.sessionId
        )
        if (tokenInvalidated) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'SESSION_INVALIDATED',
                message: 'Session expired'
            }))
            socket.close(4001, 'Session expired')
            return
        }

        const dbUser = await db.findUserById(authResult.userId)
        if (!dbUser || dbUser.status === 'banned') {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'UNAUTHORIZED',
                message: 'Authentication failed'
            }))
            socket.close(4001, 'Unauthorized')
            return
        }

        const user = {
            id: dbUser.id,
            username: dbUser.username,
            role: dbUser.role
        }

        // 4. 用户终端连接数检查（使用终端专用统计，更精确）
        const sessionStats = getActiveSessionStats()
        const currentUserTerminals = sessionStats.byUser.get(user.id) || 0
        if (currentUserTerminals >= TERMINAL_LIMITS.maxPerUser) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'USER_LIMIT_EXCEEDED',
                message: `Too many terminal connections (${currentUserTerminals}/${TERMINAL_LIMITS.maxPerUser})`
            }))
            socket.close(4003, 'User terminal limit exceeded')
            return
        }

        // 通用 WebSocket 连接限制检查（防止单用户占用过多资源）
        const userWsCheck = checkUserConnectionLimit(user.id)
        if (!userWsCheck.allowed) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'WS_LIMIT_EXCEEDED',
                message: `Too many WebSocket connections (${userWsCheck.current}/${userWsCheck.limit})`
            }))
            socket.close(4003, 'WebSocket connection limit exceeded')
            return
        }

        // 5. 获取实例信息
        const instance = await db.getInstanceById(instanceId)
        if (!instance) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'INSTANCE_NOT_FOUND',
                message: 'Instance not found'
            }))
            socket.close(4004, 'Instance not found')
            return
        }

        // 6. 权限检查
        const hasPermission = await checkTerminalPermission(user, instance)
        if (!hasPermission) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'FORBIDDEN',
                message: 'You do not have permission to access this terminal'
            }))
            socket.close(4003, 'Forbidden')
            return
        }

        // 7. 实例状态检查
        if (instance.status !== 'running') {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'INSTANCE_NOT_RUNNING',
                message: 'Instance must be running to access terminal'
            }))
            socket.close(4000, 'Instance not running')
            return
        }

        // 8. 实例终端连接数检查（复用前面获取的统计数据）
        const currentInstanceConnections = sessionStats.byInstance.get(instanceId) || 0
        if (currentInstanceConnections >= TERMINAL_LIMITS.maxPerInstance) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'INSTANCE_LIMIT_EXCEEDED',
                message: `Too many terminal connections for this instance (${currentInstanceConnections}/${TERMINAL_LIMITS.maxPerInstance})`
            }))
            socket.close(4003, 'Instance terminal limit exceeded')
            return
        }

        // 9. 获取宿主机信息
        const host = await db.getHostById(instance.host_id)
        if (!host) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'HOST_NOT_FOUND',
                message: 'Host not found'
            }))
            socket.close(4004, 'Host not found')
            return
        }

        // 10. 注册连接（连接计数由 terminal-proxy 统一管理）
        registerConnection(clientIP, socket, user.id)

        // 11. 创建终端会话前的最终检查（防止 TOCTOU 竞态条件）
        // 重新获取最新统计数据，确保在异步操作期间没有其他连接建立
        const finalStats = getActiveSessionStats()
        const finalUserTerminals = finalStats.byUser.get(user.id) || 0
        const finalInstanceConnections = finalStats.byInstance.get(instanceId) || 0
        
        if (finalUserTerminals >= TERMINAL_LIMITS.maxPerUser) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'USER_LIMIT_EXCEEDED',
                message: `Too many terminal connections (${finalUserTerminals}/${TERMINAL_LIMITS.maxPerUser})`
            }))
            socket.close(4003, 'User terminal limit exceeded')
            return
        }
        
        if (finalInstanceConnections >= TERMINAL_LIMITS.maxPerInstance) {
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'INSTANCE_LIMIT_EXCEEDED',
                message: `Too many terminal connections for this instance (${finalInstanceConnections}/${TERMINAL_LIMITS.maxPerInstance})`
            }))
            socket.close(4003, 'Instance terminal limit exceeded')
            return
        }

        // 12. 创建终端会话
        // 获取套餐信息以确定实例类型（提前到 try 外以便 catch 块访问）
        let instanceType: 'vm' | 'container' = 'container'
        try {
            const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
            instanceType = (pkg?.instance_type === 'vm') ? 'vm' : 'container'
        } catch {
            // 获取套餐失败时默认使用 container
        }

        try {
            const session = await createTerminalSession(
                socket as any,
                host,
                instanceId,
                instance.incus_id,
                user.id,
                instanceType,
                authResult.sessionId
            )

            // 记录连接日志（包含详细信息）
            const logDetails = [
                `instance: ${instance.name} (#${instanceId})`,
                `host: ${host.name}`,
                `type: ${instanceType}`,
                `mode: ${session.connectionMode}`,
                `ip: ${clientIP}`,
                `session: ${session.id}`
            ].join(' | ')

            await createLog(
                user.id,
                'terminal',
                'terminal.connect',
                `Terminal connected | ${logDetails}`,
                'success',
                { instanceId }
            )

            // 监听断开连接（连接计数由 terminal-proxy 统一管理）
            socket.on('close', async () => {
                // 记录断开日志（包含详细信息）
                await createLog(
                    user.id,
                    'terminal',
                    'terminal.disconnect',
                    `Terminal disconnected | ${logDetails}`,
                    'success',
                    { instanceId }
                )
            })

        } catch (error) {
            // 内部错误信息仅记录日志，不暴露给客户端
            const internalError = error instanceof Error ? error.message : String(error)
            console.error(`[Terminal] Failed to create session for instance ${instanceId}:`, internalError)

            // 无需手动回滚连接计数，terminal-proxy 统一管理

            // 向客户端返回通用错误消息，避免泄露内部信息
            safeSend(socket, JSON.stringify({
                type: 'error',
                code: 'CONNECTION_FAILED',
                message: 'Failed to connect to terminal. Please try again later.'
            }))
            socket.close(4000, 'Connection failed')

            // 记录失败日志（包含详细信息，仅服务端可见）
            const failLogDetails = [
                `instance: ${instance.name} (#${instanceId})`,
                `host: ${host.name}`,
                `type: ${instanceType}`,
                `ip: ${clientIP}`,
                `error: ${internalError}`
            ].join(' | ')

            await createLog(
                user.id,
                'terminal',
                'terminal.connect',
                `Terminal connection failed | ${failLogDetails}`,
                'failed',
                { instanceId }
            )
        }
    })

    /**
     * 获取终端连接统计（管理员）
     * GET /terminal/stats
     */
    fastify.get('/stats', {
        onRequest: [fastify.authenticateAdmin]
    }, async () => {
        const stats = getActiveSessionStats()
        return {
            total: stats.total,
            byInstance: Object.fromEntries(stats.byInstance),
            byUser: Object.fromEntries(stats.byUser)
        }
    })
}
