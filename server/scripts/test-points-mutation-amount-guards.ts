import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const pointsSource = readFileSync(resolve(__dirname, '../src/db/points.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = pointsSource.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = pointsSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return pointsSource.slice(start, end)
}

assert.ok(
  pointsSource.includes('const MAX_POINTS_MUTATION_AMOUNT = 1_000_000_000') &&
    pointsSource.includes('const MAX_POINTS_BALANCE = 2_147_483_647'),
  'points DB layer must define mutation and Int balance bounds'
)
assert.ok(
  pointsSource.includes('function isSafePointsAmount(value: number): boolean') &&
    pointsSource.includes('Number.isSafeInteger(value) && value > 0 && value <= MAX_POINTS_MUTATION_AMOUNT'),
  'points DB layer must define a positive safe-integer amount guard'
)
assert.ok(
  pointsSource.includes('function isSafePointsAdjustment(value: number): boolean') &&
    pointsSource.includes('value !== 0 && Math.abs(value) <= MAX_POINTS_MUTATION_AMOUNT'),
  'points DB layer must define a non-zero safe-integer adjustment guard'
)
assert.ok(
  pointsSource.includes('function assertSafePointsBalance(value: number): void') &&
    pointsSource.includes('function assertSafePointsCounter(value: number): void'),
  'points DB layer must guard both current points and aggregate counters'
)

const convertSection = sectionBetween(
  'export async function convertPointsFromConsumption(',
  '/**\n * 扣除用户积分'
)
assert.ok(
  convertSection.includes('if (!isSafePointsAmount(newPoints))') &&
    convertSection.includes('可兑换积分数量超出系统允许范围') &&
    convertSection.includes('assertSafePointsBalance(userPoints.points + newPoints)') &&
    convertSection.includes('assertSafePointsCounter(userPoints.totalEarned + newPoints)'),
  'consumption conversion must reject zero/invalid/oversized point grants before updating counters'
)

const deductSection = sectionBetween(
  'export async function deductPoints(',
  '/**\n * 增加用户积分'
)
assert.ok(
  deductSection.includes('if (!isSafePointsAmount(amount))') &&
    deductSection.includes("return { success: false, newPoints: 0, message: '积分扣除数量无效' }"),
  'deductPoints must reject negative, zero, fractional, unsafe, or oversized amounts before opening a transaction'
)
assert.ok(
  deductSection.includes('userPoints.totalSpent + amount > MAX_POINTS_BALANCE'),
  'deductPoints must reject totalSpent counter overflow before decrementing points'
)

const addSection = sectionBetween(
  'export async function addPoints(',
  '/**\n * 管理员调整用户积分'
)
assert.ok(
  addSection.includes('if (!isSafePointsAmount(amount))') &&
    addSection.includes("throw new Error('积分增加数量无效')"),
  'addPoints must reject negative, zero, fractional, unsafe, or oversized amounts before opening a transaction'
)
assert.ok(
  addSection.includes('assertSafePointsBalance(userPoints.points + amount)') &&
    addSection.includes('assertSafePointsCounter(userPoints.totalEarned + amount)') &&
    addSection.indexOf('assertSafePointsBalance(userPoints.points + amount)') <
      addSection.indexOf('const updatedPoints = await tx.userPoints.update({'),
  'addPoints must validate balance and totalEarned bounds before incrementing points'
)

const adminAdjustSection = sectionBetween(
  'export async function adminAdjustPoints(',
  '/**\n * 获取用户积分日志'
)
assert.ok(
  adminAdjustSection.includes('if (!isSafePointsAdjustment(amount))') &&
    adminAdjustSection.includes("return { success: false, newPoints: 0, message: '调整积分数量无效' }"),
  'adminAdjustPoints must reject zero, fractional, unsafe, or oversized adjustment amounts before opening a transaction'
)
assert.ok(
  adminAdjustSection.includes('amount > 0 && userPoints.points + amount > MAX_POINTS_BALANCE') &&
    adminAdjustSection.includes('amount > 0 && userPoints.totalEarned + amount > MAX_POINTS_BALANCE') &&
    adminAdjustSection.includes('amount < 0 && userPoints.totalSpent + Math.abs(amount) > MAX_POINTS_BALANCE'),
  'adminAdjustPoints must guard current-balance and aggregate-counter overflow'
)

console.log('points mutation amount guard tests passed')
