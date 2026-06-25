import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const mailerSource = readFileSync(resolve(__dirname, '../src/lib/mailer.ts'), 'utf8')
const systemConfigRoute = readFileSync(resolve(__dirname, '../src/routes/system-config.ts'), 'utf8')

assert.ok(
  mailerSource.includes('export interface SmtpTestDeliveryInfo') &&
    mailerSource.includes('providerMessageId?: string') &&
    mailerSource.includes('acceptedRecipientCount: number') &&
    mailerSource.includes('rejectedRecipientCount: number') &&
    mailerSource.includes('pendingRecipientCount: number') &&
    mailerSource.includes('providerResponse?: string'),
  'SMTP test delivery must define safe provider proof metadata'
)

assert.ok(
  mailerSource.includes('const info = await testTransporter.sendMail({') &&
    mailerSource.includes('return { success: true, ...buildSmtpTestDeliveryInfo(info) }'),
  'SMTP send-test must capture nodemailer provider metadata instead of discarding it'
)

assert.ok(
  mailerSource.includes('redactEmailLikeValues(info.response)') &&
    !mailerSource.includes('accepted: accepted') &&
    !mailerSource.includes('rejected: rejected'),
  'SMTP proof metadata must not expose raw accepted/rejected recipient lists or email-like provider response values'
)

assert.ok(
  systemConfigRoute.includes('getEmailDomainForAudit(to)') &&
    systemConfigRoute.includes('providerMessageId: result.providerMessageId') &&
    systemConfigRoute.includes('acceptedRecipientCount: result.acceptedRecipientCount') &&
    systemConfigRoute.includes('rejectedRecipientCount: result.rejectedRecipientCount') &&
    systemConfigRoute.includes('pendingRecipientCount: result.pendingRecipientCount') &&
    systemConfigRoute.includes('providerResponse: result.providerResponse'),
  'SMTP send-test route must return safe provider proof metadata'
)

assert.ok(
  !systemConfigRoute.includes('Test email sent to ${to}') &&
    !systemConfigRoute.includes('Failed to send test email to ${to}') &&
    systemConfigRoute.includes('SMTP test email accepted for recipient domain ${recipientDomain}'),
  'SMTP send-test audit log must avoid writing full recipient addresses'
)

console.log('smtp proof reference guards passed')
