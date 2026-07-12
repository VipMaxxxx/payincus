import { isIP } from 'node:net'

export type TrustProxyConfig = boolean | number | string[]

const ENABLED_VALUES = ['true', '1', 'yes', 'on']
const DISABLED_VALUES = ['false', '0', 'no', 'off']

function getConfiguredHops(): number {
  const configured = process.env.TRUST_PROXY_HOPS?.trim()

  if (configured && /^\d+$/.test(configured)) {
    const hops = Number(configured)
    if (Number.isSafeInteger(hops) && hops > 0) {
      return hops
    }
  }

  return 1
}

function isValidProxyAddress(value: string): boolean {
  const slashIndex = value.lastIndexOf('/')
  if (slashIndex === -1) {
    return isIP(value) !== 0
  }

  const address = value.slice(0, slashIndex)
  const prefix = value.slice(slashIndex + 1)
  const ipVersion = isIP(address)
  if (ipVersion === 0 || !/^\d+$/.test(prefix)) {
    return false
  }

  const prefixLength = Number(prefix)
  return prefixLength >= 0 && prefixLength <= (ipVersion === 4 ? 32 : 128)
}

export function getTrustProxyConfig(): TrustProxyConfig {
  const rawValue = process.env.TRUST_PROXY
  const configured = rawValue?.trim().toLowerCase()

  if (!configured) {
    return false
  }

  if (DISABLED_VALUES.includes(configured)) {
    return false
  }

  if (ENABLED_VALUES.includes(configured)) {
    return getConfiguredHops()
  }

  if (/^\d+$/.test(configured)) {
    const hops = Number(configured)
    if (Number.isSafeInteger(hops) && hops > 0) {
      return hops
    }
  }

  const trustedAddresses = configured.split(',').map(value => value.trim())
  if (trustedAddresses.length > 0 && trustedAddresses.every(isValidProxyAddress)) {
    return trustedAddresses
  }

  console.warn(`[Trust Proxy] Invalid TRUST_PROXY value: ${rawValue}, proxy headers will not be trusted`)
  return false
}

export function getTrustProxyEnabled(): boolean {
  return getTrustProxyConfig() !== false
}
