import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')

assert.ok(
  routeSource.includes("import { isIP } from 'net'"),
  'recharge URL guard must distinguish IP literals from public hostnames'
)

assert.ok(
  routeSource.includes("import { assertSafeHttpUrl, isIpPrivateOrReserved } from '../lib/outbound-security.js'"),
  'recharge URL guard must reuse private/reserved IP detection'
)

assert.ok(
  routeSource.includes('function isLocalOrPrivateHostname(hostname: string): boolean') &&
    routeSource.includes("normalizedHost === 'localhost'") &&
    routeSource.includes("normalizedHost.endsWith('.localhost')") &&
    routeSource.includes("normalizedHost.endsWith('.local')") &&
    routeSource.includes("normalizedHost.endsWith('.internal')"),
  'production recharge URLs must reject local hostnames'
)

assert.ok(
  routeSource.includes("isIP(normalizedHost) !== 0 && isIpPrivateOrReserved(normalizedHost)") &&
    routeSource.includes("return !normalizedHost.includes('.')"),
  'production recharge URLs must reject private IP literals and single-label hostnames'
)

assert.ok(
  routeSource.includes("if (process.env.NODE_ENV === 'production')") &&
    routeSource.includes("parsed.protocol !== 'https:'") &&
    routeSource.includes('must use HTTPS in production') &&
    routeSource.includes('must use a public frontend hostname in production'),
  'production recharge URL validation must require HTTPS and public hostnames'
)

assert.ok(
  routeSource.includes("const callbackUrl = process.env.PAYMENT_CALLBACK_BASE_URL?.trim()") &&
    routeSource.includes("return validatePublicBaseUrl(callbackUrl, 'PAYMENT_CALLBACK_BASE_URL')") &&
    routeSource.includes("return validatePublicBaseUrl(frontendUrl, 'FRONTEND_URL')"),
  'both FRONTEND_URL and PAYMENT_CALLBACK_BASE_URL must use the shared production URL guard'
)

console.log('recharge callback URL guard tests passed')
