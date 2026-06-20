/**
 * 终端代理模块
 * 
 * 负责在客户端 WebSocket 和 Incus Console API 之间建立双向数据转发
 */

import type { WebSocket as WsWebSocket } from 'ws'
import { Agent, request } from 'undici'
import { readFileSync } from 'fs'
import type { Host } from '../types/database.js'

// 证书缓存（避免每次连接都读取文件）
interface CertCache {
    cert: Buffer
    key: Buffer
    lastModified: number
}
const certCache = new Map<string, CertCache>()
const CERT_CACHE_TTL = 60 * 60 * 1000 // 1小时

/**
 * 获取缓存的证书（避免重复 I/O 读取）
 */
function getCachedCertificates(certPath: string, keyPath: string): { cert: Buffer; key: Buffer } {
    const cacheKey = `${certPath}:${keyPath}`
    const cached = certCache.get(cacheKey)
    const now = Date.now()

    // 缓存有效
    if (cached && (now - cached.lastModified) < CERT_CACHE_TTL) {
        return { cert: cached.cert, key: cached.key }
    }

    // 读取并缓存（添加异常保护）
    try {
        const cert = readFileSync(certPath)
        const key = readFileSync(keyPath)
        certCache.set(cacheKey, { cert, key, lastModified: now })
        return { cert, key }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to read certificate files: ${errorMessage}`)
    }
}

// 终端会话配置
// 保活策略：只要 WebSocket 通道正常就不断开
export const TERMINAL_CONFIG = {
    heartbeatInterval: 25 * 1000,      // 心跳间隔 25 秒（避免代理层空闲断开）
    heartbeatTimeout: 30000,           // 心跳超时 30秒（给足够时间响应）
    idleTimeout: 12 * 60 * 60 * 1000,  // 空闲超时 12 小时（SSH 风格长连接）
    maxMessageSize: 1048576,           // 最大消息 1MB
    reconnectDelay: 1000,              // 重连延迟
    maxReconnectAttempts: 10,          // 最大重连次数
}

// 终端会话状态
export interface TerminalSession {
    id: string
    instanceId: number
    userId: number
    sessionId?: string
    connectionMode: 'exec' | 'console'
    host: Host
    instanceName: string
    instanceType: 'container' | 'vm'
    incusWebSocket: WsWebSocket | null
    controlWebSocket: WsWebSocket | null  // 控制 WebSocket（用于调整终端大小）
    clientWebSocket: WsWebSocket
    heartbeatTimer: NodeJS.Timeout | null
    createdAt: number
    lastActivity: number
    reconnectingIncus: boolean
    incusReconnectAttempts: number
}

// 活跃终端会话存储
const activeSessions = new Map<string, TerminalSession>()

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
    return `term_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

function buildExecPayload(): Record<string, unknown> {
    return {
        command: [
            '/bin/sh', '-c',
            'setup_term() { ' +
            '  if [ -e /usr/share/terminfo/x/xterm-256color ] || [ -e /lib/terminfo/x/xterm-256color ] || ' +
            '     [ -e /etc/terminfo/x/xterm-256color ] || infocmp xterm-256color >/dev/null 2>&1; then ' +
            '    export TERM=xterm-256color; ' +
            '  elif [ -e /usr/share/terminfo/x/xterm ] || [ -e /lib/terminfo/x/xterm ] || ' +
            '       [ -e /etc/terminfo/x/xterm ] || infocmp xterm >/dev/null 2>&1; then ' +
            '    export TERM=xterm; ' +
            '  else ' +
            '    export TERM=linux; ' +
            '  fi; ' +
            '}; ' +
            'setup_term; ' +
            'export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; ' +
            'if [ -x /bin/bash ]; then exec /bin/bash -l; ' +
            'elif [ -x /usr/bin/bash ]; then exec /usr/bin/bash -l; ' +
            'else exec /bin/sh -l; fi'
        ],
        'wait-for-websocket': true,
        interactive: true,
        environment: {
            TERM: 'xterm',
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8',
            HOME: '/root',
            USER: 'root',
            SHELL: '/bin/bash'
        },
        width: 120,
        height: 40
    }
}

function buildConsolePayload(): Record<string, unknown> {
    return {
        'wait-for-websocket': true,
        type: 'console'
    }
}

async function requestTerminalOperation(
    baseUrl: string,
    agent: Agent,
    endpoint: string,
    payload: Record<string, unknown>
): Promise<{ operationId: string; fds: Record<string, string> }> {
    const response = await request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        dispatcher: agent,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })

    const data = await response.body.json() as {
        type: string
        operation: string
        error_code: number
        error: string
        metadata: {
            id: string
            metadata: {
                fds: Record<string, string>
            }
        }
    }

    if (data.type === 'error' || (data.error_code !== undefined && data.error_code !== 0)) {
        throw new Error(data.error || 'Failed to create terminal session')
    }

    const operationId = data.operation?.split('/').pop() || data.metadata?.id
    if (!operationId) {
        throw new Error('No operation ID returned from terminal request')
    }

    const fds = data.metadata?.metadata?.fds
    if (!fds) {
        throw new Error('No file descriptors returned from terminal operation')
    }

    return { operationId, fds }
}

