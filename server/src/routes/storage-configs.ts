/**
 * 远程存储配置路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { encryptSensitiveData } from '../lib/security.js'
import { StorageFactory } from '../storage/factory.js'
import { normalizeStorageBasePath } from '../storage/path.js'
import type { StorageType } from '@prisma/client'
import { assertSafeStorageTarget, OutboundTargetValidationError } from '../lib/outbound-security.js'

interface CreateStorageConfigBody {
    name: string
    type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
    host: string
    port?: number
    username?: string
    password?: string
    basePath?: string
    extra?: Record<string, unknown>
    isDefault?: boolean
}

interface UpdateStorageConfigBody {
    name?: string
    type?: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
    host?: string
    port?: number | null
    username?: string | null
    password?: string | null
    basePath?: string | null
    extra?: Record<string, unknown> | null
    isDefault?: boolean
}

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
    if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
        return null
    }

    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

export default async function storageConfigRoutes(fastify: FastifyInstance) {
    async function validateStorageTarget(type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3', host: string): Promise<void> {
        if (type === 'S3') {
            return
        }

        try {
            await assertSafeStorageTarget(type, host)
        } catch (error) {
            if (error instanceof OutboundTargetValidationError) {
                throw new Error(error.message)
            }
            throw error
        }
    }

    // 获取用户的存储配置列表
    fastify.get('/', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest, _reply: FastifyReply) => {
        const configs = await db.getStorageConfigsByUserId(request.user.id)

        // 不返回密码
        return configs.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            host: c.host,
            port: c.port,
            username: c.username,
            basePath: c.basePath,
            extra: c.extra,
            isDefault: c.isDefault,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString()
        }))
    })

    // 创建存储配置
    fastify.post<{ Body: CreateStorageConfigBody }>('/', {
        onRequest: [fastify.authenticate],
        schema: {
            body: {
                type: 'object',
                required: ['name', 'type', 'host'],
                properties: {
                    name: { type: 'string', minLength: 1, maxLength: 50 },
                    type: { type: 'string', enum: ['WEBDAV', 'FTP', 'SFTP', 'S3'] },
                    host: { type: 'string', minLength: 1, maxLength: 255 },
                    port: { type: 'integer', minimum: 1, maximum: 65535 },
                    username: { type: 'string', maxLength: 100 },
                    password: { type: 'string', maxLength: 255 },
                    basePath: { type: 'string', maxLength: 255 },
                    extra: { type: 'object' },
                    isDefault: { type: 'boolean' }
                }
            }
        }
    }, async (request: FastifyRequest<{ Body: CreateStorageConfigBody }>, reply: FastifyReply) => {
        const { name, type, host, port, username, password, basePath, extra, isDefault } = request.body

        // S3 暂不支持
        if (type === 'S3') {
            return reply.code(400).send(apiError(ErrorCode.STORAGE_TYPE_NOT_SUPPORTED, 'S3 存储暂未实现'))
        }

        try {
            await validateStorageTarget(type, host)
            normalizeStorageBasePath(basePath)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, errorMessage))
        }

        try {
            // 加密密码
            const encryptedPassword = password ? encryptSensitiveData(password) : null
            const normalizedBasePath = normalizeStorageBasePath(basePath)

            const config = await db.createStorageConfig({
                userId: request.user.id,
                name,
                type: type as StorageType,
                host,
                port,
                username,
                password: encryptedPassword,
                basePath: normalizedBasePath || null,
                extra,
                isDefault
            })

            await createLog(
                request.user.id,
                'storage',
                'storage.create',
                `Created storage config "${name}" (${type})`,
                'success'
            )

            return {
                id: config.id,
                name: config.name,
                type: config.type,
                host: config.host,
                port: config.port,
                username: config.username,
                basePath: config.basePath,
                extra: config.extra,
                isDefault: config.isDefault,
                createdAt: config.createdAt.toISOString()
            }
        } catch (err) {
            fastify.log.error(err)
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(500).send(apiError(ErrorCode.STORAGE_CONFIG_CREATE_FAILED, errorMessage))
        }
    })

    // 更新存储配置
    fastify.patch<{
        Params: { id: string }
        Body: UpdateStorageConfigBody
    }>('/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string', minLength: 1, maxLength: 50 },
                    type: { type: 'string', enum: ['WEBDAV', 'FTP', 'SFTP', 'S3'] },
                    host: { type: 'string', minLength: 1, maxLength: 255 },
                    port: { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
                    username: { type: ['string', 'null'], maxLength: 100 },
                    password: { type: ['string', 'null'], maxLength: 255 },
                    basePath: { type: ['string', 'null'], maxLength: 255 },
                    extra: { type: ['object', 'null'] },
                    isDefault: { type: 'boolean' }
                }
            }
        }
    }, async (request: FastifyRequest<{
        Params: { id: string }
        Body: UpdateStorageConfigBody
    }>, reply: FastifyReply) => {
        const id = parsePositiveRouteId(request.params.id)
        if (!id) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 验证归属
        const existing = await db.getStorageConfigById(id)
        if (!existing) {
            return reply.code(404).send(apiError(ErrorCode.STORAGE_CONFIG_NOT_FOUND))
        }
        // 管理员只管理系统层面，不参与用户存储配置操作
        if (existing.userId !== request.user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        const { password, type, ...rest } = request.body

        // S3 暂不支持
        if (type === 'S3') {
            return reply.code(400).send(apiError(ErrorCode.STORAGE_TYPE_NOT_SUPPORTED, 'S3 存储暂未实现'))
        }

        let normalizedBasePathPatch: string | null | undefined
        try {
            const nextType = (type || existing.type) as 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
            const nextHost = request.body.host || existing.host
            await validateStorageTarget(nextType, nextHost)
            if (request.body.basePath !== undefined) {
                normalizedBasePathPatch = request.body.basePath === null
                    ? null
                    : normalizeStorageBasePath(request.body.basePath) || null
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, errorMessage))
        }

        try {
            const updateData: Record<string, unknown> = { ...rest }
            if (type) updateData.type = type

            // 如果提供了新密码，加密它
            if (password !== undefined) {
                updateData.password = password ? encryptSensitiveData(password) : null
            }
            if (normalizedBasePathPatch !== undefined) {
                updateData.basePath = normalizedBasePathPatch
            }

            const config = await db.updateStorageConfig(id, updateData as Parameters<typeof db.updateStorageConfig>[1])

            await createLog(
                request.user.id,
                'storage',
                'storage.update',
                `Updated storage config "${config.name}"`,
                'success'
            )

            return {
                id: config.id,
                name: config.name,
                type: config.type,
                host: config.host,
                port: config.port,
                username: config.username,
                basePath: config.basePath,
                extra: config.extra,
                isDefault: config.isDefault,
                updatedAt: config.updatedAt.toISOString()
            }
        } catch (err) {
            fastify.log.error(err)
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(500).send(apiError(ErrorCode.STORAGE_CONFIG_UPDATE_FAILED, errorMessage))
        }
    })

    // 删除存储配置
    fastify.delete<{ Params: { id: string } }>('/:id', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const id = parsePositiveRouteId(request.params.id)
        if (!id) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 验证归属
        const existing = await db.getStorageConfigById(id)
        if (!existing) {
            return reply.code(404).send(apiError(ErrorCode.STORAGE_CONFIG_NOT_FOUND))
        }
        // 管理员只管理系统层面，不参与用户存储配置操作
        if (existing.userId !== request.user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        // 检查是否有活跃的上传任务
        const activeTaskCount = await db.countActiveTasksForStorageConfig(id)
        if (activeTaskCount > 0) {
            return reply.code(409).send({
                error: 'STORAGE_HAS_ACTIVE_TASKS',
                message: `该存储配置有 ${activeTaskCount} 个上传任务正在进行中，请等待完成后再删除`
            })
        }

        try {
            await db.deleteStorageConfig(id)

            await createLog(
                request.user.id,
                'storage',
                'storage.delete',
                `Deleted storage config "${existing.name}"`,
                'success'
            )

            return { message: 'Storage config deleted' }
        } catch (err) {
            fastify.log.error(err)
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(500).send(apiError(ErrorCode.STORAGE_CONFIG_DELETE_FAILED, errorMessage))
        }
    })

    // 测试存储配置连接
    fastify.post<{ Params: { id: string } }>('/:id/test', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const id = parsePositiveRouteId(request.params.id)
        if (!id) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 验证归属
        const config = await db.getStorageConfigById(id)
        if (!config) {
            return reply.code(404).send(apiError(ErrorCode.STORAGE_CONFIG_NOT_FOUND))
        }
        // 管理员只管理系统层面，不参与用户存储配置操作
        if (config.userId !== request.user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        try {
            const provider = StorageFactory.create(config)
            await provider.testConnection()

            return { success: true, message: '连接测试成功' }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            return reply.code(400).send({
                success: false,
                error: 'CONNECTION_TEST_FAILED',
                message: errorMessage
            })
        }
    })

    // 设置默认存储配置
    fastify.post<{ Params: { id: string } }>('/:id/set-default', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const id = parsePositiveRouteId(request.params.id)
        if (!id) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 验证归属
        const config = await db.getStorageConfigById(id)
        if (!config) {
            return reply.code(404).send(apiError(ErrorCode.STORAGE_CONFIG_NOT_FOUND))
        }
        // 管理员只管理系统层面，不参与用户存储配置操作
        if (config.userId !== request.user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        try {
            await db.setDefaultStorageConfig(request.user.id, id)
            return { success: true, message: '已设为默认' }
        } catch (err) {
            fastify.log.error(err)
            return reply.code(500).send(apiError(ErrorCode.STORAGE_CONFIG_UPDATE_FAILED))
        }
    })
}
