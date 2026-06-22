/**
 * 安全工具库
 * 包含速率限制、密码验证、安全日志等功能
 */

import { createLog, LogModule } from '../db/logs.js'

// ==================== 安全事件类型 ====================

export enum SecurityEventType {
    LOGIN_SUCCESS = 'login_success',
    LOGIN_FAILED = 'login_failed',
    REGISTER_SUCCESS = 'register_success',
    LOGOUT = 'logout',
    UNAUTHORIZED_ACCESS = 'unauthorized_access',
    PERMISSION_DENIED = 'permission_denied',
    RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
    SUSPICIOUS_ACTIVITY = 'suspicious_activity',
    ADMIN_ACTION = 'admin_action'
}

// ==================== 登录失败锁定 ====================

interface LoginAttempt {
    count: number
    lastAttempt: number
    lockedUntil: number | null
}

const loginAttempts = new Map<string, LoginAttempt>()

const LOGIN_CONFIG = {
    maxAttempts: 5,
    lockDuration: 15 * 60 * 1000,  // 15分钟
    attemptWindow: 5 * 60 * 1000   // 5分钟内的尝试计数
}


/**
 * 检查登录是否被锁定
 */
export function checkLoginLock(ip: string, username: string): { locked: boolean; retryAfter?: number } {
    const key = `${ip}:${username}`
    const attempt = loginAttempts.get(key)

    if (!attempt) {
        return { locked: false }
    }

    // 检查是否在锁定期内
    if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
        const retryAfter = Math.ceil((attempt.lockedUntil - Date.now()) / 1000)
        return { locked: true, retryAfter }
    }

    // 锁定期已过，重置
    if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
        loginAttempts.delete(key)
        return { locked: false }
    }

    return { locked: false }
}

/**
 * 记录登录失败
 */
export function recordLoginFailure(ip: string, username: string): void {
    const key = `${ip}:${username}`
    const now = Date.now()
    const attempt = loginAttempts.get(key)

    if (!attempt || (now - attempt.lastAttempt > LOGIN_CONFIG.attemptWindow)) {
        // 新的尝试周期
        loginAttempts.set(key, { count: 1, lastAttempt: now, lockedUntil: null })
        return
    }

    // 增加计数
    attempt.count++
    attempt.lastAttempt = now

    // 达到最大尝试次数，锁定账户
    if (attempt.count >= LOGIN_CONFIG.maxAttempts) {
        attempt.lockedUntil = now + LOGIN_CONFIG.lockDuration
    }

    loginAttempts.set(key, attempt)
}

/**
 * 清除登录失败记录（登录成功时调用）
 */
export function clearLoginFailure(ip: string, username: string): void {
    const key = `${ip}:${username}`
    loginAttempts.delete(key)
}

// ==================== 密码策略 ====================

export interface PasswordValidationResult {
    valid: boolean
    message?: string
}

/**
 * 验证密码强度
 * 要求：至少8字符，包含大写字母、小写字母和数字
 */
export function validatePassword(password: string): PasswordValidationResult {
    if (password.length < 8) {
        return { valid: false, message: 'Password must be at least 8 characters' }
    }

    if (password.length > 128) {
        return { valid: false, message: 'Password cannot exceed 128 characters' }
    }

    // 严格密码策略：必须包含大写、小写和数字
    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one uppercase letter' }
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one lowercase letter' }
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one number' }
    }

    return { valid: true }
}

// ==================== 安全日志 ====================

/**
 * 记录安全事件
 * 使用操作码存储，前端翻译显示
 */
export async function logSecurityEvent(
    type: SecurityEventType,
    userId: number | null,
    details: {
        ip?: string
        userAgent?: string
        resource?: string
        action?: string
        reason?: string
        username?: string
    }
): Promise<void> {
    try {
        // Use action code, frontend translates
        let action: string = type  // Use SecurityEventType as action
        let content = ''

        // Generate content based on type (use simple identifiers, frontend can translate)
        // 辅助函数：拼接用户名和IP
        const formatUserIp = (username?: string, ip?: string) => {
            const parts: string[] = []
            if (username) parts.push(username)
            if (ip) parts.push(`[IP: ${ip}]`)
            return parts.join(' ') || ''
        }

        if (type === SecurityEventType.REGISTER_SUCCESS) {
            content = formatUserIp(details.username, details.ip)
        } else if (type === SecurityEventType.LOGIN_SUCCESS) {
            content = formatUserIp(details.username, details.ip)
        } else if (type === SecurityEventType.LOGIN_FAILED) {
            // 登录失败记录更多信息
            const parts: string[] = []
            if (details.username) parts.push(details.username)
            if (details.reason) parts.push(`[原因: ${details.reason}]`)
            if (details.ip) parts.push(`[IP: ${details.ip}]`)
            content = parts.join(' ') || ''
        } else if (type === SecurityEventType.LOGOUT) {
            content = formatUserIp(details.username, details.ip)
        } else if (type === SecurityEventType.RATE_LIMIT_EXCEEDED) {
            // 频率限制记录更多信息
            const parts: string[] = []
            if (details.username) parts.push(details.username)
            if (details.reason) parts.push(`[原因: ${details.reason}]`)
            if (details.ip) parts.push(`[IP: ${details.ip}]`)
            content = parts.join(' ') || ''
        } else if (type === SecurityEventType.SUSPICIOUS_ACTIVITY) {
            action = details.action === 'register' ? 'invalid_invite_code' : 'suspicious_activity'
            // 记录完整的可疑活动信息：操作类型 + 原因 + 用户名/邮箱
            const parts: string[] = []
            if (details.action) parts.push(`[操作: ${details.action}]`)
            if (details.reason) parts.push(`[原因: ${details.reason}]`)
            if (details.username) parts.push(`[用户: ${details.username}]`)
            if (details.ip) parts.push(`[IP: ${details.ip}]`)
            content = parts.join(' ') || '可疑活动'
        } else if (type === SecurityEventType.PERMISSION_DENIED) {
            content = details.resource || ''
        }

        const result = type.includes('failed') || type.includes('denied') || type === 'rate_limit_exceeded' || type === 'suspicious_activity' ? 'warning' : 'success'

        await createLog(userId, LogModule.SECURITY, action, content, result)
    } catch (error) {
        // 日志记录失败不应该影响主业务流程
        console.error('Security event log failed:', error)
    }
}

