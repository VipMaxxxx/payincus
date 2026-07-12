import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const usersRoute = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const usersDb = readFileSync(resolve(__dirname, '../src/db/users.ts'), 'utf8')
const errorsSource = readFileSync(resolve(__dirname, '../src/lib/errors.ts'), 'utf8')
const zhCN = readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8')
const zhTW = readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
const en = readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8')

const deleteRouteStart = usersRoute.indexOf("// 删除用户 (管理员)")
const deleteRouteEnd = usersRoute.indexOf("// 管理员获取指定用户的所有会话", deleteRouteStart)

assert.ok(deleteRouteStart >= 0 && deleteRouteEnd > deleteRouteStart, 'admin user delete route section must exist')

const deleteRouteSource = usersRoute.slice(deleteRouteStart, deleteRouteEnd)

assert.ok(
  usersRoute.includes('async function getUserDeletionBlockers(userId: number): Promise<UserDeletionBlockers>') &&
    usersRoute.includes('select: { balance: true, hostingBalance: true }') &&
    usersRoute.includes('prisma.instance.count({ where: { userId } })') &&
    usersRoute.includes('prisma.host.count({ where: { userId } })') &&
    usersRoute.includes('prisma.package.count({ where: { userId } })') &&
    usersRoute.includes('prisma.hostingZone.count({ where: { ownerId: userId } })') &&
    usersRoute.includes('prisma.balanceLog.count({ where: { userId } })') &&
    usersRoute.includes('prisma.rechargeRecord.count({ where: { userId } })') &&
    usersRoute.includes('prisma.hostingBalanceLog.count({ where: { userId } })') &&
    usersRoute.includes('prisma.loginRecord.count({ where: { userId } })') &&
    usersRoute.includes('prisma.redeemCodeUsage.count({ where: { userId } })'),
  'admin user deletion must check balances, financial/audit history, and resource blockers before hard deleting a user'
)

assert.ok(
  deleteRouteSource.includes("'用户主余额或托管余额非零，请先清零或结算'") &&
    deleteRouteSource.includes("'该用户有资金/审计流水，不能直接删除'"),
  'admin user deletion must return clear balance and financial/audit blocker reasons'
)

assert.ok(
  deleteRouteSource.includes('const blockers = await getUserDeletionBlockers(userId)') &&
    deleteRouteSource.includes('if (hasUserDeletionBlockers(blockers))') &&
    deleteRouteSource.includes('ErrorCode.USER_HAS_RESOURCES') &&
    deleteRouteSource.indexOf('const blockers = await getUserDeletionBlockers(userId)') <
      deleteRouteSource.indexOf('await db.deleteUser(userId)'),
  'admin user deletion must reject users with resource blockers before db.deleteUser'
)

assert.ok(
  !deleteRouteSource.includes('db.getInstancesByUserId(userId)'),
  'admin user deletion must not rely on active-instance-only checks'
)

assert.ok(
  usersDb.includes('export class UserDeletionConflictError extends Error') &&
    usersDb.includes("prismaErrorCode === 'P2003' || prismaErrorCode === 'P2014'") &&
    usersDb.includes('throw new UserDeletionConflictError()') &&
    deleteRouteSource.includes('error instanceof db.UserDeletionConflictError') &&
    deleteRouteSource.includes('return reply.code(409).send(apiError(') &&
    deleteRouteSource.includes("'该用户存在关联记录，无法删除'"),
  'db.deleteUser must translate foreign-key failures into a business conflict returned as 4xx'
)

for (const [name, source] of [
  ['errors', errorsSource],
  ['zh-CN', zhCN],
  ['zh-TW', zhTW],
  ['en', en]
] as const) {
  assert.ok(source.includes('USER_HAS_RESOURCES'), `${name} must define USER_HAS_RESOURCES`)
}

console.log('admin user delete resource guard checks passed')
