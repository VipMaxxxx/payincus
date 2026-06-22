import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const telegramSource = readFileSync(resolve(__dirname, '../src/routes/telegram.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = telegramSource.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = telegramSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return telegramSource.slice(start, end)
}

const webhookSection = sectionBetween(
  "fastify.post<{ Body: TelegramWebhookUpdate }>('/webhook'",
  'return { ok: true }\n  })'
)

const consumeIndex = webhookSection.indexOf('const consumeResult = await telegramBindTokenModel.updateMany')
const upsertIndex = webhookSection.indexOf('await telegramBindingModel.upsert')
const staleBranchIndex = webhookSection.indexOf('if (consumeResult.count !== 1)')

assert.notEqual(consumeIndex, -1, 'Telegram bind token must be consumed with conditional updateMany')
assert.notEqual(upsertIndex, -1, 'Telegram binding upsert not found')
assert.notEqual(staleBranchIndex, -1, 'Telegram bind token consume result must be checked')
assert.ok(consumeIndex < upsertIndex, 'Telegram bind token must be claimed before binding upsert side effects')
assert.ok(webhookSection.includes('usedAt: null'), 'Telegram bind token claim must require unused token')
assert.ok(webhookSection.includes('expiresAt: { gt: now }'), 'Telegram bind token claim must recheck expiry')
assert.ok(
  !webhookSection.includes('await telegramBindTokenModel.update({\n      where: { id: bindToken.id }'),
  'Telegram bind token must not be consumed with an unconditional update'
)

console.log('telegram bind token race guard tests passed')