// ==================== 输入清理与验证 ====================

/**
 * 危险字符正则表达式
 * 禁止: ' " \ / ? ] [ = + . < > ` ; : | ! @ # $ % ^ & * { } ~
 * 允许: ( ) 空格 , 
 */
const DANGEROUS_CHARS_REGEX = /['"\\\/?[\]=+.<>`;\:|!@#$%^&*\{\}~]/g

/**
 * 安全名称正则（只允许字母、数字、连字符、下划线、空格、逗号、圆括号和中文）
 */
const SAFE_NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9\-_ ,()]+$/

/**
 * 严格名称正则（只允许字母、数字、连字符、下划线，用于技术标识符）
 */
const STRICT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/

/**
 * 输入验证结果
 */
export interface InputValidationResult {
    valid: boolean
    message?: string
    sanitized?: string
}

/**
 * 检查字符串是否包含危险字符
 */
export function containsDangerousChars(input: string): boolean {
    return DANGEROUS_CHARS_REGEX.test(input)
}

/**
 * 移除危险字符
 */
export function removeDangerousChars(input: string): string {
    return input.replace(DANGEROUS_CHARS_REGEX, '')
}

/**
 * 验证通用名称输入（允许中文、字母、数字、连字符、下划线、空格）
 * 适用于：实例名称、套餐名称、节点组名称等用户可见的名称
 */
