/**
 * Incus 实例管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusInstance, IncusOperation } from '../../types/incus.js'
import { allowanceToCores } from '../cpu-allowance.js'
import type { BuildInstanceConfigOptions, IPv6Config } from '../../types/incus.js'
import { buildNetworkDevices, generateCloudInitNetworkConfig, hasIpv6Support } from '../network-payload-builder.js'
import { generateVmNicMacs } from '../vm-network-identifiers.js'
import { resolveIncusSwapValue } from '../instance-swap.js'

const INSTANCE_BUSY_WAIT_TIMEOUT_MS = 300000
const INSTANCE_BUSY_POLL_INTERVAL_MS = 2000
const INSTANCE_BUSY_CANCEL_CHECK_INTERVAL_MS = 30000
const INSTANCE_BUSY_CANCEL_STALE_UPDATE_MS = 45000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractBusyOperationName(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/busy running a "([^"]+)" operation/i)
  return match?.[1]?.trim() || null
}

function normalizeOperationsPayload(payload: unknown): IncusOperation[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is IncusOperation => !!entry && typeof entry === 'object')
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  return Object.values(payload).filter((entry): entry is IncusOperation => !!entry && typeof entry === 'object')
}

function isOperationRunning(operation: IncusOperation): boolean {
  const status = operation.status?.toLowerCase()
  if (status && ['success', 'failure', 'cancelled', 'canceled'].includes(status)) {
    return false
  }

  return typeof operation.status_code === 'number' ? operation.status_code < 200 : true
}

function operationTouchesInstance(resources: unknown, instanceName: string): boolean {
  const instancePath = `/1.0/instances/${instanceName}`

  if (typeof resources === 'string') {
    return resources === instancePath || resources.startsWith(instancePath)
  }

  if (Array.isArray(resources)) {
    return resources.some(entry => operationTouchesInstance(entry, instanceName))
  }

  if (resources && typeof resources === 'object') {
    return Object.values(resources).some(entry => operationTouchesInstance(entry, instanceName))
  }

  return false
}

function describeOperation(operation: IncusOperation): string {
  return operation.description || operation.class || operation.id || 'operation'
}

async function listActiveInstanceOperations(client: IncusClient, instanceName: string): Promise<IncusOperation[]> {
  const payload = await client.request<unknown>('GET', '/1.0/operations?recursion=1')
  const operations = normalizeOperationsPayload(payload)

  return operations.filter(operation =>
    isOperationRunning(operation) && operationTouchesInstance(operation.resources, instanceName)
  )
}

function describeOperations(operations: IncusOperation[]): string {
  return operations.map(describeOperation).join(', ')
}

function getOperationPath(operation: IncusOperation): string | null {
  if (!operation.id) return null
  return operation.id.startsWith('/1.0/operations/')
    ? operation.id
    : `/1.0/operations/${operation.id}`
}

function operationAgeMs(operation: IncusOperation): number {
  const createdAt = Date.parse(operation.created_at || '')
  if (Number.isFinite(createdAt)) return Date.now() - createdAt
  const updatedAt = Date.parse(operation.updated_at || '')
  if (Number.isFinite(updatedAt)) return Date.now() - updatedAt
  return 0
}

function isUpdateOperation(operation: IncusOperation): boolean {
  const description = operation.description?.toLowerCase() || ''
  const metadataAction = typeof operation.metadata?.action === 'string'
    ? operation.metadata.action.toLowerCase()
    : ''
  return description.includes('update') || metadataAction === 'update'
}

async function cancelStaleUpdateOperations(client: IncusClient, instanceName: string): Promise<number> {
  const activeOperations = await listActiveInstanceOperations(client, instanceName)
  const cancellable = activeOperations.filter(operation =>
    isUpdateOperation(operation)
    && operation.may_cancel !== false
    && operationAgeMs(operation) >= INSTANCE_BUSY_CANCEL_STALE_UPDATE_MS
  )

  let cancelled = 0
  for (const operation of cancellable) {
    const operationPath = getOperationPath(operation)
    if (!operationPath) continue
    try {
      await client.request('DELETE', operationPath)
      cancelled++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Incus] Failed to cancel stale update operation ${operation.id} for ${instanceName}: ${message}`)
    }
  }

  return cancelled
}

export interface BusyRetryOptions {
  allowCancelBusyUpdate?: boolean
  busyUpdateCancelAfterMs?: number
}

function extractInstanceStatus(state: unknown): string {
  if (!state || typeof state !== 'object') return ''
  const rawStatus = (state as { status?: unknown }).status
  return typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : ''
}

async function runInstanceActionWithBusyRetry<T>(
  client: IncusClient,
  instanceName: string,
  actionLabel: string,
  action: () => Promise<T>,
  options: BusyRetryOptions = {}
): Promise<T> {
  const busySince = Date.now()
  let lastLogAt = 0
  let lastCancelCheckAt = 0
  let lastBusyOperation: string | null = null
  const busyUpdateCancelAfterMs = options.busyUpdateCancelAfterMs ?? INSTANCE_BUSY_CANCEL_STALE_UPDATE_MS

  while (Date.now() - busySince <= INSTANCE_BUSY_WAIT_TIMEOUT_MS) {
    try {
      return await action()
    } catch (error) {
      const busyOperation = extractBusyOperationName(error)
      if (!busyOperation) {
        throw error
      }

      lastBusyOperation = busyOperation
      const now = Date.now()
      const elapsedMs = now - busySince
      const remainingMs = Math.max(0, INSTANCE_BUSY_WAIT_TIMEOUT_MS - elapsedMs)
      let activeOperationDescription = ''

      try {
        const activeOperations = await listActiveInstanceOperations(client, instanceName)
        if (activeOperations.length > 0) {
          activeOperationDescription = describeOperations(activeOperations)
        }
      } catch {
        // Operation list is best-effort diagnostics only.
      }

      if (now - lastLogAt >= 10000) {
        const details = activeOperationDescription ? ` activeOps=[${activeOperationDescription}]` : ''
        console.warn(
          `[Incus] Instance ${instanceName} is busy running a "${busyOperation}" operation while trying to ${actionLabel}; elapsed=${Math.ceil(elapsedMs / 1000)}s remaining=${Math.ceil(remainingMs / 1000)}s${details}`
        )
        lastLogAt = now
      }

      if (
        options.allowCancelBusyUpdate
        && busyOperation.toLowerCase() === 'update'
        && elapsedMs >= busyUpdateCancelAfterMs
        && (now - lastCancelCheckAt) >= INSTANCE_BUSY_CANCEL_CHECK_INTERVAL_MS
      ) {
        lastCancelCheckAt = now
        try {
          const cancelledCount = await cancelStaleUpdateOperations(client, instanceName)
          if (cancelledCount > 0) {
            console.warn(`[Incus] Cancelled ${cancelledCount} stale update operation(s) for ${instanceName}`)
          }
        } catch (cancelError) {
          const cancelMessage = cancelError instanceof Error ? cancelError.message : String(cancelError)
          console.warn(`[Incus] Failed stale update cancellation check for ${instanceName}: ${cancelMessage}`)
        }
      }

      if (remainingMs <= 0) {
        if (activeOperationDescription) {
          throw new Error(`Instance "${instanceName}" remained busy after waiting to ${actionLabel}: ${activeOperationDescription}`)
        }

        throw new Error(`Instance "${instanceName}" remained busy running a "${busyOperation}" operation while trying to ${actionLabel}`)
      }

      await sleep(Math.min(INSTANCE_BUSY_POLL_INTERVAL_MS, remainingMs))
    }
  }

  if (lastBusyOperation) {
    throw new Error(`Instance "${instanceName}" remained busy running a "${lastBusyOperation}" operation while trying to ${actionLabel}`)
  }

  throw new Error(`Failed to ${actionLabel}`)
}

/**
 * 获取所有实例
 */
