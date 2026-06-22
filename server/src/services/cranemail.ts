/**
 * CraneMail Reseller API 集成服务
 * 负责域名的创建、删除、暂停、恢复和状态查询
 */

import type { MailSource } from '@prisma/client'
import { sanitizeObject, sanitizeTokensInString } from '../lib/log-sanitizer.js'
import { assertSafeHttpUrl } from '../lib/outbound-security.js'
import { readLimitedTextResponse } from '../lib/http-response.js'

const CRANEMAIL_API_TIMEOUT_MS = 30_000
const CRANEMAIL_MAX_RESPONSE_BYTES = 1024 * 1024

interface CraneMailResponse {
  // 新版 API 格式
  status?: boolean
  errors?: Record<string, string>
  // 旧版 API 格式
  result?: 'success' | 'error'
  error?: string
  info?: any
  // 通用数据字段
  [key: string]: any
}

/**
 * 调用 CraneMail API
 */
async function callApi(source: MailSource, action: string, data: Record<string, any>): Promise<any> {
  // 构建 API URL： https://namecrane.com/index.php?m=cranemail&action=api/{action}
  const safeBaseUrl = await assertSafeHttpUrl(source.apiUrl, 'CraneMail API URL')
  const baseUrl = safeBaseUrl.toString().replace(/\/+$/, '') // 移除末尾斜杠
  const apiUrl = `${baseUrl}/index.php?m=cranemail&action=api/${action}`
  
  const bodyData = new URLSearchParams(data).toString()
  
  console.log(`[CraneMail] Calling API: ${apiUrl}`)
  console.log('[CraneMail] Request payload:', sanitizeObject({ action, data }))
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(CRANEMAIL_API_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-API-KEY': source.apiKey
    },
    body: bodyData,
    redirect: 'manual'
  })

  const responseText = await readLimitedTextResponse(response, 'CraneMail API response', CRANEMAIL_MAX_RESPONSE_BYTES)
  console.log(`[CraneMail] Response status: ${response.status}`)

  if (!response.ok) {
    console.error(`[CraneMail] API error: ${response.status} ${response.statusText}`)
    throw new Error(`CraneMail API error: ${response.status} ${response.statusText}`)
  }

  let result: CraneMailResponse
  try {
    result = JSON.parse(responseText) as CraneMailResponse
  } catch {
    console.error('[CraneMail] Invalid JSON response', {
      action,
      status: response.status,
      bodyLength: responseText.length
    })
    throw new Error('CraneMail API returned invalid JSON')
  }

  console.log('[CraneMail] Response payload:', sanitizeObject({ action, result }))
  
  // 处理新版 API 格式 {status: boolean, errors?: {...}}
  if (result.status === false) {
    const errorMsg = result.errors 
      ? Object.entries(sanitizeObject(result.errors)).map(([k, v]) => `${k}: ${String(v)}`).join('; ')
      : 'Unknown error'
    console.error(`[CraneMail] API returned error: ${errorMsg}`)
    throw new Error(errorMsg)
  }
  
  // 处理旧版 API 格式 {result: 'success'|'error', error?: string}
  if (result.result === 'error') {
    const sanitizedError = sanitizeTokensInString(result.error || 'Unknown CraneMail API error')
    console.error(`[CraneMail] API returned error: ${sanitizedError}`)
    throw new Error(sanitizedError)
  }

  // 新版 API 数据在 data 字段，旧版在 info 字段
  return result.data || result.info || result
}

/**
 * 创建域名
 * @returns 返回管理员账号和密码
 */
export async function createDomain(
  source: MailSource,
  domain: string,
  diskLimitGb: number
): Promise<{ username?: string; password?: string; server?: string }> {
  const result = await callApi(source, 'domain/create', {
    domain,
    disklimit: diskLimitGb.toString(),
    userlimit: '0', // 无限用户
    useraliaslimit: '0',
    domainaliaslimit: '0',
    maxusers: '0', // 备用参数名
    maxuseraliases: '0', // 备用参数名
    spamexperts: 'true',
    spamexperts_adminaccess: 'all', // 必需参数，有效值: 'primary' | 'all'
    filestorage: 'true',
    office: 'true'
  })

  // API 返回格式: {status: true, username: "postmaster@domain.com", password: "xxx", server: "xxx"}
  return {
    username: result?.username,
    password: result?.password,
    server: result?.server
  }
}

