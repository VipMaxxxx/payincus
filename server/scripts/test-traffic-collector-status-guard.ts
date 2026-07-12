import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

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

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const collectorSource = readFileSync(resolve(repoRoot, 'server/src/services/instance-traffic-collector.ts'), 'utf8')
const trafficUtilsSource = readFileSync(resolve(repoRoot, 'server/src/services/traffic-utils.ts'), 'utf8')

const applySection = section(
  collectorSource,
  'async function applyTrafficCounters(',
  '/**\n * 在实例级锁内完成一次完整的流量采集与基线提交。'
)

const selectStatus = indexOfOrThrow(applySection, 'status: true', 'status selected in traffic transaction')
const statusGuard = indexOfOrThrow(applySection, "if (instance.status !== 'running')", 'running-status guard')
const skippedReturn = indexOfOrThrow(applySection, 'skipped: true', 'skipped return')
const snapshotAdvance = indexOfOrThrow(applySection, 'const snapshotResult = await advanceTrafficSnapshot', 'atomic traffic snapshot advance')
const staleSampleReturn = indexOfOrThrow(applySection, 'if (!snapshotResult.accepted)', 'stale sample return')
const monthlyIncrement = indexOfOrThrow(applySection, 'monthlyTrafficUsed: { increment: totalDelta }', 'monthly traffic increment')
const userIncrement = indexOfOrThrow(applySection, 'monthlyTrafficUsed: { increment: totalDelta }', 'user traffic increment')
const dailyWrite = indexOfOrThrow(applySection, 'await tx.dailyTraffic.upsert', 'daily traffic write')

assert(selectStatus < statusGuard, 'collector must select current status before checking it')
assert(statusGuard < skippedReturn, 'collector must return skipped for non-running current status')
assert(statusGuard < snapshotAdvance, 'collector must check current status before advancing traffic snapshot')
assert(snapshotAdvance < staleSampleReturn, 'collector must reject a stale sample after the atomic snapshot check')
assert(staleSampleReturn < monthlyIncrement, 'collector must reject a stale sample before incrementing traffic')
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

const atomicSnapshotAdvance = section(
  trafficUtilsSource,
  'export async function advanceTrafficSnapshot(',
  '/**\n * 计算流量增量'
)
assert(
  atomicSnapshotAdvance.includes('updatedAt: { lte: sample.sampledAt }') &&
    atomicSnapshotAdvance.includes('updatedAt: sample.sampledAt'),
  'shared snapshot advance must atomically reject samples older than the stored sample time'
)
assert(
  atomicSnapshotAdvance.includes('if (updateResult.count === 0)') &&
    atomicSnapshotAdvance.includes("console.debug('[Traffic] Dropped stale traffic sample'") &&
    atomicSnapshotAdvance.includes('return { accepted: false, previous }'),
  'stale samples must be logged and rejected without advancing the shared baseline'
)

assert(
  collectorSource.includes('sampledAt: counters.sampledAt') &&
    collectorSource.includes("source: 'active-collector'"),
  'active collector must advance the shared snapshot with its source sample time'
)

console.log('traffic collector status guard checks passed')
