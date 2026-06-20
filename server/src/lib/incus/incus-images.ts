/**
 * Incus 镜像管理
 */

import { request } from 'undici'
import type { IncusClient } from './incus-client.js'
import type { IncusImage, IncusImageAlias, PullImageOptions } from '../../types/incus.js'
import { waitForOperationLong } from './incus-utils.js'

/**
 * 获取镜像列表
 */
export async function listImages(client: IncusClient): Promise<IncusImage[]> {
  const urls = await client.request<string[]>('GET', '/1.0/images')
  const images: IncusImage[] = []
  
  for (const url of urls || []) {
    const fingerprint = url.split('/').pop() || ''
    const image = await getImage(client, fingerprint)
    images.push(image)
  }
  
  return images
}

/**
 * 获取镜像详情
 */
export async function getImage(client: IncusClient, fingerprint: string): Promise<IncusImage> {
  return client.request<IncusImage>('GET', `/1.0/images/${fingerprint}`)
}

/**
 * 获取镜像别名列表
 */
export async function listImageAliases(client: IncusClient): Promise<IncusImageAlias[]> {
  return client.request<IncusImageAlias[]>('GET', '/1.0/images/aliases')
}

/**
 * 从远程服务器下载镜像
 */
export async function pullImage(
  client: IncusClient,
  remoteAlias: string,
  options: PullImageOptions = {}
): Promise<unknown> {
  const {
    server = 'https://images.linuxcontainers.org',
    protocol = 'simplestreams',
    autoUpdate = true,
    isPublic = false
  } = options

  const payload = {
    source: {
      type: 'image',
      mode: 'pull',
      server,
      protocol,
      alias: remoteAlias
    },
    public: isPublic,
    auto_update: autoUpdate
  }

  // This is an async operation - will return after completion
  return client.request('POST', '/1.0/images', payload)
}

/**
 * 从远程服务器下载镜像（带超时等待）
 */
export async function pullImageWithLongTimeout(
  client: IncusClient,
  remoteAlias: string,
  options: PullImageOptions = {},
  timeout: number = 600000
): Promise<unknown> {
  const {
    server = 'https://images.linuxcontainers.org',
    protocol = 'simplestreams',
    autoUpdate = true,
    isPublic = false
  } = options

  const payload = {
    source: {
      type: 'image',
      mode: 'pull',
      server,
      protocol,
      alias: remoteAlias
    },
    public: isPublic,
    auto_update: autoUpdate
  }

  // Send request and get operation URL
  const url = `${client.baseUrl}/1.0/images`
  
  // 记录请求日志
  console.log('[Incus API Request]', {
    method: 'POST',
    url,
    body: JSON.stringify(payload, null, 2),
    operation: 'pullImageWithLongTimeout'
  })
  
  const response = await request(url, {
    method: 'POST',
    dispatcher: client.agent!,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  
  const text = await response.body.text()
  
  // 记录响应日志
  console.log('[Incus API Response]', {
    method: 'POST',
    url,
    statusCode: response.statusCode,
    responseBody: text.length > 1000 ? `${text.substring(0, 1000)}... (truncated, total: ${text.length} chars)` : text
  })
  
  let data: { type: string; operation?: string; metadata?: unknown; error?: string }
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(text || `HTTP ${response.statusCode}`)
  }

  if (data.type === 'error') {
    throw new Error(data.error || 'Incus API 错误')
  }

  // Wait for async operation with long timeout
  if (data.type === 'async' && data.operation) {
    return waitForOperationLong(client, data.operation, timeout)
  }

  return data.metadata
}

/**
 * 创建镜像别名
 */
export async function createImageAlias(
  client: IncusClient,
  aliasName: string,
  fingerprint: string
): Promise<unknown> {
  return client.request('POST', '/1.0/images/aliases', {
    name: aliasName,
    target: fingerprint
  })
}

/**
 * 删除镜像别名
 */
export async function deleteImageAlias(client: IncusClient, aliasName: string): Promise<unknown> {
  return client.request('DELETE', `/1.0/images/aliases/${aliasName}`)
}

/**
 * 获取镜像别名详情
 */
export async function getImageAlias(client: IncusClient, aliasName: string): Promise<IncusImageAlias> {
  return client.request<IncusImageAlias>('GET', `/1.0/images/aliases/${aliasName}`)
}

/**
 * 更新镜像别名
 */
export async function updateImageAlias(
  client: IncusClient,
  aliasName: string,
  newTarget: string
): Promise<unknown> {
  return client.request('PUT', `/1.0/images/aliases/${aliasName}`, {
    target: newTarget
  })
}

/**
 * 删除镜像
 */
export async function deleteImage(client: IncusClient, fingerprint: string): Promise<unknown> {
  return client.request('DELETE', `/1.0/images/${fingerprint}`)
}

/**
 * 检查镜像是否存在（通过别名）
 */
export async function imageExistsByAlias(client: IncusClient, aliasName: string): Promise<boolean> {
  try {
    await getImageAlias(client, aliasName)
    return true
  } catch {
    return false
  }
}

