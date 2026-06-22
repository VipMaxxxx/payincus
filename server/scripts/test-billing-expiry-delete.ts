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
const deleteIndex = expiryDeleteSection.indexOf('await prisma.instance.delete')
const recalcIndex = expiryDeleteSection.indexOf('const usedResources = await db.calculateHostResourcesFromInstances')
const actualPortsIndex = expiryDeleteSection.indexOf('const actualPortsUsed = await prisma.portMapping.count')
const hostUpdateIndex = expiryDeleteSection.indexOf('natPortsUsedCount: actualPortsUsed')
const incusDeleteIndex = expiryDeleteSection.indexOf('await deleteIncusInstance')
const restoreClaimIndex = expiryDeleteSection.indexOf('await restoreExpiryDeleteClaim(instance)')

assert.notEqual(countIndex, -1, 'expiry delete must count actual port mappings before rollback')
assert.notEqual(rollbackIndex, -1, 'expiry delete rollback not found')
assert.notEqual(deleteIndex, -1, 'expiry delete database delete not found')
assert.notEqual(recalcIndex, -1, 'expiry delete must recalculate host resources after delete')
assert.notEqual(actualPortsIndex, -1, 'expiry delete must recalculate actual port usage after delete')
assert.notEqual(hostUpdateIndex, -1, 'expiry delete must write recalculated NAT port usage to host')
assert.notEqual(incusDeleteIndex, -1, 'expiry delete must delete Incus instance')
assert.notEqual(restoreClaimIndex, -1, 'expiry delete must restore the claimed row on Incus/host failure')
assert.ok(incusDeleteIndex < deleteIndex, 'Incus deletion must happen before database delete')
assert.ok(incusDeleteIndex < rollbackIndex, 'Incus deletion must happen before resource rollback')
assert.ok(countIndex < rollbackIndex, 'actual port mapping count must happen before resource rollback')
assert.ok(deleteIndex < recalcIndex, 'host resource recalculation must happen after database delete')
assert.ok(deleteIndex < actualPortsIndex, 'actual port usage recalculation must happen after database delete')
assert.ok(
  !expiryDeleteSection.includes('portCount: instance.portLimit'),
  'expiry delete must not use portLimit as released port count'
)

console.log('billing expiry delete safety tests passed')
