/**
 * IPv6 网段数据库操作
 */
import { prisma } from './prisma.js'

export interface CreateIpv6SubnetData {
  cidr: string
  primaryIp: string
  device?: string
  instanceId: number
}

/**
 * 创建 IPv6 网段记录
 */
export async function createIpv6Subnet(data: CreateIpv6SubnetData) {
  return prisma.ipv6Subnet.create({
    data: {
      cidr: data.cidr,
      primaryIp: data.primaryIp,
      device: data.device || 'eth1',
      instanceId: data.instanceId
    }
  })
}

/**
 * 获取实例的所有 IPv6 网段
 */
export async function getIpv6SubnetsByInstanceId(instanceId: number) {
  return prisma.ipv6Subnet.findMany({
    where: { instanceId },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * 根据 ID 获取 IPv6 网段
 */
export async function getIpv6SubnetById(id: number) {
  return prisma.ipv6Subnet.findUnique({
    where: { id },
    include: {
      instance: {
        include: {
          host: true
        }
      }
    }
  })
}

/**
 * 根据 CIDR 获取 IPv6 网段
 */
export async function getIpv6SubnetByCidr(cidr: string) {
  return prisma.ipv6Subnet.findUnique({
    where: { cidr }
  })
}

/**
 * 删除 IPv6 网段
 */
export async function deleteIpv6Subnet(id: number) {
  return prisma.ipv6Subnet.delete({
    where: { id }
  })
}

/**
 * 检查网段 CIDR 是否已存在
 */
export async function isIpv6SubnetExists(cidr: string): Promise<boolean> {
  const existing = await prisma.ipv6Subnet.findUnique({
    where: { cidr }
  })
  return !!existing
}

/**
 * 统计实例的网段数量
 */
export async function countIpv6Subnets(instanceId: number): Promise<number> {
  return prisma.ipv6Subnet.count({
    where: { instanceId }
  })
}