/**
 * 获取域名信息（包含验证状态）
 */
export async function getDomainInfo(source: MailSource, domain: string): Promise<{
  verified: boolean
  txtRecord?: string
  dnsRecords?: Array<{ type: string; record: string; value: string; prio?: number }>
  mxRecords?: string[]
  spfRecord?: string
  dkimRecord?: string
  cnameRecords?: Array<{ record: string; value: string }>
  diskUsedMb?: number
}> {
  const result = await callApi(source, 'domain/info', { domain })

  // 解析验证状态 - status 可能是数字 0/1 或布尔值
  const verifiedStatus = result?.verified?.status
  const verified = verifiedStatus === true || verifiedStatus === 'true' || verifiedStatus === 1 || verifiedStatus === '1'
  
  // DNS 记录是数组格式 [{type, record, value, prio?}]
  const dnsArray: Array<{ type: string; record: string; value: string; prio?: number }> = result?.dns || []
  
  // 添加 workspace-verification TXT 记录（从 verified.txt 解析）
  if (result?.verified?.txt) {
    dnsArray.unshift({
      type: 'TXT',
      record: 'workspace-verification',
      value: result.verified.txt
    })
  }
  
  // 添加 DMARC TXT 记录（固定值）
  dnsArray.push({
    type: 'TXT',
    record: '_dmarc',
    value: 'v=DMARC1; p=none; sp=none'
  })
  
  // 添加 DKIM TXT 记录（从 dkim 字段解析，仅在验证成功后显示）
  if (verified && result?.dkim?.selector && result?.dkim?.key) {
    dnsArray.push({
      type: 'TXT',
      record: result.dkim.selector,
      value: `v=DKIM1; k=rsa; p=${result.dkim.key}`
    })
  }
  
  // 提取各类型 DNS 记录
  const mxRecords = dnsArray
    .filter(r => r.type === 'MX')
    .map(r => r.prio ? `${r.prio} ${r.value}` : r.value)
  
  const spfRecord = dnsArray.find(r => r.type === 'TXT' && r.value?.includes('spf'))?.value
  const dkimRecord = dnsArray.find(r => r.type === 'TXT' && r.record?.includes('dkim'))?.value
  
  const cnameRecords = dnsArray
    .filter(r => r.type === 'CNAME')
    .map(r => ({ record: r.record, value: r.value }))
  
  return {
    verified,
    txtRecord: result?.verified?.txt,
    dnsRecords: dnsArray,
    mxRecords,
    spfRecord,
    dkimRecord,
    cnameRecords,
    diskUsedMb: result?.diskusage ? parseInt(result.diskusage) : 0
  }
}

/**
 * 删除域名
 */
export async function deleteDomain(source: MailSource, domain: string): Promise<void> {
  await callApi(source, 'domain/delete', { domain })
}

/**
 * 暂停域名
 */
export async function suspendDomain(source: MailSource, domain: string): Promise<void> {
  await callApi(source, 'domain/suspend', { domain })
}

/**
 * 恢复域名
 */
export async function unsuspendDomain(source: MailSource, domain: string): Promise<void> {
  await callApi(source, 'domain/unsuspend', { domain })
}

/**
 * 修改域名配置
 */
export async function modifyDomain(
  source: MailSource,
  domain: string,
  options: {
    diskLimitGb?: number
    userLimit?: number
  }
): Promise<void> {
  const data: Record<string, string> = { domain }
  
  if (options.diskLimitGb !== undefined) {
    data.disklimit = options.diskLimitGb.toString()
  }
  if (options.userLimit !== undefined) {
    data.userlimit = options.userLimit.toString()
  }

  await callApi(source, 'domain/modify', data)
}