export function validateName(name: string, fieldName: string = 'Name', minLength: number = 1, maxLength: number = 64): InputValidationResult {
    if (!name || typeof name !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = name.trim()

    if (trimmed.length < minLength) {
        return { valid: false, message: `${fieldName} must be at least ${minLength} characters` }
    }

    if (trimmed.length > maxLength) {
        return { valid: false, message: `${fieldName} cannot exceed ${maxLength} characters` }
    }

    if (containsDangerousChars(trimmed)) {
        return { valid: false, message: `${fieldName} contains illegal characters` }
    }

    if (!SAFE_NAME_REGEX.test(trimmed)) {
        return { valid: false, message: `${fieldName} can only contain letters, numbers, Chinese, hyphens, underscores, spaces, commas and parentheses` }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证技术标识符（只允许字母、数字、连字符、下划线，必须以字母或数字开头）
 * 适用于：用户名、实例技术ID、主机名等
 */
export function validateIdentifier(input: string, fieldName: string = 'Identifier', minLength: number = 2, maxLength: number = 64): InputValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = input.trim()

    if (trimmed.length < minLength) {
        return { valid: false, message: `${fieldName} must be at least ${minLength} characters` }
    }

    if (trimmed.length > maxLength) {
        return { valid: false, message: `${fieldName} cannot exceed ${maxLength} characters` }
    }

    if (!STRICT_NAME_REGEX.test(trimmed)) {
        return { valid: false, message: `${fieldName} can only contain letters, numbers, hyphens and underscores, and must start with a letter or number` }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证通用文本输入（移除危险字符但允许更多内容）
 * 适用于：描述、备注等长文本
 */
export function validateText(text: string, fieldName: string = 'Content', maxLength: number = 1000): InputValidationResult {
    if (!text || typeof text !== 'string') {
        return { valid: true, sanitized: '' }
    }

    if (text.length > maxLength) {
        return { valid: false, message: `${fieldName} cannot exceed ${maxLength} characters` }
    }

    // 移除危险字符但保留其他内容
    const sanitized = removeDangerousChars(text).trim()

    return { valid: true, sanitized }
}

/**
 * 验证URL格式
 */
export function validateUrl(url: string, fieldName: string = 'URL'): InputValidationResult {
    if (!url || typeof url !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = url.trim()

    // 基本URL格式验证
    try {
        new URL(trimmed)
    } catch {
        return { valid: false, message: `${fieldName} format is invalid` }
    }

    // 只允许 http 和 https 协议
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return { valid: false, message: `${fieldName} must start with http:// or https://` }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证IP地址格式
 */
export function validateIpAddress(ip: string, fieldName: string = 'IP address'): InputValidationResult {
    if (!ip || typeof ip !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = normalizeHostAddress(ip)

    // IPv4 格式验证
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

    if (!ipv4Regex.test(trimmed) && !isValidIpv6Address(trimmed)) {
        return { valid: false, message: `${fieldName} format is invalid` }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证 IPv4 地址格式（仅支持 IPv4，不支持域名）
 * 适用于：NAT 网卡 IP
 */
export function validateIpv4(input: string, fieldName: string = 'IP address'): InputValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = input.trim()
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    if (ipv4Regex.test(trimmed)) {
        return { valid: true, sanitized: trimmed }
    }

    return { valid: false, message: `${fieldName} format is invalid, please enter a valid IPv4 address` }
}

/**
 * 验证主机地址格式
 * 适用于：连接地址（支持 IPv4、IPv6 或域名）
 */
export function validateIpOrDomain(input: string, fieldName: string = 'IP address or domain'): InputValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: `${fieldName} cannot be empty` }
    }

    const trimmed = normalizeHostAddress(input)

    // 长度限制（域名最长 253 字符）
    if (trimmed.length > 253) {
        return { valid: false, message: `${fieldName} cannot exceed 253 characters` }
    }

    // 先尝试验证为 IPv4 地址
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    
    if (ipv4Regex.test(trimmed)) {
        return { valid: true, sanitized: trimmed }
    }

    if (isValidIpv6Address(trimmed)) {
        return { valid: true, sanitized: trimmed }
    }

    // 验证域名格式
    // 域名规则：
    // 1. 只能包含字母、数字、连字符和点
    // 2. 不能以连字符或点开头/结尾
    // 3. 每个标签（由点分隔的部分）长度不超过 63 字符
    // 4. 总长度不超过 253 字符
    // 5. 支持多级域名（如 subdomain.example.com）
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
    
    if (domainRegex.test(trimmed)) {
        // 检查每个标签的长度
        const labels = trimmed.split('.')
        for (const label of labels) {
            if (label.length > 63) {
                return { valid: false, message: `${fieldName} format is invalid: domain label cannot exceed 63 characters` }
            }
        }
        return { valid: true, sanitized: trimmed }
    }

    return { valid: false, message: `${fieldName} format is invalid, please enter a valid IPv4 address, IPv6 address, or domain name` }
}

function normalizeHostAddress(input: string): string {
    const trimmed = input.trim()

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim()
        if (inner.includes(':')) {
            return inner
        }
    }

    return trimmed
}

function isValidIpv6Address(input: string): boolean {
    if (!input || !input.includes(':')) {
        return false
    }

    try {
        new URL(`http://[${input}]/`)
        return true
    } catch {
        return false
    }
}

/**
 * 验证文件路径（防止路径遍历攻击）
 */
export function validateFilePath(path: string, fieldName: string = '文件路径'): InputValidationResult {
    if (!path || typeof path !== 'string') {
        return { valid: false, message: `${fieldName}不能为空` }
    }

    const trimmed = path.trim()

    // 检查路径遍历攻击
    if (trimmed.includes('..') || trimmed.includes('\0')) {
        return { valid: false, message: `${fieldName}包含非法字符` }
    }

    // 检查危险字符（但允许 / 和 \ ）
    const pathDangerousChars = /['"`<>|;$&]/
    if (pathDangerousChars.test(trimmed)) {
        return { valid: false, message: `${fieldName}包含非法字符` }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 清理实例名称（防止注入）
 */
export function sanitizeInstanceName(name: string): string {
    // 只允许字母、数字、连字符和下划线
    return name.replace(/[^a-zA-Z0-9-_]/g, '')
}

/**
 * 验证实例名称格式
 */
export function isValidInstanceName(name: string): boolean {
    // 必须以字母或数字开头，只能包含字母、数字、连字符和下划线
    return /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(name)
}

/**
 * 批量验证输入
 */
export function validateInputs(validations: Array<{ value: unknown; validator: () => InputValidationResult }>): InputValidationResult {
    for (const { validator } of validations) {
        const result = validator()
        if (!result.valid) {
            return result
        }
    }
    return { valid: true }
}

// ==================== JWT 配置检查 ====================

// JWT 与敏感字段加密配置检查放在独立模块，避免配置自测触发数据库初始化。
export { checkJwtConfig } from './security-config.js'


// ==================== Refresh Token 管理 (数据库) ====================

import { prisma } from '../db/prisma.js'

interface RefreshTokenData {
    userId: number
    username: string
    role: 'admin' | 'user'
    createdAt: number
    expiresAt: number
    ip?: string
    userAgent?: string
    lastActiveAt?: number
}

// 会话信息（用于前端展示）
export interface SessionInfo {
    token: string  // Token 的短 ID（用于撤销）
    ip: string
    userAgent: string
    createdAt: number
    lastActiveAt: number
    isCurrent: boolean
}

// Refresh Token 配置（简化版：延长有效期，减少刷新频率）
const REFRESH_TOKEN_CONFIG = {
    expiresInSeconds: 30 * 24 * 60 * 60,  // 30天
}
const REFRESH_TOKEN_STORAGE_PREFIX = 'sha256:'

export function getRefreshTokenStorageKey(token: string): string {
    if (token.startsWith(REFRESH_TOKEN_STORAGE_PREFIX) && token.length === REFRESH_TOKEN_STORAGE_PREFIX.length + 64) {
        return token
    }
    return `${REFRESH_TOKEN_STORAGE_PREFIX}${crypto.createHash('sha256').update(token).digest('hex')}`
}

export function getRefreshTokenSessionId(token: string): string {
    const storageKey = getRefreshTokenStorageKey(token)
    return storageKey.slice(REFRESH_TOKEN_STORAGE_PREFIX.length, REFRESH_TOKEN_STORAGE_PREFIX.length + 32)
}

function getRefreshTokenLookupKeys(token: string): string[] {
    const storageKey = getRefreshTokenStorageKey(token)
    return storageKey === token ? [storageKey] : [storageKey, token]
}

// 导出任务内存存储（替代 Redis）
const exportTaskStore = new Map<string, ExportTaskData>()
const EXPORT_TASK_TTL = 30 * 60 * 1000  // 30分钟（毫秒）

// 定期清理过期数据（每5分钟执行一次）
setInterval(() => {
    const now = Date.now()
    // 清理过期导出任务
    for (const [id, task] of exportTaskStore.entries()) {
        if (task.expiresAt < now) {
            exportTaskStore.delete(id)
        }
    }
}, 5 * 60 * 1000)

/**
 * 清理过期的 Refresh Token（定期任务）
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
    const now = new Date()
    const result = await prisma.refreshToken.deleteMany({
        where: {
            expiresAt: {
                lt: now
            }
        }
    })
    return result.count
}

/**
 * 清理过期的 Token 失效标记（定期任务）
 * 删除超过 30 天的失效标记，因为对应的 JWT 早已过期
 */
export async function cleanupExpiredTokenInvalidations(): Promise<number> {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
    const result = await prisma.tokenInvalidation.deleteMany({
        where: {
            invalidatedAt: {
                lt: thirtyDaysAgo
            }
        }
    })
    return result.count
}

/**
 * 生成 Refresh Token (异步，存储到数据库)
 */
export async function generateRefreshToken(
    userId: number,
    username: string,
    role: 'admin' | 'user',
    ip?: string,
    userAgent?: string
): Promise<string> {
    const token = `rt_${crypto.randomBytes(32).toString('base64url')}`
    const tokenHash = getRefreshTokenStorageKey(token)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_CONFIG.expiresInSeconds * 1000)

    // 存储到数据库
    await prisma.refreshToken.create({
        data: {
            token: tokenHash,
            userId,
            username,
            role,
            ip: ip || 'unknown',
            userAgent: userAgent || 'unknown',
            createdAt: now,
            expiresAt,
            lastActiveAt: now
        }
    })

    return token
}

/**
 * AUTH002: 设备绑定配置
 */
const DEVICE_BINDING_CONFIG = {
    // 是否启用严格的设备绑定（强制要求IP匹配）
    strictMode: process.env.DEVICE_BINDING_STRICT === 'true',
    // 是否启用User-Agent检查
    checkUserAgent: process.env.DEVICE_BINDING_CHECK_UA !== 'false',
    // 是否在设备不匹配时记录日志（而不是拒绝）
    logOnlyMode: process.env.DEVICE_BINDING_LOG_ONLY === 'true',
} as const

/**
 * AUTH002: 标准化User-Agent用于比较
 * 提取浏览器和操作系统的核心信息
 */
function normalizeUserAgentForBinding(ua: string | undefined): string {
    if (!ua || ua === 'unknown') return 'unknown'
    
    // 提取浏览器
    let browser = 'unknown'
    if (ua.includes('Firefox')) browser = 'firefox'
    else if (ua.includes('Edg')) browser = 'edge'
    else if (ua.includes('Chrome')) browser = 'chrome'
    else if (ua.includes('Safari')) browser = 'safari'
    else if (ua.includes('Opera')) browser = 'opera'
    
    // 提取操作系统
    let os = 'unknown'
    if (/Windows NT 10/i.test(ua)) os = 'win10'
    else if (/Windows NT/i.test(ua)) os = 'windows'
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macos'
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios'
    else if (/Android/i.test(ua)) os = 'android'
    else if (/Linux/i.test(ua)) os = 'linux'
    
    // 检测移动端
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua)
    
    return `${browser}|${os}|${isMobile ? 'm' : 'd'}`
}

/**
 * AUTH002: 验证设备绑定
 * @returns 是否匹配，以及不匹配的原因
 */
export function validateDeviceBinding(
    storedIp: string | undefined,
    storedUserAgent: string | undefined,
    currentIp: string | undefined,
    currentUserAgent: string | undefined
): { valid: boolean; reason?: string } {
    // 严格模式：检查IP
    if (DEVICE_BINDING_CONFIG.strictMode) {
        if (storedIp && currentIp && storedIp !== currentIp) {
            return { valid: false, reason: `IP mismatch: expected ${storedIp}, got ${currentIp}` }
        }
    }
    
    // 检查User-Agent（标准化后比较）
    if (DEVICE_BINDING_CONFIG.checkUserAgent) {
        const storedFingerprint = normalizeUserAgentForBinding(storedUserAgent)
        const currentFingerprint = normalizeUserAgentForBinding(currentUserAgent)
        
        if (storedFingerprint !== 'unknown' && currentFingerprint !== 'unknown') {
            if (storedFingerprint !== currentFingerprint) {
                return { 
                    valid: false, 
                    reason: `Device fingerprint mismatch: expected ${storedFingerprint}, got ${currentFingerprint}` 
                }
            }
        }
    }
    
    return { valid: true }
}

/**
 * 验证 Refresh Token (异步)
 * 简化版：移除设备绑定校验，仅验证 token 有效性
 */
export async function verifyRefreshToken(
    token: string,
    _currentIp?: string,
    _currentUserAgent?: string
): Promise<RefreshTokenData | null> {
    try {
        const storageKey = getRefreshTokenStorageKey(token)
        let record = await prisma.refreshToken.findUnique({
            where: { token: storageKey }
        })

        if (!record && storageKey !== token) {
            record = await prisma.refreshToken.findUnique({
                where: { token }
            })
        }

        if (!record) {
            return null
        }

        // 检查是否过期
        const now = Date.now()
        const expiresAt = record.expiresAt.getTime()
        if (now > expiresAt) {
            // 自动清理过期 token
            await prisma.refreshToken.delete({
                where: { id: record.id }
            })
            return null
        }

        // 注意：已移除设备绑定校验 (AUTH002)，简化会话机制
        if (record.token === token && storageKey !== token) {
            await prisma.refreshToken.update({
                where: { id: record.id },
                data: { token: storageKey }
            }).catch(() => undefined)
        }

        return {
            userId: record.userId,
            username: record.username,
            role: record.role as 'admin' | 'user',
            createdAt: record.createdAt.getTime(),
            expiresAt: expiresAt,
            ip: record.ip || undefined,
            userAgent: record.userAgent || undefined,
            lastActiveAt: record.lastActiveAt.getTime()
        }
    } catch {
        return null
    }
}

/**
 * 撤销 Refresh Token (异步)
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
    try {
        const result = await prisma.refreshToken.deleteMany({
            where: { token: { in: getRefreshTokenLookupKeys(token) } }
        })
        return result.count > 0
    } catch {
        return false
    }
}

/**
 * 撤销用户的所有 Refresh Token (异步)
 */
export async function revokeAllUserRefreshTokens(userId: number): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
        where: { userId }
    })
    return result.count
}

/**
 * 获取用户的所有会话信息
 */
export async function getUserSessions(userId: number, currentToken?: string): Promise<SessionInfo[]> {
    const now = new Date()
    const tokens = await prisma.refreshToken.findMany({
        where: {
            userId,
            expiresAt: {
                gt: now  // 只获取未过期的 token
            }
        },
        orderBy: {
            lastActiveAt: 'desc'
        }
    })

    const currentTokenKeys = currentToken ? new Set(getRefreshTokenLookupKeys(currentToken)) : new Set<string>()

    return tokens.map(token => ({
        token: getRefreshTokenSessionId(token.token) + '...',
        ip: token.ip || 'unknown',
        userAgent: token.userAgent || 'unknown',
        createdAt: token.createdAt.getTime(),
        lastActiveAt: token.lastActiveAt.getTime(),
        isCurrent: currentTokenKeys.has(token.token)
    }))
}

/**
 * 通过 Token 短 ID 撤销会话
 */
export async function revokeSessionByTokenPrefix(userId: number, tokenPrefix: string): Promise<boolean> {
    // 移除 '...' 后缀（如果有）
    const prefix = tokenPrefix.replace('...', '')
    
    // 查找匹配的 token/session id，兼容旧明文行和新 sha256 摘要行
    const tokens = await prisma.refreshToken.findMany({
        where: {
            userId
        }
    })
    const token = tokens.find(item =>
        item.token.startsWith(`${REFRESH_TOKEN_STORAGE_PREFIX}${prefix}`) ||
        item.token.startsWith(prefix) ||
        getRefreshTokenSessionId(item.token).startsWith(prefix)
    )

    if (token) {
        await prisma.refreshToken.delete({ where: { id: token.id } })
        return true
    }

    return false
}

/**
 * 更新会话的最后活跃时间并延长过期时间
 * 每次用户活跃时，将会话有效期延长至新的3天周期
 */
export async function updateSessionActivity(token: string): Promise<{ expiresAt: Date } | null> {
    try {
        const now = new Date()
        const newExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_CONFIG.expiresInSeconds * 1000)
        
        await prisma.refreshToken.updateMany({
            where: { token: { in: getRefreshTokenLookupKeys(token) } },
            data: { 
                lastActiveAt: now,
                expiresAt: newExpiresAt  // 延长会话有效期
            }
        })
        
        return { expiresAt: newExpiresAt }
    } catch {
        // 忽略错误，不影响认证流程
        return null
    }
}

// ==================== Access Token 失效机制 (数据库) ====================

/**
 * 使用户的所有 Access Token 失效
 * 通过记录一个时间戳，所有在此时间戳之前签发的 token 都将被视为无效
 */
export async function invalidateUserAccessTokens(userId: number): Promise<void> {
    try {
        const now = Math.floor(Date.now() / 1000)  // 使用秒级时间戳，与 JWT iat 一致
        const USER_LEVEL_SESSION_ID = '__USER_LEVEL__'  // 特殊标记表示用户级别失效
        
        // 使用 upsert 确保每个用户只有一条记录
        await prisma.tokenInvalidation.upsert({
            where: {
                userId_sessionId: {
                    userId,
                    sessionId: USER_LEVEL_SESSION_ID
                }
            },
            create: {
                userId,
                sessionId: USER_LEVEL_SESSION_ID,
                invalidatedAt: now
            },
            update: {
                invalidatedAt: now
            }
        })
    } catch (error) {
        // 记录错误但不抛出，避免影响其他功能
        console.error('Failed to invalidate user tokens:', error)
    }
}

/**
 * 标记特定会话的 Access Token 失效
 * @param userId 用户ID
 * @param sessionId 会话标识（Refresh Token 的前缀）
 */
export async function invalidateSessionAccessToken(userId: number, sessionId: string): Promise<void> {
    try {
        const now = Math.floor(Date.now() / 1000)
        await prisma.tokenInvalidation.upsert({
            where: {
                userId_sessionId: {
                    userId,
                    sessionId: sessionId
                }
            },
            create: {
                userId,
                sessionId: sessionId,
                invalidatedAt: now
            },
            update: {
                invalidatedAt: now
            }
        })
    } catch (error) {
        // 记录错误但不抛出，避免影响其他功能
        console.error('Failed to invalidate session token:', error)
    }
}

/**
 * 检查 Access Token 是否已被失效
 * @param userId 用户ID
 * @param tokenIssuedAt Token 签发时间（秒级时间戳）
 * @param sessionId 可选的会话标识
 * @returns true 表示 token 已失效，false 表示有效
 * 
 * 注意：如果数据库查询失败，返回 false（允许 token 通过），避免 Redis 不可用导致频繁登出
 */
export async function isAccessTokenInvalidated(userId: number, tokenIssuedAt: number, sessionId?: string): Promise<boolean> {
    try {
        // 检查会话级别的失效（优先级更高）
        if (sessionId) {
            const sessionInvalidation = await prisma.tokenInvalidation.findUnique({
                where: {
                    userId_sessionId: {
                        userId,
                        sessionId: sessionId
                    }
                }
            })

            if (sessionInvalidation && tokenIssuedAt <= sessionInvalidation.invalidatedAt) {
                return true
            }
        }

        // 检查用户级别的失效
        const USER_LEVEL_SESSION_ID = '__USER_LEVEL__'  // 特殊标记表示用户级别失效
        const userInvalidation = await prisma.tokenInvalidation.findUnique({
            where: {
                userId_sessionId: {
                    userId,
                    sessionId: USER_LEVEL_SESSION_ID
                }
            }
        })

        if (userInvalidation && tokenIssuedAt <= userInvalidation.invalidatedAt) {
            return true
        }

        return false
    } catch (error) {
        // 数据库查询失败时，返回 false（允许 token 通过），避免 Redis 不可用导致频繁登出
        console.error('Failed to check token invalidation, allowing token:', error)
        return false
    }
}


// ==================== 敏感数据加密 ====================

import crypto from 'crypto'

export function getJwtSigningSecret(purpose = 'token signing'): string {
    const secret = process.env.JWT_SECRET
    if (secret) {
        return secret
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error(`JWT_SECRET is required in production for ${purpose}`)
    }

    return 'dev-secret-change-in-production'
}

// 加密配置
const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    tagLength: 16
}

