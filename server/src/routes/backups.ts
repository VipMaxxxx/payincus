/**
 * 备份管理路由
 * 处理实例备份的创建、列表、删除、导出等操作
 * 
 * 安全增强：导出任务使用 Redis 存储，支持持久化和分布式部署
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import {
  createBackup as createIncusBackup,
  deleteBackup as deleteIncusBackup,
  getBackupExportStream
} from '../lib/incus/incus-backups.js'
import {
  generateTempInstanceName,
  instanceExists
} from '../lib/incus/incus-restore.js'
import {
  startInstance,
  deleteInstance
} from '../lib/incus/incus-instances.js'
import {
  hasActiveRestoreTask as checkActiveRestoreTask,
  getQueuePosition
} from '../workers/restoreTaskWorker.js'
import { sendNotification } from '../lib/notifier.js'
import { checkBackupQuota } from '../db/quota-operations.js'
import {
  createExportTask,
  getExportTask,
  updateExportTaskStatus,
  deleteExportTask
} from '../lib/security.js'
import type { CreateBackupRequest } from '../types/api.js'
import {
    generateDownloadToken,
    consumeDownloadToken
} from '../lib/download-token.js'
import { checkInstancePermission } from '../lib/permission.js'

// 检查实例是否被转移锁定
async function checkTransferLock(instanceId: number, reply: FastifyReply): Promise<boolean> {
  const hasPending = await db.hasPendingTransfer(instanceId)
  if (hasPending) {
    reply.code(400).send(apiError(ErrorCode.TRANSFER_INSTANCE_LOCKED))
    return true
  }
  return false
}

// 恢复任务现在使用数据库存储，由 restoreTaskWorker 处理

export default async function backupRoutes(fastify: FastifyInstance) {

  // 获取实例的备份列表
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/backups', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const instanceIdNum = Number(instanceId)

    if (isNaN(instanceIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 从数据库获取备份列表
    const backups = await db.getBackupsByInstanceId(instanceIdNum)

    return backups.map(b => ({
      id: b.id,
      name: b.name,
      incusName: b.incus_name,
      description: b.description,
      size: b.size,
      status: b.status,
      created_at: b.created_at,
      expires_at: b.expires_at
    }))
  })

  // 创建备份
  fastify.post<{
    Params: { instanceId: string }
    Body: CreateBackupRequest
  }>('/:instanceId/backups', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { instanceId: string }
    Body: CreateBackupRequest
  }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const instanceIdNum = Number(instanceId)

    if (isNaN(instanceIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { name, description } = request.body

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许创建备份
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 检查配额
    const quotaCheck = await checkBackupQuota(instance.user_id, instanceIdNum)
    if (!quotaCheck.allowed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_BACKUP_EXCEEDED, quotaCheck.message))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return

    // 生成 Incus 备份名称
    const timestamp = Date.now()
    const incusName = `backup-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${timestamp}`

    try {
      // 获取宿主机信息并创建 Incus 客户端
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }
      const client = await getIncusClient(host)

      // 先保存到数据库（状态为 creating）
      const backupId = await db.createBackup({
        instanceId: instanceIdNum,
        incusName,
        name,
        description
      })

      // 在 Incus 中创建备份（异步操作）
      createIncusBackup(client, instance.incus_id, incusName, {
        instanceOnly: true,
        optimizedStorage: true
      }).then(async () => {
        // 备份创建成功
        await db.updateBackupStatus(backupId, 'ready')

        // 发送通知
        await sendNotification(request.user.id, 'backup_created', {
          instanceName: instance.name,
          backupName: name,
          hostName: host.name
        })

        await createLog(request.user.id, 'backup', 'backup.create', `Created backup "${name}" for instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })
        fastify.log.info(`Backup ${backupId} created successfully`)
      }).catch(async (err: unknown) => {
        // 备份创建失败
        const errorMessage = err instanceof Error ? err.message : String(err)
        await db.updateBackupStatus(backupId, 'error', errorMessage)
        await createLog(request.user.id, 'backup', 'backup.create', `Failed to create backup for instance "${instance.name}": ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
        fastify.log.error(`Backup ${backupId} failed: ${errorMessage}`)
      })

      reply.code(202).send({
        message: 'Backup creating',
        backup: {
          id: backupId,
          name,
          incusName,
          description,
          status: 'creating'
        }
      })
    } catch (err) {
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(500).send(apiError(ErrorCode.BACKUP_CREATE_FAILED, errorMessage))
    }
  })

  // 删除备份
  fastify.delete<{ Params: { instanceId: string; backupId: string } }>('/:instanceId/backups/:backupId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string; backupId: string } }>, reply: FastifyReply) => {
    const { instanceId, backupId } = request.params
    const instanceIdNum = Number(instanceId)
    const backupIdNum = Number(backupId)

    if (isNaN(instanceIdNum) || isNaN(backupIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取备份信息
    const backup = await db.getBackupById(backupIdNum)
    if (!backup || backup.instance_id !== instanceIdNum) {
      return reply.code(404).send(apiError(ErrorCode.BACKUP_NOT_FOUND))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return



    try {
      // 获取宿主机信息并创建 Incus 客户端
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }
      const client = await getIncusClient(host)

      // 在 Incus 中删除备份
      try {
        await deleteIncusBackup(client, instance.incus_id, backup.incus_name)
      } catch (incusErr) {
        // 如果 Incus 中不存在，继续删除数据库记录
        fastify.log.warn(`Backup ${backup.incus_name} not found in Incus, proceeding with DB deletion`)
      }

      // 从数据库删除（软删除）
      await db.deleteBackup(backupIdNum)

      // 发送通知
      await sendNotification(request.user.id, 'backup_deleted', {
        instanceName: instance.name,
        backupName: backup.name,
        hostName: host.name
      })

      await createLog(request.user.id, 'backup', 'backup.delete', `Deleted backup "${backup.name}" of instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      return { message: 'Backup deleted' }
    } catch (err) {
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'backup', 'backup.delete', `Failed to delete backup: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send(apiError(ErrorCode.BACKUP_DELETE_FAILED, errorMessage))
    }
  })

  // 获取自动备份策略
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/backup-policy', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const instanceIdNum = Number(instanceId)

    if (isNaN(instanceIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const policy = await db.getBackupPolicy(instanceIdNum)

    return policy ? {
      enabled: Boolean((policy as { enabled?: number }).enabled),
      interval_minutes: (policy as { intervalMinutes?: number }).intervalMinutes || 1440,
      last_run_at: (policy as { lastRunAt?: string | null }).lastRunAt || null,
      next_run_at: (policy as { nextRunAt?: string | null }).nextRunAt || null
    } : {
      enabled: false,
      interval_minutes: 1440,
      last_run_at: null,
      next_run_at: null
    }
  })

  // 设置自动备份策略
  fastify.put<{
    Params: { instanceId: string }
    Body: { enabled: boolean; intervalMinutes?: number }
  }>('/:instanceId/backup-policy', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          intervalMinutes: { type: 'integer', enum: [60, 360, 1440, 4320] } // 1小时, 6小时, 24小时, 3天
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { instanceId: string }
    Body: { enabled: boolean; intervalMinutes?: number }
  }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const instanceIdNum = Number(instanceId)

    if (isNaN(instanceIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { enabled, intervalMinutes = 1440 } = request.body

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // AUTH004: 实例所有者和节点所有者都可以操作备份策略
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 如果启用自动备份，检查配额
    if (enabled) {
      // 检查实例配额
      const instanceLimit = instance.backup_limit
      if (instanceLimit === null || instanceLimit <= 0) {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_QUOTA_NOT_SET))
      }
    }

    await db.upsertBackupPolicy(instanceIdNum, {
      enabled,
      intervalMinutes
    })

    return { message: 'Auto backup policy updated' }
  })

  // ==================== 备份导出功能 ====================

  // 生成导出任务（为现有备份创建导出）
  fastify.post<{
    Params: { instanceId: string; backupId: string }
    Body: Record<string, never>
  }>(
    '/:instanceId/backups/:backupId/export',
    {
      onRequest: [fastify.authenticateUser],
      schema: {
        body: {
          type: 'object',
          properties: {}
        }
      }
    },
    async (request, reply) => {
      const { instanceId, backupId } = request.params
      const instanceIdNum = Number(instanceId)
      const backupIdNum = Number(backupId)

      if (isNaN(instanceIdNum) || isNaN(backupIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份导出/下载仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 获取备份信息
      const backup = await db.getBackupById(backupIdNum)
      if (!backup || backup.instance_id !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.BACKUP_NOT_FOUND))
      }

      if (backup.status !== 'ready') {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_NOT_READY))
      }

      // 生成导出任务 ID
      const taskId = randomUUID()

      // 创建导出任务（存储到 Redis）
      const task = await createExportTask({
        id: taskId,
        instanceId: instanceIdNum,
        backupId: backupIdNum,
        incusBackupName: backup.incus_name,
        userId: request.user.id,
        status: 'ready'
      })

      await createLog(
        request.user.id,
        'backup',
        'backup.export',
        `Generated export task for backup "${backup.name}" of instance "${instance.name}"`,
        'success',
        { instanceId: instanceIdNum }
      )

      return {
        taskId,
        status: 'ready',
        expiresAt: new Date(task.expiresAt).toISOString(),
        downloadUrl: `/api/instances/${instanceId}/backups/export/${taskId}/download`
      }
    }
  )

  // 查询导出任务状态
  fastify.get<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/backups/export/:taskId/status',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)

      if (isNaN(instanceIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份导出/下载仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 从 Redis 获取任务
      const task = await getExportTask(taskId)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.EXPORT_TASK_NOT_FOUND))
      }

      // 验证任务所有者
      // AUTH004: 备份导出/下载仅限实例所有者
      if (task.userId !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 检查是否过期
      if (Date.now() > task.expiresAt) {
        await deleteExportTask(taskId)
        return reply.code(410).send(apiError(ErrorCode.EXPORT_TASK_EXPIRED))
      }

      return {
        taskId: task.id,
        status: task.status,
        error: task.error,
        expiresAt: new Date(task.expiresAt).toISOString()
      }
    }
  )

  // 生成一次性下载链接
  // 安全改进：使用短期一次性 token 替代 JWT URL 参数
  fastify.post<{
    Params: { instanceId: string; taskId: string }
  }>(
    '/:instanceId/backups/export/:taskId/download-token',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)

      if (isNaN(instanceIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份导出/下载仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 从存储获取任务
      const task = await getExportTask(taskId)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.EXPORT_TASK_NOT_FOUND))
      }

      // 验证任务所有者
      // AUTH004: 备份导出/下载仅限实例所有者
      if (task.userId !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 检查是否过期
      if (Date.now() > task.expiresAt) {
        await deleteExportTask(taskId)
        return reply.code(410).send(apiError(ErrorCode.EXPORT_TASK_EXPIRED))
      }

      if (task.status !== 'ready') {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_EXPORT_STATUS_INVALID, task.status))
      }

      // 生成一次性下载 token（5分钟有效，仅可使用1次）
      const downloadToken = generateDownloadToken(
        request.user.id,
        taskId,
        'backup-export',
        300,  // 5分钟
        1     // 1次使用
      )

      return {
        downloadUrl: `/api/instances/${instanceId}/backups/export/${taskId}/download?dt=${downloadToken}`,
        expiresIn: 300  // 5分钟
      }
    }
  )

  // 下载导出的备份（流式传输）
  // 安全改进：使用一次性下载 token 验证，不再接受 JWT URL 参数
  fastify.get<{
    Params: { instanceId: string; taskId: string }
    Querystring: { dt?: string }
  }>(
    '/:instanceId/backups/export/:taskId/download',
    {
      // 使用一次性下载 token 验证
      onRequest: async (request, reply) => {
        const { taskId } = request.params
        const downloadToken = (request.query as { dt?: string }).dt

        // 必须提供下载 token
        if (!downloadToken) {
          return reply.code(401).send({
            error: 'Download token required. Use POST /download-token to generate one.',
            code: 'DOWNLOAD_TOKEN_REQUIRED'
          })
        }

        // 验证并消费一次性 token
        const result = consumeDownloadToken(downloadToken, taskId, 'backup-export')
        if (!result.valid) {
          return reply.code(401).send({
            error: result.error || 'Invalid or expired download token',
            code: 'DOWNLOAD_TOKEN_INVALID'
          })
        }

        // 将用户 ID 附加到请求，用于后续验证
        (request as any).downloadTokenUserId = result.userId
      }
    },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const tokenUserId = (request as any).downloadTokenUserId as number

      if (isNaN(instanceIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属（使用 token 中的用户 ID）
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // 从存储获取任务
      const task = await getExportTask(taskId)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.EXPORT_TASK_NOT_FOUND))
      }

      // 验证任务所有者（使用 token 中的用户 ID）
      if (task.userId !== tokenUserId) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 检查是否过期
      if (Date.now() > task.expiresAt) {
        await deleteExportTask(taskId)
        return reply.code(410).send(apiError(ErrorCode.EXPORT_TASK_EXPIRED))
      }

      if (task.status !== 'ready') {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_EXPORT_STATUS_INVALID, task.status))
      }

      try {
        // 获取宿主机信息
        const host = await db.getHostById(instance.host_id)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }

        const client = await getIncusClient(host)

        // 更新任务状态
        await updateExportTaskStatus(taskId, 'downloading')

        // 获取备份信息和用户信息用于文件名
        const backup = await db.getBackupById(task.backupId)
        const user = await db.findUserById(instance.user_id)

        // 使用备份创建日期 (格式: 20231207-153045)
        const backupDate = backup?.created_at ? new Date(backup.created_at) : new Date()
        const dateStr = backupDate.toISOString()
          .replace(/[-:]/g, '')
          .replace('T', '-')
          .slice(0, 15)

        // 文件名格式: 用户名-实例名-备份名-备份日期.tar.gz
        const userName = user?.username || 'unknown'
        const backupName = backup?.name || task.incusBackupName
        const fileName = `${userName}-${instance.name}-${backupName}-${dateStr}.tar.gz`

        // 获取导出流
        const { stream, contentLength } = await getBackupExportStream(
          client,
          instance.incus_id,
          task.incusBackupName
        )

        // 设置响应头，确保浏览器正确处理为流式下载
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
        reply.header('Content-Type', 'application/octet-stream')
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
        reply.header('Pragma', 'no-cache')
        reply.header('Expires', '0')
        reply.header('X-Content-Type-Options', 'nosniff')
        if (contentLength) {
          reply.header('Content-Length', contentLength)
        }

        // 监听响应完成，更新任务状态
        reply.raw.on('close', async () => {
          await updateExportTaskStatus(taskId, 'completed')
          // 下载完成后删除任务
          setTimeout(async () => {
            await deleteExportTask(taskId)
          }, 5000)

          fastify.log.info(`Backup export completed: ${taskId}`)
        })

        reply.raw.on('error', async (err) => {
          await updateExportTaskStatus(taskId, 'error', err.message)
          fastify.log.error(`Backup export error: ${err.message}`)
        })

        // 将 Web ReadableStream 转换为 Node.js Readable
        const nodeStream = Readable.fromWeb(stream as import('stream/web').ReadableStream)

        return reply.send(nodeStream)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await updateExportTaskStatus(taskId, 'error', errorMessage)
        fastify.log.error(`Backup export failed: ${errorMessage}`)
        return reply.code(500).send(apiError(ErrorCode.BACKUP_EXPORT_FAILED, errorMessage))
      }
    }
  )

  // ==================== 备份恢复功能 ====================

  // 从现有备份恢复实例 (使用任务队列)
  fastify.post<{
    Params: { instanceId: string; backupId: string }
    Body: Record<string, never>
  }>(
    '/:instanceId/restore/:backupId',
    {
      onRequest: [fastify.authenticateUser],
      schema: {
        body: {
          type: 'object',
          properties: {}
        }
      }
    },
    async (request, reply) => {
      const { instanceId, backupId } = request.params
      const instanceIdNum = Number(instanceId)
      const backupIdNum = Number(backupId)

      if (isNaN(instanceIdNum) || isNaN(backupIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // 权限检查：管理员、实例所有者、宿主机所有者
      const permResult = await checkInstancePermission(request.user, instance)
      if (!permResult.allowed) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 获取备份信息
      const backup = await db.getBackupById(backupIdNum)
      if (!backup || backup.instance_id !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.BACKUP_NOT_FOUND))
      }

      if (backup.status !== 'ready') {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_NOT_READY))
      }

      // 检查转移锁定
      if (await checkTransferLock(instanceIdNum, reply)) return

      // 检查是否有正在进行的恢复任务
      const activeTask = await checkActiveRestoreTask(instanceIdNum)
      if (activeTask) {
        return reply.code(409).send({
          error: 'RESTORE_IN_PROGRESS',
          message: '该实例已有恢复任务正在进行中',
          taskId: activeTask.id
        })
      }

      // 检查队列长度（防止队列过长）
      const pendingCount = await prisma.restoreTask.count({
        where: {
          hostId: instance.host_id,
          status: 'PENDING'
        }
      })
      const QUEUE_MAX_LENGTH = 10
      if (pendingCount >= QUEUE_MAX_LENGTH) {
        return reply.code(429).send({
          error: 'QUEUE_TOO_LONG',
          message: `队列已满（${pendingCount}/${QUEUE_MAX_LENGTH}），请稍后再试`
        })
      }

      // 创建恢复任务 (写入数据库，由 Worker 调度执行)
      const tempName = generateTempInstanceName(instance.incus_id)

      const taskId = await db.createRestoreTask({
        instanceId: instanceIdNum,
        backupId: backupIdNum,
        hostId: instance.host_id,
        userId: request.user.id,
        tempInstanceName: tempName,
        originalInstanceName: instance.name,
        originalIncusId: instance.incus_id
      })

      await createLog(
        request.user.id,
        'backup',
        'backup.restore',
        `Queued restore task for instance "${instance.name}" from backup "${backup.name}"`,
        'success'
      )

      // 获取队列位置
      const queuePosition = await getQueuePosition(taskId)

      return {
        taskId,
        status: 'PENDING',
        queuePosition,
        message: queuePosition > 1
          ? `恢复任务已加入队列，当前排队位置：第 ${queuePosition} 位`
          : '恢复任务已创建，即将开始执行'
      }
    }
  )

  // 查询恢复任务状态
  fastify.get<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/restore/:taskId',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const taskIdNum = Number(taskId)

      if (isNaN(instanceIdNum) || isNaN(taskIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // 权限检查：管理员、实例所有者、宿主机所有者
      const permResult = await checkInstancePermission(request.user, instance)
      if (!permResult.allowed) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getRestoreTaskById(taskIdNum)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send({
          error: 'RESTORE_TASK_NOT_FOUND',
          message: '恢复任务不存在'
        })
      }

      // 获取队列位置 (仅 PENDING 状态有意义)
      const queuePosition = task.status === 'PENDING'
        ? await getQueuePosition(taskIdNum)
        : 0

      // 计算执行时长（秒）
      let duration: number | null = null
      if (task.startedAt && task.finishedAt) {
        duration = Math.floor((task.finishedAt.getTime() - task.startedAt.getTime()) / 1000)
      } else if (task.startedAt) {
        // 正在执行中，计算已执行时长
        duration = Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
      }

      return {
        taskId: task.id,
        status: task.status,
        error: task.error,
        queuePosition,
        duration,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        finishedAt: task.finishedAt?.toISOString() ?? null
      }
    }
  )

  // 回滚恢复操作
  fastify.post<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/restore/:taskId/rollback',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const taskIdNum = Number(taskId)

      if (isNaN(instanceIdNum) || isNaN(taskIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // 权限检查：管理员、实例所有者、宿主机所有者
      const permResult = await checkInstancePermission(request.user, instance)
      if (!permResult.allowed) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getRestoreTaskById(taskIdNum)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send({
          error: 'RESTORE_TASK_NOT_FOUND',
          message: '恢复任务不存在'
        })
      }

      // 只有失败的任务可以回滚
      if (task.status !== 'FAILED') {
        return reply.code(400).send({
          error: 'ROLLBACK_NOT_ALLOWED',
          message: '只有失败的恢复任务可以回滚'
        })
      }

      try {
        const host = await db.getHostById(instance.host_id)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
        const client = await getIncusClient(host)

        // 删除临时实例（如果存在）
        if (task.tempInstanceName) {
          const tempExists = await instanceExists(client, task.tempInstanceName)
          if (tempExists) {
            try {
              await deleteInstance(client, task.tempInstanceName)
              fastify.log.info(`Deleted temp instance: ${task.tempInstanceName}`)
            } catch (err) {
              fastify.log.warn(`Failed to delete temp instance: ${err}`)
            }
          }
        }

        // 尝试启动原实例
        try {
          await startInstance(client, task.originalIncusId)
        } catch (err) {
          fastify.log.warn(`Failed to start original instance: ${err}`)
        }

        // 更新任务状态 (数据库没有 rolled_back 状态，标记为 FAILED 并记录)
        await db.updateRestoreTaskStatus(taskIdNum, 'FAILED', '用户手动回滚')

        await createLog(
          request.user.id,
          'backup',
          'backup.restore.rollback',
          `Rolled back restore task for instance "${instance.name}"`,
          'success',
          { instanceId: instanceIdNum }
        )

        return {
          success: true,
          message: '回滚完成'
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await createLog(
          request.user.id,
          'backup',
          'backup.restore.rollback',
          `Failed to rollback restore task: ${errorMessage}`,
          'failed',
          { instanceId: instanceIdNum }
        )
        return reply.code(500).send({
          error: 'ROLLBACK_FAILED',
          message: errorMessage
        })
      }
    }
  )

  // 取消恢复任务 (仅 PENDING 状态可取消)
  fastify.delete<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/restore/:taskId',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const taskIdNum = Number(taskId)

      if (isNaN(instanceIdNum) || isNaN(taskIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // 权限检查：管理员、实例所有者、宿主机所有者
      const permResult = await checkInstancePermission(request.user, instance)
      if (!permResult.allowed) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getRestoreTaskById(taskIdNum)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send({
          error: 'RESTORE_TASK_NOT_FOUND',
          message: '恢复任务不存在'
        })
      }

      // 只有 PENDING 状态的任务可以取消
      if (task.status !== 'PENDING') {
        return reply.code(400).send({
          error: 'CANCEL_NOT_ALLOWED',
          message: '只有排队中的任务可以取消'
        })
      }

      await db.updateRestoreTaskStatus(taskIdNum, 'FAILED', '用户取消')

      await createLog(
        request.user.id,
        'backup',
        'backup.restore.cancel',
        `Cancelled restore task for instance "${instance.name}"`,
        'success',
        { instanceId: instanceIdNum }
      )

      return {
        success: true,
        message: '任务已取消'
      }
    }
  )

  // ==================== 备份上传到远程存储 ====================

  // 上传备份到远程存储
  fastify.post<{
    Params: { instanceId: string; backupId: string }
    Body: { storageConfigId?: number }
  }>(
    '/:instanceId/backups/:backupId/upload-remote',
    {
      onRequest: [fastify.authenticateUser],
      schema: {
        body: {
          type: 'object',
          properties: {
            storageConfigId: { type: 'integer' }
          }
        }
      }
    },
    async (request, reply) => {
      const { instanceId, backupId } = request.params
      const instanceIdNum = Number(instanceId)
      const backupIdNum = Number(backupId)

      if (isNaN(instanceIdNum) || isNaN(backupIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份上传仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      // 获取备份信息
      const backup = await db.getBackupById(backupIdNum)
      if (!backup || backup.instance_id !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.BACKUP_NOT_FOUND))
      }

      if (backup.status !== 'ready') {
        return reply.code(400).send(apiError(ErrorCode.BACKUP_NOT_READY))
      }

      // 获取存储配置
      let storageConfig
      if (request.body.storageConfigId) {
        storageConfig = await db.getStorageConfigById(request.body.storageConfigId)
        if (!storageConfig || storageConfig.userId !== request.user.id) {
          return reply.code(404).send(apiError(ErrorCode.STORAGE_CONFIG_NOT_FOUND))
        }
      } else {
        // 使用默认存储配置
        storageConfig = await db.getDefaultStorageConfig(request.user.id)
        if (!storageConfig) {
          return reply.code(400).send({
            error: 'NO_DEFAULT_STORAGE',
            message: '请先在设置中配置远程存储'
          })
        }
      }

      // 检查是否有进行中的上传任务
      const activeTask = await db.hasActiveUploadTask(request.user.id)
      if (activeTask) {
        return reply.code(409).send({
          error: ErrorCode.BACKUP_UPLOAD_IN_PROGRESS,
          message: '您有上传任务正在进行中',
          taskId: activeTask.id
        })
      }

      // 检查队列长度（防止队列过长）
      const pendingCount = await prisma.backupUploadTask.count({
        where: {
          hostId: instance.host_id,
          status: 'PENDING'
        }
      })
      const QUEUE_MAX_LENGTH = 10
      if (pendingCount >= QUEUE_MAX_LENGTH) {
        return reply.code(429).send({
          error: 'QUEUE_TOO_LONG',
          message: `队列已满（${pendingCount}/${QUEUE_MAX_LENGTH}），请稍后再试`
        })
      }

      // 创建上传任务
      const task = await db.createBackupUploadTask({
        userId: request.user.id,
        instanceId: instanceIdNum,
        backupId: backupIdNum,
        hostId: instance.host_id,
        storageConfigId: storageConfig.id
      })

      await createLog(
        request.user.id,
        'backup',
        'backup.upload.queue',
        `Queued backup upload for "${backup.name}" to "${storageConfig.name}"`,
        'success',
        { instanceId: instanceIdNum }
      )

      // 获取队列位置
      const queuePosition = await db.getUploadTaskQueuePosition(task.id)

      return {
        taskId: task.id,
        status: 'PENDING',
        queuePosition,
        storageName: storageConfig.name,
        message: queuePosition > 1
          ? `上传任务已加入队列，当前排队位置：第 ${queuePosition} 位`
          : '上传任务已创建，即将开始执行'
      }
    }
  )

  // 查询上传任务状态
  fastify.get<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/upload-tasks/:taskId',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const taskIdNum = Number(taskId)

      if (isNaN(instanceIdNum) || isNaN(taskIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份上传仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getBackupUploadTaskWithDetails(taskIdNum)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.BACKUP_UPLOAD_TASK_NOT_FOUND))
      }

      // 获取队列位置 (仅 PENDING 状态有意义)
      const queuePosition = task.status === 'PENDING'
        ? await db.getUploadTaskQueuePosition(taskIdNum)
        : 0

      // 计算执行时长（秒）
      let duration: number | null = null
      if (task.startedAt && task.finishedAt) {
        duration = Math.floor((task.finishedAt.getTime() - task.startedAt.getTime()) / 1000)
      } else if (task.startedAt) {
        // 正在执行中，计算已执行时长
        duration = Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
      }

      return {
        taskId: task.id,
        status: task.status,
        error: task.error,
        remoteFileName: task.remoteFileName,
        fileSize: task.fileSize?.toString(),
        storageName: task.storageConfig?.name,
        storageType: task.storageConfig?.type,
        queuePosition,
        duration,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        finishedAt: task.finishedAt?.toISOString() ?? null
      }
    }
  )

  // 取消上传任务 (仅 PENDING 状态可取消)
  fastify.delete<{ Params: { instanceId: string; taskId: string } }>(
    '/:instanceId/upload-tasks/:taskId',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId, taskId } = request.params
      const instanceIdNum = Number(instanceId)
      const taskIdNum = Number(taskId)

      if (isNaN(instanceIdNum) || isNaN(taskIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份上传仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getBackupUploadTaskById(taskIdNum)
      if (!task || task.instanceId !== instanceIdNum) {
        return reply.code(404).send(apiError(ErrorCode.BACKUP_UPLOAD_TASK_NOT_FOUND))
      }

      // 只有 PENDING 状态的任务可以取消
      if (task.status !== 'PENDING') {
        return reply.code(400).send({
          error: 'CANCEL_NOT_ALLOWED',
          message: '只有排队中的任务可以取消'
        })
      }

      await db.cancelBackupUploadTask(taskIdNum)

      await createLog(
        request.user.id,
        'backup',
        'backup.upload.cancel',
        `Cancelled backup upload task`,
        'success',
        { instanceId: instanceIdNum }
      )

      return {
        success: true,
        message: '任务已取消'
      }
    }
  )

  // 获取实例的活跃上传任务（用于前端状态恢复）
  fastify.get<{ Params: { instanceId: string } }>(
    '/:instanceId/upload-tasks/active',
    { onRequest: [fastify.authenticateUser] },
    async (request, reply) => {
      const { instanceId } = request.params
      const instanceIdNum = Number(instanceId)

      if (isNaN(instanceIdNum)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 验证实例归属
      const instance = await db.getInstanceById(instanceIdNum)
      if (!instance) {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }

      // AUTH004: 备份上传仅限实例所有者
      if (instance.user_id !== request.user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }

      const task = await db.getActiveUploadTaskForInstance(instanceIdNum)
      if (!task) {
        return { task: null }
      }

      // 获取队列位置
      const queuePosition = task.status === 'PENDING'
        ? await db.getUploadTaskQueuePosition(task.id)
        : 0

      // 计算执行时长（秒）
      let duration: number | null = null
      if (task.startedAt && task.finishedAt) {
        duration = Math.floor((task.finishedAt.getTime() - task.startedAt.getTime()) / 1000)
      } else if (task.startedAt) {
        // 正在执行中，计算已执行时长
        duration = Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
      }

      return {
        task: {
          taskId: task.id,
          backupId: task.backupId,
          status: task.status,
          storageName: task.storageConfig?.name,
          storageType: task.storageConfig?.type,
          queuePosition,
          duration,
          createdAt: task.createdAt.toISOString(),
          startedAt: task.startedAt?.toISOString() ?? null,
          finishedAt: task.finishedAt?.toISOString() ?? null
        }
      }
    }
  )

  // 恢复工作流已移至 restoreTaskWorker.ts
  // 导出任务现在使用 Redis 存储，自动过期清理
}
