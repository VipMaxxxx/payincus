import '../src/config/env.js'
// @ts-ignore - bcryptjs has its own types in this project setup
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import {
  createUser,
  deleteUser,
  enable2FA,
  findUserByUsername,
  save2FASecret,
  updateUserStatus
} from '../src/db/users.js'
import { closePrismaDatabase } from '../src/db/prisma.js'
import { encryptSensitiveData, generate2FASecret } from '../src/lib/security.js'

type JsonObject = Record<string, unknown>

interface FetchResult<T = JsonObject> {
  response: Response
  data: T
  text: string
}

const backendUrl = trimSlash(process.env.SMOKE_BACKEND_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3001')
const frontendUrl = trimSlash(process.env.SMOKE_FRONTEND_URL || process.env.FRONTEND_URL || 'http://127.0.0.1:3000')
const apiBaseUrl = trimSlash(process.env.SMOKE_API_BASE_URL || frontendUrl)
const adminUsername = process.env.SMOKE_ADMIN_USERNAME || 'admin'
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123')
const smokeUserAgent = 'incudal-split-smoke/1.0'
const temporaryUserPassword = 'SmokeUser123'

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function fail(message: string): never {
  throw new Error(`[smoke-split-auth] ${message}`)
}

async function fetchJson<T = JsonObject>(url: string, init?: RequestInit): Promise<FetchResult<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'User-Agent': smokeUserAgent,
      ...(init?.headers || {})
    }
  })
  const text = await response.text()
  let data: T
  try {
    data = text ? JSON.parse(text) as T : {} as T
  } catch {
    data = {} as T
  }
  return { response, data, text }
}

function getCookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || ''
  const cookie = setCookie.split(',').map(part => part.trim()).find(part => part.startsWith('refreshToken='))
  if (!cookie) {
    fail('login response did not set refreshToken cookie')
  }
  return cookie.split(';')[0]
}

function requireOk(name: string, result: FetchResult, expectedStatus = 200): void {
  if (result.response.status !== expectedStatus) {
    fail(`${name} expected HTTP ${expectedStatus}, got ${result.response.status}: ${result.text.slice(0, 300)}`)
  }
}

function requireStatus(name: string, result: FetchResult, expectedStatus: number): void {
  if (result.response.status !== expectedStatus) {
    fail(`${name} expected HTTP ${expectedStatus}, got ${result.response.status}: ${result.text.slice(0, 300)}`)
  }
}

