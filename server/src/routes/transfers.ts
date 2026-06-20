/**
 * 实例转移路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { customAlphabet } from 'nanoid'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { TransferSnapshot } from '../db/transfers.js'
import { createTransferWithFee, getTransferByIdWithFee, refundTransferFee } from '../db/transfers.js'
import { sendNotification } from '../lib/notifier.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { removeDevice } from '../lib/incus/incus-instances.js'
import { deleteSnapshot as deleteIncusSnapshot } from '../lib/incus/incus-snapshots.js'
import { deleteBackup as deleteIncusBackup } from '../lib/incus/incus-backups.js'
import { renameInstance as renameIncusInstance } from '../lib/incus/incus-restore.js'
import { getProxySitesByInstanceId, deleteProxySite } from '../db/proxy-sites.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { prisma } from '../db/prisma.js'

// 自定义 nanoid，只使用小写字母和数字（Incus 不允许下划线）
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

export default async function transferRoutes(fastify: FastifyInstance) {
    // 搜索用户（用于转移时选择接收方）
    fastify.get<{
        Querystring: { username: string }
    }>('/users/search', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{
        Querystring: { username: string }
    }>, reply: FastifyReply) => {
        const { username } = request.query

        if (!username || username.length < 2) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Username must be at least 2 characters'))
        }

        const user = await db.findUserByUsername(username)

        if (!user) {
            return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
        }

        // 不能转移给自己
        if (user.id === request.user.id) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_SELF))
        }

        // 不能转移给被封禁的用户
        if (user.status === 'banned') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_BANNED))
        }

        // 只返回用户基本信息，不再返回配额信息
        return {
            user: {
                id: user.id,
                username: user.username,
                status: user.status
            }
        }
    })

    // 发起转移请求
    fastify.post<{
        Params: { instanceId: string }
        Body: { targetUsername: string; remark?: string }
    }>('/instances/:instanceId/transfer', {
        onRequest: [fastify.authenticateUser],
        schema: {
            body: {
                type: 'object',
                required: ['targetUsername'],
                properties: {
                    targetUsername: { type: 'string', minLength: 2 },
                    remark: { type: 'string', maxLength: 200 }
                }
            }
        }
    }, async (request: FastifyRequest<{
        Params: { instanceId: string }
        Body: { targetUsername: string; remark?: string }
    }>, reply: FastifyReply) => {
        const instanceId = parseInt(request.params.instanceId, 10)
        const { targetUsername, remark } = request.body
        const { user } = request

        if (isNaN(instanceId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 获取实例
        const instance = await db.getInstanceById(instanceId)
        if (!instance) {
            return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        }

        // 验证所有权（只能转移自己的实例）
        if (instance.user_id !== user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        // 检查实例状态
        if (instance.status === 'creating' || instance.status === 'deleted') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_INVALID_STATUS))
        }

        // 封禁状态不允许转移
        // 安全措施：防止用户绕过前端禁用通过API转移封禁实例
        if (instance.status === 'suspended') {
            if (instance.suspend_reason === 'expired') {
                return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
            }
            return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
        }

        // 检查宿主机是否允许转移
        const host = await db.getHostById(instance.host_id)
        if (host && host.transfer_enabled === false) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_HOST_DISABLED))
        }

        // 检查是否已有待处理的转移
        const hasPending = await db.hasPendingTransfer(instanceId)
        if (hasPending) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_ALREADY_PENDING))
        }



        // 查找目标用户
        const targetUser = await db.findUserByUsername(targetUsername)
        if (!targetUser) {
            return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
        }

        // 不能转移给自己
        if (targetUser.id === instance.user_id) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_SELF))
        }

        // 不能转移给被封禁的用户
        if (targetUser.status === 'banned') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_BANNED))
        }

        // 获取实例相关数据（host 已在上方获取）
        const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
        const portMappings = await db.getPortMappings(instanceId)
        const snapshots = await db.getSnapshotsByInstanceId(instanceId)
        const backups = await db.getBackupsByInstanceId(instanceId)

        // 获取转移手续费配置
        const transferFee = await db.getSystemConfigFloat('transfer_fee', 0)
        
        // 如果有手续费，先检查余额是否足够
        if (transferFee > 0) {
            const userBalance = await db.getUserBalance(user.id)
            if (userBalance < transferFee) {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_INSUFFICIENT_BALANCE))
            }
        }

        // 构建快照信息
        const snapshot: TransferSnapshot = {
            packageId: instance.package_id,
            packageName: pkg?.name || null,
            hostId: instance.host_id,
            hostName: host?.name || 'unknown',
            hostLocation: host?.location || null,
            hostCountryCode: host?.country_code || 'us',
            originalName: instance.name,
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            networkMode: instance.network_mode,
            portMappingsCount: portMappings.length,
            snapshotsCount: snapshots.length,
            backupsCount: backups.filter((b: any) => b.status !== 'deleted').length,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
        }

        // 使用事务安全函数创建转移记录（扣费和创建记录在同一事务中）
        // 该函数内部会再次检查是否有 pending 转移，确保并发安全
        let transferId: number
        try {
            const result = await createTransferWithFee({
                instanceId,
                fromUserId: user.id,
                toUserId: targetUser.id,
                snapshot,
                remark,
                fee: transferFee,
                instanceName: instance.name
            })
            transferId = result.transferId
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : ''
            if (errorMsg === 'INSUFFICIENT_BALANCE') {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_INSUFFICIENT_BALANCE))
            }
            if (errorMsg === 'TRANSFER_ALREADY_PENDING') {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_ALREADY_PENDING))
            }
            console.error('[Transfer] Failed to create transfer:', error)
            return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR))
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.create',
            `Created transfer request for instance "${instance.name}" to user "${targetUser.username}"`,
            'success',
            { instanceId }
        )

        // 通知接收方有新的转移请求
        await sendNotification(targetUser.id, 'transfer_received', {
            instanceName: instance.name,
            senderUsername: user.username
        })

        return {
            message: 'Transfer request created',
            transfer: { id: transferId, status: 'pending' }
        }
    })

    // 获取转移列表
    fastify.get<{
        Querystring: {
            type: 'sent' | 'received'
            status?: string
            page?: string
            pageSize?: string
        }
    }>('/', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{
        Querystring: {
            type: 'sent' | 'received'
            status?: string
            page?: string
            pageSize?: string
            search?: string
        }
    }>, reply: FastifyReply) => {
        const { type, status, page = '1', pageSize = '20', search } = request.query
        const { user } = request

        if (!type || !['sent', 'received'].includes(type)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'type must be "sent" or "received"'))
        }

        const options = {
            page: parseInt(page, 10),
            pageSize: parseInt(pageSize, 10),
            status: status as any,
            search: search as string | undefined
        }

        const result = type === 'sent'
            ? await db.getTransfersSent(user.id, options)
            : await db.getTransfersReceived(user.id, options)

        // 对于 sent 类型的 pending 转移，发起方可以直接推送
        const transfersWithCanPush = result.items.map((t: any) => {
            // 只有 sent tab 且状态为 pending 时，发起方可以直接推送
            const canPush = type === 'sent' && t.status === 'pending' && t.fromUserId === user.id
            return {
                    id: t.id,
                    instanceId: t.instanceId,
                    instanceName: t.instance?.name,
                    instanceStatus: t.instance?.status,
                    instanceImage: t.instance?.image,
                    fromUser: t.fromUser ? { id: t.fromUser.id, username: t.fromUser.username, email: t.fromUser.email, avatarStyle: t.fromUser.avatarStyle, avatarBadgeId: t.fromUser.avatarBadgeId ?? null } : null,
                    toUser: t.toUser ? { id: t.toUser.id, username: t.toUser.username, email: t.toUser.email, avatarStyle: t.toUser.avatarStyle, avatarBadgeId: t.toUser.avatarBadgeId ?? null } : null,
                    status: t.status,
                    snapshot: t.snapshot,
                    remark: t.remark,
                    rejectReason: t.rejectReason,
                    createdAt: t.createdAt,
                    acceptedAt: t.acceptedAt,
                    rejectedAt: t.rejectedAt,
                    cancelledAt: t.cancelledAt,
                    canPush
                }
            })

        return {
            transfers: transfersWithCanPush,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages
        }
    })

    // 获取待接收数量
    fastify.get('/pending-count', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest) => {
        const count = await db.getPendingReceivedCount(request.user.id)
        return { count }
    })

    // 获取转移详情
    fastify.get<{ Params: { id: string } }>('/:id', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parseInt(request.params.id, 10)
        const { user } = request

        if (isNaN(transferId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        // 管理员只管理系统层面，只有发起方和接收方可以查看
        if (transfer.fromUserId !== user.id && transfer.toUserId !== user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        return {
            transfer: {
                id: transfer.id,
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name,
                instanceStatus: transfer.instance?.status,
                fromUser: { id: transfer.fromUser.id, username: transfer.fromUser.username, email: transfer.fromUser.email, avatarStyle: transfer.fromUser.avatarStyle, avatarBadgeId: transfer.fromUser.avatarBadgeId ?? null },
                toUser: { id: transfer.toUser.id, username: transfer.toUser.username, email: transfer.toUser.email, avatarStyle: transfer.toUser.avatarStyle, avatarBadgeId: transfer.toUser.avatarBadgeId ?? null },
                status: transfer.status,
                snapshot: transfer.snapshot,
                remark: transfer.remark,
                rejectReason: transfer.rejectReason,
                createdAt: transfer.createdAt,
                acceptedAt: transfer.acceptedAt,
                rejectedAt: transfer.rejectedAt,
                cancelledAt: transfer.cancelledAt
            }
        }
    })

    // 接受转移
    fastify.post<{ Params: { id: string } }>('/:id/accept', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parseInt(request.params.id, 10)
        const { user } = request

        if (isNaN(transferId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        // 使用 updateMany 原子操作，只有 status='pending' 时才更新为 'processing'
        const lockResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                toUserId: user.id  // 同时验证权限
            },
            data: {
                status: 'processing'  // 临时锁定状态
            }
        })

        // 如果没有更新任何记录，说明状态已变化或权限不足
        if (lockResult.count === 0) {
            // 需要区分是不存在、权限不足还是状态已变化
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.toUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending（可能是 processing 或其他）
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取完整的转移信息
        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        // ===== 失败时的回滚函数 =====
        const rollbackToPending = async () => {
            try {
                await prisma.instanceTransfer.update({
                    where: { id: transferId },
                    data: { status: 'pending' }
                })
            } catch (err) {
                console.error('[Transfer] Failed to rollback status:', err)
            }
        }

        // 检查实例是否还存在
        const instance = await db.getInstanceById(transfer.instanceId)
        if (!instance || instance.status === 'deleted') {
            await db.cancelTransfer(transferId)
            return reply.code(400).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        }

        // ===== 检查实例状态：必须是停止状态才能重命名 =====
        if (instance.status === 'running') {
            await rollbackToPending()
            return reply.code(400).send({
                error: 'Instance must be stopped before transfer',
                code: 'INSTANCE_MUST_BE_STOPPED'
            })
        }

        // 注意：不再检查配额，只检查用户状态（已在搜索用户时检查）

        // ===== 获取 Incus 客户端 =====
        const host = await db.getHostById(instance.host_id)
        let client = null
        if (host) {
            try {
                client = await getIncusClient(host)
            } catch (err) {
                console.error('[Transfer] Failed to get Incus client:', err)
            }
        }

        // 必须能连接到宿主机才能继续
        if (!client) {
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Cannot connect to host',
                code: 'HOST_UNAVAILABLE'
            })
        }

        // ===== 1. 先重命名实例（最关键的操作，失败则不影响任何附属资源）=====
        const oldIncusId = instance.incus_id
        const newIncusId = `u${user.id}-${nanoid()}`
        
        try {
            await renameIncusInstance(client, oldIncusId, newIncusId)
            console.log(`[Transfer] Renamed instance from ${oldIncusId} to ${newIncusId}`)
        } catch (err) {
            console.error('[Transfer] Failed to rename instance in Incus:', err)
            await createLog(
                user.id,
                'transfer',
                'transfer.accept',
                `Failed to rename instance "${instance.name}" in Incus: ${err instanceof Error ? err.message : String(err)}`,
                'failed',
                { instanceId: instance.id }
            )
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Failed to rename instance',
                code: 'INCUS_RENAME_FAILED'
            })
        }

        // ===== 2. 计算新名称并更新数据库（在删除附属资源之前！）=====
        const suffix = `（${transfer.fromUser.username}转）`
        let newName = instance.name
        if (!newName.endsWith(suffix)) {
            newName = instance.name + suffix
            if (newName.length > 64) {
                newName = instance.name.substring(0, 64 - suffix.length) + suffix
            }
        }

        // 执行转移（更新所有者、名称和 Incus ID）
        // 注意：如果数据库更新失败，需要尝试回滚 Incus 重命名
        try {
            await db.executeTransfer(
                transferId,
                transfer.instanceId,
                transfer.fromUserId,
                transfer.toUserId,
                newName,
                newIncusId
            )
        } catch (dbErr) {
            console.error('[Transfer] Database update failed:', dbErr)
            // 尝试回滚 Incus 重命名
            try {
                await renameIncusInstance(client, newIncusId, oldIncusId)
                console.log(`[Transfer] Rolled back Incus rename from ${newIncusId} to ${oldIncusId}`)
            } catch (rollbackErr) {
                // 回滚失败，记录严重错误（需要人工干预）
                console.error('[Transfer] CRITICAL: Failed to rollback Incus rename!', {
                    oldIncusId,
                    newIncusId,
                    error: rollbackErr
                })
            }
            await createLog(
                user.id,
                'transfer',
                'transfer.accept',
                `Failed to update database for instance "${instance.name}": ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
                'failed',
                { instanceId: instance.id }
            )
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Failed to update database',
                code: 'DATABASE_ERROR'
            })
        }

        // ===== 3. 数据库更新成功后，删除附属资源（失败仅记录日志，不影响转移结果）=====
        
        // 3.1 删除反代站点（Caddy 远程 + 数据库）
        const proxySites = await getProxySitesByInstanceId(transfer.instanceId)
        if (proxySites.length > 0) {
            if (host?.caddy_enabled && host.caddy_username && host.caddy_password) {
                const targetHost = host.nat_public_ip || host.ip_address
                if (targetHost) {
                    const caddyClient = createCaddyClient({
                        host: targetHost,
                        port: host.caddy_port || 8444,
                        username: host.caddy_username,
                        password: host.caddy_password
                    })
                    for (const site of proxySites) {
                        try {
                            await caddyClient.deleteSite(site.domain)
                        } catch (err) {
                            console.error(`[Transfer] Failed to delete Caddy site (${site.domain}):`, err)
                        }
                    }
                }
            }
            for (const site of proxySites) {
                try {
                    await deleteProxySite(site.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete proxy site DB record (${site.domain}):`, err)
                }
            }
        }

        // 3.2 删除端口映射（Incus 设备 + 数据库）
        // 注意：实例已重命名，设备随实例迁移，所以使用新的 incus_id
        const portMappings = await db.getPortMappings(transfer.instanceId)
        if (portMappings.length > 0) {
            for (const mapping of portMappings) {
                const map = mapping as { id: number; protocol: string; public_port: number }
                const deviceName = `proxy-${map.protocol}-${map.public_port}`
                try {
                    // 使用新的 incus_id 删除设备
                    await removeDevice(client, newIncusId, deviceName)
                } catch (err) {
                    console.error(`[Transfer] Failed to remove port mapping device (${deviceName}):`, err)
                }
                try {
                    await db.deletePortMapping(map.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete port mapping DB record (${map.id}):`, err)
                }
            }
        }

        // 3.3 删除快照（Incus 远程 + 数据库）
        const snapshots = await db.getSnapshotsByInstanceId(transfer.instanceId)
        if (snapshots.length > 0) {
            for (const snapshot of snapshots) {
                try {
                    // 使用新的 incus_id 删除快照
                    await deleteIncusSnapshot(client, newIncusId, snapshot.incus_name)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete snapshot (${snapshot.name}):`, err)
                }
                try {
                    await db.deleteSnapshot(snapshot.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete snapshot DB record (${snapshot.id}):`, err)
                }
            }
        }

        // 3.4 删除备份（Incus 远程 + 数据库软删除）
        const backups = await db.getBackupsByInstanceId(transfer.instanceId)
        if (backups.length > 0) {
            for (const backup of backups) {
                try {
                    // 使用新的 incus_id 删除备份
                    await deleteIncusBackup(client, newIncusId, backup.incus_name)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete backup (${backup.name}):`, err)
                }
                try {
                    await db.deleteBackup(backup.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete backup DB record (${backup.id}):`, err)
                }
            }
        }

        // 3.5 删除快照策略和备份策略
        try {
            await prisma.snapshotPolicy.deleteMany({ where: { instanceId: transfer.instanceId } })
            await prisma.backupPolicy.deleteMany({ where: { instanceId: transfer.instanceId } })
        } catch (err) {
            console.error('[Transfer] Failed to delete policies:', err)
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.accept',
            `Accepted transfer of instance "${instance.name}" from "${transfer.fromUser.username}"`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知发起方转移已被接受
        await sendNotification(transfer.fromUserId, 'transfer_accepted', {
            instanceName: instance.name,
            receiverUsername: user.username
        })

        return { message: 'Transfer accepted' }
    })

    // 拒绝转移
    fastify.post<{
        Params: { id: string }
        Body: { reason?: string }
    }>('/:id/reject', {
        onRequest: [fastify.authenticateUser],
        schema: {
            body: {
                type: 'object',
                properties: {
                    reason: { type: 'string', maxLength: 200 }
                }
            }
        }
    }, async (request: FastifyRequest<{
        Params: { id: string }
        Body: { reason?: string }
    }>, reply: FastifyReply) => {
        const transferId = parseInt(request.params.id, 10)
        const { reason } = request.body
        const { user } = request

        if (isNaN(transferId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        const rejectResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                toUserId: user.id  // 同时验证权限
            },
            data: {
                status: 'rejected',
                rejectReason: reason || null,
                rejectedAt: new Date()
            }
        })

        // 如果没有更新任何记录，需要区分原因
        if (rejectResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.toUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取转移信息用于日志和通知（使用包含fee字段的查询）
        const transfer = await getTransferByIdWithFee(transferId)
        if (!transfer) {
            // 已更新成功但查询失败，直接返回成功
            return { message: 'Transfer rejected' }
        }

        // 退还手续费（如果有）
        if (transfer.fee && Number(transfer.fee) > 0) {
            const refundResult = await refundTransferFee({
                transferId: transfer.id,
                fromUserId: transfer.fromUserId,
                fee: Number(transfer.fee),
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name || 'Unknown',
                reason: 'rejected'
            })
            
            if (!refundResult.success) {
                console.error('[Transfer] Failed to refund transfer fee:', refundResult.error)
            }
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.reject',
            `Rejected transfer of instance "${transfer.instance?.name}" from "${transfer.fromUser.username}"${reason ? `: ${reason}` : ''}`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知发起方转移已被拒绝
        await sendNotification(transfer.fromUserId, 'transfer_rejected', {
            instanceName: transfer.instance?.name || 'Unknown',
            receiverUsername: user.username
        })

        return { message: 'Transfer rejected' }
    })

    // 取消转移
    fastify.post<{ Params: { id: string } }>('/:id/cancel', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parseInt(request.params.id, 10)
        const { user } = request

        if (isNaN(transferId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        const cancelResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                fromUserId: user.id  // 同时验证权限（只有发起方可以取消）
            },
            data: {
                status: 'cancelled',
                cancelledAt: new Date()
            }
        })

        // 如果没有更新任何记录，需要区分原因
        if (cancelResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.fromUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取转移信息用于日志、通知和退款（使用包含fee字段的查询）
        const transfer = await getTransferByIdWithFee(transferId)
        if (!transfer) {
            // 已更新成功但查询失败，直接返回成功
            return { message: 'Transfer cancelled' }
        }

        // 退还手续费（如果有）
        if (transfer.fee && Number(transfer.fee) > 0) {
            const refundResult = await refundTransferFee({
                transferId: transfer.id,
                fromUserId: transfer.fromUserId,
                fee: Number(transfer.fee),
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name || 'Unknown',
                reason: 'cancelled'
            })
            
            if (!refundResult.success) {
                console.error('[Transfer] Failed to refund transfer fee on cancel:', refundResult.error)
            }
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.cancel',
            `Cancelled transfer of instance "${transfer.instance?.name}" to "${transfer.toUser.username}"`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知接收方转移已被取消
        await sendNotification(transfer.toUserId, 'transfer_cancelled', {
            instanceName: transfer.instance?.name || 'Unknown',
            senderUsername: user.username
        })

        return { message: 'Transfer cancelled' }
    })

    // 直接推送（宿主机所有者作为转移发起方时可直接将实例推送给接收方）
    fastify.post<{ Params: { id: string } }>('/:id/push', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parseInt(request.params.id, 10)
        const { user } = request

        if (isNaN(transferId)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        // 使用 updateMany 原子操作，只有 status='pending' 且 fromUserId=user.id 时才更新为 'processing'
        const lockResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                fromUserId: user.id  // 同时验证权限（只有发起方可以推送）
            },
            data: {
                status: 'processing'  // 临时锁定状态
            }
        })

        // 如果没有更新任何记录，说明状态已变化或权限不足
        if (lockResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.fromUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取完整的转移信息
        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        // ===== 失败时的回滚函数 =====
        const rollbackToPending = async () => {
            try {
                await prisma.instanceTransfer.update({
                    where: { id: transferId },
                    data: { status: 'pending' }
                })
            } catch (err) {
                console.error('[Transfer] Failed to rollback status:', err)
            }
        }

        // ===== 检查实例和宿主机 =====
        const instance = await db.getInstanceById(transfer.instanceId)
        if (!instance || instance.status === 'deleted') {
            await db.cancelTransfer(transferId)
            return reply.code(400).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        }

        const host = await db.getHostById(instance.host_id)
        if (!host) {
            await rollbackToPending()
            return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }

        // 权限检查：发起方可以直接推送（已在 lockResult 中通过 fromUserId 验证）

        // ===== 检查实例状态：必须是停止状态才能重命名 =====
        if (instance.status === 'running') {
            await rollbackToPending()
            return reply.code(400).send({
                error: 'Instance must be stopped before transfer',
                code: 'INSTANCE_MUST_BE_STOPPED'
            })
        }

        // ===== 获取 Incus 客户端 =====
        let client = null
        try {
            client = await getIncusClient(host)
        } catch (err) {
            console.error('[Transfer] Failed to get Incus client:', err)
        }

        if (!client) {
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Cannot connect to host',
                code: 'HOST_UNAVAILABLE'
            })
        }

        // ===== 1. 先重命名实例 =====
        const oldIncusId = instance.incus_id
        const newIncusId = `u${transfer.toUserId}-${nanoid()}`
        
        try {
            await renameIncusInstance(client, oldIncusId, newIncusId)
            console.log(`[Transfer] Renamed instance from ${oldIncusId} to ${newIncusId}`)
        } catch (err) {
            console.error('[Transfer] Failed to rename instance in Incus:', err)
            await createLog(
                user.id,
                'transfer',
                'transfer.push',
                `Failed to rename instance "${instance.name}" in Incus: ${err instanceof Error ? err.message : String(err)}`,
                'failed',
                { instanceId: instance.id }
            )
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Failed to rename instance',
                code: 'INCUS_RENAME_FAILED'
            })
        }

        // ===== 2. 计算新名称并更新数据库 =====
        const suffix = `（${user.username}转）`
        let newName = instance.name
        if (!newName.endsWith(suffix)) {
            newName = instance.name + suffix
            if (newName.length > 64) {
                newName = instance.name.substring(0, 64 - suffix.length) + suffix
            }
        }

        try {
            await db.executeTransfer(
                transferId,
                transfer.instanceId,
                transfer.fromUserId,
                transfer.toUserId,
                newName,
                newIncusId
            )
        } catch (dbErr) {
            console.error('[Transfer] Database update failed:', dbErr)
            // 尝试回滚 Incus 重命名
            try {
                await renameIncusInstance(client, newIncusId, oldIncusId)
                console.log(`[Transfer] Rolled back Incus rename from ${newIncusId} to ${oldIncusId}`)
            } catch (rollbackErr) {
                console.error('[Transfer] CRITICAL: Failed to rollback Incus rename!', {
                    oldIncusId,
                    newIncusId,
                    error: rollbackErr
                })
            }
            await createLog(
                user.id,
                'transfer',
                'transfer.push',
                `Failed to update database for instance "${instance.name}": ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
                'failed',
                { instanceId: instance.id }
            )
            await rollbackToPending()
            return reply.code(500).send({
                error: 'Failed to update database',
                code: 'DATABASE_ERROR'
            })
        }

        // ===== 3. 数据库更新成功后，删除附属资源 =====
        
        // 3.1 删除反代站点
        const proxySites = await getProxySitesByInstanceId(transfer.instanceId)
        if (proxySites.length > 0) {
            if (host?.caddy_enabled && host.caddy_username && host.caddy_password) {
                const targetHost = host.nat_public_ip || host.ip_address
                if (targetHost) {
                    const caddyClient = createCaddyClient({
                        host: targetHost,
                        port: host.caddy_port || 8444,
                        username: host.caddy_username,
                        password: host.caddy_password
                    })
                    for (const site of proxySites) {
                        try {
                            await caddyClient.deleteSite(site.domain)
                        } catch (err) {
                            console.error(`[Transfer] Failed to delete Caddy site (${site.domain}):`, err)
                        }
                    }
                }
            }
            for (const site of proxySites) {
                try {
                    await deleteProxySite(site.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete proxy site DB record (${site.domain}):`, err)
                }
            }
        }

        // 3.2 删除端口映射
        const portMappings = await db.getPortMappings(transfer.instanceId)
        if (portMappings.length > 0) {
            for (const mapping of portMappings) {
                const map = mapping as { id: number; protocol: string; public_port: number }
                const deviceName = `proxy-${map.protocol}-${map.public_port}`
                try {
                    await removeDevice(client, newIncusId, deviceName)
                } catch (err) {
                    console.error(`[Transfer] Failed to remove port mapping device (${deviceName}):`, err)
                }
                try {
                    await db.deletePortMapping(map.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete port mapping DB record (${map.id}):`, err)
                }
            }
        }

        // 3.3 删除快照
        const snapshots = await db.getSnapshotsByInstanceId(transfer.instanceId)
        if (snapshots.length > 0) {
            for (const snapshot of snapshots) {
                try {
                    await deleteIncusSnapshot(client, newIncusId, snapshot.incus_name)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete snapshot (${snapshot.name}):`, err)
                }
                try {
                    await db.deleteSnapshot(snapshot.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete snapshot DB record (${snapshot.id}):`, err)
                }
            }
        }

        // 3.4 删除备份
        const backups = await db.getBackupsByInstanceId(transfer.instanceId)
        if (backups.length > 0) {
            for (const backup of backups) {
                try {
                    await deleteIncusBackup(client, newIncusId, backup.incus_name)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete backup (${backup.name}):`, err)
                }
                try {
                    await db.deleteBackup(backup.id)
                } catch (err) {
                    console.error(`[Transfer] Failed to delete backup DB record (${backup.id}):`, err)
                }
            }
        }

        // 3.5 删除快照策略和备份策略
        try {
            await prisma.snapshotPolicy.deleteMany({ where: { instanceId: transfer.instanceId } })
            await prisma.backupPolicy.deleteMany({ where: { instanceId: transfer.instanceId } })
        } catch (err) {
            console.error('[Transfer] Failed to delete policies:', err)
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.push',
            `Pushed instance "${instance.name}" to user "${transfer.toUser.username}"`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知接收方实例已被推送
        await sendNotification(transfer.toUserId, 'transfer_accepted', {
            instanceName: instance.name,
            receiverUsername: transfer.toUser.username
        })

        return { message: 'Transfer pushed successfully' }
    })
}
