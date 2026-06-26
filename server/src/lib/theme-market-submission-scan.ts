import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ThemeMarketSubmissionRiskLevel } from '../db/theme-market-submissions.js'
import { assertSafeHttpUrl } from './outbound-security.js'
import { getThemePackageMaxBytes, getThemeStagingDir, parseThemeManifest, validateAndExtractThemePackage, type PayIncusThemeManifest } from './theme-package.js'

export type ThemeSubmissionScanStatus = 'passed' | 'warning' | 'failed'

export interface ThemeSubmissionScanFinding {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface ThemeSubmissionScanInput {
  id: number
  themeId: string
  version: string
  name: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  compatibility: unknown
  tokens: unknown
  layoutSlots: unknown
}

export interface ThemeSubmissionScanResult {
  status: ThemeSubmissionScanStatus
  riskLevel: ThemeMarketSubmissionRiskLevel
  manifest: {
    id: string
    name: string
    version: string
    payincus: string
    tokenCount: number
    layoutSlotCount: number
  } | null
  packageSha256: string | null
  findings: ThemeSubmissionScanFinding[]
  scannedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pushFinding(
  findings: ThemeSubmissionScanFinding[],
  severity: ThemeSubmissionScanFinding['severity'],
  code: string,
  message: string
) {
  findings.push({ severity, code, message })
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

async function downloadBoundedHttpsFile(url: string, label: string, maxBytes: number): Promise<Buffer> {
  const safeUrl = await assertSafeHttpUrl(url, label)
  if (safeUrl.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`)
  }

  const response = await fetch(safeUrl, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'accept': 'application/octet-stream',
      'user-agent': 'PayIncus-Theme-Submission-Scanner/1.0'
    }
  })

  if (!response.ok) {
    throw new Error(`${label} download failed with HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)}MB`)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  if (!response.body) throw new Error(`${label} response has no body`)

  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)}MB`)
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

function compareManifestToSubmission(
  manifest: PayIncusThemeManifest,
  input: ThemeSubmissionScanInput,
  findings: ThemeSubmissionScanFinding[]
) {
  if (manifest.id !== input.themeId) {
    pushFinding(findings, 'error', 'manifest_id_mismatch', `Manifest id ${manifest.id} does not match submitted id ${input.themeId}`)
  }
  if (manifest.version !== input.version) {
    pushFinding(findings, 'error', 'manifest_version_mismatch', `Manifest version ${manifest.version} does not match submitted version ${input.version}`)
  }
  if (manifest.name !== input.name) {
    pushFinding(findings, 'warning', 'manifest_name_mismatch', `Manifest name ${manifest.name} differs from submitted name ${input.name}`)
  }
}

function assessRisk(manifest: PayIncusThemeManifest, findings: ThemeSubmissionScanFinding[]): ThemeMarketSubmissionRiskLevel {
  const tokenKeys = Object.keys(manifest.tokens || {})
  let risk: ThemeMarketSubmissionRiskLevel = 'low'
  if (manifest.layoutSlots.length > 0) {
    risk = 'medium'
    pushFinding(findings, 'info', 'layout_slots_declared', `Theme declares ${manifest.layoutSlots.length} layout slots`)
  }
  if (manifest.layoutSlots.some(slot => /admin|checkout|payment|auth|login|register/i.test(slot))) {
    risk = 'high'
    pushFinding(findings, 'warning', 'sensitive_layout_slot', 'Theme declares sensitive auth, checkout, payment, or admin layout slots')
  }
  if (tokenKeys.length > 60 && risk === 'low') {
    risk = 'medium'
    pushFinding(findings, 'info', 'many_tokens_declared', `Theme declares ${tokenKeys.length} design tokens`)
  }
  if (Object.keys(manifest.configSchema || {}).length > 40 && risk === 'low') {
    risk = 'medium'
    pushFinding(findings, 'info', 'large_config_schema', 'Theme declares a large config schema')
  }
  return risk
}

function scanStatusFromFindings(findings: ThemeSubmissionScanFinding[]): ThemeSubmissionScanStatus {
  if (findings.some(finding => finding.severity === 'error')) return 'failed'
  if (findings.some(finding => finding.severity === 'warning')) return 'warning'
  return 'passed'
}

function serializeManifest(manifest: PayIncusThemeManifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    payincus: manifest.payincus,
    tokenCount: Object.keys(manifest.tokens || {}).length,
    layoutSlotCount: manifest.layoutSlots.length
  }
}

export async function scanThemeMarketSubmission(input: ThemeSubmissionScanInput): Promise<ThemeSubmissionScanResult> {
  const findings: ThemeSubmissionScanFinding[] = []
  const maxBytes = getThemePackageMaxBytes()
  const scanRoot = join(getThemeStagingDir(), 'submission-scans')
  await mkdir(scanRoot, { recursive: true })
  const scanDir = join(scanRoot, `${input.id}-${Date.now()}-${randomUUID()}`)
  await mkdir(scanDir, { recursive: true })
  const packagePath = join(scanDir, 'theme.tar.gz')

  let manifest: PayIncusThemeManifest | null = null
  let packageSha256: string | null = null

  try {
    const [manifestBuffer, packageBuffer] = await Promise.all([
      downloadBoundedHttpsFile(input.manifestUrl, 'Theme manifest URL', 1024 * 1024),
      downloadBoundedHttpsFile(input.packageUrl, 'Theme package URL', maxBytes)
    ])

    manifest = parseThemeManifest(JSON.parse(manifestBuffer.toString('utf8')))
    compareManifestToSubmission(manifest, input, findings)

    await writeFile(packagePath, packageBuffer, { mode: 0o600 })
    packageSha256 = await sha256File(packagePath)
    if (packageSha256 !== input.sha256.toLowerCase()) {
      pushFinding(findings, 'error', 'sha256_mismatch', `Package SHA256 ${packageSha256} does not match submitted SHA256 ${input.sha256}`)
    }

    const validated = await validateAndExtractThemePackage(packagePath, input.id)
    compareManifestToSubmission(validated.manifest, input, findings)
    if (validated.sha256 !== packageSha256) {
      pushFinding(findings, 'error', 'package_hash_inconsistent', 'Package hash changed during validation')
    }
    await rm(validated.stagingDir, { recursive: true, force: true }).catch(() => undefined)

    if (JSON.stringify(validated.manifest) !== JSON.stringify(manifest)) {
      pushFinding(findings, 'warning', 'manifest_url_package_mismatch', 'Manifest URL content differs from package manifest')
    }

    if (isRecord(input.compatibility)) {
      const minPayincus = typeof input.compatibility.minPayincus === 'string' ? input.compatibility.minPayincus : ''
      const maxPayincus = typeof input.compatibility.maxPayincus === 'string' ? input.compatibility.maxPayincus : ''
      if (minPayincus && manifest.payincus && !manifest.payincus.includes(minPayincus)) {
        pushFinding(findings, 'info', 'compatibility_declared', `Submission minPayincus ${minPayincus}; manifest payincus range ${manifest.payincus}`)
      }
      if (maxPayincus) {
        pushFinding(findings, 'info', 'compatibility_max_declared', `Submission maxPayincus ${maxPayincus}`)
      }
    }

    const riskLevel = assessRisk(validated.manifest, findings)
    return {
      status: scanStatusFromFindings(findings),
      riskLevel,
      manifest: serializeManifest(validated.manifest),
      packageSha256,
      findings,
      scannedAt: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushFinding(findings, 'error', 'scan_failed', message)
    return {
      status: 'failed',
      riskLevel: 'high',
      manifest: manifest ? serializeManifest(manifest) : null,
      packageSha256,
      findings,
      scannedAt: new Date().toISOString()
    }
  } finally {
    await rm(scanDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
