import '../config/env.js'
import { appendFile, cp, mkdir, rm, lstat, readlink, rename, symlink } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import { prisma, closePrismaDatabase } from '../db/prisma.js'
import { tryMarkSystemUpdateTaskRunning } from '../db/system-update-tasks.js'

const taskId = Number(process.argv[2])
const appDir = resolve(process.env.INCUDAL_APP_DIR || process.cwd())
const installDir = resolve(process.env.INSTALL_DIR || deriveInstallDir(appDir))
const serviceName = process.env.SERVICE_NAME || 'incudal-backend'
const frontendUrl = process.env.FRONTEND_URL || 'https://pay.payincus.com'
const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'https://admin.payincus.com'
const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3001'
const logDir = resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(installDir, 'update-logs'))
const logPath = resolve(process.env.SYSTEM_UPDATE_LOG_PATH || join(logDir, `system-update-${taskId}-rollback.log`))
const defaultExecutionPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const executionPath = process.env.PATH ? `${process.env.PATH}:${defaultExecutionPath}` : defaultExecutionPath

function deriveInstallDir(resolvedAppDir: string): string {
  if (resolvedAppDir.endsWith('/current')) return dirname(resolvedAppDir)

  const releasesDir = dirname(resolvedAppDir)
  if (releasesDir.endsWith('/releases')) return dirname(releasesDir)

  return resolvedAppDir
}

function now(): string {
  return new Date().toISOString()
}

async function log(message: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `[${now()}] ${message}\n`)
}

async function run(command: string, args: string[], options: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  await log(`$ ${command} ${args.join(' ')}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || installDir,
      env: { ...process.env, PATH: executionPath, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let timeout: NodeJS.Timeout | null = null
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
      }, options.timeoutMs)
    }
    child.stdout.on('data', data => void appendFile(logPath, data))
    child.stderr.on('data', data => void appendFile(logPath, data))
    child.on('error', reject)
    child.on('close', code => {
      if (timeout) clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
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
  const nextLink = join(getReleasesDir(), `.next-current-rollback-${taskId}-${Date.now()}`)
  await rm(nextLink, { force: true })
  await symlink(targetDir, nextLink)
  await rename(nextLink, currentLink)
  await log(`Switched current release to ${targetDir}`)
}

async function chownInstallDir(): Promise<void> {
  if (process.platform !== 'linux') return
  try {
    await run('id', ['incudal'], { timeoutMs: 30000 })
  } catch {
    await log('Skipping ownership fix: user incudal does not exist')
    return
  }
  await run('chown', ['-R', 'incudal:incudal', installDir], { timeoutMs: 120000 })
}

async function main(): Promise<void> {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new Error('Invalid task id')
  }

  const task = await prisma.systemUpdateTask.findUnique({ where: { id: taskId } })
  if (!task?.backupPath) {
    throw new Error('Task backup path is missing')
  }
  const backupPath = resolve(task.backupPath)
  const backupIsLegacy = backupPath.startsWith(resolve(`${installDir}.bak.`))
  const backupIsAtomicRelease = backupPath.startsWith(resolve(getReleasesDir()))
  if ((!backupIsLegacy && !backupIsAtomicRelease) || !existsSync(backupPath)) {
    throw new Error('Backup path is invalid or does not exist')
  }

  const claimed = await tryMarkSystemUpdateTaskRunning(taskId, ['success', 'failed'], logPath)
  if (!claimed) {
    await log(`System rollback task ${taskId} is already claimed or not rollbackable; skipping duplicate worker`)
    return
  }

  try {
    const rollbackBackup = `${installDir}.pre-rollback.${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`
    if (backupIsAtomicRelease && await isAtomicReleaseLayout()) {
      const currentTarget = await getCurrentReleaseTarget()
      if (currentTarget) {
        await log(`Preserving current release before rollback: ${rollbackBackup}`)
        await cp(currentTarget, rollbackBackup, { recursive: true, preserveTimestamps: true })
      }
      await switchCurrentRelease(backupPath)
    } else {
      await log(`Preserving current install before rollback: ${rollbackBackup}`)
      if (existsSync(installDir)) {
        await cp(installDir, rollbackBackup, { recursive: true, preserveTimestamps: true })
        await rm(installDir, { recursive: true, force: true })
      }
      await cp(backupPath, installDir, { recursive: true, preserveTimestamps: true })
    }
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

    await prisma.systemUpdateTask.update({
      where: { id: taskId },
      data: {
        status: 'rolled_back',
        finishedAt: new Date(),
        logPath,
        errorMessage: null
      }
    })
    await log('Rollback completed successfully')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`ROLLBACK ERROR: ${message}`)
    await prisma.systemUpdateTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        logPath,
        errorMessage: message.slice(0, 5000)
      }
    })
    process.exitCode = 1
  } finally {
    await closePrismaDatabase()
  }
}

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error)
  await log(`FATAL: ${message}`).catch(() => undefined)
  await closePrismaDatabase().catch(() => undefined)
  process.exit(1)
})