/**
 * 获取加密密钥
 */
function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_KEY ||
        (process.env.NODE_ENV === 'production' ? '' : process.env.JWT_SECRET || 'default-encryption-key')
    if (!secret) {
        throw new Error('ENCRYPTION_KEY is required in production')
    }
    // 使用 SHA-256 确保密钥长度为 32 字节
    return crypto.createHash('sha256').update(secret).digest()
}

/**
 * 加密敏感数据
 */
export function encryptSensitiveData(plaintext: string): string {
    const key = getEncryptionKey()
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength)

    const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, key, iv) as crypto.CipherGCM

    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const tag = cipher.getAuthTag()

    // 格式: iv:tag:encrypted
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

/**
 * 解密敏感数据
 */
export function decryptSensitiveData(ciphertext: string): string | null {
    try {
        const parts = ciphertext.split(':')
        if (parts.length !== 3) {
            // 可能是未加密的旧数据，直接返回
            return ciphertext
        }

        const [ivHex, tagHex, encrypted] = parts
        const key = getEncryptionKey()
        const iv = Buffer.from(ivHex, 'hex')
        const tag = Buffer.from(tagHex, 'hex')

        const decipher = crypto.createDecipheriv(ENCRYPTION_CONFIG.algorithm, key, iv) as crypto.DecipherGCM
        decipher.setAuthTag(tag)

        let decrypted = decipher.update(encrypted, 'hex', 'utf8')
        decrypted += decipher.final('utf8')

        return decrypted
    } catch (err) {
        // Decryption failed, might be unencrypted old data
        console.warn('Decryption failed, returning original data')
        return ciphertext
    }
}

