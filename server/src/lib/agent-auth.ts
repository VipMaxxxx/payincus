import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { IncomingHttpHeaders } from 'http'

export const agentTimestampWindowMs = 5 * 60 * 1000
export const agentNonceTtlMs = 10 * 60 * 1000

export interface AgentAuthHeaders {
  agentId: string
  timestamp: string
  nonce: string
  bodyHash: string
  signature: string
}

export interface AgentSigningPayload {
  method: string
  path: string
  timestamp: string
  nonce: string
  bodyHash: string
}

const agentIdPattern = /^agt_[A-Za-z0-9_-]{24,64}$/
const secretPattern = /^ias_[A-Za-z0-9_-]{32,96}$/
const noncePattern = /^[A-Za-z0-9._:-]{8,128}$/
const sha256HexPattern = /^[a-f0-9]{64}$/i

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = normalizeJsonValue(item)
      return normalized === undefined ? null : normalized
    })
  }

  const objectValue = value as Record<string, unknown>
  const normalizedObject: Record<string, unknown> = {}
  for (const key of Object.keys(objectValue).sort()) {
    const normalized = normalizeJsonValue(objectValue[key])
    if (normalized !== undefined) {
      normalizedObject[key] = normalized
    }
  }
  return normalizedObject
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) {
    return false
  }
  return timingSafeEqual(aBuffer, bBuffer)
}

export function generateAgentId(): string {
  return `agt_${randomBytes(24).toString('base64url')}`
}

export function generateAgentSecret(): string {
  return `ias_${randomBytes(32).toString('base64url')}`
}

export function isValidAgentId(value: string): boolean {
  return agentIdPattern.test(value)
}

export function isValidAgentSecret(value: string): boolean {
  return secretPattern.test(value)
}

export function hashAgentSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function stableStringifyAgentBody(body: unknown): string {
  const normalized = normalizeJsonValue(body)
  return JSON.stringify(normalized === undefined ? null : normalized)
}

export function createAgentBodyHash(body: unknown): string {
  return createHash('sha256').update(stableStringifyAgentBody(body)).digest('hex')
}

export function buildAgentSigningPayload(payload: AgentSigningPayload): string {
  return [
    payload.method.toUpperCase(),
    payload.path,
    payload.timestamp,
    payload.nonce,
    payload.bodyHash.toLowerCase()
  ].join('\n')
}

export function createAgentSignature(secret: string, payload: AgentSigningPayload): string {
  return createHmac('sha256', secret).update(buildAgentSigningPayload(payload)).digest('hex')
}

export function verifyAgentSignature(secret: string, payload: AgentSigningPayload, signature: string): boolean {
  if (!sha256HexPattern.test(signature)) {
    return false
  }

  const expected = createAgentSignature(secret, payload)
  return safeTimingEqual(expected, signature.toLowerCase())
}

export function readAgentAuthHeaders(headers: IncomingHttpHeaders): AgentAuthHeaders | null {
  const agentId = getHeaderValue(headers['x-incudal-agent-id'])
  const timestamp = getHeaderValue(headers['x-incudal-timestamp'])
  const nonce = getHeaderValue(headers['x-incudal-nonce'])
  const bodyHash = getHeaderValue(headers['x-incudal-body-sha256'])
  const signature = getHeaderValue(headers['x-incudal-signature'])

  if (!agentId || !timestamp || !nonce || !bodyHash || !signature) {
    return null
  }

  return {
    agentId,
    timestamp,
    nonce,
    bodyHash,
    signature
  }
}

export function validateAgentHeaders(headers: AgentAuthHeaders): string | null {
  if (!isValidAgentId(headers.agentId)) {
    return 'invalid agent id'
  }
  if (!/^\d{13}$/.test(headers.timestamp)) {
    return 'invalid timestamp'
  }
  if (!noncePattern.test(headers.nonce)) {
    return 'invalid nonce'
  }
  if (!sha256HexPattern.test(headers.bodyHash)) {
    return 'invalid body hash'
  }
  if (!sha256HexPattern.test(headers.signature)) {
    return 'invalid signature'
  }
  return null
}

export function isAgentTimestampFresh(timestamp: string, nowMs = Date.now()): boolean {
  const timestampMs = Number(timestamp)
  if (!Number.isSafeInteger(timestampMs)) {
    return false
  }
  return Math.abs(nowMs - timestampMs) <= agentTimestampWindowMs
}