function safeSendClientMessage(clientWs: WsWebSocket, message: Record<string, unknown>): void {
    if (clientWs.readyState !== clientWs.OPEN) {
        return
    }

    try {
        clientWs.send(JSON.stringify(message))
    } catch (err) {
        console.debug('[Terminal] Failed to send control message to client:', err)
    }
}

function cleanupIncusSockets(session: TerminalSession): void {
    if (session.incusWebSocket) {
        session.incusWebSocket.removeAllListeners()
        try {
            if (session.incusWebSocket.readyState === session.incusWebSocket.OPEN || session.incusWebSocket.readyState === session.incusWebSocket.CONNECTING) {
                session.incusWebSocket.close()
            }
        } catch (err) {
            console.debug('[Terminal] Failed to close Incus data WebSocket:', err)
        }
        session.incusWebSocket = null
    }

    if (session.controlWebSocket) {
        session.controlWebSocket.removeAllListeners()
        try {
            if (session.controlWebSocket.readyState === session.controlWebSocket.OPEN || session.controlWebSocket.readyState === session.controlWebSocket.CONNECTING) {
                session.controlWebSocket.close()
            }
        } catch (err) {
            console.debug('[Terminal] Failed to close Incus control WebSocket:', err)
        }
        session.controlWebSocket = null
    }
}

function bindIncusSocketHandlers(session: TerminalSession, dataWs: WsWebSocket, controlWs: WsWebSocket | null): void {
    dataWs.on('message', (data: Buffer) => {
        session.lastActivity = Date.now()
        if (session.clientWebSocket.readyState === session.clientWebSocket.OPEN) {
            try {
                session.clientWebSocket.send(data)
            } catch (err) {
                console.debug('[Terminal] Failed to send terminal data to client:', err)
            }
        }
    })

    dataWs.on('pong', () => {
        session.lastActivity = Date.now()
    })

    dataWs.on('error', (err) => {
        console.error(`[Terminal] Incus WebSocket error for session ${session.id}:`, err.message)
        void reconnectIncusConnection(session.id, 'Incus connection error')
    })

    dataWs.on('close', () => {
        console.log(`[Terminal] Incus WebSocket closed for session ${session.id}`)
        void reconnectIncusConnection(session.id, 'Incus connection closed')
    })

    if (controlWs) {
        controlWs.on('pong', () => {
            session.lastActivity = Date.now()
        })

        controlWs.on('error', (err) => {
            console.error(`[Terminal] Control WebSocket error for session ${session.id}:`, err.message)
        })
    }
}

async function reconnectIncusConnection(sessionId: string, reason: string): Promise<void> {
    const session = activeSessions.get(sessionId)
    if (!session) return
    if (session.clientWebSocket.readyState !== session.clientWebSocket.OPEN) {
        closeTerminalSession(sessionId, reason)
        return
    }
    if (session.reconnectingIncus) {
        return
    }

    session.reconnectingIncus = true
    session.incusReconnectAttempts += 1

    if (session.incusReconnectAttempts > TERMINAL_CONFIG.maxReconnectAttempts) {
        closeTerminalSession(sessionId, 'Terminal backend reconnection limit exceeded')
        return
    }

    safeSendClientMessage(session.clientWebSocket, {
        type: 'reconnecting',
        reason,
        mode: session.connectionMode
    })

    cleanupIncusSockets(session)

    const delay = Math.min(TERMINAL_CONFIG.reconnectDelay + (session.incusReconnectAttempts - 1) * 2000, 15000)
    await new Promise(resolve => setTimeout(resolve, delay))

    try {
        const { controlWs, dataWs, mode } = await createIncusConsoleConnection(
            session.host,
            session.instanceName,
            session.instanceType
        )

        session.connectionMode = mode
        session.incusWebSocket = dataWs
        session.controlWebSocket = controlWs
        session.lastActivity = Date.now()
        session.reconnectingIncus = false
        session.incusReconnectAttempts = 0

        bindIncusSocketHandlers(session, dataWs, controlWs)

        safeSendClientMessage(session.clientWebSocket, {
            type: 'connected',
            sessionId: session.id,
            message: 'Terminal backend reconnected',
            mode
        })
    } catch (error) {
        session.reconnectingIncus = false
        console.error(`[Terminal] Failed to reconnect Incus backend for session ${session.id}:`, error)
        await reconnectIncusConnection(sessionId, 'Incus reconnection failed')
    }
}

