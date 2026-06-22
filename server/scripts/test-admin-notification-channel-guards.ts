import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/admin-notification-channels.ts'), 'utf8')

assert.ok(
  source.includes('const telegramBotTokenPattern = /^[1-9]'),
  'global Telegram channel Bot Token format must be validated with a strict pattern'
)
assert.ok(
  source.includes('const telegramChatIdPattern = /^-?\\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/'),
  'global Telegram channel Chat ID must be restricted to numeric IDs or @usernames'
)
assert.ok(
  source.includes('const maskedTelegramBotTokenPattern = /^.{1,20}\\.\\.\\..{1,20}$/'),
  'masked Bot Token placeholders must be rejected by direct API updates'
)
assert.ok(
  source.includes('function normalizeGlobalTelegramChannelInput'),
  'global Telegram channel create/update inputs must share a normalization function'
)
assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'global Telegram channel routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const channelId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  4,
  'global Telegram channel detail, update, delete, and test routes must strictly validate route IDs'
)

for (const forbiddenPattern of [
  'const channelId = Number(request.params.id)',
  'isNaN(channelId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `global Telegram channel routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const createSectionStart = source.indexOf('// 创建全局 Telegram 通知渠道')
const updateSectionStart = source.indexOf('// 更新全局通知渠道')
const deleteSectionStart = source.indexOf('// 删除全局通知渠道')
assert.notEqual(createSectionStart, -1, 'create route section not found')
assert.notEqual(updateSectionStart, -1, 'update route section not found')
assert.notEqual(deleteSectionStart, -1, 'delete route section not found')

const createSection = source.slice(createSectionStart, updateSectionStart)
const updateSection = source.slice(updateSectionStart, deleteSectionStart)

assert.ok(
  createSection.includes('const normalized = normalizeGlobalTelegramChannelInput(request.body)'),
  'global channel create route must normalize and validate input before persistence'
)
assert.ok(
  createSection.includes('const { name, botToken, chatId } = normalized.value'),
  'global channel create route must use normalized values'
)
assert.ok(
  !createSection.includes("if (!botToken.includes(':'))"),
  'global channel create route must not rely on colon-only token validation'
)

assert.ok(
  updateSection.includes('const normalized = normalizeGlobalTelegramChannelInput(request.body)'),
  'global channel update route must normalize and validate direct API input'
)
assert.ok(
  updateSection.includes('const { name, botToken, chatId } = normalized.value'),
  'global channel update route must use normalized values'
)
assert.ok(
  updateSection.includes('botToken: botToken || existingConfig.botToken'),
  'global channel update route must preserve existing Bot Token when omitted'
)

console.log('admin notification channel guard tests passed')
