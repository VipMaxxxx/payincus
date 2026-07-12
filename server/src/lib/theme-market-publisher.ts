import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { createHash } from 'crypto'
import { prisma } from '../db/prisma.js'
import type { ThemeMarketEntry, ThemeMarketIndex } from './theme-market.js'
import { getRuntimeConfigString } from './runtime-settings.js'

export interface ThemeMarketPublishResult {
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

function normalizeCompatibility(value: unknown): ThemeMarketEntry['compatibility'] {
  const record = isRecord(value) ? value : {}
  return {
    minPayincus: pickString(record.minPayincus) || undefined,
    maxPayincus: pickString(record.maxPayincus) || undefined
  }
}

function getScanNotes(scanResult: unknown, riskLevel: string): string[] {
  const notes = [`Theme submission scan risk level: ${riskLevel}`]
  if (!isRecord(scanResult)) return notes
  const status = pickString(scanResult.status)
  if (status) notes.push(`Theme submission scan status: ${status}`)
  const findings = Array.isArray(scanResult.findings) ? scanResult.findings : []
  for (const finding of findings.slice(0, 5)) {
    if (!isRecord(finding)) continue
    const code = pickString(finding.code)
    const message = pickString(finding.message)
    if (code || message) notes.push(`${code || 'finding'}: ${message}`)
  }
  return notes
}

function getThemeMarketPublishDir(): string {
  return resolve(process.env.THEME_MARKET_PUBLISH_DIR || join(process.cwd(), 'docs-site/docs/public/theme-market'))
}

async function getThemeMarketPublicBaseUrl(): Promise<string> {
  return (await getRuntimeConfigString(
    'theme_market_public_base_url',
    'THEME_MARKET_PUBLIC_BASE_URL',
    'https://payincus.com/theme-market'
  )).replace(/\/+$/, '')
}

function submissionToMarketEntry(submission: Awaited<ReturnType<typeof prisma.themeMarketSubmission.findMany>>[number], publicBaseUrl: string): ThemeMarketEntry {
  const manifestUrl = submission.manifestUrl || `${publicBaseUrl}/manifests/${submission.themeId}/${submission.version}.json`
  return {
    id: submission.themeId,
    name: submission.name,
    latest: submission.version,
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
    compatibility: normalizeCompatibility(submission.compatibility),
    security: {
      checksumPinned: true,
      signature: { status: 'unsigned' },
      notes: getScanNotes(submission.scanResult, submission.riskLevel)
    },
    tokens: pickStringArray(submission.tokens),
    layoutSlots: pickStringArray(submission.layoutSlots),
    rating: { average: 0, count: 0 },
    installCount: 0,
    releaseNotes: submission.notes || undefined,
    rollbackNotes: 'Disable the theme or roll back to the default theme from the extension center.'
  }
}

interface ParsedSemVer {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: string[]
}

function parseSemVer(version: string): ParsedSemVer | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  if (!match) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return null
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease
  }
}

function compareSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }
  return 0
}

export async function publishThemeMarketIndex(): Promise<ThemeMarketPublishResult> {
  const publishDir = getThemeMarketPublishDir()
  const indexPath = join(publishDir, 'index.json')
  const [listedSubmissions, publicBaseUrl] = await Promise.all([
    prisma.themeMarketSubmission.findMany({
      where: {
        reviewStatus: 'listed',
        scanStatus: { in: ['passed', 'warning'] }
      },
      orderBy: [{ themeId: 'asc' }, { version: 'asc' }]
    }),
    getThemeMarketPublicBaseUrl()
  ])

  const highestSubmissionById = new Map<string, { submission: typeof listedSubmissions[number]; version: ParsedSemVer }>()
  for (const submission of listedSubmissions) {
    const version = parseSemVer(submission.version)
    if (!version) continue
    const current = highestSubmissionById.get(submission.themeId)
    if (!current || compareSemVer(version, current.version) > 0) {
      highestSubmissionById.set(submission.themeId, { submission, version })
    }
  }

  const updatedAt = new Date().toISOString()
  const themes = Array.from(highestSubmissionById.values())
    .map(({ submission }) => submissionToMarketEntry(submission, publicBaseUrl))
    .sort((left, right) => left.id.localeCompare(right.id))
  const fingerprint = createHash('sha256').update(JSON.stringify(themes.map(entry => ({
    id: entry.id,
    latest: entry.latest,
    reviewStatus: entry.reviewStatus,
    downloadUrl: entry.downloadUrl,
    sha256: entry.sha256,
    compatibility: entry.compatibility,
    tokens: entry.tokens,
    layoutSlots: entry.layoutSlots
  })))).digest('hex')

  const index: ThemeMarketIndex & { version: number; updatedAt: string } = {
    version: 1,
    updatedAt,
    themes,
    governance: {
      totalEntries: themes.length,
      visibleEntries: themes.length,
      hiddenEntries: 0,
      indexHost: null,
      fingerprint,
      defaultReviewStatus: 'pending',
      installPolicy: ['listed entries only', 'SHA256 required', 'theme submission scan required before publishing']
    }
  }

  await mkdir(dirname(indexPath), { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return {
    indexPath,
    publishedEntries: themes.length,
    totalEntries: index.themes.length,
    updatedAt
  }
}
