import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { PluginMarketSubmissionRiskLevel } from '../db/plugin-market-submissions.js'
import { assertSafeHttpUrl } from './outbound-security.js'
import { getPluginPackageMaxBytes, getPluginStagingDir, sha256File, validateAndExtractPluginPackage } from './plugin-package.js'
import { parsePluginManifest, type PayIncusPluginManifest } from './plugin-manifest.js'

export type PluginSubmissionScanStatus = 'passed' | 'warning' | 'failed'

export interface PluginSubmissionScanFinding {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface PluginSubmissionScanInput {
  id: number
  pluginId: string
  version: string
  name: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  permissions: unknown
  compatibility: unknown
  pricing: unknown
}

export interface PluginSubmissionScanResult {
  status: PluginSubmissionScanStatus
  riskLevel: PluginMarketSubmissionRiskLevel
  manifest: {
    id: string
    name: string
    version: string
    permissions: string[]
  } | null
  packageSha256: string | null
  findings: PluginSubmissionScanFinding[]
  scannedAt: string
}

const HIGH_RISK_PERMISSION_PATTERNS = [
  /^admin:/,
  /^payment:/,
  /^balance:/,
  /^orders:(create|write|refund|pay)/,
  /^instances:(create|write|delete|rebuild)/,
  /^users:(write|delete|ban)/
]

const WARNING_PERMISSION_PATTERNS = [
  /^orders:/,
  /^tickets:/,
  /^notifications:/,
  /^plugin-action:run$/,
  /^plugin-storage:(read|write)$/
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pushFinding(
  findings: PluginSubmissionScanFinding[],
  severity: PluginSubmissionScanFinding['severity'],
  code: string,
  message: string
) {
  findings.push({ severity, code, message })
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
      'user-agent': 'PayIncus-Plugin-Submission-Scanner/1.0'
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
  manifest: PayIncusPluginManifest,
  input: PluginSubmissionScanInput,
  findings: PluginSubmissionScanFinding[]
) {
  if (manifest.id !== input.pluginId) {
    pushFinding(findings, 'error', 'manifest_id_mismatch', `Manifest id ${manifest.id} does not match submitted id ${input.pluginId}`)
  }
  if (manifest.version !== input.version) {
    pushFinding(findings, 'error', 'manifest_version_mismatch', `Manifest version ${manifest.version} does not match submitted version ${input.version}`)
  }
  if (manifest.name !== input.name) {
    pushFinding(findings, 'warning', 'manifest_name_mismatch', `Manifest name ${manifest.name} differs from submitted name ${input.name}`)
  }
}

function collectDeclaredPermissions(manifest: PayIncusPluginManifest, submittedPermissions: unknown): string[] {
  const permissions = new Set<string>(manifest.permissions || [])
  if (isRecord(submittedPermissions)) {
    for (const value of Object.values(submittedPermissions)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) permissions.add(item.trim())
        }
      }
    }
  }
  return Array.from(permissions).sort()
}

function assessRisk(
  manifest: PayIncusPluginManifest,
  submittedPermissions: unknown,
  findings: PluginSubmissionScanFinding[]
): PluginMarketSubmissionRiskLevel {
  const permissions = collectDeclaredPermissions(manifest, submittedPermissions)
  let risk: PluginMarketSubmissionRiskLevel = 'low'

  for (const permission of permissions) {
    if (HIGH_RISK_PERMISSION_PATTERNS.some(pattern => pattern.test(permission))) {
      risk = 'high'
      pushFinding(findings, 'warning', 'high_risk_permission', `High-risk permission declared: ${permission}`)
    } else if (WARNING_PERMISSION_PATTERNS.some(pattern => pattern.test(permission)) && risk === 'low') {
      risk = 'medium'
    }
  }

  if ((manifest.capabilities?.actions || []).length > 0) {
    risk = risk === 'low' ? 'medium' : risk
    pushFinding(findings, 'info', 'webhook_actions_declared', 'Manifest declares webhook actions')
  }
  if ((manifest.capabilities?.events || []).length > 0) {
    risk = risk === 'low' ? 'medium' : risk
    pushFinding(findings, 'info', 'event_subscriptions_declared', 'Manifest declares event subscriptions')
  }
  if (manifest.capabilities?.storage) {
    risk = risk === 'low' ? 'medium' : risk
    pushFinding(findings, 'info', 'storage_declared', 'Manifest declares extension storage')
  }

  return risk
}

function scanStatusFromFindings(findings: PluginSubmissionScanFinding[]): PluginSubmissionScanStatus {
  if (findings.some(finding => finding.severity === 'error')) return 'failed'
  if (findings.some(finding => finding.severity === 'warning')) return 'warning'
  return 'passed'
}

export async function scanPluginMarketSubmission(input: PluginSubmissionScanInput): Promise<PluginSubmissionScanResult> {
  const findings: PluginSubmissionScanFinding[] = []
  const maxBytes = getPluginPackageMaxBytes()
  const scanRoot = join(getPluginStagingDir(), 'submission-scans')
  await mkdir(scanRoot, { recursive: true })
  const scanDir = join(scanRoot, `${input.id}-${Date.now()}-${randomUUID()}`)
  await mkdir(scanDir, { recursive: true })
  const packagePath = join(scanDir, 'plugin.tar.gz')

  let manifest: PayIncusPluginManifest | null = null
  let packageSha256: string | null = null

  try {
    const [manifestBuffer, packageBuffer] = await Promise.all([
      downloadBoundedHttpsFile(input.manifestUrl, 'Manifest URL', 1024 * 1024),
      downloadBoundedHttpsFile(input.packageUrl, 'Package URL', maxBytes)
    ])

    manifest = parsePluginManifest(JSON.parse(manifestBuffer.toString('utf8')))
    compareManifestToSubmission(manifest, input, findings)

    await writeFile(packagePath, packageBuffer, { mode: 0o600 })
    packageSha256 = await sha256File(packagePath)
    if (packageSha256 !== input.sha256.toLowerCase()) {
      pushFinding(findings, 'error', 'sha256_mismatch', `Package SHA256 ${packageSha256} does not match submitted SHA256 ${input.sha256}`)
    }

    const validated = await validateAndExtractPluginPackage(packagePath, input.id)
    compareManifestToSubmission(validated.manifest, input, findings)
    if (validated.sha256 !== packageSha256) {
      pushFinding(findings, 'error', 'package_hash_inconsistent', 'Package hash changed during validation')
    }
    await rm(validated.stagingDir, { recursive: true, force: true }).catch(() => undefined)

    if (JSON.stringify(validated.manifest) !== JSON.stringify(manifest)) {
      pushFinding(findings, 'warning', 'manifest_url_package_mismatch', 'Manifest URL content differs from package manifest')
    }

    const riskLevel = assessRisk(validated.manifest, input.permissions, findings)
    return {
      status: scanStatusFromFindings(findings),
      riskLevel,
      manifest: {
        id: validated.manifest.id,
        name: validated.manifest.name,
        version: validated.manifest.version,
        permissions: validated.manifest.permissions || []
      },
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
      manifest: manifest ? {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        permissions: manifest.permissions || []
      } : null,
      packageSha256,
      findings,
      scannedAt: new Date().toISOString()
    }
  } finally {
    await rm(scanDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
