/**
 * Turnstile 工具函数
 * 用于在 API 调用前执行隐式验证
 */
import { useTurnstile } from '@/composables/useTurnstile'
import i18n from '@/locales'

// 全局 Turnstile 实例
let globalTurnstile: ReturnType<typeof useTurnstile> | null = null

/**
 * 获取全局 Turnstile 实例
 */
export function getGlobalTurnstile() {
    if (!globalTurnstile) {
        globalTurnstile = useTurnstile()
    }
    return globalTurnstile
}

/**
 * 执行 Turnstile 验证并返回 token
 * 如果未启用 Turnstile，返回 undefined
 */
export async function getTurnstileToken(_action?: string): Promise<string | undefined> {
    const turnstile = getGlobalTurnstile()

    if (!turnstile.isEnabled.value) {
        return undefined
    }

    try {
        return await turnstile.execute()
    } catch (error) {
        console.error('Turnstile verification failed:', error)
        throw new Error(i18n.global.t('common.turnstileFailed'))
    }
}

/**
 * 包装 API 调用，自动添加 Turnstile token
 */
export async function withTurnstile<T extends Record<string, any>>(
    data: T,
    action?: string
): Promise<T & { turnstileToken?: string }> {
    const token = await getTurnstileToken(action)
    return {
        ...data,
        turnstileToken: token
    }
}
