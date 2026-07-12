/**
 * 敏感操作二次验证服务
 * 
 * 账号相关操作：通过邮件验证
 * 资源相关操作：通过用户绑定的通知渠道验证
 */

import { prisma } from '../db/prisma.js'
import { OperationType, VerificationChannel } from '@prisma/client'
import { sendOperationVerificationEmail } from './mailer.js'
import { sendVerificationNotification } from './notifier.js'
import {
    OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE,
    advisoryTransactionLockString
} from '../db/advisory-locks.js'
import crypto from 'crypto'

// 操作类型分类
const ACCOUNT_OPERATIONS: OperationType[] = [
    'change_password',
    'disable_2fa',
    'change_email',
    'delete_account'
]

const RESOURCE_OPERATIONS: OperationType[] = [
    'delete_instance',
    'reinstall_instance',
    'recreate_instance',
    'transfer_instance',
    'delete_snapshot',
    'delete_backup'
]

// 验证码配置
const VERIFICATION_CONFIG = {
    codeLength: 6,
    expiresInMinutes: 10,
    maxAttempts: 5
}

// 操作类型显示名称（用于通知）
const OPERATION_NAMES: Record<OperationType, { zh: string; en: string }> = {
    change_password: { zh: '修改密码', en: 'Change Password' },
    disable_2fa: { zh: '禁用双因素认证', en: 'Disable 2FA' },
    change_email: { zh: '修改邮箱地址', en: 'Change Email' },
    delete_account: { zh: '删除账户', en: 'Delete Account' },
    delete_instance: { zh: '删除实例', en: 'Delete Instance' },
    reinstall_instance: { zh: '重装实例', en: 'Reinstall Instance' },
    recreate_instance: { zh: '重建实例', en: 'Recreate Instance' },
    transfer_instance: { zh: '转移实例', en: 'Transfer Instance' },
    delete_snapshot: { zh: '删除快照', en: 'Delete Snapshot' },
    delete_backup: { zh: '删除备份', en: 'Delete Backup' }
}

/**
 * 生成6位随机验证码
 */
function generateVerificationCode(): string {
    return crypto.randomInt(100000, 1000000).toString()
}

