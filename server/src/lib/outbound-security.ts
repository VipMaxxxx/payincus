import { lookup as dnsLookup } from 'dns/promises'
import { isIP } from 'net'

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
  const parsed = buildUrl(url, 'https')
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OutboundTargetValidationError('Webhook URL must use http or https')
  }

  await assertPublicHostname(parsed.hostname)
  return parsed
}

export async function assertSafeStorageTarget(
  type: 'WEBDAV' | 'FTP' | 'SFTP',
  host: string
): Promise<void> {
  const defaultProtocol: Record<'WEBDAV' | 'FTP' | 'SFTP', SupportedProtocol> = {
    WEBDAV: 'https',
    FTP: 'ftp',
    SFTP: 'sftp'
  }

  const parsed = buildUrl(host, defaultProtocol[type])
  await assertPublicHostname(parsed.hostname)
}
