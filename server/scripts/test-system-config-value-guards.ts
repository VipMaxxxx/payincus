import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/system-config.ts'), 'utf8')

assert.ok(
  routeSource.includes('const positiveIntegerConfigPattern = /^[1-9]\\d*$/') &&
    routeSource.includes('const nonNegativeIntegerConfigPattern = /^(?:0|[1-9]\\d*)$/') &&
    routeSource.includes('function parsePositiveConfigInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | null') &&
    routeSource.includes('function parseNonNegativeConfigInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | null') &&
    routeSource.includes('function parseDecimalMoneyConfig(value: string, max: number): number | null'),
  'system config route must define strict string-to-number config parsers'
)

assert.ok(
  routeSource.includes('const packageId = parsePositiveConfigInteger(popupPromoPackageId, 2147483647)') &&
    routeSource.includes('const packageId = parsePositiveConfigInteger(config.value, 2147483647)') &&
    routeSource.includes('config.value = packageId.toString()'),
  'popup promo package config must reject non-decimal, unsafe, and missing package IDs before lookup/persistence'
)

assert.ok(
  routeSource.includes("if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)") &&
    routeSource.includes("resource === 'balance' && amount > maxRegisterGiftBalance") &&
    routeSource.includes("resource === 'points' && (!Number.isSafeInteger(amount) || amount > maxRegisterGiftPoints)") &&
    routeSource.includes('config.value = serializeInviteCostOptions(options)'),
  'invite generation cost config must require JSON numbers and bounded balance/points amounts'
)

assert.ok(
  routeSource.includes('const num = parseDecimalMoneyConfig(config.value, maxRegisterGiftBalance)') &&
    routeSource.includes("config.key === 'smtp_port'") &&
    routeSource.includes('? 65535') &&
    routeSource.includes('const num = parseNonNegativeConfigInteger(config.value, max)') &&
    routeSource.includes("config.key === 'telegram_group_invite_expire_minutes' || config.key === 'telegram_vip_group_invite_expire_minutes'") &&
    routeSource.includes("config.key === 'invite_default_expire_days' && num > 3650"),
  'system config numeric keys must reject scientific notation, unsafe integers, and out-of-range values'
)

for (const forbiddenPattern of [
  'const packageId = Number(popupPromoPackageId)',
  'const packageId = Number(config.value)',
  'const amount = Number((item as { amount?: unknown }).amount)',
  'const num = Number(config.value)',
  'isNaN(num)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `system config route must not keep loose numeric coercion: ${forbiddenPattern}`
  )
}

assert.ok(
  routeSource.includes("const value = config.value.trim()") &&
    routeSource.includes('!decimalMoneyPattern.test(value)') &&
    routeSource.includes('num > maxTransferFee'),
  'transfer fee must keep strict two-decimal money validation and explicit maximum'
)

const sensitiveKeysStart = routeSource.indexOf('const sensitiveKeys = [')
assert.notEqual(sensitiveKeysStart, -1, 'system config route must define audit-log sensitive keys')
const sensitiveKeysEnd = routeSource.indexOf(']', sensitiveKeysStart)
assert.notEqual(sensitiveKeysEnd, -1, 'system config audit-log sensitive keys section must be closed')
const sensitiveKeysSection = routeSource.slice(sensitiveKeysStart, sensitiveKeysEnd)
assert.ok(
  sensitiveKeysSection.includes("'telegram_group_chat_id'") &&
    sensitiveKeysSection.includes("'telegram_vip_group_chat_id'"),
  'system config audit logging must redact Telegram group chat IDs'
)

console.log('system config value guard tests passed')
