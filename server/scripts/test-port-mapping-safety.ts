import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const source = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')
const kvmProxyStrategySource = readFileSync(resolve(__dirname, '../src/lib/proxy/KvmProxyStrategy.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function assertCreateBeforeAddDevice(section: string, label: string): void {
  const createIndex = section.indexOf('await db.createPortMapping')
  const addDeviceIndex = section.indexOf('await addDevice')
  assert.notEqual(createIndex, -1, `${label}: createPortMapping not found`)
  assert.notEqual(addDeviceIndex, -1, `${label}: addDevice not found`)
  assert.ok(createIndex < addDeviceIndex, `${label}: DB port reservation must happen before Incus device mutation`)
}

const singlePortSection = sectionBetween('// 添加端口映射', '// 删除端口映射')
assertCreateBeforeAddDevice(singlePortSection, 'single port mapping')
const automaticAllocationIndex = singlePortSection.indexOf('await db.allocatePort(instance.host_id, protocol)')
const unifiedPortCheckIndex = singlePortSection.indexOf('await db.checkPortInUse(instance.host_id, allocatedPort, protocol)')
assert.notEqual(automaticAllocationIndex, -1, 'single port mapping: automatic allocation not found')
assert.notEqual(unifiedPortCheckIndex, -1, 'single port mapping: unified checkPortInUse not found')
assert.ok(
  automaticAllocationIndex < unifiedPortCheckIndex,
  'single port mapping: automatically allocated ports must pass checkPortInUse before DB reservation'
)
assert.ok(
  unifiedPortCheckIndex < singlePortSection.indexOf('await db.createPortMapping'),
  'single port mapping: checkPortInUse must run before DB reservation'
)
assert.ok(
  !singlePortSection.includes('await removeDevice(client, instance.incus_id, deviceName)'),
  'single port rollback must not remove a generic device name that may belong to another request'
)

const batchPortSection = sectionBetween('// 批量添加端口映射', '// 设置实例配额')
assertCreateBeforeAddDevice(batchPortSection, 'batch port mapping')
assert.ok(
  source.includes("function getInstancePortMappingLockKey(instanceId: number): string {\n  return `instance:${instanceId}:port-mappings`"),
  'port mapping routes must use a stable per-instance lock key'
)
assert.ok(
  singlePortSection.includes('const portLock = await acquireLock(portLockKey, PORT_MAPPING_LOCK_OPTIONS)') &&
    singlePortSection.includes('await releaseLock(portLockKey, portLock.ownerId)'),
  'single port mapping creation must hold and release the per-instance port lock'
)

const deletePortSection = sectionBetween('// 删除端口映射', '// 批量添加端口映射')
assert.ok(
  deletePortSection.includes('const portLock = await acquireLock(portLockKey, PORT_MAPPING_LOCK_OPTIONS)') &&
    deletePortSection.includes('await releaseLock(portLockKey, portLock.ownerId)'),
  'port mapping deletion must hold and release the same per-instance port lock as creation'
)
assert.ok(
  deletePortSection.includes('await removeDevice(client, instance.incus_id, deviceName)') &&
    deletePortSection.includes('await db.deletePortMapping(portMappingId)'),
  'port mapping deletion must keep Incus device removal and DB deletion in the locked critical section'
)

assert.ok(
  batchPortSection.includes('const portLock = await acquireLock(portLockKey, PORT_MAPPING_LOCK_OPTIONS)') &&
    batchPortSection.includes('await releaseLock(portLockKey, portLock.ownerId)'),
  'batch port mapping creation must hold and release the per-instance port lock'
)
assert.ok(
  batchPortSection.includes('throw new PortMappingValidationError') &&
    batchPortSection.includes('error instanceof PortMappingValidationError'),
  'batch port mapping validation failures must enter the rollback catch path and still return 400'
)
assert.ok(
  kvmProxyStrategySource.includes('当前宿主机没有可用于 KVM 端口映射的本机 IPv4 监听地址') &&
    kvmProxyStrategySource.includes('nat_bind_ip'),
  'KVM port mapping validation must tell operators to configure nat_bind_ip instead of surfacing a generic Invalid parameters error'
)
assert.ok(
  !batchPortSection.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, proxyDeviceRes.errorMessage || '代理对象工厂拦截异常'))"),
  'batch port mapping must not return directly after partial mapping/device creation can exist'
)

assert.ok(
  source.includes('const MAX_BATCH_PORT_MAPPINGS = 100') &&
    batchPortSection.includes('maxItems: MAX_BATCH_PORT_MAPPINGS') &&
    batchPortSection.includes('finalMappings.length > MAX_BATCH_PORT_MAPPINGS'),
  'batch port mapping schema and final normalized mappings must reject oversized requests'
)
assert.ok(
  batchPortSection.includes('new Set(privatePorts).size !== finalMappings.length') &&
    batchPortSection.includes('new Set(publicPorts).size !== finalMappings.length'),
  'batch port mapping must reject duplicate private and public ports in final mappings'
)
assert.ok(
  batchPortSection.includes('mapping.privatePort < natPortStart || mapping.privatePort > natPortEnd') &&
    batchPortSection.includes('mapping.publicPort < natPortStart || mapping.publicPort > natPortEnd') &&
    batchPortSection.includes("apiError(ErrorCode.PORT_RANGE_INVALID, `允许范围: ${natPortStart}-${natPortEnd}`)"),
  'batch port mapping must reject private or public ports outside the host NAT range'
)
assert.ok(
  batchPortSection.includes("const quotaNeeded = finalMappings.length * (protocol === 'both' ? 2 : 1)") &&
    batchPortSection.indexOf('const quotaNeeded = finalMappings.length') > batchPortSection.indexOf('if (portMappings && portMappings.length > 0)'),
  'batch port quota must be calculated from the final normalized mappings'
)

console.log('port mapping safety tests passed')
