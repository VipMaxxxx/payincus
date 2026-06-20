import { lookup as dnsLookup } from 'dns/promises'
import { isIP } from 'net'
import { schedule } from 'node-cron'
import { Address4, Address6 } from 'ip-address'
import type { HostAddressCheckTrigger, HostAddressKind, Prisma } from '@prisma/client'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'
import { ErrorCode, type ErrorCodeType } from '../lib/errors.js'
import { prisma } from '../db/prisma.js'
import {
  createHostAddressResolutionLog,
  getAliasesByAddresses,
  getHostsForAddressBackfill,
  getHostsWithDomainInputAlias,
  replaceHostResolvedAliases,
  syncHostAddressConflicts,
  type HostAddressAliasInput,
  type HostAddressConflictInfo,
  upsertHostInputAlias
} from '../db/host-addresses.js'
import { createBulkMessages } from '../db/inbox.js'
import { createLog } from '../db/logs.js'
import { getAllAdminUserIds } from '../db/users.js'

type DbClient = Prisma.TransactionClient | typeof prisma

const HOST_ADDRESS_LOCK_KEY = 'host-address-registry'
const HOST_ADDRESS_POLL_CRON = '*/30 * * * *'
const HOST_ADDRESS_LOCK_EXPIRE_MS = 60 * 1000
const HOST_ADDRESS_LOCK_WAIT_MS = 10 * 1000

interface NormalizedAddress {
  address: string
  kind: HostAddressKind
}

export interface HostAddressSnapshot {
  input: NormalizedAddress
  resolved: NormalizedAddress[]
  aliases: HostAddressAliasInput[]
}

export class HostAddressRegistryError extends Error {
  constructor(
    public readonly errorCode: ErrorCodeType,
    public readonly details?: string,
    message?: string
  ) {
    super(message || details || errorCode)
    this.name = 'HostAddressRegistryError'
  }
}

function normalizeAddress(input: string): NormalizedAddress {
  const trimmed = input.trim().replace(/^\[|\]$/g, '')
  const family = isIP(trimmed)

  if (family === 4) {
    return {
      address: new Address4(trimmed).correctForm(),
      kind: 'ipv4'
    }
  }

  if (family === 6) {
    return {
      address: new Address6(trimmed).correctForm(),
      kind: 'ipv6'
    }
  }

  return {
    address: trimmed.toLowerCase().replace(/\.$/, ''),
    kind: 'domain'
  }
}

function extractInputAddress(url: string): NormalizedAddress {
  try {
    const urlObj = new URL(url)
    return normalizeAddress(urlObj.hostname)
  } catch {
    throw new HostAddressRegistryError(
      ErrorCode.HOST_ADDRESS_UNRESOLVABLE,
      `宿主机连接地址格式无效: ${url}`
    )
  }
}

async function resolveDomainAddresses(domain: string): Promise<NormalizedAddress[]> {
  try {
    const records = await dnsLookup(domain, { all: true, verbatim: true })
    const unique = new Map<string, NormalizedAddress>()

    for (const record of records) {
      const normalized = normalizeAddress(record.address)
      unique.set(normalized.address, normalized)
    }

    const resolved = [...unique.values()]
    if (resolved.length === 0) {
      throw new HostAddressRegistryError(
        ErrorCode.HOST_ADDRESS_UNRESOLVABLE,
        `面板当前未解析到域名 ${domain}`
      )
    }

    return resolved
  } catch (error: any) {
    if (error instanceof HostAddressRegistryError) {
      throw error
    }

    const code = error?.code ? String(error.code) : 'UNKNOWN'
    throw new HostAddressRegistryError(
      ErrorCode.HOST_ADDRESS_UNRESOLVABLE,
      `面板当前无法解析域名 ${domain} (${code})`
    )
  }
}

function buildSnapshot(input: NormalizedAddress, resolved: NormalizedAddress[]): HostAddressSnapshot {
  const aliases = new Map<string, HostAddressAliasInput>()
  aliases.set(input.address, {
    address: input.address,
    kind: input.kind,
    source: 'input'
  })

  for (const item of resolved) {
    aliases.set(item.address, {
      address: item.address,
      kind: item.kind,
      source: 'resolved'
    })
  }

  return {
    input,
    resolved,
    aliases: [...aliases.values()]
  }
}

