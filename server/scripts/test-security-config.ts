import assert from 'node:assert/strict'
import { checkJwtConfig } from '../src/lib/security-config.js'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY
}

function setEnv(input: {
  nodeEnv: string
  jwtSecret?: string
  encryptionKey?: string
}) {
  process.env.NODE_ENV = input.nodeEnv
  if (input.jwtSecret === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = input.jwtSecret
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
const strongEncryptionKey = 'EncK!AlphaBeta2026_Long_Value_ABCDE'

try {
  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret
  })
  let result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('ENCRYPTION_KEY must be configured in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
    encryptionKey: 'ShortEnc1!'
  })
  result = checkJwtConfig()
  assert.equal(result.valid, false)
  assert.ok(result.warnings.includes('ENCRYPTION_KEY must be at least 32 characters in production'))

  setEnv({
    nodeEnv: 'production',
    jwtSecret: strongJwtSecret,
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
  assert.ok(result.warnings.includes('ENCRYPTION_KEY not configured, will use JWT_SECRET as fallback'))

  console.log('security-config self-test passed')
} finally {
  restoreEnv()
}
