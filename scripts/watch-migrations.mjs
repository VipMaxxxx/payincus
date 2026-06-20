import { createHash } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'

const watchDir = process.env.MIGRATIONS_DIR || '/workspace/server/prisma/migrations'
const intervalMs = Number(process.env.MIGRATION_WATCH_INTERVAL_MS || 3000)

let initialized = false
let lastFingerprint = ''
let isRunning = false
let rerunRequested = false

async function collectFiles(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files)
      continue
    }
    if (!entry.isFile()) continue

    const info = await stat(fullPath)
    files.push({
      path: fullPath,
      size: info.size,
      mtimeMs: Math.trunc(info.mtimeMs)
    })
  }

  return files
}

async function buildFingerprint() {
  try {
    const files = await collectFiles(watchDir)
    files.sort((a, b) => a.path.localeCompare(b.path))

    const hash = createHash('sha1')
    for (const file of files) {
      hash.update(file.path)
      hash.update(':')
      hash.update(String(file.size))
      hash.update(':')
      hash.update(String(file.mtimeMs))
      hash.update('\n')
    }

    return hash.digest('hex')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `missing:${message}`
  }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 1))
  })
}

async function applyMigrations(reason) {
  if (isRunning) {
    rerunRequested = true
    return
  }

  isRunning = true
  console.log(`[MigrationWatcher] Change detected (${reason}). Running migrate deploy...`)

  const deployCode = await runCommand('pnpm', ['--filter', 'server', 'exec', 'prisma', 'migrate', 'deploy'])
  let generateCode = 0
  if (deployCode === 0) {
    generateCode = await runCommand('pnpm', ['--filter', 'server', 'exec', 'prisma', 'generate'])
  }

  if (deployCode === 0 && generateCode === 0) {
    console.log('[MigrationWatcher] Migration sync finished.')
  } else {
    console.error(
      `[MigrationWatcher] Migration sync failed (deploy=${deployCode}, generate=${generateCode}).`
    )
  }

  isRunning = false
  if (rerunRequested) {
    rerunRequested = false
    await applyMigrations('queued rerun')
  }
}

async function tick() {
  const current = await buildFingerprint()
  if (!initialized) {
    initialized = true
    lastFingerprint = current
    console.log(`[MigrationWatcher] Watching ${watchDir} (interval: ${intervalMs}ms).`)
    return
  }

  if (current === lastFingerprint) return

  const previous = lastFingerprint
  lastFingerprint = current
  await applyMigrations(`${previous} -> ${current}`)
}

setInterval(() => {
  tick().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[MigrationWatcher] Tick failed: ${message}`)
  })
}, intervalMs)

tick().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[MigrationWatcher] Initial tick failed: ${message}`)
})
