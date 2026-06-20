/**
 * 反代站点数据库操作
 */

import { prisma } from './prisma.js'
import type { ProxySiteStatus } from '@prisma/client'
import { isIpLiteral } from '../lib/network-address.js'

export interface CreateProxySiteData {
  instanceId: number
  hostId: number
  domain: string
  targetPort: number
  httpsEnabled?: boolean
  remark?: string
}

/**
 * 创建反代站点
 */
export async function createProxySite(data: CreateProxySiteData) {
  return prisma.proxySite.create({
    data: {
      instanceId: data.instanceId,
      hostId: data.hostId,
      domain: data.domain,
      targetPort: data.targetPort,
      httpsEnabled: data.httpsEnabled ?? true,
      remark: data.remark || null,
      status: 'pending',
      enabled: true
    }
  })
}

/**
 * 获取实例的反代站点列表
 */
export async function getProxySitesByInstanceId(instanceId: number) {
  return prisma.proxySite.findMany({
    where: { instanceId },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取宿主机的所有反代站点
 */
export async function getProxySitesByHostId(hostId: number) {
  return prisma.proxySite.findMany({
    where: { hostId },
    include: {
      instance: {
        select: {
          id: true,
          name: true,
          ipv4: true,
          status: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取反代站点详情
 */
export async function getProxySiteById(id: number) {
  return prisma.proxySite.findUnique({
    where: { id },
    include: {
      instance: {
        select: {
          id: true,
          name: true,
          ipv4: true,
          hostId: true,
          userId: true,
          status: true,
          suspendReason: true
        }
      },
      host: {
        select: {
          id: true,
          name: true,
          natPublicIp: true,
          ipAddress: true,
          caddyEnabled: true,
          caddyUsername: true,
          caddyPassword: true,
          caddyPort: true
        }
      }
    }
  })
}

/**
 * 通过域名查找反代站点
 */
export async function getProxySiteByDomain(hostId: number, domain: string) {
  return prisma.proxySite.findUnique({
    where: {
      hostId_domain: {
        hostId,
        domain
      }
    }
  })
}

/**
 * 更新反代站点状态
 */
export async function updateProxySiteStatus(
  id: number,
  status: ProxySiteStatus,
  error?: string | null,
  enabled?: boolean
) {
  const data: { status: ProxySiteStatus; error: string | null; enabled?: boolean } = {
    status,
    error: error ?? null
  }
  
  // 可选更新 enabled 字段
  if (enabled !== undefined) {
    data.enabled = enabled
  }
  
  return prisma.proxySite.update({
    where: { id },
    data
  })
}

/**
 * 更新反代站点配置
 */
export async function updateProxySite(
  id: number,
  data: {
    targetPort?: number
    httpsEnabled?: boolean
    remark?: string | null
    status?: ProxySiteStatus
    error?: string | null
  }
) {
  return prisma.proxySite.update({
    where: { id },
    data
  })
}

/**
 * 切换反代站点启用状态
 */
export async function toggleProxySiteEnabled(id: number, enabled: boolean) {
  return prisma.proxySite.update({
    where: { id },
    data: { enabled }
  })
}

/**
 * 删除反代站点
 */
export async function deleteProxySite(id: number) {
  return prisma.proxySite.delete({
    where: { id }
  })
}

/**
 * 检查域名是否已被使用
 */
export async function isDomainUsed(hostId: number, domain: string): Promise<boolean> {
  const existing = await prisma.proxySite.findUnique({
    where: {
      hostId_domain: {
        hostId,
        domain
      }
    }
  })
  return existing !== null
}

/**
 * 验证域名格式（不允许泛域名）
 */
export function isValidDomain(domain: string): boolean {
  // 不允许泛域名（以 * 开头）
  if (domain.startsWith('*')) {
    return false
  }
  
  // 基本域名格式验证
  const domainRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$/
  return domainRegex.test(domain)
}

/**
 * 判断是否为 IP 地址
 */
export function isIpAddress(value: string): boolean {
  return isIpLiteral(value)
}

/**
 * 统计实例的站点数量
 */
export async function getProxySiteCountByInstance(instanceId: number): Promise<number> {
  return prisma.proxySite.count({
    where: { instanceId }
  })
}

/**
 * 统计宿主机的站点数量
 */
export async function getProxySiteCountByHost(hostId: number): Promise<number> {
  return prisma.proxySite.count({
    where: { hostId }
  })
}
