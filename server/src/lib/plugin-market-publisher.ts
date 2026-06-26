import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { createHash } from 'crypto'
import { prisma } from '../db/prisma.js'
import type { PluginMarketEntry, PluginMarketIndex } from './plugin-market.js'
import { getRuntimeConfigString } from './runtime-settings.js'

export interface PluginMarketPublishResult {
  indexPath: string
  publishedEntries: number
  totalEntries: number
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function pickStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : []
}

function normalizePermissions(value: unknown): PluginMarketEntry['permissions'] {
  const record = isRecord(value) ? value : {}
  return {
    adminPages: pickStringArray(record.adminPages),
    userPages: pickStringArray(record.userPages),
    api: pickStringArray(record.api),
    storage: pickStringArray(record.storage)
  }
}

function normalizeCompatibility(value: unknown): PluginMarketEntry['compatibility'] {
  const record = isRecord(value) ? value : {}
  return {
    minPayincus: pickString(record.minPayincus) || undefined,
    maxPayincus: pickString(record.maxPayincus) || undefined
  }
}

function normalizePricing(value: unknown): PluginMarketEntry['pricing'] {
  const record = isRecord(value) ? value : {}
  const type = record.type === 'paid' ? 'paid' : 'free'
  return {
    type,
    price: pickString(record.price) || undefined,
    currency: pickString(record.currency) || undefined,
    revenueSharePercent: typeof record.revenueSharePercent === 'number'
      ? Math.min(Math.max(record.revenueSharePercent, 0), 100)
      : record.revenueSharePercent === null
        ? null
        : undefined
  }
}

function getScanNotes(scanResult: unknown, riskLevel: string): string[] {
  const notes = [`Submission scan risk level: ${riskLevel}`]
  if (!isRecord(scanResult)) return notes
  const status = pickString(scanResult.status)
  if (status) notes.push(`Submission scan status: ${status}`)
  const findings = Array.isArray(scanResult.findings) ? scanResult.findings : []
  for (const finding of findings.slice(0, 5)) {
    if (!isRecord(finding)) continue
    const code = pickString(finding.code)
    const message = pickString(finding.message)
    if (code || message) notes.push(`${code || 'finding'}: ${message}`)
  }
  return notes
}

function getPluginMarketPublishDir(): string {
  return resolve(process.env.PLUGIN_MARKET_PUBLISH_DIR || join(process.cwd(), 'docs-site/docs/public/plugin-market'))
}

async function getPluginMarketPublicBaseUrl(): Promise<string> {
  return (await getRuntimeConfigString(
    'plugin_market_public_base_url',
    'PLUGIN_MARKET_PUBLIC_BASE_URL',
    'https://payincus.com/plugin-market'
  )).replace(/\/+$/, '')
}

function submissionToMarketEntry(submission: Awaited<ReturnType<typeof prisma.pluginMarketSubmission.findMany>>[number], publicBaseUrl: string): PluginMarketEntry {
  const manifestUrl = submission.manifestUrl || `${publicBaseUrl}/manifests/${submission.pluginId}/${submission.version}.json`
  return {
    id: submission.pluginId,
    name: submission.name,
    latest: submission.version,
    repo: submission.repoUrl,
    manifestUrl,
    downloadUrl: submission.packageUrl,
    sha256: submission.sha256,
    description: submission.notes || undefined,
    author: submission.developerName,
    reviewStatus: 'listed',
    trustLevel: submission.developerGithub ? 'verified' : 'third_party',
    developer: {
      name: submission.developerName,
      homepage: submission.developerHomepage || undefined,
      github: submission.developerGithub || undefined,
      verified: Boolean(submission.developerGithub),
      contact: submission.contactEmail
    },
    permissions: normalizePermissions(submission.permissions),
    compatibility: normalizeCompatibility(submission.compatibility),
    security: {
      checksumPinned: true,
      signature: { status: 'unsigned' },
      notes: getScanNotes(submission.scanResult, submission.riskLevel)
    },
    pricing: normalizePricing(submission.pricing),
    rating: { average: 0, count: 0 },
    installCount: 0,
    releaseNotes: submission.notes || undefined,
    upgradeNotes: 'Install from the stable PayIncus extension market after reviewing permissions and SHA256.',
    rollbackNotes: 'Disable or uninstall the extension from the extension center.'
  }
}

async function readExistingMarketEntries(indexPath: string): Promise<PluginMarketEntry[]> {
  try {
    const payload = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
    if (!isRecord(payload) || !Array.isArray(payload.plugins)) return []
    return payload.plugins.filter((entry): entry is PluginMarketEntry => isRecord(entry) && typeof entry.id === 'string')
  } catch {
    return []
  }
}

export async function publishPluginMarketIndex(): Promise<PluginMarketPublishResult> {
  const publishDir = getPluginMarketPublishDir()
  const indexPath = join(publishDir, 'index.json')
  const [existingEntries, listedSubmissions, publicBaseUrl] = await Promise.all([
    readExistingMarketEntries(indexPath),
    prisma.pluginMarketSubmission.findMany({
      where: {
        reviewStatus: 'listed',
        scanStatus: { in: ['passed', 'warning'] }
      },
      orderBy: [{ pluginId: 'asc' }, { version: 'desc' }]
    }),
    getPluginMarketPublicBaseUrl()
  ])

  const entriesById = new Map<string, PluginMarketEntry>()
  for (const entry of existingEntries) {
    entriesById.set(entry.id, entry)
  }
  for (const submission of listedSubmissions) {
    entriesById.set(submission.pluginId, submissionToMarketEntry(submission, publicBaseUrl))
  }

  const updatedAt = new Date().toISOString()
  const plugins = Array.from(entriesById.values()).sort((left, right) => left.id.localeCompare(right.id))
  const fingerprint = createHash('sha256').update(JSON.stringify(plugins.map(entry => ({
    id: entry.id,
    latest: entry.latest,
    reviewStatus: entry.reviewStatus,
    downloadUrl: entry.downloadUrl,
    sha256: entry.sha256,
    compatibility: entry.compatibility,
    permissions: entry.permissions
  })))).digest('hex')

  const index: PluginMarketIndex & { version: number; updatedAt: string } = {
    version: 1,
    updatedAt,
    plugins,
    governance: {
      totalEntries: entriesById.size,
      visibleEntries: entriesById.size,
      hiddenEntries: 0,
      indexHost: null,
      fingerprint,
      defaultReviewStatus: 'pending',
      installPolicy: ['listed entries only', 'SHA256 required', 'submission scan required before publishing']
    }
  }

  await mkdir(dirname(indexPath), { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return {
    indexPath,
    publishedEntries: listedSubmissions.length,
    totalEntries: index.plugins.length,
    updatedAt
  }
}
