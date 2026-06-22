import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/notifications.ts'), 'utf8')

assert.ok(
  source.includes('const telegramBotTokenPattern = /^[1-9]'),
  'user Telegram notification Bot Token must be validated with a strict pattern'
)
assert.ok(
  source.includes('const telegramChatIdPattern = /^-?\\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/'),
  'user Telegram notification Chat ID must be restricted to numeric IDs or @usernames'
)
assert.ok(
  source.includes('const maxWebhookSecretLength = 256'),
  'user Webhook notification secrets must have a bounded length'
)
assert.ok(
  source.includes("type UserNotificationChannelType = 'telegram' | 'discord' | 'webhook' | 'email'") &&
    source.includes("const USER_NOTIFICATION_CHANNEL_TYPES = new Set<UserNotificationChannelType>(['telegram', 'discord', 'webhook', 'email'])") &&
    source.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    source.includes('function normalizeNotificationChannelCreateInput(input: unknown): NotificationChannelCreateInput') &&
    source.includes('function normalizeNotificationChannelUpdateInput(input: unknown): NotificationChannelUpdateInput'),
  'user notification channel create/update routes must define runtime body normalizers'
)
assert.ok(
  source.includes('function normalizeNotificationChannelName(value: unknown): string') &&
    source.includes('const name = value.trim()') &&
    source.includes('!name || name.length > 50') &&
    source.includes("typeof input.enabled !== 'boolean'") &&
    source.includes('config: { ...input.config }'),
  'user notification channel normalizers must trim names, require boolean enabled flags, and copy config records'
)
assert.ok(
  source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'user notification channel routes must use a strict positive safe-integer route ID parser'
)
assert.equal(
  source.match(/const channelId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  5,
  'user notification channel detail/update/delete/test/toggle routes must strictly validate channel IDs'
)
for (const forbiddenPattern of [
  'const channelId = Number(id)',
  'isNaN(channelId)'
]) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `user notification channel routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const validateConfigStart = source.indexOf('function validateConfig(')
const getPreviewStart = source.indexOf('function getConfigPreview(')
assert.notEqual(validateConfigStart, -1, 'validateConfig function not found')
assert.notEqual(getPreviewStart, -1, 'getConfigPreview function not found')
const validateConfigSection = source.slice(validateConfigStart, getPreviewStart)
const createRouteStart = source.indexOf('  // 添加通知渠道')
const updateRouteStart = source.indexOf('  // 更新通知渠道')
const deleteRouteStart = source.indexOf('  // 删除通知渠道')
assert.notEqual(createRouteStart, -1, 'notification channel create route not found')
assert.notEqual(updateRouteStart, -1, 'notification channel update route not found')
assert.notEqual(deleteRouteStart, -1, 'notification channel delete route not found')
const createRouteSection = source.slice(createRouteStart, updateRouteStart)
const updateRouteSection = source.slice(updateRouteStart, deleteRouteStart)

assert.ok(
  createRouteSection.includes('input = normalizeNotificationChannelCreateInput(request.body)') &&
    createRouteSection.includes('const { type, name, config, enabled } = input'),
  'user notification channel create route must use normalized body input'
)
assert.ok(
  updateRouteSection.includes('input = normalizeNotificationChannelUpdateInput(request.body)') &&
    updateRouteSection.includes('const { name, config, enabled } = input'),
  'user notification channel update route must use normalized body input'
)
assert.ok(
  !createRouteSection.includes('const { type, name, config, enabled = true } = request.body') &&
    !updateRouteSection.includes('const { name, config, enabled } = request.body'),
  'user notification channel create/update routes must not destructure raw typed bodies'
)

assert.ok(
  validateConfigSection.includes("typeof config.botToken !== 'string' || typeof config.chatId !== 'string'"),
  'user Telegram notification config must reject non-string Bot Token and Chat ID values'
)
assert.ok(
  validateConfigSection.includes('const botToken = config.botToken.trim()') &&
    validateConfigSection.includes('const chatId = config.chatId.trim()'),
  'user Telegram notification config must derive normalized Bot Token and Chat ID values'
)
assert.ok(
  validateConfigSection.includes('!telegramBotTokenPattern.test(botToken)'),
  'user Telegram notification config must reject malformed Bot Tokens'
)
assert.ok(
  validateConfigSection.includes('!telegramChatIdPattern.test(chatId)'),
  'user Telegram notification config must reject malformed Chat IDs'
)
assert.ok(
  validateConfigSection.includes("typeof config.secret !== 'string' || config.secret.length > maxWebhookSecretLength"),
  'user Webhook notification config must reject non-string or oversized secrets'
)
assert.ok(
  validateConfigSection.includes('config.botToken = botToken') &&
    validateConfigSection.includes('config.chatId = chatId') &&
    validateConfigSection.includes('config.secret = config.secret.trim()'),
  'user notification config must write normalized values before persistence'
)

console.log('user notification channel guard tests passed')
