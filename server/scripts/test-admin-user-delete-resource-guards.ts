import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const usersRoute = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
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
    usersRoute.includes('prisma.instance.count({ where: { userId } })') &&
    usersRoute.includes('prisma.host.count({ where: { userId } })') &&
    usersRoute.includes('prisma.package.count({ where: { userId } })') &&
    usersRoute.includes('prisma.hostingZone.count({ where: { ownerId: userId } })'),
  'admin user deletion must count all resource blockers before hard deleting a user'
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

for (const [name, source] of [
  ['errors', errorsSource],
  ['zh-CN', zhCN],
  ['zh-TW', zhTW],
  ['en', en]
] as const) {
  assert.ok(source.includes('USER_HAS_RESOURCES'), `${name} must define USER_HAS_RESOURCES`)
}

console.log('admin user delete resource guard checks passed')
