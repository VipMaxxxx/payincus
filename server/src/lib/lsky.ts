import { getSystemConfig } from '../db/system-config.js'
import { sanitizeTokensInString } from './log-sanitizer.js'
import { assertSafeHttpUrl } from './outbound-security.js'

export type LskyApiVersion = 'v1' | 'v2'
const LSKY_UPLOAD_TIMEOUT_MS = 60_000
const LSKY_DELETE_TIMEOUT_MS = 15_000
const LSKY_GROUP_TIMEOUT_MS = 15_000
const LSKY_STORAGE_CACHE_TTL_MS = 5 * 60_000
const lskyStorageIdCache = new Map<string, { storageId: string; fetchedAt: number }>()
const ALLOWED_LSKY_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
])

export interface TicketImageLskyConfig {
  baseUrl: string
  token: string
  apiVersion: LskyApiVersion
  targetId: string | null
}

export interface LskyTicketImageUploadInput {
  buffer: Buffer
  filename: string
  contentType: string
  sizeBytes: number
}

export interface LskyTicketImageUploadResult {
  provider: 'lsky'
  providerVersion: LskyApiVersion
  providerFileId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  url: string
  thumbnailUrl: string | null
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function resolveLskyApiBase(baseUrl: string, apiVersion: LskyApiVersion): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const apiPrefix = apiVersion === 'v2' ? '/api/v2' : '/api/v1'

  if (normalized.toLowerCase().endsWith(apiPrefix)) {
    return normalized
  }

  return `${normalized}${apiPrefix}`
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = asNullableString(value)
    if (str) {
      return str
    }
  }

  return null
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function normalizeAllowedImageMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  return normalized && ALLOWED_LSKY_IMAGE_MIME_TYPES.has(normalized) ? normalized : null
}

function parseJsonResponse(text: string): unknown {
  const normalizedText = text.replace(/^\uFEFF/, '')
  if (!normalizedText.trim()) {
    return null
  }

  try {
    return JSON.parse(normalizedText)
  } catch {
    return null
  }
}

function sanitizeResponsePreview(text: string): string {
  return sanitizeTokensInString(text.slice(0, 500))
}

function extractUrlFromHtmlSnippet(html: string | null): string | null {
  if (!html) {
    return null
  }

  const srcMatch = html.match(/src="([^"]+)"/i)
  if (srcMatch?.[1]) {
    return srcMatch[1]
  }

  const markdownMatch = html.match(/\((https?:\/\/[^)]+)\)/i)
  if (markdownMatch?.[1]) {
    return markdownMatch[1]
  }

  return null
}

function joinUrl(baseUrl: string, pathname: string | null): string | null {
  const normalizedPath = asNullableString(pathname)?.replace(/^\/+/, '')
  if (!normalizedPath) {
    return null
  }

  return `${normalizeBaseUrl(baseUrl)}/${normalizedPath}`
}

function pickProviderFileId(...values: unknown[]): string | null {
  const picked = pickString(...values)
  return picked?.replace(/^\/+/, '') ?? null
}

function extractLskyErrorMessage(payload: any, fallback: string): string {
  return pickString(
    payload?.message,
    payload?.msg,
    payload?.error?.message,
    payload?.error,
    payload?.errors?.[0]?.message
  ) || fallback
}

function extractUploadDataCandidates(payload: any): any[] {
  const candidates = [
    payload?.data?.data,
    payload?.data?.photo,
    payload?.data?.image,
    payload?.data,
    payload?.result?.data,
    payload?.result?.photo,
    payload?.result,
    payload
  ]

  return candidates.filter(candidate => candidate && typeof candidate === 'object')
}

function buildLskyAuthHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`
  }
}

async function fetchLskyDefaultStorageId(config: TicketImageLskyConfig): Promise<string> {
  const apiBase = resolveLskyApiBase(config.baseUrl, 'v2')
  const cacheKey = `${apiBase}:${config.token}`
  const cached = lskyStorageIdCache.get(cacheKey)
  if (cached && (Date.now() - cached.fetchedAt) < LSKY_STORAGE_CACHE_TTL_MS) {
    return cached.storageId
  }

  const groupUrl = `${apiBase}/group`
  const response = await fetch(groupUrl, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(LSKY_GROUP_TIMEOUT_MS),
    headers: buildLskyAuthHeaders(config.token)
  })

  const responseText = await response.text()
  const payload: any = parseJsonResponse(responseText)

  if (!response.ok || payload?.status === false) {
    throw new Error(extractLskyErrorMessage(payload, `Failed to fetch Lsky group info with status ${response.status}`))
  }

  const storages = Array.isArray(payload?.data?.storages) ? payload.data.storages : []
  const firstStorage = storages.find((item: any) => item && (typeof item.id === 'number' || typeof item.id === 'string'))
  const storageId = firstStorage ? String(firstStorage.id) : ''

  if (!storageId) {
    console.error('[Lsky] Unable to determine default storage_id from /group response', {
      groupUrl,
      status: response.status,
      bodyPreview: sanitizeResponsePreview(responseText)
    })
    throw new Error('Unable to determine Lsky storage_id automatically from /group')
  }

  lskyStorageIdCache.set(cacheKey, {
    storageId,
    fetchedAt: Date.now()
  })

  return storageId
}

export async function getTicketImageLskyConfig(): Promise<TicketImageLskyConfig | null> {
  const [baseUrl, token, apiVersionValue, targetId] = await Promise.all([
    getSystemConfig('ticket_image_lsky_base_url'),
    getSystemConfig('ticket_image_lsky_token'),
    getSystemConfig('ticket_image_lsky_api_version'),
    getSystemConfig('ticket_image_lsky_target_id')
  ])

  const normalizedBaseUrl = asNullableString(baseUrl)
  const normalizedToken = asNullableString(token)
  if (!normalizedBaseUrl || !normalizedToken) {
    return null
  }

  const apiVersion: LskyApiVersion = apiVersionValue === 'v2' ? 'v2' : 'v1'
  const safeBaseUrl = await assertSafeHttpUrl(normalizedBaseUrl, 'Lsky base URL')

  return {
    baseUrl: normalizeBaseUrl(safeBaseUrl.toString()),
    token: normalizedToken,
    apiVersion,
    targetId: asNullableString(targetId)
  }
}

export async function uploadTicketImageToLsky(
  input: LskyTicketImageUploadInput
): Promise<LskyTicketImageUploadResult> {
  const config = await getTicketImageLskyConfig()
  if (!config) {
    throw new Error('Lsky image bed is not configured')
  }

  const resolvedTargetId = config.apiVersion === 'v2'
    ? (config.targetId || await fetchLskyDefaultStorageId(config))
    : config.targetId

  const formData = new FormData()
  formData.append(
    'file',
    new Blob([input.buffer], { type: input.contentType }),
    input.filename
  )

  if (resolvedTargetId) {
    if (config.apiVersion === 'v2') {
      formData.append('storage_id', resolvedTargetId)
    } else {
      formData.append('strategy_id', resolvedTargetId)
    }
  }

  const uploadUrl = `${resolveLskyApiBase(config.baseUrl, config.apiVersion)}/upload`

  const response = await fetch(uploadUrl, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(LSKY_UPLOAD_TIMEOUT_MS),
    headers: buildLskyAuthHeaders(config.token),
    body: formData
  })

  const responseText = await response.text()
  const payload: any = parseJsonResponse(responseText)

  if (!payload) {
    console.error('[Lsky] Upload returned non-JSON response', {
      uploadUrl,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyPreview: sanitizeResponsePreview(responseText)
    })
  }

  if (!response.ok || payload?.status === false) {
    throw new Error(extractLskyErrorMessage(payload, `Lsky upload failed with status ${response.status}`))
  }

  const dataCandidates = extractUploadDataCandidates(payload)

  let resolvedData: any = null
  let url: string | null = null
  let thumbnailUrl: string | null = null
  for (const candidate of dataCandidates) {
    const links = candidate?.links ?? {}
    const candidateUrl = pickString(
      candidate?.url,
      candidate?.public_url,
      links?.url,
      links?.raw_url,
      extractUrlFromHtmlSnippet(asNullableString(links?.html)),
      extractUrlFromHtmlSnippet(asNullableString(links?.markdown)),
      joinUrl(config.baseUrl, pickString(candidate?.pathname, candidate?.path))
    )

    if (candidateUrl) {
      resolvedData = candidate
      url = candidateUrl
      thumbnailUrl = pickString(
        candidate?.thumbnail_url,
        links?.thumbnail_url,
        candidateUrl
      )
      break
    }
  }

  if (!url) {
    console.error('[Lsky] Upload succeeded but no image URL was returned', {
      uploadUrl,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyPreview: sanitizeResponsePreview(responseText),
      responseKeys: payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>) : [],
      dataCandidateKeys: dataCandidates.map(candidate => Object.keys(candidate as Record<string, unknown>))
    })
    throw new Error('Lsky upload succeeded but no image URL was returned')
  }

  const safeImageUrl = await assertSafeHttpUrl(url, 'Lsky image URL')
  const safeThumbnailUrl = thumbnailUrl
    ? (await assertSafeHttpUrl(thumbnailUrl, 'Lsky thumbnail URL')).toString()
    : null

  const data = resolvedData ?? dataCandidates[0] ?? {}
  const mimeType = normalizeAllowedImageMimeType(pickString(data?.mimetype, data?.mime_type, input.contentType))
    ?? normalizeAllowedImageMimeType(input.contentType)
  if (!mimeType) {
    throw new Error('Lsky upload returned unsupported image MIME type')
  }

  return {
    provider: 'lsky',
    providerVersion: config.apiVersion,
    providerFileId: config.apiVersion === 'v2'
      ? pickProviderFileId(data?.id, data?.key, data?.hash, data?.pathname, data?.path)
      : pickProviderFileId(data?.key, data?.id, data?.hash, data?.pathname, data?.path),
    filename: pickString(data?.name, data?.filename, input.filename) || input.filename,
    originalName: input.filename,
    mimeType,
    sizeBytes: pickNumber(data?.size, data?.file_size, input.sizeBytes) || input.sizeBytes,
    width: pickNumber(data?.width),
    height: pickNumber(data?.height),
    url: safeImageUrl.toString(),
    thumbnailUrl: safeThumbnailUrl
  }
}

export async function deleteTicketImageFromLsky(providerVersion: string, providerFileId: string | null): Promise<boolean> {
  if (!providerFileId) {
    return false
  }

  const config = await getTicketImageLskyConfig()
  if (!config) {
    return false
  }

  const apiBase = resolveLskyApiBase(config.baseUrl, providerVersion === 'v2' ? 'v2' : 'v1')
  const deleteUrl = providerVersion === 'v2'
    ? `${apiBase}/user/photos/${encodeURIComponent(providerFileId)}`
    : `${apiBase}/images/${encodeURIComponent(providerFileId)}`
  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    redirect: 'manual',
    signal: AbortSignal.timeout(LSKY_DELETE_TIMEOUT_MS),
    headers: buildLskyAuthHeaders(config.token)
  })

  return response.ok
}
