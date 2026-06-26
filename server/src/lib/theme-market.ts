import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { getThemeStagingDir } from './theme-package.js'
import { getCurrentVersionMetadata } from './system-version.js'
import {
  getThemeMarketIndexUrl as getConfiguredThemeMarketIndexUrl,
  getThemeMarketTrustedHosts
} from './runtime-settings.js'

export type ThemeMarketReviewStatus = 'pending' | 'listed' | 'delisted' | 'rejected'
export type ThemeMarketTrustLevel = 'official' | 'verified' | 'third_party'

export interface ThemeMarketDeveloper {
  name: string
  homepage?: string
  github?: string
  verified: boolean
  contact?: string
}

export interface ThemeMarketCompatibility {
  minPayincus?: string
  maxPayincus?: string
}

export interface ThemeMarketSecurity {
  checksumPinned: boolean
  signature?: {
    status: 'unsigned' | 'valid' | 'missing' | 'invalid'
    algorithm?: string
    keyId?: string
  }
  notes: string[]
}

export interface ThemeMarketEntry {
  id: string
  name: string
  latest: string
  manifestUrl: string
  downloadUrl: string
  sha256: string
  description?: string
  author?: string
  previewImageUrl?: string
  reviewStatus: ThemeMarketReviewStatus
  trustLevel: ThemeMarketTrustLevel
  developer: ThemeMarketDeveloper
  compatibility: ThemeMarketCompatibility
  security: ThemeMarketSecurity
  tokens: string[]
  layoutSlots: string[]
  rating: { average: number; count: number }
  installCount: number
  releaseNotes?: string
  rollbackNotes?: string
}

export interface ThemeMarketIndex {
  themes: ThemeMarketEntry[]
  governance: {
    totalEntries: number
    visibleEntries: number
    hiddenEntries: number
    indexHost: string | null
    fingerprint: string
    defaultReviewStatus: ThemeMarketReviewStatus
    installPolicy: string[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function pickBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function pickStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => pickString(item, maxLength))
    .filter((item): item is string => !!item)
}

export async function getThemeMarketIndexUrl(): Promise<string | null> {
  return pickString(await getConfiguredThemeMarketIndexUrl(), 500)
}

function assertTrustedThemeMarketUrl(input: string, purpose: 'index' | 'download', trustedHosts: Set<string>): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:') throw new Error('Theme market URL must use HTTPS')
  const host = url.hostname.toLowerCase()
  if (!trustedHosts.has(host)) {
    throw new Error('Theme market URL host is not trusted')
  }

  if (host === 'github.com' && !url.pathname.includes('/releases/download/')) {
    throw new Error('GitHub theme URL must point to a release asset')
  }

  if (host === 'raw.githubusercontent.com' && purpose === 'download') {
    throw new Error('Raw GitHub URLs may only be used for theme market indexes')
  }

  if (host === 'objects.githubusercontent.com') return url

  if ((host === 'payincus.com' || host === 'payincus.github.io') && purpose === 'index') {
    if (!url.pathname.endsWith('/theme-market/index.json')) {
      throw new Error('Stable theme market index must use /theme-market/index.json')
    }
  }

  if ((host === 'payincus.com' || host === 'payincus.github.io') && purpose === 'download') {
    if (!url.pathname.startsWith('/theme-market/packages/') && !url.pathname.startsWith('/theme-market/manifests/')) {
      throw new Error('Stable theme market assets must be under /theme-market/packages or /theme-market/manifests')
    }
  }

  return url
}

function normalizeDeveloper(input: unknown, fallbackName: string): ThemeMarketDeveloper {
  const record = isRecord(input) ? input : {}
  return {
    name: pickString(record.name, 120) || fallbackName,
    homepage: pickString(record.homepage, 500) ?? undefined,
    github: pickString(record.github, 500) ?? undefined,
    verified: pickBoolean(record.verified),
    contact: pickString(record.contact, 200) ?? undefined
  }
}

function normalizeCompatibility(input: unknown): ThemeMarketCompatibility {
  const record = isRecord(input) ? input : {}
  return {
    minPayincus: pickString(record.minPayincus, 64) ?? undefined,
    maxPayincus: pickString(record.maxPayincus, 64) ?? undefined
  }
}

function normalizeSecurity(input: unknown): ThemeMarketSecurity {
  const record = isRecord(input) ? input : {}
  const signature = isRecord(record.signature)
    ? {
        status: pickEnum(record.signature.status, ['unsigned', 'valid', 'missing', 'invalid'] as const, 'unsigned'),
        algorithm: pickString(record.signature.algorithm, 60) ?? undefined,
        keyId: pickString(record.signature.keyId, 120) ?? undefined
      }
    : { status: 'unsigned' as const }
  return {
    checksumPinned: pickBoolean(record.checksumPinned, true),
    signature,
    notes: pickStringArray(record.notes, 10, 240)
  }
}

