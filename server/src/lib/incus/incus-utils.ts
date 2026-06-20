/**
 * Incus 客户端工具函数
 */

import { request } from 'undici'
import type { IncusClient } from './incus-client.js'
import type { IncusApiResponse, IncusOperation } from '../../types/incus.js'

/**
 * 等待异步操作完成
 * @param timeout 超时时间（毫秒），默认 120 秒
 */
export async function waitForOperation(
  client: IncusClient,
  operationUrl: string,
  timeout: number = 300000 // 从 120000 放宽到 300000 (5分钟)
): Promise<unknown> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const op = await client.request<IncusOperation>('GET', `${operationUrl}/wait?timeout=10`)

    if (op.status === 'Success') {
      return op.metadata
    }

    if (op.status === 'Failure') {
      throw new Error(op.err || op.error || '操作失败')
    }
  }

  throw new Error('Operation timeout (5 minutes)')
}

/**
 * 等待异步操作完成（长超时）
 */
export async function waitForOperationLong(
  client: IncusClient,
  operationUrl: string,
  timeout: number = 600000
): Promise<unknown> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    // Wait up to 30 seconds per poll
    const waitTimeout = Math.min(30, Math.floor((timeout - (Date.now() - startTime)) / 1000))
    if (waitTimeout <= 0) break

    try {
      // Use /wait endpoint for long polling
      const waitUrl = `${client.baseUrl}${operationUrl}/wait?timeout=${waitTimeout}`

      const response = await request(waitUrl, {
        method: 'GET',
        dispatcher: client.agent!,
        headers: { 'Content-Type': 'application/json' }
      })

      const text = await response.body.text()

      let data: IncusApiResponse
      try {
        data = JSON.parse(text) as IncusApiResponse
      } catch {
        console.error(`[Incus] 解析响应失败: ${text.substring(0, 200)}`)
        throw new Error(`无效的响应: ${text.substring(0, 100)}`)
      }

      // Check operation status in metadata
      const opStatus = (data.metadata as IncusOperation)?.status || (data as unknown as { status?: string }).status
      const opStatusCode = (data.metadata as IncusOperation)?.status_code || (data as unknown as { status_code?: number }).status_code

      if (opStatus === 'Success' || opStatusCode === 200) {
        return data.metadata || data
      }

      if (opStatus === 'Failure' || (opStatusCode && opStatusCode >= 400)) {
        const errMsg = (data.metadata as IncusOperation)?.err ||
          (data as unknown as { error?: string }).error ||
          (data.metadata as IncusOperation)?.error ||
          '操作失败'
        console.error(`[Incus] 操作失败: ${errMsg}`)
        throw new Error(errMsg)
      }

      // Still running, continue polling

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (errorMessage.includes('操作失败') || errorMessage.includes('Failure')) {
        throw err
      }
      console.error(`[Incus] 轮询出错: ${errorMessage}`)
      // Brief pause before retry
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  throw new Error('Image download timeout (10 minutes)')
}

/**
 * 将 Incus 实例状态转换为系统状态
 * 注意：返回的状态必须与数据库 Instance.status 类型兼容
 * 有效状态: 'creating' | 'running' | 'stopped' | 'error' | 'deleted'
 */
export function mapInstanceStatus(incusStatus: string): string {
  const statusMap: Record<string, string> = {
    'Running': 'running',
    'Stopped': 'stopped',
    'Frozen': 'stopped',     // Frozen 映射为 stopped（对用户来说都是不可用状态）
    'Error': 'error',
    'Starting': 'creating',  // Starting 映射为 creating（启动中）
    'Stopping': 'running'    // Stopping 映射为 running（还未完全停止，等下次同步）
  }
  return statusMap[incusStatus] || 'unknown'
}

