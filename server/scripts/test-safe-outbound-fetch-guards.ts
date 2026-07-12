import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8')
}

const outboundSecuritySource = readSource('../src/lib/outbound-security.ts')
const serverPackageSource = readSource('../package.json')
const rootPackageSource = readSource('../../package.json')
const safeFetchBody = outboundSecuritySource.match(
  /export async function safeFetch\([\s\S]*?\n}\n\nexport async function assertSafeStorageTarget/
)?.[0] ?? ''

assert.ok(safeFetchBody, 'outbound security must export safeFetch')
assert.ok(
  safeFetchBody.includes('await assertSafeHttpUrl(url, label)'),
  'safeFetch must validate the URL before making the request'
)
assert.ok(
  safeFetchBody.includes('dispatcher: safeOutboundDispatcher'),
  'safeFetch must use the connection-time revalidating dispatcher'
)
assert.ok(
  serverPackageSource.includes('"test:safe-outbound-fetch-guards"'),
  'server package must expose the safe outbound fetch guard script'
)
assert.ok(
  rootPackageSource.includes('pnpm --filter server test:safe-outbound-fetch-guards'),
  'root test chain must run the safe outbound fetch guard'
)

for (const [label, relativePath] of [
  ['Epay order query', '../src/lib/epay.ts'],
  ['Heleket API client', '../src/lib/heleket.ts'],
  ['notification webhooks', '../src/lib/notifier.ts'],
  ['Lsky client', '../src/lib/lsky.ts'],
  ['plugin submission scanner', '../src/lib/plugin-market-submission-scan.ts'],
  ['theme submission scanner', '../src/lib/theme-market-submission-scan.ts'],
  ['ticket image proxy', '../src/routes/tickets.ts'],
  ['CraneMail client', '../src/services/cranemail.ts'],
  ['SmarterMail client', '../src/services/smartermail.ts'],
  ['system monitor webhook', '../src/services/system-monitor.ts']
] as const) {
  assert.ok(readSource(relativePath).includes('safeFetch('), `${label} must use safeFetch`)
}

console.log('safe outbound fetch guard tests passed')
