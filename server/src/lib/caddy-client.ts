/**
 * Caddy API 客户端
 * 通过 8444 端口 Basic Auth 保护的通道调用 Caddy Admin API
 */

import { Agent, request as undiciRequest } from 'undici'
import { formatHostForUrl } from './network-address.js'

// 请求超时配置（毫秒）
const REQUEST_TIMEOUT = 30000 // 30秒
const CONNECT_TIMEOUT = 10000 // 10秒

export interface CaddyClientConfig {
  host: string // 宿主机 IP 或域名
  port: number // Caddy API 端口 (默认 8444)
  username: string // Basic Auth 用户名
  password: string // Basic Auth 密码
}

export interface CaddyRoute {
  '@id'?: string
  match?: Array<{ host?: string[]; protocol?: string }>
  handle?: Array<{
    handler: string
    upstreams?: Array<{ dial: string }>
    routes?: CaddyRoute[]
  }>
  terminal?: boolean
}

/**
 * Caddy API 客户端类
 */
export class CaddyClient {
  private baseUrl: string
  private authHeader: string
  private agent: Agent

  constructor(config: CaddyClientConfig) {
    this.baseUrl = `https://${formatHostForUrl(config.host)}:${config.port}`
    this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64')
    
    // 创建 undici Agent，忽略自签名证书错误，配置超时
    this.agent = new Agent({
      connect: {
        rejectUnauthorized: false,
        timeout: CONNECT_TIMEOUT
      }
    })
  }

  /**
   * 发起 API 请求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const response = await undiciRequest(url, {
        method,
        dispatcher: this.agent,
        signal: controller.signal,
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      })

      if (response.statusCode >= 400) {
        const errorText = await response.body.text()
        throw new Error(`Caddy API error: ${response.statusCode} ${errorText}`)
      }

      // 某些请求没有响应体
      const text = await response.body.text()
      if (!text) {
        return {} as T
      }
      
      return JSON.parse(text) as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 获取 Caddy 配置
   */
  async getConfig(): Promise<unknown> {
    return this.request('GET', '/config/')
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log(`[Caddy Client] 测试连接: ${this.baseUrl}/config/`)
      await this.getConfig()
      console.log(`[Caddy Client] 连接成功: ${this.baseUrl}`)
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 检查是否是超时错误
      const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')
      console.error(`[Caddy Client] 连接失败: ${this.baseUrl}`, {
        error: errorMessage,
        isTimeout,
        stack: error instanceof Error ? error.stack : undefined
      })
      return false
    }
  }

  /**
   * 添加反代站点
   * 
   * 架构说明：
   * - 使用统一的 `sites` 服务器监听 :80 和 :443
   * - HTTPS 站点：正常配置，Caddy 自动处理证书和重定向
   * - HTTP 站点：添加 protocol 匹配，仅响应 HTTP 请求
   * 
   * @param domain 域名
   * @param targetIp 目标 IP (实例内网 IP)
   * @param targetPort 目标端口
   * @param httpsEnabled 是否启用 HTTPS（自动申请 Let's Encrypt 证书）
   */
  async addSite(domain: string, targetIp: string, targetPort: number, httpsEnabled: boolean = true): Promise<void> {
    const routeId = `site-${domain.replace(/\./g, '-')}`
    
    // 构建路由配置
    const route: CaddyRoute = {
      '@id': routeId,
      match: [{ host: [domain] }],
      handle: [{
        handler: 'reverse_proxy',
        upstreams: [{ dial: `${targetIp}:${targetPort}` }]
      }],
      terminal: true
    }

    // HTTP-only 站点：添加协议匹配，仅响应 HTTP 请求
    if (!httpsEnabled) {
      route.match = [{ host: [domain], protocol: 'http' }]
    }

    // 统一使用 sites 服务器
    const serverName = 'sites'

    // 策略：优先使用精确的 API 路径，避免影响 Caddyfile 定义的服务器
    try {
      // 尝试添加路由到现有服务器
      await this.request('POST', `/config/apps/http/servers/${serverName}/routes`, route)
      return
    } catch (postError) {
      // POST 失败，可能服务器不存在
      const postErrorMsg = postError instanceof Error ? postError.message : String(postError)
      console.log(`[Caddy] POST 路由失败: ${postErrorMsg}`)
    }

    // 服务器不存在，创建它
    const serverConfig: Record<string, unknown> = {
      listen: [':80', ':443'],
      routes: [route]
    }
    
    // 禁用自动 HTTPS 重定向（我们通过路由匹配控制）
    serverConfig.automatic_https = {
      disable_redirects: true
    }

    try {
      // 尝试直接创建服务器
      await this.request('PUT', `/config/apps/http/servers/${serverName}`, serverConfig)
      return
    } catch (putError) {
      const putErrorMsg = putError instanceof Error ? putError.message : String(putError)
      console.log(`[Caddy] PUT 服务器失败: ${putErrorMsg}`)
      
      // 只有当是 404 错误时，才说明 http 应用不存在
      if (!putErrorMsg.includes('404')) {
        // 其他错误，直接抛出
        throw putError
      }
    }

    // http 应用不存在，这是非常罕见的情况（Caddyfile 没有任何 HTTP 配置）
    // 使用 PATCH 合并，不要使用 PUT 覆盖
    console.log('[Caddy] http 应用不存在，使用 PATCH 创建')
    const httpApp = {
      servers: {
        [serverName]: serverConfig
      }
    }
    
    // 尝试 PATCH，如果失败则抛出错误
    try {
      await this.request('PATCH', '/config/apps/http', httpApp)
    } catch (patchError) {
      const patchErrorMsg = patchError instanceof Error ? patchError.message : String(patchError)
      console.error(`[Caddy] PATCH http 应用失败: ${patchErrorMsg}`)
      throw new Error(`无法创建站点配置: ${patchErrorMsg}`)
    }
  }

  /**
   * 删除反代站点
   * @param domain 域名
   */
  async deleteSite(domain: string): Promise<void> {
    const routeId = `site-${domain.replace(/\./g, '-')}`
    
    try {
      await this.request('DELETE', `/id/${routeId}`)
    } catch (error) {
      // 如果路由不存在，忽略错误
      if (error instanceof Error && !error.message.includes('404')) {
        throw error
      }
    }
  }

  /**
   * 获取所有反代站点
   */
  async getSites(): Promise<string[]> {
    try {
      const config = await this.getConfig() as {
        apps?: {
          http?: {
            servers?: Record<string, {
              routes?: CaddyRoute[]
            }>
          }
        }
      }

      const servers = config?.apps?.http?.servers || {}
      const domains: string[] = []

      // 从所有服务器收集域名
      for (const serverName of Object.keys(servers)) {
        const routes = servers[serverName]?.routes || []
        for (const route of routes) {
          if (route.match?.[0]?.host) {
            domains.push(...route.match[0].host)
          }
        }
      }

      return domains
    } catch {
      return []
    }
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    // Caddy 会自动应用配置更改，不需要显式 reload
    // 这个方法保留用于兼容性
  }
}

/**
 * 创建 Caddy 客户端实例
 */
export function createCaddyClient(config: CaddyClientConfig): CaddyClient {
  return new CaddyClient(config)
}
