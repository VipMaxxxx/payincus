import { decryptSensitiveData, encryptSensitiveData } from './security.js'

export interface RechargeProviderConfigSnapshot {
  type: string
  config: Record<string, unknown>
  capturedAt: string
}

export function buildRechargeProviderConfigSnapshot(
  type: string,
  config: Record<string, unknown>
): string {
  return encryptSensitiveData(JSON.stringify({
    type,
    config,
    capturedAt: new Date().toISOString()
  }))
}

export function parseRechargeProviderConfigSnapshot(
  value: unknown
): RechargeProviderConfigSnapshot | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const decrypted = decryptSensitiveData(value)
    if (!decrypted) {
      return null
    }

    const parsed = JSON.parse(decrypted) as RechargeProviderConfigSnapshot
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.type !== 'string' ||
      !parsed.config ||
      typeof parsed.config !== 'object' ||
      Array.isArray(parsed.config)
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function resolveRechargeProviderConfigSnapshot(
  providerType: string,
  currentConfig: Record<string, unknown>,
  snapshotValue: unknown
): { config: Record<string, unknown>; source: 'snapshot' | 'provider' } {
  const snapshot = parseRechargeProviderConfigSnapshot(snapshotValue)
  if (snapshot && snapshot.type === providerType) {
    return { config: snapshot.config, source: 'snapshot' }
  }

  return { config: currentConfig, source: 'provider' }
}
