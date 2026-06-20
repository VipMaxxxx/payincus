import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import type { IncusInstance } from '../types/incus.js'

type InstanceNetworkMode = 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'

interface NetworkAddressEntry {
  family: string
  address: string
  scope?: string
}

interface NetworkInterfaceState {
  addresses?: NetworkAddressEntry[]
}

export interface IncusNetworkStateLike {
  status?: string
  network?: Record<string, NetworkInterfaceState>
}

export interface InstanceNetworkSyncTarget {
  id: number
  name?: string
  hostId?: number | null
  networkMode: string | null | undefined
  ipv4: string | null | undefined
  ipv6: string | null | undefined
}

export interface ResolvedInstanceNetworkAddresses {
  ipv4: string | null
  ipv6: string | null
  ipv4Device: string
  ipv6Device: string
  configuredIpv6: string | null
  observedIpv6: string | null
}

export interface PersistedInstanceNetworkAddresses {
  ipv4Changed: boolean
  oldIpv4: string | null
  newIpv4: string | null
  ipv6Changed: boolean
  oldIpv6: string | null
  newIpv6: string | null
}

const ROUTED_IPV6_MODES = new Set<InstanceNetworkMode>(['nat_ipv6', 'ipv6_only'])
const SHARED_IPV6_MODES = new Set<InstanceNetworkMode>(['nat_ipv6_nat', 'ipv6_nat'])
const SKIPPED_INTERFACES = ['lo', 'docker', 'br-', 'veth', 'warp', 'CloudflareWARP']

function normalizeIpv6Address(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const first = trimmed.split(',')[0]?.trim() || ''
  const raw = first.split('/')[0]?.trim() || ''
  return raw || null
}

function isGlobalRoutableIpv6(value: string | null | undefined): value is string {
  const normalized = normalizeIpv6Address(value)
  if (!normalized) return false
  const ip = normalized.toLowerCase()
  return !ip.startsWith('fd')
    && !ip.startsWith('fc')
    && !ip.startsWith('fe80:')
    && ip !== '::1'
    && ip !== '::'
}

function shouldSkipInterface(iface: string): boolean {
  return SKIPPED_INTERFACES.some(prefix => iface === prefix || iface.startsWith(prefix))
}

function getInstanceMode(mode: string | null | undefined): InstanceNetworkMode {
  switch (mode) {
    case 'nat_ipv6':
    case 'nat_ipv6_nat':
    case 'ipv6_only':
    case 'ipv6_nat':
      return mode
    default:
      return 'nat'
  }
}

