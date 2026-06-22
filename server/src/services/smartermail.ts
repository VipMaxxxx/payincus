/**
 * SmarterMail API 集成服务
 * 负责邮箱账户的创建、删除、更新和密码重置
 */

import type { MailSource } from '@prisma/client'
import { assertSafeHttpUrl } from '../lib/outbound-security.js'
import { readLimitedTextResponse } from '../lib/http-response.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'

const SMARTERMAIL_API_TIMEOUT_MS = 30_000
const SMARTERMAIL_MAX_RESPONSE_BYTES = 1024 * 1024

async function getSmarterMailBaseUrl(source: MailSource): Promise<string> {
  const safeBaseUrl = await assertSafeHttpUrl(source.smarterMailUrl, 'SmarterMail URL')
  return safeBaseUrl.toString().replace(/\/+$/, '')
}

/**
 * 获取 SmarterMail API Token
 * 使用域管理员账号认证
 */
async function getAuthToken(
  domain: string,
  adminUsername: string,
  adminPassword: string,
  baseUrl: string
): Promise<string> {
  const email = `${adminUsername}@${domain}`
  
  const response = await fetch(`${baseUrl}/api/v1/auth/authenticate-user`, {
    method: 'POST',
    signal: AbortSignal.timeout(SMARTERMAIL_API_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: email,
      password: adminPassword
    }),
    redirect: 'manual'
  })

  if (!response.ok) {
    throw new Error(`SmarterMail auth error: ${response.status} ${response.statusText}`)
  }

  const result = await response.json() as { accessToken?: string; message?: string }
  
  if (!result.accessToken) {
    throw new Error(sanitizeTokensInString(result.message || 'Failed to get SmarterMail token'))
  }

  return result.accessToken
}

/**
 * 调用 SmarterMail API
 */
async function callApi(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  data?: any
): Promise<any> {
  const baseUrl = await getSmarterMailBaseUrl(source)
  const token = await getAuthToken(domain, adminUsername, adminPassword, baseUrl)
  
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method,
    signal: AbortSignal.timeout(SMARTERMAIL_API_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: data ? JSON.stringify(data) : undefined,
    redirect: 'manual'
  })

  if (!response.ok) {
    const error = sanitizeTokensInString(
      await readLimitedTextResponse(response, 'SmarterMail API error response', SMARTERMAIL_MAX_RESPONSE_BYTES)
    )
    throw new Error(`SmarterMail API error: ${response.status} - ${error}`)
  }

  // 某些 API 可能返回空响应
  const text = await readLimitedTextResponse(response, 'SmarterMail API response', SMARTERMAIL_MAX_RESPONSE_BYTES)
  if (!text) return {}
  
  return JSON.parse(text)
}

/**
 * 创建邮箱账户
 */
export async function createAccount(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  account: {
    username: string
    password: string
    displayName: string
    diskLimitMb: number
  }
): Promise<void> {
  await callApi(source, domain, adminUsername, adminPassword, 'POST', '/settings/domain/users/user-put', {
    userData: {
      userName: account.username,
      password: account.password,
      displayName: account.displayName,
      maxMailboxSize: account.diskLimitMb,
      domain: domain,
      isEnabled: true
    }
  })
}

/**
 * 更新邮箱账户
 */
export async function updateAccount(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  username: string,
  updates: {
    displayName?: string
    diskLimitMb?: number
  }
): Promise<void> {
  const data: any = {
    userData: {
      userName: username,
      domain: domain
    }
  }

  if (updates.displayName !== undefined) {
    data.userData.displayName = updates.displayName
  }
  if (updates.diskLimitMb !== undefined) {
    data.userData.maxMailboxSize = updates.diskLimitMb
  }

  await callApi(source, domain, adminUsername, adminPassword, 'POST', '/settings/domain/users/user-put', data)
}

/**
 * 重置邮箱账户密码
 */
export async function resetPassword(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  username: string,
  newPassword: string
): Promise<void> {
  await callApi(source, domain, adminUsername, adminPassword, 'POST', '/settings/domain/users/set-password', {
    userName: username,
    domain: domain,
    password: newPassword
  })
}

/**
 * 删除邮箱账户
 */
export async function deleteAccount(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  username: string
): Promise<void> {
  await callApi(source, domain, adminUsername, adminPassword, 'POST', '/settings/domain/users/user-delete', {
    userName: username,
    domain: domain
  })
}

/**
 * 获取邮箱账户信息
 */
export async function getAccountInfo(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string,
  username: string
): Promise<{
  email: string
  displayName: string
  diskLimitMb: number
  diskUsedMb: number
  isEnabled: boolean
} | null> {
  try {
    const result = await callApi(source, domain, adminUsername, adminPassword, 'POST', '/settings/domain/users/user-get', {
      userName: username,
      domain: domain
    })

    if (!result.userData) return null

    return {
      email: `${result.userData.userName}@${domain}`,
      displayName: result.userData.displayName || result.userData.userName,
      diskLimitMb: result.userData.maxMailboxSize || 0,
      diskUsedMb: result.userData.mailboxSizeUsed || 0,
      isEnabled: result.userData.isEnabled !== false
    }
  } catch {
    return null
  }
}

/**
 * 获取域下所有账户
 */
export async function listAccounts(
  source: MailSource,
  domain: string,
  adminUsername: string,
  adminPassword: string
): Promise<Array<{
  username: string
  email: string
  displayName: string
  diskLimitMb: number
  diskUsedMb: number
}>> {
  const result = await callApi(source, domain, adminUsername, adminPassword, 'GET', `/settings/domain/users/list?domain=${domain}`, undefined)

  if (!result.users || !Array.isArray(result.users)) {
    return []
  }

  return result.users.map((user: any) => ({
    username: user.userName,
    email: `${user.userName}@${domain}`,
    displayName: user.displayName || user.userName,
    diskLimitMb: user.maxMailboxSize || 0,
    diskUsedMb: user.mailboxSizeUsed || 0
  }))
}
