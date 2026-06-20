/**
 * WebSocket 安全管理模块
 * 
 * 提供 WebSocket 连接的安全增强功能：
 * 1. 连接数限制（按 IP 和用户）
 * 2. 认证验证（JWT Token）
 * 3. 连接超时管理
 */

import type { FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'

// 连接限制配置
const WS_LIMITS = {
    maxConnectionsPerIP: 10,      // 单 IP 最大连接数
    maxConnectionsPerUser: 5,     // 单用户最大连接数
    connectionTimeout: 30000,     // 连接超时（30秒内必须认证）
    heartbeatInterval: 30000,     // 心跳间隔
    heartbeatTimeout: 10000,      // 心跳超时
}

// IP 连接计数器
const ipConnections = new Map<string, Set<WebSocket>>()

// 用户连接计数器
const userConnections = new Map<number, Set<WebSocket>>()

/**
 * 获取客户端 IP
 */
export function getClientIP(request: FastifyRequest): string {
    return request.ip
}

/**
 * 检查 IP 连接数是否超限
 */
export function checkIPConnectionLimit(ip: string): { allowed: boolean; current: number; limit: number } {
    const connections = ipConnections.get(ip)
    const current = connections?.size || 0
    
    return {
        allowed: current < WS_LIMITS.maxConnectionsPerIP,
        current,
        limit: WS_LIMITS.maxConnectionsPerIP
    }
}

/**
 * 检查用户连接数是否超限
 */
export function checkUserConnectionLimit(userId: number): { allowed: boolean; current: number; limit: number } {
    const connections = userConnections.get(userId)
    const current = connections?.size || 0
    
    return {
        allowed: current < WS_LIMITS.maxConnectionsPerUser,
        current,
        limit: WS_LIMITS.maxConnectionsPerUser
    }
}

/**
 * 注册新连接
 */
export function registerConnection(ip: string, socket: WebSocket, userId?: number): void {
    // 注册 IP 连接
    if (!ipConnections.has(ip)) {
        ipConnections.set(ip, new Set())
    }
    ipConnections.get(ip)!.add(socket)

    // 注册用户连接（如果有用户 ID）
    if (userId !== undefined) {
        if (!userConnections.has(userId)) {
            userConnections.set(userId, new Set())
        }
        userConnections.get(userId)!.add(socket)
    }

    // 监听连接关闭，自动清理
    socket.on('close', () => {
        unregisterConnection(ip, socket, userId)
    })
}

/**
 * 注销连接
 */
export function unregisterConnection(ip: string, socket: WebSocket, userId?: number): void {
    // 清理 IP 连接
    const ipSet = ipConnections.get(ip)
    if (ipSet) {
        ipSet.delete(socket)
        if (ipSet.size === 0) {
            ipConnections.delete(ip)
        }
    }

    // 清理用户连接
    if (userId !== undefined) {
        const userSet = userConnections.get(userId)
        if (userSet) {
            userSet.delete(socket)
            if (userSet.size === 0) {
                userConnections.delete(userId)
            }
        }
    }
}

/**
 * 设置连接超时（要求在指定时间内完成认证）
 */
export function setAuthenticationTimeout(socket: WebSocket, timeoutMs: number = WS_LIMITS.connectionTimeout): NodeJS.Timeout {
    return setTimeout(() => {
        if (socket.readyState === socket.OPEN) {
            socket.close(4001, 'Authentication timeout')
        }
    }, timeoutMs)
}

/**
 * 获取当前连接统计
 */
export function getConnectionStats(): {
    totalIPs: number
    totalConnections: number
    totalUsers: number
    topIPs: Array<{ ip: string; count: number }>
} {
    let totalConnections = 0
    const topIPs: Array<{ ip: string; count: number }> = []

    for (const [ip, connections] of ipConnections.entries()) {
        totalConnections += connections.size
        topIPs.push({ ip, count: connections.size })
    }

    // 按连接数排序
    topIPs.sort((a, b) => b.count - a.count)

    return {
        totalIPs: ipConnections.size,
        totalConnections,
        totalUsers: userConnections.size,
        topIPs: topIPs.slice(0, 10) // 只返回前10个
    }
}

/**
 * 强制断开某 IP 的所有连接
 */
export function disconnectIP(ip: string, reason: string = 'Disconnected by admin'): number {
    const connections = ipConnections.get(ip)
    if (!connections) return 0

    let count = 0
    for (const socket of connections) {
        if (socket.readyState === socket.OPEN) {
            socket.close(4003, reason)
            count++
        }
    }

    return count
}

/**
 * 强制断开某用户的所有连接
 */
export function disconnectUser(userId: number, reason: string = 'Session terminated'): number {
    const connections = userConnections.get(userId)
    if (!connections) return 0

    let count = 0
    for (const socket of connections) {
        if (socket.readyState === socket.OPEN) {
            socket.close(4002, reason)
            count++
        }
    }

    return count
}

/**
 * WebSocket 认证中间件辅助函数
 * 用于在 WebSocket 路由中验证用户身份
 */
export async function authenticateWebSocket(
    request: FastifyRequest,
    verifyJwt: (token: string) => Promise<{ id: number; username: string; role: string } | null>
): Promise<{ authenticated: boolean; user?: { id: number; username: string; role: string }; error?: string }> {
    // 尝试从 Authorization header 获取 token
    const authHeader = request.headers.authorization
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    const token = headerToken

    if (!token) {
        return { authenticated: false, error: 'No authentication token provided' }
    }

    try {
        const user = await verifyJwt(token)
        if (!user) {
            return { authenticated: false, error: 'Invalid token' }
        }
        return { authenticated: true, user }
    } catch {
        return { authenticated: false, error: 'Token verification failed' }
    }
}

// 导出配置供外部使用
export const WS_CONFIG = WS_LIMITS