function pickGlobalIpv6(addresses: NetworkAddressEntry[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null
  for (const addr of addresses) {
    if (addr.family !== 'inet6' || addr.scope !== 'global') continue
    const normalized = normalizeIpv6Address(addr.address)
    if (isGlobalRoutableIpv6(normalized)) {
      return normalized
    }
  }
  return null
}

export function extractIpv4FromState(state: IncusNetworkStateLike | null | undefined): string | null {
  if (!state?.network) return null

  const eth0 = state.network.eth0
  if (eth0?.addresses) {
    for (const addr of eth0.addresses) {
      if (addr.family === 'inet' && addr.scope === 'global') {
        return addr.address
      }
    }
  }

  for (const [iface, info] of Object.entries(state.network)) {
    if (shouldSkipInterface(iface)) continue
    for (const addr of info.addresses || []) {
      if (addr.family === 'inet' && addr.scope === 'global') {
        return addr.address
      }
    }
  }

  return null
}

export function extractIpv6FromState(state: IncusNetworkStateLike | null | undefined): string | null {
  if (!state?.network) return null

  const preferredInterfaces = ['eth1', 'enp5s0', 'ens5', 'eno1']
  for (const iface of preferredInterfaces) {
    const ipv6 = pickGlobalIpv6(state.network[iface]?.addresses)
    if (ipv6) return ipv6
  }

  for (const [iface, info] of Object.entries(state.network)) {
    if (shouldSkipInterface(iface)) continue
    const ipv6 = pickGlobalIpv6(info.addresses)
    if (ipv6) return ipv6
  }

  return null
}

function getDeviceEntries(instance: Pick<IncusInstance, 'devices' | 'expanded_devices'>): Array<[string, Record<string, unknown>]> {
  const expanded = Object.entries(instance.expanded_devices || {})
  if (expanded.length > 0) return expanded
  return Object.entries(instance.devices || {})
}

export function extractConfiguredPrimaryIpv6(
  instance: Pick<IncusInstance, 'devices' | 'expanded_devices'> | null | undefined
): { address: string | null; device: string } {
  if (!instance) {
    return { address: null, device: 'eth1' }
  }

  const entries = getDeviceEntries(instance)
  const ordered = [
    ...entries.filter(([name]) => name === 'eth1'),
    ...entries.filter(([name]) => name !== 'eth1')
  ]

  for (const [fallbackDevice, device] of ordered) {
    const rawIpv6 = typeof device['ipv6.address'] === 'string' ? device['ipv6.address'] : null
    const candidates = (rawIpv6 || '')
      .split(',')
      .map(item => normalizeIpv6Address(item))
      .filter((item): item is string => Boolean(item))

    const configuredIpv6 = candidates.find(item => isGlobalRoutableIpv6(item)) || null
    if (configuredIpv6) {
      const deviceName = typeof device.name === 'string' && device.name.trim()
        ? device.name.trim()
        : fallbackDevice
      return { address: configuredIpv6, device: deviceName || 'eth1' }
    }
  }

  return { address: null, device: 'eth1' }
}

export function resolveInstanceNetworkAddresses(
  instance: InstanceNetworkSyncTarget,
  incusInstance?: Pick<IncusInstance, 'devices' | 'expanded_devices'> | null,
  state?: IncusNetworkStateLike | null
): ResolvedInstanceNetworkAddresses {
  const mode = getInstanceMode(instance.networkMode)
  const observedIpv4 = extractIpv4FromState(state)
  const observedIpv6 = extractIpv6FromState(state)
  const configuredIpv6 = extractConfiguredPrimaryIpv6(incusInstance)

  const resolvedIpv4 = observedIpv4 || instance.ipv4 || null

  let resolvedIpv6: string | null = instance.ipv6 || null
  if (ROUTED_IPV6_MODES.has(mode)) {
    resolvedIpv6 = configuredIpv6.address || observedIpv6 || instance.ipv6 || null
  } else if (SHARED_IPV6_MODES.has(mode)) {
    resolvedIpv6 = observedIpv6 || instance.ipv6 || null
  }

  return {
    ipv4: resolvedIpv4,
    ipv6: resolvedIpv6,
    ipv4Device: 'eth0',
    ipv6Device: configuredIpv6.device,
    configuredIpv6: configuredIpv6.address,
    observedIpv6
  }
}

async function syncPrimaryIpAddress(
  tx: Prisma.TransactionClient,
  instance: InstanceNetworkSyncTarget,
  type: 'inet4' | 'inet6',
  address: string | null,
  device: string
): Promise<void> {
  if (!address) {
    await tx.ipAddress.deleteMany({
      where: {
        instanceId: instance.id,
        type,
        isPrimary: true,
        isCustom: false
      }
    })
    return
  }

  let hostId = instance.hostId ?? null
  if (!hostId) {
    const currentInstance = await tx.instance.findUnique({
      where: { id: instance.id },
      select: { hostId: true }
    })
    hostId = currentInstance?.hostId ?? null
  }

  if (!hostId) {
    throw new Error(`Unable to resolve host scope for instance ${instance.id}`)
  }

  const existingByAddress = await tx.instance.findFirst({
    where: {
      id: { not: instance.id },
      status: { not: 'deleted' },
      ...(type === 'inet4' ? { hostId: hostId! } : {}),
      OR: [
        type === 'inet4'
          ? { ipv4: address }
          : { ipv6: address },
        {
          ipAddresses: {
            some: { address, type }
          }
        }
      ]
    },
    select: { id: true }
  })

  if (existingByAddress) {
    throw new Error(`IP address ${address} is already assigned to instance ${existingByAddress.id}`)
  }

  const existingPrimary = await tx.ipAddress.findFirst({
    where: {
      instanceId: instance.id,
      type,
      isPrimary: true,
      isCustom: false
    },
    orderBy: { id: 'asc' },
    select: { id: true }
  })

  let primaryRecordId: number
  if (existingPrimary) {
    await tx.ipAddress.update({
      where: { id: existingPrimary.id },
      data: {
        address,
        type,
        isPrimary: true,
        isCustom: false,
        device,
        host: {
          connect: { id: hostId }
        },
        instance: {
          connect: { id: instance.id }
        }
      }
    })
    primaryRecordId = existingPrimary.id
  } else {
    const created = await tx.ipAddress.create({
      data: {
        address,
        type,
        isPrimary: true,
        isCustom: false,
        device,
        host: {
          connect: { id: hostId }
        },
        instance: {
          connect: { id: instance.id }
        }
      },
      select: { id: true }
    })
    primaryRecordId = created.id
  }

  await tx.ipAddress.deleteMany({
    where: {
      instanceId: instance.id,
      type,
      isPrimary: true,
      isCustom: false,
      id: { not: primaryRecordId }
    }
  })
}

export async function persistResolvedInstanceNetworkAddresses(
  instance: InstanceNetworkSyncTarget,
  resolved: ResolvedInstanceNetworkAddresses,
  options: { updateLastSyncedAt?: boolean } = {}
): Promise<PersistedInstanceNetworkAddresses> {
  const oldIpv4 = instance.ipv4 ?? null
  const oldIpv6 = instance.ipv6 ?? null
  const newIpv4 = resolved.ipv4 ?? null
  const newIpv6 = resolved.ipv6 ?? null

  const ipv4Changed = oldIpv4 !== newIpv4
  const ipv6Changed = oldIpv6 !== newIpv6

  await prisma.$transaction(async (tx) => {
    const currentInstance = await tx.instance.findUnique({
      where: { id: instance.id },
      select: { status: true }
    })
    if (!currentInstance || currentInstance.status === 'deleted') {
      return
    }

    const updateData: Record<string, unknown> = {}

    if (ipv4Changed) updateData.ipv4 = newIpv4
    if (ipv6Changed) updateData.ipv6 = newIpv6
    if (options.updateLastSyncedAt) updateData.lastSyncedAt = new Date()

    if (Object.keys(updateData).length > 0) {
      await tx.instance.updateMany({
        where: {
          id: instance.id,
          status: { not: 'deleted' }
        },
        data: updateData
      })
    }

    await syncPrimaryIpAddress(tx, instance, 'inet4', newIpv4, resolved.ipv4Device)
    await syncPrimaryIpAddress(tx, instance, 'inet6', newIpv6, resolved.ipv6Device)
  })

  return {
    ipv4Changed,
    oldIpv4,
    newIpv4,
    ipv6Changed,
    oldIpv6,
    newIpv6
  }
}
