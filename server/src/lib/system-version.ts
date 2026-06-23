import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface VersionMetadata {
  version: string
  gitTag: string | null
  gitCommit: string | null
  buildTime: string | null
  deployedAt: string | null
  changelog: string[]
}

export interface AvailableUpdate {
  version: string
  commit: string | null
  date: string | null
  changelog: string[]
  ota: OtaReleaseInfo
}

export interface UpdateCheckResult {
  current: VersionMetadata
  latest: AvailableUpdate | null
  updates: AvailableUpdate[]
  updateAvailable: boolean
  repositoryAvailable: boolean
  repositoryError: string | null
}

const tagPattern = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export interface OtaArtifactInfo {
  name: string
  platform: string
  arch: string
  url: string
  sha256: string
  size: number | null
}

export interface OtaReleaseInfo {
  manifestAvailable: boolean
  manifestUrl: string | null
  artifacts: OtaArtifactInfo[]
  error: string | null
}

interface GitHubReleaseAsset {
  name?: string
  size?: number
  browser_download_url?: string
}

interface GitHubReleaseResponse {
  assets?: GitHubReleaseAsset[]
}

export function getProjectRoot(): string {
  return resolve(process.env.INCUDAL_APP_DIR || process.cwd())
}

export function isValidReleaseTag(value: string): boolean {
  return tagPattern.test(value.trim())
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function runGit(args: string[], cwd = getProjectRoot()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    })
    return stdout.trim()
  } catch {
    return null
  }
}

function getReleaseRepository(): string {
  return process.env.SYSTEM_UPDATE_RELEASE_REPOSITORY ||
    process.env.GITHUB_REPO ||
    'VipMaxxxx/payincus'
}

export function getReleaseToken(): string | null {
  return process.env.SYSTEM_UPDATE_RELEASE_TOKEN ||
    process.env.GITHUB_TOKEN ||
    null
}

function normalizeOtaArtifact(input: unknown): OtaArtifactInfo | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Partial<OtaArtifactInfo>
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const platform = typeof value.platform === 'string' ? value.platform.trim() : ''
  const arch = typeof value.arch === 'string' ? value.arch.trim() : ''
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : ''
  const size = typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0
    ? value.size
    : null

  if (!name || !platform || !arch || !url || !/^[a-f0-9]{64}$/.test(sha256)) return null
  return { name, platform, arch, url, sha256, size }
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'payincus-online-update'
  }
  const token = getReleaseToken()
  if (token) headers.authorization = `Bearer ${token}`

  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return await response.json() as T
}

