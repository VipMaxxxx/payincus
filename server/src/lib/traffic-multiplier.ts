import type { Prisma } from '@prisma/client'

const MULTIPLIER_SCALE = 1000n

type DbClient = Prisma.TransactionClient | {
  packageHost: {
    findUnique(args: {
      where: { packageId_hostId: { packageId: number; hostId: number } }
      select: { trafficMultiplier: true }
    }): Promise<{ trafficMultiplier: unknown } | null>
  }
}

export function normalizeTrafficMultiplier(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return 1
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0.001 || numeric > 100) {
    throw new Error('Traffic multiplier must be at least 0.001 and no more than 100')
  }

  return Math.round(numeric * 1000) / 1000
}

export function applyTrafficMultiplier(limit: bigint | null, multiplier: unknown): bigint | null {
  if (limit === null) {
    return null
  }

  const normalized = normalizeTrafficMultiplier(multiplier)
  const scaled = BigInt(Math.round(normalized * Number(MULTIPLIER_SCALE)))
  return (limit * scaled) / MULTIPLIER_SCALE
}

export async function getPackageHostTrafficMultiplier(
  client: DbClient,
  packageId: number,
  hostId: number
): Promise<number> {
  const binding = await client.packageHost.findUnique({
    where: {
      packageId_hostId: {
        packageId,
        hostId
      }
    },
    select: {
      trafficMultiplier: true
    }
  })

  return normalizeTrafficMultiplier(binding?.trafficMultiplier)
}

export async function resolveInstanceTrafficLimitForHost(
  client: DbClient,
  params: {
    packageId: number | null | undefined
    hostId: number
    baseTrafficLimit: bigint | null
  }
): Promise<bigint | null> {
  if (!params.packageId) {
    return params.baseTrafficLimit
  }

  const multiplier = await getPackageHostTrafficMultiplier(client, params.packageId, params.hostId)
  return applyTrafficMultiplier(params.baseTrafficLimit, multiplier)
}