export async function listInstances(client: IncusClient): Promise<IncusInstance[]> {
  const urls = await client.request<string[]>('GET', '/1.0/instances')
  const instances: IncusInstance[] = []

  for (const url of urls || []) {
    const name = url.split('/').pop() || ''
    const instance = await getInstance(client, name)
    instances.push(instance)
  }

  return instances
}

/**
 * 获取实例详情
 */
export async function getInstance(client: IncusClient, name: string): Promise<IncusInstance> {
  return client.request<IncusInstance>('GET', `/1.0/instances/${name}`)
}

/**
 * 获取实例状态
 */
export async function getInstanceState(client: IncusClient, name: string): Promise<unknown> {
  return client.request('GET', `/1.0/instances/${name}/state`)
}

/**
 * 创建实例
 */
export async function createInstance(client: IncusClient, config: unknown): Promise<unknown> {
  return client.request('POST', '/1.0/instances', config)
}

/**
 * 删除实例
 */
export async function deleteInstance(client: IncusClient, name: string): Promise<unknown> {
  return client.request('DELETE', `/1.0/instances/${name}`)
}

/**
 * 启动实例
 */
export async function startInstance(client: IncusClient, name: string): Promise<unknown> {
  return client.request('PUT', `/1.0/instances/${name}/state`, {
    action: 'start',
    timeout: 60  // 60秒
  })
}

