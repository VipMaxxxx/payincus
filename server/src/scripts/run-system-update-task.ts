import '../config/env.js'
import { createHash } from 'crypto'
import { appendFile, mkdir, cp, rm, writeFile, readdir, stat, lstat, readlink, symlink, rename } from 'fs/promises'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { prisma, closePrismaDatabase } from '../db/prisma.js'
import {
  getCurrentVersionMetadata,
  getOtaReleaseInfo,
  getReleaseToken,
  isValidReleaseTag,
  type OtaArtifactInfo
} from '../lib/system-version.js'

const taskId = Number(process.argv[2])
let targetVersion = String(process.argv[3] || '').trim()
const appDir = resolve(process.env.INCUDAL_APP_DIR || process.cwd())
const installDir = resolve(process.env.INSTALL_DIR || (appDir.endsWith('/current') ? dirname(appDir) : appDir))
const serviceName = process.env.SERVICE_NAME || 'incudal-backend'
const frontendUrl = process.env.FRONTEND_URL || 'https://pay.payincus.com'
const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'https://admin.payincus.com'
const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3001'
const logDir = resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(installDir, 'update-logs'))
const logPath = resolve(process.env.SYSTEM_UPDATE_LOG_PATH || join(logDir, `system-update-${taskId}.log`))
const updateDownloadDir = resolve(process.env.SYSTEM_UPDATE_DOWNLOAD_DIR || join(installDir, '.incudal-update-downloads'))
const updateApplyMode = process.env.SYSTEM_UPDATE_APPLY_MODE || 'auto'

function now(): string {
  return new Date().toISOString()
}

async function log(message: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `[${now()}] ${message}\n`)
}

