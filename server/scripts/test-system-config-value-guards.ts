import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/system-config.ts'), 'utf8')
const packageRouteSource = readFileSync(resolve(process.cwd(), 'src/routes/packages.ts'), 'utf8')

assert.ok(
  packageRouteSource.includes('function optionalMoneyYuan(') &&
    packageRouteSource.includes('const rounded = Math.round(value * 100) / 100') &&
    packageRouteSource.includes('Math.abs(value - rounded) >= 1e-8') &&
    packageRouteSource.includes("`${field} 最多支持两位小数`") &&
    packageRouteSource.match(/trafficResetPrice: \{ type: 'number', minimum: 0, maximum: MAX_TRAFFIC_RESET_PRICE_YUAN \}/g)?.length === 2,
  'traffic reset price API must accept non-negative yuan values with at most two decimal places'
)

assert.ok(
  routeSource.includes("VIP_BENEFITS_CONFIG_KEY") &&
    routeSource.includes("const jsonKeys = ['invite_generation_costs', VIP_BENEFITS_CONFIG_KEY]") &&
    routeSource.includes('config.value = JSON.stringify(normalizeVipBenefitsConfig(parsed))') &&
    routeSource.includes('value: DEFAULT_VIP_BENEFITS_CONFIG_JSON') &&
    routeSource.includes('requestConfigMap.has(VIP_BENEFITS_CONFIG_KEY)'),
  'VIP benefits config must expose defaults, validate and canonicalize its JSON, and persist without schema changes'
)

assert.ok(
  routeSource.includes("const AFF_COMMISSION_RATE_CONFIG_KEY = 'aff_commission_rate'") &&
    routeSource.includes("const AFF_DISCOUNT_RATE_CONFIG_KEY = 'aff_discount_rate'") &&
    routeSource.includes('const DEFAULT_AFF_RATE = 0.05') &&
    routeSource.includes('value: DEFAULT_AFF_RATE.toString()'),
  'AFF commission and discount configs must expose 0.05 defaults without schema changes'
)

assert.ok(
  routeSource.includes('const MAX_AFF_COMMISSION_RATE = 0.5') &&
    routeSource.includes('const MAX_AFF_DISCOUNT_RATE = 0.95') &&
    routeSource.includes('function parseRateConfig(value: string, max: number): number | null') &&
    routeSource.includes('const rateKeys = [AFF_COMMISSION_RATE_CONFIG_KEY, AFF_DISCOUNT_RATE_CONFIG_KEY]') &&
    routeSource.includes('const rate = parseRateConfig(config.value, max)'),
  'AFF rate configs must strictly enforce commission 0-0.5 and discount 0-0.95 ranges'
)

assert.ok(
  routeSource.includes("const TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY = 'ticket_auto_close_enabled'") &&
    routeSource.includes("const TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY = 'ticket_auto_close_hours'") &&
    routeSource.includes('const DEFAULT_TICKET_AUTO_CLOSE_HOURS = 24') &&
    routeSource.includes("value: 'true'") &&
    routeSource.includes('value: DEFAULT_TICKET_AUTO_CLOSE_HOURS.toString()'),
  'ticket auto-close config must expose enabled=true and hours=24 defaults without schema changes'
)

assert.ok(
  routeSource.includes("TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY, 'free_site_mode'") &&
    routeSource.includes("'plugin_storage_backup_retention_count', TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY") &&
    routeSource.includes('config.key === TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY && num < 1'),
  'ticket auto-close enabled must be boolean and hours must be an integer of at least 1'
)

assert.ok(
  routeSource.includes('requestConfigMap.has(TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY)') &&
    routeSource.includes('requestConfigMap.has(TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY)') &&
    routeSource.match(/where: \{ key: TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY \}/) &&
    routeSource.match(/where: \{ key: TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY \}/),
  'ticket auto-close defaults must be upserted before their first persisted update'
)

assert.ok(
  routeSource.includes("const TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY = 'traffic_overage_throttle_speed'") &&
    routeSource.includes("const DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED = '1Mbit'") &&
    routeSource.includes('TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY') &&
    routeSource.includes('const bandwidthMatch = config.value.match(trafficBandwidthPattern)') &&
    routeSource.includes('await db.prisma.systemConfig.upsert({'),
  'traffic overage throttle config must be exposed, validated, and persisted without a schema column'
)

const highRiskKeysStart = routeSource.indexOf('const HIGH_RISK_ADMIN_ID_KEYS = new Set([')
assert.notEqual(highRiskKeysStart, -1, 'system config route must define high-risk admin allowlist keys')
const highRiskKeysEnd = routeSource.indexOf('])', highRiskKeysStart)
assert.notEqual(highRiskKeysEnd, -1, 'system config high-risk admin allowlist keys must be closed')
const highRiskKeysSection = routeSource.slice(highRiskKeysStart, highRiskKeysEnd)
for (const key of [
  'system_update_allowed_admin_ids',
  'payincus_gift_card_admin_ids',
  'plugin_manager_allowed_admin_ids',
  'theme_manager_allowed_admin_ids'
]) {
  assert.ok(highRiskKeysSection.includes(`'${key}'`), `system config high-risk keys must include ${key}`)
}

const updateHandlerStart = routeSource.indexOf("fastify.put<{ Body: UpdateConfigsBody }>('/', {")
const highRiskPermissionCheck = routeSource.indexOf(
  'configs.some(config => HIGH_RISK_ADMIN_ID_KEYS.has(config.key))',
  updateHandlerStart
)
const configWrite = routeSource.indexOf('await db.updateSystemConfigs(configs)', updateHandlerStart)
assert.ok(
  updateHandlerStart !== -1 &&
    highRiskPermissionCheck > updateHandlerStart &&
    highRiskPermissionCheck < configWrite &&
    routeSource.slice(highRiskPermissionCheck, configWrite).includes("request.user.username !== 'admin'") &&
    routeSource.slice(highRiskPermissionCheck, configWrite).includes('reply.code(403)') &&
    routeSource.slice(highRiskPermissionCheck, configWrite).includes('apiError(ErrorCode.FORBIDDEN)'),
  'system config PUT must reject non-owner high-risk allowlist updates with 403 before persistence'
)

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
