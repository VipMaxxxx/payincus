import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')

assert.ok(
  source.includes('function normalizeMailPlanInput'),
  'mail plan create/update routes must share normalized backend validation'
)
assert.ok(
  source.includes('function requireNumber(value: unknown, field: string): number') &&
    source.includes('function requireSafeInteger(value: unknown, field: string): number'),
  'mail plan validation must require runtime JSON numbers instead of loose coercion'
)
assert.ok(
  source.includes("const sourceId = requireSafeInteger(input.sourceId, '邮箱源')") &&
    source.includes("const domainLimit = requireSafeInteger(input.domainLimit, '域名数量限制')") &&
    source.includes("const diskLimitGb = requireSafeInteger(input.diskLimitGb, '磁盘容量')") &&
    source.includes("const price = requireNumber(input.price, '价格')") &&
    source.includes("const sortOrder = requireSafeInteger(input.sortOrder, '排序值')"),
  'mail plan financial and quota fields must use strict runtime number helpers'
)
for (const looseCoercion of [
  'const sourceId = Number(input.sourceId)',
  'const domainLimit = Number(input.domainLimit)',
  'const diskLimitGb = Number(input.diskLimitGb)',
  'const price = Number(input.price)',
  'const sortOrder = Number(input.sortOrder)'
]) {
  assert.ok(
    !source.includes(looseCoercion),
    `mail plan validation must not use loose numeric coercion: ${looseCoercion}`
  )
}
assert.ok(
  source.includes('price <= 0') && source.includes('price > 99999999.99'),
  'mail plan prices must reject negative, zero, and unbounded values'
)
assert.ok(
  source.includes('Math.abs(price - roundedPrice) > 1e-8'),
  'mail plan prices must reject more than two decimal places'
)
assert.ok(
  source.includes('domainLimit <= 0') && source.includes('domainLimit > 1000'),
  'mail plan domain limits must be bounded positive integers'
)
assert.ok(
  source.includes('diskLimitGb <= 0') && source.includes('diskLimitGb > 102400'),
  'mail plan disk limits must be bounded positive integers'
)
assert.ok(
  source.includes("input.billingCycle !== 'monthly' && input.billingCycle !== 'yearly'"),
  'mail plan billing cycle must reject unexpected enum values before Prisma writes'
)

const createSectionStart = source.indexOf('// 创建方案')
const updateSectionStart = source.indexOf('// 更新方案')
const deleteSectionStart = source.indexOf('// 删除方案')
const purchaseSectionStart = source.indexOf('// 购买订阅')
const renewSectionStart = source.indexOf('// 续费订阅')
assert.notEqual(createSectionStart, -1, 'mail plan create section not found')
assert.notEqual(updateSectionStart, -1, 'mail plan update section not found')
assert.notEqual(deleteSectionStart, -1, 'mail plan delete section not found')
assert.notEqual(purchaseSectionStart, -1, 'mail subscription purchase section not found')
assert.notEqual(renewSectionStart, -1, 'mail subscription renew section not found')

const createSection = source.slice(createSectionStart, updateSectionStart)
const updateSection = source.slice(updateSectionStart, deleteSectionStart)
const purchaseSection = source.slice(purchaseSectionStart, renewSectionStart)

assert.ok(
  createSection.includes('const planInput = normalizeMailPlanInput(request.body, true)'),
  'mail plan create route must normalize and require all financial/quota fields'
)
assert.ok(
  createSection.includes('price: planInput.price!'),
  'mail plan create route must persist normalized price'
)
assert.ok(
  updateSection.includes('const data = normalizeMailPlanInput(request.body, false)'),
  'mail plan update route must validate partial direct API updates'
)
assert.ok(
  updateSection.includes('if (data.sourceId !== undefined)'),
  'mail plan update route must verify a changed source exists before persistence'
)
assert.ok(
  source.includes('type MailSubscriptionPurchaseInput = {') &&
    source.includes('const MAIL_AFF_CODE_MAX_LENGTH = 64') &&
    source.includes('function normalizeMailSubscriptionPurchaseInput(input: unknown): MailSubscriptionPurchaseInput'),
  'mail subscription purchase must define a runtime body normalizer'
)
assert.ok(
  source.includes("const planId = requireSafeInteger(input.planId, '邮箱方案')") &&
    source.includes('if (planId <= 0)') &&
    source.includes("typeof input.affCode !== 'string'") &&
    source.includes('input.affCode.trim().toUpperCase()') &&
    source.includes('normalizedAffCode.length > MAIL_AFF_CODE_MAX_LENGTH'),
  'mail subscription purchase must validate planId and optional AFF code before billing'
)
assert.ok(
  purchaseSection.includes('purchaseInput = normalizeMailSubscriptionPurchaseInput(request.body)') &&
    purchaseSection.includes('const { planId, affCode: affCodeInput } = purchaseInput') &&
    purchaseSection.includes('const validation = await validateMailAffCode(affCodeInput, userId)'),
  'mail subscription purchase route must use normalized purchase input for plan lookup and AFF validation'
)
assert.ok(
  !purchaseSection.includes('const { planId, affCode: affCodeInput } = request.body') &&
    !purchaseSection.includes('validateMailAffCode(affCodeInput.trim(), userId)'),
  'mail subscription purchase route must not destructure raw typed bodies or trim AFF codes inline'
)

console.log('mail plan financial guard tests passed')
