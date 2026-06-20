/**
 * Incus API 客户端 - 主类
 * 使用 mTLS (双向 TLS) 与 Incus 服务器通信
 */

import { Agent, request } from 'undici'
import { readFileSync } from 'fs'
import type {
  IncusClientOptions,
  IncusApiResponse
} from '../../types/incus.js'
import { waitForOperation } from './incus-utils.js'

export class IncusClient {
  baseUrl: string
  certPath: string | null
  keyPath: string | null
  agent: Agent | null = null
  connected: boolean = false

  constructor(options: IncusClientOptions) {
    this.baseUrl = IncusClient.normalizeUrl(options.url)
    this.certPath = options.certPath
    this.keyPath = options.keyPath
  }

  /**
   * 规范化 URL，确保 IPv6 地址被方括号包裹
   * 例如 https://2a06:de04:10:1250:::8443 → https://[2a06:de04:10:1250::]:8443
   */
  private static normalizeUrl(url: string): string {
    try {
      // 如果 new URL() 能正常解析，说明格式已经正确
      new URL(url)
      return url
    } catch {
      // URL 解析失败，可能是裸 IPv6 地址未加方括号
      // 策略：从末尾找到 :PORT（纯数字），前面的部分就是 IPv6 地址
      const schemeMatch = url.match(/^(https?:\/\/)(.+)$/)
      if (!schemeMatch) return url

      const scheme = schemeMatch[1]
      const rest = schemeMatch[2] // 例如 "2a06:de04:10:1250:::8443"

      // 从末尾找最后一个冒号，检查冒号后面是否全是数字（即端口号）
      const lastColon = rest.lastIndexOf(':')
      if (lastColon === -1) return url

      const afterLastColon = rest.substring(lastColon + 1)
      if (/^\d+$/.test(afterLastColon)) {
        // afterLastColon 是端口号，前面的是 IPv6 地址
        const addr = rest.substring(0, lastColon)
        if (addr.includes(':')) {
          return `${scheme}[${addr}]:${afterLastColon}`
        }
      }
      return url
    }
  }

  /**
   * 初始化 mTLS 连接
   */
  async connect(): Promise<unknown> {
    try {
      if (!this.certPath || !this.keyPath) {
        throw new Error('Certificate or key path is missing')
      }

      const cert = readFileSync(this.certPath)
      const key = readFileSync(this.keyPath)

      this.agent = new Agent({
        connect: {
          cert,
          key,
          rejectUnauthorized: false // Incus 使用自签名证书
        },
        // 超时配置，防止 Headers Timeout Error
        headersTimeout: 120000, // 2分钟
        bodyTimeout: 300000     // 5分钟（对于大数据传输）
      })

      // 测试连接
      const info = await this.getServerInfo()
      this.connected = true
      return info
    } catch (error) {
      this.connected = false
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`无法连接到 Incus: ${message}`)
    }
  }

  /**
   * 发送 API 请求
   * @param timeout 异步操作的超时时间（毫秒），默认 120 秒。对于长时间操作（如复制实例），建议使用 300000（5分钟）
   */
  async request<T = unknown>(method: string, path: string, body: unknown = null, timeout: number = 120000): Promise<T> {
    if (!this.agent) {
      throw new Error('Incus 客户端未连接')
    }

    const url = `${this.baseUrl}${path}`
    const options: {
      method: string
      dispatcher: Agent
      headers: Record<string, string>
      body?: string
    } = {
      method,
      dispatcher: this.agent,
      headers: {
        'Content-Type': 'application/json'
      }
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await request(url, options)
    const text = await response.body.text()
    
    // Try to parse JSON, handle non-JSON responses (e.g., mTLS errors)
    let data: IncusApiResponse<T>
    try {
      data = JSON.parse(text) as IncusApiResponse<T>
    } catch (e) {
      // 记录错误日志
      console.error('[Incus API Error]', {
        method,
        url,
        statusCode: response.statusCode,
        error: text || `HTTP ${response.statusCode}`
      })
      // Incus returns plain text for some errors (like mTLS failures)
      throw new Error(text || `HTTP ${response.statusCode}`)
    }

    // Incus API 返回格式: { type: "sync/async", status: "Success", metadata: {...} }
    if (data.type === 'error') {
      // 记录错误日志
      console.error('[Incus API Error]', {
        method,
        url,
        error: data.error || 'Incus API 错误'
      })
      throw new Error(data.error || 'Incus API 错误')
    }

    // 异步操作需要等待完成
    if (data.type === 'async' && data.operation) {
      return await waitForOperation(this, data.operation, timeout) as T
    }

    return (data.metadata || data) as T
  }

  /**
   * 检查文件是否存在（用于 Files API，不解析 JSON）
   * @returns true 如果文件存在（HTTP 200），false 如果不存在（HTTP 404）
   */
  async checkFileExists(path: string): Promise<{ exists: boolean; statusCode: number }> {
    const result = await this.readFile(path)
    return {
      exists: result.statusCode === 200,
      statusCode: result.statusCode
    }
  }

  /**
   * 读取实例文件（用于 Files API，不解析 JSON）
   * @returns 文件内容与 HTTP 状态码
   */
  async readFile(path: string): Promise<{ content: string; statusCode: number }> {
    if (!this.agent) {
      throw new Error('Incus 客户端未连接')
    }

    const url = `${this.baseUrl}${path}`
    const response = await request(url, {
      method: 'GET',
      dispatcher: this.agent,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // Files API 返回原始文件内容，不是 JSON
    const content = await response.body.text()

    return { content, statusCode: response.statusCode }
  }

  // ==================== 服务器信息 ====================

  async getServerInfo(): Promise<unknown> {
    return this.request('GET', '/1.0')
  }

  async getResources(): Promise<unknown> {
    return this.request('GET', '/1.0/resources')
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close()
      this.agent = null
      this.connected = false
    }
  }
}

