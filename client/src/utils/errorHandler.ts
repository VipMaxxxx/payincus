import i18n from '@/locales'

/**
 * API error type from interceptor
 */
export interface ApiError {
    message: string
    code?: string | null
    details?: string | null
    error?: string | null
}

function getTurnstileErrorKey(message: unknown): string | null {
    if (typeof message !== 'string') return null
    const normalized = message.trim().toLowerCase()
    if (!normalized) return null

    if (
        normalized === 'turnstile verification required' ||
        normalized.includes('turnstile token missing') ||
        normalized.includes('missing-input-response')
    ) {
        return 'TURNSTILE_TOKEN_MISSING'
    }

    if (
        normalized === 'turnstile verification failed' ||
        normalized.includes('turnstile verification error') ||
        normalized.includes('invalid-input-response') ||
        normalized.includes('timeout-or-duplicate')
    ) {
        return 'TURNSTILE_VERIFICATION_FAILED'
    }

    return null
}

function translateTurnstileMessage(message: unknown): string | null {
    const { t, te } = i18n.global
    const code = getTurnstileErrorKey(message)
    if (!code) return null

    const key = `errors.${code}`
    return te(key) ? (t(key) as string) : null
}

/**
 * Translate API error response
 * If error has a code, translate it; otherwise return the error message as-is
 */
export function translateError(error: unknown): string {
    const { t, te } = i18n.global

    if (!error) return t('common.error') as string

    // Handle API error object from interceptor
    if (typeof error === 'object' && error !== null) {
        const err = error as ApiError

        if (err.code && err.code.startsWith('TURNSTILE_')) {
            const key = `errors.${err.code}`
            if (te(key)) {
                return t(key) as string
            }
        }

        const turnstileMessage = translateTurnstileMessage(err.details || err.error || err.message)
        if (turnstileMessage) {
            return turnstileMessage
        }

        // 优先使用 details（包含详细的错误信息）
        if (err.details) {
            return err.details
        }

        // Check for error code and translate
        if (err.code) {
            const key = `errors.${err.code}`
            if (te(key)) {
                return t(key) as string
            }
        }

        // Fallback to error message
        if (err.message) {
            return err.message
        }
    }

    if (typeof error === 'string') {
        const turnstileMessage = translateTurnstileMessage(error)
        if (turnstileMessage) {
            return turnstileMessage
        }
        return error
    }

    return t('common.error') as string
}

/**
 * Get translated error message from error code
 */
export function getErrorMessage(code: string): string {
    const { t, te } = i18n.global
    const key = `errors.${code}`
    if (te(key)) {
        return t(key) as string
    }
    return code
}
