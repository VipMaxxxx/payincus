import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const localeSources = {
  en: readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8'),
  zhCN: readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8'),
  zhTW: readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
}

const sensitiveVerificationKeys = [
  'title',
  'description',
  'operationLabel',
  'requestHint',
  'sendCode',
  'sendingCode',
  'resendCode',
  'resendIn',
  'codeSent',
  'codeSentTo',
  'enterCode',
  'codePlaceholder',
  'verify',
  'verifying',
  'verifySuccess',
  'verifyFailed',
  'codeExpired',
  'invalidCode'
] as const

const operationTypeKeys = [
  'change_password',
  'disable_2fa',
  'change_email',
  'delete_account',
  'delete_instance',
  'reinstall_instance',
  'recreate_instance',
  'transfer_instance',
  'delete_snapshot',
  'delete_backup'
] as const

const channelKeys = [
  'email',
  'telegram',
  'discord',
  'webhook'
] as const

function assertLocaleContainsKeys(localeName: string, source: string): void {
  assert.ok(source.includes('sensitiveVerification: {'), `${localeName} must define sensitiveVerification messages`)

  for (const key of sensitiveVerificationKeys) {
    assert.ok(
      new RegExp(`\\b${key}:\\s*'`).test(source),
      `${localeName} must define sensitiveVerification.${key}`
    )
  }

  for (const key of operationTypeKeys) {
    assert.ok(
      new RegExp(`\\b${key}:\\s*'`).test(source),
      `${localeName} must define sensitiveVerification.operationTypes.${key}`
    )
  }

  for (const key of channelKeys) {
    assert.ok(
      new RegExp(`\\b${key}:\\s*'`).test(source),
      `${localeName} must define sensitiveVerification.channels.${key}`
    )
  }
}

for (const [localeName, source] of Object.entries(localeSources)) {
  assertLocaleContainsKeys(localeName, source)
}

console.log('frontend i18n key checks passed')
