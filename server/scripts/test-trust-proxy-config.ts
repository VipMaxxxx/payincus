import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTrustProxyConfig, getTrustProxyEnabled } from '../src/lib/trust-proxy-config.js'

const originalTrustProxy = process.env.TRUST_PROXY
const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS
const originalNodeEnv = process.env.NODE_ENV

function setTrustProxy(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.TRUST_PROXY
  } else {
    process.env.TRUST_PROXY = value
  }
}

try {
  process.env.NODE_ENV = 'production'

  setTrustProxy(undefined)
  assert.equal(getTrustProxyEnabled(), false, 'production must not trust proxy headers implicitly')
  assert.equal(getTrustProxyConfig(), false)

  for (const enabledValue of ['true', '1', 'yes', 'on']) {
    setTrustProxy(enabledValue)
    const config = getTrustProxyConfig()
    assert.equal(config, 1, `${enabledValue} must trust only one proxy hop by default`)
    assert.notEqual(config, true, `${enabledValue} must never trust the entire proxy chain`)
    assert.equal(getTrustProxyEnabled(), true)
  }

  process.env.TRUST_PROXY_HOPS = '3'
  setTrustProxy('true')
  assert.equal(getTrustProxyConfig(), 3)

  process.env.TRUST_PROXY_HOPS = 'invalid'
  assert.equal(getTrustProxyConfig(), 1, 'invalid TRUST_PROXY_HOPS must fall back to one hop')
  delete process.env.TRUST_PROXY_HOPS

  setTrustProxy('2')
  assert.equal(getTrustProxyConfig(), 2)

  setTrustProxy('127.0.0.1, 10.0.0.0/8')
  assert.deepEqual(getTrustProxyConfig(), ['127.0.0.1', '10.0.0.0/8'])

  for (const disabledValue of [undefined, '', 'false', '0', 'no', 'off']) {
    setTrustProxy(disabledValue)
    assert.equal(getTrustProxyConfig(), false)
  }

  setTrustProxy('invalid')
  assert.equal(getTrustProxyConfig(), false, 'invalid TRUST_PROXY must fail closed')

  const appSource = readFileSync(fileURLToPath(new URL('../src/app.ts', import.meta.url)), 'utf8')
  assert.match(appSource, /trustProxy:\s*getTrustProxyConfig\(\)/, 'app must use the constrained trust proxy config')
  assert.doesNotMatch(appSource, /trustProxy:\s*getTrustProxyEnabled\(\)/)

  console.log('trust proxy config tests passed')
} finally {
  if (originalTrustProxy === undefined) {
    delete process.env.TRUST_PROXY
  } else {
    process.env.TRUST_PROXY = originalTrustProxy
  }

  if (originalTrustProxyHops === undefined) {
    delete process.env.TRUST_PROXY_HOPS
  } else {
    process.env.TRUST_PROXY_HOPS = originalTrustProxyHops
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
}