/**
 * 停止实例
 */
export async function stopInstance(
  client: IncusClient,
  name: string,
  force: boolean = false,
  options: BusyRetryOptions = {}
): Promise<unknown> {
  return runInstanceActionWithBusyRetry(client, name, 'stop the instance', async () => {
    const currentState = await getInstanceState(client, name)
    const currentStatus = extractInstanceStatus(currentState)

    // Alpine 等镜像上偶发会残留一个 update operation 锁，
    // 但实例本体其实已经停下来了；此时无需再次发送 stop。
    if (currentStatus === 'stopped') {
      return currentState
    }

    return client.request('PUT', `/1.0/instances/${name}/state`, {
      action: 'stop',
      timeout: 60,
      force
    })
  },
    options
  )
}

/**
 * 重启实例
 */
export async function restartInstance(client: IncusClient, name: string, force: boolean = false): Promise<unknown> {
  return client.request('PUT', `/1.0/instances/${name}/state`, {
    action: 'restart',
    timeout: 60,  // 60秒
    force
  })
}

/**
 * 冻结实例
 */
export async function freezeInstance(client: IncusClient, name: string): Promise<unknown> {
  return client.request('PUT', `/1.0/instances/${name}/state`, {
    action: 'freeze',
    timeout: 60
  })
}

/**
 * 解冻实例
 */
export async function unfreezeInstance(client: IncusClient, name: string): Promise<unknown> {
  return client.request('PUT', `/1.0/instances/${name}/state`, {
    action: 'unfreeze',
    timeout: 30
  })
}

/**
 * 重建实例（重装系统）
 * @param config - 可选的 cloud-init 配置，用于注入 SSH 密钥和密码
 */
export async function rebuildInstance(
  client: IncusClient,
  name: string,
  imageSource: { alias?: string; fingerprint?: string; server?: string; mode?: string; protocol?: string },
  config?: Record<string, string>,
  options: BusyRetryOptions = {}
): Promise<unknown> {
  // 处理远程镜像源
  // 如果 alias 以 "images:" 开头，表示从远程 images.linuxcontainers.org 拉取
  let source: Record<string, string>
  if (imageSource.alias?.startsWith('images:')) {
    const remoteAlias = imageSource.alias.replace('images:', '')
    source = {
      type: 'image',
      mode: 'pull',
      server: 'https://images.linuxcontainers.org',
      protocol: 'simplestreams',
      alias: remoteAlias
    }
  } else {
    source = {
      type: 'image',
      ...imageSource
    } as Record<string, string>
  }

  const payload: Record<string, unknown> = { source }

  // 如果提供了 config，添加到请求中（用于 cloud-init）
  if (config && Object.keys(config).length > 0) {
    payload.config = config
  }

  // rebuild 是耗时操作，使用 5 分钟超时
  return runInstanceActionWithBusyRetry(client, name, 'rebuild the instance', () =>
    client.request('POST', `/1.0/instances/${name}/rebuild`, payload, 300000),
    options
  )
}

/**
 * 更新实例配置
 * 注意：config 对象会与现有配置合并，而不是替换
 */
export async function updateInstance(client: IncusClient, name: string, updates: Record<string, unknown>): Promise<unknown> {
  return runInstanceActionWithBusyRetry(client, name, 'update the instance configuration', async () => {
    const current = await getInstance(client, name) as unknown as Record<string, unknown>
    const sanitizedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    )

    // 如果更新包含 config，需要合并而不是替换
    if (sanitizedUpdates.config && current.config) {
      sanitizedUpdates.config = {
        ...(current.config as Record<string, unknown>),
        ...(sanitizedUpdates.config as Record<string, unknown>)
      }
    }

    return client.request('PUT', `/1.0/instances/${name}`, {
      ...current,
      ...sanitizedUpdates
    })
  })
}