function requireField<T>(data: JsonObject, field: string, predicate: (value: unknown) => value is T, message: string): T {
  const value = data[field]
  if (!predicate(value)) {
    fail(message)
  }
  return value
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const temporaryUserIds: number[] = []

  async function cleanupTemporaryUser(): Promise<void> {
    for (const temporaryUserId of temporaryUserIds.reverse()) {
      try {
        await deleteUser(temporaryUserId)
      } catch (error) {
        console.warn('[smoke-split-auth] failed to clean up temporary user', {
          temporaryUserId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  try {
    if (!adminPassword) {
      fail('SMOKE_ADMIN_PASSWORD or ADMIN_PASSWORD must be set')
    }

    const backendHealth = await fetchJson(`${backendUrl}/api/health`)
    requireOk('backend /api/health', backendHealth)
    if ((backendHealth.data as JsonObject).status !== 'ok') {
      fail('backend /api/health did not return status=ok')
    }

    const proxiedHealth = await fetchJson(`${frontendUrl}/api/health`)
    requireOk('frontend proxied /api/health', proxiedHealth)
    if ((proxiedHealth.data as JsonObject).status !== 'ok') {
      fail('frontend proxied /api/health did not return status=ok')
    }

    const anonymousAdmin = await fetchJson(`${apiBaseUrl}/api/users`)
    requireStatus('anonymous admin boundary', anonymousAdmin, 401)

    const invalidMe = await fetchJson(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: 'Bearer invalid-token'
      }
    })
    requireStatus('invalid token /api/auth/me', invalidMe, 401)

    const temporaryUsername = `smoke-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const passwordHash = await bcrypt.hash(temporaryUserPassword, 12)
    const temporaryUserId = await createUser(
      temporaryUsername,
      `${temporaryUsername}@incudal-smoke.local`,
      passwordHash,
      'user'
    )
    temporaryUserIds.push(temporaryUserId)
    const temporaryUser = await findUserByUsername(temporaryUsername)
    if (!temporaryUser || temporaryUser.role !== 'user' || temporaryUser.status !== 'active') {
      fail('temporary ordinary user was not created as an active user')
    }

    const bannedUsername = `smoke-banned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const bannedUserId = await createUser(
      bannedUsername,
      `${bannedUsername}@incudal-smoke.local`,
      passwordHash,
      'user'
    )
    temporaryUserIds.push(bannedUserId)
    await updateUserStatus(bannedUserId, 'banned', 'Smoke banned account')

    const bannedTwoFactorPrecheck = await fetchJson(`${apiBaseUrl}/api/auth/check-2fa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: bannedUsername })
    })
    requireOk('banned user /api/auth/check-2fa', bannedTwoFactorPrecheck)
    if ((bannedTwoFactorPrecheck.data as JsonObject).requires2FA !== false) {
      fail('banned user /api/auth/check-2fa must not disclose 2FA status')
    }

    const bannedLogin = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: bannedUsername,
        password: temporaryUserPassword
      })
    })
    requireStatus('banned user login', bannedLogin, 403)
    if (typeof (bannedLogin.data as JsonObject).token === 'string') {
      fail('banned user login must not return an access token')
    }

    const twoFactorUsername = `smoke-2fa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const twoFactorUserId = await createUser(
      twoFactorUsername,
      `${twoFactorUsername}@incudal-smoke.local`,
      passwordHash,
      'user'
    )
    temporaryUserIds.push(twoFactorUserId)
    const twoFactorSecret = generate2FASecret()
    await save2FASecret(twoFactorUserId, encryptSensitiveData(twoFactorSecret))
    await enable2FA(twoFactorUserId)

    const twoFactorPrecheck = await fetchJson(`${apiBaseUrl}/api/auth/check-2fa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: twoFactorUsername })
    })
    requireOk('2FA user /api/auth/check-2fa', twoFactorPrecheck)
    if ((twoFactorPrecheck.data as JsonObject).requires2FA !== true) {
      fail('2FA user /api/auth/check-2fa must disclose 2FA requirement for active accounts')
    }

    const missingTwoFactorLogin = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: twoFactorUsername,
        password: temporaryUserPassword
      })
    })
    requireStatus('2FA user login without code', missingTwoFactorLogin, 401)
    if (typeof (missingTwoFactorLogin.data as JsonObject).token === 'string') {
      fail('2FA user login without code must not return an access token')
    }

    const invalidTwoFactorLogin = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: twoFactorUsername,
        password: temporaryUserPassword,
        totpCode: '000000'
      })
    })
    requireStatus('2FA user login with invalid code', invalidTwoFactorLogin, 401)
    if (typeof (invalidTwoFactorLogin.data as JsonObject).token === 'string') {
      fail('2FA user login with invalid code must not return an access token')
    }

    let validTwoFactorLogin: FetchResult | null = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const validTotpCode = authenticator.generate(twoFactorSecret)
      validTwoFactorLogin = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: twoFactorUsername,
          password: temporaryUserPassword,
          totpCode: validTotpCode
        })
      })
      if (validTwoFactorLogin.response.status !== 401 || attempt === 2) {
        break
      }
      await delay(1000)
    }
    if (!validTwoFactorLogin) {
      fail('2FA user login with valid code was not attempted')
    }
    requireOk('2FA user login with valid code', validTwoFactorLogin)
    const twoFactorToken = requireField(validTwoFactorLogin.data as JsonObject, 'token', isString, '2FA user login did not return access token')
    const twoFactorCookieHeader = getCookieHeader(validTwoFactorLogin.response)

    const twoFactorLogout = await fetchJson(`${apiBaseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${twoFactorToken}`,
        Cookie: twoFactorCookieHeader
      }
    })
    requireOk('2FA user logout', twoFactorLogout)

    const ordinaryLogin = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: temporaryUsername,
        password: temporaryUserPassword
      })
    })
    requireOk('ordinary user login', ordinaryLogin)
    const ordinaryToken = requireField(ordinaryLogin.data as JsonObject, 'token', isString, 'ordinary user login did not return access token')
    const ordinaryLoginUser = requireField(ordinaryLogin.data as JsonObject, 'user', isObject, 'ordinary user login did not return user')
    if (ordinaryLoginUser.role !== 'user') {
      fail(`ordinary user login returned unexpected role: ${String(ordinaryLoginUser.role)}`)
    }
    const ordinaryCookieHeader = getCookieHeader(ordinaryLogin.response)

    const ordinaryAdminBoundary = await fetchJson(`${apiBaseUrl}/api/users?page=1&pageSize=1`, {
      headers: {
        Authorization: `Bearer ${ordinaryToken}`,
        Cookie: ordinaryCookieHeader
      }
    })
    requireStatus('ordinary user admin boundary', ordinaryAdminBoundary, 403)

    const ordinaryLogout = await fetchJson(`${apiBaseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ordinaryToken}`,
        Cookie: ordinaryCookieHeader
      }
    })
    requireOk('ordinary user logout', ordinaryLogout)

    const login = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword
      })
    })
    requireOk('admin login', login)
    const token = requireField(login.data as JsonObject, 'token', isString, 'admin login did not return access token')
    const loginUser = requireField(login.data as JsonObject, 'user', isObject, 'admin login did not return user')
    if (loginUser.role !== 'admin') {
      fail(`admin login returned unexpected role: ${String(loginUser.role)}`)
    }
    const cookieHeader = getCookieHeader(login.response)

    const me = await fetchJson(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: cookieHeader
      }
    })
    requireOk('/api/auth/me', me)
    const meUser = requireField(me.data as JsonObject, 'user', isObject, '/api/auth/me did not return user')
    if (meUser.role !== 'admin') {
      fail(`/api/auth/me returned unexpected role: ${String(meUser.role)}`)
    }

    const adminUsers = await fetchJson(`${apiBaseUrl}/api/users?page=1&pageSize=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: cookieHeader
      }
    })
    requireOk('admin /api/users', adminUsers)
    if (!Array.isArray((adminUsers.data as JsonObject).users)) {
      fail('admin /api/users did not return users array')
    }

    const refresh = await fetchJson(`${apiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader
      }
    })
    requireOk('/api/auth/refresh', refresh)
    requireField(refresh.data as JsonObject, 'token', isString, '/api/auth/refresh did not return access token')

    const logout = await fetchJson(`${apiBaseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: cookieHeader
      }
    })
    requireOk('/api/auth/logout', logout)

    const refreshAfterLogout = await fetchJson(`${apiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader
      }
    })
    requireStatus('refresh after logout', refreshAfterLogout, 401)

    console.log('[smoke-split-auth] passed', {
      backendUrl,
      frontendUrl,
      apiBaseUrl,
      adminUsername,
      ordinaryUserBoundary: '403',
      bannedUserLogin: '403',
      twoFactorLogin: 'ok'
    })
  } finally {
    await cleanupTemporaryUser()
    await closePrismaDatabase()
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
