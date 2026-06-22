import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const appSource = readRepoFile('server/src/app.ts')
const nginxExample = readRepoFile('deploy/nginx-split-intranet.conf.example')
const installPanel = readRepoFile('scripts/install-panel.sh')
const verifySplitHost = readRepoFile('scripts/verify-split-host.sh')

assert.ok(
  appSource.includes("contentSecurityPolicy: process.env.NODE_ENV === 'production' ?") &&
    appSource.includes("defaultSrc: [\"'self'\"]") &&
    appSource.includes("objectSrc: [\"'none'\"]") &&
    appSource.includes("frameAncestors: [\"'none'\"]") &&
    appSource.includes("baseUri: [\"'self'\"]") &&
    appSource.includes("formAction: [\"'self'\"]") &&
    appSource.includes("'ws:',   // HTTP-only intranet WebSocket validation") &&
    appSource.includes("'wss:',  // WebSocket 连接"),
  'backend Helmet CSP must stay enabled in production with anti-clickjacking/object/base/form controls'
)

assert.ok(
  appSource.includes("frameguard: { action: 'deny' }") &&
    appSource.includes("noSniff: true") &&
    appSource.includes("referrerPolicy: { policy: 'strict-origin-when-cross-origin' }") &&
    appSource.includes('hsts: false'),
  'backend Helmet security header decisions must stay explicit'
)

for (const [name, source] of [
  ['Nginx split example', nginxExample],
  ['install script Nginx template', installPanel]
] as const) {
  assert.ok(
    source.includes('add_header Content-Security-Policy') &&
      source.includes("default-src 'self'") &&
      source.includes("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com") &&
      source.includes("connect-src 'self' ws: wss:") &&
      source.includes("object-src 'none'") &&
      source.includes("frame-ancestors 'none'") &&
      source.includes('always;'),
    `${name} must set CSP for the static frontend`
  )

  assert.ok(
    source.includes('add_header X-Content-Type-Options nosniff always;') &&
      source.includes('add_header X-Frame-Options DENY always;') &&
      source.includes('add_header Referrer-Policy strict-origin-when-cross-origin always;'),
    `${name} must set static frontend nosniff, frame, and referrer headers`
  )
}

assert.ok(
  verifySplitHost.includes('fetch_url_with_headers "frontend index"') &&
    verifySplitHost.includes('assert_header "$tmp_dir/frontend.headers" "content-security-policy"') &&
    verifySplitHost.includes(".*default-src 'self'.*frame-ancestors 'none'") &&
    verifySplitHost.includes('assert_header "$tmp_dir/frontend.headers" "x-content-type-options" "nosniff"') &&
    verifySplitHost.includes('assert_header "$tmp_dir/frontend.headers" "x-frame-options" "DENY"') &&
    verifySplitHost.includes('assert_header "$tmp_dir/frontend.headers" "referrer-policy" "strict-origin-when-cross-origin"'),
  'split host verifier must check security headers on the static frontend index response'
)

console.log('security header checks passed')
