import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const source = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')
const kvmProxyStrategySource = readFileSync(resolve(__dirname, '../src/lib/proxy/KvmProxyStrategy.ts'), 'utf8')
// 单条端口映射的下发逻辑（含安全序列）住在这里 —— 用户手动添加的路由和创建实例时的自动下发
// 共用同一份实现，守卫必须钉住真正的实现处，而不是路由里那层薄薄的转发。
const portLib = readFileSync(resolve(__dirname, '../src/lib/instance-port-mapping.ts'), 'utf8')
const quotaSource = readFileSync(resolve(__dirname, '../src/db/quota-operations.ts'), 'utf8')
const provisionSource = readFileSync(resolve(__dirname, '../src/lib/managed-instance-provision.ts'), 'utf8')

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

// ── 单条端口映射的安全序列（实现已抽到 lib/instance-port-mapping.ts，路由与创建实例共用）──
assertCreateBeforeAddDevice(portLib, 'single port mapping (lib)')
const automaticAllocationIndex = portLib.indexOf('await db.allocatePort(instance.host_id, protocol)')
const unifiedPortCheckIndex = portLib.indexOf('await db.checkPortInUse(instance.host_id, allocatedPort, protocol)')
assert.notEqual(automaticAllocationIndex, -1, 'single port mapping: automatic allocation not found')
assert.notEqual(unifiedPortCheckIndex, -1, 'single port mapping: unified checkPortInUse not found')
assert.ok(
  automaticAllocationIndex < unifiedPortCheckIndex,
  'single port mapping: automatically allocated ports must pass checkPortInUse before DB reservation'
)
assert.ok(
  unifiedPortCheckIndex < portLib.indexOf('await db.createPortMapping'),
  'single port mapping: checkPortInUse must run before DB reservation'
)
assert.ok(
  !portLib.includes('await removeDevice(client, instance.incus_id, deviceName)') &&
    portLib.includes('for (const createdDeviceName of createdDeviceNames)') &&
    portLib.includes('await db.deletePortMapping(reservedMappingId)'),
  'single port rollback must remove only the device names this request actually created, and undo the DB reservation'
)

const singlePortSection = sectionBetween('// 添加端口映射', '// 删除端口映射')
assert.ok(
  singlePortSection.includes('await addInstancePortMapping(') &&
    singlePortSection.includes('await db.checkPortQuota(instance.user_id, instanceId)'),
  'the manual add-port route must delegate to the shared addInstancePortMapping and still enforce the port quota'
)

// ── 创建实例时自动下发的远程端口（Linux=22 / Windows=3389）──
// 这条映射不计入用户端口配额，否则等于凭空扣掉用户一个名额。实例创建有两条独立路径
// （用户自建 createInstanceAsync、托管 provisionManagedInstanceAsync），两条都必须下发，
// 否则会漏掉一半实例。
assert.ok(
  portLib.includes('export async function provisionAutoRemotePort') &&
    portLib.includes('systemManaged: true') &&
    portLib.includes('isInstanceAutoRemotePortEnabled()') &&
    portLib.includes('input.autoRemotePort === false'),
  'auto remote port must be marked systemManaged and honour both the global switch and the per-create opt-out'
)

// 真正调用一次，别只匹配字符串：镜像 → 私有端口的映射错了会直接给用户一条永远连不通的映射。
// 从零依赖的 remote-port.ts 导入 —— 从 instance-port-mapping.ts 导入会连带拉起 Prisma 并挂住进程。
const { resolveRemotePrivatePort, REMOTE_PORT_SSH, REMOTE_PORT_RDP } =
  await import('../src/lib/remote-port.js')
for (const image of ['windows-11', 'Windows Server 2022', 'win2019', 'WINDOWS10']) {
  assert.equal(resolveRemotePrivatePort(image), REMOTE_PORT_RDP, `Windows image "${image}" must map to RDP ${REMOTE_PORT_RDP}`)
}
for (const image of ['debian/12', 'ubuntu/24.04', 'alpine/3.20', 'centos/9-Stream', '']) {
  assert.equal(resolveRemotePrivatePort(image), REMOTE_PORT_SSH, `non-Windows image "${image}" must map to SSH ${REMOTE_PORT_SSH}`)
}
assert.equal(resolveRemotePrivatePort(null), REMOTE_PORT_SSH, 'a missing image must fall back to SSH, never to RDP')
assert.ok(
  quotaSource.includes('portMappings: { where: { systemManaged: false } }'),
  'the system-managed remote port must not consume the user port quota'
)
assert.ok(
  source.includes('portMappings.filter(mapping => !mapping.system_managed).length'),
  'the displayed port usage must exclude the system-managed remote port, matching checkPortQuota'
)
assert.ok(
  source.includes('await provisionAutoRemotePort({') &&
    provisionSource.includes('await provisionAutoRemotePort({'),
  'both instance creation paths (self-serve and managed) must provision the auto remote port'
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