export async function prepareHostAddressSnapshotForWrite(
  url: string,
  excludeHostId?: number
): Promise<HostAddressSnapshot> {
  const input = extractInputAddress(url)
  const resolved = input.kind === 'domain'
    ? await resolveDomainAddresses(input.address)
    : []

  const snapshot = buildSnapshot(input, resolved)
  const conflicts = await getAliasesByAddresses(
    snapshot.aliases.map(alias => alias.address),
    excludeHostId
  )

  if (conflicts.length > 0) {
    const hostsByAddress = new Map<string, string[]>()
    for (const conflict of conflicts) {
      const list = hostsByAddress.get(conflict.address) ?? []
      const label = `${conflict.host.name}(#${conflict.host.id})`
      if (!list.includes(label)) {
        list.push(label)
      }
      hostsByAddress.set(conflict.address, list)
    }

    const detail = [...hostsByAddress.entries()]
      .map(([address, hosts]) => `${address} 已被节点 ${hosts.join(', ')} 使用`)
      .join('；')

    throw new HostAddressRegistryError(ErrorCode.HOST_ADDRESS_EXISTS, detail)
  }

  return snapshot
}

export async function withHostAddressRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(HOST_ADDRESS_LOCK_KEY, {
    expireMs: HOST_ADDRESS_LOCK_EXPIRE_MS,
    waitTimeoutMs: HOST_ADDRESS_LOCK_WAIT_MS
  })

  if (!lock.success || !lock.ownerId) {
    throw new Error(lock.error || 'Failed to acquire host address registry lock')
  }

  try {
    return await fn()
  } finally {
    await releaseLock(HOST_ADDRESS_LOCK_KEY, lock.ownerId)
  }
}

export async function persistHostAddressSnapshot(
  hostId: number,
  snapshot: HostAddressSnapshot,
  trigger: HostAddressCheckTrigger,
  client: DbClient = prisma
): Promise<HostAddressConflictInfo[]> {
  const existingAliases = await client.hostAddressAlias.findMany({
    where: { hostId },
    select: { address: true }
  })

  await client.hostAddressAlias.deleteMany({
    where: {
      hostId,
      source: 'input',
      address: {
        not: snapshot.input.address
      }
    }
  })

  await upsertHostInputAlias(hostId, {
    address: snapshot.input.address,
    kind: snapshot.input.kind,
    source: 'input'
  }, client)

  await replaceHostResolvedAliases(
    hostId,
    snapshot.resolved.map(item => ({
      address: item.address,
      kind: item.kind,
      source: 'resolved'
    })),
    client
  )

  await createHostAddressResolutionLog({
    hostId,
    inputAddress: snapshot.input.address,
    inputKind: snapshot.input.kind,
    trigger,
    status: 'success',
    resolvedAddresses: snapshot.resolved.map(item => item.address),
    details: {
      aliasAddresses: snapshot.aliases.map(item => item.address)
    }
  }, client)

  return syncHostAddressConflicts(
    [
      ...existingAliases.map(item => item.address),
      ...snapshot.aliases.map(item => item.address)
    ],
    client
  )
}

export async function recordHostAddressResolutionFailure(
  hostId: number,
  url: string,
  trigger: HostAddressCheckTrigger,
  error: HostAddressRegistryError,
  client: DbClient = prisma
): Promise<HostAddressConflictInfo[]> {
  const existingAliases = await client.hostAddressAlias.findMany({
    where: { hostId },
    select: { address: true }
  })
  const input = extractInputAddress(url)

  await client.hostAddressAlias.deleteMany({
    where: {
      hostId,
      source: 'input',
      address: {
        not: input.address
      }
    }
  })

  await upsertHostInputAlias(hostId, {
    address: input.address,
    kind: input.kind,
    source: 'input'
  }, client)

  await createHostAddressResolutionLog({
    hostId,
    inputAddress: input.address,
    inputKind: input.kind,
    trigger,
    status: 'failed',
    resolvedAddresses: [],
    error: error.details || error.message,
    details: {
      errorCode: error.errorCode
    }
  }, client)

  return syncHostAddressConflicts([
    ...existingAliases.map(item => item.address),
    input.address
  ], client)
}

async function notifyAdminsAboutConflicts(conflicts: HostAddressConflictInfo[]): Promise<void> {
  if (conflicts.length === 0) {
    return
  }

  const adminIds = await getAllAdminUserIds()
  if (adminIds.length === 0) {
    return
  }

  const lines = conflicts.map(conflict =>
    `地址 ${conflict.address} 在节点 ${conflict.hostAName}(#${conflict.hostAId}) 与 ${conflict.hostBName}(#${conflict.hostBId}) 之间发生冲突`
  )

  const content = lines.join('\n')

  await createBulkMessages({
    userIds: adminIds,
    eventType: 'host_address_conflict',
    title: '检测到节点连接地址冲突',
    content,
    data: {
      conflicts: conflicts.map(conflict => ({
        id: conflict.id,
        address: conflict.address,
        hostAId: conflict.hostAId,
        hostBId: conflict.hostBId
      }))
    }
  })

  await createLog(
    null,
    'host',
    'host.address_conflict',
    content,
    'warning'
  )
}

