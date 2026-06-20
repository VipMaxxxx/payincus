/**
 * 快照管理路由
 * 处理实例快照的创建、列表、删除、恢复等操作
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import { createSnapshot, deleteSnapshot, restoreSnapshot } from '../lib/incus/incus-snapshots.js'
import { sendNotification } from '../lib/notifier.js'
import { checkSnapshotQuota } from '../db/quota-operations.js'
import type { CreateSnapshotRequest } from '../types/api.js'
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

export default async function snapshotRoutes(fastify: FastifyInstance) {

  // 获取实例的快照列表
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/snapshots', {
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

    // 从数据库获取快照列表
    const snapshots = await db.getSnapshotsByInstanceId(instanceIdNum)

    return snapshots.map(s => ({
      id: s.id,
      name: s.name,
      incusName: s.incus_name,
      description: s.description,
      stateful: Boolean(s.stateful),
      size: s.size,
      created_at: s.created_at
    }))
  })

  // 创建快照
  fastify.post<{
    Params: { instanceId: string }
    Body: CreateSnapshotRequest
  }>('/:instanceId/snapshots', {
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
    Body: CreateSnapshotRequest
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

    // 封停状态不允许创建快照
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 实例必须是运行或停止状态
    if (!['running', 'stopped'].includes(instance.status)) {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return

    // 检查配额
    const quotaCheck = await checkSnapshotQuota(instance.user_id, instanceIdNum)
    if (!quotaCheck.allowed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_SNAPSHOT_EXCEEDED, quotaCheck.message))
    }

    // 生成 Incus 快照名称
    const timestamp = Date.now()
    const incusName = `snap-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${timestamp}`

    try {
      // 获取宿主机信息并创建 Incus 客户端
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }
      const client = await getIncusClient(host)

      // 在 Incus 中创建快照
      await createSnapshot(client, instance.incus_id, incusName)

      // 保存到数据库
      const snapshotId = await db.createSnapshot({
        instanceId: instanceIdNum,
        incusName,
        name,
        description,
        stateful: false
      })

      // 发送通知
      await sendNotification(request.user.id, 'snapshot_created', {
        instanceName: instance.name,
        snapshotName: name,
        hostName: host.name
      })

      await createLog(request.user.id, 'snapshot', 'snapshot.create', `Created snapshot "${name}" for instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      reply.code(201).send({
        message: 'Snapshot created',
        snapshot: {
          id: snapshotId,
          name,
          incusName,
          description,
          stateful: false
        }
      })
    } catch (err) {
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.create', `Failed to create snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to create snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    }
  })

  // 删除快照
  fastify.delete<{ Params: { instanceId: string; snapshotId: string } }>('/:instanceId/snapshots/:snapshotId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string; snapshotId: string } }>, reply: FastifyReply) => {
    const { instanceId, snapshotId } = request.params
    const instanceIdNum = Number(instanceId)
    const snapshotIdNum = Number(snapshotId)

    if (isNaN(instanceIdNum) || isNaN(snapshotIdNum)) {
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

    // 获取快照信息
    const snapshot = await db.getSnapshotById(snapshotIdNum)
    if (!snapshot || snapshot.instance_id !== instanceIdNum) {
      return reply.code(404).send(apiError(ErrorCode.SNAPSHOT_NOT_FOUND))
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

      // 在 Incus 中删除快照
      await deleteSnapshot(client, instance.incus_id, snapshot.incus_name)

      // 从数据库删除
      await db.deleteSnapshot(snapshotIdNum)

      // 发送通知
      await sendNotification(request.user.id, 'snapshot_deleted', {
        instanceName: instance.name,
        snapshotName: snapshot.name,
        hostName: host.name
      })

      await createLog(request.user.id, 'snapshot', 'snapshot.delete', `Deleted snapshot "${snapshot.name}" of instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      return { message: 'Snapshot deleted' }
    } catch (err) {
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.delete', `Failed to delete snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to delete snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    }
  })

  // 恢复快照
  fastify.post<{
    Params: { instanceId: string; snapshotId: string }
    Body: Record<string, never>
  }>('/:instanceId/snapshots/:snapshotId/restore', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { instanceId: string; snapshotId: string }; Body: Record<string, never> }>, reply: FastifyReply) => {
    const { instanceId, snapshotId } = request.params
    const instanceIdNum = Number(instanceId)
    const snapshotIdNum = Number(snapshotId)

    if (isNaN(instanceIdNum) || isNaN(snapshotIdNum)) {
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

    // 获取快照信息
    const snapshot = await db.getSnapshotById(snapshotIdNum)
    if (!snapshot || snapshot.instance_id !== instanceIdNum) {
      return reply.code(404).send(apiError(ErrorCode.SNAPSHOT_NOT_FOUND))
    }

    // 封停状态不允许恢复快照
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 实例必须停止才能恢复
    if (instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.SNAPSHOT_RESTORE_REQUIRES_STOP))
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

      // 在 Incus 中恢复快照
      await restoreSnapshot(client, instance.incus_id, snapshot.incus_name)

      // 发送通知
      await sendNotification(request.user.id, 'snapshot_restored', {
        instanceName: instance.name,
        snapshotName: snapshot.name,
        hostName: host.name
      })

      await createLog(request.user.id, 'snapshot', 'snapshot.restore', `Restored instance "${instance.name}" to snapshot "${snapshot.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      return { message: 'Snapshot restored' }
    } catch (err) {
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.restore', `Failed to restore snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to restore snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    }
  })

  // 获取自动快照策略
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/snapshot-policy', {
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

    const policy = await db.getSnapshotPolicy(instanceIdNum)

    return policy ? {
      enabled: Boolean((policy as { enabled?: number }).enabled),
      interval_minutes: (policy as { intervalMinutes?: number }).intervalMinutes || 360,
      last_run_at: (policy as { lastRunAt?: string | null }).lastRunAt || null,
      next_run_at: (policy as { nextRunAt?: string | null }).nextRunAt || null
    } : {
      enabled: false,
      interval_minutes: 360,
      last_run_at: null,
      next_run_at: null
    }
  })

  // 设置自动快照策略
  fastify.put<{
    Params: { instanceId: string }
    Body: { enabled: boolean; intervalMinutes?: number }
  }>('/:instanceId/snapshot-policy', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          intervalMinutes: { type: 'integer', enum: [10, 60, 360, 1440] } // 10分钟, 1小时, 6小时, 24小时
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

    const { enabled, intervalMinutes = 360 } = request.body

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

    // 如果启用自动快照，检查配额
    if (enabled) {
      // 检查实例配额
      const instanceLimit = instance.snapshot_limit
      if (instanceLimit === null || instanceLimit <= 0) {
        return reply.code(400).send(apiError(ErrorCode.QUOTA_NOT_ALLOCATED))
      }
    }

    await db.upsertSnapshotPolicy(instanceIdNum, {
      enabled,
      intervalMinutes
    })

    return { message: 'Auto snapshot policy updated' }
  })
}

