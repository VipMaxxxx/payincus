import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { createHash } from 'crypto'
import { prisma } from '../db/prisma.js'
import { assertPluginCapabilitiesApprovedForListing } from '../db/plugins.js'
import { isPluginDeveloperVerifiedByAdmin } from '../db/plugin-market-submissions.js'
import {
  normalizePluginMarketCompatibility,
  normalizePluginMarketPricing,
  type PluginMarketEntry,
  type PluginMarketIndex
} from './plugin-market.js'
import { getRuntimeConfigString } from './runtime-settings.js'
import { getPluginDataDir, resolveInside } from './plugin-package.js'
import { parsePluginManifest, type PayIncusPluginManifest } from './plugin-manifest.js'

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

function isFreeSubmissionPricing(value: unknown): boolean {
  try {
    return normalizePluginMarketPricing(value).type === 'free'
  } catch {
    return false
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

interface PublishedSubmissionArtifacts {
  manifest: PayIncusPluginManifest
  manifestUrl: string
  packageUrl: string
}

function managedUploadFilename(input: string, extension: '.tar.gz' | '.plugin.json'): string {
  const url = new URL(input)
  const prefix = '/api/plugin-market-submissions/uploads/plugins/'
  if (!url.pathname.startsWith(prefix)) throw new Error('Listed submission artifacts must use managed review uploads')
  const filename = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!filename || filename.includes('/') || filename.includes('\\') || !filename.endsWith(extension)) {
    throw new Error('Listed submission artifact URL is invalid')
  }
  return filename
}

async function persistSubmissionArtifacts(
  submission: Awaited<ReturnType<typeof prisma.pluginMarketSubmission.findMany>>[number],
  publishDir: string,
  publicBaseUrl: string
): Promise<PublishedSubmissionArtifacts> {
  const uploadDir = join(getPluginDataDir(), 'submission-uploads', 'plugins')
  const sourcePackagePath = resolveInside(uploadDir, managedUploadFilename(submission.packageUrl, '.tar.gz'))
  const sourceManifestPath = resolveInside(uploadDir, managedUploadFilename(submission.manifestUrl, '.plugin.json'))
  const manifest = parsePluginManifest(JSON.parse(await readFile(sourceManifestPath, 'utf8')))
  if (manifest.id !== submission.pluginId || manifest.version !== submission.version) {
    throw new Error(`Reviewed manifest identity does not match ${submission.pluginId}@${submission.version}`)
  }

  const submittedCompatibility = normalizePluginMarketCompatibility(submission.compatibility)
  if (submittedCompatibility.payincus !== manifest.payincus) {
    throw new Error('Reviewed submission compatibility differs from manifest.payincus')
  }
  normalizePluginMarketPricing(submission.pricing)

  const packageBuffer = await readFile(sourcePackagePath)
  const packageSha256 = createHash('sha256').update(packageBuffer).digest('hex')
  if (packageSha256 !== submission.sha256.toLowerCase()) {
    throw new Error(`Reviewed package SHA256 mismatch for ${submission.pluginId}@${submission.version}`)
  }

  const packageRelativePath = join('packages', submission.pluginId, `${submission.version}.tar.gz`)
  const manifestRelativePath = join('manifests', submission.pluginId, `${submission.version}.json`)
  const packagePath = join(publishDir, packageRelativePath)
  const manifestPath = join(publishDir, manifestRelativePath)
  await Promise.all([mkdir(dirname(packagePath), { recursive: true }), mkdir(dirname(manifestPath), { recursive: true })])
  await copyFile(sourcePackagePath, packagePath)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })

  return {
    manifest,
    packageUrl: `${publicBaseUrl}/packages/${submission.pluginId}/${submission.version}.tar.gz`,
    manifestUrl: `${publicBaseUrl}/manifests/${submission.pluginId}/${submission.version}.json`
  }
}

function submissionToMarketEntry(
  submission: Awaited<ReturnType<typeof prisma.pluginMarketSubmission.findMany>>[number],
  artifacts: PublishedSubmissionArtifacts
): PluginMarketEntry {
  const developerVerified = isPluginDeveloperVerifiedByAdmin(submission.scanResult)
  return {
    id: submission.pluginId,
    name: submission.name,
    latest: submission.version,
    repo: submission.repoUrl,
    manifestUrl: artifacts.manifestUrl,
    downloadUrl: artifacts.packageUrl,
    sha256: submission.sha256,
    description: submission.notes || undefined,
    author: submission.developerName,
    reviewStatus: 'listed',
    trustLevel: developerVerified ? 'verified' : 'third_party',
    developer: {
      name: submission.developerName,
      homepage: submission.developerHomepage || undefined,
      github: submission.developerGithub || undefined,
      verified: developerVerified,
      contact: submission.contactEmail
    },
    permissions: normalizePermissions(submission.permissions),
    compatibility: normalizePluginMarketCompatibility({ payincus: artifacts.manifest.payincus }),
    security: {
      checksumPinned: true,
      signature: { status: 'unsigned' },
      notes: getScanNotes(submission.scanResult, submission.riskLevel)
    },
    pricing: normalizePluginMarketPricing(submission.pricing),
    rating: { average: 0, count: 0 },
    installCount: 0,
    releaseNotes: submission.notes || undefined,
    upgradeNotes: 'Install from the stable PayIncus extension market after reviewing permissions and SHA256.',
    rollbackNotes: 'Disable or uninstall the extension from the extension center.'
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

export async function publishPluginMarketIndex(): Promise<PluginMarketPublishResult> {
  const publishDir = getPluginMarketPublishDir()
  const indexPath = join(publishDir, 'index.json')
  const [listedSubmissions, publicBaseUrl] = await Promise.all([
    prisma.pluginMarketSubmission.findMany({
      where: {
        reviewStatus: 'listed',
        scanStatus: { in: ['passed', 'warning'] }
      },
      orderBy: [{ pluginId: 'asc' }, { version: 'asc' }]
    }),
    getPluginMarketPublicBaseUrl()
  ])

  const freeListedSubmissions = listedSubmissions.filter(submission => isFreeSubmissionPricing(submission.pricing))
  const approvedListedSubmissions = []
  for (const submission of freeListedSubmissions) {
    const capabilityApproval = await assertPluginCapabilitiesApprovedForListing({
      pluginId: submission.pluginId,
      manifestVersion: submission.version,
      riskLevel: submission.riskLevel as 'low' | 'medium' | 'high' | 'critical'
    })
    if (capabilityApproval.ok) approvedListedSubmissions.push(submission)
  }
  const highestSubmissionById = new Map<string, { submission: typeof approvedListedSubmissions[number]; version: ParsedSemVer }>()
  for (const submission of approvedListedSubmissions) {
    const version = parseSemVer(submission.version)
    if (!version) continue
    const current = highestSubmissionById.get(submission.pluginId)
    if (!current || compareSemVer(version, current.version) > 0) {
      highestSubmissionById.set(submission.pluginId, { submission, version })
    }
  }

  const updatedAt = new Date().toISOString()
  const plugins: PluginMarketEntry[] = []
  for (const { submission } of highestSubmissionById.values()) {
    const artifacts = await persistSubmissionArtifacts(submission, publishDir, publicBaseUrl)
    plugins.push(submissionToMarketEntry(submission, artifacts))
  }
  plugins.sort((left, right) => left.id.localeCompare(right.id))
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
      totalEntries: plugins.length,
      visibleEntries: plugins.length,
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
    publishedEntries: plugins.length,
    totalEntries: index.plugins.length,
    updatedAt
  }
}
