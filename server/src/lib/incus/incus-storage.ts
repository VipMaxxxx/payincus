/**
 * Incus 存储池管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusStoragePool } from '../../types/incus.js'

export interface CreateStoragePoolOptions {
  name: string
  driver: 'zfs' | 'lvm' | 'btrfs' | 'dir'
  config: Record<string, string>
  description?: string
}

export interface StoragePoolWithResources extends IncusStoragePool {
  resources?: {
    space?: {
      used: number
      total: number
    }
  }
}

/**
 * 获取存储池列表
 * Incus API 返回 URL 列表，需要分别请求每个存储池的详情
 */
export async function listStoragePools(client: IncusClient): Promise<IncusStoragePool[]> {
  // Incus 返回 URL 列表如 ["/1.0/storage-pools/default"]
  const poolUrls = await client.request<string[]>('GET', '/1.0/storage-pools')
  
  // 如果返回为空，直接返回空数组
  if (!poolUrls || poolUrls.length === 0) {
    return []
  }

  // 分别获取每个存储池的详情
  const pools = await Promise.all(
    poolUrls.map(async (url) => {
      // 从 URL 提取存储池名称: "/1.0/storage-pools/default" -> "default"
      const name = url.split('/').pop() || ''
      if (!name) return null
      
      try {
        return await getStoragePool(client, name)
      } catch {
        // 单个存储池获取失败，返回基本信息
        return { name, driver: 'unknown', config: {} }
      }
    })
  )

  return pools.filter((p): p is IncusStoragePool => p !== null)
}

/**
 * 获取存储池详情
 */
export async function getStoragePool(client: IncusClient, name: string): Promise<IncusStoragePool> {
  return client.request<IncusStoragePool>('GET', `/1.0/storage-pools/${name}`)
}

/**
 * 获取存储池资源使用情况
 */
export async function getStoragePoolResources(client: IncusClient, name: string): Promise<{ space?: { used: number; total: number } }> {
  return client.request<{ space?: { used: number; total: number } }>('GET', `/1.0/storage-pools/${name}/resources`)
}

/**
 * 创建存储池
 */
export async function createStoragePool(client: IncusClient, options: CreateStoragePoolOptions): Promise<void> {
  await client.request('POST', '/1.0/storage-pools', {
    name: options.name,
    driver: options.driver,
    config: options.config,
    description: options.description || ''
  })
}

/**
 * 删除存储池
 */
export async function deleteStoragePool(client: IncusClient, name: string): Promise<void> {
  await client.request('DELETE', `/1.0/storage-pools/${name}`)
}

/**
 * 修改存储池配置
 * 使用 PATCH 方法进行部分更新
 */
export interface UpdateStoragePoolOptions {
  config?: Record<string, string>
  description?: string
}

export async function updateStoragePool(client: IncusClient, name: string, options: UpdateStoragePoolOptions): Promise<void> {
  const payload: Record<string, unknown> = {}
  
  if (options.config) {
    payload.config = options.config
  }
  if (options.description !== undefined) {
    payload.description = options.description
  }
  
  await client.request('PATCH', `/1.0/storage-pools/${name}`, payload)
}