export async function getOtaReleaseInfo(tag: string): Promise<OtaReleaseInfo> {
  const repository = getReleaseRepository()
  const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`

  try {
    const release = await fetchJson<GitHubReleaseResponse>(releaseApiUrl)
    const assets = Array.isArray(release.assets) ? release.assets : []
    const manifestAsset = assets.find(asset =>
      asset.name === 'ota-manifest.json' ||
      asset.name === `incudal-${tag}-ota-manifest.json`
    )
    const manifestUrl = manifestAsset?.browser_download_url || null
    if (!manifestUrl) {
      return {
        manifestAvailable: false,
        manifestUrl: null,
        artifacts: [],
        error: 'GitHub Release 未提供 OTA manifest'
      }
    }

    const manifest = await fetchJson<{ artifacts?: unknown[] }>(manifestUrl)
    const artifacts = (Array.isArray(manifest.artifacts) ? manifest.artifacts : [])
      .map(normalizeOtaArtifact)
      .filter((artifact): artifact is OtaArtifactInfo => artifact !== null)

    return {
      manifestAvailable: artifacts.length > 0,
      manifestUrl,
      artifacts,
      error: artifacts.length > 0 ? null : 'OTA manifest 中没有有效 artifact'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      manifestAvailable: false,
      manifestUrl: null,
      artifacts: [],
      error: `读取 GitHub Release OTA manifest 失败: ${message}`
    }
  }
}

export async function isGitRepository(root = getProjectRoot()): Promise<boolean> {
  return (await runGit(['rev-parse', '--is-inside-work-tree'], root)) === 'true'
}

function normalizeChangelog(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map(item => String(item).trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  if (typeof input === 'string') {
    return input
      .split(/\r?\n/)
      .map(line => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  return []
}

async function getPackageVersion(root: string): Promise<string> {
  const pkg = await readJsonFile<{ version?: string }>(join(root, 'package.json'))
  return pkg?.version || '0.0.0'
}

async function readVersionJson(root: string): Promise<Partial<VersionMetadata> | null> {
  return await readJsonFile<Partial<VersionMetadata>>(join(root, 'version.json'))
}

async function getTagChangelog(tag: string, root = getProjectRoot()): Promise<string[]> {
  const message = await runGit(['tag', '-l', tag, '--format=%(contents)'], root)
  const normalized = normalizeChangelog(message)
  if (normalized.length > 0) return normalized

  const log = await runGit(['log', '-1', '--pretty=%s', tag], root)
  return normalizeChangelog(log)
}

export async function getCurrentVersionMetadata(root = getProjectRoot()): Promise<VersionMetadata> {
  const versionJson = await readVersionJson(root)
  const gitTag = await runGit(['describe', '--tags', '--exact-match', 'HEAD'], root)
  const nearestTag = gitTag || await runGit(['describe', '--tags', '--abbrev=0'], root)
  const gitCommit = await runGit(['rev-parse', '--short=12', 'HEAD'], root)
  const packageVersion = await getPackageVersion(root)
  const version = versionJson?.version || gitTag || nearestTag || `v${packageVersion}`

  return {
    version,
    gitTag: versionJson?.gitTag || gitTag || nearestTag,
    gitCommit: versionJson?.gitCommit || gitCommit,
    buildTime: versionJson?.buildTime || null,
    deployedAt: versionJson?.deployedAt || null,
    changelog: normalizeChangelog(versionJson?.changelog).length > 0
      ? normalizeChangelog(versionJson?.changelog)
      : nearestTag ? await getTagChangelog(nearestTag, root) : []
  }
}

async function getTagDate(tag: string, root: string): Promise<string | null> {
  const date = await runGit(['log', '-1', '--format=%cI', tag], root)
  return date || null
}

async function getTagCommit(tag: string, root: string): Promise<string | null> {
  return await runGit(['rev-list', '-n', '1', '--abbrev-commit', '--abbrev=12', tag], root)
}

export async function checkForUpdates(root = getProjectRoot()): Promise<UpdateCheckResult> {
  const current = await getCurrentVersionMetadata(root)
  if (!(await isGitRepository(root))) {
    return {
      current,
      latest: null,
      updates: [],
      updateAvailable: false,
      repositoryAvailable: false,
      repositoryError: '当前部署目录不是 Git 工作区，无法通过 release tag 在线更新。请先将生产目录切换为 Git checkout，或继续使用 release 包手动部署。'
    }
  }

  await runGit(['fetch', '--tags', '--quiet'], root)
  const tagOutput = await runGit(['tag', '--list', 'v*', '--sort=-v:refname'], root)
  const tags = (tagOutput || '')
    .split(/\r?\n/)
    .map(tag => tag.trim())
    .filter(tag => isValidReleaseTag(tag))
    .slice(0, 30)

  const currentTag = current.gitTag || current.version
  const buildAvailableUpdate = async (tag: string): Promise<AvailableUpdate> => ({
    version: tag,
    commit: await getTagCommit(tag, root),
    date: await getTagDate(tag, root),
    changelog: await getTagChangelog(tag, root),
    ota: await getOtaReleaseInfo(tag)
  })
  const latest = tags[0] ? await buildAvailableUpdate(tags[0]) : null
  const updates: AvailableUpdate[] = []

  for (const tag of tags) {
    if (tag === currentTag || tag === current.version) break
    updates.push(latest?.version === tag ? latest : await buildAvailableUpdate(tag))
  }

  return {
    current,
    latest,
    updates,
    updateAvailable: updates.length > 0,
    repositoryAvailable: true,
    repositoryError: null
  }
}
