import { readFileSync } from 'node:fs'

const instanceRoutesSource = readFileSync(new URL('../src/routes/instances.ts', import.meta.url), 'utf8')
const instanceCreateViewSource = readFileSync(new URL('../../client/src/views/InstanceCreateView.vue', import.meta.url), 'utf8')
const zhLocaleSource = readFileSync(new URL('../../client/src/locales/zh-CN.ts', import.meta.url), 'utf8')
const enLocaleSource = readFileSync(new URL('../../client/src/locales/en.ts', import.meta.url), 'utf8')
const twLocaleSource = readFileSync(new URL('../../client/src/locales/zh-TW.ts', import.meta.url), 'utf8')
const errorHandlerSource = readFileSync(new URL('../../client/src/utils/errorHandler.ts', import.meta.url), 'utf8')

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

assert(
  instanceRoutesSource.includes("import { turnstileVerifier } from '../lib/turnstile.js'"),
  'instances route must import the shared Turnstile verifier'
)

assert(
  instanceRoutesSource.includes('if (flashSaleItemId === undefined)') &&
    instanceRoutesSource.includes('await turnstileVerifier(request, reply)') &&
    instanceRoutesSource.includes('if (reply.sent) return'),
  'normal instance creation must run global Turnstile verification before order/resource work'
)

assert(
  instanceRoutesSource.includes('assertFlashSaleCheckoutEligibility({') &&
    instanceRoutesSource.includes('turnstileToken,') &&
    instanceRoutesSource.includes('remoteIp: request.ip'),
  'flash sale creation must keep its business-level Turnstile validation'
)

assert(
  instanceCreateViewSource.includes("import TurnstileWidget from '@/components/TurnstileWidget.vue'") &&
    !instanceCreateViewSource.includes("import { useTurnstile } from '@/composables/useTurnstile'") &&
    instanceCreateViewSource.includes('<TurnstileWidget') &&
    instanceCreateViewSource.includes('v-model="turnstileToken"') &&
    instanceCreateViewSource.includes('const isCreateTurnstileRequired = computed') &&
    instanceCreateViewSource.includes('getCreateTurnstileToken()') &&
    instanceCreateViewSource.includes('if (verificationToken === null) return') &&
    instanceCreateViewSource.includes('focusCreateTurnstile()') &&
    instanceCreateViewSource.includes('resetCreateTurnstile()'),
  'instance create page must render a visible Turnstile widget, read its token at submit time, stop before API submit when missing, and reset it after submit'
)

assert(
  !instanceCreateViewSource.includes('if (isCreateTurnstileRequired.value && !turnstileToken.value) {\n    return false\n  }'),
  'instance create button must not be disabled solely because Turnstile token is not ready; submit must handle focus and localized warning'
)

assert(
  instanceCreateViewSource.includes('v-if="isCreateTurnstileRequired"') &&
    instanceCreateViewSource.includes("instance.createPage.turnstileRequiredTitle") &&
    instanceCreateViewSource.includes("instance.createPage.turnstileRequiredDesc") &&
    instanceCreateViewSource.includes("instance.createPage.turnstileRequired") &&
    instanceCreateViewSource.includes("instance.createPage.turnstileFailed"),
  'instance create page must show a visible Turnstile requirement hint when enabled'
)

assert(
  errorHandlerSource.includes('getTurnstileErrorKey') &&
    errorHandlerSource.includes('turnstile verification required') &&
    errorHandlerSource.includes('turnstile verification failed') &&
    errorHandlerSource.includes('missing-input-response') &&
    errorHandlerSource.includes('invalid-input-response'),
  'frontend error translator must localize raw Turnstile backend messages and Cloudflare error codes'
)

for (const [name, source] of [
  ['zh-CN', zhLocaleSource],
  ['zh-TW', twLocaleSource],
  ['en', enLocaleSource]
] as const) {
  assert(source.includes('turnstileRequiredTitle'), `${name} locale must include turnstileRequiredTitle`)
  assert(source.includes('turnstileRequiredDesc'), `${name} locale must include turnstileRequiredDesc`)
  assert(source.includes('turnstileRequired'), `${name} locale must include turnstileRequired`)
  assert(source.includes('turnstileFailed'), `${name} locale must include turnstileFailed`)
}

console.log('instance create Turnstile guards passed')
