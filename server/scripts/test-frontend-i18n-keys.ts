import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
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
const viteConfigSource = readFileSync(resolve(__dirname, '../../client/vite.config.ts'), 'utf8')

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

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'locales' ? [] : collectSourceFiles(path)
    return ['.ts', '.vue'].includes(extname(entry.name)) ? [path] : []
  })
}

function collectFrontendTranslationKeys(): Set<string> {
  const files = collectSourceFiles(resolve(repoRoot, 'client/src'))
  const keys = new Set<string>()
  const keyPatterns = [
    /\$t\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /\bt\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /(?:titleKey|labelKey|descriptionKey|messageKey):\s*['"`]([A-Za-z0-9_.-]+)['"`]/g
  ]

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of keyPatterns) {
      for (const match of source.matchAll(pattern)) {
        if (!match[1].endsWith('.')) keys.add(match[1])
      }
    }
  }

  for (const dynamicKey of [
    'hostPublicIpv4.status.free',
    'hostPublicIpv4.status.assigned',
    'hostPublicIpv4.status.disabled',
    'terminal.errors.connectionFailed',
    'terminal.errors.unknown'
  ]) keys.add(dynamicKey)

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
  assert.ok(keys.has('entertainment.prizeTypes.badge'), 'frontend i18n guard must cover shared benefits prize type keys')
  assert.ok(keys.has('aff.adminTitle'), 'frontend i18n guard must cover admin AFF review title')
  assert.ok(keys.has('aff.withdrawalStatus.pending'), 'frontend i18n guard must cover admin AFF review nested status labels')
  assert.ok(keys.has('instance.errorBanner.reasonLabel'), 'frontend i18n guard must cover instance failure reason label')
  assert.ok(keys.has('extensions.themeSubmissions.entry'), 'frontend i18n guard must cover the user theme submission entry')
  assert.ok(keys.has('extensions.themeSubmissions.freeReviewHint'), 'frontend i18n guard must cover free-only theme review copy')
  assert.ok(keys.has('extensions.themeSubmissions.status.pending'), 'frontend i18n guard must cover theme review statuses')
  for (const key of [
    'userLifecycle.title',
    'publicSite.portal.heroTitlePrimary',
    'flashSales.title',
    'hostPublicIpv4.title',
    'terminal.errors.connectionFailed',
    'invites.title',
    'telegramConfig.title'
  ]) {
    assert.ok(keys.has(key), `frontend i18n guard must cover D-152 key ${key}`)
  }

  for (const [localeName, messages] of Object.entries(localeMessages)) {
    const missingKeys: string[] = []
    for (const key of keys) {
      if (typeof resolveMessage(messages, key) !== 'string') missingKeys.push(key)
    }
    assert.deepEqual(missingKeys, [], `${localeName} must define every statically used frontend i18n key`)
  }
}

function flattenMessageKeys(source: unknown, prefix = ''): string[] {
  if (!source || typeof source !== 'object') return []
  return Object.entries(source as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : flattenMessageKeys(value, path)
  })
}

function assertD152NamespaceParity(): void {
  const namespaces = ['flashSales', 'hostPublicIpv4', 'invites', 'userLifecycle', 'telegramConfig']
  for (const namespace of namespaces) {
    const expected = flattenMessageKeys(resolveMessage(zhCN, namespace), namespace).sort()
    assert.ok(expected.length > 0, `zhCN must define ${namespace}`)
    for (const [localeName, messages] of Object.entries({ en, zhTW })) {
      assert.deepEqual(
        flattenMessageKeys(resolveMessage(messages, namespace), namespace).sort(),
        expected,
        `${localeName}.${namespace} must recursively match zhCN.${namespace}`
      )
    }
  }
}

function assertNoForcedSimplifiedChineseFallback(): void {
  const localeIndexSource = readFileSync(resolve(repoRoot, 'client/src/locales/index.ts'), 'utf8')
  assert.ok(!localeIndexSource.includes('missing:'), 'i18n config must not force missing keys to Simplified Chinese')
  assert.ok(!localeIndexSource.includes('resolveMessageFallback'), 'Simplified Chinese fallback helper must be removed')
}