/**
 * 检查数据是否已加密
 */
export function isEncrypted(data: string): boolean {
    const parts = data.split(':')
    if (parts.length !== 3) return false

    // 检查格式是否符合 iv:tag:encrypted
    const [ivHex, tagHex] = parts
    return ivHex.length === ENCRYPTION_CONFIG.ivLength * 2 &&
        tagHex.length === ENCRYPTION_CONFIG.tagLength * 2
}


// ==================== 双因素认证 (2FA) ====================

import { authenticator } from 'otplib'
import QRCode from 'qrcode'

// 2FA 配置
const TWO_FACTOR_CONFIG = {
    issuer: 'Incudal',
    algorithm: 'sha1',
    digits: 6,
    period: 30
}

// 配置 authenticator
authenticator.options = {
    digits: TWO_FACTOR_CONFIG.digits,
    period: TWO_FACTOR_CONFIG.period
}

/**
 * 生成 2FA 密钥
 */
export function generate2FASecret(): string {
    return authenticator.generateSecret()
}

/**
 * 生成 2FA 配置 URI (用于生成二维码)
 */
export function generate2FAKeyUri(username: string, secret: string): string {
    return authenticator.keyuri(username, TWO_FACTOR_CONFIG.issuer, secret)
}

/**
 * 生成 2FA 二维码 (Base64 Data URL)
 */
