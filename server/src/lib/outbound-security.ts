import { lookup as dnsLookup } from 'dns/promises'
import { lookup as dnsLookupCb } from 'dns'
import { isIP, type LookupFunction } from 'net'
import { Agent } from 'undici'

export class OutboundTargetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundTargetValidationError'
  }
}

type SupportedProtocol = 'http' | 'https' | 'ftp' | 'sftp'

function buildUrl(input: string, defaultProtocol: SupportedProtocol): URL {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new OutboundTargetValidationError('Target cannot be empty')
  }

  try {
    if (trimmed.includes('://')) {
      return new URL(trimmed)
    }
    return new URL(`${defaultProtocol}://${trimmed}`)
  } catch {
    throw new OutboundTargetValidationError('Target format is invalid')
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, item) => (acc << 8) + Number(item), 0) >>> 0
}

function isIpv4InCidr(ip: string, baseIp: string, prefixLength: number): boolean {
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(baseIp)
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function normalizeIpv6(ip: string): string {
  return ip.toLowerCase().replace(/^\[|\]$/g, '')
}

function isIpv6PrivateOrReserved(ip: string): boolean {
  const normalized = normalizeIpv6(ip)

  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/i.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  ) {
    return true
  }

  const mappedIpv4Match = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mappedIpv4Match) {
    return isIpPrivateOrReserved(mappedIpv4Match[1])
  }

  return false
}

export function isIpPrivateOrReserved(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const ranges: Array<[string, number]> = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4]
    ]

    return ranges.some(([baseIp, prefixLength]) => isIpv4InCidr(ip, baseIp, prefixLength))
  }

  if (family === 6) {
    return isIpv6PrivateOrReserved(ip)
  }

  return true
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!normalizedHost) {
    throw new OutboundTargetValidationError('Hostname cannot be empty')
  }

  if (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.internal')
  ) {
    throw new OutboundTargetValidationError('Private or local targets are not allowed')
  }

  const family = isIP(normalizedHost)
  if (family !== 0) {
    if (isIpPrivateOrReserved(normalizedHost)) {
      throw new OutboundTargetValidationError('Private or reserved IP targets are not allowed')
    }
    return
  }

  if (!normalizedHost.includes('.')) {
    throw new OutboundTargetValidationError('Private or local hostnames are not allowed')
  }

  let records: Array<{ address: string }>
  try {
    records = await dnsLookup(normalizedHost, { all: true, verbatim: true })
  } catch (error: any) {
    const code = error?.code ? String(error.code) : 'UNKNOWN'
    throw new OutboundTargetValidationError(`Unable to resolve hostname (${code})`)
  }

  if (records.length === 0) {
    throw new OutboundTargetValidationError('Unable to resolve hostname')
  }

  for (const record of records) {
    if (isIpPrivateOrReserved(record.address)) {
      throw new OutboundTargetValidationError('Targets resolving to private or reserved IPs are not allowed')
    }
  }
}

export async function assertSafeWebhookUrl(url: string): Promise<URL> {
  return assertSafeHttpUrl(url, 'Webhook URL')
}

export async function assertSafeHttpUrl(url: string, label = 'URL'): Promise<URL> {
  const parsed = buildUrl(url, 'https')
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OutboundTargetValidationError(`${label} must use http or https`)
  }

  await assertPublicHostname(parsed.hostname)
  return parsed
}

/**
 * 连接期再校验的 DNS lookup：即使域名在“校验通过”与“真正发起连接”之间发生 DNS rebinding
 * （解析到内网/保留地址），也会在建立连接时被拒绝，从而消除 assertPublicHostname 之后的 TOCTOU 窗口。
 * 仅影响地址解析，不改变 TLS SNI（仍使用原始主机名），因此不破坏 HTTPS 证书校验。
 */
const revalidatingLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookupCb(hostname, { ...(options as object), all: true, verbatim: true }, (err, addresses) => {
    const cb = callback as (err: NodeJS.ErrnoException | null, address?: string, family?: number) => void
    if (err) {
      cb(err)
      return
    }
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0) {
      cb(new OutboundTargetValidationError('Unable to resolve hostname') as NodeJS.ErrnoException)
      return
    }
    for (const record of list) {
      if (isIpPrivateOrReserved(record.address)) {
        cb(new OutboundTargetValidationError('Target resolved to a private or reserved IP') as NodeJS.ErrnoException)
        return
      }
    }
    const first = list[0]
    cb(null, first.address, first.family)
  })
}

/**
 * 用于所有“已通过 assertSafe*Url 校验的外发请求”的 undici dispatcher。
 * 在 fetch(..., { dispatcher: safeOutboundDispatcher }) 中传入即可获得连接期防 rebinding 保护。
 */
export const safeOutboundDispatcher = new Agent({ connect: { lookup: revalidatingLookup } })

export async function assertSafeStorageTarget(
  type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3',
  host: string
): Promise<void> {
  const defaultProtocol: Record<'WEBDAV' | 'FTP' | 'SFTP' | 'S3', SupportedProtocol> = {
    WEBDAV: 'https',
    FTP: 'ftp',
    SFTP: 'sftp',
    S3: 'https'
  }

  const parsed = buildUrl(host, defaultProtocol[type])
  await assertPublicHostname(parsed.hostname)
}
