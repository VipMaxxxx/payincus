/**
 * IPv6 网段数据库操作
 */
import { prisma } from './prisma.js'
import { Prisma } from '@prisma/client'
import { Address6 } from 'ip-address'

export const IPV6_SUBNET_ALLOWED_PREFIXES = [112, 120, 124] as const
export const IPV6_SUBNET_OVERLAP_ERROR = 'IPV6_SUBNET_OVERLAP'

const IPV6_SUBNET_ALLOCATION_LOCK_NAMESPACE = 4202

export interface Ipv6CidrRange {
  cidr: string
  prefix: number
  start: bigint
  end: bigint
}

/** Normalize an IPv6 CIDR to its network address and inclusive BigInt range. */
export function normalizeIpv6CidrRange(cidr: string): Ipv6CidrRange {
  const trimmed = cidr.trim()
  const parts = trimmed.split('/')
  if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) {
    throw new Error('Invalid IPv6 subnet CIDR')
  }

  const prefix = Number(parts[1])
  if (prefix < 0 || prefix > 128 || !Address6.isValid(trimmed)) {
    throw new Error('Invalid IPv6 subnet CIDR')
  }

  const address = new Address6(trimmed)
  const startAddress = address.startAddress()
  return {
    cidr: `${startAddress.correctForm()}/${prefix}`,
    prefix,
    start: startAddress.bigInt(),
    end: address.endAddress().bigInt()
  }
}

export function ipv6CidrRangesOverlap(a: Ipv6CidrRange, b: Ipv6CidrRange): boolean {
  return a.start <= b.end && b.start <= a.end
}

export function isIpv6SubnetOverlapError(error: unknown): boolean {
  return error instanceof Error && error.message === IPV6_SUBNET_OVERLAP_ERROR
}

async function acquireIpv6SubnetAllocationLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    WITH acquired_lock AS (
      SELECT pg_advisory_xact_lock(${IPV6_SUBNET_ALLOCATION_LOCK_NAMESPACE}, 1)
    )
    SELECT true AS locked FROM acquired_lock
  `)
}

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
  const candidate = normalizeIpv6CidrRange(data.cidr)

  return prisma.$transaction(async tx => {
    await acquireIpv6SubnetAllocationLock(tx)

    const allocatedSubnets = await tx.ipv6Subnet.findMany({ select: { cidr: true } })
    const overlaps = allocatedSubnets.some(subnet =>
      ipv6CidrRangesOverlap(candidate, normalizeIpv6CidrRange(subnet.cidr))
    )
    if (overlaps) {
      throw new Error(IPV6_SUBNET_OVERLAP_ERROR)
    }

    return tx.ipv6Subnet.create({
      data: {
        cidr: candidate.cidr,
        primaryIp: data.primaryIp,
        device: data.device || 'eth1',
        instanceId: data.instanceId
      }
    })
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
  const candidate = normalizeIpv6CidrRange(cidr)
  const allocatedSubnets = await prisma.ipv6Subnet.findMany({ select: { cidr: true } })
  return allocatedSubnets.some(subnet =>
    ipv6CidrRangesOverlap(candidate, normalizeIpv6CidrRange(subnet.cidr))
  )
}

/**
 * 统计实例的网段数量
 */
export async function countIpv6Subnets(instanceId: number): Promise<number> {
  return prisma.ipv6Subnet.count({
    where: { instanceId }
  })
}