export async function generate2FAQRCode(username: string, secret: string): Promise<string> {
    const uri = generate2FAKeyUri(username, secret)
    return QRCode.toDataURL(uri)
}

/**
 * 验证 2FA 令牌
 */
export function verify2FAToken(token: string, secret: string): boolean {
    try {
        return authenticator.verify({ token, secret })
    } catch {
        return false
    }
}

/**
 * 生成备用恢复码 (一次性使用)
 */
export function generateRecoveryCodes(count: number = 8): string[] {
    const codes: string[] = []
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const segment = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')

    for (let i = 0; i < count; i++) {
        codes.push(`${segment()}-${segment()}`)
    }
    return codes
}


// ==================== 导出任务内存存储 ====================

export interface ExportTaskData {
    id: string
    instanceId: number
    backupId: number
    incusBackupName: string
    userId: number
    status: 'creating' | 'ready' | 'downloading' | 'completed' | 'error'
    error?: string
    createdAt: number
    expiresAt: number
}

/**
 * 创建导出任务（内存存储）
 */
export async function createExportTask(data: Omit<ExportTaskData, 'createdAt' | 'expiresAt'>): Promise<ExportTaskData> {
    const now = Date.now()

    const task: ExportTaskData = {
        ...data,
        createdAt: now,
        expiresAt: now + EXPORT_TASK_TTL
    }

    exportTaskStore.set(data.id, task)
    return task
}

/**
 * 获取导出任务
 */
