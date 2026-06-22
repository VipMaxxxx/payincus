import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const locksSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const usersDbSource = readFileSync(resolve(__dirname, '../src/db/users.ts'), 'utf8')
const authRouteSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const createRegisteredUserSection = sectionBetween(
  usersDbSource,
  'export async function createRegisteredUser(',
  '/**\n * 获取所有用户'
)

const registerRouteSection = sectionBetween(
  authRouteSource,
  "fastify.post<{ Body: RegisterRequest & { turnstileToken?: string; emailCode?: string } }>('/register'",
  '    // 记录注册成功'
)

assert.ok(
  locksSource.includes('export const USER_EMAIL_REGISTRATION_LOCK_NAMESPACE = 4117'),
  'registration must have a dedicated email-level advisory-lock namespace'
)

assert.ok(
  locksSource.includes('export async function advisoryTransactionLockString(') &&
    locksSource.includes('pg_advisory_xact_lock(${namespace}, hashtext(${key}))'),
  'registration must have a transaction advisory lock helper for normalized email strings'
)

assert.ok(
  createRegisteredUserSection.includes('const normalizedEmail = input.email?.toLowerCase().trim() || null'),
  'registered-user creation must normalize email inside the DB boundary'
)

assert.ok(
  createRegisteredUserSection.includes('await advisoryTransactionLockString(tx, USER_EMAIL_REGISTRATION_LOCK_NAMESPACE, normalizedEmail)') &&
    createRegisteredUserSection.indexOf('await advisoryTransactionLockString(tx, USER_EMAIL_REGISTRATION_LOCK_NAMESPACE, normalizedEmail)') <
      createRegisteredUserSection.indexOf('const existingEmail = await tx.user.findFirst({') &&
    createRegisteredUserSection.indexOf('const existingEmail = await tx.user.findFirst({') <
      createRegisteredUserSection.indexOf('const user = await tx.user.create({'),
  'registered-user creation must serialize by normalized email and recheck email before user creation'
)

assert.ok(
  createRegisteredUserSection.includes('const existingUsername = await tx.user.findUnique({') &&
    createRegisteredUserSection.includes("throw new Error('USER_EXISTS')") &&
    createRegisteredUserSection.indexOf('const existingUsername = await tx.user.findUnique({') <
      createRegisteredUserSection.indexOf('const user = await tx.user.create({'),
  'registered-user creation must recheck username inside the transaction before user creation'
)

assert.ok(
  createRegisteredUserSection.includes('mode: \'insensitive\'') &&
    createRegisteredUserSection.includes("throw new Error('EMAIL_ALREADY_REGISTERED')") &&
    createRegisteredUserSection.includes('email: normalizedEmail,'),
  'registered-user creation must perform case-insensitive email uniqueness checks and persist the normalized email'
)

assert.ok(
  createRegisteredUserSection.includes("(error as { code?: unknown }).code === 'P2002'") &&
    createRegisteredUserSection.includes("throw new Error('USER_EXISTS')"),
  'registered-user creation must translate concurrent unique-key races into a business error'
)

for (const [message, errorCode] of [
  ['INVITE_CODE_UNAVAILABLE', 'ErrorCode.INVALID_INVITE_CODE'],
  ['USER_EXISTS', 'ErrorCode.USER_EXISTS'],
  ['EMAIL_ALREADY_REGISTERED', 'ErrorCode.EMAIL_ALREADY_REGISTERED']
] as const) {
  assert.ok(
    registerRouteSection.includes(`createErr.message === '${message}'`) &&
      registerRouteSection.includes(`apiError(${errorCode}`),
    `register route must map ${message} to ${errorCode}`
  )
}

console.log('registration concurrency guard tests passed')
