/**
 * 日志敏感信息过滤器
 * 
 * 用于过滤日志中的敏感信息，防止密码、Token 等泄露到日志中
 * 
 * 使用方式：
 * 1. 在 Fastify 配置中使用 serializers
 * 2. 手动调用 sanitizeObject 过滤对象中的敏感字段
 */

// 需要过滤的敏感字段名列表（不区分大小写）
const SENSITIVE_FIELDS = [
    'password',
    'newPassword',
    'oldPassword',
    'currentPassword',
    'confirmPassword',
    'token',
    'accessToken',
    'refreshToken',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'secret',
    'jwtSecret',
    'apiKey',
    'apiSecret',
    'privateKey',
    'clientSecret',
    'totpCode',
    'recoveryCode',
    'twoFactorSecret',
    'encryptedSecret',
    'backupCode',
    'otp',
    'pin',
    'creditCard',
    'cardNumber',
    'cvv',
    'ssn',
    'x-auth-token',
    'x-api-key',
]

// 编译正则表达式，用于更快匹配
const SENSITIVE_FIELD_PATTERN = new RegExp(
    `^(${SENSITIVE_FIELDS.join('|')})$`,
    'i'
)

// Token 模式匹配（用于检测值中包含的 token）
const TOKEN_PATTERNS = [
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT
    /Bearer\s+[A-Za-z0-9_-]+/gi,  // Bearer token
]

// 替换值
const REDACTED = '[REDACTED]'
const REDACTED_JWT = '[REDACTED_JWT]'

/**
 * 检查字段名是否为敏感字段
 */
export function isSensitiveField(fieldName: string): boolean {
    return SENSITIVE_FIELD_PATTERN.test(fieldName)
}

/**
 * 过滤字符串中的 Token
 */
export function sanitizeTokensInString(value: string): string {
    let result = value
    for (const pattern of TOKEN_PATTERNS) {
        result = result.replace(pattern, REDACTED_JWT)
    }
    return result
}

/**
 * 过滤对象中的敏感信息
 * 递归处理嵌套对象
 */
export function sanitizeObject<T>(obj: T, depth = 0): T {
    // 防止无限递归
    if (depth > 10) return obj

    if (obj === null || obj === undefined) {
        return obj
    }

    // 处理字符串
    if (typeof obj === 'string') {
        return sanitizeTokensInString(obj) as unknown as T
    }

    // 处理数组
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1)) as unknown as T
    }

    // 处理对象
    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
            if (isSensitiveField(key)) {
                result[key] = REDACTED
            } else if (typeof value === 'string') {
                result[key] = sanitizeTokensInString(value)
            } else if (typeof value === 'object' && value !== null) {
                result[key] = sanitizeObject(value, depth + 1)
            } else {
                result[key] = value
            }
        }
        return result as T
    }

    return obj
}

/**
 * Pino 序列化器配置
 * 用于 Fastify logger 的 serializers 配置
 * 
 * 注意：由于 Fastify 的类型定义限制，我们使用 any 类型
 * 并在运行时安全过滤
 */
export const logSerializers = {
    // 过滤请求体中的敏感信息
    req: (req: any) => {
        const sanitized: Record<string, unknown> = {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip || req.remoteAddress,
        }

        // 过滤请求头中的敏感信息
        if (req.headers) {
            sanitized.headers = sanitizeObject(req.headers)
        }

        return sanitized
    },

    // 过滤响应中的敏感信息
    res: (res: any) => {
        return {
            statusCode: res.statusCode,
        }
    },

    // 过滤错误信息中的敏感信息
    err: (err: any) => {
        return {
            type: err.constructor?.name || 'Error',
            message: sanitizeTokensInString(String(err.message || '')),
            stack: err.stack ? sanitizeTokensInString(String(err.stack)) : '',
        }
    }
} as const

/**
 * 创建安全的日志记录器包装
 * 自动过滤传入的对象中的敏感信息
 */
export function createSafeLogger(logger: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
    debug: (obj: unknown, msg?: string) => void
}) {
    return {
        info: (obj: unknown, msg?: string) => {
            logger.info(sanitizeObject(obj), msg)
        },
        warn: (obj: unknown, msg?: string) => {
            logger.warn(sanitizeObject(obj), msg)
        },
        error: (obj: unknown, msg?: string) => {
            logger.error(sanitizeObject(obj), msg)
        },
        debug: (obj: unknown, msg?: string) => {
            logger.debug(sanitizeObject(obj), msg)
        }
    }
}