/**
 * 获取活跃会话统计
 */
export function getActiveSessionStats(): {
    total: number
    byInstance: Map<number, number>
    byUser: Map<number, number>
} {
    const byInstance = new Map<number, number>()
    const byUser = new Map<number, number>()

    for (const session of activeSessions.values()) {
        byInstance.set(session.instanceId, (byInstance.get(session.instanceId) || 0) + 1)
        byUser.set(session.userId, (byUser.get(session.userId) || 0) + 1)
    }

    return {
        total: activeSessions.size,
        byInstance,
        byUser
    }
}

/**
 * 创建 Incus Console WebSocket 连接
 */
export async function createIncusConsoleConnection(
    host: Host,
    instanceName: string,
    instanceType: 'container' | 'vm' = 'container'
): Promise<{ controlWs: WsWebSocket | null; dataWs: WsWebSocket; operationId: string; mode: 'exec' | 'console' }> {
    // 构建 Incus API URL
    const baseUrl = host.url

    // 创建 mTLS Agent
    if (!host.cert_path || !host.key_path) {
        throw new Error('Host certificate configuration missing')
    }

    // 使用缓存的证书（避免每次连接都读取文件）
    const { cert, key } = getCachedCertificates(host.cert_path, host.key_path)

    const agent = new Agent({
        connect: {
            cert,
            key,
            rejectUnauthorized: false
        }
    })

    // 对于容器始终使用 exec。
    // 对于 VM 优先使用 exec（依赖 qemu-guest-agent，更接近 SSH 体验），失败时回退到 console。
    const encodedInstanceName = encodeURIComponent(instanceName)
    let operationId = ''
    let fds: Record<string, string> = {}
    let mode: 'exec' | 'console' = 'exec'

    try {
        if (instanceType === 'vm') {
            try {
                const execResult = await requestTerminalOperation(
                    baseUrl,
                    agent,
                    `/1.0/instances/${encodedInstanceName}/exec`,
                    buildExecPayload()
                )
                operationId = execResult.operationId
                fds = execResult.fds
                mode = 'exec'
            } catch (execError) {
                console.warn(`[Terminal] VM exec unavailable for ${instanceName}, falling back to console:`, execError)
                const consoleResult = await requestTerminalOperation(
                    baseUrl,
                    agent,
                    `/1.0/instances/${encodedInstanceName}/console`,
                    buildConsolePayload()
                )
                operationId = consoleResult.operationId
                fds = consoleResult.fds
                mode = 'console'
            }
        } else {
            const execResult = await requestTerminalOperation(
                baseUrl,
                agent,
                `/1.0/instances/${encodedInstanceName}/exec`,
                buildExecPayload()
            )
            operationId = execResult.operationId
            fds = execResult.fds
            mode = 'exec'
        }
    } finally {
        await agent.close()
    }

    // 检查数据 WebSocket fd 是否存在
    const dataSecret = fds['0']
    if (!dataSecret) {
        throw new Error('No data file descriptor (fd 0) returned from console operation')
    }

    // 构建 WebSocket URL
    const wsBaseUrl = baseUrl.replace('https://', 'wss://').replace('http://', 'ws://')

    // 创建数据 WebSocket（fd 0 是标准输入输出，已在上面检查过）
    const dataWsUrl = `${wsBaseUrl}/1.0/operations/${operationId}/websocket?secret=${dataSecret}`

    // 创建控制 WebSocket（用于调整终端大小等）
    const controlSecret = fds['control']
    const controlWsUrl = controlSecret 
        ? `${wsBaseUrl}/1.0/operations/${operationId}/websocket?secret=${controlSecret}`
        : null

    // 使用原生 WebSocket（需要 mTLS）
    const WebSocket = (await import('ws')).default

    const dataWs = new WebSocket(dataWsUrl, {
        cert,
        key,
        rejectUnauthorized: false
    })

    let controlWs: WsWebSocket | null = null
    if (controlWsUrl) {
        controlWs = new WebSocket(controlWsUrl, {
            cert,
            key,
            rejectUnauthorized: false
        }) as WsWebSocket
    }

    // 等待连接建立（带资源清理）
    try {
        await Promise.all([
            new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Data WebSocket connection timeout')), 10000)
                dataWs.once('open', () => {
                    clearTimeout(timeout)
                    resolve()
                })
                dataWs.once('error', (err) => {
                    clearTimeout(timeout)
                    reject(err)
                })
            }),
            controlWs ? new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Control WebSocket connection timeout')), 10000)
                controlWs.once('open', () => {
                    clearTimeout(timeout)
                    resolve()
                })
                controlWs.once('error', (err) => {
                    clearTimeout(timeout)
                    reject(err)
                })
            }) : Promise.resolve()
        ])
    } catch (error) {
        // 连接失败时，关闭已成功的连接，避免资源泄漏
        if (dataWs.readyState === dataWs.OPEN || dataWs.readyState === dataWs.CONNECTING) {
            dataWs.close()
        }
        if (controlWs && (controlWs.readyState === controlWs.OPEN || controlWs.readyState === controlWs.CONNECTING)) {
            controlWs.close()
        }
        throw error
    }

    return { controlWs, dataWs: dataWs as WsWebSocket, operationId, mode }
}

