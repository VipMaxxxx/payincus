/**
 * 存储池数据库操作
 */

import { prisma } from './prisma.js'
import type { StoragePurpose } from '@prisma/client'

const DEFAULT_STORAGE_POOL_NAME = 'default'

export interface CreateStoragePoolData {
  hostId: number
  name: string
  driver: string
  purpose: string
  description?: string | null
  config?: Record<string, string>
}

/**
 * 创建存储池记录
 */
export async function createStoragePool(data: CreateStoragePoolData) {
  return prisma.storagePool.create({
    data: {
      hostId: data.hostId,
      name: data.name,
      driver: data.driver,
      purpose: data.purpose as StoragePurpose,
      description: data.description || null,
      config: data.config || {}
    }
  })
}

/**
 * 删除存储池记录
 */
export async function deleteStoragePool(hostId: number, name: string) {
  return prisma.storagePool.deleteMany({
    where: {
      hostId,
      name
    }
  })
}

/**
 * 获取宿主机的存储池列表
 */
export async function getStoragePoolsByHostId(hostId: number) {
  return prisma.storagePool.findMany({
    where: { hostId },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * 获取宿主机的系统盘存储池列表 (purpose = 'instance_data')
 * 用于创建实例时随机选择存储池
 */
export async function getSystemDiskPoolsByHostId(hostId: number) {
  return prisma.storagePool.findMany({
    where: {
      hostId,
      purpose: 'instance_data'
    },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * 随机选择一个系统盘存储池
 * 返回存储池名称，如果没有配置系统盘存储池则返回 null
 */
export async function getRandomSystemDiskPool(hostId: number): Promise<string | null> {
  const pools = await getSystemDiskPoolsByHostId(hostId)
  if (pools.length === 0) {
    return null
  }
  const randomIndex = Math.floor(Math.random() * pools.length)
  return pools[randomIndex].name
}

/**
 * 检查宿主机上是否存在指定存储池。
 * 对已落库实例，允许继续使用 "default" 回退池，避免因未登记到 storage_pools 表而丢失选择。
 */
export async function hasStoragePool(hostId: number, poolName: string): Promise<boolean> {
  if (!poolName) return false
  if (poolName === DEFAULT_STORAGE_POOL_NAME) return true

  const pool = await prisma.storagePool.findUnique({
    where: {
      hostId_name: {
        hostId,
        name: poolName
      }
    },
    select: { id: true }
  })

  return !!pool
}

/**
 * 检查指定存储池是否可作为系统盘池使用。
 */
export async function isSystemDiskPool(hostId: number, poolName: string): Promise<boolean> {
  if (!poolName) return false
  if (poolName === DEFAULT_STORAGE_POOL_NAME) return true

  const pool = await prisma.storagePool.findFirst({
    where: {
      hostId,
      name: poolName,
      purpose: 'instance_data'
    },
    select: { id: true }
  })

  return !!pool
}

/**
 * 获取套餐在指定宿主机上配置的默认系统盘池。
 */
export async function getPackageHostStoragePool(packageId: number, hostId: number): Promise<string | null> {
  const packageHost = await prisma.packageHost.findUnique({
    where: {
      packageId_hostId: {
        packageId,
        hostId
      }
    },
    select: {
      storagePoolName: true
    }
  })

  return packageHost?.storagePoolName ?? null
}

/**
 * 解析新实例应使用的存储池。
 * 优先使用套餐在当前宿主机上的显式配置，其次回退到随机系统盘池。
 */
export async function resolveStoragePoolForNewInstance(
  hostId: number,
  options: {
    packageId?: number | null
  } = {}
): Promise<string | null> {
  const { packageId } = options

  if (packageId) {
    const configuredPool = await getPackageHostStoragePool(packageId, hostId)
    if (configuredPool && await isSystemDiskPool(hostId, configuredPool)) {
      return configuredPool
    }
  }

  return getRandomSystemDiskPool(hostId)
}

/**
 * 解析已有实例后续操作应使用的存储池。
 * 优先复用实例已记录的实际池名，避免重建/恢复时因套餐配置变更而迁移到其他盘。
 */
export async function resolveStoragePoolForExistingInstance(
  instanceId: number,
  hostId: number,
  options: {
    packageId?: number | null
  } = {}
): Promise<string | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      storagePoolName: true
    }
  })

  if (instance?.storagePoolName && await hasStoragePool(hostId, instance.storagePoolName)) {
    return instance.storagePoolName
  }

  return resolveStoragePoolForNewInstance(hostId, options)
}

/**
 * 获取存储池详情
 */
export async function getStoragePool(hostId: number, name: string) {
  return prisma.storagePool.findUnique({
    where: {
      hostId_name: {
        hostId,
        name
      }
    }
  })
}

/**
 * 更新存储池记录
 */
export interface UpdateStoragePoolData {
  description?: string
  config?: Record<string, string>
}

export async function updateStoragePool(hostId: number, name: string, data: UpdateStoragePoolData) {
  const updateData: Record<string, unknown> = {}
  
  if (data.description !== undefined) {
    updateData.description = data.description
  }
  if (data.config !== undefined) {
    updateData.config = data.config
  }

  return prisma.storagePool.updateMany({
    where: {
      hostId,
      name
    },
    data: updateData
  })
}
