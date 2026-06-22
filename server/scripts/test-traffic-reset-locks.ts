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
const trafficDbSource = readFileSync(resolve(repoRoot, 'server/src/db/traffic.ts'), 'utf8')
const collectorSource = readFileSync(resolve(repoRoot, 'server/src/services/instance-traffic-collector.ts'), 'utf8')
const agentReportSource = readFileSync(resolve(repoRoot, 'server/src/services/agent-instance-report.ts'), 'utf8')

assert(
  trafficDbSource.includes("function getTrafficInstanceLockKey(instanceId: number): string {\n    return `traffic:instance:${instanceId}`"),
  'traffic reset code must use the same instance traffic lock key as collectors'
)
assert(
  trafficDbSource.includes("function getTrafficUserLockKey(userId: number): string {\n    return `traffic:user:${userId}`"),
  'traffic reset code must define a user traffic lock key'
)

const resetAllUsers = section(
  trafficDbSource,
  'export async function resetAllUserMonthlyTraffic()',
  '/**\n * 重置所有实例的月度流量用量'
)
assert(
  resetAllUsers.includes('await withLock(getTrafficUserLockKey(quota.userId)'),
  'user monthly traffic reset must acquire the user traffic lock'
)
assert(
  !resetAllUsers.includes('return prisma.userQuota.updateMany({'),
  'user monthly traffic reset must not directly bulk update all user quotas without locks'
)

const resetAllInstances = section(
  trafficDbSource,
  'export async function resetAllInstanceMonthlyTraffic()',
  '/**\n * 重置单个实例的月度流量用量'
)
assert(
  resetAllInstances.includes('await resetInstanceMonthlyTraffic(instance.id)'),
  'all-instance monthly traffic reset must delegate to the locked single-instance reset'
)
assert(
  !resetAllInstances.includes('return prisma.instance.updateMany({'),
  'all-instance monthly traffic reset must not directly bulk update instances without locks'
)

const resetOneInstance = section(
  trafficDbSource,
  'export async function resetInstanceMonthlyTraffic(instanceId: number)',
  '/**\n * 更新实例的带宽限制配置'
)
assert(
  resetOneInstance.includes('await withLock(getTrafficInstanceLockKey(instanceId)'),
  'single-instance traffic reset must acquire the instance traffic lock'
)

const resetHostInstances = section(
  trafficDbSource,
  'export async function resetHostInstancesMonthlyTraffic(hostIds: number[])',
  '// ==================== 查询操作'
)
assert(
  resetHostInstances.includes('await resetInstanceMonthlyTraffic(instance.id)'),
  'host traffic reset must delegate to the locked single-instance reset'
)
assert(
  !resetHostInstances.includes('return prisma.instance.updateMany({'),
  'host traffic reset must not directly bulk update instances without locks'
)

const activeApply = section(
  collectorSource,
  'async function applyTrafficCounters(',
  '/**\n * 在实例级锁内完成一次完整的流量采集与基线提交。'
)
assert(
  activeApply.includes('await withLock(getUserTrafficLockKey(userId)'),
  'active Incus traffic collection must acquire the user traffic lock before mutating user quota'
)
assert(
  activeApply.includes("monthlyTrafficUsed: { increment: totalDelta }"),
  'active Incus traffic collection still mutates monthly traffic usage'
)

const agentApply = section(
  agentReportSource,
  'async function applyReportedTrafficCounters(',
  'async function processOneAgentInstanceReport('
)
assert(
  agentApply.includes('await withLock(getUserTrafficLockKey(instance.userId)'),
  'Agent traffic report processing must acquire the user traffic lock before mutating user quota'
)
assert(
  agentApply.includes("monthlyTrafficUsed: { increment: totalDelta }"),
  'Agent traffic report processing still mutates monthly traffic usage'
)

console.log('traffic reset lock checks passed')
