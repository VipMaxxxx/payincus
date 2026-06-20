import i18n from '@/locales'

/**
 * API error type from interceptor
 */
export interface ApiError {
    message: string
    code?: string | null
    details?: string | null
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