function hashVerificationCode(code: string): string {
    return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`
}

function verificationCodeMatches(storedCode: string, inputCode: string): boolean {
    if (storedCode.startsWith('sha256:')) {
        return storedCode === hashVerificationCode(inputCode)
    }

    return storedCode === inputCode
}

/**
 * 判断操作类型是否为账号相关操作
 */
export function isAccountOperation(operationType: OperationType): boolean {
    return ACCOUNT_OPERATIONS.includes(operationType)
}

/**
 * 判断操作类型是否为资源相关操作
 */
export function isResourceOperation(operationType: OperationType): boolean {
    return RESOURCE_OPERATIONS.includes(operationType)
}

/**
 * 获取操作名称
 */
export function getOperationName(operationType: OperationType, lang: 'zh' | 'en' = 'zh'): string {
    return OPERATION_NAMES[operationType]?.[lang] || operationType
}

/**
 * 获取用户的首选通知渠道
 */
async function getUserNotificationChannel(userId: number): Promise<{
    channel: VerificationChannel | null
    channelId: number | null
    target: string | null
}> {
    // 查找用户启用的第一个通知渠道
    const notificationChannel = await prisma.notificationChannel.findFirst({
        where: {
            userId,
            enabled: true
        },
        orderBy: { createdAt: 'asc' }
    })

    if (!notificationChannel) {
        return { channel: null, channelId: null, target: null }
    }

    // 解析渠道配置获取目标标识（用于显示）
    let target = ''
    const config = typeof notificationChannel.config === 'string'
        ? JSON.parse(notificationChannel.config)
        : notificationChannel.config

    switch (notificationChannel.type) {
        case 'telegram':
            target = `Telegram (${(config as { chatId?: string }).chatId?.substring(0, 6)}***)`
            break
        case 'discord':
            target = 'Discord Webhook'
            break
        case 'webhook':
            target = 'Webhook'
            break
        default:
            target = notificationChannel.type
    }

    return {
        channel: notificationChannel.type as VerificationChannel,
        channelId: notificationChannel.id,
        target
    }
}

export interface RequestVerificationResult {
    success: boolean
    channel?: VerificationChannel
    maskedTarget?: string
    expiresIn?: number
    error?: string
    errorCode?: string
}

type PreparedOperationVerification =
    | { alreadySent: true; expiresIn: number }
    | { alreadySent: false; code: string; codeHash: string }

function getOperationVerificationRequestLockKey(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): string {
    return `${userId}:${operationType}:${resourceId ?? 'account'}`
}

/**
 * 请求二次验证码
 */
export async function requestOperationVerification(
    userId: number,
    operationType: OperationType,
    resourceId?: number,
    resourceType?: string
): Promise<RequestVerificationResult> {
    // 1. 获取用户信息
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, username: true }
    })

    if (!user) {
        return { success: false, error: 'User not found', errorCode: 'USER_NOT_FOUND' }
    }

    // 2. 确定验证渠道
    let channel: VerificationChannel
    let maskedTarget: string

    if (isAccountOperation(operationType)) {
        // 账号操作：强制使用邮件
        if (!user.email) {
            return { success: false, error: 'Email not configured', errorCode: 'EMAIL_NOT_CONFIGURED' }
        }
        channel = 'email'
        // 遮蔽邮箱
        const [localPart, domain] = user.email.split('@')
        maskedTarget = `${localPart.substring(0, 2)}***@${domain}`
    } else {
        // 资源操作：使用用户绑定的通知渠道
        const notifyChannel = await getUserNotificationChannel(userId)
        if (!notifyChannel.channel) {
            // 没有绑定通知渠道，不需要二次验证
            return { 
                success: false, 
                error: 'No notification channel configured', 
                errorCode: 'NO_NOTIFICATION_CHANNEL' 
            }
        }
        channel = notifyChannel.channel
        maskedTarget = notifyChannel.target || channel
    }

    const prepared = await prisma.$transaction(async (tx): Promise<PreparedOperationVerification> => {
        await advisoryTransactionLockString(
            tx,
            OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE,
            getOperationVerificationRequestLockKey(userId, operationType, resourceId)
        )

        const now = new Date()
        const normalizedResourceId = resourceId || null

        // 3. 清理过期的验证码
        await tx.operationVerification.deleteMany({
            where: {
                userId,
                expiresAt: { lt: now }
            }
        })

        // 4. 检查是否有未过期的同类型验证码（防止频繁请求）
        const existingVerification = await tx.operationVerification.findFirst({
            where: {
                userId,
                operationType,
                resourceId: normalizedResourceId,
                verified: false,
                expiresAt: { gt: now }
            },
            orderBy: { createdAt: 'desc' }
        })

        if (existingVerification) {
            // 如果验证码创建时间在2分钟内，拒绝重新发送
            const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000)
            if (existingVerification.createdAt > twoMinutesAgo) {
                await tx.operationVerification.deleteMany({
                    where: {
                        userId,
                        operationType,
                        resourceId: normalizedResourceId,
                        verified: false,
                        expiresAt: { gt: now },
                        id: { not: existingVerification.id }
                    }
                })

                const remainingSeconds = Math.ceil((existingVerification.expiresAt.getTime() - now.getTime()) / 1000)
                return {
                    alreadySent: true,
                    expiresIn: remainingSeconds
                }
            }

            // 删除旧的验证码。使用 deleteMany 避免并发请求重复删除时抛出 not found。
            await tx.operationVerification.deleteMany({
                where: {
                    userId,
                    operationType,
                    resourceId: normalizedResourceId,
                    verified: false,
                    expiresAt: { gt: now }
                }
            })
        }

        // 5. 生成新验证码
        const code = generateVerificationCode()
        const codeHash = hashVerificationCode(code)
        const expiresAt = new Date(now.getTime() + VERIFICATION_CONFIG.expiresInMinutes * 60 * 1000)

        // 6. 存储验证码
        await tx.operationVerification.create({
            data: {
                userId,
                operationType,
                code: codeHash,
                channel,
                resourceId: normalizedResourceId,
                resourceType: resourceType || null,
                expiresAt
            }
        })

        return { alreadySent: false, code, codeHash }
    })

    if (prepared.alreadySent) {
        return {
            success: true,
            channel,
            maskedTarget,
            expiresIn: prepared.expiresIn,
            error: 'Verification code already sent, please wait'
        }
    }

    // 7. 发送验证码
    const operationName = getOperationName(operationType, 'zh')

    if (channel === 'email') {
        // 发送邮件
        const result = await sendOperationVerificationEmail(user.email!, {
            username: user.username,
            operationName,
            code: prepared.code,
            expiresInMinutes: VERIFICATION_CONFIG.expiresInMinutes
        })
        if (!result.success) {
            // 删除刚创建的验证码
            await prisma.operationVerification.deleteMany({
                where: { userId, operationType, code: prepared.codeHash }
            })
            return { success: false, error: result.error, errorCode: 'SEND_FAILED' }
        }
    } else {
        // 发送通知渠道消息
        const result = await sendVerificationNotification(userId, {
            operationName,
            code: prepared.code,
            expiresInMinutes: VERIFICATION_CONFIG.expiresInMinutes
        })
        if (!result.success) {
            await prisma.operationVerification.deleteMany({
                where: { userId, operationType, code: prepared.codeHash }
            })
            return { success: false, error: result.error, errorCode: 'SEND_FAILED' }
        }
    }

    return {
        success: true,
        channel,
        maskedTarget,
        expiresIn: VERIFICATION_CONFIG.expiresInMinutes * 60
    }
}

export interface VerifyOperationResult {
    success: boolean
    verified: boolean
    error?: string
    errorCode?: string
}

async function recordFailedVerificationAttempt(verificationId: number): Promise<boolean> {
    let attempts: number
    try {
        const verification = await prisma.operationVerification.update({
            where: { id: verificationId },
            data: { attempts: { increment: 1 } },
            select: { attempts: true }
        })
        attempts = verification.attempts
    } catch {
        return true
    }

    if (attempts >= VERIFICATION_CONFIG.maxAttempts) {
        await prisma.operationVerification.deleteMany({
            where: { id: verificationId, verified: false }
        })
        return true
    }

    return false
}

/**
 * 验证二次验证码
 */
export async function verifyOperationCode(
    userId: number,
    operationType: OperationType,
    code: string,
    resourceId?: number
): Promise<VerifyOperationResult> {
    const now = new Date()
    const codeHash = hashVerificationCode(code)
    const candidates = await prisma.operationVerification.findMany({
        where: {
            userId,
            operationType,
            resourceId: resourceId || null,
            verified: false,
            expiresAt: { gt: now },
            attempts: { lt: VERIFICATION_CONFIG.maxAttempts }
        },
        orderBy: { createdAt: 'desc' }
    })
    const verification = candidates.find(candidate => (
        candidate.code === codeHash || verificationCodeMatches(candidate.code, code)
    ))

    if (!verification) {
        const activeVerification = candidates[0]
        if (activeVerification) {
            const exhausted = await recordFailedVerificationAttempt(activeVerification.id)
            if (exhausted) {
                return {
                    success: false,
                    verified: false,
                    error: 'Too many verification attempts, please request a new code',
                    errorCode: 'TOO_MANY_ATTEMPTS'
                }
            }
        }

        return { 
            success: false, 
            verified: false, 
            error: 'Invalid or expired verification code',
            errorCode: 'INVALID_CODE'
        }
    }

    // 标记为已验证。使用条件 updateMany 避免候选记录被并发清理/耗尽时抛出 500。
    const verifiedAt = new Date()
    const claimed = await prisma.operationVerification.updateMany({
        where: {
            id: verification.id,
            userId,
            operationType,
            resourceId: resourceId || null,
            verified: false,
            expiresAt: { gt: verifiedAt },
            attempts: { lt: VERIFICATION_CONFIG.maxAttempts }
        },
        data: { 
            verified: true,
            verifiedAt
        }
    })

    if (claimed.count !== 1) {
        return {
            success: false,
            verified: false,
            error: 'Invalid or expired verification code',
            errorCode: 'INVALID_CODE'
        }
    }

    return { success: true, verified: true }
}

/**
 * 检查操作是否已经通过二次验证
 * 验证在10分钟内有效
 */
export async function isOperationVerified(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): Promise<boolean> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    
    const verification = await prisma.operationVerification.findFirst({
        where: {
            userId,
            operationType,
            resourceId: resourceId || null,
            verified: true,
            verifiedAt: { gt: tenMinutesAgo }
        }
    })

    return !!verification
}

export async function checkOperationVerificationRequirement(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): Promise<{ required: boolean; verified: boolean }> {
    const required = isAccountOperation(operationType) || await isResourceVerificationRequired(userId)
    if (!required) {
        return { required: false, verified: true }
    }

    return {
        required: true,
        verified: await isOperationVerified(userId, operationType, resourceId)
    }
}

/**
 * 原子领取一次已通过的二次验证记录。
 * 用于真正执行敏感操作前，避免同一条 verified 记录被并发请求重复复用。
 */
export async function claimOperationVerificationRequirement(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): Promise<{ required: boolean; verified: boolean }> {
    const required = isAccountOperation(operationType) || await isResourceVerificationRequired(userId)
    if (!required) {
        return { required: false, verified: true }
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const result = await prisma.operationVerification.deleteMany({
        where: {
            userId,
            operationType,
            resourceId: resourceId || null,
            verified: true,
            verifiedAt: { gt: tenMinutesAgo }
        }
    })

    return {
        required: true,
        verified: result.count > 0
    }
}

/**
 * 清理已使用的验证记录（操作完成后调用）
 */
export async function consumeOperationVerification(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): Promise<void> {
    await prisma.operationVerification.deleteMany({
        where: {
            userId,
            operationType,
            resourceId: resourceId || null,
            verified: true
        }
    })
}

/**
 * 检查资源操作是否需要二次验证
 * 如果用户没有绑定通知渠道，则不需要二次验证
 */
export async function isResourceVerificationRequired(userId: number): Promise<boolean> {
    const channel = await getUserNotificationChannel(userId)
    return channel.channel !== null
}

/**
 * 清理过期的验证记录（定期调用）
 * 删除所有已过期的验证记录
 */
export async function cleanupExpiredVerifications(): Promise<number> {
    const result = await prisma.operationVerification.deleteMany({
        where: {
            expiresAt: { lt: new Date() }
        }
    })
    return result.count
}

/**
 * 导出操作类型常量供外部使用
 */
export { OperationType, VerificationChannel }
