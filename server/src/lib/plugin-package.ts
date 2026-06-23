import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { mkdir, readFile, rm } from 'fs/promises'
import { createReadStream } from 'fs'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'
import { parsePluginManifest, type PayIncusPluginManifest } from './plugin-manifest.js'

const execFileAsync = promisify(execFile)

export interface ValidatedPluginPackage {
  manifest: PayIncusPluginManifest
  sha256: string
  stagingDir: string
}

export function getPluginInstallDir(): string {
  return resolve(process.env.PLUGIN_INSTALL_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'plugins'))
}

export function getPluginDataDir(): string {
  return resolve(process.env.PLUGIN_DATA_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'plugin-data'))
}

export function getPluginLogDir(): string {
  return resolve(process.env.PLUGIN_LOG_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'plugin-logs'))
}

export function getPluginStagingDir(): string {
  return resolve(process.env.PLUGIN_STAGING_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'plugin-staging'))
}

export function getPluginPackageMaxBytes(): number {
  const mb = Number(process.env.PLUGIN_MAX_PACKAGE_SIZE_MB || '20')
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024
}

export function resolveInside(baseDir: string, relativePath: string): string {
  const resolved = resolve(baseDir, relativePath)
  if (resolved !== baseDir && !resolved.startsWith(`${baseDir}${sep}`)) {
    throw new Error('Resolved path escapes base directory')
  }
  return resolved
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolvePromise())
  })
  return hash.digest('hex')
}

function validateTarEntryLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  const name = trimmed.split(/\s+/).slice(5).join(' ')
  const type = trimmed[0]
  if (!name) throw new Error('Plugin package contains an unreadable tar entry')
  if (type === 'l' || type === 'h') throw new Error('Plugin package cannot contain links')
  if (name.startsWith('/') || name.includes('../') || name === '..' || name.includes('\\')) {
    throw new Error(`Plugin package contains unsafe path: ${name}`)
  }
}

async function validateTarball(path: string): Promise<void> {
  const { stdout } = await execFileAsync('tar', ['-tvf', path], { timeout: 30000, maxBuffer: 1024 * 1024 * 4 })
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  if (!lines.some(line => line.endsWith(' payincus.plugin.json') || line.endsWith('/payincus.plugin.json'))) {
    throw new Error('Plugin package is missing payincus.plugin.json')
  }
  for (const line of lines) validateTarEntryLine(line)
}

export async function validateAndExtractPluginPackage(packagePath: string, taskId: number): Promise<ValidatedPluginPackage> {
  await validateTarball(packagePath)

  const sha256 = await sha256File(packagePath)
  const stagingRoot = getPluginStagingDir()
  await mkdir(stagingRoot, { recursive: true })
  const stagingDir = join(stagingRoot, `plugin-task-${taskId}`)
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  await execFileAsync('tar', ['-xzf', packagePath, '-C', stagingDir], { timeout: 30000 })

  const manifestPath = resolveInside(stagingDir, 'payincus.plugin.json')
  const manifest = parsePluginManifest(JSON.parse(await readFile(manifestPath, 'utf8')))

  for (const page of [...(manifest.entrypoints.adminPages || []), ...(manifest.entrypoints.userPages || [])]) {
    await readFile(resolveInside(stagingDir, page.entry))
  }
  for (const template of manifest.templates || []) {
    await readFile(resolveInside(stagingDir, template.path))
  }

  return { manifest, sha256, stagingDir }
}
