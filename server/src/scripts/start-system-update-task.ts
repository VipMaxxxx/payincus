import '../config/env.js'
import { mkdir } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import { prisma, closePrismaDatabase } from '../db/prisma.js'
import { createSystemUpdateTask, hasRunningSystemUpdateTask, serializeSystemUpdateTask } from '../db/system-update-tasks.js'
import { getCurrentVersionMetadata, isGitRepository, isValidReleaseTag } from '../lib/system-version.js'

const targetVersion = String(process.argv[2] || '').trim()
const appDir = resolve(process.env.INCUDAL_APP_DIR || process.cwd())
const installDir = resolve(process.env.INSTALL_DIR || deriveInstallDir(appDir))
const logDir = resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(installDir, 'update-logs'))

function deriveInstallDir(resolvedAppDir: string): string {
  if (resolvedAppDir.endsWith('/current')) return dirname(resolvedAppDir)

  const releasesDir = dirname(resolvedAppDir)
  if (releasesDir.endsWith('/releases')) return dirname(releasesDir)

  return resolvedAppDir
}

async function findUpdaterUserId(): Promise<number> {
  const configured = Number(process.env.SYSTEM_UPDATE_STARTED_BY_USER_ID || '')
  if (Number.isSafeInteger(configured) && configured > 0) {
    const user = await prisma.user.findFirst({
      where: { id: configured, role: 'admin', status: 'active' },
      select: { id: true }
    })
    if (user) return user.id
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'admin', status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true }
  })
  if (!admin) {
    throw new Error('No active administrator found for system update task')
  }
  return admin.id
}

async function main(): Promise<void> {
  if (!isValidReleaseTag(targetVersion)) {
    throw new Error('Usage: pnpm update:online v1.2.3')
  }
  if (!(await isGitRepository(appDir))) {
    throw new Error('Current deployment directory is not a Git working tree; online updates require a Git checkout with release tags.')
  }
  if (await hasRunningSystemUpdateTask()) {
    throw new Error('Another system update task is already running')
  }

  await mkdir(logDir, { recursive: true })
  const current = await getCurrentVersionMetadata(appDir)
  const startedByUserId = await findUpdaterUserId()
  const task = await createSystemUpdateTask({
    targetVersion,
    fromVersion: current.version,
    startedByUserId,
    logPath: join(logDir, `system-update-pending-${Date.now()}.log`)
  })
  const logPath = join(logDir, `system-update-${task.id}.log`)
  const runnerPath = process.env.NODE_ENV === 'production'
    ? 'server/dist/scripts/run-system-update-task.js'
    : 'server/src/scripts/run-system-update-task.ts'
  const runnerArgs = runnerPath.endsWith('.ts')
    ? ['--import', 'tsx', runnerPath, String(task.id), targetVersion]
    : [runnerPath, String(task.id), targetVersion]
  const child = spawn(process.execPath, runnerArgs, {
    cwd: appDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      INCUDAL_APP_DIR: appDir,
      INSTALL_DIR: installDir,
      SYSTEM_UPDATE_LOG_DIR: logDir,
      SYSTEM_UPDATE_LOG_PATH: logPath
    }
  })
  child.unref()
  console.log(JSON.stringify({ task: serializeSystemUpdateTask({ ...task, logPath }) }, null, 2))
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await closePrismaDatabase()
  })
