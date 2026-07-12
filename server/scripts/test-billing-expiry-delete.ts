import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const source = readFileSync(resolve(__dirname, '../src/services/billing-scheduler.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const expiryDeleteSection = sectionBetween(
  'async function processExpiryDelete(instance: any): Promise<void> {',
  '// ==================== 到期提醒任务 ===================='
)

const countIndex = expiryDeleteSection.indexOf('const portMappingsCount = await prisma.portMapping.count')
const rollbackIndex = expiryDeleteSection.indexOf('await rollbackResources')
const softDeleteIndex = expiryDeleteSection.indexOf('const claimResult = await prisma.instance.updateMany')
const portReleaseIndex = expiryDeleteSection.indexOf('await tx.portMapping.deleteMany')
const ipReleaseIndex = expiryDeleteSection.indexOf('await tx.ipAddress.deleteMany')
const ipv6ReleaseIndex = expiryDeleteSection.indexOf('await tx.ipv6Subnet.deleteMany')
const publicIpv4ReleaseIndex = expiryDeleteSection.indexOf('await db.releasePublicIpv4ForInstance')
const recalcIndex = expiryDeleteSection.indexOf('const usedResources = await db.calculateHostResourcesFromInstances')
const actualPortsIndex = expiryDeleteSection.indexOf('const actualPortsUsed = await prisma.portMapping.count')
const hostUpdateIndex = expiryDeleteSection.indexOf('natPortsUsedCount: actualPortsUsed')
const incusDeleteIndex = expiryDeleteSection.indexOf('await deleteIncusInstance')
const restoreClaimIndex = expiryDeleteSection.indexOf('await restoreExpiryDeleteClaim(instance)')

assert.notEqual(countIndex, -1, 'expiry delete must count actual port mappings before rollback')
assert.notEqual(rollbackIndex, -1, 'expiry delete rollback not found')
assert.notEqual(softDeleteIndex, -1, 'expiry delete conditional soft delete not found')
assert.notEqual(portReleaseIndex, -1, 'expiry delete must release port mappings')
assert.notEqual(ipReleaseIndex, -1, 'expiry delete must release IP addresses')
assert.notEqual(ipv6ReleaseIndex, -1, 'expiry delete must release IPv6 subnets')
assert.notEqual(publicIpv4ReleaseIndex, -1, 'expiry delete must release public IPv4 allocations')
assert.notEqual(recalcIndex, -1, 'expiry delete must recalculate host resources after delete')
assert.notEqual(actualPortsIndex, -1, 'expiry delete must recalculate actual port usage after delete')
assert.notEqual(hostUpdateIndex, -1, 'expiry delete must write recalculated NAT port usage to host')
assert.notEqual(incusDeleteIndex, -1, 'expiry delete must delete Incus instance')
assert.notEqual(restoreClaimIndex, -1, 'expiry delete must restore the claimed row on Incus/host failure')
assert.ok(softDeleteIndex < incusDeleteIndex, 'conditional soft delete must claim the row before Incus deletion')
assert.ok(incusDeleteIndex < rollbackIndex, 'Incus deletion must happen before resource rollback')
assert.ok(countIndex < rollbackIndex, 'actual port mapping count must happen before resource rollback')
assert.ok(rollbackIndex < portReleaseIndex, 'network allocations must be released after resource rollback')
assert.ok(portReleaseIndex < recalcIndex, 'host resource recalculation must happen after network release')
assert.ok(portReleaseIndex < actualPortsIndex, 'actual port usage recalculation must happen after network release')
assert.ok(expiryDeleteSection.includes("status: 'deleted'"), 'expiry delete must retain the instance as soft-deleted')
assert.ok(!expiryDeleteSection.includes('prisma.instance.delete'), 'expiry delete must not hard-delete the instance')
assert.ok(
  !expiryDeleteSection.includes('instanceBillingRecord.delete'),
  'expiry delete must preserve instance billing records'
)
assert.ok(
  !expiryDeleteSection.includes('portCount: instance.portLimit'),
  'expiry delete must not use portLimit as released port count'
)

console.log('billing expiry delete safety tests passed')