/**
 * 创建终端会话
 */
export async function createTerminalSession(
    clientWs: WsWebSocket,
    host: Host,
    instanceId: number,
    instanceName: string,
    userId: number,
    instanceType: 'container' | 'vm' = 'container',
    authSessionId?: string
): Promise<TerminalSession> {
    const sessionId = generateSessionId()

    // 创建 Incus 控制台连接
    const { controlWs, dataWs, operationId, mode } = await createIncusConsoleConnection(
        host,
        instanceName,
        instanceType
    )

    console.log(`[Terminal] Session ${sessionId} created for instance ${instanceName} (operation: ${operationId}, mode: ${mode})`)

    const session: TerminalSession = {
        id: sessionId,
        instanceId,
        userId,
        sessionId: authSessionId,
        connectionMode: mode,
        host,
        instanceName,
        instanceType,
        incusWebSocket: dataWs,
        controlWebSocket: controlWs,  // 保存 controlWs 引用
        clientWebSocket: clientWs,
        heartbeatTimer: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        reconnectingIncus: false,
        incusReconnectAttempts: 0
    }

    bindIncusSocketHandlers(session, dataWs, controlWs)

    // Client -> Incus
    clientWs.on('message', (data: Buffer | string) => {
        session.lastActivity = Date.now()
        
        // 检查消息大小（防止过大消息攻击）
        const dataSize = typeof data === 'string' ? data.length : data.length
        if (dataSize > TERMINAL_CONFIG.maxMessageSize) {
            console.warn(`[Terminal] Message too large (${dataSize} bytes), dropping`)
            return
        }
        
        // 检查是否是控制消息（JSON 格式）
        // 更健壮的 JSON 检测：检查数据是否以 "{" 开头并以 "}" 结尾
        let isJsonMessage = false
        let jsonStr = ''
        
        if (typeof data === 'string') {
            jsonStr = data.trim()
            isJsonMessage = jsonStr.startsWith('{') && jsonStr.endsWith('}')
        } else if (Buffer.isBuffer(data) && data.length >= 2) {
            // 检查第一个字节是 '{' (0x7b) 且最后一个字节是 '}' (0x7d)
            if (data[0] === 0x7b && data[data.length - 1] === 0x7d) {
                jsonStr = data.toString('utf8').trim()
                isJsonMessage = true
            }
        }
        
        if (isJsonMessage && jsonStr) {
            try {
                const message = JSON.parse(jsonStr)
                if (message.type === 'resize' && session.controlWebSocket) {
                    const currentControlWs = session.controlWebSocket
                    // 验证 cols 和 rows 的范围（防止恶意输入）
                    const cols = Math.max(1, Math.min(500, Number(message.cols) || 80))
                    const rows = Math.max(1, Math.min(200, Number(message.rows) || 24))
                    
                    // 发送调整大小命令
                    const resizeCmd = JSON.stringify({
                        command: 'window-resize',
                        args: {
                            width: cols,
                            height: rows
                        }
                    })
                    if (currentControlWs && currentControlWs.readyState === currentControlWs.OPEN) {
                        try {
                            currentControlWs.send(resizeCmd)
                        } catch (err) {
                            // resize 命令发送失败，非关键错误，静默忽略
                            console.debug(`[Terminal] Failed to send resize command:`, err)
                        }
                    }
                    return
                }
            } catch {
                // JSON 解析失败，作为普通数据处理
            }
        }

        // 转发到 Incus
        const currentDataWs = session.incusWebSocket
        if (currentDataWs && currentDataWs.readyState === currentDataWs.OPEN) {
            try {
                currentDataWs.send(data)
            } catch (err) {
                // 发送失败（可能连接已关闭），静默忽略
                console.debug(`[Terminal] Failed to send to Incus:`, err)
            }
        }
    })

    clientWs.on('close', () => {
        console.log(`[Terminal] Client WebSocket closed for session ${sessionId}`)
        closeTerminalSession(sessionId, 'Client disconnected')
    })

    clientWs.on('error', (err) => {
        console.error(`[Terminal] Client WebSocket error for session ${sessionId}:`, err.message)
        closeTerminalSession(sessionId, 'Client connection error')
    })

    // 设置心跳保活
    // 关键：通过 ping/pong 机制保持连接，只要 WebSocket 通道正常就不断开
    let pongReceived = true  // 标记是否收到 pong 响应
    
    clientWs.on('pong', () => {
        // 收到 pong 响应，说明连接正常，更新活动时间
        pongReceived = true
        session.lastActivity = Date.now()
    })
    
    session.heartbeatTimer = setInterval(() => {
        if (clientWs.readyState !== clientWs.OPEN) {
            return
        }
        
        // 检查上一次 ping 是否收到了 pong
        if (!pongReceived) {
            // 连续两次心跳没有收到 pong，认为连接已死
            console.log(`[Terminal] Session ${sessionId} timeout: no pong response`)
            closeTerminalSession(sessionId, 'Connection timeout')
            return
        }
        
        // 发送新的 ping
        pongReceived = false
        try {
            clientWs.ping()
        } catch (err) {
            console.debug(`[Terminal] Failed to send ping:`, err)
        }

        if (session.incusWebSocket && session.incusWebSocket.readyState === session.incusWebSocket.OPEN) {
            try {
                session.incusWebSocket.ping()
            } catch (err) {
                console.debug('[Terminal] Failed to send ping to Incus data websocket:', err)
            }
        }

        if (session.controlWebSocket && session.controlWebSocket.readyState === session.controlWebSocket.OPEN) {
            try {
                session.controlWebSocket.ping()
            } catch (err) {
                console.debug('[Terminal] Failed to send ping to Incus control websocket:', err)
            }
        }
        
        // 检查空闲超时（可选的安全机制：非常长时间无任何数据传输）
        const now = Date.now()
        if (now - session.lastActivity > TERMINAL_CONFIG.idleTimeout) {
            console.log(`[Terminal] Session ${sessionId} idle timeout (${TERMINAL_CONFIG.idleTimeout / 1000}s)`)
            closeTerminalSession(sessionId, 'Idle timeout')
        }
    }, TERMINAL_CONFIG.heartbeatInterval)

    // 存储会话
    activeSessions.set(sessionId, session)

    // 发送连接成功消息
    try {
        clientWs.send(JSON.stringify({
            type: 'connected',
            sessionId,
            message: `Terminal session established (${mode})`,
            mode
        }))
    } catch (err) {
        // 发送失败（可能连接已关闭），静默忽略
        console.debug(`[Terminal] Failed to send connected message:`, err)
    }

    return session
}