export async function getExportTask(taskId: string): Promise<ExportTaskData | null> {
    const task = exportTaskStore.get(taskId)
    
    if (!task) {
        return null
    }

    // 检查是否过期
    if (Date.now() > task.expiresAt) {
        exportTaskStore.delete(taskId)
        return null
    }

    return task
}

/**
 * 更新导出任务状态
 */
export async function updateExportTaskStatus(
    taskId: string,
    status: ExportTaskData['status'],
    error?: string
): Promise<boolean> {
    const task = exportTaskStore.get(taskId)
    
    if (!task) {
        return false
    }

    // 检查是否过期
    if (Date.now() > task.expiresAt) {
        exportTaskStore.delete(taskId)
        return false
    }

    task.status = status
    if (error) {
        task.error = error
    }

    exportTaskStore.set(taskId, task)
    return true
}

/**
 * 删除导出任务
 */
export async function deleteExportTask(taskId: string): Promise<boolean> {
    return exportTaskStore.delete(taskId)
}

// ==================== OAuth State 验证（JWT 签名，无需存储） ====================

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000  // 10分钟（毫秒）

export interface OAuthStateData {
    mode: 'login' | 'bind'
    redirect: string
    timestamp: number
    nonce: string  // 防止重放攻击
    userId?: number  // 绑定模式下的用户 ID
    userIssuedAt?: number  // 绑定模式下发起绑定的 Access Token 签发时间
    userSessionId?: string  // 绑定模式下发起绑定的会话 ID
}

// 用于签名 OAuth State 的密钥（使用 JWT_SECRET）
function getOAuthStateSecret(): string {
    return getJwtSigningSecret('OAuth state and login-code signing')
}

/**
 * 生成 OAuth State（使用 JWT 签名，无需存储）
 */
export async function generateOAuthState(
    mode: 'login' | 'bind',
    redirect: string,
    bindSession?: { userId: number; issuedAt: number; sessionId?: string }
): Promise<string> {
    const nonce = crypto.randomBytes(16).toString('hex')
    const timestamp = Date.now()

    const data: OAuthStateData = {
        mode,
        redirect,
        timestamp,
        nonce,
        userId: bindSession?.userId,
        userIssuedAt: bindSession?.issuedAt,
        userSessionId: bindSession?.sessionId
    }

    // 将数据编码为 Base64
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
    
    // 生成 HMAC 签名
    const signature = crypto
        .createHmac('sha256', getOAuthStateSecret())
        .update(payload)
        .digest('base64url')

    // 返回签名后的 state: payload.signature
    return `${payload}.${signature}`
}

// 已使用的 nonce 集合（防止重放攻击）
const usedNonces = new Set<string>()

// 定期清理过期 nonce（每10分钟）
setInterval(() => {
    usedNonces.clear()
}, 10 * 60 * 1000)

/**
 * 验证并消费 OAuth State
 * 验证签名和时戳，并检查 nonce 防止重放攻击
 */
export async function verifyAndConsumeOAuthState(stateToken: string): Promise<OAuthStateData | null> {
    try {
        const parts = stateToken.split('.')
        if (parts.length !== 2) {
            return null
        }

        const [payload, signature] = parts

        // 验证签名
        const expectedSignature = crypto
            .createHmac('sha256', getOAuthStateSecret())
            .update(payload)
            .digest('base64url')

        if (signature !== expectedSignature) {
            return null
        }

        // 解码数据
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthStateData

        // 检查时戳是否过期
        if (Date.now() - data.timestamp > OAUTH_STATE_TTL_MS) {
            return null
        }

        // 检查 nonce 是否已被使用（防止重放攻击）
        if (usedNonces.has(data.nonce)) {
            return null
        }

        // 标记 nonce 已使用
        usedNonces.add(data.nonce)

        return data
    } catch {
        return null
    }
}

// ==================== 增强审计日志 ====================

export interface AuditLogDetails {
    ip?: string
    userAgent?: string
    targetUserId?: number
    targetUsername?: string
    resourceType?: string
    resourceId?: number | string
    resourceName?: string
    oldValue?: unknown
    newValue?: unknown
    reason?: string
    metadata?: Record<string, unknown>
}

/**
 * 记录增强审计日志
 * 用于敏感操作的详细记录
 */
export async function logAuditEvent(
    userId: number | null,
    module: string,
    action: string,
    details: AuditLogDetails
): Promise<void> {
    try {
        // 构建详细内容
        const contentParts: string[] = []

        if (details.targetUsername) {
            contentParts.push(`target: ${details.targetUsername}`)
        }
        if (details.resourceType && details.resourceName) {
            contentParts.push(`${details.resourceType}: ${details.resourceName}`)
        }
        if (details.reason) {
            contentParts.push(`reason: ${details.reason}`)
        }

        const content = contentParts.join(', ')

        // 记录到数据库
        await createLog(userId, module as typeof LogModule[keyof typeof LogModule], action, content, 'success')

        // 如果是敏感操作，额外记录详细信息到控制台（生产环境可改为专门的审计日志系统）
        if (process.env.AUDIT_LOG_VERBOSE === 'true') {
            console.log('[AUDIT]', {
                timestamp: new Date().toISOString(),
                userId,
                module,
                action,
                ...details
            })
        }
    } catch (error) {
        console.error('Audit log failed:', error)
    }
}

/**
 * 记录管理员操作
 */
export async function logAdminAction(
    adminId: number,
    action: string,
    details: AuditLogDetails
): Promise<void> {
    await logAuditEvent(adminId, 'admin', action, {
        ...details,
        metadata: {
            ...details.metadata,
            isAdminAction: true
        }
    })
}

/**
 * 记录安全敏感操作
 */
