/**
 * 一次性下载 Token 管理
 * 用于备份导出等文件下载场景，避免 JWT 通过 URL 参数传递
 * 
 * 安全特性：
 * 1. 短期有效（默认5分钟）
 * 2. 使用次数限制（默认1次）
 * 3. 绑定特定资源
 * 4. 绑定特定用户
 */

import { nanoid } from 'nanoid'

export interface DownloadToken {
    userId: number
    resourceId: string
    resourceType: 'backup-export' | 'backup-download'
    expiresAt: number
    usageCount: number
    maxUsage: number
    createdAt: number
}

// 内存存储（生产环境可改用 Redis）
const downloadTokens = new Map<string, DownloadToken>()

// 定期清理过期 token（每5分钟）
setInterval(() => {
    const now = Date.now()
    for (const [token, data] of downloadTokens.entries()) {
        if (now > data.expiresAt) {
            downloadTokens.delete(token)
        }
    }
}, 5 * 60 * 1000)

/**
 * 生成一次性下载 Token
 * @param userId 用户 ID
 * @param resourceId 资源标识（如 taskId）
 * @param resourceType 资源类型
 * @param expiresInSeconds 有效期（秒），默认5分钟
 * @param maxUsage 最大使用次数，默认1次
 * @returns 生成的 token
 */
export function generateDownloadToken(
    userId: number,
    resourceId: string,
    resourceType: 'backup-export' | 'backup-download',
    expiresInSeconds: number = 300,
    maxUsage: number = 1
): string {
    // 使用 nanoid 生成安全随机 token
    const token = nanoid(32)
    
    downloadTokens.set(token, {
        userId,
        resourceId,
        resourceType,
        expiresAt: Date.now() + expiresInSeconds * 1000,
        usageCount: 0,
        maxUsage,
        createdAt: Date.now()
    })
    
    return token
}

export interface ConsumeResult {
    valid: boolean
    userId?: number
    resourceId?: string
    error?: string
}

/**
 * 消费（验证并使用）下载 Token
 * @param token 下载 token
 * @param expectedResourceId 期望的资源 ID（可选，用于额外验证）
 * @param expectedResourceType 期望的资源类型（可选）
 * @returns 验证结果
 */
export function consumeDownloadToken(
    token: string,
    expectedResourceId?: string,
    expectedResourceType?: 'backup-export' | 'backup-download'
): ConsumeResult {
    const data = downloadTokens.get(token)
    
    // Token 不存在
    if (!data) {
        return { valid: false, error: 'Token not found or already used' }
    }
    
    // Token 已过期
    if (Date.now() > data.expiresAt) {
        downloadTokens.delete(token)
        return { valid: false, error: 'Token expired' }
    }
    
    // 资源 ID 不匹配
    if (expectedResourceId && data.resourceId !== expectedResourceId) {
        return { valid: false, error: 'Resource mismatch' }
    }
    
    // 资源类型不匹配
    if (expectedResourceType && data.resourceType !== expectedResourceType) {
        return { valid: false, error: 'Resource type mismatch' }
    }
    
    // 增加使用计数
    data.usageCount++
    
    // 达到最大使用次数，删除 token
    if (data.usageCount >= data.maxUsage) {
        downloadTokens.delete(token)
    }
    
    return {
        valid: true,
        userId: data.userId,
        resourceId: data.resourceId
    }
}

/**
 * 检查 Token 是否有效（不消费）
 * @param token 下载 token
 * @returns 是否有效
 */
export function isDownloadTokenValid(token: string): boolean {
    const data = downloadTokens.get(token)
    if (!data) return false
    if (Date.now() > data.expiresAt) {
        downloadTokens.delete(token)
        return false
    }
    return data.usageCount < data.maxUsage
}

/**
 * 撤销下载 Token
 * @param token 下载 token
 */
export function revokeDownloadToken(token: string): void {
    downloadTokens.delete(token)
}

/**
 * 获取 Token 信息（用于调试）
 * @param token 下载 token
 * @returns Token 信息或 null
 */
export function getDownloadTokenInfo(token: string): Omit<DownloadToken, 'userId'> | null {
    const data = downloadTokens.get(token)
    if (!data) return null
    
    // 不返回 userId，避免信息泄露
    return {
        resourceId: data.resourceId,
        resourceType: data.resourceType,
        expiresAt: data.expiresAt,
        usageCount: data.usageCount,
        maxUsage: data.maxUsage,
        createdAt: data.createdAt
    }
}