/**
 * 关闭终端会话
 */
export function closeTerminalSession(sessionId: string, reason: string = 'Session closed'): void {
    const session = activeSessions.get(sessionId)
    if (!session) return

    console.log(`[Terminal] Closing session ${sessionId}: ${reason}`)

    // 清除心跳定时器
    if (session.heartbeatTimer) {
        clearInterval(session.heartbeatTimer)
    }

    cleanupIncusSockets(session)

    // 通知客户端并关闭
    if (session.clientWebSocket.readyState === session.clientWebSocket.OPEN) {
        try {
            session.clientWebSocket.send(JSON.stringify({
                type: 'disconnected',
                reason
            }))
        } catch (err) {
            // 发送失败（可能连接已关闭），静默忽略
            console.debug(`[Terminal] Failed to send disconnected message:`, err)
        }
        try {
            session.clientWebSocket.close()
        } catch (err) {
            console.debug(`[Terminal] Failed to close client WebSocket:`, err)
        }
    }

    // 移除会话
    activeSessions.delete(sessionId)
}

/**
 * 关闭实例的所有终端会话
 */
export function closeInstanceSessions(instanceId: number, reason: string = 'Instance session closed'): number {
    // 先收集要关闭的会话 ID，避免在遍历时修改 Map
    const sessionsToClose: string[] = []
    for (const [sessionId, session] of activeSessions) {
        if (session.instanceId === instanceId) {
            sessionsToClose.push(sessionId)
        }
    }
    
    for (const sessionId of sessionsToClose) {
        closeTerminalSession(sessionId, reason)
    }
    return sessionsToClose.length
}

