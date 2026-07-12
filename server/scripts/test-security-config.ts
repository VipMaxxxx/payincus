import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkJwtConfig } from '../src/lib/security-config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  COOKIE_SECRET: process.env.COOKIE_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY
}

function setEnv(input: {
  nodeEnv: string
  jwtSecret?: string
  cookieSecret?: string
  encryptionKey?: string
}) {
  process.env.NODE_ENV = input.nodeEnv
  if (input.jwtSecret === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = input.jwtSecret
  }
  if (input.cookieSecret === undefined) {
    delete process.env.COOKIE_SECRET
  } else {
    process.env.COOKIE_SECRET = input.cookieSecret
  }
  if (input.encryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY
  } else {
    process.env.ENCRYPTION_KEY = input.encryptionKey
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

const strongJwtSecret = 'JwT!AlphaBeta2026_Long_Value_ABCDE'
const strongCookieSecret = 'CooK!AlphaBeta2026_Long_Value_ABCDE'
const strongEncryptionKey = 'EncK!AlphaBeta2026_Long_Value_ABCDE'
const oldTemplateJwtSecret = 'ProdJwt2026!GenerateUniqueValueBeforeDeploy'
const oldTemplateCookieSecret = 'ProdCookie2026!GenerateUniqueValueBeforeDeploy'
const oldTemplateEncryptionKey = 'ProdEncryption2026!GenerateUniqueValueBeforeDeploy'

try {
  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    cookieSecret: strongCookieSecret
  })
  let result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('ENCRYPTION_KEY must be configured in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    encryptionKey: strongEncryptionKey
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('COOKIE_SECRET must be configured in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    cookieSecret: 'ShortCookie1!',
    encryptionKey: strongEncryptionKey
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('COOKIE_SECRET must be at least 32 characters in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    cookieSecret: strongCookieSecret,
    encryptionKey: 'ShortEnc1!'
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('ENCRYPTION_KEY must be at least 32 characters in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: oldTemplateJwtSecret,
    cookieSecret: oldTemplateCookieSecret,
    encryptionKey: oldTemplateEncryptionKey
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(
    result.warnings.some(warning => warning.includes('generateuniquevaluebeforedeploy')),
    'old documented template secrets must be rejected in production'
  )

  setEnv({
    nodeEnv: 'production',
    jwtSecret: 'change_me_generate_with_openssl_rand_base64_48',
    cookieSecret: strongCookieSecret,
    encryptionKey: strongEncryptionKey
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(
    result.warnings.some(warning => warning.includes('change_me')),
    'change_me template secrets must be rejected in production'
  )

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    cookieSecret: strongCookieSecret,
    encryptionKey: strongEncryptionKey
  })
  result = checkJwtConfig()
  assert.equal(result.valid, true)
  assert.deepEqual(result.warnings, [])

  setEnv({
    nodeEnv: 'development',
    jwtSecret: strongJwtSecret
  })
  result = checkJwtConfig()
  assert.equal(result.valid, true)
  assert.ok(result.warnings.includes('COOKIE_SECRET not configured, will use fallback development value'))
  assert.ok(result.warnings.includes('ENCRYPTION_KEY not configured, will use JWT_SECRET as fallback'))

  const securitySource = readFileSync(resolve(__dirname, '../src/lib/security.ts'), 'utf8')
  const configCacheSource = readFileSync(resolve(__dirname, '../src/lib/config-cache.ts'), 'utf8')
  const hostRouteSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
  const envExampleSource = readFileSync(resolve(__dirname, '../../.env.example'), 'utf8')
  const readmeSource = readFileSync(resolve(__dirname, '../../README.md'), 'utf8')
  const operationsHandoffSource = readFileSync(resolve(__dirname, '../../OPERATIONS_HANDOFF.md'), 'utf8')
  const agentsSource = readFileSync(resolve(__dirname, '../../AGENTS.md'), 'utf8')

  assert.ok(
    securitySource.includes('依赖私有后端仅运行单个进程实例') &&
      securitySource.includes('未来扩容前必须下沉到 PostgreSQL 或其它共享存储') &&
      securitySource.includes('const loginAttempts = new Map') &&
      securitySource.includes('const usedNonces = new Map') &&
      securitySource.includes('const usedLoginCodeNonces = new Map'),
    'security process-local locks and nonce replay protection must document the single-backend-process invariant'
  )

  assert.ok(
    configCacheSource.includes('依赖私有后端仅运行单个进程实例') &&
      configCacheSource.includes('未来扩容前必须下沉到 PostgreSQL 或其它共享存储/失效通知机制') &&
      configCacheSource.includes('const configCache = new Map'),
    'configuration cache must document the single-backend-process invariant and shared-store migration requirement'
  )

  assert.ok(
    operationsHandoffSource.includes('## Private Backend Must Run As A Single Instance') &&
      operationsHandoffSource.includes('must run as exactly one Node.js process') &&
      operationsHandoffSource.includes('Treat a second backend replica as an unsupported deployment'),
    'operations handoff must prohibit multiple private-backend process instances'
  )

  assert.ok(
    agentsSource.includes('### 私有后端必须单实例运行') &&
      agentsSource.includes('必须且只能运行 **1 个 Node.js 进程实例**') &&
      agentsSource.includes('第二个后端副本属于不受支持的部署'),
    'agent instructions must preserve the private-backend single-instance architecture invariant'
  )

  assert.ok(
    securitySource.includes('export function getJwtSigningSecret(purpose = \'token signing\'): string') &&
      securitySource.includes('JWT_SECRET is required in production for ${purpose}'),
    'security helpers must provide a shared production-required JWT signing secret'
  )

  assert.ok(
    securitySource.includes("return getJwtSigningSecret('OAuth state and login-code signing')"),
    'OAuth state and login-code signing must use the shared JWT signing secret helper'
  )

  assert.ok(
    hostRouteSource.includes("getJwtSigningSecret('Caddy script token signing')") &&
      hostRouteSource.includes("getJwtSigningSecret('Caddy script token verification')"),
    'Caddy script tokens must use the shared JWT signing secret helper'
  )

  for (const forbiddenPattern of [
    'fallback-secret-key',
    "'default-secret'",
    '"default-secret"',
    "process.env.JWT_SECRET || 'default-secret'",
    'process.env.JWT_SECRET || "default-secret"'
  ] as const) {
    assert.ok(
      !securitySource.includes(forbiddenPattern),
      `security helpers must not keep hardcoded JWT signing fallback: ${forbiddenPattern}`
    )
    assert.ok(
      !hostRouteSource.includes(forbiddenPattern),
      `host routes must not keep hardcoded JWT signing fallback: ${forbiddenPattern}`
    )
  }

  for (const forbiddenTemplate of [
    oldTemplateJwtSecret,
    oldTemplateCookieSecret,
    oldTemplateEncryptionKey
  ] as const) {
    assert.ok(
      !envExampleSource.includes(forbiddenTemplate),
      `.env.example must not include accepted-looking template secret: ${forbiddenTemplate}`
    )
    assert.ok(
      !readmeSource.includes(forbiddenTemplate),
      `README must not include accepted-looking template secret: ${forbiddenTemplate}`
    )
  }

  console.log('security-config self-test passed')
} finally {
  restoreEnv()
}
