import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { getPluginStagingDir } from './plugin-package.js'

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
}

export interface PluginMarketIndex {
  plugins: PluginMarketEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

export function getPluginMarketIndexUrl(): string | null {
  return pickString(process.env.PLUGIN_MARKET_INDEX_URL, 500)
}

export function assertGitHubReleaseUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:') throw new Error('Plugin market URL must use HTTPS')
  if (!['github.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('Plugin market downloads must come from GitHub release assets')
  }
  if (url.hostname === 'github.com' && !url.pathname.includes('/releases/download/')) {
    throw new Error('GitHub plugin URL must point to a release asset')
  }
  return url
}

function assertGitHubIndexUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:') throw new Error('Plugin market index must use HTTPS')
  if (!['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('Plugin market index must be hosted on GitHub')
  }
  return url
}

function normalizeEntry(input: unknown): PluginMarketEntry | null {
  if (!isRecord(input)) return null
  const id = pickString(input.id, 120)
  const name = pickString(input.name, 120)
  const latest = pickString(input.latest, 64)
  const repo = pickString(input.repo, 160)
  const manifestUrl = pickString(input.manifestUrl, 500)
  const downloadUrl = pickString(input.downloadUrl, 500)
  const sha256 = pickString(input.sha256, 64)
  if (!id || !name || !latest || !repo || !manifestUrl || !downloadUrl || !sha256) return null
  assertGitHubReleaseUrl(manifestUrl)
  assertGitHubReleaseUrl(downloadUrl)
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null
  return {
    id,
    name,
    latest,
    repo,
    manifestUrl,
    downloadUrl,
    sha256: sha256.toLowerCase(),
    description: pickString(input.description, 500) ?? undefined,
    author: pickString(input.author, 120) ?? undefined
  }
}

export async function fetchPluginMarketIndex(url = getPluginMarketIndexUrl()): Promise<PluginMarketIndex> {
  if (!url) return { plugins: [] }
  const parsed = assertGitHubIndexUrl(url)
  const response = await fetch(parsed, {
    headers: { 'user-agent': 'payincus-plugin-center' }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin market index: HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  const plugins = isRecord(payload) && Array.isArray(payload.plugins)
    ? payload.plugins.map(normalizeEntry).filter((entry): entry is PluginMarketEntry => !!entry)
    : []
  return { plugins }
}

export async function downloadMarketPlugin(entry: PluginMarketEntry): Promise<string> {
  assertGitHubReleaseUrl(entry.downloadUrl)
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
