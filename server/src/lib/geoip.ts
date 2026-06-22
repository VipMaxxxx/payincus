/**
 * IP 地理位置查询服务
 * 使用 ip-api.com 免费 API（45次/分钟限制）
 * 通过请求队列确保不超过速率限制，且不阻塞调用方
 */

import { isIP } from 'net'

export interface GeoIpInfo {
  ip: string
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  timezone: string | null
}

interface IpApiResponse {
  status: 'success' | 'fail'
  message?: string
  country?: string
  regionName?: string
  city?: string
  isp?: string
  timezone?: string
  query?: string
}

// 简单的内存缓存（避免重复查询）
const geoCache = new Map<string, { data: GeoIpInfo; timestamp: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24小时缓存

// ==================== 请求队列限速 ====================
// ip-api.com 限制 45次/分钟，我们保守使用 40次/分钟
const RATE_LIMIT = 40
const RATE_WINDOW = 60 * 1000 // 1分钟窗口
const MAX_QUEUE_SIZE = 1000
const requestTimestamps: number[] = []
let isProcessingQueue = false

interface QueuedRequest {
  ip: string
  resolve: (result: GeoIpInfo) => void
}

const requestQueue: QueuedRequest[] = []

/**
 * 查询 IP 地理位置信息（带限速队列）
 * 此函数立即返回 Promise，不会阻塞调用方
 * 如果超过速率限制，请求会排队等待
 * @param ip IP 地址
 * @returns 地理位置信息
 */
export async function getGeoIpInfo(ip: string): Promise<GeoIpInfo> {
  const normalizedIp = normalizeIpForGeoLookup(ip)
  if (!normalizedIp) {
    return createEmptyResult(ip)
  }

  // 检查是否是本地 IP
  if (isLocalIp(normalizedIp)) {
    return createEmptyResult(normalizedIp)
  }

  // 检查缓存（缓存命中直接返回，不进入队列）
  const cached = geoCache.get(normalizedIp)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    console.warn('[GeoIP] Queue is full, skipping lookup')
    return createEmptyResult(normalizedIp)
  }

  // 将请求加入队列
  return new Promise<GeoIpInfo>((resolve) => {
    requestQueue.push({ ip: normalizedIp, resolve })
    processQueue()
  })
}

/**
 * 处理请求队列
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue || requestQueue.length === 0) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    // 清理过期的时间戳
    const now = Date.now()
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW) {
      requestTimestamps.shift()
    }

    // 检查是否超过速率限制
    if (requestTimestamps.length >= RATE_LIMIT) {
      // 等待直到最早的请求过期
      const waitTime = requestTimestamps[0] + RATE_WINDOW - now + 100 // 多等100ms缓冲
      await new Promise(resolve => setTimeout(resolve, waitTime))
      continue
    }

    // 取出队列中的请求
    const request = requestQueue.shift()
    if (!request) break

    // 再次检查缓存（可能在等待期间被其他请求填充）
    const cached = geoCache.get(request.ip)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      request.resolve(cached.data)
      continue
    }

    // 记录请求时间
    requestTimestamps.push(Date.now())

    // 执行实际的 API 请求
    const result = await fetchGeoIpInfo(request.ip)
    request.resolve(result)
  }

  isProcessingQueue = false
}

/**
 * 实际执行 IP 地理位置查询
 */
async function fetchGeoIpInfo(ip: string): Promise<GeoIpInfo> {
  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp,timezone,query`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5秒超时
      }
    )

    if (!response.ok) {
      console.error(`[GeoIP] HTTP error: ${response.status}`)
      return createEmptyResult(ip)
    }

    const data = await response.json() as IpApiResponse

    if (data.status === 'fail') {
      console.warn(`[GeoIP] Query failed for ${ip}: ${data.message}`)
      return createEmptyResult(ip)
    }

    const result: GeoIpInfo = {
      ip,
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
      isp: data.isp || null,
      timezone: data.timezone || null
    }

    // 存入缓存
    geoCache.set(ip, { data: result, timestamp: Date.now() })

    // 清理过期缓存（简单策略：缓存超过1000条时清理）
    if (geoCache.size > 1000) {
      cleanupCache()
    }

    return result
  } catch (error) {
    console.error(`[GeoIP] Error querying IP ${ip}:`, error)
    return createEmptyResult(ip)
  }
}

function normalizeIpForGeoLookup(ip: string): string | null {
  const normalized = typeof ip === 'string' ? ip.trim() : ''
  return isIP(normalized) ? normalized : null
}

/**
 * 检查是否是本地/私有 IP
 */
function isLocalIp(ip: string): boolean {
  // IPv4 本地/私有地址
  if (
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    (ip.startsWith('172.') && isPrivate172(ip))
  ) {
    return true
  }

  // IPv6 本地/私有地址
  if (
    ip === '::1' ||
    ip.toLowerCase().startsWith('fe80:') ||  // Link-local
    ip.toLowerCase().startsWith('fc') ||      // Unique local (fc00::/7)
    ip.toLowerCase().startsWith('fd')         // Unique local (fc00::/7)
  ) {
    return true
  }

  return false
}

/**
 * 检查 172.x.x.x 是否是私有地址 (172.16.0.0 - 172.31.255.255)
 */
function isPrivate172(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length < 2) return false
  const second = parseInt(parts[1], 10)
  return second >= 16 && second <= 31
}

/**
 * 创建空结果
 */
function createEmptyResult(ip: string): GeoIpInfo {
  return {
    ip,
    country: null,
    region: null,
    city: null,
    isp: null,
    timezone: null
  }
}

/**
 * 清理过期缓存
 */
function cleanupCache(): void {
  const now = Date.now()
  const keysToDelete: string[] = []

  geoCache.forEach((value, key) => {
    if (now - value.timestamp > CACHE_TTL) {
      keysToDelete.push(key)
    }
  })

  keysToDelete.forEach(key => geoCache.delete(key))
}
