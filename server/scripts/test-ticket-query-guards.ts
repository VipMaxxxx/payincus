import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ticketsDbSource = readFileSync(resolve(__dirname, '../src/db/tickets.ts'), 'utf8')
const ticketsRouteSource = readFileSync(resolve(__dirname, '../src/routes/tickets.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  ticketsDbSource.includes('function clampPagination(') &&
    ticketsDbSource.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
    ticketsDbSource.includes('Math.min(Math.max(pageSize, 1), maxPageSize)') &&
    ticketsDbSource.includes("function normalizeTicketStatus(status: TicketStatus | 'active' | undefined)") &&
    ticketsDbSource.includes('function normalizeSearchTerm(search: string | undefined): string') &&
    ticketsDbSource.includes("return search?.trim().slice(0, 128) ?? ''") &&
    ticketsDbSource.includes('function getSearchId(searchTerm: string): number | null'),
  'ticket DB helpers must define shared pagination, status, search, and numeric-search guards'
)

for (const [helperName, fallbackPageSize, endMarker] of [
  ['getUserTickets', 10, '/**\n * 获取宿主机的工单列表'],
  ['getHostTickets', 10, '/**\n * 获取用户所有宿主机的工单'],
  ['getOwnerAllTickets', 10, '/**\n * 获取工单消息列表'],
  ['getTicketMessages', 50, '/**\n * 添加工单消息']
] as const) {
  const helperSection = sectionBetween(
    ticketsDbSource,
    `export async function ${helperName}(`,
    endMarker
  )

  assert.ok(
    helperSection.includes(`const { page, pageSize } = clampPagination(options.page, options.pageSize, ${fallbackPageSize})`) &&
      helperSection.includes('const skip = (page - 1) * pageSize') &&
      helperSection.includes('skip,') &&
      helperSection.includes('take: pageSize') &&
      helperSection.includes('page,') &&
      helperSection.includes('pageSize,') &&
      helperSection.includes('totalPages: Math.ceil(total / pageSize)'),
    `${helperName} must use sanitized pagination values for Prisma and response metadata`
  )
}

for (const helperName of ['getUserTickets', 'getHostTickets', 'getOwnerAllTickets'] as const) {
  const helperSection = sectionBetween(
    ticketsDbSource,
    `export async function ${helperName}(`,
    helperName === 'getUserTickets'
      ? '/**\n * 获取宿主机的工单列表'
      : helperName === 'getHostTickets'
        ? '/**\n * 获取用户所有宿主机的工单'
        : '/**\n * 获取工单消息列表'
  )

  assert.ok(
    helperSection.includes('const status = normalizeTicketStatus(options.status)') &&
      helperSection.includes('const searchTerm = normalizeSearchTerm(options.search)') &&
      helperSection.includes('const searchId = getSearchId(searchTerm)') &&
      !helperSection.includes('const searchId = parseInt(searchTerm)'),
    `${helperName} must normalize status/search values before building Prisma filters`
  )
}

assert.ok(
  sectionBetween(ticketsDbSource, 'export async function getOwnerAllTickets(', '/**\n * 获取工单消息列表')
    .includes('Number.isInteger(options.hostId) && options.hostId !== undefined && options.hostId > 0'),
  'owner ticket summary must ignore invalid hostId filters before Prisma queries'
)

assert.ok(
  ticketsRouteSource.includes('function parsePositiveId(value: unknown): number | null') &&
    ticketsRouteSource.includes('const POSITIVE_INTEGER_ID_RE = /^[1-9]\\d*$/') &&
    ticketsRouteSource.includes('Number.isSafeInteger(value) && value > 0') &&
    ticketsRouteSource.includes('function parseOptionalPositiveId(value: unknown): number | undefined | null') &&
    ticketsRouteSource.includes('function parsePositiveInteger(value: unknown, fallback: number, max?: number): number'),
  'ticket routes must define strict positive ID and pagination parsers'
)

assert.ok(
  ticketsRouteSource.includes('const attachmentId = parsePositiveId(request.params.attachmentId)') &&
    ticketsRouteSource.includes('const messageId = parsePositiveId(request.params.messageId)') &&
    (ticketsRouteSource.match(/const ticketId = parsePositiveId\(request\.params\.id\)/g) ?? []).length >= 6,
  'ticket path routes must parse attachment, ticket, and message IDs through strict positive ID guards'
)

for (const forbiddenPattern of [
  'Number(request.params.attachmentId)',
  'Number(request.params.id)',
  'Number(request.params.messageId)',
  'isNaN(attachmentId)',
  'isNaN(ticketId)',
  'isNaN(messageId)'
] as const) {
  assert.ok(
    !ticketsRouteSource.includes(forbiddenPattern),
    `ticket routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const createTicketRoute = sectionBetween(
  ticketsRouteSource,
  "fastify.post('/',",
  '  /**\n   * 获取我的工单列表'
)
const userTicketsRoute = sectionBetween(
  ticketsRouteSource,
  "fastify.get<{",
  '  /**\n   * 读取工单图片内容'
)
const messagesRoute = sectionBetween(
  ticketsRouteSource,
  "}>('/:id/messages'",
  '  /**\n   * 回复工单'
)
const statusRoute = sectionBetween(
  ticketsRouteSource,
  "}>('/:id/status'",
  '  /**\n   * 关闭工单'
)
const hostTicketsRoute = sectionBetween(
  ticketsRouteSource,
  "}>('/hosts/:hostId'",
  '  /**\n   * 获取所有宿主机的工单'
)
const ownerTicketsRoute = sectionBetween(
  ticketsRouteSource,
  "}>('/my-hosts'",
  '  /**\n   * 获取待处理工单数量'
)

assert.ok(
  !ticketsRouteSource.includes('function parseInteger(value: string | undefined): number | null') &&
    createTicketRoute.includes('const instanceId = parseOptionalPositiveId(payload.fields.instanceId)') &&
    createTicketRoute.includes('if (instanceId === null)') &&
    createTicketRoute.includes('return reply.code(400).send(apiError(ErrorCode.INVALID_ID))') &&
    createTicketRoute.includes('if (instanceId !== undefined)') &&
    createTicketRoute.includes('instanceId: instanceId ?? null'),
  'ticket create route must reject malformed optional instanceId instead of silently creating an unscoped admin ticket'
)

assert.ok(
  ticketsRouteSource.includes('function normalizeTicketStatusBody(body: unknown): TicketStatus | null') &&
    ticketsRouteSource.includes("if (!body || typeof body !== 'object' || Array.isArray(body))") &&
    statusRoute.includes('const status = normalizeTicketStatusBody(request.body)') &&
    statusRoute.includes('if (!status)') &&
    !statusRoute.includes('const { status } = request.body'),
  'ticket status route must validate runtime body shape before reading status'
)

assert.ok(
  userTicketsRoute.includes('page: parsePositiveInteger(page, 1)') &&
    userTicketsRoute.includes('pageSize: parsePositiveInteger(pageSize, 10, 100)'),
  'user ticket list route must sanitize pagination before calling DB helper'
)

assert.ok(
  messagesRoute.includes('const ticketId = parsePositiveId(request.params.id)') &&
    messagesRoute.includes('if (ticketId === null)') &&
    messagesRoute.includes('page: parsePositiveInteger(page, 1)') &&
    messagesRoute.includes('pageSize: parsePositiveInteger(pageSize, 50, 100)'),
  'ticket messages route must sanitize ticket ID and pagination before DB access'
)

assert.ok(
  hostTicketsRoute.includes('const hostId = parsePositiveId(request.params.hostId)') &&
    hostTicketsRoute.includes('if (hostId === null)') &&
    hostTicketsRoute.includes('page: parsePositiveInteger(page, 1)') &&
    hostTicketsRoute.includes('pageSize: parsePositiveInteger(pageSize, 10, 100)'),
  'host ticket list route must sanitize host ID and pagination before DB access'
)

assert.ok(
  ownerTicketsRoute.includes('const parsedHostId = parseOptionalPositiveId(hostId)') &&
    ownerTicketsRoute.includes('if (parsedHostId === null)') &&
    ownerTicketsRoute.includes('hostId: parsedHostId') &&
    ownerTicketsRoute.includes('page: parsePositiveInteger(page, 1)') &&
    ownerTicketsRoute.includes('pageSize: parsePositiveInteger(pageSize, 10, 100)'),
  'owner ticket summary route must sanitize optional hostId and pagination before DB access'
)

console.log('ticket query guard tests passed')
