import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const invitePricingSource = readFileSync(resolve(__dirname, '../src/lib/invite-pricing.ts'), 'utf8')
const userInvitesRouteSource = readFileSync(resolve(__dirname, '../src/routes/user-invites.ts'), 'utf8')
const systemConfigRouteSource = readFileSync(resolve(__dirname, '../src/routes/system-config.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const balanceHandler = sectionBetween(
  invitePricingSource,
  "balance: {",
  "points: {"
)

const pointsHandler = sectionBetween(
  invitePricingSource,
  "points: {",
  'export function isSupportedInviteCostResource'
)

assert.ok(
  invitePricingSource.includes('USER_BALANCE_LOCK_NAMESPACE') &&
    invitePricingSource.includes('USER_POINTS_LOCK_NAMESPACE') &&
    invitePricingSource.includes('advisoryTransactionLock'),
  'invite generation accounting must import the shared user balance and points lock helpers'
)

assert.ok(
  balanceHandler.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') &&
    balanceHandler.indexOf('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') <
      balanceHandler.indexOf('UPDATE users'),
  'balance-paid invite generation must acquire the shared user balance lock before deducting balance'
)

assert.ok(
  balanceHandler.includes('WHERE id = ${userId} AND balance >= ${amount}') &&
    balanceHandler.includes('RETURNING (balance + ${amount})::numeric AS "balanceBefore", balance::numeric AS "balanceAfter"') &&
    balanceHandler.includes("type: 'invite_generate'"),
  'balance-paid invite generation must keep conditional deduction and persisted balance-log snapshots'
)

assert.ok(
  pointsHandler.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
    pointsHandler.indexOf('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') <
      pointsHandler.indexOf('await tx.userPoints.upsert({'),
  'points-paid invite generation must acquire the shared user points lock before touching user_points'
)

assert.ok(
  pointsHandler.includes('WHERE user_id = ${userId} AND points >= ${amount}') &&
    pointsHandler.includes('RETURNING points + ${amount} AS "pointsBefore", points AS "pointsAfter"') &&
    pointsHandler.includes("type: 'invite_generate'"),
  'points-paid invite generation must keep conditional deduction and persisted points-log snapshots'
)

assert.ok(
  userInvitesRouteSource.includes('config: { rateLimit: { max: 20, timeWindow: \'1 minute\' } }') &&
    userInvitesRouteSource.includes("maximum: 10"),
  'user invite generation must keep per-request and rate-limit bounds'
)

assert.ok(
  userInvitesRouteSource.includes('const INVITE_GENERATION_MAX_COUNT = 10') &&
    userInvitesRouteSource.includes('const INVITE_COST_RESOURCE_MAX_LENGTH = 64') &&
    userInvitesRouteSource.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    userInvitesRouteSource.includes('function normalizeGenerateInviteBody(input: unknown): GenerateInviteBody'),
  'user invite generation must define a runtime body normalizer'
)

assert.ok(
    userInvitesRouteSource.includes("typeof input.costResource !== 'string'") &&
    userInvitesRouteSource.includes('input.costResource.trim()') &&
    userInvitesRouteSource.includes('costResource.length > INVITE_COST_RESOURCE_MAX_LENGTH') &&
    userInvitesRouteSource.includes("typeof countInput !== 'number' || !Number.isSafeInteger(countInput) || countInput < 1 || countInput > INVITE_GENERATION_MAX_COUNT"),
  'user invite generation body normalizer must validate cost resource and count before accounting work'
)

assert.ok(
  userInvitesRouteSource.includes('input = normalizeGenerateInviteBody(request.body)') &&
    userInvitesRouteSource.includes('const { count = 1, costResource } = input'),
  'user invite generation route must use normalized body values before charging resources'
)

assert.ok(
  !userInvitesRouteSource.includes('const count = request.body.count ?? 1') &&
    !userInvitesRouteSource.includes('const costResource = request.body.costResource'),
  'user invite generation route must not read raw typed body fields before runtime validation'
)

assert.ok(
  systemConfigRouteSource.includes("config.key === 'invite_generation_costs'") &&
    systemConfigRouteSource.includes("typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0") &&
    systemConfigRouteSource.includes("resource === 'balance' && amount > maxRegisterGiftBalance") &&
    systemConfigRouteSource.includes("resource === 'points' && (!Number.isSafeInteger(amount) || amount > maxRegisterGiftPoints)"),
  'invite generation cost config must reject invalid, non-finite, negative, and excessive prices'
)

console.log('invite generation accounting guard tests passed')
