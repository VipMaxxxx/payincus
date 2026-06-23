import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const packagesSource = readFileSync(resolve(__dirname, '../src/routes/packages.ts'), 'utf8')
const hostsSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')

function includes(source: string, pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(source: string, pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

function routeSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

includes(packagesSource, 'function isHostTypeCompatibleWithPackage(', 'package-to-host type compatibility helper')
includes(packagesSource, 'function getIncompatiblePackageHosts(', 'package host incompatibility lookup')
includes(packagesSource, "code: 'HOST_INSTANCE_TYPE_MISMATCH'", 'package host mismatch response code')

const createPackageRoute = routeSection(
  packagesSource,
  '// 创建套餐（管理员或满足准入条件的用户）',
  '// 更新套餐（管理员或套餐所有者）'
)
const updatePackageRoute = routeSection(
  packagesSource,
  '// 更新套餐（管理员或套餐所有者）',
  '// 删除套餐（管理员或套餐所有者）'
)
const updateHostRoute = routeSection(
  hostsSource,
  '  fastify.patch<{',
  '  // 设置维护模式（管理员或节点所有者）'
)

for (const [label, section, dbWrite] of [
  ['package create', createPackageRoute, 'id = await db.createPackage({'],
  ['package update', updatePackageRoute, 'await db.updatePackage(packageId, updateData']
] as const) {
  const guardIndex = section.indexOf('const incompatibleHosts = await getIncompatiblePackageHosts(')
  const writeIndex = section.indexOf(dbWrite)
  assert.ok(guardIndex >= 0, `${label} route must check host type compatibility`)
  assert.ok(writeIndex >= 0, `${label} route must include expected DB write`)
  assert.ok(guardIndex < writeIndex, `${label} route must reject incompatible hosts before DB write`)
}

const hostGuardIndex = updateHostRoute.indexOf('const incompatiblePackages = await db.getIncompatiblePackagesByHostTypeChange(hostId, updates.instanceType)')
const hostWriteIndex = updateHostRoute.indexOf('await db.updateHost(hostId, {')
assert.ok(hostGuardIndex >= 0, 'host update route must check bound package compatibility')
assert.ok(hostWriteIndex >= 0, 'host update route must include expected DB write')
assert.ok(hostGuardIndex < hostWriteIndex, 'host update route must reject incompatible bound packages before DB write')

excludes(hostsSource, "code: 'INCOMPATIBLE_PACKAGES'", 'post-write incompatible package warning')

console.log('package host type guard tests passed')
