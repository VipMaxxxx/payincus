import '../config/env.js'
import { appendFile, cp, mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import { prisma, closePrismaDatabase } from '../db/prisma.js'

const taskId = Number(process.argv[2])
const installDir = resolve(process.env.INSTALL_DIR || process.env.INCUDAL_APP_DIR || process.cwd())
const serviceName = process.env.SERVICE_NAME || 'incudal-backend'
const frontendUrl = process.env.FRONTEND_URL || 'https://pay.payincus.com'
const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'https://admin.payincus.com'
const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3001'
const logDir = resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(installDir, 'update-logs'))
const logPath = resolve(process.env.SYSTEM_UPDATE_LOG_PATH || join(logDir, `system-update-${taskId}-rollback.log`))

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
      env: { ...process.env, ...options.env },
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

async function main(): Promise<void> {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new Error('Invalid task id')
  }

  const task = await prisma.systemUpdateTask.findUnique({ where: { id: taskId } })
  if (!task?.backupPath) {
    throw new Error('Task backup path is missing')
  }
  const backupPath = resolve(task.backupPath)
  if (!backupPath.startsWith(resolve(`${installDir}.bak.`)) || !existsSync(backupPath)) {
    throw new Error('Backup path is invalid or does not exist')
  }

  await prisma.systemUpdateTask.update({
    where: { id: taskId },
    data: { status: 'running', logPath, errorMessage: null }
  })

  try {
    const rollbackBackup = `${installDir}.pre-rollback.${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`
    await log(`Preserving current install before rollback: ${rollbackBackup}`)
    if (existsSync(installDir)) {
      await cp(installDir, rollbackBackup, { recursive: true, preserveTimestamps: true })
      await rm(installDir, { recursive: true, force: true })
    }
    await cp(backupPath, installDir, { recursive: true, preserveTimestamps: true })
    await mkdir(join(installDir, '.npm'), { recursive: true })
    await mkdir(join(installDir, '.cache'), { recursive: true })
    await mkdir(join(installDir, 'server/certs'), { recursive: true })
    await run('bash', ['-lc', `if id incudal >/dev/null 2>&1; then chown -R incudal:incudal ${JSON.stringify(installDir)}; fi`], { timeoutMs: 120000 })
    await run('systemctl', ['restart', serviceName], { timeoutMs: 120000 })
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
