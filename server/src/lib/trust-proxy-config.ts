export function getTrustProxyEnabled(): boolean {
  const configured = process.env.TRUST_PROXY?.trim().toLowerCase()

  if (!configured) {
    return false
  }

  if (['true', '1', 'yes', 'on'].includes(configured)) {
    return true
  }

  if (['false', '0', 'no', 'off'].includes(configured)) {
    return false
  }

  console.warn(`[Trust Proxy] Invalid TRUST_PROXY value: ${process.env.TRUST_PROXY}, proxy headers will not be trusted`)
  return false
}
