import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { getPluginStagingDir } from './plugin-package.js'
import { getCurrentVersionMetadata } from './system-version.js'
import { parsePluginManifest } from './plugin-manifest.js'
import {
  getPluginMarketIndexUrl as getConfiguredPluginMarketIndexUrl,
  getPluginMarketTrustedHosts
} from './runtime-settings.js'

const PLUGIN_MARKET_TRUSTED_HOSTS_ENV = 'PLUGIN_MARKET_TRUSTED_HOSTS'

export type PluginMarketReviewStatus = 'pending' | 'listed' | 'delisted' | 'rejected'
export type PluginMarketTrustLevel = 'official' | 'verified' | 'third_party'
export type PluginMarketPricingType = 'free' | 'paid'
export const PLUGIN_MARKET_SUPPORTED_CURRENCIES = ['CNY', 'USD'] as const
export const PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT = 20

export interface PluginMarketDeveloper {
  name: string
  homepage?: string
  github?: string
  verified: boolean
  contact?: string
}

export interface PluginMarketPermissions {
  adminPages: string[]
  userPages: string[]
  api: string[]
  storage: string[]
}

export interface PluginMarketCompatibility {
  payincus: string
  minPayincus?: string
  maxPayincus?: string
}

export interface PluginMarketSecurity {
  checksumPinned: boolean
  signature?: {
    status: 'unsigned' | 'valid' | 'missing' | 'invalid'
    algorithm?: string
    keyId?: string
  }
  notes: string[]
}

export interface PluginMarketPricing {
  type: PluginMarketPricingType
  price?: number
  currency?: string
  revenueSharePercent?: number | null
}

export interface PluginMarketEntry {
  id: string
  name: string
  latest: string
  repo: string
  manifestUrl: string
  downloadUrl: string
  sha256: string
  description?: string
  author?: string
  reviewStatus: PluginMarketReviewStatus
  trustLevel: PluginMarketTrustLevel
  developer: PluginMarketDeveloper
  permissions: PluginMarketPermissions
  compatibility: PluginMarketCompatibility
  security: PluginMarketSecurity
  pricing: PluginMarketPricing
  rating: { average: number; count: number }
  installCount: number
  releaseNotes?: string
  upgradeNotes?: string
  rollbackNotes?: string
}

export interface PluginMarketIndex {
  plugins: PluginMarketEntry[]
  governance: {
    totalEntries: number
    visibleEntries: number
    hiddenEntries: number
    indexHost: string | null
    fingerprint: string
    defaultReviewStatus: PluginMarketReviewStatus
    installPolicy: string[]
    unavailableReason?: string
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

function pickStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => pickString(item, maxLength))
    .filter((item): item is string => !!item)
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

export async function getPluginMarketIndexUrl(): Promise<string | null> {
  return pickString(await getConfiguredPluginMarketIndexUrl(), 500)
}

function assertTrustedMarketUrl(input: string, purpose: 'index' | 'download', trustedHosts: Set<string>): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:') throw new Error('Plugin market URL must use HTTPS')
  const host = url.hostname.toLowerCase()
  if (!trustedHosts.has(host)) {
    throw new Error(`Plugin market URL host is not trusted; configure ${PLUGIN_MARKET_TRUSTED_HOSTS_ENV}`)
  }

  if (host === 'github.com' && !url.pathname.includes('/releases/download/')) {
    throw new Error('GitHub plugin URL must point to a release asset')
  }

  if (host === 'raw.githubusercontent.com' && purpose === 'download') {
    throw new Error('Raw GitHub URLs may only be used for plugin market indexes')
  }

  if (host === 'objects.githubusercontent.com') return url

  if ((host === 'payincus.com' || host === 'payincus.github.io') && purpose === 'index') {
    if (!url.pathname.endsWith('/plugin-market/index.json')) {
      throw new Error('Stable plugin market index must use /plugin-market/index.json')
    }
  }

  if ((host === 'payincus.com' || host === 'payincus.github.io') && purpose === 'download') {
    if (!url.pathname.startsWith('/plugin-market/packages/') && !url.pathname.startsWith('/plugin-market/manifests/')) {
      throw new Error('Stable plugin market assets must be under /plugin-market/packages or /plugin-market/manifests')
    }
  }

  return url
}

export async function assertGitHubReleaseUrl(input: string): Promise<URL> {
  return assertTrustedMarketUrl(input, 'download', await getPluginMarketTrustedHosts())
}

function assertGitHubIndexUrl(input: string, trustedHosts: Set<string>): URL {
  return assertTrustedMarketUrl(input, 'index', trustedHosts)
}

function normalizeDeveloper(input: unknown, fallbackName: string): PluginMarketDeveloper {
  const record = isRecord(input) ? input : {}
  return {
    name: pickString(record.name, 120) || fallbackName,
    homepage: pickString(record.homepage, 500) ?? undefined,
    github: pickString(record.github, 500) ?? undefined,
    verified: pickBoolean(record.verified),
    contact: pickString(record.contact, 200) ?? undefined
  }
}

