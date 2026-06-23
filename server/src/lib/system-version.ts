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
  const updates: AvailableUpdate[] = []

  for (const tag of tags) {
    if (tag === currentTag || tag === current.version) break
    updates.push({
      version: tag,
      commit: await getTagCommit(tag, root),
      date: await getTagDate(tag, root),
      changelog: await getTagChangelog(tag, root)
    })
  }

  return {
    current,
    latest: updates[0] || null,
    updates,
    updateAvailable: updates.length > 0,
    repositoryAvailable: true,
    repositoryError: null
  }
}
