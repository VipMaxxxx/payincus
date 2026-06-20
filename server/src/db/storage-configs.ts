/**
 * 远程存储配置数据库操作
 */

import { prisma } from './prisma.js'
import type { StorageConfig, StorageType } from '@prisma/client'

/**
 * 获取用户的存储配置列表
 */
export async function getStorageConfigsByUserId(userId: number): Promise<StorageConfig[]> {
    return prisma.storageConfig.findMany({
        where: { userId },
        orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
        ]
    })
}

/**
 * 根据 ID 获取存储配置
 */
export async function getStorageConfigById(id: number): Promise<StorageConfig | null> {
    return prisma.storageConfig.findUnique({
        where: { id }
    })
}

/**
 * 获取用户的默认存储配置
 */
export async function getDefaultStorageConfig(userId: number): Promise<StorageConfig | null> {
    return prisma.storageConfig.findFirst({
        where: { userId, isDefault: true }
    })
}

/**
 * 创建存储配置
 */
export async function createStorageConfig(data: {
    userId: number
    name: string
    type: StorageType
    host: string
    port?: number | null
    username?: string | null
    password?: string | null
    basePath?: string | null
    extra?: Record<string, unknown> | null
    isDefault?: boolean
}): Promise<StorageConfig> {
    // 如果设为默认，先取消其他默认
    if (data.isDefault) {
        await prisma.storageConfig.updateMany({
            where: { userId: data.userId, isDefault: true },
            data: { isDefault: false }
        })
    }

    return prisma.storageConfig.create({
        data: {
            userId: data.userId,
            name: data.name,
            type: data.type,
            host: data.host,
            port: data.port ?? null,
            username: data.username ?? null,
            password: data.password ?? null,
            basePath: data.basePath ?? null,
            extra: data.extra as object | undefined,
            isDefault: data.isDefault ?? false
        }
    })
}

/**
 * 更新存储配置
 */
export async function updateStorageConfig(
    id: number,
    data: {
        name?: string
        type?: StorageType
        host?: string
        port?: number | null
        username?: string | null
        password?: string | null
        basePath?: string | null
        extra?: Record<string, unknown> | null
        isDefault?: boolean
    }
): Promise<StorageConfig> {
    const config = await prisma.storageConfig.findUnique({ where: { id } })
    if (!config) throw new Error('存储配置不存在')

    // 如果设为默认，先取消其他默认
    if (data.isDefault) {
        await prisma.storageConfig.updateMany({
            where: { userId: config.userId, isDefault: true, id: { not: id } },
            data: { isDefault: false }
        })
    }

    // 处理 extra 字段的 null 值
    const updateData = { ...data }
    if (updateData.extra === null) {
        updateData.extra = undefined
    }

    return prisma.storageConfig.update({
        where: { id },
        data: updateData as Parameters<typeof prisma.storageConfig.update>[0]['data']
    })
}

/**
 * 删除存储配置
 */
export async function deleteStorageConfig(id: number): Promise<void> {
    await prisma.storageConfig.delete({
        where: { id }
    })
}

/**
 * 设置默认存储配置
 */
export async function setDefaultStorageConfig(userId: number, id: number): Promise<void> {
    // 先取消所有默认
    await prisma.storageConfig.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false }
    })

    // 设置新的默认
    await prisma.storageConfig.update({
        where: { id },
        data: { isDefault: true }
    })
}