function normalizePermissions(input: unknown): PluginMarketPermissions {
  const record = isRecord(input) ? input : {}
  return {
    adminPages: pickStringArray(record.adminPages, 30, 160),
    userPages: pickStringArray(record.userPages, 30, 160),
    api: pickStringArray(record.api, 80, 160),
    storage: pickStringArray(record.storage, 30, 160)
  }
}

export function normalizePluginMarketCompatibility(input: unknown): PluginMarketCompatibility {
  const record = isRecord(input) ? input : {}
  const payincus = pickString(record.payincus, 80)
  if (!payincus) throw new Error('manifest.payincus compatibility range is required')

  const exact = /^v?(\d+\.\d+\.\d+)$/.exec(payincus)
  if (exact) {
    return { payincus, minPayincus: exact[1], maxPayincus: exact[1] }
  }

  const comparators = payincus.split(/\s+/).filter(Boolean)
  let minPayincus: string | undefined
  let maxPayincus: string | undefined
  for (const comparator of comparators) {
    const match = /^(>=|<=)v?(\d+\.\d+\.\d+)$/.exec(comparator)
    if (!match) throw new Error('manifest.payincus must use an exact version and/or inclusive >= / <= bounds')
    if (match[1] === '>=') {
      if (minPayincus) throw new Error('manifest.payincus must declare at most one minimum version')
      minPayincus = match[2]
    } else {
      if (maxPayincus) throw new Error('manifest.payincus must declare at most one maximum version')
      maxPayincus = match[2]
    }
  }
  if (!minPayincus && !maxPayincus) throw new Error('manifest.payincus compatibility range is invalid')
  if (minPayincus && maxPayincus && compareVersions(minPayincus, maxPayincus) > 0) {
    throw new Error('manifest.payincus minimum version cannot exceed maximum version')
  }
  return {
    payincus,
    minPayincus,
    maxPayincus
  }
}

