import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/transfers.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/transfers.ts'), 'utf8')
const notifierSource = readFileSync(resolve(__dirname, '../src/lib/notifier.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const listRoute = sectionBetween(routeSource, '// 获取转移列表', '// 获取待接收数量')
const createRoute = sectionBetween(routeSource, '// 发起转移请求', '// 获取转移列表')
const detailRoute = sectionBetween(routeSource, '// 获取转移详情', '// 接受转移')
const acceptRoute = sectionBetween(routeSource, '// 接受转移', '// 拒绝转移')
const rejectRoute = sectionBetween(routeSource, '// 拒绝转移', '// 取消转移')
const cancelRoute = sectionBetween(routeSource, '// 取消转移', '// 直接推送')
const pushRoute = routeSource.slice(routeSource.indexOf('// 直接推送'))
const sentHelper = sectionBetween(dbSource, '// 获取用户发起的转移列表', '// 获取用户收到的转移列表')
const receivedHelper = sectionBetween(dbSource, '// 获取用户收到的转移列表', '// 获取用户待处理的接收数量')
const executeTransferHelper = dbSource.slice(dbSource.indexOf('// 执行转移（事务操作）'))

assert.ok(
  dbSource.includes('const TRANSFER_LIST_MAX_PAGE_SIZE = 100') &&
    dbSource.includes('const TRANSFER_LIST_SEARCH_MAX_LENGTH = 128') &&
    dbSource.includes("const TRANSFER_STATUSES = new Set<TransferStatus>(['pending', 'processing', 'accepted', 'rejected', 'cancelled'])") &&
    dbSource.includes('function clampTransferListPagination') &&
    dbSource.includes('function normalizeTransferStatus') &&
    dbSource.includes('function normalizeTransferSearch'),
  'transfer DB helpers must define pagination, status, and search guards'
)

for (const [name, helper] of [
  ['sent transfers', sentHelper],
  ['received transfers', receivedHelper]
] as const) {
  assert.ok(
    helper.includes('const { page, pageSize } = clampTransferListPagination(options.page, options.pageSize)') &&
      helper.includes('const status = normalizeTransferStatus(options.status)') &&
      helper.includes('const searchTerm = normalizeTransferSearch(options.search)') &&
      helper.includes('skip: (page - 1) * pageSize') &&
      helper.includes('take: pageSize') &&
      helper.includes('totalPages: Math.ceil(total / pageSize)'),
    `${name} helper must use sanitized filters for Prisma query and metadata`
  )
}

assert.ok(
  routeSource.includes('function parsePositiveInteger(value: string | undefined, fallback?: number, max = Number.MAX_SAFE_INTEGER): number | null'),
  'transfer route must define a strict positive integer parser'
)

assert.ok(
  routeSource.includes('const TRANSFER_TARGET_USERNAME_MAX_LENGTH = 64') &&
    routeSource.includes('const TRANSFER_REMARK_MAX_LENGTH = 200') &&
    routeSource.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    routeSource.includes('function normalizeTransferCreateInput(input: unknown): TransferCreateInput'),
  'transfer creation route must define runtime body normalizers'
)

assert.ok(
  routeSource.includes("typeof input.targetUsername !== 'string'") &&
    routeSource.includes('const targetUsername = input.targetUsername.trim()') &&
    routeSource.includes('targetUsername.length < 2 || targetUsername.length > TRANSFER_TARGET_USERNAME_MAX_LENGTH') &&
    routeSource.includes("typeof input.remark !== 'string'") &&
    routeSource.includes('normalizedRemark.length > TRANSFER_REMARK_MAX_LENGTH'),
  'transfer creation normalizer must validate target username and remark before transfer side effects'
)

assert.ok(
  !routeSource.includes('parseInt(') &&
    !routeSource.includes('isNaN(') &&
    !routeSource.includes('status as any'),
  'transfer route must not use parseInt/isNaN or cast raw status filters'
)

assert.ok(
  createRoute.includes('const instanceId = parsePositiveInteger(request.params.instanceId)') &&
    createRoute.includes('if (instanceId === null)') &&
    createRoute.includes('transferInput = normalizeTransferCreateInput(request.body)') &&
    createRoute.includes('const { targetUsername, remark } = transferInput'),
  'transfer creation must reject malformed instance IDs and body values before lookup'
)

assert.ok(
  !createRoute.includes('const { targetUsername, remark } = request.body'),
  'transfer creation must not destructure raw typed request bodies'
)

assert.ok(
  listRoute.includes('page: parsePositiveInteger(page, 1) ?? 1') &&
    listRoute.includes('pageSize: parsePositiveInteger(pageSize, 20, 100) ?? 20') &&
    listRoute.includes('status,'),
  'transfer list route must parse pagination safely and pass status to DB allowlist'
)

for (const [name, route] of [
  ['detail', detailRoute],
  ['accept', acceptRoute],
  ['reject', rejectRoute],
  ['cancel', cancelRoute]
] as const) {
  assert.ok(
    route.includes('const transferId = parsePositiveInteger(request.params.id)') &&
      route.includes('if (transferId === null)'),
    `${name} transfer route must reject malformed transfer IDs before DB access`
  )
}

assert.ok(
  routeSource.includes('assertUserCanPurchaseOrReceiveInstance,') &&
    routeSource.includes('OrderRestrictedError,') &&
    routeSource.includes('orderRestrictionApiError') &&
    acceptRoute.includes('await assertUserCanPurchaseOrReceiveInstance(user.id)') &&
    acceptRoute.includes('await rollbackToPending()') &&
    acceptRoute.includes('error instanceof OrderRestrictedError') &&
    acceptRoute.includes('return reply.code(403).send(orderRestrictionApiError(error))'),
  'accept transfer route must reject purchase-restricted recipients and restore the pending transfer state'
)

assert.ok(
  executeTransferHelper.includes('userId: toUserId,') &&
    executeTransferHelper.includes('autoRenew: false,'),
  'completed transfers must disable auto-renew when ownership changes'
)

assert.ok(
  acceptRoute.includes("sendNotification(user.id, 'transfer_ownership_received'") &&
    pushRoute.includes("sendNotification(transfer.toUserId, 'transfer_ownership_received'") &&
    notifierSource.includes("| 'transfer_ownership_received'") &&
    notifierSource.includes('自动续费已关闭') &&
    notifierSource.includes('重置 SSH 密钥、登录密码等实例凭证'),
  'completed transfers must notify the new owner to reset credentials and re-enable auto-renew as needed'
)

console.log('transfer query guard tests passed')
