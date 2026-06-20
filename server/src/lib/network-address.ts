import { isIP } from 'net'

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME'

export function normalizeNetworkHost(value: string): string {
  const trimmed = value.trim()

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (inner.includes(':')) {
      return inner
    }
  }

  return trimmed
}

export function getAddressFamily(value: string): 0 | 4 | 6 {
  return isIP(normalizeNetworkHost(value)) as 0 | 4 | 6
}

export function isIpLiteral(value: string): boolean {
  return getAddressFamily(value) !== 0
}

export function formatHostForUrl(value: string): string {
  const normalized = normalizeNetworkHost(value)
  return getAddressFamily(normalized) === 6 ? `[${normalized}]` : normalized
}

export function formatHostForListen(value: string): string {
  return formatHostForUrl(value)
}

export function extractHostAddressFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return normalizeNetworkHost(url.hostname)
  } catch {
    return null
  }
}

export function selectBindableIpv4ListenAddress(
  explicitBindIpv4: string | null | undefined,
  fallbackPublicIpv4: string | null | undefined,
  _hostUrl: string | null | undefined,
  hostIpAddress: string | null | undefined
): string {
  const explicit = explicitBindIpv4 ? normalizeNetworkHost(explicitBindIpv4) : ''
  if (getAddressFamily(explicit) === 4) {
    return explicit
  }

  const localCandidates = new Set<string>()
  const normalizedHostIpAddress = hostIpAddress ? normalizeNetworkHost(hostIpAddress) : null
  const fallback = fallbackPublicIpv4 ? normalizeNetworkHost(fallbackPublicIpv4) : ''

  if (getAddressFamily(fallback) !== 4) {
    return '0.0.0.0'
  }

  if (normalizedHostIpAddress && getAddressFamily(normalizedHostIpAddress) === 4) {
    localCandidates.add(normalizedHostIpAddress)
  }

  return localCandidates.has(fallback) ? fallback : '0.0.0.0'
}

/**
 * 判断地址是否为 IPv6
 * 用于端口映射时检测 listen/connect IP 版本是否一致，
 * 纯 IPv6 宿主机的 listen 地址为 IPv6，connect 地址为 IPv4 时需禁用内核态 NAT
 */
export function isIpv6Address(value: string): boolean {
  return getAddressFamily(value) === 6
}

export function getDnsRecordType(value: string): DnsRecordType {
  const family = getAddressFamily(value)

  if (family === 4) {
    return 'A'
  }

  if (family === 6) {
    return 'AAAA'
  }

  return 'CNAME'
}
