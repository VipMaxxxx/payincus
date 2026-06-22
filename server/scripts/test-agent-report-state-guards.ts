import { readFileSync } from 'fs'
import { resolve } from 'path'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  assert(start >= 0, `Missing section start: ${startPattern}`)
  const end = source.indexOf(endPattern, start)
  assert(end > start, `Missing section end: ${endPattern}`)
  return source.slice(start, end)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const source = readFileSync(resolve(repoRoot, 'server/src/services/agent-instance-report.ts'), 'utf8')

assert(
  source.includes("import { isIP } from 'node:net'"),
  'Agent instance report must validate reported IP addresses with node:net'
)

const networkAddressGuard = section(
  source,
  'function normalizeNetworkAddress(',
  'function normalizeAgentInstanceItems('
)
assert(
  networkAddressGuard.includes('family: 4 | 6') &&
    networkAddressGuard.includes('if (value === null)') &&
    networkAddressGuard.includes("if (typeof value !== 'string')") &&
    networkAddressGuard.includes('address.length > 128 || isIP(address) !== family'),
  'Agent reported network addresses must ignore malformed strings while allowing explicit null clears'
)

const itemNormalizer = section(
  source,
  'function normalizeAgentInstanceItems(',
  'function shouldSyncStatus('
)
assert(
  itemNormalizer.includes('ipv4: normalizeNetworkAddress(network.ipv4, 4)') &&
    itemNormalizer.includes('ipv6: normalizeNetworkAddress(network.ipv6, 6)'),
  'Agent instance report must validate IPv4 and IPv6 fields against their address families'
)

const syncGuard = section(
  source,
  'function shouldSyncStatus(',
  'function shouldApplyTraffic('
)
assert(
  syncGuard.includes("return currentStatus === 'running' || currentStatus === 'stopped'"),
  'Agent status sync must only update running/stopped business states'
)
assert(
  !syncGuard.includes("currentStatus === 'error'"),
  'Agent status sync must not resurrect error instances'
)

const trafficGuard = section(
  source,
  'function shouldApplyTraffic(',
  'function buildStatusUpdateData('
)
assert(
  trafficGuard.includes("item.status !== 'running' || item.rxBytes === null || item.txBytes === null"),
  'Agent traffic writes must require a running reported status and both counters'
)
assert(
  trafficGuard.includes("return currentStatus === 'running'"),
  'Agent traffic writes must require current database state to be running'
)
assert(
  !trafficGuard.includes("currentStatus === 'stopped'") && !trafficGuard.includes("currentStatus === 'error'"),
  'Agent traffic writes must not apply to stopped/error database states'
)

const reportProcessor = section(
  source,
  'async function processOneAgentInstanceReport(',
  'export async function processAgentInstanceReport('
)
assert(
  reportProcessor.includes('let trafficInstance = instance'),
  'Agent report processing must track the status after a successful sync before traffic writes'
)
assert(
  reportProcessor.includes('statusUpdated = updateResult.count') &&
    reportProcessor.includes('if (statusUpdated > 0)') &&
    reportProcessor.includes('status: updateData.status'),
  'Agent report processing must only use the synced status after the database update succeeds'
)
assert(
  reportProcessor.includes("status: { in: ['running', 'stopped'] }"),
  'Agent status writes must re-check the current database state to avoid resurrecting suspended/error instances'
)
assert(
  reportProcessor.includes('applyReportedTrafficCounters(trafficInstance, item, now)'),
  'Agent traffic processing must use the post-sync status guard input'
)

const trafficApply = section(
  source,
  'async function applyReportedTrafficCounters(',
  'async function processOneAgentInstanceReport('
)
assert(
  trafficApply.includes('const currentInstance = await tx.instance.findUnique') &&
    trafficApply.includes('!currentInstance || !shouldApplyTraffic(currentInstance.status, item)'),
  'Agent traffic writes must re-check current instance status inside the write transaction'
)

console.log('agent report state guard checks passed')
