import assert from 'node:assert/strict'
import { getTrustProxyEnabled } from '../src/lib/trust-proxy-config.js'

const originalTrustProxy = process.env.TRUST_PROXY
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

  setTrustProxy('true')
  assert.equal(getTrustProxyEnabled(), true)

  setTrustProxy('1')
  assert.equal(getTrustProxyEnabled(), true)

  setTrustProxy('yes')
  assert.equal(getTrustProxyEnabled(), true)

  setTrustProxy('false')
  assert.equal(getTrustProxyEnabled(), false)

  setTrustProxy('0')
  assert.equal(getTrustProxyEnabled(), false)

  setTrustProxy('invalid')
  assert.equal(getTrustProxyEnabled(), false, 'invalid TRUST_PROXY must fail closed')

  console.log('trust proxy config tests passed')
} finally {
  if (originalTrustProxy === undefined) {
    delete process.env.TRUST_PROXY
  } else {
    process.env.TRUST_PROXY = originalTrustProxy
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
}
