import type { PluginGatewayExtensionHook, PluginServiceExtensionHook } from './plugin-manifest.js'

export type PluginExtensionContractStatus = 'accepted' | 'pending' | 'completed' | 'failed' | 'unsupported'

export interface PluginExtensionContractResult {
  accepted: boolean
  status: PluginExtensionContractStatus
  message: string | null
  externalReference: string | null
  metadata: Record<string, unknown>
}

const EXTENSION_CONTRACT_METADATA_MAX_KEYS = 20
const EXTENSION_CONTRACT_TEXT_MAX_LENGTH = 240
const EXTENSION_CONTRACT_URL_MAX_LENGTH = 2048
const EXTENSION_CONTRACT_URL_METADATA_KEYS = new Set(['payUrl', 'paymentUrl', 'redirectUrl', 'checkoutUrl'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, EXTENSION_CONTRACT_TEXT_MAX_LENGTH)
}

function normalizeStatus(value: unknown): PluginExtensionContractStatus {
  return value === 'pending' || value === 'completed' || value === 'failed' || value === 'unsupported'
    ? value
    : 'accepted'
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(value).slice(0, EXTENSION_CONTRACT_METADATA_MAX_KEYS)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key)) continue
    if (rawValue === null || typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      const maxLength = EXTENSION_CONTRACT_URL_METADATA_KEYS.has(key)
        ? EXTENSION_CONTRACT_URL_MAX_LENGTH
        : EXTENSION_CONTRACT_TEXT_MAX_LENGTH
      result[key] = typeof rawValue === 'string' ? rawValue.slice(0, maxLength) : rawValue
    }
  }
  return result
}

export function normalizePluginExtensionContractResult(result: unknown): PluginExtensionContractResult {
  if (!isRecord(result)) {
    return {
      accepted: true,
      status: 'accepted',
      message: null,
      externalReference: null,
      metadata: {}
    }
  }
  const status = normalizeStatus(result.status)
  const accepted = typeof result.accepted === 'boolean'
    ? result.accepted
    : status !== 'failed' && status !== 'unsupported'
  return {
    accepted,
    status,
    message: normalizeText(result.message),
    externalReference: normalizeText(result.externalReference),
    metadata: normalizeMetadata(result.metadata)
  }
}

export function buildPluginServiceExtensionContractPayload(input: {
  hook: PluginServiceExtensionHook
  serviceExtensionKey: string
  productId: string | null
  payload: unknown
}): Record<string, unknown> {
  return {
    contractVersion: 1,
    contractKind: 'service-extension',
    hook: input.hook,
    serviceExtensionKey: input.serviceExtensionKey,
    productId: input.productId,
    payload: input.payload ?? null,
    expectedResult: {
      accepted: 'boolean',
      status: ['accepted', 'pending', 'completed', 'failed', 'unsupported'],
      message: 'string optional',
      externalReference: 'string optional',
      metadata: 'flat JSON object optional'
    }
  }
}

export function buildPluginGatewayExtensionContractPayload(input: {
  hook: PluginGatewayExtensionHook
  gatewayExtensionKey: string
  providerCode: string | null
  payload: unknown
}): Record<string, unknown> {
  return {
    contractVersion: 1,
    contractKind: 'gateway-extension',
    hook: input.hook,
    gatewayExtensionKey: input.gatewayExtensionKey,
    providerCode: input.providerCode,
    payload: input.payload ?? null,
    expectedResult: {
      accepted: 'boolean',
      status: ['accepted', 'pending', 'completed', 'failed', 'unsupported'],
      message: 'string optional',
      externalReference: 'string optional',
      metadata: 'flat JSON object optional'
    }
  }
}
