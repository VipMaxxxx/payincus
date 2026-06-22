import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeObject, sanitizeTokensInString, isSensitiveField } from '../src/lib/log-sanitizer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const redacted = '[REDACTED]'
const redactedJwt = '[REDACTED_JWT]'

const sanitized = sanitizeObject({
  username: 'alice',
  password: 'plain-password',
  adminPassword: 'admin-password',
  smtpPassword: 'smtp-password',
  mailPassword: 'mail-password',
  newPassword: 'new-password',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  botToken: 'telegram-bot-token',
  webhookUrl: 'https://discord.com/api/webhooks/secret',
  chatId: '123456',
  sign: 'payment-sign',
  signature: 'payment-signature',
  access_token: 'oauth-access-token',
  refresh_token: 'oauth-refresh-token',
  id_token: 'oauth-id-token',
  authorization: 'Bearer opaque-token',
  cookie: 'refreshToken=secret-cookie',
  nested: {
    clientSecret: 'client-secret',
    client_secret: 'snake-client-secret',
    apiKey: 'api-key',
    api_key: 'snake-api-key',
    key: 'gateway-key',
    merchantPrivateKey: 'merchant-private-key',
    merchant_private_key: 'snake-merchant-private-key',
    webhookSecret: 'webhook-secret',
    webhook_secret: 'snake-webhook-secret',
    'x-signature': 'webhook-signature',
    privateKey: 'private-key',
    private_key: 'snake-private-key',
    totpCode: '123456',
    totp_code: '654321',
    note: 'keep-me'
  },
  items: [
    {
      backupCode: 'backup-code',
      backup_code: 'snake-backup-code',
      safe: 'value'
    }
  ],
  message: 'user supplied Bearer opaque-token and jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature'
})

assert.equal(sanitized.username, 'alice')
assert.equal(sanitized.password, redacted)
assert.equal(sanitized.adminPassword, redacted)
assert.equal(sanitized.smtpPassword, redacted)
assert.equal(sanitized.mailPassword, redacted)
assert.equal(sanitized.newPassword, redacted)
assert.equal(sanitized.accessToken, redacted)
assert.equal(sanitized.refreshToken, redacted)
assert.equal(sanitized.botToken, redacted)
assert.equal(sanitized.webhookUrl, redacted)
assert.equal(sanitized.chatId, redacted)
assert.equal(sanitized.sign, redacted)
assert.equal(sanitized.signature, redacted)
assert.equal(sanitized.access_token, redacted)
assert.equal(sanitized.refresh_token, redacted)
assert.equal(sanitized.id_token, redacted)
assert.equal(sanitized.authorization, redacted)
assert.equal(sanitized.cookie, redacted)

assert.equal(sanitized.nested.clientSecret, redacted)
assert.equal(sanitized.nested.client_secret, redacted)
assert.equal(sanitized.nested.apiKey, redacted)
assert.equal(sanitized.nested.api_key, redacted)
assert.equal(sanitized.nested.key, redacted)
assert.equal(sanitized.nested.merchantPrivateKey, redacted)
assert.equal(sanitized.nested.merchant_private_key, redacted)
assert.equal(sanitized.nested.webhookSecret, redacted)
assert.equal(sanitized.nested.webhook_secret, redacted)
assert.equal(sanitized.nested['x-signature'], redacted)
assert.equal(sanitized.nested.privateKey, redacted)
assert.equal(sanitized.nested.private_key, redacted)
assert.equal(sanitized.nested.totpCode, redacted)
assert.equal(sanitized.nested.totp_code, redacted)
assert.equal(sanitized.nested.note, 'keep-me')

assert.equal(sanitized.items[0].backupCode, redacted)
assert.equal(sanitized.items[0].backup_code, redacted)
assert.equal(sanitized.items[0].safe, 'value')

assert.equal(
  sanitized.message,
  `user supplied ${redactedJwt} and jwt ${redactedJwt}`
)

assert.equal(sanitizeTokensInString('Authorization: Bearer opaque-token'), `Authorization: ${redactedJwt}`)
assert.equal(isSensitiveField('access_token'), true)
assert.equal(isSensitiveField('client_secret'), true)
assert.equal(isSensitiveField('signature'), true)
assert.equal(isSensitiveField('x-signature'), true)
assert.equal(isSensitiveField('botToken'), true)
assert.equal(isSensitiveField('webhookUrl'), true)
assert.equal(isSensitiveField('smtpPassword'), true)
assert.equal(isSensitiveField('chatId'), true)
assert.equal(isSensitiveField('username'), false)

const authSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
const usersSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const rechargeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')
assert.equal(
  authSource.includes('[send-verification-code]'),
  false,
  'registration verification route must not write raw email or mail-provider details to console logs'
)
assert.equal(
  authSource.includes('Sent login alert email to ${user.email}'),
  false,
  'login alert success logs must not include the user email address'
)
assert.equal(
  usersSource.includes('Sent ban notification email to ${user.email}'),
  false,
  'admin ban notification logs must not include the target user email address'
)
assert.equal(
  usersSource.includes('email: ${user.email') || usersSource.includes('email: ${user.email ||'),
  false,
  'admin user status/delete logs must not include the target user email address'
)
assert.equal(
  rechargeSource.includes('request.log.warn({ orderNo, queryResult },'),
  false,
  'recharge active verification must not log raw Heleket query results'
)
assert.equal(
  adminBillingSource.includes('request.log.warn({ orderNo: record.orderNo, queryResult },'),
  false,
  'admin recharge sync must not log raw Heleket query results'
)
assert.ok(
  rechargeSource.includes('queryResult: sanitizeObject(queryResult)') &&
    adminBillingSource.includes('queryResult: sanitizeObject(queryResult)'),
  'Heleket invalid-amount logs must sanitize queryResult before writing logs'
)

console.log('log sanitizer tests passed')
