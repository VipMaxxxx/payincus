import { execFile, spawn } from 'child_process'
import { mkdir, readFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createSystemUpdateTask,
  getSystemUpdateTask,
  hasRunningSystemUpdateTask,
  listSystemUpdateTasks,
  markSystemUpdateTaskFinished,
  serializeSystemUpdateTask
} from '../db/system-update-tasks.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import {
  checkForUpdates,
  getCurrentVersionMetadata,
  getProjectRoot,
  isGitRepository,
  isValidReleaseTag
} from '../lib/system-version.js'

interface StartUpdateBody {
  targetVersion: string
}

interface TaskParams {
  id: string
}

const execFileAsync = promisify(execFile)

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function parsePositiveId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function getAllowedUpdaterAdminIds(): Set<number> {
  return new Set(
    (process.env.SYSTEM_UPDATE_ALLOWED_ADMIN_IDS || '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(id => Number.isSafeInteger(id) && id > 0)
  )
}

function canManageSystemUpdates(user: { id: number; username: string; role: 'admin' | 'user' }): boolean {
  if (user.role !== 'admin') return false
  const allowedIds = getAllowedUpdaterAdminIds()
  if (allowedIds.size > 0) {
    return allowedIds.has(user.id)
  }
  return user.username === 'admin'
}

function getLogDir(root: string): string {
  return resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(root, 'update-logs'))
}

function spawnUpdater(scriptName: string, args: string[], logPath: string): void {
  const root = getProjectRoot()
  const scriptPath = process.env.NODE_ENV === 'production'
    ? `server/dist/scripts/${scriptName.replace(/\.ts$/, '.js')}`
    : `server/src/scripts/${scriptName}`
  const nodeArgs = scriptPath.endsWith('.ts')
    ? ['--import', 'tsx', scriptPath, ...args]
    : [scriptPath, ...args]
  const child = spawn(process.execPath, nodeArgs, {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      INCUDAL_APP_DIR: root,
      SYSTEM_UPDATE_LOG_PATH: logPath,
      SYSTEM_UPDATE_LOG_DIR: getLogDir(root)
    }
  })
  child.unref()
}

async function startSystemUpdateWorker(mode: 'update' | 'rollback', taskId: number, scriptName: string, args: string[], logPath: string): Promise<void> {
  if (process.platform === 'linux' && process.env.NODE_ENV === 'production' && process.env.SYSTEM_UPDATE_USE_SYSTEMD !== 'false') {
    const unitName = mode === 'rollback'
      ? `incudal-online-rollback@${taskId}.service`
      : `incudal-online-update@${taskId}.service`
    await execFileAsync('sudo', ['-n', 'systemctl', 'start', '--no-block', unitName], {
      cwd: getProjectRoot(),
      timeout: 30000
    })
    return
  }

  spawnUpdater(scriptName, args, logPath)
}

