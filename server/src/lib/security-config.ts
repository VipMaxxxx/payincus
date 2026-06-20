const INSECURE_SECRET_PATTERNS = [
  'dev-secret',
  'dev_secret',
  'development',
  'change-in-production',
  'changeme',
  'secret',
  'password',
  '123456',
  'test',
  'demo',
  'example',
  'default',
]

/**
 * 检查 JWT 与敏感字段加密配置是否满足当前环境要求。
 */
export function checkJwtConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []
  const secret = process.env.JWT_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  if (!secret) {
    return { valid: false, warnings: ['JWT_SECRET not configured'] }
  }

  if (secret.length < 32) {
    if (isProduction) {
      return { valid: false, warnings: ['JWT_SECRET must be at least 32 characters in production'] }
    }
    warnings.push('JWT_SECRET should be at least 32 characters')
  }

  const secretLower = secret.toLowerCase()
  const matchedPattern = INSECURE_SECRET_PATTERNS.find(pattern => secretLower.includes(pattern))

  if (matchedPattern) {
    if (isProduction) {
      return {
        valid: false,
        warnings: [`Cannot use insecure JWT_SECRET in production (contains '${matchedPattern}')`]
      }
    }
    warnings.push(`Using development JWT_SECRET (contains '${matchedPattern}'), not suitable for production`)
  }

  const hasUpperCase = /[A-Z]/.test(secret)
  const hasLowerCase = /[a-z]/.test(secret)
  const hasNumber = /[0-9]/.test(secret)
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(secret)
  const charTypes = [hasUpperCase, hasLowerCase, hasNumber, hasSpecial].filter(Boolean).length

  if (charTypes < 3) {
    if (isProduction) {
      return {
        valid: false,
        warnings: ['JWT_SECRET in production should contain at least 3 types of characters (uppercase, lowercase, numbers, special)']
      }
    }
    warnings.push('JWT_SECRET should contain uppercase, lowercase, numbers and special characters for better security')
  }

  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) {
    if (isProduction) {
      return { valid: false, warnings: ['ENCRYPTION_KEY must be configured in production'] }
    }
    warnings.push('ENCRYPTION_KEY not configured, will use JWT_SECRET as fallback')
  } else if (encryptionKey.length < 32) {
    if (isProduction) {
      return { valid: false, warnings: ['ENCRYPTION_KEY must be at least 32 characters in production'] }
    }
    warnings.push('ENCRYPTION_KEY should be at least 32 characters')
  } else {
    const encryptionKeyLower = encryptionKey.toLowerCase()
    const encryptionMatchedPattern = INSECURE_SECRET_PATTERNS.find(pattern => encryptionKeyLower.includes(pattern))
    if (encryptionMatchedPattern) {
      if (isProduction) {
        return {
          valid: false,
          warnings: [`Cannot use insecure ENCRYPTION_KEY in production (contains '${encryptionMatchedPattern}')`]
        }
      }
      warnings.push(`Using development ENCRYPTION_KEY (contains '${encryptionMatchedPattern}'), not suitable for production`)
    }
  }

  return { valid: true, warnings }
}
