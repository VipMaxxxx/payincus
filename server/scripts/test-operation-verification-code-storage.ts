import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/lib/operation-verification.ts'), 'utf8')
const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
const locksSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const attemptsMigration = readFileSync(
  resolve(__dirname, '../prisma/migrations/20260622010000_add_operation_verification_attempts/migration.sql'),
  'utf8'
)

function sourceBetween(sourceText: string, start: string, end: string): string {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf(end, startIndex + start.length)

  assert.ok(startIndex >= 0, `missing source section start: ${start}`)
  assert.ok(endIndex > startIndex, `missing source section end: ${end}`)

  return sourceText.slice(startIndex, endIndex)
}

const requestOperationVerificationSource = sourceBetween(
  source,
  'export async function requestOperationVerification(',
  'export interface VerifyOperationResult'
)
const claimOperationVerificationSource = sourceBetween(
  source,
  'export async function claimOperationVerificationRequirement(',
  '/**\n * 清理已使用的验证记录'
)
const verifyOperationCodeSource = sourceBetween(
  source,
  'export async function verifyOperationCode(',
  '/**\n * 检查操作是否已经通过二次验证'
)

assert.ok(
  source.includes("return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`"),
  'operation verification codes must be hashed with sha256 before storage'
)

assert.ok(
  source.includes('const codeHash = hashVerificationCode(code)') &&
    source.includes('code: codeHash'),
  'new operation verification records must store the code hash, not the raw 6-digit code'
)

assert.ok(
  source.includes('where: { userId, operationType, code: prepared.codeHash }'),
  'send-failure cleanup must delete the hashed verification record'
)

assert.ok(
  locksSource.includes('export const OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE = 4118'),
  'operation verification requests must have a dedicated advisory-lock namespace'
)

assert.ok(
  source.includes('OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE') &&
    source.includes('advisoryTransactionLockString') &&
    requestOperationVerificationSource.includes('await prisma.$transaction(async (tx): Promise<PreparedOperationVerification> => {') &&
    requestOperationVerificationSource.includes('getOperationVerificationRequestLockKey(userId, operationType, resourceId)') &&
    requestOperationVerificationSource.indexOf('await advisoryTransactionLockString(') <
      requestOperationVerificationSource.indexOf('const existingVerification = await tx.operationVerification.findFirst({') &&
    requestOperationVerificationSource.indexOf('await advisoryTransactionLockString(') <
      requestOperationVerificationSource.indexOf('await tx.operationVerification.create({'),
  'operation verification request creation must serialize check/delete/create under a per-user-operation-resource advisory lock'
)

assert.ok(
  !requestOperationVerificationSource.includes('operationVerification.delete({') &&
    requestOperationVerificationSource.includes('await tx.operationVerification.deleteMany({') &&
    requestOperationVerificationSource.includes('id: { not: existingVerification.id }'),
  'operation verification request cleanup must avoid throwing delete() races and collapse duplicate pending rows'
)

assert.ok(
  source.includes("if (storedCode.startsWith('sha256:'))") &&
    source.includes('return storedCode === inputCode'),
  'operation verification must retain compatibility with legacy plaintext rows'
)

assert.ok(
  source.includes('const candidates = await prisma.operationVerification.findMany({') &&
    !source.includes('code,\n            resourceId: resourceId || null,\n            verified: false'),
  'verification lookup must not filter by raw code in Prisma'
)

assert.ok(
  source.includes('attempts: { lt: VERIFICATION_CONFIG.maxAttempts }') &&
    source.includes('data: { attempts: { increment: 1 } }') &&
    source.includes("'TOO_MANY_ATTEMPTS'"),
  'operation verification must enforce the configured max attempt count before accepting a code'
)

assert.ok(
  !verifyOperationCodeSource.includes('operationVerification.update({') &&
    verifyOperationCodeSource.includes('const claimed = await prisma.operationVerification.updateMany({') &&
    verifyOperationCodeSource.includes('id: verification.id') &&
    verifyOperationCodeSource.includes('verified: false') &&
    verifyOperationCodeSource.includes('expiresAt: { gt: verifiedAt }') &&
    verifyOperationCodeSource.includes('attempts: { lt: VERIFICATION_CONFIG.maxAttempts }') &&
    verifyOperationCodeSource.includes('if (claimed.count !== 1)'),
  'successful operation verification must conditionally claim the pending row without throwing stale-record races'
)

assert.ok(
  claimOperationVerificationSource.includes('const result = await prisma.operationVerification.deleteMany({') &&
    claimOperationVerificationSource.includes('verified: true') &&
    claimOperationVerificationSource.includes('verifiedAt: { gt: tenMinutesAgo }') &&
    claimOperationVerificationSource.includes('verified: result.count > 0'),
  'operation verification claims must atomically consume a fresh verified record before sensitive side effects run'
)

assert.ok(
  /model OperationVerification[\s\S]*attempts\s+Int\s+@default\(0\)/.test(schema) &&
    attemptsMigration.includes('ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0'),
  'operation verification attempts must be persisted through Prisma schema and migration'
)

console.log('operation verification code storage checks passed')
