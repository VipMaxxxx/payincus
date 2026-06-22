import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const locksSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const lotterySource = readFileSync(resolve(__dirname, '../src/db/lottery.ts'), 'utf8')
const badgesSource = readFileSync(resolve(__dirname, '../src/db/badges.ts'), 'utf8')
const vipSource = readFileSync(resolve(__dirname, '../src/services/vip-benefits.ts'), 'utf8')

assert.ok(
  locksSource.includes('export const USER_POINTS_LOCK_NAMESPACE = 4111'),
  'shared user points advisory-lock namespace must exist'
)

assert.ok(
  locksSource.includes('export const USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE = 4115'),
  'VIP benefit claims must have a dedicated user-level advisory-lock namespace'
)

assert.ok(
  lotterySource.includes('USER_POINTS_LOCK_NAMESPACE') &&
  lotterySource.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)'),
  'lottery draws must acquire the shared points lock before mutating user points'
)

assert.ok(
  lotterySource.includes('USER_BALANCE_LOCK_NAMESPACE') &&
  lotterySource.includes('await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') &&
  lotterySource.includes("throw new Error('BALANCE_CONFLICT: 余额正在处理，请稍后重试')") &&
  lotterySource.includes('data: { balance: { increment: balanceAmount } }'),
  'lottery balance prizes must acquire the shared balance lock and use increment updates'
)

assert.ok(
  badgesSource.includes("import { USER_POINTS_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'") &&
  badgesSource.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
  badgesSource.indexOf('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') <
    badgesSource.indexOf('await tx.userPoints.upsert({'),
  'badge draw/select point spending must acquire the shared points lock before userPoints writes'
)

assert.ok(
  vipSource.includes('USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE') &&
  vipSource.includes('await advisoryTransactionLock(tx, USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE, userId)'),
  'VIP benefit claims must serialize per user before computing claim counts'
)

assert.ok(
  vipSource.includes('USER_BALANCE_LOCK_NAMESPACE') &&
  vipSource.includes('await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') &&
  vipSource.includes("throw new VipBenefitError('BALANCE_CONFLICT'") &&
  vipSource.includes('data: { balance: { increment: amount } }'),
  'VIP balance rewards must acquire the shared balance lock and use increment updates'
)

assert.ok(
  vipSource.includes('USER_POINTS_LOCK_NAMESPACE') &&
  vipSource.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
  vipSource.indexOf("} else if (type === 'points')") <
    vipSource.indexOf('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
  vipSource.indexOf('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') <
    vipSource.indexOf('const userPoints = await tx.userPoints.upsert({'),
  'VIP points rewards must acquire the shared points lock before userPoints writes'
)

console.log('entertainment/VIP accounting lock checks passed')
