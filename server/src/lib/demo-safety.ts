import type { FastifyRequest } from 'fastify'

const DEMO_HOSTS = new Set(['demo.payincus.com', 'demoadmin.payincus.com'])
const DEMO_USERNAMES = new Set(['admin', 'demo'])
const DEMO_EMAILS = new Set(['admin@payincus.com', 'demo@payincus.com'])

export const DEMO_REDACTED_IP = '已隐藏'
export const DEMO_ACCOUNT_PROTECTED_MESSAGE = 'Demo account credentials cannot be changed'
export const DEMO_READ_ONLY_MESSAGE = 'Demo site is read-only'

const DEMO_ALLOWED_MUTATIONS = new Set([
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/refresh'
])

const SENSITIVE_KEY_PARTS = [
  'password',
  'passwordhash',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'publickey',
  'webhook',
  'merchantkey',
  'merchantsecret',
  'clientsecret',
  'botkey',
  'bottoken',
  'sshkey',
  'credential'
]

const SENSITIVE_IP_KEYS = new Set([
  'ip',
  'ipv4',
  'ipv6',
  'ipaddress',
  'clientip',
  'remoteip',
  'loginip',
  'publicip',
  'bindip',
  'natpublicip',
  'natbindip',
  'hostname',
  'hostaddress',
  'sshhost',
  'sshport'
])

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

type DemoAccountCandidate = {
  username?: string | null
  email?: string | null
}

type LoginRecordLike = {
  id: number
  ip: string
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  timezone: string | null
  userAgent: string | null
  createdAt: Date
}

type DemoNotificationData = Record<string, unknown> | null

type DemoInboxMessageLike = {
  eventType: string
  content: string
  data: DemoNotificationData
}

function normalizeHost(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw || '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase()
}

export function isDemoRequest(request: FastifyRequest): boolean {
  const forwardedHost = normalizeHost(request.headers['x-forwarded-host'])
  const host = normalizeHost(request.headers.host)
  return DEMO_HOSTS.has(forwardedHost) || DEMO_HOSTS.has(host)
}

export function isDemoMutationAllowed(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0]
  return DEMO_ALLOWED_MUTATIONS.has(`${request.method.toUpperCase()} ${path}`)
}

export function shouldBlockDemoMutation(request: FastifyRequest): boolean {
  if (!isDemoRequest(request)) return false
  if (!request.url.startsWith('/api/')) return false

  const method = request.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false

  return !isDemoMutationAllowed(request)
}

export function isDemoAccount(candidate: DemoAccountCandidate | null | undefined): boolean {
  const username = candidate?.username?.toLowerCase() || ''
  const email = candidate?.email?.toLowerCase() || ''
  return DEMO_USERNAMES.has(username) || DEMO_EMAILS.has(email)
}

export function shouldProtectDemoAccount(
  request: FastifyRequest,
  candidate: DemoAccountCandidate | null | undefined
): boolean {
  return isDemoRequest(request) && isDemoAccount(candidate)
}

export function shouldRedactDemoLoginRecords(
  request: FastifyRequest,
  candidate: DemoAccountCandidate | null | undefined
): boolean {
  return shouldProtectDemoAccount(request, candidate)
}

export function redactDemoLoginRecord<T extends LoginRecordLike>(record: T): T {
  return {
    ...record,
    ip: DEMO_REDACTED_IP,
    country: null,
    region: null,
    city: null,
    isp: null,
    timezone: null,
    userAgent: null
  }
}

export function redactDemoLoginNotificationContent(content: string): string {
  return content
    .replace(/[\u0001\u0002]/g, '\n')
    .replace(/(^|\n)\s*设备:[^\n]*(\n|$)/g, '$1')
    .replace(/(^|\n)\s*IP:[^\n]*(\n|$)/g, `$1IP: ${DEMO_REDACTED_IP}$2`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function redactDemoLoginNotificationData(data: DemoNotificationData): DemoNotificationData {
  if (!data) return data

  return {
    ...data,
    deviceInfo: null,
    ipAddress: DEMO_REDACTED_IP
  }
}

export function redactDemoInboxMessage<T extends DemoInboxMessageLike>(message: T): T {
  if (message.eventType !== 'login_new_device') return message

  return {
    ...message,
    content: redactDemoLoginNotificationContent(message.content),
    data: redactDemoLoginNotificationData(message.data)
  }
}

function isSensitiveDemoKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase()
  if (SENSITIVE_IP_KEYS.has(normalized)) return true
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part))
}

function redactDemoStringValue(value: string): string {
  return value
    .replace(IPV4_PATTERN, DEMO_REDACTED_IP)
    .replace(EMAIL_PATTERN, DEMO_REDACTED_IP)
}

function redactDemoJsonValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 12) return value

  if (key && isSensitiveDemoKey(key)) {
    return DEMO_REDACTED_IP
  }

  if (typeof value === 'string') {
    return redactDemoStringValue(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactDemoJsonValue(item, '', depth + 1))
  }

  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactDemoJsonValue(entryValue, entryKey, depth + 1)
    }
    return redacted
  }

  return value
}

export function redactDemoJsonPayload(payload: unknown): unknown {
  return redactDemoJsonValue(payload)
}
