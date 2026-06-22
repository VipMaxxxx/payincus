import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isIpv6SubnetWithinSubnet } from '../src/lib/ip-calculator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/ip-addresses.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/ip-addresses.ts'), 'utf8')
const advisoryLockSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const instanceNetworkSyncSource = readFileSync(resolve(__dirname, '../src/lib/instance-network-sync.ts'), 'utf8')
const instanceTaskWorkerSource = readFileSync(resolve(__dirname, '../src/workers/instanceTaskWorker.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  source.includes('const POSITIVE_INTEGER_ID_RE = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveId(value: unknown): number | null') &&
    source.includes('Number.isSafeInteger(value) && value > 0') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'IP address routes must define a strict positive integer ID parser'
)

assert.equal(
  (source.match(/parsePositiveId\(request\.params\.instanceId\)/g) ?? []).length,
  7,
  'all IP/subnet instanceId route parameters must use strict positive ID parsing'
)
assert.equal(
  (source.match(/parsePositiveId\(request\.params\.ipId\)/g) ?? []).length,
  2,
  'IP record route parameters must use strict positive ID parsing'
)
assert.equal(
  (source.match(/parsePositiveId\(request\.params\.subnetId\)/g) ?? []).length,
  1,
  'IPv6 subnet route parameters must use strict positive ID parsing'
)

for (const forbiddenPattern of [
  'parseInt(request.params.instanceId',
  'parseInt(request.params.ipId',
  'parseInt(request.params.subnetId',
  'isNaN(instanceId)',
  'isNaN(ipId)',
  'isNaN(subnetId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `IP address routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const customIpSection = sectionBetween(
  '     * 设置自定义 IPv6 地址',
  '    /**\n     * 为实例分配 IPv6 网段'
)
assert.ok(
  customIpSection.includes('await db.updateIpAddressAddress({') &&
    customIpSection.indexOf('await db.updateIpAddressAddress({') < customIpSection.indexOf('await syncInstanceNetwork(') &&
    customIpSection.includes('address: oldAddress') &&
    customIpSection.includes('isCustom: oldIsCustom') &&
    customIpSection.includes("return reply.code(500).send({ error: 'Failed to update IP in instance network', code: 'OPERATION_FAILED' })"),
  'custom IP updates must reserve the address before Incus sync and roll the DB reservation back on Incus failure'
)
assert.ok(
  !customIpSection.includes('db.prisma.ipAddress.update'),
  'custom IP route must not bypass the locked IP address update helper'
)

assert.ok(
  advisoryLockSource.includes('export const IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE = 4119'),
  'IP address allocation must have a dedicated advisory lock namespace'
)
assert.ok(
  dbSource.includes('advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, data.address)') &&
    dbSource.includes('async function assertIpAddressAvailable(') &&
    dbSource.includes("throw new Error(IP_ADDRESS_ALREADY_EXISTS_ERROR)") &&
    dbSource.includes('export async function updateIpAddressAddress(') &&
    dbSource.includes('data: { ipv6: data.address }'),
  'IP address DB helpers must serialize IPv6 address create/update and sync primary IPv6 to Instance.ipv6'
)
assert.ok(
  instanceNetworkSyncSource.includes("if (type === 'inet6')") &&
    instanceNetworkSyncSource.includes('advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, address)'),
  'instance network sync must also serialize primary IPv6 direct ipAddress writes'
)
assert.ok(
  instanceTaskWorkerSource.includes('if (actualIpv6)') &&
    instanceTaskWorkerSource.includes('advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, actualIpv6)') &&
    instanceTaskWorkerSource.includes('ipAddresses:') &&
    instanceTaskWorkerSource.includes("type: 'inet6'"),
  'instance change-host worker must lock and recheck IPv6 uniqueness before direct ipAddress writes'
)

const deleteIpSection = sectionBetween(
  '     * 删除实例的额外 IP',
  '    /**\n     * 设置自定义 IPv6 地址'
)
assert.ok(
  deleteIpSection.includes("return reply.code(500).send({ error: 'Failed to remove IP from instance network', code: 'OPERATION_FAILED' })") &&
    deleteIpSection.indexOf('await syncInstanceNetwork(') < deleteIpSection.indexOf('await db.deleteIpAddress(ipId)'),
  'IP deletion must not remove the DB record when Incus network sync fails'
)

const allocateSubnetSection = sectionBetween(
  '     * 为实例分配 IPv6 网段',
  '    /**\n     * 删除实例的 IPv6 网段'
)
assert.ok(
  allocateSubnetSection.includes('isIpv6SubnetWithinSubnet(inputCidr, hostWithIpv6.ipv6_subnet)') &&
    allocateSubnetSection.includes("code: 'IPV6_SUBNET_NOT_IN_HOST_SUBNET'"),
  'custom IPv6 subnet allocation must stay inside the host IPv6 subnet'
)

const deleteSubnetSection = sectionBetween(
  '     * 删除实例的 IPv6 网段',
  '    /**\n     * 获取实例的 IPv6 网段列表'
)
assert.ok(
  deleteSubnetSection.includes("return reply.code(500).send({ error: 'Failed to remove subnet from instance network', code: 'OPERATION_FAILED' })") &&
    deleteSubnetSection.indexOf('await syncInstanceNetwork(') < deleteSubnetSection.indexOf('await ipv6Subnets.deleteIpv6Subnet(subnetId)'),
  'IPv6 subnet deletion must not remove the DB record when Incus network sync fails'
)

assert.equal(
  isIpv6SubnetWithinSubnet('2001:db8:1::/112', '2001:db8:1::/64'),
  true,
  'nested IPv6 subnet must be accepted'
)
assert.equal(
  isIpv6SubnetWithinSubnet('2001:db8:2::/112', '2001:db8:1::/64'),
  false,
  'IPv6 subnet outside host range must be rejected'
)
assert.equal(
  isIpv6SubnetWithinSubnet('2001:db8:1::/63', '2001:db8:1::/64'),
  false,
  'IPv6 subnet larger than the host range must be rejected'
)

console.log('IP address route guard tests passed')
