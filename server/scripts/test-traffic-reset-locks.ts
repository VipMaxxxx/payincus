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
const trafficDbSource = readFileSync(resolve(repoRoot, 'server/src/db/traffic.ts'), 'utf8')
const trafficSchedulerSource = readFileSync(resolve(repoRoot, 'server/src/services/traffic-scheduler.ts'), 'utf8')
const trafficRoutesSource = readFileSync(resolve(repoRoot, 'server/src/routes/traffic.ts'), 'utf8')
const packageRoutesSource = readFileSync(resolve(repoRoot, 'server/src/routes/packages.ts'), 'utf8')
const prismaSchemaSource = readFileSync(resolve(repoRoot, 'server/prisma/schema.prisma'), 'utf8')
const yuanMigrationSource = readFileSync(
  resolve(repoRoot, 'server/prisma/migrations/20260712000000_traffic_reset_price_to_yuan/migration.sql'),
  'utf8'
)
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

assert(
  trafficDbSource.includes("export const TRAFFIC_TIME_ZONE = 'Asia/Shanghai'") &&
    trafficDbSource.includes('const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000') &&
    trafficDbSource.includes('shifted.getUTCFullYear()') &&
    trafficDbSource.includes('shifted.getUTCMonth()') &&
    trafficDbSource.includes('shifted.getUTCDate()'),
  'traffic day/month boundaries must use the fixed Asia/Shanghai UTC+8 helper'
)
assert(
  trafficDbSource.includes('const normalizedDate = shanghaiDateOnly(date)') &&
    trafficDbSource.includes('date: shanghaiDateOnly(u.date)') &&
    trafficDbSource.includes('const currentMonthStart = startOfMonthShanghai(sentAt)'),
  'daily traffic date-only values and monthly warning boundary must use Shanghai helpers'
)
assert(
  !/\.get(?:FullYear|Month|Date)\(\)/.test(trafficDbSource) &&
    !/\.get(?:FullYear|Month|Date)\(\)/.test(trafficSchedulerSource),
  'traffic DB and scheduler business boundaries must not use server-local date parts'
)
assert(
  trafficSchedulerSource.includes('const today = trafficDb.shanghaiDateParts().day') &&
    trafficSchedulerSource.match(/timezone: trafficDb\.TRAFFIC_TIME_ZONE/g)?.length === 1 &&
    !trafficSchedulerSource.includes('isWarningSentThisMonth'),
  'traffic reset cron, resetDay, and warning month checks must use the Shanghai boundary'
)

assert(
  !trafficDbSource.includes('export async function resetAllUserMonthlyTraffic()') &&
    !trafficSchedulerSource.includes("schedule('5 0 1 * *'") &&
    !trafficSchedulerSource.includes('runMonthlyUserTrafficResetJob'),
  'user monthly traffic usage must not be cleared globally on the first day of each month'
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
  resetOneInstance.includes('await withLock(getTrafficInstanceLockKey(instanceId)') &&
    resetOneInstance.includes('await withLock(getTrafficUserLockKey(sample.userId)') &&
    resetOneInstance.includes('prisma.$transaction(async tx =>'),
  'single-instance traffic reset must hold the instance and user locks around one transaction'
)
assert(
  resetOneInstance.includes('userQuota.monthlyTrafficUsed - currentInstance.monthlyTrafficUsed') &&
    resetOneInstance.includes('monthlyTrafficUsed > currentInstance.monthlyTrafficUsed') &&
    resetOneInstance.includes('monthlyTrafficUsed,') &&
    resetOneInstance.includes('extraTrafficQuota: 0n') &&
    resetOneInstance.includes('extraTrafficUsed: 0n') &&
    resetOneInstance.includes('getEffectiveLimit(userQuota.monthlyTrafficLimit, 0n)'),
  'node resetDay must subtract only the resetting instance contribution and expire current-period extra traffic'
)

const userResetRoute = section(
  trafficRoutesSource,
  "fastify.post<{\n        Params: { instanceId: string }\n    }>('/instances/:instanceId/traffic/reset'",
  '    // ==================== 管理员操作'
)
assert(
  userResetRoute.includes('const priceYuan = resolveTrafficResetPriceYuan(currentInstance)') &&
    !userResetRoute.includes('priceCents') &&
    !userResetRoute.includes('priceYuan = normalizeMoney(priceCents / 100)'),
  'user self-service traffic reset must resolve and deduct the package/plan price directly in yuan'
)
assert(
  trafficRoutesSource.includes('function resolveTrafficResetPriceYuan(instance:') &&
    trafficRoutesSource.includes('return normalizeMoney(Math.max(0, Number(planPrice) || 0))') &&
    !trafficRoutesSource.includes('resolveTrafficResetPriceCents'),
  'traffic reset price resolution must preserve decimal yuan instead of rounding integer cents'
)
assert(
  packageRoutesSource.includes('const MAX_TRAFFIC_RESET_PRICE_YUAN = 999999.99') &&
    packageRoutesSource.includes("optionalMoneyYuan(input, 'trafficResetPrice'") &&
    !packageRoutesSource.includes('MAX_TRAFFIC_RESET_PRICE_CENTS') &&
    !packageRoutesSource.includes('optionalMoneyCents'),
  'package traffic reset price API must validate decimal yuan'
)
assert(
  prismaSchemaSource.includes('用户自助重置月流量价格（元）') &&
    prismaSchemaSource.includes('用户自助重置月流量价格覆盖（元），null=继承套餐') &&
    yuanMigrationSource.includes('UPDATE "packages"') &&
    yuanMigrationSource.includes('UPDATE "package_plans"') &&
    yuanMigrationSource.match(/"traffic_reset_price" = "traffic_reset_price" \/ 100/g)?.length === 2,
  'schema and data migration must convert both package traffic reset price columns from cents to yuan'
)
assert(
  userResetRoute.includes('USER_BALANCE_LOCK_NAMESPACE'),
  'paid user self-service traffic reset must acquire the user balance lock'
)
assert(
  userResetRoute.includes("type: 'consume'"),
  'paid user self-service traffic reset must write a consume balance log'
)
assert(
  userResetRoute.includes('monthlyTrafficUsed: 0n'),
  'user self-service traffic reset must clear instance monthly traffic'
)
assert(
  userResetRoute.includes('monthlyTrafficUsed: true') &&
    userResetRoute.includes('userQuota.monthlyTrafficUsed - currentInstance.monthlyTrafficUsed') &&
    userResetRoute.includes('monthlyTrafficUsed > currentInstance.monthlyTrafficUsed'),
  'paid user self-service traffic reset must subtract only this instance contribution from user monthly traffic'
)
assert(
  userResetRoute.includes('await tx.userQuota.update({') &&
    userResetRoute.includes('monthlyTrafficUsed,') &&
    userResetRoute.includes('extraTrafficQuota: 0n') &&
    userResetRoute.includes('extraTrafficUsed: 0n') &&
    userResetRoute.includes('getEffectiveLimit(userQuota.monthlyTrafficLimit, 0n)'),
  'paid user self-service traffic reset must expire current-period extra traffic in the same transaction'
)

const paidResetLock = section(
  trafficDbSource,
  'export async function withInstanceTrafficResetLock<T>(',
  '/**\n * 验证并清理 SQL 值'
)
assert(
  paidResetLock.includes('await withLock(getTrafficUserLockKey(sample.userId)') &&
    paidResetLock.includes('prisma.$transaction(tx => operation(tx, sample))'),
  'paid reset must hold the instance and user traffic locks around the reset transaction'
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
