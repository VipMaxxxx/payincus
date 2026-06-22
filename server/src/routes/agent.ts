/**
 * 宿主机 Agent 路由
 * 负责 Agent 凭据签发、HMAC 鉴权和心跳上报。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { isIP } from 'net'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { decryptSensitiveData } from '../lib/security.js'
import {
  agentNonceTtlMs,
  createAgentBodyHash,
  isAgentTimestampFresh,
  isValidAgentSecret,
  readAgentAuthHeaders,
  validateAgentHeaders,
  verifyAgentSignature
} from '../lib/agent-auth.js'
import {
  consumeHostAgentInstallToken,
  issueHostAgentInstallToken,
  rotateHostAgentCredentials,
  type HostAgentRecord
} from '../lib/host-agent-credentials.js'
import { processAgentInstanceReport } from '../services/agent-instance-report.js'

interface AgentCredentialsParams {
  hostId: string
}

interface AgentCredentialsBody {
  enabled?: boolean
}

interface AgentInstallCommandBody {
  enabled?: boolean
  baseUrl?: string
  binaryUrl?: string
  binarySha256?: string
}

interface AgentHeartbeatBody {
  version?: string
  capabilities?: string[]
  runtime?: Record<string, unknown>
  incus?: Record<string, unknown>
  instances?: Record<string, unknown>
  resources?: Record<string, unknown>
  metrics?: Record<string, unknown>
}

interface AgentBinaryParams {
  name: string
}

interface AgentBinaryQuery {
  v?: string
  sha256?: string
}

interface AgentInstallTokenParams {
  token: string
}

interface AgentUpgradeManifestFile {
  name?: string
  sha256?: string
  size?: number
  gzip?: boolean
}

interface AgentUpgradeManifest {
  version?: string
  generatedAt?: string
  files?: Record<string, AgentUpgradeManifestFile>
}

interface GitHubReleaseAsset {
  name?: string
  size?: number
  url?: string
  browser_download_url?: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  published_at?: string
  assets?: GitHubReleaseAsset[]
}

interface AgentUpgradeInstruction {
  available: boolean
  version?: string
  url?: string
  sha256?: string
  gzip?: boolean
  size?: number
}

const agentModel = prisma.hostAgent
const nonceModel = prisma.hostAgentNonce
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const agentBinaryNamePattern = /^incudal-agent-linux-(amd64|arm64)(?:\.gz)?$/
const agentReleaseBinaryNamePattern = /^incudal-agent-(x86_64|aarch64)-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const defaultAgentReleaseRepository = 'VipMaxxxx/incudal'
const githubApiBaseUrl = 'https://api.github.com'
const githubDownloadBaseUrl = 'https://github.com'
const agentReleaseCacheTtlMs = 5 * 60 * 1000
const agentBinaryDownloadLimitBytes = 64 * 1024 * 1024
const agentReleaseFetchTimeoutMs = 15 * 1000
const maxAgentInstallUrlLength = 2048
const defaultAgentHeartbeatIntervalSeconds = 30
const minAgentHeartbeatIntervalSeconds = 5
const maxAgentHeartbeatIntervalSeconds = 3600
const minAgentOfflineThresholdSeconds = 120
let agentReleaseManifestCache: { expiresAt: number; manifest: AgentUpgradeManifest } | null = null
let agentReleaseAssetCache: { expiresAt: number; assets: Map<string, GitHubReleaseAsset> } | null = null
let agentReleaseBinaryCache: { expiresAt: number; binaries: Map<string, Buffer> } | null = null
const positiveRouteIdPattern = /^[1-9]\d*$/

function parsePositiveId(value: string): number | null {
  if (!positiveRouteIdPattern.test(value)) {
    return null
  }
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function sanitizeShortString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const uniqueCapabilities = new Set<string>()
  for (const item of value) {
    const capability = sanitizeShortString(item, 80)
    if (capability) {
      uniqueCapabilities.add(capability)
    }
    if (uniqueCapabilities.size >= 64) {
      break
    }
  }
  return Array.from(uniqueCapabilities)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function clampAgentHeartbeatIntervalSeconds(value: unknown): number {
  const parsed = parseInteger(value)
  if (!parsed) {
    return defaultAgentHeartbeatIntervalSeconds
  }
  if (parsed < minAgentHeartbeatIntervalSeconds) {
    return minAgentHeartbeatIntervalSeconds
  }
  if (parsed > maxAgentHeartbeatIntervalSeconds) {
    return maxAgentHeartbeatIntervalSeconds
  }
  return parsed
}

function buildRequestPath(request: FastifyRequest): string {
  return request.url.split('?')[0] || request.url
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function normalizeIpCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  let candidate = value.trim()
  if (!candidate) {
    return null
  }

  if (candidate.startsWith('[')) {
    const closingBracketIndex = candidate.indexOf(']')
    if (closingBracketIndex > 0) {
      candidate = candidate.slice(1, closingBracketIndex)
    }
  }

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/)
  if (ipv4WithPort) {
    candidate = ipv4WithPort[1]
  }

  if (candidate.startsWith('::ffff:')) {
    const mapped = candidate.slice(7)
    if (isIP(mapped)) {
      return mapped
    }
  }

  return isIP(candidate) ? candidate : null
}

function firstForwardedIp(request: FastifyRequest): string | null {
  const headerValues = [
    firstHeaderValue(request.headers['cf-connecting-ip']),
    firstHeaderValue(request.headers['true-client-ip']),
    firstHeaderValue(request.headers['x-real-ip']),
    firstHeaderValue(request.headers['x-forwarded-for'])
  ]

  for (const value of headerValues) {
    if (!value) {
      continue
    }
    for (const part of value.split(',')) {
      const ip = normalizeIpCandidate(part)
      if (ip) {
        return ip
      }
    }
  }

  return null
}

function isLocalOrPrivateIp(ip: string | null): boolean {
  if (!ip) {
    return false
  }

  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) {
    return true
  }

  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) {
    return true
  }

  const parts = ip.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
  }

  const lowerIp = ip.toLowerCase()
  return lowerIp.startsWith('fc') || lowerIp.startsWith('fd') || lowerIp.startsWith('fe80:')
}

function getAgentHeartbeatIp(request: FastifyRequest): string {
  const directIp = normalizeIpCandidate(request.ip) ?? request.ip
  const forwardedIp = firstForwardedIp(request)
  const trustForwardedIp = process.env.AGENT_TRUST_FORWARDED_IP === 'true' || isLocalOrPrivateIp(directIp)

  return forwardedIp && trustForwardedIp ? forwardedIp : directIp
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.length > maxAgentInstallUrlLength) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function normalizeAgentBinaryUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.length > maxAgentInstallUrlLength) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function derivePanelUrl(request: FastifyRequest, explicitBaseUrl?: string): string {
  const explicit = normalizeBaseUrl(explicitBaseUrl)
  if (explicit) {
    return explicit
  }

  const frontendUrl = normalizeBaseUrl(process.env.FRONTEND_URL?.split(',')[0])
  if (frontendUrl) {
    return frontendUrl
  }

  const refererBaseUrl = normalizeBaseUrl(firstHeaderValue(request.headers.origin) ?? firstHeaderValue(request.headers.referer))
  if (refererBaseUrl) {
    return refererBaseUrl
  }

  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim()
  const forwardedHost = firstHeaderValue(request.headers['x-forwarded-host'])?.split(',')[0]?.trim()
  const directHost = firstHeaderValue(request.headers.host)?.trim()
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : (request.protocol || 'http')
  const host = forwardedHost || directHost

  if (host) {
    return `${protocol}://${host}`
  }

  return 'https://incudal.com'
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildAgentInstallCommand(input: {
  panelUrl: string
  installToken: string
  binaryUrl?: string | null
  binarySha256?: string | null
}): string {
  const envParts = [
    `INCUDAL_PANEL_URL=${shellEscape(input.panelUrl)}`,
    `INCUDAL_AGENT_INSTALL_TOKEN=${shellEscape(input.installToken)}`
  ]

  const binaryUrl = input.binaryUrl?.trim()
  if (binaryUrl) {
    envParts.push(`INCUDAL_AGENT_BINARY_URL=${shellEscape(binaryUrl)}`)
    envParts.push(`INCUDAL_AGENT_BINARY_SHA256=${shellEscape(input.binarySha256 || '')}`)
  }

  return `curl -fsSL ${shellEscape(`${input.panelUrl}/api/agent/install.sh`)} | sudo env ${envParts.join(' ')} bash`
}

function buildAgentInstallConfig(input: {
  agentId: string
  agentSecret: string
}): string {
  return [
    `INCUDAL_AGENT_ID=${shellEscape(input.agentId)}`,
    `INCUDAL_AGENT_SECRET=${shellEscape(input.agentSecret)}`
  ].join('\n') + '\n'
}

function getAgentReleaseRepository(): string {
  const configured = process.env.INCUDAL_AGENT_RELEASE_REPOSITORY?.trim() || process.env.GITHUB_REPOSITORY?.trim()
  const repository = configured || defaultAgentReleaseRepository
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : defaultAgentReleaseRepository
}

function getLocalAgentReleaseDir(): string | null {
  const dir = process.env.INCUDAL_AGENT_RELEASE_DIR?.trim()
  return dir && dir.startsWith('/') && !dir.includes('\0') ? dir : null
}

function hashLocalFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function normalizeLocalAgentManifest(raw: unknown, releaseDir: string): AgentUpgradeManifest | null {
  if (!isRecord(raw)) {
    return null
  }
  const version = normalizeAgentBinaryVersion(raw.version)
  const files = isRecord(raw.files) ? raw.files : null
  if (!version || !files) {
    return null
  }

  const manifest: AgentUpgradeManifest = {
    version,
    generatedAt: sanitizeShortString(raw.generatedAt, 80) ?? new Date().toISOString(),
    files: {}
  }

  for (const platform of ['linux-amd64', 'linux-arm64'] as const) {
    const file = isRecord(files[platform]) ? files[platform] : null
    const name = sanitizeShortString(file?.name, 128)
    const sha256 = sanitizeShortString(file?.sha256, 128)?.toLowerCase()
    if (!file || !name || !agentBinaryNamePattern.test(name) || !isSha256(sha256)) {
      return null
    }

    const path = join(releaseDir, name)
    if (!existsSync(path)) {
      return null
    }
    const stat = statSync(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > agentBinaryDownloadLimitBytes) {
      return null
    }
    if (hashLocalFile(path) !== sha256) {
      return null
    }

    manifest.files![platform] = {
      name,
      sha256,
      size: stat.size,
      gzip: typeof file.gzip === 'boolean' ? file.gzip : name.endsWith('.gz')
    }
  }

  return manifest
}

async function readLocalAgentUpgradeManifest(): Promise<AgentUpgradeManifest | null> {
  const releaseDir = getLocalAgentReleaseDir()
  if (!releaseDir) {
    return null
  }

  try {
    const manifestPath = join(releaseDir, 'manifest.json')
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return normalizeLocalAgentManifest(raw, releaseDir)
  } catch (error) {
    console.warn('[AgentRelease] Failed to read local Agent release manifest', error)
    return null
  }
}

function getAgentReleaseApiUrl(): string {
  return `${githubApiBaseUrl}/repos/${getAgentReleaseRepository()}/releases`
}

function getGitHubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'incudal-panel'
  }
  const token = process.env.INCUDAL_AGENT_RELEASE_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function getAgentReleaseAssetUrl(tag: string, assetName: string): string {
  const repository = getAgentReleaseRepository()
  return `${githubDownloadBaseUrl}/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`
}

function assertTrustedAgentReleaseDownloadUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Agent release download URL is invalid')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Agent release download URL must use HTTPS')
  }

  const repository = getAgentReleaseRepository()
  const encodedRepositoryPath = `/${repository}/`
  if (parsed.hostname === 'api.github.com') {
    if (!parsed.pathname.startsWith(`/repos${encodedRepositoryPath}`)) {
      throw new Error('Agent release API URL repository is not trusted')
    }
    return
  }
  if (parsed.hostname === 'github.com') {
    if (!parsed.pathname.startsWith(encodedRepositoryPath)) {
      throw new Error('Agent release download URL repository is not trusted')
    }
    return
  }

  throw new Error('Agent release download URL host is not trusted')
}

function normalizeAgentReleaseVersion(tagName: string | undefined): string | null {
  const tag = sanitizeShortString(tagName, 128)
  if (!tag?.startsWith('agent-')) {
    return null
  }
  const version = tag.slice('agent-'.length)
  return /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

function normalizeAgentBinaryVersion(value: unknown): string | null {
  const version = sanitizeShortString(value, 128)
  return version && /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

function agentApiBinaryNameToReleaseAssetName(name: string, version: string): string | null {
  if (name === 'incudal-agent-linux-amd64') {
    return `incudal-agent-x86_64-${version}`
  }
  if (name === 'incudal-agent-linux-arm64') {
    return `incudal-agent-aarch64-${version}`
  }
  return null
}

function releaseAssetNameToAgentPlatform(name: string): 'linux-amd64' | 'linux-arm64' | null {
  if (name.startsWith('incudal-agent-x86_64-')) {
    return 'linux-amd64'
  }
  if (name.startsWith('incudal-agent-aarch64-')) {
    return 'linux-arm64'
  }
  return null
}

async function fetchJsonFromGitHub<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: getGitHubHeaders('application/vnd.github+json'),
    signal: AbortSignal.timeout(agentReleaseFetchTimeoutMs)
  })
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`)
  }
  return await response.json() as T
}

async function fetchLatestAgentRelease(): Promise<GitHubRelease | null> {
  const releases = await fetchJsonFromGitHub<unknown>(getAgentReleaseApiUrl())
  if (!Array.isArray(releases)) {
    return null
  }

  for (const release of releases) {
    if (!isRecord(release)) {
      continue
    }
    const version = normalizeAgentReleaseVersion(sanitizeShortString(release.tag_name, 128) ?? undefined)
    const assets = Array.isArray(release.assets) ? release.assets : []
    if (version && assets.length > 0) {
      return release as GitHubRelease
    }
  }
  return null
}

async function fetchAgentReleaseAssetSha256(asset: GitHubReleaseAsset): Promise<string | null> {
  const downloadUrl = sanitizeShortString(asset.url, 2048) ?? sanitizeShortString(asset.browser_download_url, 2048)
  if (!downloadUrl) {
    return null
  }
  assertTrustedAgentReleaseDownloadUrl(downloadUrl)

  const response = await fetch(downloadUrl, {
    headers: getGitHubHeaders('application/octet-stream'),
    signal: AbortSignal.timeout(agentReleaseFetchTimeoutMs)
  })
  if (!response.ok || !response.body) {
    throw new Error(`Agent release asset download failed: ${response.status} ${response.statusText}`)
  }

  const hash = createHash('sha256')
  let totalBytes = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > agentBinaryDownloadLimitBytes) {
      throw new Error('Agent release asset exceeds download limit')
    }
    hash.update(buffer)
  }
  return hash.digest('hex')
}

async function readAgentUpgradeManifest(): Promise<AgentUpgradeManifest | null> {
  if (agentReleaseManifestCache && agentReleaseManifestCache.expiresAt > Date.now()) {
    return agentReleaseManifestCache.manifest
  }

  const localManifest = await readLocalAgentUpgradeManifest()
  if (localManifest) {
    agentReleaseManifestCache = {
      expiresAt: Date.now() + agentReleaseCacheTtlMs,
      manifest: localManifest
    }
    return localManifest
  }

  let release: GitHubRelease | null = null
  try {
    release = await fetchLatestAgentRelease()
  } catch (error) {
    console.warn('[AgentRelease] Failed to fetch latest Agent release', error)
    return null
  }
  const version = normalizeAgentReleaseVersion(release?.tag_name)
  if (!release || !version || !Array.isArray(release.assets)) {
    return null
  }

  const manifest: AgentUpgradeManifest = {
    version,
    generatedAt: sanitizeShortString(release.published_at, 80) ?? new Date().toISOString(),
    files: {}
  }
  const assets = new Map<string, GitHubReleaseAsset>()

  for (const asset of release.assets) {
    if (!isRecord(asset)) {
      continue
    }
    const name = sanitizeShortString(asset.name, 256)
    const size = typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : undefined
    if (!name || !agentReleaseBinaryNamePattern.test(name) || !name.endsWith(`-${version}`)) {
      continue
    }
    const platform = releaseAssetNameToAgentPlatform(name)
    if (!platform) {
      continue
    }
    let sha256: string | null = null
    try {
      sha256 = await fetchAgentReleaseAssetSha256(asset as GitHubReleaseAsset)
    } catch (error) {
      console.warn('[AgentRelease] Failed to hash Agent release asset', { name, error })
      continue
    }
    if (!sha256) {
      continue
    }

    manifest.files![platform] = {
      name: platform === 'linux-amd64' ? 'incudal-agent-linux-amd64' : 'incudal-agent-linux-arm64',
      sha256,
      size,
      gzip: false
    }
    assets.set(name, asset as GitHubReleaseAsset)
  }

  if (!manifest.files?.['linux-amd64'] || !manifest.files?.['linux-arm64']) {
    return null
  }

  agentReleaseManifestCache = {
    expiresAt: Date.now() + agentReleaseCacheTtlMs,
    manifest
  }
  agentReleaseAssetCache = {
    expiresAt: Date.now() + agentReleaseCacheTtlMs,
    assets
  }

  return manifest
}

async function getAgentReleaseAsset(name: string, version: string): Promise<GitHubReleaseAsset | null> {
  const assetName = agentApiBinaryNameToReleaseAssetName(name, version)
  if (!assetName) {
    return null
  }

  if (!agentReleaseAssetCache || agentReleaseAssetCache.expiresAt <= Date.now() || !agentReleaseAssetCache.assets.has(assetName)) {
    await readAgentUpgradeManifest()
  }

  return agentReleaseAssetCache?.assets.get(assetName) ?? {
    name: assetName,
    browser_download_url: getAgentReleaseAssetUrl(`agent-${version}`, assetName)
  }
}

async function downloadAgentReleaseBinary(input: {
  name: string
  version: string
  expectedSha256: string
}): Promise<Buffer | null> {
  const cacheKey = `${input.version}:${input.name}:${input.expectedSha256.toLowerCase()}`
  const cachedBinary = agentReleaseBinaryCache?.expiresAt && agentReleaseBinaryCache.expiresAt > Date.now()
    ? agentReleaseBinaryCache.binaries.get(cacheKey)
    : null
  if (cachedBinary) {
    return cachedBinary
  }

  const localReleaseDir = getLocalAgentReleaseDir()
  if (localReleaseDir && agentBinaryNamePattern.test(input.name)) {
    const localPath = join(localReleaseDir, input.name)
    if (existsSync(localPath)) {
      const stat = statSync(localPath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > agentBinaryDownloadLimitBytes) {
        return null
      }
      const binary = readFileSync(localPath)
      const actualSha256 = createHash('sha256').update(binary).digest('hex')
      if (!isSha256(input.expectedSha256) || actualSha256 !== input.expectedSha256.toLowerCase()) {
        throw new Error(`Local Agent release binary sha256 mismatch: expected=${input.expectedSha256} actual=${actualSha256}`)
      }
      if (!agentReleaseBinaryCache || agentReleaseBinaryCache.expiresAt <= Date.now()) {
        agentReleaseBinaryCache = {
          expiresAt: Date.now() + agentReleaseCacheTtlMs,
          binaries: new Map()
        }
      }
      agentReleaseBinaryCache.binaries.set(cacheKey, binary)
      return binary
    }
  }

  const asset = await getAgentReleaseAsset(input.name, input.version)
  const assetName = sanitizeShortString(asset?.name, 256)
  if (!assetName || !agentReleaseBinaryNamePattern.test(assetName)) {
    return null
  }

  const downloadUrl = sanitizeShortString(asset?.url, 2048) ?? getAgentReleaseAssetUrl(`agent-${input.version}`, assetName)
  assertTrustedAgentReleaseDownloadUrl(downloadUrl)
  const response = await fetch(downloadUrl, {
    headers: getGitHubHeaders('application/octet-stream'),
    signal: AbortSignal.timeout(agentReleaseFetchTimeoutMs)
  })
  if (!response.ok || !response.body) {
    throw new Error(`Agent release binary download failed: ${response.status} ${response.statusText}`)
  }

  const chunks: Buffer[] = []
  const hash = createHash('sha256')
  let totalBytes = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > agentBinaryDownloadLimitBytes) {
      throw new Error('Agent release binary exceeds download limit')
    }
    chunks.push(buffer)
    hash.update(buffer)
  }

  const actualSha256 = hash.digest('hex')
  if (!isSha256(input.expectedSha256) || actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw new Error(`Agent release binary sha256 mismatch: expected=${input.expectedSha256} actual=${actualSha256}`)
  }

  const binary = Buffer.concat(chunks)
  if (!agentReleaseBinaryCache || agentReleaseBinaryCache.expiresAt <= Date.now()) {
    agentReleaseBinaryCache = {
      expiresAt: Date.now() + agentReleaseCacheTtlMs,
      binaries: new Map()
    }
  }
  agentReleaseBinaryCache.binaries.set(cacheKey, binary)
  return binary
}

async function getLatestAgentVersion(): Promise<string | null> {
  return sanitizeShortString((await readAgentUpgradeManifest())?.version, 128)
}

function getAgentVersionStatus(agentVersion: string | null, latestVersion: string | null): 'latest' | 'outdated' | 'unknown' {
  if (!agentVersion || !latestVersion) {
    return 'unknown'
  }
  return agentVersion === latestVersion ? 'latest' : 'outdated'
}

function isSha256(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

async function buildAgentUpgradeInstruction(request: FastifyRequest, body: AgentHeartbeatBody): Promise<AgentUpgradeInstruction> {
  const manifest = await readAgentUpgradeManifest()
  const manifestVersion = sanitizeShortString(manifest?.version, 128)
  if (!manifest || !manifestVersion) {
    return { available: false }
  }

  const currentVersion = sanitizeShortString(body.version, 128)
  if (currentVersion === manifestVersion) {
    return { available: false, version: manifestVersion }
  }

  const runtimeInfo = body.runtime ?? {}
  const goos = sanitizeShortString(runtimeInfo.goos, 32)
  const goarch = sanitizeShortString(runtimeInfo.goarch, 32)
  if (goos !== 'linux' || (goarch !== 'amd64' && goarch !== 'arm64')) {
    return { available: false, version: manifestVersion }
  }

  const file = manifest.files?.[`${goos}-${goarch}`]
  const name = sanitizeShortString(file?.name, 128)
  if (!file || !name || !agentBinaryNamePattern.test(name) || !isSha256(file.sha256)) {
    return { available: false, version: manifestVersion }
  }

  const upgradeUrl = `${derivePanelUrl(request)}/api/agent/binary/${encodeURIComponent(name)}?v=${encodeURIComponent(manifestVersion)}&sha256=${encodeURIComponent(file.sha256)}`
  const instruction: AgentUpgradeInstruction = {
    available: true,
    version: manifestVersion,
    url: upgradeUrl,
    sha256: file.sha256,
    gzip: file.gzip ?? name.endsWith('.gz')
  }
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0) {
    instruction.size = file.size
  }
  return instruction
}

function normalizeAgentMetrics(metrics: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(metrics ?? {}),
    heartbeatIntervalSeconds: clampAgentHeartbeatIntervalSeconds(metrics?.heartbeatIntervalSeconds)
  }
}

function getAgentHeartbeatIntervalSeconds(agent: HostAgentRecord): number {
  if (!isRecord(agent.lastReport)) {
    return defaultAgentHeartbeatIntervalSeconds
  }
  const metrics = agent.lastReport.metrics
  if (!isRecord(metrics)) {
    return defaultAgentHeartbeatIntervalSeconds
  }
  return clampAgentHeartbeatIntervalSeconds(metrics.heartbeatIntervalSeconds)
}

function deriveAgentStatus(agent: HostAgentRecord, now = new Date()): string {
  if (!agent.enabled || agent.status !== 'online') {
    return agent.status
  }
  if (!agent.lastSeenAt) {
    return 'offline'
  }

  const heartbeatIntervalSeconds = getAgentHeartbeatIntervalSeconds(agent)
  const offlineThresholdSeconds = Math.max(heartbeatIntervalSeconds * 3, minAgentOfflineThresholdSeconds)
  const lastSeenAgeMs = now.getTime() - agent.lastSeenAt.getTime()

  return lastSeenAgeMs > offlineThresholdSeconds * 1000 ? 'offline' : agent.status
}

async function serializeAgent(agent: HostAgentRecord) {
  const latestVersion = await getLatestAgentVersion()
  const versionStatus = getAgentVersionStatus(agent.version, latestVersion)

  return {
    id: agent.id,
    hostId: agent.hostId,
    agentId: agent.agentId,
    enabled: agent.enabled,
    status: deriveAgentStatus(agent),
    version: agent.version,
    latestVersion,
    versionStatus,
    capabilities: agent.capabilities ?? [],
    lastReport: agent.lastReport ?? {},
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    lastHeartbeatIp: agent.lastHeartbeatIp,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString()
  }
}

async function serializeAgentStatus(agent: HostAgentRecord) {
  const latestVersion = await getLatestAgentVersion()
  const versionStatus = getAgentVersionStatus(agent.version, latestVersion)

  return {
    id: agent.id,
    hostId: agent.hostId,
    agentId: agent.agentId,
    enabled: agent.enabled,
    status: deriveAgentStatus(agent),
    version: agent.version,
    latestVersion,
    versionStatus,
    capabilities: agent.capabilities ?? [],
    lastReport: agent.lastReport ?? {},
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    lastHeartbeatIp: agent.lastHeartbeatIp,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString()
  }
}

function buildHeartbeatReport(body: AgentHeartbeatBody): Record<string, unknown> {
  return {
    runtime: body.runtime ?? {},
    incus: body.incus ?? {},
    resources: body.resources ?? {},
    metrics: normalizeAgentMetrics(body.metrics)
  }
}

async function authenticateAgentRequest(
  request: FastifyRequest<{ Body: AgentHeartbeatBody }>,
  reply: FastifyReply
): Promise<HostAgentRecord | null> {
  const headers = readAgentAuthHeaders(request.headers)
  if (!headers) {
    reply.code(401).send({ error: 'Agent authentication headers are required', code: 'AGENT_AUTH_REQUIRED' })
    return null
  }

  const headerError = validateAgentHeaders(headers)
  if (headerError) {
    reply.code(401).send({ error: 'Invalid Agent authentication headers', code: 'AGENT_AUTH_INVALID', details: headerError })
    return null
  }

  if (!isAgentTimestampFresh(headers.timestamp)) {
    reply.code(401).send({ error: 'Agent request timestamp is expired', code: 'AGENT_AUTH_EXPIRED' })
    return null
  }

  const bodyHash = createAgentBodyHash(request.body ?? {})
  if (bodyHash !== headers.bodyHash.toLowerCase()) {
    reply.code(401).send({ error: 'Agent body hash mismatch', code: 'AGENT_BODY_HASH_MISMATCH' })
    return null
  }

  const agent = await agentModel.findUnique({
    where: { agentId: headers.agentId }
  })

  if (!agent || !agent.enabled) {
    reply.code(401).send({ error: 'Agent is not enabled', code: 'AGENT_DISABLED' })
    return null
  }

  const secret = decryptSensitiveData(agent.secretEncrypted)
  if (!secret || !isValidAgentSecret(secret)) {
    reply.code(401).send({ error: 'Agent secret is not available', code: 'AGENT_SECRET_INVALID' })
    return null
  }

  const signatureOk = verifyAgentSignature(secret, {
    method: request.method,
    path: buildRequestPath(request),
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    bodyHash
  }, headers.signature)

  if (!signatureOk) {
    reply.code(401).send({ error: 'Agent signature verification failed', code: 'AGENT_SIGNATURE_INVALID' })
    return null
  }

  try {
    await prisma.$transaction([
      nonceModel.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      }),
      nonceModel.create({
        data: {
          agentId: agent.agentId,
          nonce: headers.nonce,
          expiresAt: new Date(Date.now() + agentNonceTtlMs)
        }
      })
    ])
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      reply.code(401).send({ error: 'Agent nonce was already used', code: 'AGENT_NONCE_REPLAY' })
      return null
    }
    throw error
  }

  return agent
}

export default async function agentRoutes(fastify: FastifyInstance) {
  fastify.get('/install.sh', async (_request: FastifyRequest, reply: FastifyReply) => {
    const scriptPath = join(__dirname, '../../templates/agent-install.sh')
    const script = readFileSync(scriptPath, 'utf8')
    return reply
      .header('Content-Type', 'text/x-shellscript; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(script)
  })

  fastify.get('/manifest.json', async (_request: FastifyRequest, reply: FastifyReply) => {
    const manifest = await readAgentUpgradeManifest()
    if (!manifest) {
      return reply.code(404).send({ error: 'Agent manifest not found', code: 'AGENT_MANIFEST_NOT_FOUND' })
    }

    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="manifest.json"')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      .header('Pragma', 'no-cache')
      .header('Expires', '0')
      .send(manifest)
  })

  fastify.get<{ Params: AgentInstallTokenParams }>('/install-config/:token', async (
    request: FastifyRequest<{ Params: AgentInstallTokenParams }>,
    reply: FastifyReply
  ) => {
    const { token } = request.params
    try {
      const result = await consumeHostAgentInstallToken(token)
      request.log.info(
        { hostId: result.host.id, agentId: result.agent.agentId },
        'Host Agent install token consumed'
      )
      await createLog(
        null,
        LogModule.HOST,
        'host.agent_install_token_consume',
        `宿主机 Agent 一次性安装 token 已消费: ${result.host.name} (#${result.host.id})`,
        LogResult.SUCCESS
      )

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(buildAgentInstallConfig({
          agentId: result.agent.agentId,
          agentSecret: result.agentSecret
        }))
    } catch (error) {
      if (error instanceof Error && error.message === 'AGENT_INSTALL_TOKEN_EXPIRED') {
        return reply.code(403).send('# Error: Agent install token has expired')
      }
      if (error instanceof Error && (
        error.message === 'AGENT_INSTALL_TOKEN_INVALID' ||
        error.message === 'AGENT_SECRET_INVALID'
      )) {
        return reply.code(403).send('# Error: Invalid Agent install token')
      }
      throw error
    }
  })

  fastify.get<{ Params: AgentBinaryParams; Querystring: AgentBinaryQuery }>('/binary/:name', async (
    request: FastifyRequest<{ Params: AgentBinaryParams; Querystring: AgentBinaryQuery }>,
    reply: FastifyReply
  ) => {
    const { name } = request.params
    if (!agentBinaryNamePattern.test(name)) {
      return reply.code(400).send({ error: 'Invalid Agent binary name', code: 'INVALID_AGENT_BINARY_NAME' })
    }

    const requestedVersion = typeof request.query?.v === 'string' ? normalizeAgentBinaryVersion(request.query.v) : null
    const requestedSha256 = typeof request.query?.sha256 === 'string' && isSha256(request.query.sha256)
      ? request.query.sha256.toLowerCase()
      : null
    if (
      (request.query?.v !== undefined || request.query?.sha256 !== undefined) &&
      (!requestedVersion || !requestedSha256)
    ) {
      return reply.code(400).send({
        error: 'Agent binary version and sha256 must be provided together',
        code: 'AGENT_BINARY_QUERY_INCOMPLETE'
      })
    }

    let version = requestedVersion
    let expectedSha256 = requestedSha256
    let binaryName = name
    const platform = name.includes('amd64') ? 'linux-amd64' : 'linux-arm64'
    if (!version || !expectedSha256) {
      const manifest = await readAgentUpgradeManifest()
      version = sanitizeShortString(manifest?.version, 128)
      const file = manifest?.files?.[platform]
      if (!manifest || !version || !file || !isSha256(file.sha256)) {
        return reply.code(404).send({ error: 'Agent binary not found', code: 'AGENT_BINARY_NOT_FOUND' })
      }
      const manifestName = sanitizeShortString(file.name, 128)
      if (manifestName && agentBinaryNamePattern.test(manifestName)) {
        binaryName = manifestName
      }
      expectedSha256 = file.sha256.toLowerCase()
    }

    let binary: Buffer | null = null
    try {
      binary = await downloadAgentReleaseBinary({
        name: binaryName,
        version,
        expectedSha256
      })
    } catch (error) {
      request.log.warn({ error, name: binaryName, version }, 'Failed to download Agent release binary')
      return reply.code(502).send({ error: 'Agent binary download failed', code: 'AGENT_BINARY_DOWNLOAD_FAILED' })
    }

    if (!binary) {
      return reply.code(404).send({ error: 'Agent binary not found', code: 'AGENT_BINARY_NOT_FOUND' })
    }

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${binaryName}"`)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      .header('Pragma', 'no-cache')
      .header('Expires', '0')
      .send(binary)
  })

  fastify.get<{ Params: AgentCredentialsParams }>('/hosts/:hostId/status', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: AgentCredentialsParams }>, reply: FastifyReply) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }

    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, name: true, userId: true }
    })
    if (!host) {
      return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
    }

    if (host.userId !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const agent = await agentModel.findUnique({
      where: { hostId }
    })

    return {
      host: {
        id: host.id,
        name: host.name
      },
      agent: agent ? await serializeAgentStatus(agent) : null
    }
  })

  fastify.post<{ Params: AgentCredentialsParams }>('/hosts/:hostId/upgrade', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: AgentCredentialsParams }>, reply: FastifyReply) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }

    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, name: true, userId: true }
    })
    if (!host) {
      return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
    }

    if (host.userId !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const agent = await agentModel.findUnique({
      where: { hostId }
    })
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })
    }

    const latestVersion = await getLatestAgentVersion()
    const versionStatus = getAgentVersionStatus(agent.version, latestVersion)
    const derivedStatus = deriveAgentStatus(agent)

    if (!latestVersion) {
      return reply.code(503).send({ error: 'Agent latest version unavailable', code: 'AGENT_LATEST_VERSION_UNAVAILABLE' })
    }
    if (versionStatus === 'unknown') {
      return reply.code(409).send({ error: 'Agent version unknown', code: 'AGENT_VERSION_UNKNOWN' })
    }
    if (versionStatus === 'latest') {
      return {
        requested: false,
        currentVersion: agent.version,
        latestVersion,
        versionStatus,
        nextHeartbeatSeconds: getAgentHeartbeatIntervalSeconds(agent),
        message: 'Agent is already latest'
      }
    }
    if (!agent.enabled || derivedStatus !== 'online') {
      return reply.code(409).send({ error: 'Agent is not online', code: 'AGENT_NOT_ONLINE' })
    }

    const nextHeartbeatSeconds = getAgentHeartbeatIntervalSeconds(agent)
    await createLog(
      request.user.id,
      LogModule.HOST,
      'host.agent_upgrade_request',
      `请求宿主机 Agent 升级: ${host.name} (#${host.id}) ${agent.version || 'unknown'} -> ${latestVersion}`,
      LogResult.SUCCESS
    )

    return {
      requested: true,
      currentVersion: agent.version,
      latestVersion,
      versionStatus,
      nextHeartbeatSeconds,
      message: 'Agent upgrade request accepted; upgrade instruction will be delivered on next heartbeat'
    }
  })

  fastify.post<{ Params: AgentCredentialsParams; Body: AgentCredentialsBody }>('/hosts/:hostId/install-command', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: AgentCredentialsParams; Body: AgentCredentialsBody }>,
    reply: FastifyReply
  ) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }

    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, name: true, userId: true }
    })
    if (!host) {
      return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
    }

    if (host.userId !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const panelUrl = derivePanelUrl(request)
    let result: Awaited<ReturnType<typeof issueHostAgentInstallToken>>
    try {
      result = await issueHostAgentInstallToken(hostId, request.body?.enabled ?? true)
    } catch (error) {
      if (error instanceof Error && error.message === 'HOST_NOT_FOUND') {
        return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
      }
      throw error
    }
    const installCommand = buildAgentInstallCommand({
      panelUrl,
      installToken: result.installToken
    })

    await createLog(
      request.user.id,
      LogModule.HOST,
      'host.agent_install_command_generate',
      `生成宿主机 Agent 安装命令: ${host.name} (#${host.id})`,
      LogResult.SUCCESS
    )

    return reply.code(201).send({
      host: result.host,
      agent: await serializeAgentStatus(result.agent),
      installToken: result.installToken,
      installTokenExpiresAt: result.installTokenExpiresAt.toISOString(),
      installScriptUrl: `${panelUrl}/api/agent/install.sh`,
      installCommand,
      warning: 'installCommand 内包含一次性 Agent 安装 token，30 分钟内有效且只能使用一次。'
    })
  })

  fastify.get<{ Params: AgentCredentialsParams }>('/admin/hosts/:hostId/status', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: AgentCredentialsParams }>, reply: FastifyReply) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }

    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, name: true }
    })
    if (!host) {
      return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
    }

    const agent = await agentModel.findUnique({
      where: { hostId }
    })

    return {
      host,
      agent: agent ? await serializeAgent(agent) : null
    }
  })

  fastify.post<{ Params: AgentCredentialsParams; Body: AgentCredentialsBody }>('/admin/hosts/:hostId/credentials', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: AgentCredentialsParams; Body: AgentCredentialsBody }>,
    reply: FastifyReply
  ) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }

    let result: Awaited<ReturnType<typeof rotateHostAgentCredentials>>
    try {
      result = await rotateHostAgentCredentials(hostId, request.body?.enabled ?? true)
    } catch (error) {
      if (error instanceof Error && error.message === 'HOST_NOT_FOUND') {
        return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
      }
      throw error
    }

    await createLog(
      request.user.id,
      LogModule.HOST,
      'host.agent_credentials_rotate',
      `重置宿主机 Agent 凭据: ${result.host.name} (#${result.host.id})`,
      LogResult.SUCCESS
    )

    return reply.code(201).send({
      host: result.host,
      agent: await serializeAgent(result.agent),
      credentials: {
        agentId: result.agentId,
        agentSecret: result.agentSecret
      },
      warning: 'agentSecret 只会在本次响应中返回，请写入宿主机 Agent 配置后妥善保存。'
    })
  })

  fastify.post<{ Params: AgentCredentialsParams; Body: AgentInstallCommandBody }>('/admin/hosts/:hostId/install-command', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          baseUrl: { type: 'string', minLength: 1 },
          binaryUrl: { type: 'string', minLength: 1 },
          binarySha256: { type: 'string', minLength: 64, maxLength: 64 }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: AgentCredentialsParams; Body: AgentInstallCommandBody }>,
    reply: FastifyReply
  ) => {
    const hostId = parsePositiveId(request.params.hostId)
    if (!hostId) {
      return reply.code(400).send({ error: 'Invalid host ID', code: 'INVALID_HOST_ID' })
    }
    const baseUrlInput = request.body?.baseUrl
    if (typeof baseUrlInput === 'string' && !normalizeBaseUrl(baseUrlInput)) {
      return reply.code(400).send({
        error: 'baseUrl must be a valid HTTP(S) URL',
        code: 'INVALID_AGENT_BASE_URL'
      })
    }

    const binaryUrlInput = request.body?.binaryUrl
    const binaryUrl = typeof binaryUrlInput === 'string' ? normalizeAgentBinaryUrl(binaryUrlInput) : null
    if (typeof binaryUrlInput === 'string' && !binaryUrl) {
      return reply.code(400).send({
        error: 'binaryUrl must be a valid HTTP(S) URL',
        code: 'INVALID_AGENT_BINARY_URL'
      })
    }
    if (binaryUrl && !isSha256(request.body.binarySha256)) {
      return reply.code(400).send({
        error: 'binarySha256 is required when binaryUrl is provided',
        code: 'AGENT_BINARY_SHA256_REQUIRED'
      })
    }

    const panelUrl = derivePanelUrl(request, request.body?.baseUrl)
    let result: Awaited<ReturnType<typeof issueHostAgentInstallToken>>
    try {
      result = await issueHostAgentInstallToken(hostId, request.body?.enabled ?? true)
    } catch (error) {
      if (error instanceof Error && error.message === 'HOST_NOT_FOUND') {
        return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
      }
      throw error
    }

    const installCommand = buildAgentInstallCommand({
      panelUrl,
      installToken: result.installToken,
      binaryUrl,
      binarySha256: request.body?.binarySha256
    })

    await createLog(
      request.user.id,
      LogModule.HOST,
      'host.agent_install_command_generate',
      `生成宿主机 Agent 安装命令: ${result.host.name} (#${result.host.id})`,
      LogResult.SUCCESS
    )

    return reply.code(201).send({
      host: result.host,
      agent: await serializeAgent(result.agent),
      installToken: result.installToken,
      installTokenExpiresAt: result.installTokenExpiresAt.toISOString(),
      installScriptUrl: `${panelUrl}/api/agent/install.sh`,
      installCommand,
      warning: 'installCommand 内包含一次性 Agent 安装 token，30 分钟内有效且只能使用一次。'
    })
  })

  fastify.post<{ Body: AgentHeartbeatBody }>('/heartbeat', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          version: { type: 'string', maxLength: 128 },
          capabilities: {
            type: 'array',
            maxItems: 64,
            items: { type: 'string', maxLength: 80 }
          },
          runtime: { type: 'object', additionalProperties: true },
          incus: { type: 'object', additionalProperties: true },
          instances: { type: 'object', additionalProperties: true },
          resources: { type: 'object', additionalProperties: true },
          metrics: { type: 'object', additionalProperties: true }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: AgentHeartbeatBody }>, reply: FastifyReply) => {
    const agent = await authenticateAgentRequest(request, reply)
    if (!agent) {
      return
    }

    const now = new Date()
    let instanceReport: Awaited<ReturnType<typeof processAgentInstanceReport>> | null = null
    try {
      instanceReport = await processAgentInstanceReport(agent.hostId, request.body.instances)
    } catch (error) {
      request.log.warn(
        { agentId: agent.agentId, hostId: agent.hostId, error },
        'Failed to process Agent instance report'
      )
    }

    await agentModel.update({
      where: { agentId: agent.agentId },
      data: {
        status: 'online',
        version: sanitizeShortString(request.body.version, 128),
        capabilities: normalizeCapabilities(request.body.capabilities) as Prisma.InputJsonValue,
        lastReport: buildHeartbeatReport(request.body) as Prisma.InputJsonObject,
        lastSeenAt: now,
        lastHeartbeatIp: sanitizeShortString(getAgentHeartbeatIp(request), 128)
      }
    })

    return {
      ok: true,
      serverTime: now.toISOString(),
      taskPollIntervalSeconds: 15,
      instanceReport,
      upgrade: await buildAgentUpgradeInstruction(request, request.body)
    }
  })
}
