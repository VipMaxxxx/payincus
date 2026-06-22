const INSECURE_SECRET_PATTERNS = [
  'dev-secret',
  'dev_secret',
  'development',
  'change-in-production',
  'change_me',
  'changeme',
  'replace',
  'generateuniquevaluebeforedeploy',
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
  const isProduction = process.env.NODE_ENV === 'production'

  const jwtCheck = validateSecret({
    name: 'JWT_SECRET',
    value: process.env.JWT_SECRET,
    isProduction,
    missingProductionMessage: 'JWT_SECRET not configured',
    missingDevelopmentMessage: 'JWT_SECRET not configured',
    weakDevelopmentMessage: 'JWT_SECRET should be at least 32 characters',
    weakProductionMessage: 'JWT_SECRET must be at least 32 characters in production',
    complexityDevelopmentMessage: 'JWT_SECRET should contain uppercase, lowercase, numbers and special characters for better security',
    complexityProductionMessage: 'JWT_SECRET in production should contain at least 3 types of characters (uppercase, lowercase, numbers, special)'
  })
  if (!jwtCheck.valid) return jwtCheck
  warnings.push(...jwtCheck.warnings)

  const cookieCheck = validateSecret({
    name: 'COOKIE_SECRET',
    value: process.env.COOKIE_SECRET,
    isProduction,
    missingProductionMessage: 'COOKIE_SECRET must be configured in production',
    missingDevelopmentMessage: 'COOKIE_SECRET not configured, will use fallback development value',
    weakDevelopmentMessage: 'COOKIE_SECRET should be at least 32 characters',
    weakProductionMessage: 'COOKIE_SECRET must be at least 32 characters in production',
    complexityDevelopmentMessage: 'COOKIE_SECRET should contain uppercase, lowercase, numbers and special characters for better security',
    complexityProductionMessage: 'COOKIE_SECRET in production should contain at least 3 types of characters (uppercase, lowercase, numbers, special)'
  })
  if (!cookieCheck.valid) return cookieCheck
  warnings.push(...cookieCheck.warnings)

  const encryptionCheck = validateSecret({
    name: 'ENCRYPTION_KEY',
    value: process.env.ENCRYPTION_KEY,
    isProduction,
    missingProductionMessage: 'ENCRYPTION_KEY must be configured in production',
    missingDevelopmentMessage: 'ENCRYPTION_KEY not configured, will use JWT_SECRET as fallback',
    weakDevelopmentMessage: 'ENCRYPTION_KEY should be at least 32 characters',
    weakProductionMessage: 'ENCRYPTION_KEY must be at least 32 characters in production',
    complexityDevelopmentMessage: 'ENCRYPTION_KEY should contain uppercase, lowercase, numbers and special characters for better security',
    complexityProductionMessage: 'ENCRYPTION_KEY in production should contain at least 3 types of characters (uppercase, lowercase, numbers, special)'
  })
  if (!encryptionCheck.valid) return encryptionCheck
  warnings.push(...encryptionCheck.warnings)

  return { valid: true, warnings }
}

function validateSecret(input: {
  name: string
  value: string | undefined
  isProduction: boolean
  missingProductionMessage: string
  missingDevelopmentMessage: string
  weakDevelopmentMessage: string
  weakProductionMessage: string
  complexityDevelopmentMessage: string
  complexityProductionMessage: string
}): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  if (!input.value) {
    if (input.isProduction) {
      return { valid: false, warnings: [input.missingProductionMessage] }
    }
    warnings.push(input.missingDevelopmentMessage)
    return { valid: true, warnings }
  }

  if (input.value.length < 32) {
    if (input.isProduction) {
      return { valid: false, warnings: [input.weakProductionMessage] }
    }
    warnings.push(input.weakDevelopmentMessage)
  }

  const secretLower = input.value.toLowerCase()
  const matchedPattern = INSECURE_SECRET_PATTERNS.find(pattern => secretLower.includes(pattern))
  if (matchedPattern) {
    if (input.isProduction) {
      return {
        valid: false,
        warnings: [`Cannot use insecure ${input.name} in production (contains '${matchedPattern}')`]
      }
    }
    warnings.push(`Using development ${input.name} (contains '${matchedPattern}'), not suitable for production`)
  }

  const hasUpperCase = /[A-Z]/.test(input.value)
  const hasLowerCase = /[a-z]/.test(input.value)
  const hasNumber = /[0-9]/.test(input.value)
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(input.value)
  const charTypes = [hasUpperCase, hasLowerCase, hasNumber, hasSpecial].filter(Boolean).length

  if (charTypes < 3) {
    if (input.isProduction) {
      return { valid: false, warnings: [input.complexityProductionMessage] }
    }
    warnings.push(input.complexityDevelopmentMessage)
  }

  return { valid: true, warnings }
}
