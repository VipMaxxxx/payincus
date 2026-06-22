import { readFileSync } from 'fs'
import { resolve } from 'path'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const end = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + end)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const collectorSource = readFileSync(resolve(repoRoot, 'server/src/services/instance-traffic-collector.ts'), 'utf8')

const applySection = section(
  collectorSource,
  'async function applyTrafficCounters(',
  '/**\n * 在实例级锁内完成一次完整的流量采集与基线提交。'
)

const selectStatus = indexOfOrThrow(applySection, 'status: true', 'status selected in traffic transaction')
const statusGuard = indexOfOrThrow(applySection, "if (instance.status !== 'running')", 'running-status guard')
const skippedReturn = indexOfOrThrow(applySection, 'skipped: true', 'skipped return')
const snapshotRead = indexOfOrThrow(applySection, 'const latestSnapshot = await tx.trafficSnapshot.findUnique', 'traffic snapshot read')
const snapshotWrite = indexOfOrThrow(applySection, 'await tx.trafficSnapshot.upsert', 'traffic snapshot write')
const monthlyIncrement = indexOfOrThrow(applySection, 'monthlyTrafficUsed: { increment: totalDelta }', 'monthly traffic increment')
const userIncrement = indexOfOrThrow(applySection, 'monthlyTrafficUsed: { increment: totalDelta }', 'user traffic increment')
const dailyWrite = indexOfOrThrow(applySection, 'await tx.dailyTraffic.upsert', 'daily traffic write')

assert(selectStatus < statusGuard, 'collector must select current status before checking it')
assert(statusGuard < skippedReturn, 'collector must return skipped for non-running current status')
assert(statusGuard < snapshotRead, 'collector must check current status before reading traffic snapshot')
assert(statusGuard < snapshotWrite, 'collector must check current status before writing traffic snapshot')
assert(statusGuard < monthlyIncrement, 'collector must check current status before incrementing instance monthly traffic')
assert(statusGuard < userIncrement, 'collector must check current status before incrementing user monthly traffic')
assert(statusGuard < dailyWrite, 'collector must check current status before writing daily traffic')

const collectSection = section(
  collectorSource,
  'export async function collectTrafficForInstanceWithClient(',
  '/**\n * 立即采集单个运行中实例的流量并写回数据库。'
)

assert(
  collectSection.includes('skipped: result.skipped'),
  'collector result must propagate skipped status from the transaction guard'
)

console.log('traffic collector status guard checks passed')
