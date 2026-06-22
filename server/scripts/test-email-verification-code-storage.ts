import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbSource = readFileSync(resolve(__dirname, '../src/db/email-verification.ts'), 'utf8')
const authSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
const userSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const schemaSource = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(
  resolve(__dirname, '../prisma/migrations/20260622000000_add_email_verification_purpose_hash/migration.sql'),
  'utf8'
)

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)

  assert.ok(startIndex >= 0, `missing source section start: ${start}`)
  assert.ok(endIndex > startIndex, `missing source section end: ${end}`)

  return source.slice(startIndex, endIndex)
}

const createVerificationCodeSource = sourceBetween(
  dbSource,
  'export async function createVerificationCode(',
  '/**\n * Verify an email verification code'
)

assert.ok(
  dbSource.includes("export type EmailVerificationPurpose = 'register' | 'password_reset' | 'change_email'"),
  'email verification codes must use an explicit purpose type'
)

assert.ok(
  dbSource.includes("return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`"),
  'email verification codes must be hashed with sha256 before storage'
)

assert.ok(
  dbSource.includes('const codeHash = hashVerificationCode(code)') &&
    dbSource.includes('purpose,') &&
    dbSource.includes('code: codeHash'),
  'new email verification records must store purpose and hashed code'
)

assert.ok(
  createVerificationCodeSource.indexOf('const recentCount = await prisma.emailVerificationCode.count({') <
    createVerificationCodeSource.indexOf('await prisma.emailVerificationCode.updateMany({') &&
    createVerificationCodeSource.includes('expiresAt: { gt: now }') &&
    createVerificationCodeSource.includes('expiresAt: now'),
  'creating a new verification code must preserve recent rows for rate limiting while expiring older pending codes'
)

assert.ok(
  !createVerificationCodeSource.includes('await prisma.emailVerificationCode.deleteMany({'),
  'creating a new verification code must not delete recent rows before hourly rate limiting can count them'
)

assert.ok(
  dbSource.includes("purpose: { in: [purpose, 'general'] }") &&
    dbSource.includes("if (storedCode.startsWith('sha256:'))") &&
    dbSource.includes('return storedCode === inputCode'),
  'verification must check requested purpose while keeping short-lived legacy plaintext compatibility'
)

assert.ok(
  dbSource.includes('const candidates = await prisma.emailVerificationCode.findMany({') &&
    !dbSource.includes('code,\n            expiresAt: { gt: new Date() }'),
  'verification lookup must not filter by raw code in Prisma'
)

assert.ok(
  dbSource.includes('const claimed = await prisma.emailVerificationCode.deleteMany({') &&
    dbSource.includes('where: { id: record.id }') &&
    dbSource.includes('return claimed.count === 1'),
  'verification code consumption must use conditional deleteMany so concurrent duplicate submissions return false instead of throwing'
)
assert.ok(
  !dbSource.includes('await prisma.emailVerificationCode.delete({\n        where: { id: record.id }'),
  'verification code consumption must not use delete(), which can throw on concurrent duplicate submissions'
)

assert.ok(
  authSource.includes("createVerificationCode(email, 'register')") &&
    authSource.includes("verifyCode(email, emailCode, 'register')") &&
    authSource.includes("createVerificationCode(email, 'password_reset')") &&
    authSource.includes("verifyCode(email, code, 'password_reset')"),
  'auth routes must isolate register and password-reset verification purposes'
)

assert.ok(
  userSource.includes("createVerificationCode(validationResult.normalizedEmail, 'change_email')") &&
    userSource.includes("verifyCode(validationResult.normalizedEmail, emailCode!, 'change_email')"),
  'change-email routes must use the change_email verification purpose'
)

assert.ok(
  schemaSource.includes('purpose   String   @default("general")') &&
    schemaSource.includes('@@index([email, purpose, code])'),
  'Prisma schema must persist verification purpose and index purpose-aware lookups'
)

assert.ok(
  migrationSource.includes('ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT') &&
    migrationSource.includes('"email_verification_codes_email_purpose_code_idx"'),
  'migration must add purpose and purpose-aware lookup index'
)

console.log('email verification code storage checks passed')