/**
 * 增量更新实例资源配置（使用 PATCH，实时生效无需重启）
 * 支持修改 CPU、内存、磁盘（磁盘只能增大）
 */
export async function patchInstanceResources(
  client: IncusClient,
  name: string,
  resources: {
    cpu?: number      // CPU 额配百分比
    memory?: number   // 内存大小 MB
    disk?: number     // 磁盘大小 MB
  }
): Promise<unknown> {
  const patchData: { config?: Record<string, string>; devices?: Record<string, unknown> } = {}

  // 更新 CPU 配置
  if (resources.cpu !== undefined) {
    patchData.config = patchData.config || {}
    patchData.config['limits.cpu'] = String(allowanceToCores(resources.cpu))
    patchData.config['limits.cpu.allowance'] = `${resources.cpu}%`
  }

  // 更新内存配置
  if (resources.memory !== undefined) {
    patchData.config = patchData.config || {}
    patchData.config['limits.memory'] = `${resources.memory}MB`
  }

  // 更新磁盘配置
  if (resources.disk !== undefined) {
    // 获取当前实例配置以保留 root 设备的其他属性
    const current = await getInstance(client, name)
    const currentRoot = current.devices?.root || {}

    patchData.devices = {
      root: {
        ...currentRoot,
        path: '/',
        pool: currentRoot.pool || 'default',
        type: 'disk',
        size: `${resources.disk}MB`
      }
    }
  }

  // 使用 PATCH 进行增量更新
  return client.request('PATCH', `/1.0/instances/${name}`, patchData)
}

/**
 * 原子更新实例的 IPv6 地址列表
 * 使用 PATCH 操作同时清除 volatile 状态并更新 IPv6 配置，避免校验死锁
 * @param client Incus 客户端
 * @param instanceName 实例名称
 * @param ipv6List IPv6 地址列表（将被转换为逗号分隔的字符串）
 * @param deviceName 网卡设备名称，默认为 'eth0'
 * @param networkName 网络名称，默认为 'incusbr0'
 * @param restart 是否在更新后重启容器，默认为 true
 */
export async function updateInstanceIpv6Addresses(
  client: IncusClient,
  instanceName: string,
  ipv6List: string[],
  deviceName: string = 'eth0',
  networkName: string = 'incusbr0',
  restart: boolean = true
): Promise<unknown> {
  // 获取当前实例配置，保留 eth0 的其他设置
  const instance = await getInstance(client, instanceName)
  const currentDevices = instance.devices || {}
  const eth0Config = (currentDevices[deviceName] as Record<string, unknown>) || {}

  // 将 IP 数组转换为 Incus 要求的 "IP1,IP2" 字符串格式（无空格，严格过滤空值）
  const ipString = ipv6List
    .filter(ip => ip && ip.trim() !== '') // 过滤掉 null/undefined/空字符串
    .map(ip => ip.trim())                 // 去除每个 IP 前后的空格
    .join(',')                            // 仅用逗号拼接，严禁空格

  // 检查实例状态，volatile 状态只在运行时存在
  const state = await getInstanceState(client, instanceName) as { status?: string }
  const isRunning = state.status === 'Running'

  // 构造 PATCH Payload：同时包含 config (清理 volatile) 和 devices (设置新 IP)
  // 关键修复：显式设置 ipv4.address 为 null 以清除可能残留的脏数据
  // 背景：Incus PATCH 是增量更新，如果之前的操作无意中将 ipv4.address 设为空字符串 "" 或错误值，
  // 它会一直留在配置里。PATCH 时不提 ipv4.address，就会保留原来的错误值，导致验证失败。
  // 设为 null 相当于告诉 Incus "删除这个字段"，从而消除验证错误的来源。
  const patchData: {
    config?: Record<string, string | null>
    devices?: Record<string, Record<string, unknown>>
  } = {
    devices: {
      [deviceName]: {
        ...eth0Config,
        name: deviceName,
        type: 'nic',
        network: networkName,
        'ipv6.address': ipString,
        'security.ipv6_filtering': 'true',
        // 关键修复：显式清除可能残留的 IPv4 脏数据
        // 如果不使用静态 IPv4，务必设为 null 以避免 "Item \"\": Not an IP address" 错误
        'ipv4.address': null
      }
    }
  }

  // 只有在实例运行时才需要清除 volatile 状态（volatile 是运行时状态）
  if (isRunning) {
    patchData.config = {
      // 关键：清除锁死容器的残留状态（根据 deviceName 动态生成）
      [`volatile.${deviceName}.host_name`]: null,
      [`volatile.${deviceName}.hwaddr`]: null,
      [`volatile.${deviceName}.last_state.ip_addresses`]: null
    }
  }

  // 使用 PATCH 进行原子更新
  const result = await client.request('PATCH', `/1.0/instances/${instanceName}`, patchData)

  // 如果实例正在运行且需要重启，则重启容器以生效
  // 注意：如果实例是停止状态，更新配置后不需要重启（下次启动时会自动应用）
  if (restart && isRunning) {
    try {
      await restartInstance(client, instanceName, false)
    } catch (err) {
      // 重启失败不影响主操作，只记录警告
      console.warn(`[updateInstanceIpv6Addresses] 重启容器 ${instanceName} 失败:`, err)
    }
  }

  return result
}

