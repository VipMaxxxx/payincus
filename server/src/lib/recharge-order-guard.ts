export function normalizeRechargeGatewayOrderNo(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function isRechargeGatewayOrderNoMatch(expectedOrderNo: string, gatewayOrderNo: unknown): boolean {
  return normalizeRechargeGatewayOrderNo(gatewayOrderNo) === expectedOrderNo
}