function normalizeSecurity(input: unknown): PluginMarketSecurity {
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

export function normalizePluginMarketPricing(input: unknown): PluginMarketPricing {
  const record = isRecord(input) ? input : {}
  const type = record.type === undefined ? 'free' : record.type
  if (type !== 'free' && type !== 'paid') throw new Error('Plugin pricing type must be free or paid')
  if (type === 'free') return { type: 'free', revenueSharePercent: null }

  if (!Number.isSafeInteger(record.price) || (record.price as number) <= 0) {
    throw new Error('Paid plugin price must be a positive integer in the currency minimum unit')
  }
  const currency = typeof record.currency === 'string' ? record.currency.trim().toUpperCase() : ''
  if (!PLUGIN_MARKET_SUPPORTED_CURRENCIES.includes(currency as typeof PLUGIN_MARKET_SUPPORTED_CURRENCIES[number])) {
    throw new Error(`Paid plugin currency must be one of: ${PLUGIN_MARKET_SUPPORTED_CURRENCIES.join(', ')}`)
  }
  if (record.revenueSharePercent !== undefined && record.revenueSharePercent !== PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT) {
    throw new Error(`Paid plugin revenue share is fixed at ${PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT}%`)
  }
  return {
    type: 'paid',
    price: record.price as number,
    currency,
    revenueSharePercent: PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT
  }
}

async function normalizeEntry(input: unknown, trustedHosts: Set<string>): Promise<PluginMarketEntry | null> {
  if (!isRecord(input)) return null
  const id = pickString(input.id, 120)
  const name = pickString(input.name, 120)
  const latest = pickString(input.latest, 64)
  const repo = pickString(input.repo, 160)
  const manifestUrl = pickString(input.manifestUrl, 500)
  const downloadUrl = pickString(input.downloadUrl, 500)
  const sha256 = pickString(input.sha256, 64)
  if (!id || !name || !latest || !repo || !manifestUrl || !downloadUrl || !sha256) return null
  const trustedManifestUrl = assertTrustedMarketUrl(manifestUrl, 'download', trustedHosts)
  assertTrustedMarketUrl(downloadUrl, 'download', trustedHosts)
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null
  const reviewStatus = pickEnum(input.reviewStatus, ['pending', 'listed', 'delisted', 'rejected'] as const, 'pending')
  const trustLevel = pickEnum(input.trustLevel, ['official', 'verified', 'third_party'] as const, 'third_party')
  const author = pickString(input.author, 120) ?? undefined
  let compatibility: PluginMarketCompatibility
  let pricing: PluginMarketPricing
  try {
    const manifestResponse = await fetch(trustedManifestUrl, {
      headers: { 'user-agent': 'payincus-plugin-center' }
    })
    if (!manifestResponse.ok) return null
    const manifest = parsePluginManifest(await manifestResponse.json())
    if (manifest.id !== id || manifest.version !== latest) return null
    compatibility = normalizePluginMarketCompatibility({ payincus: manifest.payincus })
    pricing = normalizePluginMarketPricing(input.pricing)
  } catch {
    return null
  }
  return {
    id,
    name,
    latest,
    repo,
    manifestUrl,
    downloadUrl,
    sha256: sha256.toLowerCase(),
    description: pickString(input.description, 500) ?? undefined,
    author,
    reviewStatus,
    trustLevel,
    developer: normalizeDeveloper(input.developer, author || name),
    permissions: normalizePermissions(input.permissions),
    compatibility,
    security: normalizeSecurity(input.security),
    pricing,
    rating: {
      average: pickNumber(isRecord(input.rating) ? input.rating.average : undefined, 0, 0, 5),
      count: Math.floor(pickNumber(isRecord(input.rating) ? input.rating.count : undefined, 0, 0, 1_000_000))
    },
    installCount: Math.floor(pickNumber(input.installCount, 0, 0, 1_000_000_000)),
    releaseNotes: pickString(input.releaseNotes, 1000) ?? undefined,
    upgradeNotes: pickString(input.upgradeNotes, 1000) ?? undefined,
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

function getMarketFingerprint(entries: PluginMarketEntry[]): string {
  const stablePayload = entries.map(entry => ({
    id: entry.id,
    latest: entry.latest,
    reviewStatus: entry.reviewStatus,
    trustLevel: entry.trustLevel,
    repo: entry.repo,
    downloadUrl: entry.downloadUrl,
    sha256: entry.sha256,
    compatibility: entry.compatibility,
    permissions: entry.permissions,
    pricing: entry.pricing
  }))
  return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex')
}

const PLUGIN_MARKET_INSTALL_POLICY = ['GitHub index only', 'listed entries only', 'GitHub release artifact only', 'SHA256 required']

export function buildUnavailablePluginMarketIndex(): PluginMarketIndex {
  return {
    plugins: [],
    governance: {
      totalEntries: 0,
      visibleEntries: 0,
      hiddenEntries: 0,
      indexHost: null,
      fingerprint: getMarketFingerprint([]),
      defaultReviewStatus: 'pending',
      installPolicy: PLUGIN_MARKET_INSTALL_POLICY,
      unavailableReason: 'market_unavailable'
    }
  }
}

export async function fetchPluginMarketIndex(url?: string | null): Promise<PluginMarketIndex> {
  const effectiveUrl = url ?? await getPluginMarketIndexUrl()
  if (!effectiveUrl) {
    return buildUnavailablePluginMarketIndex()
  }
  const trustedHosts = await getPluginMarketTrustedHosts()
  const parsed = assertGitHubIndexUrl(effectiveUrl, trustedHosts)
  const response = await fetch(parsed, {
    headers: { 'user-agent': 'payincus-plugin-center' }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin market index: HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  const candidates = isRecord(payload) && Array.isArray(payload.plugins) ? payload.plugins : []
  const normalized = (await Promise.all(candidates.map(entry => normalizeEntry(entry, trustedHosts))))
    .filter((entry): entry is PluginMarketEntry => !!entry)
  const plugins = normalized.filter(entry => entry.reviewStatus === 'listed')
  return {
    plugins,
    governance: {
      totalEntries: normalized.length,
      visibleEntries: plugins.length,
      hiddenEntries: normalized.length - plugins.length,
      indexHost: parsed.hostname,
      fingerprint: getMarketFingerprint(normalized),
      defaultReviewStatus: 'pending',
      installPolicy: PLUGIN_MARKET_INSTALL_POLICY
    }
  }
}

export async function assertMarketEntryInstallable(entry: PluginMarketEntry): Promise<void> {
  if (entry.reviewStatus !== 'listed') {
    throw new Error('Plugin market entry is not listed for installation')
  }
  if (!entry.security.checksumPinned) {
    throw new Error('Plugin market entry must pin a SHA256 checksum')
  }
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error('Plugin market entry has an invalid SHA256 checksum')
  }
  const compatibility = normalizePluginMarketCompatibility(entry.compatibility)
  const current = await getCurrentVersionMetadata()
  const currentVersion = current.gitTag || current.version
  if (compatibility.minPayincus && compareVersions(currentVersion, compatibility.minPayincus) < 0) {
    throw new Error(`Plugin requires PayIncus ${compatibility.minPayincus} or later`)
  }
  if (compatibility.maxPayincus && compareVersions(currentVersion, compatibility.maxPayincus) > 0) {
    throw new Error(`Plugin supports PayIncus up to ${compatibility.maxPayincus}`)
  }
}

export async function downloadMarketPlugin(entry: PluginMarketEntry): Promise<string> {
  await assertMarketEntryInstallable(entry)
  await assertGitHubReleaseUrl(entry.downloadUrl)
  const response = await fetch(entry.downloadUrl, {
    headers: { 'user-agent': 'payincus-plugin-center' }
  })
  if (!response.ok) {
    throw new Error(`Failed to download plugin package: HTTP ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const actualSha256 = createHash('sha256').update(buffer).digest('hex')
  if (actualSha256 !== entry.sha256.toLowerCase()) {
    throw new Error('Plugin package SHA256 mismatch')
  }
  const dir = join(getPluginStagingDir(), 'downloads')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${entry.id}-${entry.latest}-${randomUUID()}.tar.gz`)
  await writeFile(path, buffer, { mode: 0o600 })
  return path
}