/**
 * 添加设备 (如端口映射)
 */
export async function addDevice(
  client: IncusClient,
  instanceName: string,
  deviceName: string,
  device: Record<string, unknown>
): Promise<unknown> {
  const instance = await getInstance(client, instanceName)
  const devices = instance.devices || {}
  devices[deviceName] = device
  return client.request('PUT', `/1.0/instances/${instanceName}`, {
    ...instance,
    devices
  })
}

/**
 * 删除设备
 */
export async function removeDevice(
  client: IncusClient,
  instanceName: string,
  deviceName: string
): Promise<unknown> {
  const instance = await getInstance(client, instanceName)
  if (instance.devices && instance.devices[deviceName]) {
    const devices = { ...instance.devices }
    delete devices[deviceName]
    return client.request('PUT', `/1.0/instances/${instanceName}`, {
      ...instance,
      devices
    })
  }
  return null
}

/**
 * 将带宽字符串统一转换为 Mbit 单位（兼容旧存量数据中的 Gbit 值）
 * Incus 支持 Mbit，对 Gbit 的支持因版本而异，统一转换避免报错
 */
function normalizeBandwidth(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  const match = value.match(/^(\d+(?:\.\d+)?)\s*Gbit$/i)
  if (match) {
    return `${Math.round(Number(match[1]) * 1000)}Mbit`
  }
  return value
}

/**
 * 生成实例配置
 */
