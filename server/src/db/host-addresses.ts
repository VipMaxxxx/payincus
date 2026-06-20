import type {
  HostAddressCheckStatus,
  HostAddressCheckTrigger,
  HostAddressKind,
  HostAddressSource,
  Prisma
} from '@prisma/client'
import { prisma } from './prisma.js'

type DbClient = Prisma.TransactionClient | typeof prisma

export interface HostAddressAliasInput {
  address: string
  kind: HostAddressKind
  source: HostAddressSource
}

export interface HostAddressConflictInfo {
  id: number
  address: string
  hostAId: number
  hostAName: string
  hostBId: number
  hostBName: string
  wasCreated: boolean
}

export async function upsertHostInputAlias(
  hostId: number,
  alias: HostAddressAliasInput,
  client: DbClient = prisma
): Promise<void> {
  await client.hostAddressAlias.upsert({
    where: {
      hostId_address: {
        hostId,
        address: alias.address
      }
    },
    create: {
      hostId,
      address: alias.address,
      kind: alias.kind,
      source: alias.source
    },
    update: {
      kind: alias.kind,
      source: alias.source
    }
  })
}

export async function replaceHostResolvedAliases(
  hostId: number,
  aliases: HostAddressAliasInput[],
  client: DbClient = prisma
): Promise<void> {
  await client.hostAddressAlias.deleteMany({
    where: {
      hostId,
      source: 'resolved'
    }
  })

  if (aliases.length === 0) {
    return
  }

  await client.hostAddressAlias.createMany({
    data: aliases.map(alias => ({
      hostId,
      address: alias.address,
      kind: alias.kind,
      source: alias.source
    })),
    skipDuplicates: true
  })
}

export async function getAliasesByAddresses(
  addresses: string[],
  excludeHostId?: number,
  client: DbClient = prisma
) {
  if (addresses.length === 0) {
    return []
  }

  return client.hostAddressAlias.findMany({
    where: {
      address: {
        in: addresses
      },
      ...(excludeHostId !== undefined
        ? {
            hostId: {
              not: excludeHostId
            }
          }
        : {})
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          url: true
        }
      }
    }
  })
}

export async function createHostAddressResolutionLog(
  data: {
    hostId: number
    inputAddress: string
    inputKind: HostAddressKind
    trigger: HostAddressCheckTrigger
    status: HostAddressCheckStatus
    resolvedAddresses: string[]
    error?: string | null
    details?: Record<string, unknown>
  },
  client: DbClient = prisma
): Promise<void> {
  await client.hostAddressResolutionLog.create({
    data: {
      hostId: data.hostId,
      inputAddress: data.inputAddress,
      inputKind: data.inputKind,
      trigger: data.trigger,
      status: data.status,
      resolvedAddresses: data.resolvedAddresses as Prisma.InputJsonValue,
      error: data.error ?? null,
      details: (data.details ?? {}) as Prisma.InputJsonValue
    }
  })
}

export async function getHostsForAddressBackfill() {
  return prisma.host.findMany({
    select: {
      id: true,
      name: true,
      url: true
    },
    orderBy: {
      id: 'asc'
    }
  })
}

export async function getHostsWithDomainInputAlias() {
  return prisma.host.findMany({
    where: {
      addressAliases: {
        some: {
          source: 'input',
          kind: 'domain'
        }
      }
    },
    select: {
      id: true,
      name: true,
      url: true
    },
    orderBy: {
      id: 'asc'
    }
  })
}

export async function syncHostAddressConflicts(
  addresses: string[],
  client: DbClient = prisma
): Promise<HostAddressConflictInfo[]> {
  if (addresses.length === 0) {
    return []
  }

  const uniqueAddresses = [...new Set(addresses)]
  const aliases = await client.hostAddressAlias.findMany({
    where: {
      address: {
        in: uniqueAddresses
      }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: [
      { address: 'asc' },
      { hostId: 'asc' }
    ]
  })
  type AliasRecord = (typeof aliases)[number]

  const desiredKeys = new Set<string>()
  const createdConflicts: HostAddressConflictInfo[] = []
  const aliasesByAddress = new Map<string, AliasRecord[]>()

  for (const alias of aliases) {
    const list = aliasesByAddress.get(alias.address) ?? []
    list.push(alias)
    aliasesByAddress.set(alias.address, list)
  }

  for (const [address, aliasGroup] of aliasesByAddress.entries()) {
    const uniqueHosts = new Map<number, { id: number; name: string }>()
    for (const alias of aliasGroup) {
      uniqueHosts.set(alias.host.id, alias.host)
    }

    const hosts = [...uniqueHosts.values()].sort((a, b) => a.id - b.id)
    if (hosts.length < 2) {
      continue
    }

    for (let i = 0; i < hosts.length; i++) {
      for (let j = i + 1; j < hosts.length; j++) {
        const hostA = hosts[i]
        const hostB = hosts[j]
        const key = `${hostA.id}:${hostB.id}:${address}`
        desiredKeys.add(key)

        const existing = await client.hostAddressConflict.findUnique({
          where: {
            hostAId_hostBId_address: {
              hostAId: hostA.id,
              hostBId: hostB.id,
              address
            }
          }
        })

        if (!existing) {
          const conflict = await client.hostAddressConflict.create({
            data: {
              hostAId: hostA.id,
              hostBId: hostB.id,
              address,
              status: 'active'
            }
          })
          createdConflicts.push({
            id: conflict.id,
            address,
            hostAId: hostA.id,
            hostAName: hostA.name,
            hostBId: hostB.id,
            hostBName: hostB.name,
            wasCreated: true
          })
          continue
        }

        if (existing.status === 'resolved') {
          const conflict = await client.hostAddressConflict.update({
            where: { id: existing.id },
            data: {
              status: 'active',
              resolvedAt: null
            }
          })
          createdConflicts.push({
            id: conflict.id,
            address,
            hostAId: hostA.id,
            hostAName: hostA.name,
            hostBId: hostB.id,
            hostBName: hostB.name,
            wasCreated: true
          })
          continue
        }

        await client.hostAddressConflict.update({
          where: { id: existing.id },
          data: {
            resolvedAt: null
          }
        })
      }
    }
  }

  const existingActiveConflicts = await client.hostAddressConflict.findMany({
    where: {
      address: {
        in: uniqueAddresses
      },
      status: 'active'
    }
  })

  for (const conflict of existingActiveConflicts) {
    const key = `${conflict.hostAId}:${conflict.hostBId}:${conflict.address}`
    if (desiredKeys.has(key)) {
      continue
    }

    await client.hostAddressConflict.update({
      where: { id: conflict.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date()
      }
    })
  }

  return createdConflicts
}
