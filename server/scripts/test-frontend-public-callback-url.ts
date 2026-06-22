import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const clientRoot = resolve(__dirname, '../../client/src')
const apiUrlSource = readFileSync(resolve(clientRoot, 'utils/api-url.ts'), 'utf8')
const telegramViewSource = readFileSync(resolve(clientRoot, 'views/admin/TelegramConfigView.vue'), 'utf8')
const oauthViewSource = readFileSync(resolve(clientRoot, 'views/admin/OAuthConfigView.vue'), 'utf8')

assert.ok(
  apiUrlSource.includes('export function getFrontendOrigin(): string') &&
    apiUrlSource.includes('return window.location.origin'),
  'frontend public callback helpers must use the browser frontend origin'
)
assert.ok(
  apiUrlSource.includes('export function buildPublicApiUrl(path: string): string') &&
    apiUrlSource.includes("return new URL(`/api${normalizePath(path)}`, getFrontendOrigin()).toString()"),
  'frontend public callback URLs must resolve under the frontend /api path'
)
assert.ok(
  !apiUrlSource.includes('getApiBaseOrigin'),
  'API base origin helper should not be kept for public callback URL setup'
)

assert.ok(
  telegramViewSource.includes("import { buildPublicApiUrl, getFrontendOrigin } from '@/utils/api-url'"),
  'Telegram admin view must import public frontend URL helpers'
)
assert.ok(
  telegramViewSource.includes("const telegramWebhookUrl = computed(() => buildPublicApiUrl('/telegram/webhook'))"),
  'Telegram admin view must display the frontend public /api webhook URL'
)
assert.ok(
  telegramViewSource.includes('baseUrl: getFrontendOrigin()'),
  'Telegram webhook setup must submit the frontend origin to the backend'
)
assert.ok(
  !telegramViewSource.includes('getApiBaseOrigin'),
  'Telegram webhook setup must not derive baseUrl from VITE_API_BASE_URL or API origin'
)

assert.ok(
  oauthViewSource.includes("import { buildPublicApiUrl } from '@/utils/api-url'"),
  'OAuth admin view must import the public callback URL helper'
)
assert.ok(
  oauthViewSource.includes('return path ? buildPublicApiUrl(path) :'),
  'OAuth admin view must display callback URLs under the frontend public /api path'
)

console.log('frontend public callback URL tests passed')
