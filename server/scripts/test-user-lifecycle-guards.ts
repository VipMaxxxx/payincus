import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260624162000_add_user_lifecycle_operations/migration.sql'), 'utf8')
const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/user-lifecycle.ts'), 'utf8')
const dbSource = readFileSync(resolve(process.cwd(), 'src/db/user-lifecycle.ts'), 'utf8')
const redeemSource = readFileSync(resolve(process.cwd(), 'src/db/redeem-codes.ts'), 'utf8')
const checkinSource = readFileSync(resolve(process.cwd(), 'src/routes/checkin.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const userApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const adminRouterSource = readFileSync(resolve(process.cwd(), '../client/src/router/admin.ts'), 'utf8')
const adminNavSource = readFileSync(resolve(process.cwd(), '../client/src/config/side-nav-items-admin.ts'), 'utf8')

assert.ok(
  schemaSource.includes('enum UserLifecycleTagKey') &&
    schemaSource.includes('model UserLifecycleTag') &&
    schemaSource.includes('model UserLifecycleSegmentRule') &&
    schemaSource.includes('model UserLifecycleSegmentMember') &&
    schemaSource.includes('model UserLifecycleEvent') &&
    schemaSource.includes('model UserLifecycleAction') &&
    schemaSource.includes('targetUserId Int?           @map("target_user_id")') &&
    migrationSource.includes('CREATE TYPE "UserLifecycleTagKey"') &&
    migrationSource.includes('CREATE TABLE "user_lifecycle_tags"') &&
    migrationSource.includes('CREATE TABLE "user_lifecycle_segment_rules"') &&
    migrationSource.includes('CREATE TABLE "user_lifecycle_actions"') &&
    migrationSource.includes('ALTER TABLE "redeem_codes"') &&
    migrationSource.includes('"target_user_id"'),
  'User lifecycle persistence must include tags, segments, events, actions and targeted redeem-code restriction'
)

assert.ok(
  appSource.includes("import userLifecycleRoutes from './routes/user-lifecycle.js'") &&
    appSource.includes('fastify.register(userLifecycleRoutes)'),
  'User lifecycle routes must be registered'
)

assert.ok(
  routeSource.includes("'/api/admin/user-lifecycle/overview'") &&
    routeSource.includes("'/api/admin/user-lifecycle/users'") &&
    routeSource.includes("'/api/admin/user-lifecycle/users/:userId/tags'") &&
    routeSource.includes("'/api/admin/user-lifecycle/users/:userId/redeem-codes'") &&
    routeSource.includes("'/api/admin/user-lifecycle/reminders'") &&
    routeSource.includes("'/api/user-lifecycle/my-offers'") &&
    routeSource.match(/fastify\.authenticateAdmin/g)?.length &&
    routeSource.includes('fastify.authenticateUser'),
  'Lifecycle APIs must expose admin operations and a user-only offer endpoint with the right guards'
)

assert.ok(
  routeSource.includes('confirm') &&
    routeSource.includes('userIds.length > 100') &&
    routeSource.includes('normalizeText') &&
    dbSource.includes('recordLifecycleAction') &&
    dbSource.includes('createInboxMessage') &&
    dbSource.includes('sendLifecycleReminder') &&
    dbSource.includes('issueLifecycleRedeemCode'),
  'Bulk lifecycle actions must require confirmation, audit records and inbox delivery'
)

assert.ok(
  redeemSource.includes('targetUserId?: number | null') &&
    redeemSource.includes('targetUserId: data.targetUserId ?? null') &&
    redeemSource.includes('AND ("target_user_id" IS NULL OR "target_user_id" = ${data.userId})') &&
    checkinSource.includes('REDEEM_CODE_TARGET_USER_MISMATCH') &&
    checkinSource.includes('systemCodeRecord.targetUserId !== null && systemCodeRecord.targetUserId !== user.id') &&
    userApiSource.includes('/user-lifecycle/my-offers') &&
    !userApiSource.includes('/admin/user-lifecycle'),
  'Targeted redeem codes must be enforced during redemption and user client must not expose admin lifecycle APIs'
)

assert.ok(
  dbSource.includes('maskEmail') &&
    dbSource.includes('emailMasked') &&
    !dbSource.includes('callbackData') &&
    !dbSource.includes('providerConfigSnapshot') &&
    !dbSource.includes('rootPassword') &&
    !dbSource.includes('twoFactorSecret') &&
    !dbSource.includes('twoFactorRecoveryCodes') &&
    !dbSource.includes('ip: true') &&
    !dbSource.includes('userAgent: true'),
  'Lifecycle summaries must be privacy-safe and avoid raw payment, auth, IP, device and root-password fields'
)

assert.ok(
  adminApiSource.includes('userLifecycle: {') &&
    adminApiSource.includes("http.get('/admin/user-lifecycle/overview')") &&
    adminApiSource.includes("http.post('/admin/user-lifecycle/segments/refresh')") &&
    adminApiSource.includes("http.post(`/admin/user-lifecycle/users/${userId}/redeem-codes`") &&
    adminRouterSource.includes("path: '/admin/user-lifecycle'") &&
    adminNavSource.includes("path: '/admin/user-lifecycle'") &&
    adminNavSource.includes("label: 'nav.userLifecycle'"),
  'Admin client, router and navigation must expose lifecycle center only in the admin entry'
)

console.log('User lifecycle guard tests passed')
