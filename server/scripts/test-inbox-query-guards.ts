import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/inbox.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/inbox.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const listRoute = sectionBetween(
  routeSource,
  "fastify.get<{",
  "  /**\n   * 获取未读消息数量"
)

const readRoute = sectionBetween(
  routeSource,
  "}>('/:id/read'",
  "  /**\n   * 标记所有消息为已读"
)

const deleteRoute = sectionBetween(
  routeSource,
  "}>('/:id'",
  "  /**\n   * 删除所有已读消息"
)

const getInboxMessages = sectionBetween(
  dbSource,
  'export async function getInboxMessages(',
  '/**\n * 获取用户未读消息数量'
)

assert.ok(
  routeSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number): number') &&
    routeSource.includes('const POSITIVE_INTEGER_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveId(value: string): number | null') &&
    routeSource.includes('Number.isSafeInteger(parsed)') &&
    routeSource.includes('function parsePositiveIdArray(value: number[] | undefined): number[] | undefined | null'),
  'inbox routes must define strict pagination, route ID, and ID-array parsers'
)

assert.ok(
  routeSource.includes('function normalizeInboxMessageInput(body: unknown)') &&
    routeSource.includes("if (!body || typeof body !== 'object' || Array.isArray(body))") &&
    routeSource.includes("const trimmedTitle = title.trim()") &&
    routeSource.includes("const trimmedContent = content.trim()") &&
    routeSource.includes('trimmedTitle.length > 200') &&
    routeSource.includes('trimmedContent.length > 5000'),
  'inbox send routes must share runtime body/title/content validation before destructuring or persistence'
)

assert.equal(
  routeSource.match(/normalizeInboxMessageInput\(request\.body\)/g)?.length,
  4,
  'all inbox broadcast/direct/host notification send routes must use shared message input normalization'
)

assert.ok(
  !routeSource.includes('const { title, content } = request.body'),
  'inbox send routes must not destructure title/content from possibly missing request bodies'
)

assert.ok(
  listRoute.includes('page: parsePositiveInteger(request.query.page, 1)') &&
    listRoute.includes('pageSize: Math.min(100, parsePositiveInteger(request.query.pageSize, 20))') &&
    listRoute.includes("if (isRead === 'true')") &&
    listRoute.includes("} else if (isRead === 'false')"),
  'inbox list route must sanitize pagination and only accept explicit boolean isRead filters'
)

assert.ok(
    !listRoute.includes('parseInt(page') &&
    !listRoute.includes('parseInt(pageSize') &&
    !listRoute.includes('Number(request.query') &&
    !listRoute.includes('Math.max(1,'),
  'inbox list route must not keep raw parseInt or Math.max pagination parsing'
)

for (const [name, route] of [
  ['read route', readRoute],
  ['delete route', deleteRoute]
] as const) {
  assert.ok(
    route.includes('const messageId = parsePositiveId(id)') &&
      route.includes('if (messageId === null)') &&
      route.includes('apiError(ErrorCode.INVALID_ID)'),
    `${name} must reject NaN, Infinity, zero, and negative message IDs before DB access`
  )
}

for (const forbiddenPattern of [
  'Number(request.params.hostId)',
  'Number(request.params.userId)',
  'Number(request.params.instanceId)',
  'isNaN(hostId)',
  'isNaN(targetUserId)',
  'isNaN(instanceId)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `inbox notification routes must not keep loose route ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  routeSource.includes('const hostId = parsePositiveId(request.params.hostId)') &&
    routeSource.includes('const normalizedInstanceIds = parsePositiveIdArray(instanceIds)') &&
    routeSource.includes('if (normalizedInstanceIds === null)') &&
    routeSource.includes('const recipients = await inboxDb.getUniqueRecipientsByHostId(hostId, normalizedInstanceIds)'),
  'host notification route must strictly validate host ID and optional instance IDs before recipient lookup'
)

assert.ok(
  routeSource.includes('const targetUserId = parsePositiveId(request.params.userId)') &&
    routeSource.includes('if (targetUserId === null)') &&
    routeSource.includes('const instanceId = parsePositiveId(request.params.instanceId)') &&
    routeSource.includes('if (instanceId === null)'),
  'admin direct send and instance notification routes must strictly validate path IDs before DB access'
)

assert.ok(
  dbSource.includes('function clampInboxPagination(page: number | undefined, pageSize: number | undefined)') &&
    dbSource.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
    dbSource.includes('Math.min(Math.max(pageSize, 1), 100)'),
  'inbox DB helper must defensively clamp invalid pagination inputs'
)

assert.ok(
  getInboxMessages.includes('const { page, pageSize } = clampInboxPagination(options.page, options.pageSize)') &&
    getInboxMessages.includes('const skip = (page - 1) * pageSize') &&
    getInboxMessages.includes('skip,') &&
    getInboxMessages.includes('take: pageSize') &&
    getInboxMessages.includes('page,') &&
    getInboxMessages.includes('pageSize,'),
  'getInboxMessages must use sanitized pagination values for Prisma and response metadata'
)

assert.ok(
  getInboxMessages.includes('...(options.isRead !== undefined ? { isRead: options.isRead } : {})'),
  'getInboxMessages must only filter isRead when the route passes an explicit boolean'
)

console.log('inbox query guard tests passed')
