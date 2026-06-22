import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const authRouteSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
const userInvitesRouteSource = readFileSync(resolve(__dirname, '../src/routes/user-invites.ts'), 'utf8')
const inviteCodesDbSource = readFileSync(resolve(__dirname, '../src/db/invite-codes.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const adminInviteListRoute = sectionBetween(
  authRouteSource,
  "}>('/invites', {",
  '  // 删除邀请码'
)
const adminInviteDeleteRoute = sectionBetween(
  authRouteSource,
  "fastify.delete<{ Params: { id: string } }>('/invites/:id'",
  '  // ==================== 2FA 双因素认证 ===================='
)

const userInviteListRoute = sectionBetween(
  userInvitesRouteSource,
  "}>('/', {",
  "  fastify.post<{ Body: GenerateInviteBody }>"
)

assert.ok(
    authRouteSource.includes('const POSITIVE_INTEGER_PATTERN = /^[1-9]\\d*$/') &&
    authRouteSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number): number') &&
    authRouteSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    authRouteSource.includes('Number.isSafeInteger(parsed)') &&
    userInvitesRouteSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number): number'),
  'auth invite routes must use strict positive safe-integer parsers'
)

for (const [name, route] of [
  ['admin invite list', adminInviteListRoute],
  ['user invite list', userInviteListRoute]
] as const) {
  assert.ok(
    route.includes('const page = parsePositiveInteger(request.query.page, 1)') &&
      route.includes('const pageSize = Math.min(100, parsePositiveInteger(request.query.pageSize, 20))'),
    `${name} must clamp invalid page and pageSize query values before querying`
  )
  assert.ok(
    !route.includes('Math.max(1, parseInt(request.query.page') &&
      !route.includes('Math.max(1, parseInt(request.query.pageSize'),
    `${name} must not use Math.max with parseInt because NaN survives that expression`
  )
}

assert.ok(
  adminInviteDeleteRoute.includes('const inviteId = parsePositiveRouteId(request.params.id)') &&
    adminInviteDeleteRoute.includes('if (inviteId === null)') &&
    adminInviteDeleteRoute.includes('ErrorCode.INVALID_ID'),
  'admin invite delete route must reject malformed, decimal, non-positive, and unsafe invite IDs'
)

for (const forbiddenPattern of [
  'const inviteId = Number(id)',
  'const inviteId = Number(request.params.id)',
  'isNaN(inviteId)',
  'parseInt(request.params.id'
] as const) {
  assert.ok(
    !adminInviteDeleteRoute.includes(forbiddenPattern),
    `admin invite delete route must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  inviteCodesDbSource.includes('function clampInvitePagination(page: number, pageSize: number)') &&
    inviteCodesDbSource.includes('page: Number.isInteger(page) && page > 0 ? page : 1') &&
    inviteCodesDbSource.includes('pageSize: Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20'),
  'invite-code DB helpers must clamp invalid pagination inputs defensively'
)

for (const marker of [
  'export async function getInviteCodesWithUsers(',
  'export async function getUserInviteCodesWithUsers('
] as const) {
  const helperSection = sectionBetween(inviteCodesDbSource, marker, '/**')
  assert.ok(
    helperSection.includes('const pagination = clampInvitePagination(page, pageSize)') &&
      helperSection.includes('skip: (pagination.page - 1) * pagination.pageSize') &&
      helperSection.includes('take: pagination.pageSize'),
    `${marker} must use sanitized pagination values for Prisma skip/take`
  )
}

console.log('invite pagination guard tests passed')
