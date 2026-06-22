import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/friends.ts'), 'utf8')
const dbSource = readFileSync(resolve(process.cwd(), 'src/db/friendships.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'friend routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const requestId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  3,
  'friend request cancel/accept/reject routes must strictly validate request IDs'
)

assert.equal(
  routeSource.match(/const friendshipId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'friend delete/resources routes must strictly validate friendship IDs'
)

assert.ok(
  routeSource.includes("const friendHistoryFilters = new Set<FriendHistoryFilter>(['accepted', 'rejected', 'removed', 'all'])") &&
    routeSource.includes('function parseFriendHistoryFilter(value: string | undefined): FriendHistoryFilter | undefined | null') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid history filter'))"),
  'friend history route must reject unsupported status filters before DB access'
)

for (const forbiddenPattern of [
  'Number(request.params.id)',
  'isNaN(requestId)',
  'isNaN(friendshipId)',
  'const { filter } = request.query'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `friend routes must not keep loose parsing or unvalidated filters: ${forbiddenPattern}`
  )
}

assert.ok(
  dbSource.includes('if (request.userId !== userId)') &&
    dbSource.includes('if (request.friendId !== userId)') &&
    dbSource.includes('if (friendship.userId !== userId && friendship.friendId !== userId)'),
  'friendship DB helpers must keep ownership checks for cancel, accept/reject, and remove operations'
)

console.log('friend route guard tests passed')
