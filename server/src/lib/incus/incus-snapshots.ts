/**
 * Incus 快照管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusSnapshot } from '../../types/incus.js'

/**
 * 获取快照列表
 */
export async function listSnapshots(client: IncusClient, instanceName: string): Promise<IncusSnapshot[]> {
  return client.request<IncusSnapshot[]>('GET', `/1.0/instances/${instanceName}/snapshots`)
}

/**
 * 获取快照详情
 */
export async function getSnapshot(
  client: IncusClient,
  instanceName: string,
  snapshotName: string
): Promise<IncusSnapshot> {
  return client.request<IncusSnapshot>(
    'GET',
    `/1.0/instances/${instanceName}/snapshots/${snapshotName}`
  )
}

/**
 * 创建快照
 */
export async function createSnapshot(
  client: IncusClient,
  instanceName: string,
  snapshotName: string
): Promise<unknown> {
  return client.request('POST', `/1.0/instances/${instanceName}/snapshots`, {
    name: snapshotName
  })
}

/**
 * 删除快照
 */
export async function deleteSnapshot(
  client: IncusClient,
  instanceName: string,
  snapshotName: string
): Promise<unknown> {
  return client.request('DELETE', `/1.0/instances/${instanceName}/snapshots/${snapshotName}`)
}

/**
 * 恢复快照
 */
export async function restoreSnapshot(
  client: IncusClient,
  instanceName: string,
  snapshotName: string
): Promise<unknown> {
  return client.request('PUT', `/1.0/instances/${instanceName}`, {
    restore: snapshotName
  })
}

/**
 * 重命名快照
 */
export async function renameSnapshot(
  client: IncusClient,
  instanceName: string,
  snapshotName: string,
  newName: string
): Promise<unknown> {
  return client.request('POST', `/1.0/instances/${instanceName}/snapshots/${snapshotName}`, {
    name: newName
  })
}

