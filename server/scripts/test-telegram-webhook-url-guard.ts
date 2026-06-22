import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const telegramSource = readFileSync(resolve(__dirname, '../src/routes/telegram.ts'), 'utf8')

assert.ok(
  telegramSource.includes('const telegramApiTimeoutMs = 15_000'),
  'Telegram API calls must have a bounded timeout'
)
assert.ok(
  telegramSource.includes('const telegramWebhookBaseUrlMaxLength = 2048'),
  'Telegram webhook base URL inputs must have a length cap'
)
assert.equal(
  (telegramSource.match(/redirect: 'manual'/g) ?? []).length,
  2,
  'Telegram sendMessage and generic API calls must not automatically follow redirects'
)
assert.equal(
  (telegramSource.match(/signal: AbortSignal.timeout\(telegramApiTimeoutMs\)/g) ?? []).length,
  2,
  'Telegram sendMessage and generic API calls must use the Telegram API timeout'
)
assert.ok(
  telegramSource.includes("process.env.NODE_ENV === 'production' && url.protocol !== 'https:'"),
  'Telegram webhook base URL must require HTTPS in production'
)
assert.ok(
  telegramSource.includes("if (process.env.NODE_ENV === 'production')"),
  'Telegram webhook URL builder must not derive request host fallback in production'
)
assert.ok(
  telegramSource.includes("code: 'INVALID_TELEGRAM_WEBHOOK_BASE_URL'"),
  'Telegram webhook setup must reject invalid explicit baseUrl instead of silently falling back'
)
assert.ok(
  telegramSource.includes("code: 'TELEGRAM_WEBHOOK_BASE_URL_REQUIRED'"),
  'Telegram webhook setup must return a clear error when no production public URL can be built'
)
assert.ok(
  telegramSource.includes('SITE_URL or FRONTEND_URL must be configured before Telegram webhook setup in production'),
  'Telegram webhook setup must explain the required production public URL configuration'
)

console.log('telegram webhook URL guard tests passed')
