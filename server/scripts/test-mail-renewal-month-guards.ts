import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/mail.ts'), 'utf8')
const expirySchedulerSource = readFileSync(resolve(__dirname, '../src/services/mail-expiry-scheduler.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const routeRenewSection = sectionBetween(
  routeSource,
  '// 续费订阅',
  '// ==================== 用户端：域名管理 ===================='
)
const dbRenewSection = sectionBetween(
  dbSource,
  'export async function renewMailSubscription',
  '// ==================== 域名 (MailDomain) ===================='
)
const expiryUpdateSection = sectionBetween(
  expirySchedulerSource,
  'const result = await prisma.mailSubscription.updateMany({',
  'console.log(`[Mail] Updated ${result.count} mail subscriptions to expired status`)'
)

assert.ok(
  routeSource.includes('function normalizeMailRenewMonths(value: unknown): number'),
  'mail renewal route must normalize runtime months input'
)
assert.ok(
  routeSource.includes('function normalizeMailSubscriptionRenewInput(input: unknown): number') &&
    routeSource.includes('return normalizeMailRenewMonths(input.months)'),
  'mail renewal route must validate runtime body shape before reading months'
)
assert.ok(
  routeSource.includes("const months = requireSafeInteger(value, '续费月数')"),
  'mail renewal months must require a runtime JSON integer'
)
assert.ok(
  !routeSource.includes('const months = Number(value)'),
  'mail renewal months must not use loose numeric coercion'
)
assert.ok(
  routeSource.includes('if (months < 1 || months > 12)'),
  'mail renewal months must be an integer between 1 and 12'
)
assert.ok(
  routeRenewSection.includes('Body: { months: unknown }'),
  'mail renewal request body must not trust compile-time number typing at runtime'
)
assert.ok(
  routeRenewSection.includes('renewMonths = normalizeMailSubscriptionRenewInput(request.body)'),
  'mail renewal route must normalize the request body before billing'
)
assert.ok(
  routeRenewSection.includes('monthlyPrice * renewMonths'),
  'mail renewal price must use normalized renewal months'
)
assert.ok(
  routeRenewSection.includes('newExpiry.getMonth() + renewMonths'),
  'mail renewal expiry update must use normalized renewal months'
)
assert.ok(
  routeRenewSection.includes('Renewed mail subscription for ${renewMonths} months'),
  'mail renewal audit log must use normalized renewal months'
)
assert.ok(
  !routeRenewSection.includes('monthlyPrice * months'),
  'mail renewal price must not use raw request months'
)
assert.ok(
  !routeRenewSection.includes('newExpiry.getMonth() + months'),
  'mail renewal expiry update must not use raw request months'
)
assert.ok(
  !routeRenewSection.includes('const { months } = request.body'),
  'mail renewal route must not destructure raw typed request bodies'
)
assert.ok(
  dbRenewSection.includes('!Number.isSafeInteger(months) || months < 1 || months > 12'),
  'mail renewal database helper must also reject invalid month values'
)
assert.ok(
  expiryUpdateSection.includes("status: 'active'") &&
    expiryUpdateSection.includes('expiresAt: { lt: now }') &&
    expiryUpdateSection.indexOf("status: 'active'") < expiryUpdateSection.indexOf('expiresAt: { lt: now }'),
  'mail expiry scheduler must re-check expiresAt in the conditional update so renewed rows are not marked expired'
)
assert.ok(
  expirySchedulerSource.includes('expired mail subscription candidate(s)') &&
    !expirySchedulerSource.includes('for (const sub of expiredSubscriptions)') &&
    !expirySchedulerSource.includes('Subscription expired: userId='),
  'mail expiry scheduler logs must not report every stale candidate as actually expired'
)

console.log('mail renewal month guard tests passed')