export function buildInstanceConfig(options: BuildInstanceConfigOptions): Record<string, unknown> {
  const {
    name,
    image,
    cpu,
    memory,
    disk,
    swapEnabled,
    swapSize,
    sshKey,
    password,
    nested = false,
    privileged = false,
    cloudInitConfig = null,
    networkMode = 'nat',
    instanceType = 'container',
    // 存储池配置
    storagePool = 'default',
    // IP 配置 (新双网卡架构)
    ipv4Address,
    ipv6Config = null,
    hostInterface = 'eth0',
    // IPv6 静态地址配置 (旧方式，保持向后兼容)
    ipv6Address,
    ipv6Gateway: _ipv6Gateway,
    networkBridge = 'incusbr0',
    // Advanced configuration options
    limitsRead,
    limitsWrite,
    limitsReadIops,
    limitsWriteIops,
    limitsIngress,
    limitsEgress,
    limitsProcesses,
    limitsCpuPriority,
    bootAutostart,
    bootAutostartPriority,
    bootAutostartDelay,
    bootHostShutdownTimeout
  } = options

  // 兼容旧存量数据：将 Gbit 统一转换为 Mbit，避免 Incus 因单位格式拒绝请求
  const normalizedIngress = normalizeBandwidth(limitsIngress)
  const normalizedEgress = normalizeBandwidth(limitsEgress)

  const configObj: Record<string, string> = {
    // 资源限制映射
    // limits.cpu: CPU核心数（根据额配计算）
    // limits.cpu.allowance: CPU额配百分比（用户选择的值）
    'limits.cpu': String(allowanceToCores(cpu)),
    'limits.cpu.allowance': `${cpu}%`,
    'limits.memory': `${memory}MB`
  }

  if (instanceType === 'container' && (swapEnabled !== undefined || swapSize !== undefined)) {
    configObj['limits.memory.swap'] = resolveIncusSwapValue(swapEnabled === true, swapSize)
  }

  // Storage I/O limits (applied to root device)
  const rootDevice: Record<string, string> = {
    path: '/',
    pool: storagePool || 'default',
    type: 'disk',
    size: `${disk}MB`
  }

  // Apply storage I/O limits to root device
  // Incus limits.read/write 只能设置一种类型：带宽(如100MB) 或 IOPS(如500iops)
  // 优先使用带宽限制，如果没有则使用 IOPS 限制
  if (limitsRead) {
    rootDevice['limits.read'] = limitsRead
  } else if (limitsReadIops !== null && limitsReadIops !== undefined) {
    rootDevice['limits.read'] = `${limitsReadIops}iops`
  }
  if (limitsWrite) {
    rootDevice['limits.write'] = limitsWrite
  } else if (limitsWriteIops !== null && limitsWriteIops !== undefined) {
    rootDevice['limits.write'] = `${limitsWriteIops}iops`
  }

  // Process limits
  if (limitsProcesses !== null && limitsProcesses !== undefined) {
    configObj['limits.processes'] = String(limitsProcesses)
  }

  // CPU priority: Incus limits.cpu.priority accepts 0-10 directly (10=highest, 0=lowest)
  // Incus handles the internal cgroup/nice-value mapping itself — do NOT convert here.
  if (limitsCpuPriority !== null && limitsCpuPriority !== undefined) {
    configObj['limits.cpu.priority'] = String(limitsCpuPriority)
  }

  // Boot settings
  if (bootAutostart !== null && bootAutostart !== undefined) {
    configObj['boot.autostart'] = bootAutostart ? 'true' : 'false'
  }
  if (bootAutostartPriority !== null && bootAutostartPriority !== undefined) {
    configObj['boot.autostart.priority'] = String(bootAutostartPriority)
  }
  if (bootAutostartDelay !== null && bootAutostartDelay !== undefined) {
    configObj['boot.autostart.delay'] = String(bootAutostartDelay)
  }
  if (bootHostShutdownTimeout !== null && bootHostShutdownTimeout !== undefined) {
    configObj['boot.host_shutdown_timeout'] = String(bootHostShutdownTimeout)
  }

  // 网络设备配置
  const devices: Record<string, Record<string, string>> = {
    root: rootDevice
  }

  if (instanceType === 'vm') {
    // Some cloud images (notably RHEL-family images from the Incus images remote)
    // require the agent config ISO/CD-ROM to be attached at boot time.
    devices.agent = {
      type: 'disk',
      source: 'agent:config'
    }
  }

  // 构建网络设备配置
  // 所有模式统一使用新架构 buildNetworkDevices（内部已正确处理 5 种模式）
  // 仅在没有 ipv4Address 且非 Routed IPv6 时回退到旧架构（向后兼容）
  const effectiveIpv6Config: IPv6Config | null = ipv6Config || (ipv6Address ? { primaryIp: ipv6Address } : null)
  const vmNicMacs = instanceType === 'vm' ? generateVmNicMacs(name) : null

  // 使用新架构的条件：有静态 IPv4（新创建流程）或有 Routed IPv6 配置
  const useNewNetworkArchitecture = ipv4Address || (hasIpv6Support(networkMode) && effectiveIpv6Config && hostInterface)

  if (useNewNetworkArchitecture) {
    // 新架构: 使用 buildNetworkDevices 生成网络设备配置
    // - nat/nat_ipv6_nat/ipv6_nat: 仅 eth0 bridged
    // - nat_ipv6/ipv6_only: eth0 bridged + eth1 routed
    const networkDevices = buildNetworkDevices({
      networkMode,
      hostInterface: hostInterface || 'eth0',
      ipv6Config: effectiveIpv6Config,
      limitsIngress: normalizedIngress,
      limitsEgress: normalizedEgress,
      natBridge: networkBridge || 'incusbr0',
      ipv4Address: ipv4Address || undefined,
      eth0Hwaddr: vmNicMacs?.eth0,
      eth1Hwaddr: vmNicMacs?.eth1
    })

    // 合并网络设备到 devices
    Object.assign(devices, networkDevices)
  } else {
    // 旧架构：单网卡 NAT 模式 (保持向后兼容)
    // ipv4Address: VM 必须在 eth0 显式声明静态 IP，否则 Incus 拒绝 NAT proxy 规则
    const needsExplicitNetwork = instanceType === 'vm' || ipv4Address || ipv6Address || normalizedIngress || normalizedEgress || networkMode !== 'nat'

    if (needsExplicitNetwork) {
      const eth0Device: Record<string, string> = {
        type: 'nic',
        name: 'eth0',
        network: networkBridge || 'incusbr0'
      }
      if (vmNicMacs?.eth0) {
        eth0Device.hwaddr = vmNicMacs.eth0
      }

      // 固定内网 IPv4 地址（VM 必须显式声明，否则 Incus 认为 IP 是动态的）
      if (ipv4Address) {
        eth0Device['ipv4.address'] = ipv4Address
      }

      // 带宽限制（已统一转换为 Mbit）
      if (normalizedIngress) {
        eth0Device['limits.ingress'] = normalizedIngress
      }
      if (normalizedEgress) {
        eth0Device['limits.egress'] = normalizedEgress
      }

      devices['eth0'] = eth0Device
    }
  }

  // 处理镜像源配置
  // 如果镜像以 "images:" 开头，表示从远程 images.linuxcontainers.org 拉取
  let source: Record<string, string>
  if (image.startsWith('images:')) {
    const remoteAlias = image.replace('images:', '')
    source = {
      type: 'image',
      mode: 'pull',
      server: 'https://images.linuxcontainers.org',
      protocol: 'simplestreams',
      alias: remoteAlias
    }
  } else {
    // 本地镜像
    source = {
      type: 'image',
      alias: image
    }
  }

  const config: Record<string, unknown> = {
    name,
    // Incus API: 'container' 或 'virtual-machine'
    type: instanceType === 'vm' ? 'virtual-machine' : 'container',
    source,
    config: configObj,
    devices
  }

  // VM 关闭 UEFI 安全启动（允许用户 DD 系统等操作）
  if (instanceType === 'vm') {
    (config.config as Record<string, string>)['security.secureboot'] = 'false'
  }

  // 特性映射: 嵌套虚拟化 (允许在 VPS 里跑 Docker)
  if (nested) {
    (config.config as Record<string, string>)['security.nesting'] = 'true'
  }

  // 特性映射: 特权模式
  if (privileged) {
    (config.config as Record<string, string>)['security.privileged'] = 'true'
  }

  // 如果提供了 cloudInitConfig（来自配置生成器），直接使用
  if (cloudInitConfig && cloudInitConfig['user.user-data']) {
    (config.config as Record<string, string>)['user.user-data'] = cloudInitConfig['user.user-data']
    // 同时注入 network-config（解决 RHEL/Alpine 的 DHCPv6 问题）
    if (cloudInitConfig['user.network-config']) {
      (config.config as Record<string, string>)['user.network-config'] = cloudInitConfig['user.network-config']
    }
  } else {
    // 否则使用旧的逻辑（向后兼容）
    // Cloud-Init 配置: SSH 公钥注入 + 密码设置 + 主机名
    const lines: string[] = [
      '#cloud-config',
      `hostname: ${name}`,
      'manage_etc_hosts: true'
    ]

    if (password) {
      lines[lines.length] = 'chpasswd:'
      lines[lines.length] = '  expire: false'
      lines[lines.length] = '  list:'
      lines[lines.length] = `    - root:${password}`
      lines[lines.length] = 'ssh_pwauth: true'
    }

    if (sshKey) {
      lines[lines.length] = 'ssh_authorized_keys:'
      lines[lines.length] = `  - ${sshKey.trim()}`
    }

    lines[lines.length] = 'disable_root: false'
    lines[lines.length] = 'runcmd:'
    lines[lines.length] = "  - sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config"
    lines[lines.length] = "  - sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config"
    lines[lines.length] = '  - systemctl restart sshd || service ssh restart || true'

    const cloudInitYaml = lines.join('\n')
      ; (config.config as Record<string, string>)['user.user-data'] = cloudInitYaml
  }

  // 如果使用新双网卡架构，生成包含 eth0 + eth1 的 v2 network-config
  // 注意：容器配置生成器 (incus-config-container.ts) 产生的 v1 config 仅包含 eth0，
  // 不支持 routed 模式的 eth1 IPv6 网卡。这里必须用 v2 配置覆盖，确保 eth1 正确配置。
  // 关键：VM 的 network-config 由 generateVmConfig 生成（含 MAC 匹配），绝不能被覆盖！
  // VM 内部网卡名为 enp5s0/enp6s0（非 eth0/eth1），只有 MAC 匹配才能正确识别。
  if (hasIpv6Support(networkMode) && effectiveIpv6Config && ipv4Address && instanceType !== 'vm') {
    // 构建 IPv6 地址列表
    const ipv6List = [effectiveIpv6Config.primaryIp]
    if (effectiveIpv6Config.extraIps && effectiveIpv6Config.extraIps.length > 0) {
      ipv6List.push(...effectiveIpv6Config.extraIps)
    }
    (config.config as Record<string, string>)['user.network-config'] = generateCloudInitNetworkConfig({
      ipv4Address,
      ipv6List,
      nicMacs: vmNicMacs || undefined
    })
  }

  return config
}