/**
 * 清理僵尸会话（超时未活动的会话）
 * 注意：使用与心跳检查一致的超时时间，避免正常连接被误清理
 */
export function cleanupStaleSessions(): number {
    const now = Date.now()
    const sessionsToClose: string[] = []
    
    // 使用与心跳检查一致的超时时间
    // 加上额外 buffer 避免竞态条件（心跳检查会先处理正常超时）
    const cleanupThreshold = TERMINAL_CONFIG.idleTimeout + TERMINAL_CONFIG.heartbeatInterval * 2
    
    for (const [sessionId, session] of activeSessions) {
        if (now - session.lastActivity > cleanupThreshold) {
            sessionsToClose.push(sessionId)
        }
    }
    
    for (const sessionId of sessionsToClose) {
        closeTerminalSession(sessionId, 'Session stale cleanup')
    }
    
    if (sessionsToClose.length > 0) {
        console.log(`[Terminal] Cleaned up ${sessionsToClose.length} stale session(s)`)
    }
    
    return sessionsToClose.length
}

// 启动定时清理任务（每分钟检查一次，但使用正确的超时阈值）
let cleanupInterval: NodeJS.Timeout | null = null

export function startSessionCleanup(): void {
    if (cleanupInterval) return
    // 每分钟检查一次，清理那些心跳检查可能遗漏的僵尸会话
    cleanupInterval = setInterval(() => {
        cleanupStaleSessions()
    }, 60 * 1000)
    console.log(`[Terminal] Session cleanup task started (threshold: ${(TERMINAL_CONFIG.idleTimeout + TERMINAL_CONFIG.heartbeatInterval * 2) / 1000}s)`)
}

export function stopSessionCleanup(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = null
        console.log('[Terminal] Session cleanup task stopped')
    }
}

/**
 * 关闭用户的所有终端会话
 */
export function closeUserSessions(userId: number, reason: string = 'User session closed'): number {
    // 先收集要关闭的会话 ID，避免在遍历时修改 Map
    const sessionsToClose: string[] = []
    for (const [sessionId, session] of activeSessions) {
        if (session.userId === userId) {
            sessionsToClose.push(sessionId)
        }
    }
    
    for (const sessionId of sessionsToClose) {
        closeTerminalSession(sessionId, reason)
    }
    return sessionsToClose.length
}

export function closeSessionTerminalSessions(sessionId: string, reason: string = 'Session closed'): number {
    const sessionsToClose: string[] = []

    for (const [currentSessionId, session] of activeSessions) {
        if (session.sessionId === sessionId) {
            sessionsToClose.push(currentSessionId)
        }
    }

    for (const currentSessionId of sessionsToClose) {
        closeTerminalSession(currentSessionId, reason)
    }

    return sessionsToClose.length
}

/**
 * 关闭所有终端会话（用于服务器优雅关闭）
 */
export function closeAllSessions(reason: string = 'Server shutdown'): number {
    const sessionIds = Array.from(activeSessions.keys())
    for (const sessionId of sessionIds) {
        closeTerminalSession(sessionId, reason)
    }
    return sessionIds.length
}
