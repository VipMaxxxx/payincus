import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/mail.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const subscriptionsHelper = sectionBetween(
  dbSource,
  'export async function getAllMailSubscriptions',
  '/**\n * 根据 ID 获取订阅'
)
const domainsHelper = sectionBetween(
  dbSource,
  'export async function getAllMailDomains',
  '// ==================== 邮箱账户 (MailAccount) ===================='
)
const adminSubscriptionsRoute = sectionBetween(
  routeSource,
  '// 获取所有订阅',
  '// 管理员退订（删除订阅）'
)
const adminDomainsRoute = sectionBetween(
  routeSource,
  '// 获取所有域名',
  '// ==================== 用户端：公开接口 ===================='
)

assert.ok(
  dbSource.includes('const MAIL_LIST_SEARCH_MAX_LENGTH = 128') &&
    dbSource.includes('const MAIL_LIST_MAX_PAGE_SIZE = 100') &&
    dbSource.includes('function clampMailListPagination') &&
    dbSource.includes('function normalizeMailListSearch') &&
    dbSource.includes('return trimmed ? trimmed.slice(0, MAIL_LIST_SEARCH_MAX_LENGTH) : undefined'),
  'mail list DB helpers must define shared pagination and search guards'
)

assert.ok(
  dbSource.includes("const MAIL_SUBSCRIPTION_STATUSES = new Set<MailSubscriptionStatus>(['active', 'expired', 'suspended'])") &&
    dbSource.includes("const MAIL_DOMAIN_STATUSES = new Set<MailDomainStatus>(['pending', 'verified', 'suspended'])") &&
    dbSource.includes('function normalizeMailSubscriptionStatus') &&
    dbSource.includes('function normalizeMailDomainStatus'),
  'mail list DB helpers must allowlist subscription and domain statuses'
)

for (const [name, helper, statusNormalizer] of [
  ['subscriptions', subscriptionsHelper, 'normalizeMailSubscriptionStatus(options?.status)'],
  ['domains', domainsHelper, 'normalizeMailDomainStatus(options?.status)']
] as const) {
  assert.ok(
    helper.includes('const { page, pageSize } = clampMailListPagination(options?.page, options?.pageSize)') &&
      helper.includes('skip: (page - 1) * pageSize') &&
      helper.includes('take: pageSize'),
    `${name} helper must use sanitized pagination for Prisma skip/take`
  )
  assert.ok(
    helper.includes(statusNormalizer) &&
      helper.includes('const searchTerm = normalizeMailListSearch(options?.search)') &&
      helper.includes('const searchUserId = parseMailSearchUserId(searchTerm)') &&
      !helper.includes('const searchId = parseInt(searchTerm)'),
    `${name} helper must sanitize status and search filters`
  )
}

assert.ok(
  dbSource.includes('function parseMailSearchUserId(searchTerm: string | undefined): number | undefined') &&
    dbSource.includes("if (!searchTerm || !/^\\d+$/.test(searchTerm))") &&
    dbSource.includes('return Number.isSafeInteger(id) && id > 0 ? id : undefined'),
  'mail list numeric search must only accept positive integer user IDs'
)

assert.ok(
  routeSource.includes('function parseOptionalPositiveQueryInteger') &&
    routeSource.includes('function parsePositiveQueryInteger'),
  'mail routes must define shared safe query integer parsers'
)
assert.ok(
  routeSource.includes('if (!POSITIVE_ROUTE_ID_RE.test(value))') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'mail list query integer parsers must reject loose formats and unsafe integers'
)
assert.ok(
  !routeSource.includes('return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : undefined'),
  'mail list query integer parser must not accept Number coercion formats such as scientific notation'
)

for (const [name, route] of [
  ['admin subscriptions', adminSubscriptionsRoute],
  ['admin domains', adminDomainsRoute]
] as const) {
  assert.ok(
    route.includes('sourceId: parseOptionalPositiveQueryInteger(sourceId)') &&
      route.includes('page: parsePositiveQueryInteger(page, 1)') &&
      route.includes('pageSize: parsePositiveQueryInteger(pageSize, 20, 100)') &&
      route.includes('status,') &&
      !route.includes('parseInt(sourceId)') &&
      !route.includes('status as any') &&
      !route.includes("parseInt(page || '1')") &&
      !route.includes("parseInt(pageSize || '20')"),
    `${name} route must sanitize query integers and pass raw status to DB allowlist`
  )
}

console.log('mail list query guard tests passed')