async function run(command: string, args: string[], options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<void> {
  await log(`$ ${command} ${args.join(' ')}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || appDir,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let timeout: NodeJS.Timeout | null = null
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
      }, options.timeoutMs)
    }

    child.stdout.on('data', data => {
      void appendFile(logPath, data)
    })
    child.stderr.on('data', data => {
      void appendFile(logPath, data)
    })
    child.on('error', reject)
    child.on('close', code => {
      if (timeout) clearTimeout(timeout)
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
      }
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function waitForBackendHealth(): Promise<void> {
  const deadline = Date.now() + 90000
  let attempt = 1
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      await run('curl', ['-fsS', '--max-time', '5', `${backendUrl}/api/health`], { timeoutMs: 10000 })
      await log(`Backend health is ready after ${attempt} attempt(s)`)
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await log(`Backend health not ready after attempt ${attempt}; retrying in 2s`)
      await sleep(2000)
      attempt += 1
    }
  }

  throw new Error(`Backend health did not become ready after restart: ${lastError}`)
}

function getCurrentLinkPath(): string {
  return join(installDir, 'current')
}

function getReleasesDir(): string {
  return join(installDir, 'releases')
}

async function isAtomicReleaseLayout(): Promise<boolean> {
  try {
    return (await lstat(getCurrentLinkPath())).isSymbolicLink()
  } catch {
    return false
  }
}

async function resolveSymlinkTarget(path: string): Promise<string> {
  const target = await readlink(path)
  return resolve(dirname(path), target)
}

async function getCurrentReleaseTarget(): Promise<string | null> {
  if (!(await isAtomicReleaseLayout())) return null
  return await resolveSymlinkTarget(getCurrentLinkPath())
}

async function switchCurrentRelease(targetDir: string): Promise<void> {
  await mkdir(getReleasesDir(), { recursive: true })
  const currentLink = getCurrentLinkPath()
  const nextLink = join(getReleasesDir(), `.next-current-${taskId}-${Date.now()}`)
  await rm(nextLink, { force: true })
  await symlink(targetDir, nextLink)
  await rename(nextLink, currentLink)
  await log(`Switched current release to ${targetDir}`)
}

function getRuntimePlatform(): string {
  return process.platform
}

function getRuntimeArch(): string {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

function selectRuntimeArtifact(artifacts: OtaArtifactInfo[]): OtaArtifactInfo | null {
  const platform = getRuntimePlatform()
  const arch = getRuntimeArch()
  return artifacts.find(artifact => artifact.platform === platform && artifact.arch === arch) || null
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function downloadArtifact(artifact: OtaArtifactInfo): Promise<string> {
  await mkdir(updateDownloadDir, { recursive: true })
  const artifactPath = join(updateDownloadDir, `${taskId}-${artifact.name}`)
  await log(`Downloading OTA artifact ${artifact.name} (${artifact.size ?? 'unknown'} bytes)`)

  const headers: Record<string, string> = {
    'user-agent': 'payincus-online-update'
  }
  const token = getReleaseToken()
  if (token) headers.authorization = `Bearer ${token}`

  const response = await fetch(artifact.url, { headers })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download OTA artifact: HTTP ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(artifactPath))

  const fileStat = await stat(artifactPath)
  if (artifact.size !== null && fileStat.size !== artifact.size) {
    throw new Error(`OTA artifact size mismatch: expected ${artifact.size}, got ${fileStat.size}`)
  }

  const actualSha256 = await sha256File(artifactPath)
  if (actualSha256 !== artifact.sha256) {
    throw new Error(`OTA artifact sha256 mismatch: expected ${artifact.sha256}, got ${actualSha256}`)
  }

  await log(`OTA artifact verified: sha256=${actualSha256}`)
  return artifactPath
}

async function assertArtifactStaging(stagingDir: string): Promise<void> {
  const requiredPaths = [
    'package.json',
    'pnpm-lock.yaml',
    'client/dist/user/index.html',
    'client/dist/admin/index.html',
    'server/dist/app.js',
    'server/prisma/schema.prisma',
    'scripts/verify-split-host.sh',
    'scripts/verify-production-readiness.sh',
    'scripts/verify-log-header-exposure.sh',
    'version.json'
  ]

  for (const relativePath of requiredPaths) {
    if (!existsSync(join(stagingDir, relativePath))) {
      throw new Error(`OTA artifact is missing required path: ${relativePath}`)
    }
  }
}

async function clearInstallDirPreserving(preservedEntries: string[]): Promise<void> {
  const preserved = new Set(preservedEntries)

  for (const entry of await readdir(installDir)) {
    if (preserved.has(entry)) continue
    await rm(join(installDir, entry), { recursive: true, force: true })
  }
}

async function clearInstallDirForArtifact(): Promise<void> {
  await clearInstallDirPreserving([
    '.env',
    '.git',
    '.gitconfig',
    '.npm',
    '.cache',
    'agent-release',
    'plugins',
    'plugin-data',
    'plugin-logs',
    'plugin-staging',
    'update-logs'
  ])
}

async function copyIfExists(from: string, to: string): Promise<void> {
  if (existsSync(from)) {
    await rm(to, { recursive: true, force: true })
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true, preserveTimestamps: true })
  }
}

async function restoreRuntimeAssets(backupDir: string, targetDir = installDir): Promise<void> {
  await copyIfExists(join(backupDir, '.env'), join(targetDir, '.env'))
  await copyIfExists(join(backupDir, 'server/certs'), join(targetDir, 'server/certs'))
  await copyIfExists(join(backupDir, 'agent-release'), join(targetDir, 'agent-release'))
  await copyIfExists(join(backupDir, 'plugins'), join(installDir, 'plugins'))
  await copyIfExists(join(backupDir, 'plugin-data'), join(installDir, 'plugin-data'))
  await copyIfExists(join(backupDir, 'plugin-logs'), join(installDir, 'plugin-logs'))
  await copyIfExists(join(backupDir, 'plugin-staging'), join(installDir, 'plugin-staging'))
  await mkdir(join(installDir, '.npm'), { recursive: true })
  await mkdir(join(installDir, '.cache'), { recursive: true })
  await mkdir(join(targetDir, 'server/certs'), { recursive: true })
}

async function chownInstallDir(): Promise<void> {
  if (process.platform !== 'linux') return
  await run('bash', ['-lc', `if id incudal >/dev/null 2>&1; then chown -R incudal:incudal ${JSON.stringify(installDir)}; fi`], {
    timeoutMs: 120000
  })
}

async function writeVersionFile(root = appDir): Promise<void> {
  const version = await getCurrentVersionMetadata(root)
  const payload = {
    ...version,
    deployedAt: now()
  }
  await writeFile(join(root, 'version.json'), `${JSON.stringify(payload, null, 2)}\n`)
}

async function updateTask(data: Parameters<typeof prisma.systemUpdateTask.update>[0]['data']): Promise<void> {
  await prisma.systemUpdateTask.update({
    where: { id: taskId },
    data
  })
}

async function configureGitSafeDirectory(): Promise<void> {
  await run('git', ['config', '--global', '--add', 'safe.directory', appDir], {
    timeoutMs: 30000
  })
}

async function getRuntimeArtifact(targetVersion: string): Promise<OtaArtifactInfo | null> {
  if (updateApplyMode === 'git') return null
  const ota = await getOtaReleaseInfo(targetVersion)
  const artifact = selectRuntimeArtifact(ota.artifacts)
  if (artifact) {
    await log(`Using OTA artifact ${artifact.name} for ${getRuntimePlatform()}/${getRuntimeArch()}`)
    return artifact
  }

  const reason = ota.error || `no artifact for ${getRuntimePlatform()}/${getRuntimeArch()}`
  if (updateApplyMode === 'artifact') {
    throw new Error(`OTA artifact mode requested but no usable artifact is available: ${reason}`)
  }
  await log(`No usable OTA artifact found; falling back to Git build mode: ${reason}`)
  return null
}

async function copyStagingToRelease(stagingDir: string, releaseDir: string): Promise<void> {
  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(dirname(releaseDir), { recursive: true })
  await mkdir(releaseDir, { recursive: true })
  await run('bash', ['-lc', `cp -a ${JSON.stringify(stagingDir)}/. ${JSON.stringify(releaseDir)}/`], {
    timeoutMs: 180000,
    cwd: installDir
  })
}

async function applyArtifactAtomic(stagingDir: string, timestamp: string): Promise<string> {
  const currentTarget = await getCurrentReleaseTarget()
  if (!currentTarget) {
    throw new Error('Atomic release layout is missing current target')
  }

  const releaseDir = join(getReleasesDir(), `${targetVersion}-${timestamp}`)
  await log(`Atomic release directory: ${releaseDir}`)
  await copyStagingToRelease(stagingDir, releaseDir)
  await restoreRuntimeAssets(currentTarget, releaseDir)
  await run('corepack', ['enable'], { timeoutMs: 120000, cwd: releaseDir })
  await run('corepack', ['prepare', 'pnpm@9.14.2', '--activate'], { timeoutMs: 120000, cwd: releaseDir })
  await run('pnpm', ['--filter', 'server', 'exec', 'prisma', 'migrate', 'deploy'], {
    timeoutMs: 300000,
    cwd: releaseDir
  })
  await writeVersionFile(releaseDir)
  await chownInstallDir()
  await switchCurrentRelease(releaseDir)
  return currentTarget
}

async function applyArtifactLegacy(stagingDir: string, backupDir: string): Promise<string> {
  await log(`Backup directory: ${backupDir}`)
  await cp(installDir, backupDir, { recursive: true, preserveTimestamps: true })

  await clearInstallDirForArtifact()
  await run('bash', ['-lc', `cp -a ${JSON.stringify(stagingDir)}/. ${JSON.stringify(installDir)}/`], { timeoutMs: 180000 })
  await restoreRuntimeAssets(backupDir)

  await run('corepack', ['enable'], { timeoutMs: 120000 })
  await run('corepack', ['prepare', 'pnpm@9.14.2', '--activate'], { timeoutMs: 120000 })
  await run('pnpm', ['--filter', 'server', 'exec', 'prisma', 'migrate', 'deploy'], { timeoutMs: 300000 })
  await writeVersionFile()
  return backupDir
}

async function applyArtifactUpdate(artifact: OtaArtifactInfo, backupDir: string, timestamp: string): Promise<string> {
  const artifactPath = await downloadArtifact(artifact)
  const stagingDir = join(updateDownloadDir, `staging-${taskId}-${timestamp}`)

  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  await run('tar', ['-xzf', artifactPath, '-C', stagingDir], { timeoutMs: 180000 })
  await assertArtifactStaging(stagingDir)

  if (await isAtomicReleaseLayout()) {
    return await applyArtifactAtomic(stagingDir, timestamp)
  }

  return await applyArtifactLegacy(stagingDir, backupDir)
}

async function applyGitUpdate(backupDir: string): Promise<string> {
  await run('git', ['fetch', '--tags', '--quiet'], { timeoutMs: 120000 })
  await run('git', ['rev-parse', '--verify', `${targetVersion}^{commit}`], { timeoutMs: 30000 })

  await log(`Backup directory: ${backupDir}`)
  await cp(installDir, backupDir, { recursive: true, preserveTimestamps: true })

  await run('git', ['checkout', '--force', targetVersion], { timeoutMs: 120000 })
  await run('git', ['clean', '-fdx', '-e', '.env', '-e', '.gitconfig', '-e', 'server/certs', '-e', 'agent-release', '-e', 'plugins', '-e', 'plugin-data', '-e', 'plugin-logs', '-e', 'plugin-staging', '-e', '.npm', '-e', '.cache', '-e', 'update-logs'], { timeoutMs: 120000 })
  await restoreRuntimeAssets(backupDir)

  await run('corepack', ['enable'], { timeoutMs: 120000 })
  await run('corepack', ['prepare', 'pnpm@9.14.2', '--activate'], { timeoutMs: 120000 })
  await run('pnpm', ['install', '--frozen-lockfile', '--prod=false'], {
    timeoutMs: 600000,
    env: {
      NODE_ENV: 'development',
      PNPM_CONFIG_PROD: 'false'
    }
  })
  await run('pnpm', ['build'], { timeoutMs: 900000 })
  await run('pnpm', ['--filter', 'server', 'exec', 'prisma', 'migrate', 'deploy'], { timeoutMs: 300000 })
  await run('pnpm', ['--filter', 'server', 'test:frontend-dist-boundary-guards'], { timeoutMs: 120000 })
  await run('pnpm', ['--filter', 'server', 'test:frontend-route-guards'], { timeoutMs: 120000 })
  await writeVersionFile()
  return backupDir
}

async function verifyUpdatedRuntime(isArtifactMode: boolean): Promise<void> {
  await chownInstallDir()
  await run('systemctl', ['restart', serviceName], { timeoutMs: 120000 })
  await waitForBackendHealth()
  await run('bash', ['scripts/verify-split-host.sh'], {
    timeoutMs: 180000,
    env: {
      FRONTEND_URL: frontendUrl,
      ADMIN_FRONTEND_URL: adminFrontendUrl,
      BACKEND_URL: backendUrl
    }
  })
  await run('pnpm', ['verify:production'], {
    timeoutMs: 240000,
    env: {
      ENV_FILE: join(installDir, '.env'),
      FRONTEND_URL: frontendUrl,
      ADMIN_FRONTEND_URL: adminFrontendUrl,
      BACKEND_URL: backendUrl
    }
  })
  await run('pnpm', ['verify:log-header'], {
    timeoutMs: 240000,
    env: {
      ENV_FILE: join(installDir, '.env'),
      FRONTEND_URL: frontendUrl,
      ADMIN_FRONTEND_URL: adminFrontendUrl,
      BACKEND_URL: backendUrl
    }
  })
  if (!isArtifactMode) {
    await run('pnpm', ['smoke:agent-release'], {
      timeoutMs: 180000,
      env: {
        FRONTEND_URL: frontendUrl,
        BACKEND_URL: backendUrl
      }
    })
  } else {
    await log('Skipping source-based Agent release smoke in artifact mode; production readiness already verified the Agent manifest')
  }
}

async function autoRollbackFromBackup(backupDir: string, timestamp: string): Promise<boolean> {
  if (!existsSync(backupDir)) {
    await log('Auto rollback skipped: backup directory does not exist')
    return false
  }

  if (await isAtomicReleaseLayout()) {
    const failedTarget = await getCurrentReleaseTarget()
    if (failedTarget) {
      const failedInstallBackup = join(getReleasesDir(), `failed-update-${timestamp}`)
      await log(`Preserving failed release before auto rollback: ${failedInstallBackup}`)
      await cp(failedTarget, failedInstallBackup, { recursive: true, preserveTimestamps: true })
    }
    await log(`Auto rollback switching current release back to: ${backupDir}`)
    await switchCurrentRelease(backupDir)
    await chownInstallDir()
    await run('systemctl', ['restart', serviceName], { timeoutMs: 120000 })
    await waitForBackendHealth()
    await run('bash', ['scripts/verify-split-host.sh'], {
      timeoutMs: 180000,
      env: {
        FRONTEND_URL: frontendUrl,
        ADMIN_FRONTEND_URL: adminFrontendUrl,
        BACKEND_URL: backendUrl
      }
    })
    await log('Auto rollback completed successfully')
    return true
  }

  const failedInstallBackup = `${installDir}.failed-update.${timestamp}`
  await log(`Auto rollback starting from backup: ${backupDir}`)
  await log(`Preserving failed install before auto rollback: ${failedInstallBackup}`)

  if (existsSync(installDir)) {
    await cp(installDir, failedInstallBackup, { recursive: true, preserveTimestamps: true })
  }

  await clearInstallDirPreserving(['update-logs', 'plugins', 'plugin-data', 'plugin-logs', 'plugin-staging'])
  await run('bash', ['-lc', `cp -a ${JSON.stringify(backupDir)}/. ${JSON.stringify(installDir)}/`], { timeoutMs: 180000 })
  await mkdir(join(installDir, '.npm'), { recursive: true })
  await mkdir(join(installDir, '.cache'), { recursive: true })
  await mkdir(join(installDir, 'plugins'), { recursive: true })
  await mkdir(join(installDir, 'plugin-data'), { recursive: true })
  await mkdir(join(installDir, 'plugin-logs'), { recursive: true })
  await mkdir(join(installDir, 'plugin-staging'), { recursive: true })
  await mkdir(join(installDir, 'server/certs'), { recursive: true })
  await chownInstallDir()
  await run('systemctl', ['restart', serviceName], { timeoutMs: 120000 })
  await waitForBackendHealth()
  await run('bash', ['scripts/verify-split-host.sh'], {
    timeoutMs: 180000,
    env: {
      FRONTEND_URL: frontendUrl,
      ADMIN_FRONTEND_URL: adminFrontendUrl,
      BACKEND_URL: backendUrl
    }
  })
  await log('Auto rollback completed successfully')
  return true
}

async function main(): Promise<void> {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new Error('Invalid task id')
  }
  const task = await prisma.systemUpdateTask.findUnique({ where: { id: taskId } })
  if (!task) {
    throw new Error('System update task not found')
  }
  if (!targetVersion) {
    targetVersion = task.targetVersion
  }
  if (!isValidReleaseTag(targetVersion)) {
    throw new Error('Invalid target version')
  }

  await mkdir(logDir, { recursive: true })
  await updateTask({ status: 'running', startedAt: new Date(), logPath })
  await log(`Starting system update task ${taskId} -> ${targetVersion}`)
  await configureGitSafeDirectory()

  const currentVersion = await getCurrentVersionMetadata(appDir)
  await updateTask({ fromVersion: currentVersion.version })

  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const backupDir = `${installDir}.bak.${timestamp}`
  let backupPath = backupDir

  try {
    const artifact = await getRuntimeArtifact(targetVersion)
    if (artifact) {
      backupPath = await applyArtifactUpdate(artifact, backupDir, timestamp)
    } else {
      backupPath = await applyGitUpdate(backupDir)
    }
    await verifyUpdatedRuntime(Boolean(artifact))

    await updateTask({
      status: 'success',
      backupPath,
      finishedAt: new Date(),
      errorMessage: null
    })
    await log('System update completed successfully')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`ERROR: ${message}`)
    let rolledBack = false
    try {
      rolledBack = await autoRollbackFromBackup(backupPath, timestamp)
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      await log(`AUTO ROLLBACK ERROR: ${rollbackMessage}`)
    }
    await updateTask({
      status: rolledBack ? 'rolled_back' : 'failed',
      backupPath,
      finishedAt: new Date(),
      errorMessage: (rolledBack ? `Update failed and was auto-rolled back: ${message}` : message).slice(0, 5000)
    })
    process.exitCode = 1
  } finally {
    await closePrismaDatabase()
  }
}

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error)
  await log(`FATAL: ${message}`).catch(() => undefined)
  await updateTask({
    status: 'failed',
    finishedAt: new Date(),
    errorMessage: message.slice(0, 5000)
  }).catch(() => undefined)
  await closePrismaDatabase().catch(() => undefined)
  process.exit(1)
})
