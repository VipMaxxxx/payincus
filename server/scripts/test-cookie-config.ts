import assert from 'node:assert/strict'
import {
  getCookieSameSite,
  getCookieSecure,
  getRefreshTokenCookieOptions
} from '../src/lib/cookie-config.js'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearCookieEnv(): void {
  delete process.env.COOKIE_SECURE
  delete process.env.COOKIE_SAME_SITE
  delete process.env.COOKIE_DOMAIN
}

try {
  clearCookieEnv()
  process.env.NODE_ENV = 'production'
  assert.equal(getCookieSecure(), true, 'production cookies must default to Secure=true')
  assert.equal(getCookieSameSite(), 'lax', 'production cookies must default to SameSite=lax')

  process.env.COOKIE_SECURE = 'false'
  assert.equal(getCookieSecure(), false, 'COOKIE_SECURE=false must support HTTP intranet split deployments')
  assert.equal(getRefreshTokenCookieOptions().secure, false, 'refresh token cookie must honor COOKIE_SECURE=false')

  process.env.COOKIE_SAME_SITE = 'none'
  assert.equal(getCookieSameSite(), 'lax', 'SameSite=none must fall back without Secure=true')

  process.env.COOKIE_SECURE = 'true'
  assert.equal(getCookieSameSite(), 'none', 'SameSite=none is valid when Secure=true')

  process.env.COOKIE_DOMAIN = '.example.com'
  const options = getRefreshTokenCookieOptions()
  assert.equal(options.secure, true)
  assert.equal(options.sameSite, 'none')
  assert.equal(options.domain, '.example.com')

  clearCookieEnv()
  process.env.NODE_ENV = 'development'
  assert.equal(getCookieSecure(), false, 'development cookies must default to Secure=false')
  assert.equal(getCookieSameSite(), 'strict', 'development cookies must default to SameSite=strict')

  console.log('cookie config tests passed')
} finally {
  restoreEnv()
}
