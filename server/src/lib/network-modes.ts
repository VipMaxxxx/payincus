export type NetworkMode =
  | 'nat'
  | 'nat_ipv6'
  | 'nat_ipv6_nat'
  | 'ipv6_only'
  | 'ipv6_nat'
  | 'public_ipv4'
  | 'public_ipv4_ipv6'

export const ACTIVE_PACKAGE_NETWORK_MODES: NetworkMode[] = [
  'nat',
  'nat_ipv6',
  'ipv6_only',
  'public_ipv4',
  'public_ipv4_ipv6'
]

export const LEGACY_IPV6_NAT_NETWORK_MODES = new Set<NetworkMode>([
  'nat_ipv6_nat',
  'ipv6_nat'
])

export function normalizeNetworkMode(value: string | null | undefined): NetworkMode {
  switch (value) {
    case 'nat_ipv6':
    case 'nat_ipv6_nat':
    case 'ipv6_only':
    case 'ipv6_nat':
    case 'public_ipv4':
    case 'public_ipv4_ipv6':
      return value
    default:
      return 'nat'
  }
}

export function networkModeNeedsNatIpv4(mode: string | null | undefined): boolean {
  const normalized = normalizeNetworkMode(mode)
  return normalized === 'nat' || normalized === 'nat_ipv6' || normalized === 'nat_ipv6_nat'
}

export function networkModeNeedsPublicIpv4(mode: string | null | undefined): boolean {
  const normalized = normalizeNetworkMode(mode)
  return normalized === 'public_ipv4' || normalized === 'public_ipv4_ipv6'
}

export function networkModeNeedsRoutedIpv6(mode: string | null | undefined): boolean {
  const normalized = normalizeNetworkMode(mode)
  return normalized === 'nat_ipv6' || normalized === 'ipv6_only' || normalized === 'public_ipv4_ipv6'
}

export function networkModeAllowsPortMapping(mode: string | null | undefined): boolean {
  return networkModeNeedsNatIpv4(mode)
}
