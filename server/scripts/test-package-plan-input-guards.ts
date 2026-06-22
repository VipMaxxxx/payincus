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

includes('const POSTGRES_INT_MAX = 2147483647', 'PostgreSQL int guard limit')
includes('const MAX_PACKAGE_PLAN_BILLING_CYCLE_MONTHS = 120', 'billing cycle cap')
includes('const MAX_PACKAGE_PLAN_SORT_ORDER = 1000000', 'sort order cap')
includes('type NormalizedPackagePlanInput = {', 'normalized plan input type')
includes('function isPlainRecord(value: unknown): value is Record<string, unknown>', 'plain object body guard')
includes('function requirePlanInteger(value: unknown, field: string, min: number, max: number): number', 'safe integer guard')
includes('typeof value !== \'number\' || !Number.isSafeInteger(value)', 'runtime number type guard')
includes('function optionalPlanBoolean(input: Record<string, unknown>, key: string, field: string): boolean | undefined', 'boolean guard')
includes('function normalizePackagePlanSlaGuarantee(value: unknown): number | null | undefined', 'SLA precision guard')
includes('SLA保证最多支持两位小数', 'SLA decimal precision rejection')
includes('return trimmed', 'description clearing support')

const createRoute = routeSection('// 创建套餐方案', '// 更新套餐方案')
const updateRoute = routeSection('// 更新套餐方案', '// 删除套餐方案')

assert.ok(
  createRoute.includes('planInput = normalizePackagePlanInput(request.body, {') &&
    createRoute.includes('requireAll: true') &&
    createRoute.includes('isVm: pkg.instance_type === \'vm\''),
  'package plan create route must normalize request body before use'
)

assert.ok(
  updateRoute.includes('planInput = normalizePackagePlanInput(request.body, {') &&
    updateRoute.includes('requireAll: false') &&
    updateRoute.includes('isVm: pkg.instance_type === \'vm\''),
  'package plan update route must normalize request body before use'
)

for (const section of [createRoute, updateRoute] as const) {
  assert.ok(
    !section.includes('const { name, description, cpu, memory, disk, portLimit, snapshotLimit, backupLimit, siteLimit, swapSize, trafficLimit, trafficLimitSpeed, price, billingCycle, isActive, isSoldOut, sortOrder, slaGuarantee } = request.body'),
    'package plan routes must not trust typed request.body destructuring'
  )
  assert.ok(
    !section.includes('if (cpu < 15 || cpu > 10000)'),
    'package plan routes must not compare unnormalized CPU values'
  )
  assert.ok(
    !section.includes('if (slaGuarantee < 1 || slaGuarantee > 100)'),
    'package plan routes must not compare unnormalized SLA values'
  )
}

includes('normalized.cpu = optionalPlanInteger(input, \'cpu\', \'CPU\', 15, 10000)', 'CPU range normalization')
includes('normalized.memory = optionalPlanInteger(input, \'memory\', \'内存\', 128, 62144)', 'memory range normalization')
includes('normalized.disk = optionalPlanInteger(input, \'disk\', \'磁盘\', 512, 104857600)', 'disk range normalization')
includes('normalized.portLimit = optionalPlanInteger(input, \'portLimit\', \'端口映射数\', 0, POSTGRES_INT_MAX)', 'port quota range normalization')
includes('normalized.billingCycle = optionalPlanInteger(input, \'billingCycle\', \'计费周期\', 1, MAX_PACKAGE_PLAN_BILLING_CYCLE_MONTHS)', 'billing cycle normalization')
includes('normalized.isActive = optionalPlanBoolean(input, \'isActive\', \'isActive\')', 'isActive normalization')
includes('normalized.isSoldOut = optionalPlanBoolean(input, \'isSoldOut\', \'isSoldOut\')', 'isSoldOut normalization')
includes('parseRequiredPostgresBigIntInput(planInput.trafficLimit)', 'normalized traffic limit parsing')
includes('normalizePlanTrafficLimitSpeed(planInput.trafficLimitSpeed)', 'normalized traffic speed parsing')
includes('updateData.billingCycle = planInput.billingCycle', 'normalized billing cycle update')
includes('updateData.slaGuarantee = planInput.slaGuarantee', 'normalized SLA update')

console.log('package plan input guard tests passed')
