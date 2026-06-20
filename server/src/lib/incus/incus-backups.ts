/**
 * Incus 备份管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusBackup, CreateBackupOptions } from '../../types/incus.js'

/**
 * 获取实例的备份列表
 */
export async function listBackups(client: IncusClient, instanceName: string): Promise<IncusBackup[]> {
  return client.request<IncusBackup[]>('GET', `/1.0/instances/${instanceName}/backups`)
}

/**
 * 获取备份详情
 */
export async function getBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string
): Promise<IncusBackup> {
  return client.request<IncusBackup>(
    'GET',
    `/1.0/instances/${instanceName}/backups/${backupName}`
  )
}

/**
 * 创建备份
 */
export async function createBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string,
  options: CreateBackupOptions = {}
): Promise<unknown> {
  return client.request('POST', `/1.0/instances/${instanceName}/backups`, {
    name: backupName,
    instance_only: options.instanceOnly !== false, // 默认不包含快照
    optimized_storage: options.optimizedStorage !== false, // 默认优化存储
    compression_algorithm: options.compression || 'gzip'
  })
}

/**
 * 删除备份
 */
export async function deleteBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string
): Promise<unknown> {
  return client.request('DELETE', `/1.0/instances/${instanceName}/backups/${backupName}`)
}

/**
 * 导出备份（下载）
 * 返回备份文件的 URL
 */
export function getBackupExportUrl(
  client: IncusClient,
  instanceName: string,
  backupName: string
): string {
  return `${client.baseUrl}/1.0/instances/${instanceName}/backups/${backupName}/export`
}

/**
 * 获取备份导出流
 * 用于流式传输备份文件到客户端
 * 备份文件可能很大，需要更长的超时时间
 */
export async function getBackupExportStream(
  client: IncusClient,
  instanceName: string,
  backupName: string
): Promise<{ stream: ReadableStream<Uint8Array>; contentLength?: number }> {
  if (!client.agent) {
    throw new Error('Incus 客户端未连接')
  }

  const { Agent, request } = await import('undici')
  const { readFileSync } = await import('fs')
  const url = `${client.baseUrl}/1.0/instances/${instanceName}/backups/${backupName}/export`

  // 为大文件传输创建专用 Agent，设置更长的超时
  // 连接超时 60 秒，无 body 超时（流式传输）
  let exportAgent: InstanceType<typeof Agent> | null = null

  try {
    // 读取证书（从 client 获取路径）
    if (!client.certPath || !client.keyPath) {
      throw new Error('Certificate path not configured')
    }

    const cert = readFileSync(client.certPath)
    const key = readFileSync(client.keyPath)

    exportAgent = new Agent({
      connect: {
        cert,
        key,
        rejectUnauthorized: false,
        timeout: 60000 // 连接超时 60 秒
      },
      bodyTimeout: 0, // 禁用 body 超时，允许长时间传输
      headersTimeout: 60000 // headers 超时 60 秒
    })

    const response = await request(url, {
      method: 'GET',
      dispatcher: exportAgent
    })

    if (response.statusCode !== 200) {
      const text = await response.body.text()
      await exportAgent.close()
      throw new Error(`导出备份失败: ${text || response.statusCode}`)
    }

    // 获取 Content-Length（如果有）
    const contentLengthHeader = response.headers['content-length']
    const contentLength = contentLengthHeader ? parseInt(String(contentLengthHeader), 10) : undefined

    // 保存 agent 引用以便在流结束时关闭
    const agentToClose = exportAgent

    // 将 undici 的 body 转换为 Web ReadableStream
    const webStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of response.body) {
            controller.enqueue(chunk)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        } finally {
          // 流结束后关闭专用 agent
          await agentToClose.close().catch(() => { })
        }
      },
      cancel() {
        // 流被取消时也要关闭 agent
        agentToClose.close().catch(() => { })
      }
    })

    return { stream: webStream, contentLength }
  } catch (err) {
    // 出错时确保关闭 agent
    if (exportAgent) {
      await exportAgent.close().catch(() => { })
    }
    throw err
  }
}

/**
 * 从备份恢复实例
 */
export async function restoreFromBackup(
  client: IncusClient,
  newInstanceName: string,
  backupData: Record<string, unknown>
): Promise<unknown> {
  return client.request('POST', '/1.0/instances', {
    name: newInstanceName,
    source: {
      type: 'backup',
      ...backupData
    }
  })
}