function assertSplitLocalePruneKeepsAdminBenefits(): void {
  const adminPruneStart = viteConfigSource.indexOf('function stripAdminOnlyLocaleMessages')
  const userPruneStart = viteConfigSource.indexOf('function stripUserOnlyLocaleMessages')
  assert.ok(adminPruneStart >= 0 && userPruneStart > adminPruneStart, 'Vite config must define split locale prune helpers')

  const adminPruneSource = viteConfigSource.slice(adminPruneStart, userPruneStart)
  const userPruneSource = viteConfigSource.slice(userPruneStart)
  const userOnlyTopLevelMatch = /const userOnlyTopLevelKeys = \[([\s\S]*?)\]/.exec(adminPruneSource)
  assert.ok(userOnlyTopLevelMatch, 'admin locale prune must define userOnlyTopLevelKeys')
  const userOnlyTopLevelKeysSource = userOnlyTopLevelMatch[1]
  const adminEntertainmentRemovedKeysMatch = /const adminEntertainmentRemovedKeys = \[([\s\S]*?)\]/.exec(adminPruneSource)
  assert.ok(adminEntertainmentRemovedKeysMatch, 'admin locale prune must define adminEntertainmentRemovedKeys')
  const adminEntertainmentRemovedKeysSource = adminEntertainmentRemovedKeysMatch[1]

  assert.ok(
    !userOnlyTopLevelKeysSource.includes("'entertainment'"),
    'admin locale prune must not remove the whole entertainment namespace because the admin benefits page uses entertainment.admin'
  )
  assert.ok(
    !userOnlyTopLevelKeysSource.includes("'aff'"),
    'admin locale prune must not remove the aff namespace because the admin billing AFF review page uses aff.* labels'
  )
  assert.ok(
    adminPruneSource.includes('adminEntertainmentRemovedKeys') &&
      adminEntertainmentRemovedKeysSource.includes("'wonInstance'") === false &&
      adminEntertainmentRemovedKeysSource.includes("'admin'") === false,
    'admin locale prune must keep entertainment.admin plus shared prize result labels required by the admin benefits page'
  )
  assert.ok(
    userPruneSource.includes("removeLocaleObjectProperty(stripped, 'admin', 8, entertainmentRange[0], entertainmentRange[1])"),
    'customer locale prune must remove entertainment.admin from the customer bundle'
  )
}

function assertTrafficNotificationPlaceholders(): void {
  const keys = [
    'profile.notifications.trafficMessages.warning',
    'profile.notifications.trafficMessages.throttled'
  ]
  const expectedPlaceholders = ['resetDay', 'speed', 'throttleSpeed']

  for (const key of keys) {
    for (const [localeName, messages] of Object.entries(localeMessages)) {
      const message = resolveMessage(messages, key)
      assert.equal(typeof message, 'string', `${localeName} must define ${key}`)
      const placeholders = Array.from((message as string).matchAll(/\{([A-Za-z0-9_]+)\}/g), match => match[1]).sort()
      assert.deepEqual(placeholders, expectedPlaceholders, `${localeName}.${key} must use matching dynamic placeholders`)
      assert.ok(!(message as string).includes('1Mbit'), `${localeName}.${key} must not hard-code 1Mbit`)
      assert.ok(!/(下月|下個月|next month).*1/i.test(message as string), `${localeName}.${key} must not hard-code next-month day 1`)
    }
  }
}

for (const [localeName, source] of Object.entries(localeSources)) {
  assertLocaleContainsKeys(localeName, source)
}

assertFrontendKeysExist()
assertD152NamespaceParity()
assertNoForcedSimplifiedChineseFallback()
assertSplitLocalePruneKeepsAdminBenefits()
assertTrafficNotificationPlaceholders()

console.log('frontend i18n key checks passed')
