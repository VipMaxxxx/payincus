import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/redeem-codes.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/redeem-codes.ts'), 'utf8')
const checkinRouteSource = readFileSync(resolve(__dirname, '../src/routes/checkin.ts'), 'utf8')
const checkinModalSource = readFileSync(resolve(__dirname, '../../client/src/components/CheckinModal.vue'), 'utf8')
const redeemRuleLocaleSources = {
  en: readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8'),
  zhCN: readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8'),
  zhTW: readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
}

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
  routeSource.includes("const REDEEM_CODE_TYPES: readonly ResourceRedeemCodeType[] = ['c', 'r', 'd', 't']") &&
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
    deleteRoute.includes("if (deleteResult === 'not_found')") &&
    deleteRoute.includes("if (deleteResult === 'disabled')") &&
    deleteRoute.includes('ErrorCode.REDEEM_CODE_USED') &&
    deleteRoute.includes('was disabled instead of deleted') &&
    deleteRoute.includes('ErrorCode.REDEEM_CODE_NOT_FOUND') &&
    !deleteRoute.includes('db.deleteRedeemCode(codeId'),
  'redeem-code delete must be scoped to the current host and report used codes as disabled'
)

assert.ok(
    batchDeleteRoute.includes("items: { type: 'integer', minimum: 1 }") &&
    batchDeleteRoute.includes('const normalizedIds = normalizeRedeemCodeBatchDeleteBody(request.body)') &&
    batchDeleteRoute.includes('db.deleteRedeemCodeBatchForHost(hostId, normalizedIds)') &&
    batchDeleteRoute.includes('if (result.foundCount !== normalizedIds.length)') &&
    batchDeleteRoute.includes('if (result.disabledCount > 0)') &&
    batchDeleteRoute.includes('ErrorCode.REDEEM_CODE_USED') &&
    !batchDeleteRoute.includes('const { ids } = request.body') &&
    !batchDeleteRoute.includes('db.deleteRedeemCodeBatch(ids)'),
  'redeem-code batch delete must reject invalid IDs and preserve used codes'
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
    dbSource.includes('const usageCount = await tx.redeemCodeUsage.count({ where: { redeemCodeId: id } })') &&
    dbSource.includes("if (usageCount > 0)") &&
    dbSource.includes("data: { enabled: false }") &&
    dbSource.includes("return 'disabled'") &&
    dbSource.includes('export async function deleteRedeemCodeBatchForHost') &&
    dbSource.includes("const usages = await tx.redeemCodeUsage.groupBy({") &&
    dbSource.includes('const usedIds = usages.map(usage => usage.redeemCodeId)') &&
    dbSource.includes('where: { id: { in: sortedIds }, hostId }') &&
    dbSource.includes('export async function getRedeemCodeUsagesForHost') &&
    dbSource.includes('const where = { redeemCodeId, redeemCode: { hostId } }') &&
    dbSource.includes('export async function isRedeemCodeBelongsToHost'),
  'redeem-code DB management helpers must require host scope and disable codes with usage history'
)

assert.ok(
  dbSource.includes("export type ResourceRedeemCodeType = Exclude<RedeemCodeType, 'p'>") &&
    dbSource.includes("export const RESOURCE_REDEEM_CODE_TYPES: readonly ResourceRedeemCodeType[] = ['c', 'r', 'd', 't']") &&
    dbSource.includes('CODE_VALUE_RANGES: Record<ResourceRedeemCodeType') &&
    !dbSource.includes("p: { min: 1, max: 100000") &&
    dbSource.includes('assertResourceRedeemCodeType(data.codeType)') &&
    routeSource.includes("codeType: { type: 'string', enum: ['c', 'r', 'd', 't'] }") &&
    !routeSource.includes("enum: ['c', 'r', 'd', 't', 'p']"),
  'all h-code creation paths must reject deprecated points redeem codes'
)

assert.ok(
  checkinRouteSource.includes('extraTrafficQuotaDelta: trafficBytes') &&
    dbSource.includes('extraTrafficQuota: { increment: data.extraTrafficQuotaDelta }') &&
    !checkinRouteSource.includes('monthlyTrafficDelta: trafficBytes') &&
    !dbSource.includes('SET "monthly_traffic_limit" = COALESCE("monthly_traffic_limit", 0)') &&
    !dbSource.includes('monthlyTrafficDelta?: bigint'),
  'traffic h-codes must add one-time current-period extra traffic without changing the permanent monthly limit'
)

assert.ok(
  !dbSource.includes('export async function updateRedeemCode(') &&
    !dbSource.includes('export async function deleteRedeemCode(id: number)') &&
    !dbSource.includes('export async function deleteRedeemCodeBatch(ids: number[])') &&
    !dbSource.includes('export async function getRedeemCodeUsages('),
  'unsafe unscoped redeem-code management helpers must not remain exported'
)

for (const key of ['rulesRedeem1', 'rulesRedeem2', 'rulesRedeem3']) {
  assert.ok(
    checkinModalSource.includes(`t('checkin.${key}')`),
    `customer h-code redemption rules must render checkin.${key}`
  )
}

const expectedRedeemRules = {
  en: [
    'Each h-code shows its actual validity period and may be permanently valid',
    'Each h-code shows its remaining uses / total uses',
    'Redeemed resources stack permanently with no package limit'
  ],
  zhCN: [
    '每张 h-码均显示实际有效期，可能为永久有效',
    '每张 h-码均显示剩余次数 / 总次数',
    '兑换资源永久叠加，不受套餐上限限制'
  ],
  zhTW: [
    '每張 h-碼均顯示實際有效期，可能為永久有效',
    '每張 h-碼均顯示剩餘次數 / 總次數',
    '兌換資源永久疊加，不受方案上限限制'
  ]
} as const

const obsoleteRedeemRules = [
  'Redeem codes expire in 3 hours',
  'Limit 1 redemption per person per day',
  'Resources cannot exceed package limits',
  '兑换码有效期 3 小时',
  '每人每日限兑换 1 次',
  '资源不能超过套餐上限',
  '兌換碼有效期 3 小時',
  '每人每日限兌換 1 次',
  '資源不能超過方案上限'
]

for (const [locale, source] of Object.entries(redeemRuleLocaleSources)) {
  for (const expected of expectedRedeemRules[locale as keyof typeof expectedRedeemRules]) {
    assert.ok(source.includes(expected), `${locale} must describe actual h-code validity, uses, and permanent stacking`)
  }
  for (const obsolete of obsoleteRedeemRules) {
    assert.ok(!source.includes(obsolete), `${locale} must not retain obsolete h-code redemption rule: ${obsolete}`)
  }
}

console.log('redeem-code management guard tests passed')
