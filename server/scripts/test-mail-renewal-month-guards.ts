import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/mail.ts'), 'utf8')
const expirySchedulerSource = readFileSync(resolve(__dirname, '../src/services/mail-expiry-scheduler.ts'), 'utf8')
const autoRenewSchedulerSource = readFileSync(resolve(__dirname, '../src/services/mail-autorenew-scheduler.ts'), 'utf8')

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
  routeSource.includes('if (months < 1)'),
  'mail renewal months must be a positive integer before plan-cycle validation'
)
assert.ok(
  routeSource.includes("function validateMailRenewMonthsForBillingCycle(months: number, billingCycle: 'monthly' | 'yearly'): void") &&
    routeSource.includes("const billingCycleMonths = billingCycle === 'yearly' ? 12 : 1") &&
    routeSource.includes('months % billingCycleMonths !== 0'),
  'mail renewal months must be divisible by the plan billing cycle'
)
assert.ok(
  routeSource.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '年付套餐只能按年续费')"),
  'mail renewal must reject non-year multiples for yearly plans with a clear validation error'
)
assert.ok(
  routeSource.includes("billingCycle === 'monthly' && months > 12"),
  'monthly mail renewal must retain the existing 1-12 month limit'
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
  routeRenewSection.includes('validateMailRenewMonthsForBillingCycle(renewMonths, plan.billingCycle)') &&
    routeRenewSection.includes('validateMailRenewMonthsForBillingCycle(renewMonths, currentSubscription.plan.billingCycle)'),
  'mail renewal route must enforce plan-cycle multiples before quoting and again before transactional settlement'
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
  dbSource.includes("where: { userId, ...sourceFilter, status: 'expired' }") &&
    routeRenewSection.includes("currentSubscription.status === 'expired'") &&
    routeRenewSection.includes('const periodStart = currentSubscription.expiresAt > now ? currentSubscription.expiresAt : now') &&
    routeRenewSection.includes("data: { expiresAt: newExpiry, status: 'active' }") &&
    routeRenewSection.includes('await resumeMailSubscriptionDomains(updated.id, userId)'),
  'expired mail subscriptions must remain visible for renewal, restart from max(old expiry, now), become active, and resume upstream domains'
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
assert.ok(
  expirySchedulerSource.includes("status: 'expired'") &&
    expirySchedulerSource.includes('await craneMailService.suspendDomain(source, domain.domain)') &&
    expirySchedulerSource.includes('mail_upstream_suspend_pending_retry') &&
    expirySchedulerSource.includes('await craneMailService.resumeDomain(source, domain.domain)') &&
    expirySchedulerSource.includes("domains: { some: { status: 'suspended' } }") &&
    expirySchedulerSource.includes("data: { status: domain.verifiedAt ? 'verified' : 'pending' }"),
  'mail expiry must suspend every upstream domain, persist retry alerts, and compensate a concurrent renewal'
)
assert.ok(
  autoRenewSchedulerSource.includes('const MAIL_AUTORENEW_MONTHS = 1') &&
    autoRenewSchedulerSource.includes('renewMailSubscription(') &&
    autoRenewSchedulerSource.includes('MAIL_AUTORENEW_MONTHS,') &&
    autoRenewSchedulerSource.includes("subscription.plan.billingCycle === 'monthly'") &&
    autoRenewSchedulerSource.includes('Number(subscription.plan.price) / 12'),
  'mail auto-renew must reuse the renewal helper and always renew exactly one month, including monthly pricing for yearly plans'
)
assert.ok(
    autoRenewSchedulerSource.includes('balance: { gte: finalPrice }') &&
    autoRenewSchedulerSource.includes('if (deducted.count === 0)') &&
    autoRenewSchedulerSource.includes("status: 'insufficient_balance'") &&
    autoRenewSchedulerSource.includes("eventType: 'mail_auto_renew_insufficient_balance'") &&
    autoRenewSchedulerSource.includes('请充值后手动续费'),
  'mail auto-renew must conditionally debit without overdraft and remind users to renew manually when balance is insufficient'
)
assert.ok(
  autoRenewSchedulerSource.includes('buildPeriodKey(subscriptionId: number, expiresAt: Date)') &&
    autoRenewSchedulerSource.includes('remark: { contains: periodMarker }') &&
    autoRenewSchedulerSource.includes("data: { path: ['periodKey'], equals: periodKey }") &&
    autoRenewSchedulerSource.includes('tryAdvisoryTransactionLock('),
  'mail auto-renew must guard the same subscription period against duplicate charges and duplicate reminders'
)

console.log('mail renewal month guard tests passed')