/**
 * 在实例中执行命令
 */
export async function exec(
  client: IncusClient,
  instanceName: string,
  command: string | string[],
  options: Record<string, unknown> = {},
  timeout: number = 120000
): Promise<unknown> {
  return client.request('POST', `/1.0/instances/${instanceName}/exec`, {
    command: Array.isArray(command) ? command : ['/bin/sh', '-c', command],
    'wait-for-websocket': false,
    interactive: false,
    ...options
  }, timeout)
}

export interface IncusExecOutput {
  stdout: string
  stderr: string
  metadata: unknown
}

function extractOutputFilePath(metadata: unknown, fd: '1' | '2'): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const output = (metadata as { output?: unknown }).output
  if (!output || typeof output !== 'object') return null
  const path = (output as Record<string, unknown>)[fd]
  return typeof path === 'string' && path ? path : null
}

export async function execWithOutput(
  client: IncusClient,
  instanceName: string,
  command: string | string[],
  options: Record<string, unknown> = {},
  timeout: number = 120000
): Promise<IncusExecOutput> {
  const metadata = await exec(client, instanceName, command, {
    'record-output': true,
    ...options
  }, timeout)

  const stdoutPath = extractOutputFilePath(metadata, '1')
  const stderrPath = extractOutputFilePath(metadata, '2')

  const [stdout, stderr] = await Promise.all([
    stdoutPath ? client.readFile(stdoutPath).then(result => result.content).catch(() => '') : Promise.resolve(''),
    stderrPath ? client.readFile(stderrPath).then(result => result.content).catch(() => '') : Promise.resolve('')
  ])

  return { stdout, stderr, metadata }
}

