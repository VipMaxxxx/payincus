import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../../client/src/locales/en.js'
import zhCN from '../../client/src/locales/zh-CN.js'
import zhTW from '../../client/src/locales/zh-TW.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

const localeSources = {
  en: readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8'),
  zhCN: readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8'),
  zhTW: readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
}

const localeMessages = {
  en,
  zhCN,
  zhTW
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

function collectFrontendTranslationKeys(): Set<string> {
  const files = [
    'client/src/views/admin/EntertainmentView.vue'
  ]
  const keys = new Set<string>()
  const keyPatterns = [
    /\$t\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /\bt\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /titleKey:\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /label:\s*['"`]([A-Za-z0-9_.-]+)['"`]/g
  ]

  for (const file of files) {
    const source = readFileSync(resolve(repoRoot, file), 'utf8')
    for (const pattern of keyPatterns) {
      for (const match of source.matchAll(pattern)) {
        const key = match[1]
        if (key.startsWith('entertainment.admin.')) keys.add(key)
      }
    }
  }

  return keys
}

function resolveMessage(source: unknown, key: string): unknown {
  let current = source
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function assertFrontendKeysExist(): void {
  const keys = collectFrontendTranslationKeys()
  assert.ok(keys.has('entertainment.admin.title'), 'frontend i18n guard must cover admin benefits page keys')

  for (const [localeName, messages] of Object.entries(localeMessages)) {
    for (const key of keys) {
      assert.equal(
        typeof resolveMessage(messages, key),
        'string',
        `${localeName} must define frontend i18n key ${key}`
      )
    }
  }
}

for (const [localeName, source] of Object.entries(localeSources)) {
  assertLocaleContainsKeys(localeName, source)
}

assertFrontendKeysExist()

console.log('frontend i18n key checks passed')