function normalizeEntry(input: unknown, trustedHosts: Set<string>): ThemeMarketEntry | null {
  if (!isRecord(input)) return null
  const id = pickString(input.id, 120)
  const name = pickString(input.name, 120)
  const latest = pickString(input.latest, 64)
  const manifestUrl = pickString(input.manifestUrl, 500)
  const downloadUrl = pickString(input.downloadUrl, 500)
  const sha256 = pickString(input.sha256, 64)
  if (!id || !name || !latest || !manifestUrl || !downloadUrl || !sha256) return null
  assertTrustedThemeMarketUrl(manifestUrl, 'download', trustedHosts)
  assertTrustedThemeMarketUrl(downloadUrl, 'download', trustedHosts)
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null
  const reviewStatus = pickEnum(input.reviewStatus, ['pending', 'listed', 'delisted', 'rejected'] as const, 'pending')
  const trustLevel = pickEnum(input.trustLevel, ['official', 'verified', 'third_party'] as const, 'third_party')
  const author = pickString(input.author, 120) ?? undefined
  return {
    id,
    name,
    latest,
    manifestUrl,
    downloadUrl,
    sha256: sha256.toLowerCase(),
    description: pickString(input.description, 500) ?? undefined,
    author,
    previewImageUrl: pickString(input.previewImageUrl, 500) ?? undefined,
    reviewStatus,
    trustLevel,
    developer: normalizeDeveloper(input.developer, author || name),
    compatibility: normalizeCompatibility(input.compatibility),
    security: normalizeSecurity(input.security),
    tokens: pickStringArray(input.tokens, 80, 120),
    layoutSlots: pickStringArray(input.layoutSlots, 80, 120),
    rating: {
      average: pickNumber(isRecord(input.rating) ? input.rating.average : undefined, 0, 0, 5),
      count: Math.floor(pickNumber(isRecord(input.rating) ? input.rating.count : undefined, 0, 0, 1_000_000))
    },
    installCount: Math.floor(pickNumber(input.installCount, 0, 0, 1_000_000_000)),
    releaseNotes: pickString(input.releaseNotes, 1000) ?? undefined,
    rollbackNotes: pickString(input.rollbackNotes, 1000) ?? undefined
  }
}

function normalizeVersionParts(version: string | undefined): [number, number, number] | null {
  if (!version) return null
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: string | undefined, right: string | undefined): number {
  const a = normalizeVersionParts(left)
  const b = normalizeVersionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function getThemeMarketFingerprint(entries: ThemeMarketEntry[]): string {
  const stablePayload = entries.map(entry => ({
    id: entry.id,
    latest: entry.latest,
    reviewStatus: entry.reviewStatus,
    trustLevel: entry.trustLevel,
    downloadUrl: entry.downloadUrl,
    sha256: entry.sha256,
    compatibility: entry.compatibility,
    tokens: entry.tokens,
    layoutSlots: entry.layoutSlots
  }))
  return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex')
}

export async function fetchThemeMarketIndex(url?: string | null): Promise<ThemeMarketIndex> {
  const effectiveUrl = url ?? await getThemeMarketIndexUrl()
  if (!effectiveUrl) {
    return {
      themes: [],
      governance: {
        totalEntries: 0,
        visibleEntries: 0,
        hiddenEntries: 0,
        indexHost: null,
        fingerprint: getThemeMarketFingerprint([]),
        defaultReviewStatus: 'pending',
        installPolicy: ['stable theme index only', 'listed entries only', 'SHA256 required', 'theme package validation required']
      }
    }
  }

  const trustedHosts = await getThemeMarketTrustedHosts()
  const parsed = assertTrustedThemeMarketUrl(effectiveUrl, 'index', trustedHosts)
  const response = await fetch(parsed, {
    headers: { 'user-agent': 'payincus-theme-center' }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch theme market index: HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  const normalized = isRecord(payload) && Array.isArray(payload.themes)
    ? payload.themes.map(entry => normalizeEntry(entry, trustedHosts)).filter((entry): entry is ThemeMarketEntry => !!entry)
    : []
  const themes = normalized.filter(entry => entry.reviewStatus === 'listed')
  return {
    themes,
    governance: {
      totalEntries: normalized.length,
      visibleEntries: themes.length,
      hiddenEntries: normalized.length - themes.length,
      indexHost: parsed.hostname,
      fingerprint: getThemeMarketFingerprint(normalized),
      defaultReviewStatus: 'pending',
      installPolicy: ['stable theme index only', 'listed entries only', 'SHA256 required', 'theme package validation required']
    }
  }
}

export async function assertThemeMarketEntryInstallable(entry: ThemeMarketEntry): Promise<void> {
  if (entry.reviewStatus !== 'listed') {
    throw new Error('Theme market entry is not listed for installation')
  }
  if (!entry.security.checksumPinned) {
    throw new Error('Theme market entry must pin a SHA256 checksum')
  }
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error('Theme market entry has an invalid SHA256 checksum')
  }
  const current = await getCurrentVersionMetadata()
  const currentVersion = current.gitTag || current.version
  if (entry.compatibility.minPayincus && compareVersions(currentVersion, entry.compatibility.minPayincus) < 0) {
    throw new Error(`Theme requires PayIncus ${entry.compatibility.minPayincus} or later`)
  }
  if (entry.compatibility.maxPayincus && compareVersions(currentVersion, entry.compatibility.maxPayincus) > 0) {
    throw new Error(`Theme supports PayIncus up to ${entry.compatibility.maxPayincus}`)
  }
}

export async function downloadMarketTheme(entry: ThemeMarketEntry): Promise<string> {
  await assertThemeMarketEntryInstallable(entry)
  assertTrustedThemeMarketUrl(entry.downloadUrl, 'download', await getThemeMarketTrustedHosts())
  const response = await fetch(entry.downloadUrl, {
    headers: { 'user-agent': 'payincus-theme-center' }
  })
  if (!response.ok) {
    throw new Error(`Failed to download theme package: HTTP ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const actualSha256 = createHash('sha256').update(buffer).digest('hex')
  if (actualSha256 !== entry.sha256.toLowerCase()) {
    throw new Error('Theme package SHA256 mismatch')
  }
  const dir = join(getThemeStagingDir(), 'downloads')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${entry.id}-${entry.latest}-${randomUUID()}.tar.gz`)
  await writeFile(path, buffer, { mode: 0o600 })
  return path
}