export async function logSensitiveOperation(
    userId: number,
    operation: string,
    details: AuditLogDetails
): Promise<void> {
    await logAuditEvent(userId, 'security', operation, {
        ...details,
        metadata: {
            ...details.metadata,
            isSensitive: true
        }
    })
}

// ==================== 异地登录检测 ====================

/**
 * 检测是否为新 IP 或新设备登录
 * 注意：此函数应在创建新会话之前调用，以避免时序问题
 * 返回: { isNewIp: boolean, isNewDevice: boolean }
 * 
 * 修复：使用 LoginRecord 表（永久保存）代替 RefreshToken 表（登出时会删除）
 *       避免用户登出后再登录被误判为新设备
 */
export async function detectNewLoginLocation(
    userId: number,
    currentIp: string,
    currentUserAgent: string
): Promise<{ isNewIp: boolean; isNewDevice: boolean }> {
    try {
        // 查询用户最近 30 天内的登录记录（使用 LoginRecord 表，而非 RefreshToken）
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        
        const recentLoginRecords = await prisma.loginRecord.findMany({
            where: {
                userId,
                createdAt: { gte: thirtyDaysAgo }
            },
            select: {
                ip: true,
                userAgent: true
            },
            orderBy: { createdAt: 'desc' },
            take: 50  // 最多检查 50 个历史登录记录
        })

        // 如果没有历史记录，这是新用户或第一次登录，不发送提醒
        if (recentLoginRecords.length === 0) {
            return { isNewIp: false, isNewDevice: false }
        }

        // 检查是否为新 IP
        const knownIps = new Set(recentLoginRecords.map(s => s.ip).filter(Boolean))
        const isNewIp = !knownIps.has(currentIp)

        // 检查是否为新设备（简化版：比较 UserAgent 的主要部分）
        const normalizeUserAgent = (ua: string): string => {
            // 提取浏览器名称（不含版本号）和操作系统类型
            // 修复：不包含完整版本号，避免浏览器自动更新后误判为新设备
            const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|MSIE|Trident)/i)
            const browser = browserMatch?.[1]?.toLowerCase() || 'unknown'
            
            // 操作系统只提取类型，不包含具体版本
            let os = 'unknown'
            if (/Windows/i.test(ua)) os = 'windows'
            else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macos'
            else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios'
            else if (/Android/i.test(ua)) os = 'android'
            else if (/Linux/i.test(ua)) os = 'linux'
            else if (/CrOS/i.test(ua)) os = 'chromeos'
            
            // 检测移动端
            const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua)
            
            return `${browser}|${os}|${isMobile ? 'mobile' : 'desktop'}`
        }

        const currentFingerprint = normalizeUserAgent(currentUserAgent)
        const knownFingerprints = new Set(
            recentLoginRecords
                .map(s => s.userAgent)
                .filter(Boolean)
                .map(ua => normalizeUserAgent(ua as string))
        )
        const isNewDevice = !knownFingerprints.has(currentFingerprint)

        return { isNewIp, isNewDevice }
    } catch (error) {
        // 检测失败不应影响登录流程
        console.error('Failed to detect new login location:', error)
        return { isNewIp: false, isNewDevice: false }
    }
}

// ==================== OAuth 一次性登录码 ====================

/**
 * OAuth 登录码数据结构
 * 安全改进：不再包含 refreshToken，只传递用户标识
 */
export interface OAuthLoginCodeData {
    userId: number
    username: string
    role: string
    timestamp: number
    nonce: string
}

// OAuth 登录码有效期（60秒）
const OAUTH_LOGIN_CODE_TTL_MS = 60 * 1000

// 已使用的登录码 nonce 集合（防止重放攻击）
const usedLoginCodeNonces = new Set<string>()

// 定期清理过期 nonce（每2分钟）
setInterval(() => {
    usedLoginCodeNonces.clear()
}, 2 * 60 * 1000)

/**
 * 生成 OAuth 一次性登录码
 * 用于安全地传递登录信息，替代直接在 URL 中传递 Access Token
 */
export function generateOAuthLoginCode(data: Omit<OAuthLoginCodeData, 'timestamp' | 'nonce'>): string {
    const nonce = crypto.randomBytes(16).toString('hex')
    const timestamp = Date.now()

    const fullData: OAuthLoginCodeData = {
        ...data,
        timestamp,
        nonce
    }

    // 将数据编码为 Base64
    const payload = Buffer.from(JSON.stringify(fullData)).toString('base64url')
    
    // 生成 HMAC 签名
    const signature = crypto
        .createHmac('sha256', getOAuthStateSecret())
        .update(payload)
        .digest('base64url')

    // 返回签名后的 code: payload.signature
    return `${payload}.${signature}`
}

/**
 * 验证并消费 OAuth 登录码
 * 返回登录信息，或在无效时返回 null
 */
export function verifyAndConsumeOAuthLoginCode(code: string): OAuthLoginCodeData | null {
    try {
        const parts = code.split('.')
        if (parts.length !== 2) {
            return null
        }

        const [payload, signature] = parts

        // 验证签名
        const expectedSignature = crypto
            .createHmac('sha256', getOAuthStateSecret())
            .update(payload)
            .digest('base64url')

        if (signature !== expectedSignature) {
            return null
        }

        // 解码数据
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthLoginCodeData

        // 检查时戳是否过期（60秒）
        if (Date.now() - data.timestamp > OAUTH_LOGIN_CODE_TTL_MS) {
            return null
        }

        // 检查 nonce 是否已被使用（防止重放攻击）
        if (usedLoginCodeNonces.has(data.nonce)) {
            return null
        }

        // 标记 nonce 已使用
        usedLoginCodeNonces.add(data.nonce)

        return data
    } catch {
        return null
    }
}
