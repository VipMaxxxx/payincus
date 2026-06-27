import { prisma } from './prisma.js'
import type { Prisma } from '@prisma/client'

type DbClient = Prisma.TransactionClient | typeof prisma

export interface PublicIpv4Assignment {
  id: number
  address: string
  prefixLength: number
  gateway: string
  dns: string[]
}

export interface CreatePublicIpv4PoolInput {
  hostId: number
  name: string
  cidr?: string | null
  gateway: string
  prefixLength?: number
  dns?: string[]
  notes?: string | null
  addresses?: string[]
}

function normalizeDns(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export async function countFreePublicIpv4ForHost(client: DbClient, hostId: number): Promise<number> {
  const rows = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM public_ipv4_addresses a
    LEFT JOIN public_ipv4_pools p ON p.id = a.pool_id
    WHERE a.host_id = ${hostId}
      AND a.status = 'free'
      AND (a.pool_id IS NULL OR p.enabled = true)
  `
  return Number(rows[0]?.count ?? 0)
}

export async function reservePublicIpv4ForInstance(
  tx: Prisma.TransactionClient,
  input: { hostId: number; instanceId: number }
): Promise<PublicIpv4Assignment | null> {
  const rows = await tx.$queryRaw<Array<{
    id: number
    address: string
    prefixLength: number
    gateway: string | null
    poolGateway: string | null
    dns: unknown
    poolDns: unknown
  }>>`
    SELECT
      a.id,
      a.address,
      a.prefix_length AS "prefixLength",
      a.gateway,
      p.gateway AS "poolGateway",
      a.dns,
      p.dns AS "poolDns"
    FROM public_ipv4_addresses a
    LEFT JOIN public_ipv4_pools p ON p.id = a.pool_id
    WHERE a.host_id = ${input.hostId}
      AND a.status = 'free'
      AND (a.pool_id IS NULL OR p.enabled = true)
    ORDER BY a.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `

  const selected = rows[0]
  if (!selected) return null

  const gateway = selected.gateway || selected.poolGateway
  if (!gateway) {
    await tx.$executeRaw`
      UPDATE public_ipv4_addresses
      SET status = 'disabled',
          notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END || 'Auto-disabled: missing gateway',
          updated_at = NOW()
      WHERE id = ${selected.id}
    `
    return null
  }

  await tx.$executeRaw`
    UPDATE public_ipv4_addresses
    SET status = 'assigned',
        instance_id = ${input.instanceId},
        assigned_at = NOW(),
        released_at = NULL,
        updated_at = NOW()
    WHERE id = ${selected.id}
  `

  const dns = normalizeDns(selected.dns).length > 0
    ? normalizeDns(selected.dns)
    : normalizeDns(selected.poolDns)

  return {
    id: selected.id,
    address: selected.address,
    prefixLength: selected.prefixLength,
    gateway,
    dns: dns.length > 0 ? dns : ['1.1.1.1', '8.8.8.8']
  }
}

export async function releasePublicIpv4ForInstance(
  tx: Prisma.TransactionClient,
  instanceId: number
): Promise<void> {
  await tx.$executeRaw`
    UPDATE public_ipv4_addresses
    SET status = 'free',
        instance_id = NULL,
        released_at = NOW(),
        updated_at = NOW()
    WHERE instance_id = ${instanceId}
      AND status = 'assigned'
  `
}

export async function listPublicIpv4Pools(hostId: number) {
  return prisma.publicIpv4Pool.findMany({
    where: { hostId },
    include: {
      addresses: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          address: true,
          prefixLength: true,
          gateway: true,
          dns: true,
          status: true,
          instanceId: true,
          assignedAt: true,
          releasedAt: true,
          notes: true,
          createdAt: true,
          updatedAt: true
        }
      }
    },
    orderBy: { id: 'asc' }
  })
}

export async function createPublicIpv4Pool(input: CreatePublicIpv4PoolInput) {
  const addresses = [...new Set((input.addresses || []).map(item => item.trim()).filter(Boolean))]
  return prisma.$transaction(async (tx) => {
    const pool = await tx.publicIpv4Pool.create({
      data: {
        hostId: input.hostId,
        name: input.name.trim(),
        cidr: input.cidr?.trim() || null,
        gateway: input.gateway.trim(),
        prefixLength: input.prefixLength ?? 32,
        dns: input.dns || [],
        notes: input.notes?.trim() || null
      }
    })

    if (addresses.length > 0) {
      await tx.publicIpv4Address.createMany({
        data: addresses.map(address => ({
          poolId: pool.id,
          hostId: input.hostId,
          address,
          prefixLength: input.prefixLength ?? 32,
          gateway: input.gateway.trim(),
          dns: input.dns || []
        })),
        skipDuplicates: true
      })
    }

    return pool
  })
}

export async function addPublicIpv4Addresses(input: {
  hostId: number
  poolId: number
  addresses: string[]
}) {
  const pool = await prisma.publicIpv4Pool.findFirst({
    where: { id: input.poolId, hostId: input.hostId },
    select: { id: true, gateway: true, prefixLength: true, dns: true }
  })
  if (!pool) {
    throw new Error('PUBLIC_IPV4_POOL_NOT_FOUND')
  }

  const addresses = [...new Set(input.addresses.map(item => item.trim()).filter(Boolean))]
  if (addresses.length === 0) return { count: 0 }

  return prisma.publicIpv4Address.createMany({
    data: addresses.map(address => ({
      poolId: pool.id,
      hostId: input.hostId,
      address,
      prefixLength: pool.prefixLength,
      gateway: pool.gateway,
      dns: pool.dns as Prisma.InputJsonValue
    })),
    skipDuplicates: true
  })
}

export async function updatePublicIpv4Pool(
  hostId: number,
  poolId: number,
  data: { name?: string; gateway?: string; prefixLength?: number; dns?: string[]; enabled?: boolean; notes?: string | null }
) {
  const pool = await prisma.publicIpv4Pool.findFirst({
    where: { id: poolId, hostId },
    select: { id: true }
  })
  if (!pool) throw new Error('PUBLIC_IPV4_POOL_NOT_FOUND')

  return prisma.publicIpv4Pool.update({
    where: { id: poolId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.gateway !== undefined ? { gateway: data.gateway.trim() } : {}),
      ...(data.prefixLength !== undefined ? { prefixLength: data.prefixLength } : {}),
      ...(data.dns !== undefined ? { dns: data.dns } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {})
    }
  })
}

export async function deletePublicIpv4Pool(hostId: number, poolId: number) {
  const busy = await prisma.publicIpv4Address.count({
    where: { hostId, poolId, status: 'assigned' }
  })
  if (busy > 0) throw new Error('PUBLIC_IPV4_POOL_HAS_ASSIGNED_ADDRESSES')

  await prisma.publicIpv4Pool.delete({
    where: { id: poolId, hostId }
  })
}

export async function deletePublicIpv4Address(hostId: number, addressId: number) {
  const address = await prisma.publicIpv4Address.findFirst({
    where: { id: addressId, hostId },
    select: { id: true, status: true }
  })
  if (!address) throw new Error('PUBLIC_IPV4_ADDRESS_NOT_FOUND')
  if (address.status === 'assigned') throw new Error('PUBLIC_IPV4_ADDRESS_ASSIGNED')

  await prisma.publicIpv4Address.delete({ where: { id: addressId } })
}

export async function setPublicIpv4AddressStatus(
  hostId: number,
  addressId: number,
  status: 'free' | 'disabled'
) {
  const address = await prisma.publicIpv4Address.findFirst({
    where: { id: addressId, hostId },
    select: { id: true, status: true }
  })
  if (!address) throw new Error('PUBLIC_IPV4_ADDRESS_NOT_FOUND')
  if (address.status === 'assigned') throw new Error('PUBLIC_IPV4_ADDRESS_ASSIGNED')

  return prisma.publicIpv4Address.update({
    where: { id: addressId },
    data: { status }
  })
}
