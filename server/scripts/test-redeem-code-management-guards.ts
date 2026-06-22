import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/redeem-codes.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/redeem-codes.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const updateRoute = sectionBetween(routeSource, '// ==================== 更新兑换码 ====================', '// ==================== 删除兑换码 ====================')
const createRoute = sectionBetween(routeSource, '// ==================== 创建兑换码 ====================', '// ==================== 更新兑换码 ====================')
const deleteRoute = sectionBetween(routeSource, '// ==================== 删除兑换码 ====================', '// ==================== 批量删除兑换码 ====================')
const batchDeleteRoute = sectionBetween(routeSource, '// ==================== 批量删除兑换码 ====================', '// ==================== 获取兑换码使用记录 ====================')
const usagesRoute = sectionBetween(routeSource, '// ==================== 获取兑换码使用记录 ====================', '// ==================== 获取可选的资源类型和范围 ====================')

assert.ok(
  routeSource.includes('function parsePositiveId(value: string): number | null') &&
    routeSource.includes('return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null') &&
    routeSource.includes('function normalizePositiveUniqueIds(values: unknown[]): number[] | null') &&
    routeSource.includes("typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || ids.has(value)") &&
    routeSource.includes('function normalizeOptionalExpiryDate(value: string | null | undefined): Date | null | undefined') &&
    routeSource.includes('return Number.isNaN(date.getTime()) ? undefined : date'),
  'redeem-code routes must normalize positive IDs and expiry dates before DB access'
)

assert.ok(
  routeSource.includes('function normalizeRedeemCodeCreateBody(input: unknown):') &&
    routeSource.includes('function normalizeRedeemCodeUpdateBody(input: unknown):') &&
    routeSource.includes('function normalizeRedeemCodeBatchDeleteBody(input: unknown): number[] | null') &&
    routeSource.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>'),
  'redeem-code routes must define runtime body-shape normalizers'
)

assert.ok(
  routeSource.includes('const REDEEM_CODE_TYPES: RedeemCodeType[] = [\'c\', \'r\', \'d\', \'t\']') &&
    routeSource.includes('const MAX_REDEEM_CODE_BATCH_COUNT = 100') &&
    routeSource.includes('const MAX_REDEEM_CODE_MAX_USES = 1000') &&
    routeSource.includes('const MAX_REDEEM_CODE_REMARK_LENGTH = 200') &&
    routeSource.includes('db.CODE_VALUE_RANGES[codeType]'),
  'redeem-code routes must define body guard bounds'
)

assert.ok(
  !routeSource.includes('parseInt(request.params.hostId') &&
    !routeSource.includes('parseInt(request.params.codeId'),
  'redeem-code routes must not parse route IDs with parseInt'
)

for (const [name, route] of [
  ['redeem-code create', createRoute],
  ['redeem-code update', updateRoute]
] as const) {
  assert.ok(
    route.includes('normalizeOptionalExpiryDate(expiresAt)') &&
      route.includes("'Invalid expiry date'"),
    `${name} must reject malformed expiresAt values before Prisma writes`
  )
  assert.ok(
    !route.includes('new Date(expiresAt)'),
    `${name} must not pass unchecked expiresAt strings into Date/Prisma`
  )
}

assert.ok(
  createRoute.includes('body = normalizeRedeemCodeCreateBody(request.body)') &&
    createRoute.includes('const { codeType, codeValue, maxUses, expiresAt, remark, batchCount } = body') &&
    !createRoute.includes('const { codeType, codeValue, maxUses, expiresAt, remark, batchCount } = request.body'),
  'redeem-code create route must normalize body before use'
)

assert.ok(
  updateRoute.includes('body = normalizeRedeemCodeUpdateBody(request.body)') &&
    updateRoute.includes('const { enabled, remark, maxUses, expiresAt } = body') &&
    !updateRoute.includes('const { enabled, remark, maxUses, expiresAt } = request.body'),
  'redeem-code update route must normalize body before use'
)

assert.ok(
  updateRoute.includes('db.updateRedeemCodeForHost(hostId, codeId') &&
    updateRoute.includes('if (!updated)') &&
    updateRoute.includes('ErrorCode.REDEEM_CODE_NOT_FOUND') &&
    !updateRoute.includes('db.updateRedeemCode(codeId'),
  'redeem-code update must be scoped to the current host'
)

assert.ok(
  deleteRoute.includes('db.deleteRedeemCodeForHost(hostId, codeId') &&
    deleteRoute.includes('if (!deleted)') &&
    deleteRoute.includes('ErrorCode.REDEEM_CODE_NOT_FOUND') &&
    !deleteRoute.includes('db.deleteRedeemCode(codeId'),
  'redeem-code delete must be scoped to the current host'
)

assert.ok(
  batchDeleteRoute.includes("items: { type: 'integer', minimum: 1 }") &&
    batchDeleteRoute.includes('const normalizedIds = normalizeRedeemCodeBatchDeleteBody(request.body)') &&
    batchDeleteRoute.includes('db.deleteRedeemCodeBatchForHost(hostId, normalizedIds)') &&
    batchDeleteRoute.includes('if (deletedCount !== normalizedIds.length)') &&
    !batchDeleteRoute.includes('const { ids } = request.body') &&
    !batchDeleteRoute.includes('db.deleteRedeemCodeBatch(ids)'),
  'redeem-code batch delete must reject invalid IDs and be scoped to the current host'
)

assert.ok(
  usagesRoute.includes('db.isRedeemCodeBelongsToHost(codeId, hostId)') &&
    usagesRoute.includes('db.getRedeemCodeUsagesForHost(hostId, codeId') &&
    !usagesRoute.includes('db.getRedeemCodeUsages(codeId'),
  'redeem-code usage listing must verify code ownership before returning usage records'
)

assert.ok(
  dbSource.includes('const REDEEM_CODE_LIST_MAX_LIMIT = 100') &&
    dbSource.includes('function clampRedeemCodeListBounds') &&
    dbSource.includes('Math.min(Math.max(limit, 1), REDEEM_CODE_LIST_MAX_LIMIT)') &&
    dbSource.includes('offset >= 0 ? offset : 0'),
  'redeem-code DB list helpers must clamp list bounds'
)

assert.ok(
  dbSource.includes('export async function updateRedeemCodeForHost') &&
    dbSource.includes('where: { id, hostId }') &&
    dbSource.includes('export async function deleteRedeemCodeForHost') &&
    dbSource.includes('export async function deleteRedeemCodeBatchForHost') &&
    dbSource.includes('where: { id: { in: ids }, hostId }') &&
    dbSource.includes('export async function getRedeemCodeUsagesForHost') &&
    dbSource.includes('const where = { redeemCodeId, redeemCode: { hostId } }') &&
    dbSource.includes('export async function isRedeemCodeBelongsToHost'),
  'redeem-code DB management helpers must require host scope'
)

assert.ok(
  !dbSource.includes('export async function updateRedeemCode(') &&
    !dbSource.includes('export async function deleteRedeemCode(id: number)') &&
    !dbSource.includes('export async function deleteRedeemCodeBatch(ids: number[])') &&
    !dbSource.includes('export async function getRedeemCodeUsages('),
  'unsafe unscoped redeem-code management helpers must not remain exported'
)

console.log('redeem-code management guard tests passed')