/**
 * 获取控制台 WebSocket URL
 */
export function getConsoleWebSocketUrl(client: IncusClient, instanceName: string): string {
  const wsUrl = client.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://')
  return `${wsUrl}/1.0/instances/${instanceName}/console?wait-for-websocket=true`
}

/**
 * 确保网桥已启用 IPv6 NAT 能力（防御性校验）
 * 
 * 仅对需要桥级 IPv6 NAT 的网络模式生效（ipv6_nat, nat_ipv6_nat）。
 * 如果网桥的 ipv6.address 为 none 或未启用 ipv6.nat，则自动修正。
 * 
 * 背景：install.sh 初始化网桥时可能因安装选项不当导致 IPv6 被关闭，
 * 此函数作为运行时保底，确保 NAT 类 IPv6 实例不会因网桥配置缺失而断网。
 */
export async function ensureBridgeIpv6(
  client: IncusClient,
  networkMode: string,
  bridgeName: string = 'incusbr0'
): Promise<void> {
  // 仅对需要桥级 IPv6 NAT 的模式执行校验
  if (!['ipv6_nat', 'nat_ipv6_nat'].includes(networkMode)) {
    return
  }

  try {
    // 获取当前网桥配置
    const bridge = await client.request<{ config?: Record<string, string> }>('GET', `/1.0/networks/${bridgeName}`)
    const config = bridge?.config || {}

    const needsFix = config['ipv6.address'] === 'none' || !config['ipv6.nat'] || config['ipv6.nat'] !== 'true'

    if (needsFix) {
      // 使用 PATCH 增量更新，不影响其他已有配置
      await client.request('PATCH', `/1.0/networks/${bridgeName}`, {
        config: {
          'ipv6.address': 'auto',
          'ipv6.nat': 'true',
          'ipv6.dhcp': 'true'
        }
      })
      console.log(`[ensureBridgeIpv6] 已自动为网桥 ${bridgeName} 启用 IPv6 NAT（网络模式: ${networkMode}）`)
    }
  } catch (err) {
    // 校验失败不阻断实例创建，仅记录警告
    console.warn(`[ensureBridgeIpv6] 网桥 IPv6 校验失败（${bridgeName}）:`, err)
  }
}

