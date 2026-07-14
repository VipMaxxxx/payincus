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
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
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

/**
 * 判断 URL 是否为可信的 GitHub Release 主机。
 * 仅对可信主机附带 release token，避免被构造的 release JSON 把凭证泄露到攻击者主机。
 */
export function isTrustedReleaseHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === 'github.com'
      || host === 'api.github.com'
      || host === 'codeload.github.com'
      || host === 'objects.githubusercontent.com'
      || host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'payincus-online-update'
  }
  const token = getReleaseToken()
  if (token && isTrustedReleaseHost(url)) headers.authorization = `Bearer ${token}`

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

export function getRuntimePlatform(): string {
  return process.platform
}

export function getRuntimeArch(): string {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

export function selectRuntimeArtifact(artifacts: OtaArtifactInfo[]): OtaArtifactInfo | null {
  const platform = getRuntimePlatform()
  const arch = getRuntimeArch()
  return artifacts.find(artifact => artifact.platform === platform && artifact.arch === arch) || null
}

// OTA 的 artifact 路径（下载 release tar 包 + 校验 sha256 + 原子发布）完全不需要 Git —— Git 只是
// 拿不到 artifact 时「在机器上从源码构建」的回退路径。因此只要目标版本有本机可用的 artifact，
// 用 release 包部署（一键脚本的默认形态）的机器就应当允许在线更新。
export async function hasUsableOtaArtifact(tag: string): Promise<boolean> {
  if (!isValidReleaseTag(tag)) return false
  try {
    const ota = await getOtaReleaseInfo(tag)
    return selectRuntimeArtifact(ota.artifacts) !== null
  } catch {
    return false
  }
}

export async function canApplyUpdate(tag: string, root = getProjectRoot()): Promise<boolean> {
  if (await hasUsableOtaArtifact(tag)) return true
  return await isGitRepository(root)
}

// 非 Git 部署下的版本发现：改用 GitHub Releases API，语义与 `git tag --list` 一致（只取正式 release tag）。
async function listReleaseTagsFromGitHub(): Promise<string[] | null> {
  const repository = getReleaseRepository()
  try {
    const releases = await fetchJson<GitHubReleaseResponse[]>(
      `https://api.github.com/repos/${repository}/releases?per_page=30`
    )
    if (!Array.isArray(releases)) return null
    return releases
      .filter(release => !release.draft && !release.prerelease)
      .map(release => String(release.tag_name || '').trim())
      .filter(tag => isValidReleaseTag(tag))
  } catch {
    return null
  }
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

// 用 release tar 包部署（一键脚本的默认形态）时目录不是 Git 工作区，此时靠 GitHub Releases API
// 发现版本、靠 artifact 完成更新，全程不需要 Git。只有当 Releases API 也拉不到时才算真的不可更新。
async function checkForUpdatesWithoutGit(current: VersionMetadata): Promise<UpdateCheckResult> {
  const tags = await listReleaseTagsFromGitHub()
  if (!tags) {
    return {
      current,
      latest: null,
      updates: [],
      updateAvailable: false,
      repositoryAvailable: false,
      repositoryError: '当前部署目录不是 Git 工作区，且无法访问 GitHub Releases（网络不通或仓库不可达），暂时无法在线更新。请检查服务器到 api.github.com 的网络后重试。'
    }
  }

  const currentTag = current.gitTag || current.version
  const buildAvailableUpdate = async (tag: string): Promise<AvailableUpdate> => ({
    version: tag,
    commit: null,
    date: null,
    changelog: [],
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

export async function checkForUpdates(root = getProjectRoot()): Promise<UpdateCheckResult> {
  const current = await getCurrentVersionMetadata(root)
  if (!(await isGitRepository(root))) {
    return await checkForUpdatesWithoutGit(current)
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