async function requireUpdateManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!canManageSystemUpdates(user)) {
    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.denied',
      `Denied system update access for ${user.username}`,
      LogResult.WARNING
    )
    reply.code(403).send({ error: 'Super administrator privileges required', code: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

export default async function systemUpdateRoutes(fastify: FastifyInstance) {
  fastify.get('/version', {
    onRequest: [fastify.authenticateAdmin]
  }, async (_request: FastifyRequest) => {
    return { version: await getCurrentVersionMetadata() }
  })

  fastify.get('/check', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest) => {
    const result = await checkForUpdates()
    return {
      ...result,
      canManageUpdates: canManageSystemUpdates(getRequestUser(request))
    }
  })

  fastify.get('/tasks', {
    onRequest: [fastify.authenticateAdmin]
  }, async (_request: FastifyRequest) => {
    const tasks = await listSystemUpdateTasks(30)
    return { tasks: tasks.map(serializeSystemUpdateTask) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    return { task: serializeSystemUpdateTask(task) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id/logs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    if (!task.logPath) return { logs: '' }

    const root = getProjectRoot()
    const logDir = getLogDir(root)
    const logPath = resolve(task.logPath)
    if (logPath !== logDir && !logPath.startsWith(`${logDir}${sep}`)) {
      return reply.code(403).send({ error: 'Log path is outside update log directory', code: 'LOG_PATH_FORBIDDEN' })
    }

    try {
      const logs = await readFile(logPath, 'utf8')
      return { logs: logs.slice(-200000) }
    } catch {
      return { logs: '' }
    }
  })

  fastify.post<{ Body: StartUpdateBody }>('/start', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['targetVersion'],
        additionalProperties: false,
        properties: {
          targetVersion: { type: 'string', minLength: 5, maxLength: 64 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: StartUpdateBody }>, reply: FastifyReply) => {
    if (!(await requireUpdateManager(request, reply))) return
    const targetVersion = request.body.targetVersion.trim()
    if (!isValidReleaseTag(targetVersion)) {
      return reply.code(400).send({ error: 'Target version must be a release tag like v1.2.3', code: 'INVALID_TARGET_VERSION' })
    }
    if (!(await isGitRepository())) {
      return reply.code(409).send({
        error: 'Current deployment directory is not a Git working tree',
        code: 'GIT_REPOSITORY_REQUIRED'
      })
    }
    if (await hasRunningSystemUpdateTask()) {
      return reply.code(409).send({ error: 'Another update task is already running', code: 'UPDATE_TASK_RUNNING' })
    }

    const user = getRequestUser(request)
    const root = getProjectRoot()
    const logDir = getLogDir(root)
    await mkdir(logDir, { recursive: true })

    const current = await getCurrentVersionMetadata(root)
    const task = await createSystemUpdateTask({
      targetVersion,
      fromVersion: current.version,
      startedByUserId: user.id,
      logPath: join(logDir, `system-update-pending-${Date.now()}.log`)
    })
    const logPath = join(logDir, `system-update-${task.id}.log`)

    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.start',
      `Started system update from ${current.version} to ${targetVersion}`,
      LogResult.SUCCESS
    )
    try {
      await startSystemUpdateWorker('update', task.id, 'run-system-update-task.ts', [String(task.id), targetVersion], logPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markSystemUpdateTaskFinished(task.id, {
        status: 'failed',
        errorMessage: `Failed to start system update worker: ${message}`,
        backupPath: null
      })
      return reply.code(500).send({ error: 'Failed to start system update worker', code: 'UPDATE_WORKER_START_FAILED' })
    }
    return reply.code(202).send({ task: serializeSystemUpdateTask({ ...task, logPath }) })
  })

  fastify.post<{ Params: TaskParams }>('/tasks/:id/rollback', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    if (!(await requireUpdateManager(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    if (!task.backupPath) return reply.code(400).send({ error: 'Task has no backup path', code: 'BACKUP_MISSING' })
    if (await hasRunningSystemUpdateTask()) {
      return reply.code(409).send({ error: 'Another update task is already running', code: 'UPDATE_TASK_RUNNING' })
    }

    const user = getRequestUser(request)
    const root = getProjectRoot()
    const logDir = getLogDir(root)
    await mkdir(logDir, { recursive: true })
    const logPath = join(logDir, `system-update-${id}-rollback.log`)
    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.rollback',
      `Started rollback for system update task #${id}`,
      LogResult.WARNING
    )
    try {
      await startSystemUpdateWorker('rollback', id, 'rollback-system-update-task.ts', [String(id)], logPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markSystemUpdateTaskFinished(id, {
        status: 'failed',
        errorMessage: `Failed to start rollback worker: ${message}`,
        backupPath: task.backupPath
      })
      return reply.code(500).send({ error: 'Failed to start rollback worker', code: 'ROLLBACK_WORKER_START_FAILED' })
    }
    return reply.code(202).send({ taskId: id, logPath })
  })
}