export async function logHostAddressResolutionFailure(
  actorUserId: number | null,
  hostLabel: string,
  url: string,
  trigger: HostAddressCheckTrigger,
  error: HostAddressRegistryError
): Promise<void> {
  const input = extractInputAddress(url)
  const message = `[HostAddress] ${trigger} 解析失败: ${hostLabel} -> ${input.address}; ${error.details || error.message}`
  console.warn(message)

  await createLog(
    actorUserId,
    'host',
    'host.address_resolve',
    message,
    'warning'
  )
}

export async function syncExistingHostAddressState(
  hostId: number,
  hostName: string,
  url: string,
  trigger: Extract<HostAddressCheckTrigger, 'backfill' | 'poll'>
): Promise<{ success: boolean }> {
  try {
    const input = extractInputAddress(url)
    const resolved = input.kind === 'domain'
      ? await resolveDomainAddresses(input.address)
      : []
    const snapshot = buildSnapshot(input, resolved)

    const createdConflicts = await withHostAddressRegistryLock(async () => {
      return prisma.$transaction(async tx => {
        return persistHostAddressSnapshot(hostId, snapshot, trigger, tx)
      })
    })

    await notifyAdminsAboutConflicts(createdConflicts)
    return { success: true }
  } catch (error) {
    if (!(error instanceof HostAddressRegistryError)) {
      console.error(`[HostAddress] ${trigger} failed for ${hostName}(#${hostId}):`, error)
      return { success: false }
    }

    await logHostAddressResolutionFailure(null, `${hostName}(#${hostId})`, url, trigger, error)

    try {
      const createdConflicts = await withHostAddressRegistryLock(async () => {
        return prisma.$transaction(async tx => {
          return recordHostAddressResolutionFailure(hostId, url, trigger, error, tx)
        })
      })

      await notifyAdminsAboutConflicts(createdConflicts)
    } catch (persistError) {
      console.error(`[HostAddress] Failed to persist ${trigger} error for ${hostName}(#${hostId}):`, persistError)
    }

    return { success: false }
  }
}

export async function runHostAddressBackfillJob(): Promise<void> {
  const hosts = await getHostsForAddressBackfill()
  let successCount = 0
  let failedCount = 0

  console.log(`[HostAddress] Starting backfill for ${hosts.length} host(s)`)

  for (const host of hosts) {
    try {
      const result = await syncExistingHostAddressState(host.id, host.name, host.url, 'backfill')
      if (result.success) {
        successCount++
      } else {
        failedCount++
      }
    } catch (error) {
      failedCount++
      console.error(`[HostAddress] Backfill host failed: ${host.name}(#${host.id})`, error)
    }
  }

  console.log(`[HostAddress] Backfill completed: success=${successCount}, failed=${failedCount}`)
}

export async function runHostAddressPollJob(): Promise<void> {
  const hosts = await getHostsWithDomainInputAlias()
  let successCount = 0
  let failedCount = 0

  console.log(`[HostAddress] Starting poll for ${hosts.length} domain host(s)`)

  for (const host of hosts) {
    try {
      const result = await syncExistingHostAddressState(host.id, host.name, host.url, 'poll')
      if (result.success) {
        successCount++
      } else {
        failedCount++
      }
    } catch (error) {
      failedCount++
      console.error(`[HostAddress] Poll host failed: ${host.name}(#${host.id})`, error)
    }
  }

  console.log(`[HostAddress] Poll completed: success=${successCount}, failed=${failedCount}`)
}

let schedulerStarted = false

export function startHostAddressMonitor(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  runHostAddressBackfillJob().catch(error => {
    console.error('[HostAddress] Initial backfill failed:', error)
  })

  schedule(HOST_ADDRESS_POLL_CRON, () => {
    runHostAddressPollJob().catch(error => {
      console.error('[HostAddress] Scheduled poll failed:', error)
    })
  }, {
    timezone: 'Asia/Shanghai'
  })

  console.log('[HostAddress] Monitor started')
  console.log('[HostAddress] - Initial backfill: on startup')
  console.log('[HostAddress] - Domain poll: every 30 minutes')
}
