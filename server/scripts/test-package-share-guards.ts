import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/packages.ts'), 'utf8')
const sharesSource = readFileSync(resolve(__dirname, '../src/db/package-shares.ts'), 'utf8')

function includes(source: string, pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(source: string, pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

function routeSection(start: string, end: string): string {
  const startIndex = routeSource.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing route section start: ${start}`)
  const endIndex = routeSource.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing route section end: ${end}`)
  return routeSource.slice(startIndex, endIndex)
}

includes(routeSource, 'type NormalizedPackageShareInput = {', 'normalized package share input type')
includes(routeSource, 'function normalizePackageShareInput(input: unknown, options: { requireFriendId: boolean }): NormalizedPackageShareInput', 'package share body normalizer')
includes(routeSource, 'normalized.friendId = requirePackageInteger(input.friendId, \'好友 ID\', 1, Number.MAX_SAFE_INTEGER)', 'friend ID safe integer guard')
includes(routeSource, 'function normalizePackageShareQuotaMultiplier(value: unknown): number | null | undefined', 'share quota multiplier guard')
includes(routeSource, 'value < 0.1 || value > 99.9', 'share quota multiplier DB precision bound')
includes(routeSource, '配额倍数最多支持一位小数', 'share quota multiplier scale guard')
includes(routeSource, 'function normalizePackageShareMaxInstances(value: unknown): number | null | undefined', 'share max instances guard')
includes(routeSource, 'return requirePackageInteger(value, \'共享最大实例数\', 0, MAX_PACKAGE_HOST_BINDINGS)', 'share max instances safe integer bound')

const shareCreateRoute = routeSection('// 共享套餐给好友', '// 取消套餐共享')
const shareQuotaRoute = routeSection('// 修改共享配额限制', '// 获取套餐的共享列表')

assert.ok(
  shareCreateRoute.includes('shareInput = normalizePackageShareInput(request.body, { requireFriendId: true })') &&
    shareCreateRoute.includes('const { friendId, quotaMultiplier, maxInstances } = shareInput'),
  'package share create route must normalize body before use'
)

assert.ok(
  shareQuotaRoute.includes('shareInput = normalizePackageShareInput(request.body, { requireFriendId: false })') &&
    shareQuotaRoute.includes('const { quotaMultiplier, maxInstances } = shareInput'),
  'package share quota route must normalize body before use'
)

includes(routeSource, 'const existingShare = await packageShares.isPackageSharedTo(packageId, friendId!)', 'duplicate share check must query actual PackageShare row')

for (const forbiddenPattern of [
  'const { friendId, quotaMultiplier, maxInstances } = request.body',
  'const { quotaMultiplier, maxInstances } = request.body',
  'const existingShare = await packageShares.getPackageShareForUser(packageId, friendId)'
] as const) {
  excludes(routeSource, forbiddenPattern, `legacy package share body path ${forbiddenPattern}`)
}

includes(sharesSource, 'const share = await client.packageShare.findUnique({', 'friend share lookup in getPackageShareForUser')
includes(sharesSource, 'packageId_sharedToId: {', 'friend share lookup uses unique package/user key')
includes(sharesSource, 'isGlobalShared: false', 'friend share quota returned as non-global share')
includes(sharesSource, 'quotaMultiplier: share.quotaMultiplier ? Number(share.quotaMultiplier) : null', 'friend share quota multiplier returned')
includes(sharesSource, 'maxInstances: share.maxInstances', 'friend share max instances returned')

console.log('package share guard tests passed')
