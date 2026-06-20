/**
 * Cloudflare Turnstile 验证模块
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { getSystemConfig, getSystemConfigBoolean } from '../db/system-config.js'

interface TurnstileVerifyResponse {
    success: boolean
    'error-codes'?: string[]
    challenge_ts?: string
    hostname?: string
}

/**
 * 获取 Turnstile 配置
 */
export async function getTurnstileConfig(): Promise<{
    enabled: boolean
    siteKey: string | null
    secretKey: string | null
}> {
    const [enabled, siteKey, secretKey] = await Promise.all([
        getSystemConfigBoolean('turnstile_enabled', false),
        getSystemConfig('turnstile_site_key'),
        getSystemConfig('turnstile_secret_key')
    ])

    return { enabled, siteKey, secretKey }
}

/**
 * 验证 Turnstile token
 */
export async function verifyTurnstileToken(
    token: string,
    secretKey: string,
    remoteIp?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const formData = new URLSearchParams()
        formData.append('secret', secretKey)
        formData.append('response', token)
        if (remoteIp) {
            formData.append('remoteip', remoteIp)
        }

        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        })

        const result = await response.json() as TurnstileVerifyResponse

        if (result.success) {
            return { success: true }
        }

        const errorCodes = result['error-codes'] || []
        return {
            success: false,
            error: errorCodes.length > 0 ? errorCodes.join(', ') : 'Verification failed'
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        return { success: false, error: `Turnstile verification error: ${errorMessage}` }
    }
}

/**
 * 创建 Turnstile 验证 preHandler
 * @param required 是否必须验证（false 时如果未启用则跳过）
 */
export function createTurnstileVerifier(required: boolean = true) {
    return async function verifyTurnstile(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        const config = await getTurnstileConfig()

        // 如果未启用 Turnstile
        if (!config.enabled) {
            if (required) {
                // 必须验证但未启用，检查是否配置了密钥
                if (!config.secretKey) {
                    return // 未配置则跳过验证
                }
            } else {
                return // 非必须且未启用，跳过
            }
        }

        // 已启用但未配置密钥
        if (!config.secretKey) {
            console.warn('Turnstile enabled but secret key not configured')
            return // 跳过验证
        }

        // 获取 token（优先从 body，其次从 query，最后从 header）
        const token = (request.body as { turnstileToken?: string })?.turnstileToken
            || (request.query as { turnstileToken?: string })?.turnstileToken
            || request.headers['x-turnstile-token'] as string

        if (!token) {
            return reply.code(400).send({
                error: 'Turnstile verification required',
                code: 'TURNSTILE_TOKEN_MISSING'
            })
        }

        // 获取真实 IP（支持 Cloudflare 代理）
        // request.ip 已通过 trustProxy 自动处理 Cloudflare 的 X-Forwarded-For 头
        const clientIp = request.ip
        
        // 验证 token
        const result = await verifyTurnstileToken(token, config.secretKey, clientIp)

        if (!result.success) {
            return reply.code(403).send({
                error: 'Turnstile verification failed',
                code: 'TURNSTILE_VERIFICATION_FAILED',
                details: result.error
            })
        }
    }
}

/**
 * 预定义的验证器实例
 */
export const turnstileVerifier = createTurnstileVerifier(true)
