import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/packages.ts'), 'utf8')

function includes(pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

function routeSection(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

includes('const MAX_PACKAGE_HOST_BINDINGS = 1000', 'package host binding cap')
includes('type NormalizedPackageInput = {', 'normalized package input type')
includes('function normalizePackageInput(input: unknown, options: { requireAll: boolean }): NormalizedPackageInput', 'package body normalizer')
includes('function normalizePackageHostIds(input: Record<string, unknown>, requireHostIds: boolean): number[] | undefined', 'host ID normalizer')
includes('!Number.isSafeInteger(hostId) || hostId <= 0 || uniqueIds.has(hostId)', 'host ID safe integer and duplicate guard')
includes('function normalizePackageHostStoragePools(input: Record<string, unknown>): Record<string, string | null> | undefined', 'host storage pool normalizer')
includes('!POSITIVE_ROUTE_ID_PATTERN.test(hostIdKey)', 'host mapping key strict parser')
includes('function normalizePackageHostTrafficMultipliers(input: Record<string, unknown>): Record<string, number> | undefined', 'host traffic multiplier normalizer')
includes('normalized[String(hostId)] = normalizeTrafficMultiplier(multiplier)', 'traffic multiplier route-boundary normalization')
includes('function normalizePackageRequiredId(value: unknown): number | null | undefined', 'required package ID normalizer')
includes('requirePackageInteger(value, \'前置套餐\', 1, Number.MAX_SAFE_INTEGER)', 'required package ID safe integer guard')
includes('input.globalQuotaMultiplier !== undefined', 'global quota multiplier must preserve absent field semantics')
includes('normalized.globalQuotaMultiplier = null', 'deprecated global quota multiplier remains nulled when submitted')

const createRoute = routeSection('// 创建套餐（管理员或满足准入条件的用户）', '// 更新套餐（管理员或套餐所有者）')
const updateRoute = routeSection('// 更新套餐（管理员或套餐所有者）', '// 删除套餐（管理员或套餐所有者）')

assert.ok(
  createRoute.includes('packageInput = normalizePackageInput(request.body, { requireAll: true })') &&
    createRoute.includes('const {') &&
    createRoute.includes('requiredPackageId') &&
    createRoute.includes('} = packageInput'),
  'package create route must normalize request body before use'
)

assert.ok(
  updateRoute.includes('packageInput = normalizePackageInput(request.body, { requireAll: false })') &&
    updateRoute.includes('const updateData: Parameters<typeof db.updatePackage>[1] = {}'),
  'package update route must normalize request body before use'
)

for (const forbiddenPattern of [
  'request.body as CreatePackageRequest & PackagePrerequisiteRequestFields',
  'PackagePrerequisiteRequestFields',
  '...restBody',
  'const updateData: Parameters<typeof db.updatePackage>[1] = { ...restBody }',
  'hostIds: hostIds!',
  'request.body.networkMode ||'
] as const) {
  excludes(forbiddenPattern, `legacy package body trust path ${forbiddenPattern}`)
}

assert.ok(
  updateRoute.includes('if (packageInput.name !== undefined) updateData.name = packageInput.name') &&
    updateRoute.includes('if (packageInput.description !== undefined) updateData.description = packageInput.description') &&
    updateRoute.includes('if (packageInput.cpuMax !== undefined) updateData.cpuMax = packageInput.cpuMax') &&
    updateRoute.includes('if (packageInput.active !== undefined) updateData.active = packageInput.active'),
  'package update route must allowlist normalized update fields'
)

includes('parseNullablePostgresBigIntInput(monthlyTrafficLimit)', 'normalized package monthly traffic parsing')
includes('hostTrafficMultipliers', 'normalized host traffic multipliers threaded into DB update')

console.log('package input guard tests passed')
