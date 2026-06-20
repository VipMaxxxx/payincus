/**
 * Incus 网络管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusNetwork } from '../../types/incus.js'

/**
 * 获取网络列表
 */
export async function listNetworks(client: IncusClient): Promise<IncusNetwork[]> {
  return client.request<IncusNetwork[]>('GET', '/1.0/networks')
}

/**
 * 获取网络详情
 */
export async function getNetwork(client: IncusClient, name: string): Promise<IncusNetwork> {
  return client.request<IncusNetwork>('GET', `/1.0/networks/${name}`)
}

