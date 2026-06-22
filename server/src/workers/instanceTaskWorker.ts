/**
 * 实例操作任务队列调度器
 * 确保同一台宿主机同一时间只有一个实例操作任务在执行
 * 
 * 高可用优化:
 * - 批量查询所有待处理任务，减少数据库查询次数
 * - 轻量任务（start/stop/restart）每宿主机并行执行
 * - 性能监控日志
 * - 使用统一连接池管理
 */

import { prisma } from '../db/prisma.js'
import { InstanceTaskType } from '@prisma/client'
import { getIncusClient, getInstance, updateInstance, deleteInstance, createInstance } from '../lib/incus/index.js'
import {
  startInstance,
  stopInstance,
  restartInstance,
  rebuildInstance,
  getInstanceState
} from '../lib/incus/incus-instances.js'
import { listSnapshots, deleteSnapshot as deleteIncusSnapshot } from '../lib/incus/incus-snapshots.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import * as db from '../db/index.js'
import { updateInstanceTaskProgress } from '../db/instance-tasks.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { generateIncusConfig, generateRandomPassword } from '../lib/incus-config-generator.js'
import { encryptSensitiveData, decryptSensitiveData } from '../lib/security.js'
import { generateVmNicMacs } from '../lib/vm-network-identifiers.js'
import { customAlphabet } from 'nanoid'
import { generateRandomIPv4, generateRandomIPv6 } from '../lib/ip-calculator.js'
import pLimit from 'p-limit'
import { updateClientResponseTime, recordClientError } from '../lib/incus/incus-pool.js'
import { getCommandsByIds, mergeCommandContents, getImageDistroFromAlias } from '../db/custom-init-commands.js'
import { collectTrafficForRunningInstance } from '../services/instance-traffic-collector.js'
import {
  HOST_TASK_CLAIM_LOCK_NAMESPACE,
  IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE,
  INSTANCE_OPERATION_LOCK_NAMESPACE,
  advisoryTransactionLockString,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

import { resetInstanceCloudInitState } from '../lib/cloud-init-status.js'
import { resolveIncusSwapValue } from '../lib/instance-swap.js'
import { selectBindableIpv4ListenAddress } from '../lib/network-address.js'
import { getSystemImageAvailabilityForHost } from '../db/images.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'

// 任务超时时间：轻量任务保持短超时，重建/克隆/改节点等重任务允许更长执行窗口
const LIGHT_TASK_TIMEOUT = 5 * 60 * 1000
const HEAVY_TASK_TIMEOUT = 30 * 60 * 1000

// Worker 轮询间隔 (3 秒)
const POLL_INTERVAL = 3000

// 超时检查间隔 (1 分钟)
const TIMEOUT_CHECK_INTERVAL = 60000

// 每宿主机轻量任务并发数
const LIGHT_TASK_CONCURRENCY = 5

// 轻量任务类型（可并行执行）
const LIGHT_TASK_NAMES = new Set(['start', 'stop', 'restart'])

// 重量任务类型（需串行执行）
const HEAVY_TASK_NAMES = new Set(['rebuild', 'clone', 'recreate', 'change_host'])

// 重量任务类型数组（用于 Prisma 查询）
const HEAVY_TASK_TYPES: InstanceTaskType[] = ['rebuild', 'clone', 'recreate', 'change_host' as InstanceTaskType]
const ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS = 10_000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
const runningTaskIds = new Set<number>()
const dbBackoff = createWorkerDbBackoff('InstanceTaskWorker')

function isAlpineImageAlias(imageAlias?: string | null): boolean {
  return typeof imageAlias === 'string' && imageAlias.toLowerCase().includes('alpine')
}

/**
 * 从实例状态中提取 IPv4 地址
 */
function extractIPv4(state: { network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }> }): string | null {
  if (!state.network) return null
  for (const [iface, info] of Object.entries(state.network)) {
    if (iface === 'lo') continue
    const addrs = info.addresses || []
    for (const addr of addrs) {
      if (addr.family === 'inet' && addr.scope === 'global') {
        return addr.address
      }
    }
  }
  return null
}

/**
 * 从实例状态中提取 IPv6 地址
 * 排除 ULA (fd00::/8, fc00::/7) 和 link-local (fe80::/10) 地址
 * 仅返回真正的全球可路由 IPv6 地址
 */
function extractIPv6(state: { network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }> }): string | null {
  if (!state.network) return null
  for (const [iface, info] of Object.entries(state.network)) {
    if (iface === 'lo') continue
    const addrs = info.addresses || []
    for (const addr of addrs) {
      if (addr.family === 'inet6' && addr.scope === 'global') {
        const ip = addr.address.toLowerCase()
        // 排除 ULA (fc00::/7 = fc/fd) 和 link-local (fe80::/10)
        if (ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80:')) {
          continue
        }
        return addr.address
      }
    }
  }
  return null
}

async function cleanupRecreatedInstanceRecords(instanceId: number, hostId: number): Promise<{ deletedPortMappingsCount: number }> {
  return prisma.$transaction(async (tx) => {
    const deletedPortMappings = await tx.portMapping.deleteMany({ where: { instanceId } })

    if (deletedPortMappings.count > 0) {
      const updatedHost = await tx.host.updateMany({
        where: {
          id: hostId,
          natPortsUsedCount: { gte: deletedPortMappings.count }
        },
        data: {
          natPortsUsedCount: { decrement: deletedPortMappings.count }
        }
      })
      if (updatedHost.count === 0) {
        await tx.host.update({
          where: { id: hostId },
          data: { natPortsUsedCount: 0 }
        })
      }
    }

    await tx.snapshot.deleteMany({ where: { instanceId } })
    await tx.backup.deleteMany({ where: { instanceId } })
    await tx.proxySite.deleteMany({ where: { instanceId } })
    await tx.backupPolicy.deleteMany({ where: { instanceId } })
    await tx.snapshotPolicy.deleteMany({ where: { instanceId } })
    await tx.trafficSnapshot.deleteMany({ where: { instanceId } })

    return { deletedPortMappingsCount: deletedPortMappings.count }
  })
}

/**
 * 服务启动时清理僵尸任务
 */
export async function cleanupStaleTasks(): Promise<void> {
  const lightTimeoutThreshold = new Date(Date.now() - LIGHT_TASK_TIMEOUT)
  const heavyTimeoutThreshold = new Date(Date.now() - HEAVY_TASK_TIMEOUT)

  const result = await prisma.instanceTask.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [
        {
          taskType: { in: HEAVY_TASK_TYPES },
          startedAt: { lt: heavyTimeoutThreshold }
        },
        {
          taskType: { notIn: HEAVY_TASK_TYPES },
          startedAt: { lt: lightTimeoutThreshold }
        },
        {
          startedAt: null
        }
      ]
    },
    data: {
      status: 'FAILED',
      error: '系统启动清理超时任务',
      finishedAt: new Date()
    }
  })
  if (result.count > 0) {
    console.log(`[InstanceTaskWorker] 清理了 ${result.count} 个僵尸任务`)
  }
}

/**
 * 运行时检查并清理超时的任务
 */
async function cleanupTimeoutTasks(): Promise<void> {
  if (dbBackoff.shouldSkip()) return
  const lightTimeoutThreshold = new Date(Date.now() - LIGHT_TASK_TIMEOUT)
  const heavyTimeoutThreshold = new Date(Date.now() - HEAVY_TASK_TIMEOUT)

  const timedOutTasks = await prisma.instanceTask.findMany({
    where: {
      status: 'PROCESSING',
      OR: [
        {
          taskType: { in: HEAVY_TASK_TYPES },
          startedAt: { lt: heavyTimeoutThreshold }
        },
        {
          taskType: { notIn: HEAVY_TASK_TYPES },
          startedAt: { lt: lightTimeoutThreshold }
        }
      ]
    },
    select: { id: true }
  })
  const timedOutTaskIds = timedOutTasks
    .map(task => task.id)
    .filter(taskId => !runningTaskIds.has(taskId))

  if (timedOutTaskIds.length === 0) {
    return
  }

  const result = await prisma.instanceTask.updateMany({
    where: {
      id: { in: timedOutTaskIds },
      status: 'PROCESSING'
    },
    data: {
      status: 'FAILED',
      error: '任务执行超时',
      finishedAt: new Date()
    }
  })

  if (result.count > 0) {
    console.log(`[InstanceTaskWorker] 清理了 ${result.count} 个超时任务`)
  }
}

/**
 * 检查队列并执行任务
 * 高可用优化：批量查询 + 轻量任务并行
 */
async function processQueue(): Promise<void> {
  if (dbBackoff.shouldSkip()) return
  const startTime = Date.now()

  try {
    // 批量获取所有待处理任务（一次查询）
    const pendingTasks = await prisma.instanceTask.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, hostId: true, taskType: true }
    })

    if (pendingTasks.length === 0) return

    // 按宿主机分组
    const tasksByHost = new Map<number, typeof pendingTasks>()
    for (const task of pendingTasks) {
      const hostTasks = tasksByHost.get(task.hostId) || []
      hostTasks.push(task)
      tasksByHost.set(task.hostId, hostTasks)
    }

    // 并行处理每个宿主机的任务
    const hostPromises = Array.from(tasksByHost.entries()).map(
      async ([hostId, tasks]) => processHostTasks(hostId, tasks)
    )

    await Promise.allSettled(hostPromises)

    const duration = Date.now() - startTime
    if (duration > 100) { // 只记录耗时超过 100ms 的轮询
      console.log(`[InstanceTaskWorker] Queue processed in ${duration}ms, pending: ${pendingTasks.length}`)
    }
  } catch (err) {
    console.error('[InstanceTaskWorker] Queue processing error:', err)
    dbBackoff.arm(err)
  }
}

/**
 * 处理单个宿主机的任务队列
 * 轻量任务可并行，重量任务串行
 */
async function processHostTasks(
  hostId: number,
  tasks: Array<{ id: number; hostId: number; taskType: string }>
): Promise<void> {
  // 分离轻量任务和重量任务
  const lightTasks = tasks.filter(t => LIGHT_TASK_NAMES.has(t.taskType))
  const heavyTasks = tasks.filter(t => HEAVY_TASK_NAMES.has(t.taskType))

  // 检查是否有正在执行的重量任务
  const runningHeavyTask = await prisma.instanceTask.findFirst({
    where: {
      hostId,
      status: 'PROCESSING',
      taskType: { in: HEAVY_TASK_TYPES }
    }
  })

  if (runningHeavyTask) {
    // 有重量任务在执行，跳过该宿主机
    return
  }

  // 优先处理轻量任务（并行）
  if (lightTasks.length > 0) {
    const limit = pLimit(LIGHT_TASK_CONCURRENCY)
    const claimedLightTasks: number[] = []

    // 尝试获取多个轻量任务
    for (const task of lightTasks.slice(0, LIGHT_TASK_CONCURRENCY)) {
      const claimed = await claimLightTask(hostId, task.id)
      if (claimed) {
        claimedLightTasks.push(claimed.id)
      }
    }

    // 并行执行轻量任务
    if (claimedLightTasks.length > 0) {
      await Promise.allSettled(
        claimedLightTasks.map(taskId =>
          limit(() => executeTask(taskId).catch(err => {
            console.error(`[InstanceTaskWorker] Light task ${taskId} error:`, err)
          }))
        )
      )
    }
  }

  // 处理重量任务（串行，需要独占锁）
  // 注意：如果没有待处理的轻量任务，或者轻量任务已全部被处理，则处理重量任务
  if (heavyTasks.length > 0) {
    // 检查是否有正在执行的任何任务
    const runningAnyTask = await prisma.instanceTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })

    if (!runningAnyTask) {
      // 没有任务在执行，可以处理重量任务
      const claimedTask = await claimNextTask(hostId)
      if (claimedTask) {
        // 重量任务异步执行
        executeTask(claimedTask.id).catch(err => {
          console.error(`[InstanceTaskWorker] Heavy task ${claimedTask.id} error:`, err)
        })
      }
    }
  }
}

/**
 * 获取轻量任务（简化版锁检查）
 */
async function claimLightTask(hostId: number, taskId: number) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
    if (!locked) return null

    // 检查是否有正在执行的重量任务
    const runningHeavyTask = await tx.instanceTask.findFirst({
      where: {
        hostId,
        status: 'PROCESSING',
        taskType: { in: HEAVY_TASK_TYPES }
      }
    })
    if (runningHeavyTask) return null

    // 检查是否有正在执行的恢复任务（共享锁）
    const runningRestoreTask = await tx.restoreTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningRestoreTask) return null

    // 检查是否有正在执行的上传任务（共享锁）
    const runningUploadTask = await tx.backupUploadTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningUploadTask) return null

    // 检查任务是否仍然是 PENDING
    const task = await tx.instanceTask.findUnique({
      where: { id: taskId }
    })
    if (!task || task.status !== 'PENDING') return null

    const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)
    if (!instanceOperationLocked) return null

    const instance = await tx.instance.findUnique({
      where: { id: task.instanceId },
      select: { status: true }
    })
    if (!instance || instance.status === 'deleted') return null

    // 标记为 PROCESSING
    return await tx.instanceTask.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', startedAt: new Date() }
    })
  })
}

/**
 * 原子操作：获取并锁定下一个任务
 */
async function claimNextTask(hostId: number) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
    if (!locked) return null

    // 检查是否有正在执行的实例任务
    const runningTask = await tx.instanceTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningTask) return null

    // 检查是否有正在执行的恢复任务（共享锁）
    const runningRestoreTask = await tx.restoreTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningRestoreTask) return null

    // 检查是否有正在执行的上传任务（共享锁）
    const runningUploadTask = await tx.backupUploadTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningUploadTask) return null

    // 获取最早的 PENDING 任务
    const taskToRun = await tx.instanceTask.findFirst({
      where: { hostId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' }
    })
    if (!taskToRun) return null

    const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, taskToRun.instanceId)
    if (!instanceOperationLocked) return null

    const instance = await tx.instance.findUnique({
      where: { id: taskToRun.instanceId },
      select: { status: true }
    })
    if (!instance || instance.status === 'deleted') return null

    // 原子标记为 PROCESSING
    const claimedTask = await tx.instanceTask.update({
      where: { id: taskToRun.id },
      data: { status: 'PROCESSING', startedAt: new Date() }
    })

    return claimedTask
  })
}

/**
 * 执行单个任务（带性能监控）
 */
async function executeTask(taskId: number): Promise<void> {
  const taskStartTime = Date.now()
  runningTaskIds.add(taskId)
  let task: Awaited<ReturnType<typeof prisma.instanceTask.findUnique>> = null

  try {
    task = await prisma.instanceTask.findUnique({
      where: { id: taskId }
    })

    if (!task) {
      console.error(`[InstanceTaskWorker] Task ${taskId} not found`)
      return
    }

    console.log(`[InstanceTaskWorker] 开始执行任务 ${taskId} (${task.taskType})`)

    const instance = await db.getInstanceById(task.instanceId)
    if (!instance) throw new Error('实例不存在')
    if (instance.status === 'deleted') {
      throw new Error('实例已删除，任务取消')
    }

    const earliestActiveTask = await prisma.instanceTask.findFirst({
      where: {
        instanceId: task.instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })
    if (earliestActiveTask && earliestActiveTask.id !== task.id) {
      throw new Error(`实例已有更早的任务正在执行: ${earliestActiveTask.taskType}`)
    }

    const host = await db.getHostById(task.hostId)
    if (!host) throw new Error('宿主机不存在')

    const clientStartTime = Date.now()
    const client = await getIncusClient(host)
    const clientDuration = Date.now() - clientStartTime

    // 记录连接池响应时间
    updateClientResponseTime(host.id, clientDuration)

    switch (task.taskType) {
      case 'start':
        await executeStartTask(task, instance, host, client)
        break
      case 'stop':
        await executeStopTask(task, instance, host, client)
        break
      case 'restart':
        await executeRestartTask(task, instance, host, client)
        break
      case 'rebuild':
        await executeRebuildTask(task, instance, host, client)
        break
      case 'clone':
        await executeCloneTask(task, instance, host, client)
        break
      case 'recreate':
        await executeRecreateTask(task, instance, host, client)
        break
      case 'change_host':
        await executeChangeHostTask(task, instance, host, client)
        break
      default:
        throw new Error(`未知任务类型: ${task.taskType}`)
    }

    // 任务完成
    const completeResult = await prisma.instanceTask.updateMany({
      where: { id: taskId, status: 'PROCESSING' },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date()
      }
    })
    if (completeResult.count === 0) {
      console.warn(`[InstanceTaskWorker] 任务 ${taskId} 已不处于 PROCESSING，跳过完成状态覆盖`)
    }

    const taskDuration = Date.now() - taskStartTime
    console.log(`[InstanceTaskWorker] 任务 ${taskId} (${task.taskType}) 完成，耗时 ${taskDuration}ms`)

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[InstanceTaskWorker] 任务 ${taskId} 失败:`, errorMessage)

    const failResult = await prisma.instanceTask.updateMany({
      where: { id: taskId, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        error: errorMessage,
        finishedAt: new Date()
      }
    })
    if (failResult.count === 0) {
      console.warn(`[InstanceTaskWorker] 任务 ${taskId} 已不处于 PROCESSING，跳过失败状态覆盖`)
    }

    if (!task) {
      return
    }

    // 记录连接池错误
    recordClientError(task.hostId)

    const taskDuration = Date.now() - taskStartTime
    console.error(`[InstanceTaskWorker] 任务 ${taskId} (${task.taskType}) 失败，耗时 ${taskDuration}ms: ${errorMessage}`)

    // 发送失败通知并记录日志
    try {
      const instance = await db.getInstanceById(task.instanceId)
      const host = await db.getHostById(task.hostId)

      // 记录失败日志
      await createLog(
        task.userId,
        'instance',
        `instance.${task.taskType}`,
        `Failed to ${task.taskType} instance "${instance?.name || task.instanceId}": ${errorMessage}`,
        'failed',
        { instanceId: task.instanceId }
      )

      await sendNotification(task.userId, 'instance_task_failed', {
        instanceName: instance?.name || `实例 #${task.instanceId}`,
        hostName: host?.name || '未知',
        taskType: task.taskType,
        error: errorMessage
      })
    } catch (notifyErr) {
      console.error('[InstanceTaskWorker] 发送失败通知/记录日志失败:', notifyErr)
    }
  } finally {
    runningTaskIds.delete(taskId)
  }
}

/**
 * 判断错误是否为 "实例已经是目标状态"
 * Incus 返回类似 "The container is already running" 或 "The instance is already stopped"
 * 也可能返回 "container is not running" 或 "instance is not running" 等变体
 */
function isAlreadyInStateError(error: Error, targetState: 'running' | 'stopped'): boolean {
  const msg = error.message.toLowerCase()
  if (targetState === 'running') {
    // 匹配: "already running", "already started", "is running"
    return msg.includes('already running') || msg.includes('already started') ||
      (msg.includes('is running') && !msg.includes('not running'))
  }
  if (targetState === 'stopped') {
    // 匹配: "already stopped", "not running", "is not running", "isn't running"
    return msg.includes('already stopped') || msg.includes('not running') ||
      msg.includes('is stopped') || msg.includes("isn't running")
  }
  return false
}

/**
 * 执行启动任务
 */
async function executeStartTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; network_mode: string },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'starting')

  try {
    await startInstance(client, instance.incus_id)
  } catch (err) {
    if (err instanceof Error && err.message.includes('file exists')) {
      const startDevices = (await getInstance(client, instance.incus_id) as any).devices
      if (startDevices?.eth1) {
        console.warn(`[Start] IPv6 路由残留，尝试暂移 eth1 后启动...`)
        const savedEth1 = { ...startDevices.eth1 }
        const devicesWithoutEth1 = { ...startDevices }
        delete devicesWithoutEth1.eth1
        await updateInstance(client, instance.incus_id, { devices: devicesWithoutEth1 })
        await startInstance(client, instance.incus_id)
        // 实例启动后恢复 eth1（Incus 会热插入并添加新的路由）
        await new Promise(r => setTimeout(r, 3000))
        await updateInstance(client, instance.incus_id, { devices: { ...devicesWithoutEth1, eth1: savedEth1 } })
        console.log(`[Start] eth1 已恢复，IPv6 路由重新建立`)
      }
    }
    if (err instanceof Error && isAlreadyInStateError(err, 'running')) {
      console.log(`[Start] 实例 ${instance.incus_id} 已经是运行状态，自动修正数据库`)
      // 获取实际状态并更新数据库
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      const ipv4 = extractIPv4(state)
      const ipv6 = extractIPv6(state)
      await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })
      const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
      await reconcileTrafficStateForInstanceIds([task.instanceId])

      // 发送通知（状态已同步）
      await sendNotification(task.userId, 'instance_started', {
        instanceName: instance.name,
        hostName: host.name,
        ipv4: ipv4 || undefined,
        ipv6: ipv6 || undefined
      })

      await createLog(task.userId, 'instance', 'instance.start', `Instance "${instance.name}" already running, synced status [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
      return // 任务成功完成
    }
    throw err // 其他错误继续抛出
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // 根据实例类型动态调整等待窗口：VM 启动慢，需要更长的等待时间
  const incusInst = await getInstance(client, instance.incus_id) as { type?: string }
  const isVM = incusInst.type === 'virtual-machine'
  const maxAttempts = isVM ? 60 : 30    // VM: 60×3s=180s, 容器: 30×2s=60s
  const pollInterval = isVM ? 3000 : 2000
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      ipv4 = extractIPv4(state)
      ipv6 = extractIPv6(state)

      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Start] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Start] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Start] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  await sendNotification(task.userId, 'instance_started', {
    instanceName: instance.name,
    hostName: host.name,
    ipv4: ipv4 || undefined,
    ipv6: ipv6 || undefined
  })

  await createLog(task.userId, 'instance', 'instance.start', `Started instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行停止任务
 */
async function executeStopTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; image?: string | null },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'stopping')

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Stop] 实例 ${task.instanceId} 关机前即时采集流量失败: ${collectResult.error}`)
  }

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is stopping')
  if (closedSessions > 0) {
    console.log(`[Stop] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  try {
    const allowCancelBusyUpdate = isAlpineImageAlias(instance.image)
    await stopInstance(client, instance.incus_id, true, {
      allowCancelBusyUpdate,
      busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
    })
  } catch (err) {
    // 如果 Incus 返回 "已经是停止状态"，自动修正数据库状态
    if (err instanceof Error && isAlreadyInStateError(err, 'stopped')) {
      console.log(`[Stop] 实例 ${instance.incus_id} 已经是停止状态，自动修正数据库`)
      await db.updateInstanceStatus(task.instanceId, 'stopped')

      // 发送通知（状态已同步）
      await sendNotification(task.userId, 'instance_stopped', {
        instanceName: instance.name,
        hostName: host.name
      })

      await createLog(task.userId, 'instance', 'instance.stop', `Instance "${instance.name}" already stopped, synced status [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
      return // 任务成功完成
    }
    throw err // 其他错误继续抛出
  }
  await db.updateInstanceStatus(task.instanceId, 'stopped')

  await sendNotification(task.userId, 'instance_stopped', {
    instanceName: instance.name,
    hostName: host.name
  })

  await createLog(task.userId, 'instance', 'instance.stop', `Stopped instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重启任务
 */
async function executeRestartTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; network_mode: string },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'restarting')

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Restart] 实例 ${task.instanceId} 重启前即时采集流量失败: ${collectResult.error}`)
  }

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is restarting')
  if (closedSessions > 0) {
    console.log(`[Restart] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  try {
    await restartInstance(client, instance.incus_id, true)
  } catch (err) {
    // 重启失败时，检查当前状态
    // 如果实例是停止状态，则执行启动；如果是运行状态，继续重启流程
    if (err instanceof Error) {
      // 如果实例是停止状态无法重启，尝试启动它
      if (isAlreadyInStateError(err, 'stopped')) {
        console.log(`[Restart] 实例 ${instance.incus_id} 处于停止状态，尝试启动`)
        try {
          await startInstance(client, instance.incus_id)
          // 继续等待网络初始化的流程
        } catch (startErr) {
          if (startErr instanceof Error && startErr.message.includes('file exists')) {
            const restartDevices = (await getInstance(client, instance.incus_id) as any).devices
            if (restartDevices?.eth1) {
              console.warn(`[Restart] IPv6 路由残留，尝试暂移 eth1 后启动...`)
              const savedEth1 = { ...restartDevices.eth1 }
              const devicesWithoutEth1 = { ...restartDevices }
              delete devicesWithoutEth1.eth1
              await updateInstance(client, instance.incus_id, { devices: devicesWithoutEth1 })
              await startInstance(client, instance.incus_id)
              await new Promise(r => setTimeout(r, 3000))
              await updateInstance(client, instance.incus_id, { devices: { ...devicesWithoutEth1, eth1: savedEth1 } })
              console.log(`[Restart] eth1 已恢复，IPv6 路由重新建立`)
            }
          }
          // 如果启动时发现已经是运行状态（极端边界情况），也视为成功
          if (startErr instanceof Error && isAlreadyInStateError(startErr, 'running')) {
            console.log(`[Restart] 实例 ${instance.incus_id} 已经是运行状态`)
            // 继续等待网络初始化的流程
          } else {
            throw startErr
          }
        }
      } else {
        throw err // 其他错误继续抛出
      }
    } else {
      throw err
    }
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // 根据实例类型动态调整等待窗口
  const incusInstRestart = await getInstance(client, instance.incus_id) as { type?: string }
  const isVMRestart = incusInstRestart.type === 'virtual-machine'
  const maxAttemptsRestart = isVMRestart ? 60 : 30
  const pollIntervalRestart = isVMRestart ? 3000 : 2000
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)

  for (let attempt = 0; attempt < maxAttemptsRestart; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalRestart))

    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      ipv4 = extractIPv4(state)
      ipv6 = extractIPv6(state)

      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Restart] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Restart] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Restart] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })

  await sendNotification(task.userId, 'instance_restarted', {
    instanceName: instance.name,
    hostName: host.name,
    ipv4: ipv4 || undefined,
    ipv6: ipv6 || undefined
  })

  await createLog(task.userId, 'instance', 'instance.restart', `Restarted instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重装任务
 */
async function executeRebuildTask(
  task: { id: number; userId: number; instanceId: number; imageAlias: string | null; sshKeyId: number | null; customInitCommandIds?: string | null },
  instance: { incus_id: string; name: string; user_id: number; image: string; network_mode: string; ipv4?: string | null; ipv6?: string | null; host_id: number; swap_enabled?: boolean; swap_size?: number | null },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  const imageAlias = task.imageAlias
  if (!imageAlias) throw new Error('未指定重装镜像')
  const allowCancelBusyUpdate = isAlpineImageAlias(instance.image) || isAlpineImageAlias(imageAlias)

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is being rebuilt')
  if (closedSessions > 0) {
    console.log(`[Rebuild] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Rebuild] 实例 ${task.instanceId} 重装前即时采集流量失败: ${collectResult.error}`)
  }

  // 确保实例已停止
  await updateInstanceTaskProgress(task.id, 'stopping')
  try {
    const incusState = await getInstanceState(client, instance.incus_id) as { status?: string }
    if (incusState.status === 'Running') {
      await stopInstance(client, instance.incus_id, true, {
        allowCancelBusyUpdate,
        busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
      })
    }
  } catch (_err) {
    // 继续执行
  }

  // 重装后 cloud-init 会重新运行，必须清空旧的检测状态与手动完成标记。
  await resetInstanceCloudInitState(task.instanceId)

  // 删除所有快照
  await updateInstanceTaskProgress(task.id, 'deleting_snapshots')
  try {
    const snapshots = await listSnapshots(client, instance.incus_id) as unknown[]
    if (snapshots && snapshots.length > 0) {
      for (const snapshot of snapshots) {
        const snapshotName = typeof snapshot === 'string'
          ? snapshot.split('/').pop()
          : (snapshot as { name?: string }).name
        if (snapshotName) {
          await deleteIncusSnapshot(client, instance.incus_id, snapshotName)
        }
      }
    }
    // 清理数据库中的快照记录
    await prisma.snapshot.deleteMany({ where: { instanceId: task.instanceId } })
  } catch (_err) {
    console.warn('[InstanceTaskWorker] 删除快照失败，继续执行')
  }

  // 执行重装
  await updateInstanceTaskProgress(task.id, 'rebuilding')

  // 获取 SSH 密钥：优先使用任务指定的 sshKeyId，否则取用户第一个密钥
  let sshKey: string | undefined
  if (task.sshKeyId) {
    const keyRecord = await db.getSSHKeyById(task.sshKeyId)
    if (keyRecord && keyRecord.user_id === instance.user_id) {
      sshKey = keyRecord.public_key
    }
  }
  if (!sshKey) {
    // 回退：取用户第一个密钥
    const userSshKeys = await db.getSSHKeysByUserId(instance.user_id)
    sshKey = userSshKeys && userSshKeys.length > 0 ? userSshKeys[0].public_key : undefined
  }

  // SSH key is optional; password login still remains available when no key is present.
  if (!sshKey) {
    console.warn(`[Rebuild] Instance ${task.instanceId} has no SSH key; continuing without injecting authorized_keys`)
  }

  // 处理自定义初始化命令
  let extraShellCommands: string | undefined
  if (task.customInitCommandIds) {
    try {
      const commandIds = JSON.parse(task.customInitCommandIds) as number[]
      if (commandIds.length > 0) {
        const commands = await getCommandsByIds(commandIds)
        // 二次验证：过滤掉不属于实例用户或已禁用的命令（防止任务排队期间命令被删除/禁用）
        const validCmds = commands.filter(cmd =>
          cmd.userId === instance.user_id && cmd.enabled
        )
        // 筛选适配当前发行版的命令
        const imageDistro = getImageDistroFromAlias(imageAlias)
        const compatibleCmds = validCmds.filter(cmd => {
          return cmd.distros.includes('all') || cmd.distros.includes(imageDistro)
        })
        if (compatibleCmds.length > 0) {
          extraShellCommands = mergeCommandContents(compatibleCmds)
          console.log(`[Rebuild] 应用 ${compatibleCmds.length} 条自定义初始化命令`)
        }
      }
    } catch (err) {
      console.warn('[Rebuild] 解析自定义初始化命令失败:', err)
    }
  }

  const newPassword = generateRandomPassword(16)

  // 获取实例类型 (container 或 virtual-machine)
  const incusInstance = await getInstance(client, instance.incus_id)
  const instanceType = incusInstance.type // 'container' | 'virtual-machine'

  // 生成 cloud-init 配置（用于注入 SSH 密钥和密码）
  // 容器类型也传入 network 参数以正确配置 eth0/eth1 静态 IP
  let { configPayload } = generateIncusConfig({
    instanceName: instance.name,
    imageAlias,
    rootPassword: newPassword,
    sshKey,
    networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    type: instanceType,
    network: instanceType !== 'virtual-machine' && instance.ipv4 ? {
      ipAddress: `${instance.ipv4}/22`,
      gateway: '10.10.0.1',
      dns: ['10.10.0.1'],
      ipv6Address: instance.ipv6 ? `${instance.ipv6}/128` : undefined,
      ipv6Gateway: instance.ipv6 ? 'fe80::1' : undefined
    } : undefined,
    extraShellCommands
  })

  // VM 需要在 cloud-init 的 network-config 中配置网络
  // 使用实例现有的 IP 地址重新生成 network-config
  if (instanceType === 'virtual-machine') {
    const { generateVmConfig } = await import('../lib/incus-config-vm.js')
    // 获取 IPv6 网关（从宿主机配置）
    const hostInfo = await db.getHostById(instance.host_id)
    const vmResult = generateVmConfig({
      instanceName: instance.name,
      instanceIdSeed: instance.incus_id,
      imageAlias,
      rootPassword: newPassword,
      sshKey,
      network: instance.ipv4 ? {
        ipAddress: `${instance.ipv4}/22`,
        gateway: '10.10.0.1',  // NAT 网关 (与 incusbr0 一致)
        dns: ['10.10.0.1'],
        ipv6Address: instance.ipv6 ? `${instance.ipv6}` : undefined,
        ipv6Gateway: instance.ipv6 ? (hostInfo?.ipv6_gateway || undefined) : undefined
      } : undefined,
      extraShellCommands
    })
    configPayload = vmResult.configPayload
    console.log(`[Rebuild] VM network-config 已更新: IPv4=${instance.ipv4 || 'dhcp'}, IPv6=${instance.ipv6 || 'none'}`)
  } else {
    console.log(`[Rebuild] Container network-config 已更新: IPv4=${instance.ipv4 || 'dhcp'}, IPv6=${instance.ipv6 || 'none'}`)
  }

  // 关键修复：如果在首次创建时网络模式使用了双栈/纯IPv6新架构（需要 eth1），
  // 在重装时必须同样注入标准的双网卡 user.network-config 配置。
  // 注意：此处强制覆盖仅对容器 (container) 生效，因为 KVM (virtual-machine) 的配置已经在前面精确包含了 match MAC 和正确拓扑，强制覆写会导致丢网络！
  if (instanceType === 'container' && instance.ipv4) {
    const { hasIpv6Support, generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
    if (hasIpv6Support(instance.network_mode as any) && instance.ipv6) {
      console.log(`[Rebuild] (Container) 检测到 IPv6 Routed 网络模式，强制覆盖应用标准双栈 user.network-config...`)
      configPayload['user.network-config'] = generateCloudInitNetworkConfig({
        ipv4Address: instance.ipv4,
        ipv6List: [instance.ipv6]
      })
    }
  }

  // 关键修复：在 rebuild 之前先更新实例的 cloud-init 配置
  // Incus rebuild API 不会覆盖现有 config，只会使用新镜像替换 rootfs
  // 所以必须先更新 config，让 rebuild 后的新系统能读取到正确的 cloud-init 配置
  // VM 关闭 UEFI 安全启动（允许用户 DD 系统等操作）
  const rebuildConfig: Record<string, string> = { ...configPayload }

  // 关键修复：清除旧的云初始化缓存键和残留系统属性（防止 Alpine <-> Debian 等跨发行版重装时 vendor-data 不兼容导致 cloud-init 崩溃）
  try {
    const { getImageAlias, getImage } = await import('../lib/incus/incus-images.js')
    const aliasInfo = await getImageAlias(client, imageAlias)
    const newImage = await getImage(client, aliasInfo.target)

    // 把当前实例里所有旧的 'image.*'、'user.vendor-data'、'volatile.cloud-init.*'清空
    const currentConfig = (incusInstance as any).config || {}
    for (const key of Object.keys(currentConfig)) {
      if (
        key.startsWith('image.') ||
        key === 'user.vendor-data' ||
        key.startsWith('volatile.cloud-init.')
      ) {
        rebuildConfig[key] = '' // 空字符串代表由于我们使用 PATCH(updateInstance) 告知 Incus 删除这些键
      }
    }

    // 重新注入新镜像自带的属性
    if (newImage.properties) {
      for (const [key, value] of Object.entries(newImage.properties)) {
        if (typeof value === 'string') {
          rebuildConfig[`image.${key}`] = value
        }
      }
    }
  } catch (err) {
    console.warn('[Rebuild] 同步新镜像属性失败，将仅通过清理确保兼容性:', err)
  }

  // 必须重新涵盖刚才我们自己生成的合法 cloud-init 配置，防意外把自己的核心产出冲掉
  for (const [k, v] of Object.entries(configPayload)) {
    rebuildConfig[k] = v as string
  }

  let rebuildDevices: Record<string, Record<string, string>> | undefined
  if (instanceType === 'virtual-machine') {
    rebuildConfig['security.secureboot'] = 'false'
    const vmNicMacs = generateVmNicMacs(instance.incus_id)
    const currentDevices = ((incusInstance as unknown as { devices?: Record<string, Record<string, string>> }).devices) || {}
    rebuildDevices = { ...currentDevices }

    if (rebuildDevices.eth0) {
      rebuildDevices.eth0 = {
        ...rebuildDevices.eth0,
        hwaddr: rebuildDevices.eth0.hwaddr || vmNicMacs.eth0
      }
    }

    if (rebuildDevices.eth1) {
      rebuildDevices.eth1 = {
        ...rebuildDevices.eth1,
        hwaddr: rebuildDevices.eth1.hwaddr || vmNicMacs.eth1
      }
    }
  }

  console.log(`[Rebuild] 更新实例 ${instance.incus_id} 的 cloud-init 配置...`)
  const rebuildUpdates: { config: Record<string, string>; devices?: Record<string, Record<string, string>> } = {
    config: rebuildConfig
  }
  if (rebuildDevices) {
    rebuildUpdates.devices = rebuildDevices
  }
  await updateInstance(client, instance.incus_id, rebuildUpdates)

  // 执行重装（不再传递 config，因为已经在上面更新了）
  console.log(`[Rebuild] 开始重装实例 ${instance.incus_id}，镜像: ${imageAlias}`)
  await rebuildInstance(client, instance.incus_id, { alias: imageAlias }, undefined, {
    allowCancelBusyUpdate,
    busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
  })

  await prisma.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })

  // 更新数据库记录
  await prisma.instance.update({
    where: { id: task.instanceId },
    data: {
      image: imageAlias,
      rootPassword: encryptSensitiveData(newPassword)
    }
  })

  // 启动实例（带 IPv6 路由冲突自动回退：stop 后内核路由可能残留）
  await updateInstanceTaskProgress(task.id, 'starting')
  try {
    await startInstance(client, instance.incus_id)
  } catch (startErr) {
    // IPv6 routed 模式下，force stop 后内核 host route 可能残留
    // 导致 startInstance 报 "file exists"，需暂移 eth1 再恢复
    if (startErr instanceof Error && startErr.message.includes('file exists') && rebuildDevices?.eth1) {
      console.warn(`[Rebuild] IPv6 路由残留，尝试暂移 eth1 后启动...`)
      const savedEth1 = { ...rebuildDevices.eth1 }
      const devicesWithoutEth1 = { ...rebuildDevices }
      delete devicesWithoutEth1.eth1
      await updateInstance(client, instance.incus_id, { devices: devicesWithoutEth1 })
      await startInstance(client, instance.incus_id)
      // 实例启动后恢复 eth1（Incus 会热插入并添加新的路由）
      await new Promise(r => setTimeout(r, 3000))
      await updateInstance(client, instance.incus_id, { devices: { ...devicesWithoutEth1, eth1: savedEth1 } })
      console.log(`[Rebuild] eth1 已恢复，IPv6 路由重新建立`)
    } else {
      throw startErr
    }
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // VM 启动慢，需要更长的等待时间
  const isVMRebuild = instanceType === 'virtual-machine'
  const maxAttempts = isVMRebuild ? 60 : 30    // VM: 60×3s=180s, 容器: 30×2s=60s
  const pollIntervalRebuild = isVMRebuild ? 3000 : 2000
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalRebuild))
    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      ipv4 = extractIPv4(state)
      ipv6 = extractIPv6(state)
      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Rebuild] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Rebuild] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Rebuild] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  await sendNotification(task.userId, 'instance_rebuilt', {
    instanceName: instance.name,
    hostName: host.name,
    newImage: imageAlias
  })

  await createLog(task.userId, 'instance', 'instance.rebuild', `Rebuilt instance "${instance.name}" with image ${imageAlias}`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重建任务
 * 重建会创建新的 Incus 实例替换旧实例，保留所有计费字段
 * 与重装的区别：不限制实例状态，且会删除旧实例并创建新实例
 */
async function executeRecreateTask(
  task: { id: number; userId: number; instanceId: number; imageAlias: string | null; sshKeyId: number | null; customInitCommandIds: string | null },
  instance: {
    id: number; incus_id: string; name: string; user_id: number; image: string; ipv4: string | null; ipv6: string | null;
    cpu: number; memory: number; disk: number; network_mode: string; ssh_port: number | null;
    root_password: string | null; package_id: number | null; host_id: number;
    port_limit: number | null; snapshot_limit: number | null; backup_limit: number | null; site_limit: number | null;
    swap_enabled?: boolean; swap_size?: number | null;
    limits_read?: string | null; limits_write?: string | null; limits_read_iops?: number | null; limits_write_iops?: number | null;
    limits_ingress?: string | null; limits_egress?: string | null; limits_processes?: number | null; limits_cpu_priority?: number | null;
    boot_autostart?: boolean | null; boot_autostart_priority?: number | null; boot_autostart_delay?: number | null;
    boot_host_shutdown_timeout?: number | null;
  },
  host: { id: number; name: string; nat_public_ip?: string | null; ip_address?: string | null; ipv6_gateway?: string | null; ipv6_parent_interface?: string | null },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  const imageAlias = task.imageAlias || instance.image
  const oldIncusId = instance.incus_id
  const allowCancelBusyUpdate = isAlpineImageAlias(instance.image) || isAlpineImageAlias(imageAlias)

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Recreate] 实例 ${task.instanceId} 重建前即时采集流量失败: ${collectResult.error}`)
  }

  // 1. 强制停止旧实例（如果正在运行）
  await updateInstanceTaskProgress(task.id, 'stopping')
  console.log(`[Recreate] 停止旧实例 ${oldIncusId}...`)
  try {
    await stopInstance(client, oldIncusId, false, {
      allowCancelBusyUpdate,
      busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
    })
    // 等待停止完成
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const state = await getInstanceState(client, oldIncusId) as { status: string }
        if (state.status.toLowerCase() === 'stopped') break
      } catch { /* ignore */ }
    }
  } catch (err) {
    // 实例可能已经停止或不存在，继续执行
    console.warn(`[Recreate] 停止旧实例异常，继续执行:`, err)
  }

  // 重建会生成全新的系统实例，旧 cloud-init 状态不能继续复用。
  await resetInstanceCloudInitState(task.instanceId)

  // 2. 删除旧实例的快照
  await updateInstanceTaskProgress(task.id, 'cleaning_snapshots')
  try {
    const snapshots = await listSnapshots(client, oldIncusId) as unknown[]
    if (snapshots && snapshots.length > 0) {
      console.log(`[Recreate] 删除 ${snapshots.length} 个快照...`)
      for (const snapshot of snapshots) {
        const snapshotName = typeof snapshot === 'string'
          ? snapshot.split('/').pop()
          : (snapshot as { name?: string }).name
        if (snapshotName) {
          await deleteIncusSnapshot(client, oldIncusId, snapshotName)
        }
      }
    }
    await prisma.snapshot.deleteMany({ where: { instanceId: task.instanceId } })
  } catch (_err) {
    console.warn('[Recreate] 删除快照失败，继续执行')
  }

  // 3. 获取实例类型
  let instanceType: 'container' | 'virtual-machine' = 'container'
  let pkg: Awaited<ReturnType<typeof db.getPackageById>> | null = null
  if (instance.package_id) {
    pkg = await db.getPackageById(instance.package_id)
    if (pkg?.instance_type === 'vm') {
      instanceType = 'virtual-machine'
    }
  }

  // 5. 获取 SSH 密钥
  let sshKey: string | undefined
  if (task.sshKeyId) {
    const keyRecord = await db.getSSHKeyById(task.sshKeyId)
    if (keyRecord && keyRecord.user_id === instance.user_id) {
      sshKey = keyRecord.public_key
    }
  }
  if (!sshKey) {
    const userSshKeys = await db.getSSHKeysByUserId(instance.user_id)
    sshKey = userSshKeys && userSshKeys.length > 0 ? userSshKeys[0].public_key : undefined
  }
  if (!sshKey) {
    console.warn(`[Recreate] Instance ${task.instanceId} has no SSH key; continuing without injecting authorized_keys`)
  }

  // 6. 处理自定义初始化命令
  let extraShellCommands: string | undefined
  if (task.customInitCommandIds) {
    try {
      const commandIds = JSON.parse(task.customInitCommandIds) as number[]
      if (commandIds.length > 0) {
        const commands = await getCommandsByIds(commandIds)
        const validCmds = commands.filter(cmd => cmd.userId === instance.user_id && cmd.enabled)
        const imageDistro = getImageDistroFromAlias(imageAlias)
        const compatibleCmds = validCmds.filter(cmd =>
          cmd.distros.includes('all') || cmd.distros.includes(imageDistro)
        )
        if (compatibleCmds.length > 0) {
          extraShellCommands = mergeCommandContents(compatibleCmds)
          console.log(`[Recreate] 应用 ${compatibleCmds.length} 条自定义初始化命令`)
        }
      }
    } catch (err) {
      console.warn('[Recreate] 解析自定义初始化命令失败:', err)
    }
  }

  // 7. 分配新的随机内网 IPv4 地址（避免 IP 冲突）
  await updateInstanceTaskProgress(task.id, 'creating')
  const { generateRandomIPv4 } = await import('../lib/ip-calculator.js')
  let newIPv4: string | null = null
  try {
    let attempts = 0
    const maxAttempts = 50
    while (attempts < maxAttempts) {
      newIPv4 = generateRandomIPv4()
      // 内网 IPv4 只需在同一宿主机内唯一
      const exists = await db.isIpAddressExistsOnHost(newIPv4, host.id)
      if (!exists) {
        console.log(`[Recreate] 分配新的随机 IPv4: ${newIPv4} (尝试次数: ${attempts + 1})`)
        break
      }
      attempts++
      newIPv4 = null
    }
    if (!newIPv4) {
      throw new Error('IPv4 地址池已耗尽，无法分配新地址')
    }
  } catch (err) {
    console.error('[Recreate] IPv4 分配失败:', err)
    throw new Error(`IPv4 分配失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 8. 生成新密码和 cloud-init 配置
  // 容器类型也传入 network 参数以正确配置 eth0/eth1 静态 IP
  const newPassword = generateRandomPassword(16)
  let { configPayload } = generateIncusConfig({
    instanceName: instance.name,
    imageAlias,
    rootPassword: newPassword,
    sshKey,
    networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    type: instanceType,
    network: instanceType !== 'virtual-machine' ? {
      ipAddress: `${newIPv4}/22`,
      gateway: '10.10.0.1',
      dns: ['10.10.0.1'],
      ipv6Address: instance.ipv6 ? `${instance.ipv6}/128` : undefined,
      ipv6Gateway: instance.ipv6 ? 'fe80::1' : undefined
    } : undefined,
    extraShellCommands
  })

  // 9. 生成新 Incus ID
  const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
  const newIncusId = `u${task.userId}-${shortId}`
  console.log(`[Recreate] 新实例 ID: ${newIncusId}`)
  let oldInstanceDeleted = false
  let newInstanceCreated = false
  let databaseSwitched = false

  try {
    // VM 需要 network-config（使用新分配的 IP）
    if (instanceType === 'virtual-machine') {
      const { generateVmConfig } = await import('../lib/incus-config-vm.js')
      const vmResult = generateVmConfig({
        instanceName: instance.name,
        instanceIdSeed: newIncusId,
        imageAlias,
        rootPassword: newPassword,
        sshKey,
        network: {
          ipAddress: `${newIPv4}/22`,
          gateway: '10.10.0.1',
          dns: ['10.10.0.1'],
          ipv6Address: instance.ipv6 ? `${instance.ipv6}` : undefined,
          ipv6Gateway: instance.ipv6 ? (host.ipv6_gateway || undefined) : undefined
        },
        extraShellCommands
      })
      configPayload = vmResult.configPayload
      console.log(`[Recreate] VM network-config 已更新: IPv4=${newIPv4}, IPv6=${instance.ipv6 || 'none'}`)
    } else {
      console.log(`[Recreate] Container network-config 已更新: IPv4=${newIPv4}, IPv6=${instance.ipv6 || 'none'}`)
    }

  // 10. 选择存储池
  let storagePool = await db.resolveStoragePoolForExistingInstance(task.instanceId, host.id, { packageId: instance.package_id })
  if (!storagePool) storagePool = 'default'

  // 11. 构建实例配置（使用新分配的 IPv4）
  const { buildInstanceConfig } = await import('../lib/incus/incus-instances.js')
  const ipv6Config = instance.ipv6 ? { primaryIp: instance.ipv6 } : null

  // 根据 ioLimitMode 选择性传入 IO 限制参数
  const ioMode = (pkg as any)?.io_limit_mode || (pkg as any)?.ioLimitMode || 'throughput'

  const incusConfig = buildInstanceConfig({
    name: newIncusId,
    image: imageAlias,
    cpu: instance.cpu,
    memory: instance.memory,
    disk: instance.disk,
    sshKey: '',
    password: '',
    cloudInitConfig: configPayload as { 'user.user-data': string; 'user.network-config'?: string } | undefined,
    networkMode: (instance.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    nested: pkg?.nested ? true : false,
    privileged: pkg?.privileged ? true : false,
    instanceType: instanceType === 'virtual-machine' ? 'vm' : 'container',
    storagePool,
    ipv4Address: newIPv4,
    ipv6Config,
    hostInterface: host.ipv6_parent_interface || 'eth0',
    ipv6Address: instance.ipv6,
    ipv6Gateway: host.ipv6_gateway,
    limitsRead: ioMode === 'throughput' ? instance.limits_read : null,
    limitsWrite: ioMode === 'throughput' ? instance.limits_write : null,
    limitsReadIops: ioMode === 'iops' ? instance.limits_read_iops : null,
    limitsWriteIops: ioMode === 'iops' ? instance.limits_write_iops : null,
    limitsIngress: instance.limits_ingress,
    limitsEgress: instance.limits_egress,
    limitsProcesses: instance.limits_processes,
    limitsCpuPriority: instance.limits_cpu_priority,
    bootAutostart: instance.boot_autostart,
    bootAutostartPriority: instance.boot_autostart_priority,
    bootAutostartDelay: instance.boot_autostart_delay,
    bootHostShutdownTimeout: instance.boot_host_shutdown_timeout
  })

  // 12. 删除旧 Incus 实例（如果还存在）
  await updateInstanceTaskProgress(task.id, 'deleting_old')
  console.log(`[Recreate] 删除旧实例 ${oldIncusId}（如果存在）...`)
  try {
    await deleteInstance(client, oldIncusId)
    console.log(`[Recreate] 旧实例 ${oldIncusId} 删除成功`)
    oldInstanceDeleted = true
  } catch (err) {
    // 检查是否是实例不存在的错误
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('not found') || errMsg.includes('Instance not found')) {
      console.log(`[Recreate] 旧实例 ${oldIncusId} 已不存在，继续执行`)
      oldInstanceDeleted = true
    } else {
      // 其他错误则抛出，不继续执行
      console.error(`[Recreate] 删除旧实例失败:`, err)
      throw new Error(`删除旧实例失败: ${errMsg}`)
    }
  }

  // 12. 创建新实例
  console.log(`[Recreate] 创建新实例 ${newIncusId}...`)
  await createInstance(client, incusConfig)
  newInstanceCreated = true

  if (instanceType === 'container') {
    await updateInstance(client, newIncusId, {
      config: {
        'limits.memory.swap': resolveIncusSwapValue(instance.swap_enabled === true, instance.swap_size)
      }
    })
  }

  // 13. 启动新实例
  await updateInstanceTaskProgress(task.id, 'starting')
  console.log(`[Recreate] 启动新实例 ${newIncusId}...`)
  await startInstance(client, newIncusId)

  // 14. 等待网络初始化
  let actualIpv6: string | null = null
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      const state = await getInstanceState(client, newIncusId) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      const stateIpv4 = extractIPv4(state)
      actualIpv6 = extractIPv6(state)
      if (needsIPv6) {
        if (stateIpv4 && actualIpv6) {
          console.log(`[Recreate] IP 确认成功: IPv4=${stateIpv4}, IPv6=${actualIpv6}`)
          break
        }
      } else {
        if (stateIpv4) {
          console.log(`[Recreate] IP 确认成功: IPv4=${stateIpv4}`)
          break
        }
      }
    } catch { /* ignore */ }
  }

  // 15. 更新数据库（使用新分配的 IP）
  await updateInstanceTaskProgress(task.id, 'updating_database')

  const cleanupResult = await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id)
  if (cleanupResult.deletedPortMappingsCount > 0) {
    console.log(`[Recreate] 删除 ${cleanupResult.deletedPortMappingsCount} 个端口映射记录并释放 NAT 端口计数`)
  }

  // 更新 IpAddress 表（删除旧的 IPv4 记录，创建新的）
  if (instance.ipv4 && instance.ipv4 !== newIPv4) {
    // 删除旧的 IPv4 地址记录
    await prisma.ipAddress.deleteMany({
      where: {
        instanceId: task.instanceId,
        type: 'inet4',
        address: instance.ipv4
      }
    })
    console.log(`[Recreate] 删除旧 IPv4 记录: ${instance.ipv4}`)
  }

  // 创建新的 IPv4 地址记录
  await db.createIpAddress({
    address: newIPv4,
    type: 'inet4',
    isPrimary: true,
    device: 'eth0',
    instanceId: task.instanceId
  })
  console.log(`[Recreate] 创建新 IPv4 记录: ${newIPv4}`)

  // 更新 Instance 表
  await prisma.instance.update({
    where: { id: task.instanceId },
    data: {
      incusId: newIncusId,
      image: imageAlias,
      rootPassword: encryptSensitiveData(newPassword),
      status: 'running',
      ipv4: newIPv4,  // 使用新分配的 IP
      ipv6: actualIpv6 || instance.ipv6,  // IPv6 可能从网络获取或保留旧值
      storagePoolName: storagePool
      // 保留计费字段：packagePlanId, billingPrice, billingCycle, expiresAt, autoRenew 等
    }
  })
  databaseSwitched = true

  // 同步流量限速状态
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  console.log(`[Recreate] 重建完成: ${oldIncusId} -> ${newIncusId}, 新 IP: ${newIPv4}`)

  await sendNotification(task.userId, 'instance_rebuilt', {
    instanceName: instance.name,
    hostName: host.name,
    newImage: imageAlias
  })

  await createLog(task.userId, 'instance', 'instance.recreate', `Recreated instance "${instance.name}" with image ${imageAlias} (${oldIncusId} -> ${newIncusId})`, 'success', { instanceId: task.instanceId })
  } catch (err) {
    if (!databaseSwitched && newInstanceCreated) {
      try {
        try {
          await stopInstance(client, newIncusId, true)
        } catch {
          // The replacement may not have reached running state; deletion can still proceed.
        }
        await deleteInstance(client, newIncusId)
        console.log(`[Recreate] 已清理失败的新实例 ${newIncusId}`)
      } catch (cleanupErr) {
        console.warn(`[Recreate] 清理失败的新实例 ${newIncusId} 失败:`, cleanupErr)
      }
    }

    if (!databaseSwitched && oldInstanceDeleted) {
      try {
        await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id)
        await prisma.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })
        await prisma.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })
        await prisma.instance.update({
          where: { id: task.instanceId },
          data: {
            status: 'error',
            ipv4: null,
            ipv6: null
          }
        })
        console.warn(`[Recreate] 旧实例 ${oldIncusId} 已删除但新实例未成功交付，数据库实例已标记为 error`)
      } catch (dbErr) {
        console.warn(`[Recreate] 标记重建失败实例为 error 失败:`, dbErr)
      }
    }

    throw err
  }
}

/**
 * 执行改节点任务
 * 在目标节点创建新 Incus 实例，成功切换数据库后再清理源节点旧实例。
 */
async function executeChangeHostTask(
  task: { id: number; userId: number; instanceId: number; targetHostId: number | null; sshKeyId: number | null },
  instance: {
    id: number; incus_id: string; name: string; user_id: number; image: string; ipv4: string | null; ipv6: string | null;
    cpu: number; memory: number; disk: number; network_mode: string; root_password: string | null; package_id: number | null; host_id: number; status: string;
    swap_enabled?: boolean; swap_size?: number | null; storage_pool_name?: string | null;
    package_plan_id?: number | null;
    limits_read?: string | null; limits_write?: string | null; limits_read_iops?: number | null; limits_write_iops?: number | null;
    limits_ingress?: string | null; limits_egress?: string | null; limits_processes?: number | null; limits_cpu_priority?: number | null;
    boot_autostart?: boolean | null; boot_autostart_priority?: number | null; boot_autostart_delay?: number | null;
    boot_host_shutdown_timeout?: number | null;
  },
  targetHost: NonNullable<Awaited<ReturnType<typeof db.getHostById>>>,
  targetClient: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  const targetHostId = task.targetHostId || targetHost.id
  const sourceHostId = instance.host_id
  const oldIncusId = instance.incus_id
  const imageAlias = instance.image
  let targetResourcesReserved = false
  let dbSwitched = false
  let newIncusId = ''

  if (!task.sshKeyId) {
    throw new Error('改节点失败：请选择 SSH 密钥')
  }
  if (targetHostId !== targetHost.id) {
    throw new Error('任务目标节点与队列节点不一致')
  }
  if (targetHostId === sourceHostId) {
    throw new Error('目标节点不能与当前节点相同')
  }

  const sourceHost = await db.getHostById(sourceHostId)
  if (!sourceHost) {
    throw new Error('源节点不存在')
  }

  if (!instance.package_id) {
    throw new Error('该实例没有绑定套餐，无法改节点')
  }

  const pkg = await db.getPackageById(instance.package_id)
  if (!pkg) {
    throw new Error('实例套餐不存在，无法改节点')
  }

  const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
  if (!packageHostIds.includes(targetHostId)) {
    throw new Error('目标节点不在该套餐绑定节点中')
  }

  const packageInstanceType = ((pkg as { instance_type?: 'container' | 'vm' }).instance_type || 'container')
  const hostInstanceType = targetHost.instance_type || 'container'
  if (packageInstanceType === 'vm' && hostInstanceType === 'container') {
    throw new Error('目标节点不支持 KVM 实例')
  }
  if (packageInstanceType === 'container' && hostInstanceType === 'vm') {
    throw new Error('目标节点不支持 LXC 实例')
  }

  const imageAvailability = await getSystemImageAvailabilityForHost(imageAlias, targetHostId, {
    instanceType: packageInstanceType,
    memory: instance.memory
  })
  if (!imageAvailability.ok) {
    throw new Error(`目标节点不可用该镜像: ${imageAvailability.reason}`)
  }

  const keyRecord = await db.getSSHKeyById(task.sshKeyId)
  if (!keyRecord || keyRecord.user_id !== instance.user_id) {
    throw new Error('SSH 密钥不存在或不属于实例所有者')
  }

  let rootPassword = generateRandomPassword(16)
  if (instance.root_password) {
    try {
      const decrypted = decryptSensitiveData(instance.root_password)
      if (decrypted) {
        rootPassword = decrypted
      }
    } catch (err) {
      console.warn(`[ChangeHost] 解密原实例密码失败，将生成新密码:`, err)
    }
  }

  try {
    await updateInstanceTaskProgress(task.id, 'checking_capacity')
    const reservedHost = await prisma.$transaction(async (tx) => {
      return db.selectAndReserveHostWithLock(tx, {
        packageHostIds,
        cpu: instance.cpu,
        memory: instance.memory,
        disk: instance.disk,
        hostId: targetHostId,
        ownerId: pkg.user_id || targetHost.user_id,
        portCount: 0
      })
    }, {
      isolationLevel: 'Serializable',
      timeout: 15000
    })

    if (!reservedHost) {
      throw new Error('目标节点 CPU 或内存容量不足')
    }
    targetResourcesReserved = true

    const collectResult = await collectTrafficForRunningInstance(task.instanceId)
    if (!collectResult.success) {
      console.warn(`[ChangeHost] 实例 ${task.instanceId} 改节点前即时采集流量失败: ${collectResult.error}`)
    }

    const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is changing host')
    if (closedSessions > 0) {
      console.log(`[ChangeHost] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
    }

    await updateInstanceTaskProgress(task.id, 'allocating_network')
    let staticIPv4: string | null = null
    for (let attempts = 0; attempts < 50; attempts++) {
      staticIPv4 = generateRandomIPv4()
      const exists = await db.isIpAddressExistsOnHost(staticIPv4, targetHostId)
      if (!exists) break
      staticIPv4 = null
    }
    if (!staticIPv4) {
      throw new Error('IPv4 地址池已耗尽，无法分配新地址')
    }

    let staticIPv6: string | null = null
    const needsRoutedIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)
    if (needsRoutedIPv6 && targetHost.ipv6_subnet) {
      for (let attempts = 0; attempts < 50; attempts++) {
        staticIPv6 = generateRandomIPv6(targetHost.ipv6_subnet)
        const exists = await db.isIpAddressExists(staticIPv6)
        if (!exists) break
        staticIPv6 = null
      }
      if (!staticIPv6) {
        throw new Error('IPv6 地址池已耗尽，无法分配新地址')
      }
    }

    const instanceType = packageInstanceType === 'vm' ? 'virtual-machine' : 'container'
    const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
    newIncusId = `u${instance.user_id}-${shortId}`

    let { configPayload } = generateIncusConfig({
      instanceName: instance.name,
      imageAlias,
      rootPassword,
      sshKey: keyRecord.public_key,
      networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      type: instanceType,
      network: {
        ipAddress: `${staticIPv4}/22`,
        gateway: '10.10.0.1',
        dns: ['10.10.0.1'],
        ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
        ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
      }
    })

    if (instanceType === 'virtual-machine') {
      const { generateVmConfig } = await import('../lib/incus-config-vm.js')
      const vmResult = generateVmConfig({
        instanceName: instance.name,
        instanceIdSeed: newIncusId,
        imageAlias,
        rootPassword,
        sshKey: keyRecord.public_key,
        network: {
          ipAddress: `${staticIPv4}/22`,
          gateway: '10.10.0.1',
          dns: ['10.10.0.1'],
          ipv6Address: staticIPv6 ? `${staticIPv6}` : undefined,
          ipv6Gateway: staticIPv6 ? (targetHost.ipv6_gateway || undefined) : undefined
        }
      })
      configPayload = vmResult.configPayload
    }

    let storagePool = await db.resolveStoragePoolForNewInstance(targetHostId, { packageId: instance.package_id })
    if (!storagePool) storagePool = 'default'

    const { buildInstanceConfig } = await import('../lib/incus/incus-instances.js')
    const ioMode = (pkg as any)?.io_limit_mode || (pkg as any)?.ioLimitMode || 'throughput'
    const ipv6Config = staticIPv6 ? { primaryIp: staticIPv6 } : null

    const incusConfig = buildInstanceConfig({
      name: newIncusId,
      image: imageAlias,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      swapEnabled: instance.swap_enabled === true,
      swapSize: instance.swap_size ?? null,
      sshKey: '',
      password: '',
      cloudInitConfig: configPayload as { 'user.user-data': string; 'user.network-config'?: string } | undefined,
      networkMode: (instance.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      nested: Boolean((pkg as any)?.nested),
      privileged: Boolean((pkg as any)?.privileged),
      instanceType: packageInstanceType,
      storagePool,
      ipv4Address: staticIPv4,
      ipv6Config,
      hostInterface: targetHost.ipv6_parent_interface || 'eth0',
      ipv6Address: staticIPv6,
      ipv6Gateway: targetHost.ipv6_gateway,
      limitsRead: ioMode === 'throughput' ? instance.limits_read : null,
      limitsWrite: ioMode === 'throughput' ? instance.limits_write : null,
      limitsReadIops: ioMode === 'iops' ? instance.limits_read_iops : null,
      limitsWriteIops: ioMode === 'iops' ? instance.limits_write_iops : null,
      limitsIngress: instance.limits_ingress,
      limitsEgress: instance.limits_egress,
      limitsProcesses: instance.limits_processes,
      limitsCpuPriority: instance.limits_cpu_priority,
      bootAutostart: instance.boot_autostart,
      bootAutostartPriority: instance.boot_autostart_priority,
      bootAutostartDelay: instance.boot_autostart_delay,
      bootHostShutdownTimeout: instance.boot_host_shutdown_timeout
    })

    await updateInstanceTaskProgress(task.id, 'creating_on_target')
    console.log(`[ChangeHost] 在目标节点 ${targetHost.name} 创建实例 ${newIncusId}...`)
    await createInstance(targetClient, incusConfig)

    await updateInstanceTaskProgress(task.id, 'starting_target')
    await startInstance(targetClient, newIncusId)

    let actualIpv4: string | null = staticIPv4
    let actualIpv6: string | null = staticIPv6
    const maxAttempts = instanceType === 'virtual-machine' ? 60 : 30
    const pollInterval = instanceType === 'virtual-machine' ? 3000 : 2000
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      try {
        const state = await getInstanceState(targetClient, newIncusId) as {
          network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
        }
        actualIpv4 = extractIPv4(state) || actualIpv4
        if (needsRoutedIPv6) {
          actualIpv6 = extractIPv6(state) || actualIpv6
        }
        if (needsRoutedIPv6) {
          if (actualIpv4 && actualIpv6) break
        } else if (actualIpv4) {
          break
        }
      } catch {
        // keep waiting
      }
    }

    await updateInstanceTaskProgress(task.id, 'switching_database')

    const proxySites = await prisma.proxySite.findMany({
      where: { instanceId: task.instanceId }
    })
    let deletedPortMappingsCount = 0
    let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
    if (instance.package_plan_id) {
      const plan = await db.getPlanById(instance.package_plan_id)
      if (plan && plan.packageId === instance.package_id) {
        baseTrafficLimit = plan.trafficLimit
      }
    }

    await prisma.$transaction(async (tx) => {
      const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
        packageId: instance.package_id,
        hostId: targetHostId,
        baseTrafficLimit
      })
      const currentTraffic = await tx.instance.findUniqueOrThrow({
        where: { id: task.instanceId },
        select: { monthlyTrafficUsed: true }
      })

      const deletedPortMappings = await tx.portMapping.deleteMany({ where: { instanceId: task.instanceId } })
      deletedPortMappingsCount = deletedPortMappings.count
      await tx.snapshot.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.backup.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.restoreTask.deleteMany({
        where: {
          instanceId: task.instanceId,
          status: { in: ['COMPLETED', 'FAILED'] }
        }
      })
      await tx.backupUploadTask.deleteMany({
        where: {
          instanceId: task.instanceId,
          status: { in: ['COMPLETED', 'FAILED'] }
        }
      })
      await tx.proxySite.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.backupPolicy.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.snapshotPolicy.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })

      if (actualIpv6) {
        await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, actualIpv6)
        const existingIpv6 = await tx.instance.findFirst({
          where: {
            id: { not: task.instanceId },
            status: { not: 'deleted' },
            OR: [
              { ipv6: actualIpv6 },
              {
                ipAddresses: {
                  some: {
                    address: actualIpv6,
                    type: 'inet6'
                  }
                }
              }
            ]
          },
          select: { id: true }
        })
        if (existingIpv6) {
          throw new Error(`IP address ${actualIpv6} is already assigned to instance ${existingIpv6.id}`)
        }
      }

      await tx.instance.update({
        where: { id: task.instanceId },
        data: {
          hostId: targetHostId,
          incusId: newIncusId,
          rootPassword: encryptSensitiveData(rootPassword),
          status: 'running',
          ipv4: actualIpv4,
          ipv6: actualIpv6,
          storagePoolName: storagePool,
          monthlyTrafficLimit,
          trafficStatus: calculateInstanceTrafficStatus(currentTraffic.monthlyTrafficUsed, monthlyTrafficLimit),
          cloudInitState: null,
          cloudInitSource: null,
          cloudInitLastCheckedAt: null,
          cloudInitCompletedAt: null,
          cloudInitManualCompletedAt: null,
          cloudInitManualCompletedBy: null
        }
      })

      if (actualIpv4) {
        await tx.ipAddress.create({
          data: {
            address: actualIpv4,
            type: 'inet4',
            isPrimary: true,
            isCustom: false,
            device: 'eth0',
            hostId: targetHostId,
            instanceId: task.instanceId
          }
        })
      }

      if (actualIpv6) {
        await tx.ipAddress.create({
          data: {
            address: actualIpv6,
            type: 'inet6',
            isPrimary: true,
            isCustom: false,
            device: 'eth1',
            hostId: targetHostId,
            instanceId: task.instanceId
          }
        })
      }
    })
    dbSwitched = true

    if (proxySites.length > 0 && sourceHost.caddy_enabled && sourceHost.caddy_username && sourceHost.caddy_password) {
      const caddyHost = sourceHost.nat_public_ip || sourceHost.ip_address
      if (caddyHost) {
        const caddyClient = createCaddyClient({
          host: caddyHost,
          port: sourceHost.caddy_port || 8444,
          username: sourceHost.caddy_username,
          password: sourceHost.caddy_password
        })
        for (const site of proxySites) {
          try {
            await caddyClient.deleteSite(site.domain)
          } catch (err) {
            console.warn(`[ChangeHost] 删除 Caddy 站点 ${site.domain} 失败，数据库记录已清理:`, err)
          }
        }
      }
    }

    await updateInstanceTaskProgress(task.id, 'deleting_old')
    let sourceClient: Awaited<ReturnType<typeof getIncusClient>> | null = null
    let sourceInstanceReleased = false
    try {
      sourceClient = await getIncusClient(sourceHost)
      const allowCancelBusyUpdate = isAlpineImageAlias(instance.image)
      try {
        await stopInstance(sourceClient, oldIncusId, true, {
          allowCancelBusyUpdate,
          busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
        })
      } catch (err) {
        console.warn(`[ChangeHost] 停止源实例 ${oldIncusId} 失败，继续尝试删除:`, err)
      }
      await deleteInstance(sourceClient, oldIncusId)
      console.log(`[ChangeHost] 源实例 ${oldIncusId} 已删除`)
      sourceInstanceReleased = true
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('not found') || errMsg.includes('Instance not found')) {
        console.log(`[ChangeHost] 源实例 ${oldIncusId} 已不存在`)
        sourceInstanceReleased = true
      } else {
        console.warn(`[ChangeHost] 源实例 ${oldIncusId} 删除失败，需要人工清理: ${errMsg}`)
      }
    }

    try {
      if (sourceInstanceReleased) {
        await db.rollbackResources({
          hostId: sourceHostId,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          portCount: deletedPortMappingsCount
        })

        const actualSourcePortsUsed = await prisma.portMapping.count({
          where: {
            instance: {
              hostId: sourceHostId,
              status: { not: 'deleted' }
            }
          }
        })
        const [sourceResourcesCalculated, targetResourcesCalculated, sourceHostAfterRelease, targetHostCurrent] = await Promise.all([
          db.calculateHostResourcesFromInstances(sourceHostId),
          db.calculateHostResourcesFromInstances(targetHostId),
          prisma.host.findUnique({
            where: { id: sourceHostId },
            select: {
              cpuUsed: true,
              memoryUsed: true,
              diskUsed: true,
              natPortsUsedCount: true
            }
          }),
          prisma.host.findUnique({
            where: { id: targetHostId },
            select: {
              cpuUsed: true,
              memoryUsed: true,
              diskUsed: true
            }
          })
        ])
        const sourceResources = {
          cpuUsed: Math.max(sourceResourcesCalculated.cpuUsed, sourceHostAfterRelease?.cpuUsed ?? 0),
          memoryUsed: Math.max(sourceResourcesCalculated.memoryUsed, sourceHostAfterRelease?.memoryUsed ?? 0),
          diskUsed: Math.max(sourceResourcesCalculated.diskUsed, sourceHostAfterRelease?.diskUsed ?? 0)
        }
        const targetResources = {
          cpuUsed: Math.max(targetResourcesCalculated.cpuUsed, targetHostCurrent?.cpuUsed ?? 0),
          memoryUsed: Math.max(targetResourcesCalculated.memoryUsed, targetHostCurrent?.memoryUsed ?? 0),
          diskUsed: Math.max(targetResourcesCalculated.diskUsed, targetHostCurrent?.diskUsed ?? 0)
        }
        const sourceNatPortsUsed = Math.max(actualSourcePortsUsed, sourceHostAfterRelease?.natPortsUsedCount ?? 0)
        await Promise.all([
          db.updateHostResources(sourceHostId, sourceResources),
          db.updateHostResources(targetHostId, targetResources),
          prisma.host.update({
            where: { id: sourceHostId },
            data: { natPortsUsedCount: sourceNatPortsUsed }
          })
        ])
      } else {
        const [targetResourcesCalculated, targetHostCurrent] = await Promise.all([
          db.calculateHostResourcesFromInstances(targetHostId),
          prisma.host.findUnique({
            where: { id: targetHostId },
            select: {
              cpuUsed: true,
              memoryUsed: true,
              diskUsed: true
            }
          })
        ])
        const targetResources = {
          cpuUsed: Math.max(targetResourcesCalculated.cpuUsed, targetHostCurrent?.cpuUsed ?? 0),
          memoryUsed: Math.max(targetResourcesCalculated.memoryUsed, targetHostCurrent?.memoryUsed ?? 0),
          diskUsed: Math.max(targetResourcesCalculated.diskUsed, targetHostCurrent?.diskUsed ?? 0)
        }
        await db.updateHostResources(targetHostId, targetResources)
        console.warn(`[ChangeHost] 源实例 ${oldIncusId} 未确认删除，暂不释放源节点 ${sourceHost.name} 的资源占用`)
      }
    } catch (err) {
      console.warn(`[ChangeHost] 更新节点资源失败:`, err)
    }

    try {
      const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
      await reconcileTrafficStateForInstanceIds([task.instanceId])
    } catch (err) {
      console.warn(`[ChangeHost] 重算流量调度状态失败:`, err)
    }

    await sendNotification(instance.user_id, 'instance_host_changed', {
      instanceName: instance.name,
      oldHostName: sourceHost.name,
      newHostName: targetHost.name,
      ipv4: actualIpv4 || undefined,
      ipv6: actualIpv6 || undefined
    })

    await createLog(
      task.userId,
      'instance',
      'instance.change_host',
      `Changed instance "${instance.name}" host from "${sourceHost.name}" to "${targetHost.name}" (${oldIncusId} -> ${newIncusId})`,
      'success',
      { instanceId: task.instanceId }
    )
  } catch (err) {
    if (!dbSwitched) {
      let targetInstanceReleased = !newIncusId
      if (newIncusId) {
        targetInstanceReleased = false
        try {
          try {
            await stopInstance(targetClient, newIncusId, true)
          } catch {
            // Instance may not have reached running state; deletion can still proceed.
          }
          await deleteInstance(targetClient, newIncusId)
          targetInstanceReleased = true
        } catch (cleanupErr) {
          const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
          if (cleanupMessage.includes('not found') || cleanupMessage.includes('Instance not found')) {
            targetInstanceReleased = true
          } else {
            console.warn(`[ChangeHost] 清理目标节点新实例 ${newIncusId} 失败:`, cleanupErr)
          }
        }
      }
      if (targetResourcesReserved) {
        if (targetInstanceReleased) {
          try {
            await db.rollbackResources({
              hostId: targetHostId,
              cpu: instance.cpu,
              memory: instance.memory,
              disk: instance.disk,
              portCount: 0
            })
          } catch (rollbackErr) {
            console.warn(`[ChangeHost] 回滚目标节点资源失败:`, rollbackErr)
          }
        } else {
          console.warn(`[ChangeHost] 目标实例 ${newIncusId} 未确认清理，暂不释放目标节点 ${targetHost.name} 的资源预占`)
        }
      }
    }
    throw err
  }
}

/**
 * 执行克隆任务
 * 注意：克隆任务比较复杂，需要处理新实例的创建
 */
async function executeCloneTask(
  task: { id: number; userId: number; instanceId: number },
  sourceInstance: { incus_id: string; name: string; user_id: number; image: string; cpu: number; memory: number; disk: number; network_mode: string; ssh_port: number | null; root_password: string | null; package_id: number | null; package_plan_id?: number | null; host_id: number; port_limit: number | null; snapshot_limit: number | null; backup_limit: number | null; site_limit: number | null; swap_enabled?: boolean; swap_size?: number | null; storage_pool_name?: string | null },
  host: { id: number; name: string; nat_public_ip?: string | null; ip_address?: string | null; caddy_enabled?: boolean; caddy_username?: string | null; caddy_password?: string | null; caddy_port?: number | null; nat_port_start: number | null; nat_port_end: number | null; nat_ports_used_count?: number; ipv6_subnet?: string | null; ipv6_gateway?: string | null; ipv6_parent_interface?: string | null; cpu_allowance_max?: number; memory_max?: number; instance_type?: 'container' | 'vm' | 'both' },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'cloning')

  // 生成新实例名称（原名称 + -clone）
  const newInstanceName = `${sourceInstance.name}-clone`
  const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
  const newIncusId = `u${task.userId}-${shortId}`

  // 获取源实例的端口映射
  const sourcePortMappings = await db.getPortMappings(task.instanceId)

  // 跟踪资源是否已预占（用于失败时回滚）
  let resourcesReserved = false
  let newPortMappingsCount = 0

  try {
    // 1. 复制实例（使用 Incus copy API）
    const copyPayload = {
      name: newIncusId,
      source: {
        type: 'copy',
        source: sourceInstance.incus_id
      }
    }

    await client.request('POST', '/1.0/instances', copyPayload, 300000) // 5分钟超时

    // 2. 获取新实例的设备信息，更新端口映射
    const newInstanceInfo = await getInstance(client, newIncusId) as { devices?: Record<string, { type?: string; listen?: string; connect?: string }> }
    const devices = newInstanceInfo.devices || {}

    // 查找所有 proxy 设备并更新端口
    const updatedDevices: Record<string, unknown> = {}
    const newPortMappings: Array<{ protocol: 'tcp' | 'udp'; publicPort: number; privatePort: number; remark: string | null }> = []
    const selectedClonePortsByProtocol: Record<'tcp' | 'udp', Set<number>> = {
      tcp: new Set<number>(),
      udp: new Set<number>()
    }

    for (const [deviceName, device] of Object.entries(devices)) {
      if (device.type === 'proxy' && device.listen) {
        // 解析 listen 格式：tcp:0.0.0.0:8080
        const listenMatch = device.listen.match(/^(tcp|udp):(.+):(\d+)$/)
        if (listenMatch) {
          const protocol = listenMatch[1] as 'tcp' | 'udp'
          const connect = device.connect || ''

          // 从源端口映射中找到对应的映射（通过 listen 端口匹配）
          const listenPort = parseInt(listenMatch[3])
          const sourceMapping = sourcePortMappings.find(m =>
            m.protocol === protocol && m.public_port === listenPort
          )

          // 解析 connect 获取 privatePort
          const connectMatch = connect.match(/^(tcp|udp):(.+):(\d+)$/)
          const privatePort = connectMatch ? parseInt(connectMatch[3]) : (sourceMapping?.private_port || 80)

          // 分配新端口
          const newPublicPort = await db.allocatePort(
            host.id,
            protocol,
            Array.from(selectedClonePortsByProtocol[protocol])
          )
          if (!newPublicPort) {
            throw new Error('No available port for clone operation')
          }
          selectedClonePortsByProtocol[protocol].add(newPublicPort)

          // 根据网络模式决定 listen 地址
          let cloneListenAddr: string
          const fullHost = await db.getHostById(host.id)
          const bindableIpv4 = selectBindableIpv4ListenAddress(
            (fullHost as any)?.nat_bind_ip || null,
            host.nat_public_ip,
            fullHost?.url || null,
            fullHost?.ip_address || null
          )
          if (['ipv6_only', 'ipv6_nat'].includes(sourceInstance.network_mode)) {
            // 纯 IPv6 模式：从数据库获取宿主机的公网 IPv6 地址
            const hostIpv6 = fullHost?.nat_public_ipv6 || fullHost?.ipv6_gateway || fullHost?.ip_address
            if (hostIpv6 && hostIpv6.includes(':')) {
              cloneListenAddr = `[${hostIpv6.replace(/^\[|\]$/g, '')}]`
            } else {
              cloneListenAddr = bindableIpv4
            }
          } else {
            cloneListenAddr = bindableIpv4
          }
          const cloneConnectAddr = ['ipv6_only', 'ipv6_nat'].includes(sourceInstance.network_mode) ? '[::]' : '0.0.0.0'
          const proxyConfig: Record<string, string> = {
            type: 'proxy',
            listen: `${protocol}:${cloneListenAddr}:${newPublicPort}`,
            connect: `${protocol}:${cloneConnectAddr}:${privatePort}`
          }
          if (!['ipv6_only', 'ipv6_nat'].includes(sourceInstance.network_mode)) {
            proxyConfig.nat = 'true'
          }
          updatedDevices[deviceName] = proxyConfig

          newPortMappings.push({
            protocol,
            publicPort: newPublicPort,
            privatePort,
            remark: sourceMapping?.remark || null
          })
        }
      } else {
        // 保留非 proxy 设备
        updatedDevices[deviceName] = device
      }
    }

    // 3. 分配新的 IPv4 地址（克隆实例必须使用新的 IPv4，避免 IP 冲突）
    let newIPv4: string | null = null
    try {
      let attempts = 0
      const maxAttempts = 50

      while (attempts < maxAttempts) {
        newIPv4 = generateRandomIPv4()
        // 内网 IPv4 只需在同一宿主机内唯一（不同宿主机的内网是隔离的）
        const exists = await db.isIpAddressExistsOnHost(newIPv4, host.id)

        if (!exists) {
          console.log(`[Clone] 为新实例随机分配 IPv4: ${newIPv4} (尝试次数: ${attempts + 1})`)
          break
        }

        attempts++
        newIPv4 = null
      }

      if (!newIPv4) {
        throw new Error('Failed to allocate IPv4 address, pool may be exhausted')
      }

      // 更新 eth0 设备的 ipv4.address
      if (updatedDevices['eth0']) {
        (updatedDevices['eth0'] as Record<string, string>)['ipv4.address'] = newIPv4
      } else {
        // 从原设备复制并修改
        const eth0Device = devices['eth0'] as Record<string, string> | undefined
        if (eth0Device) {
          updatedDevices['eth0'] = {
            ...eth0Device,
            'ipv4.address': newIPv4
          }
        }
      }

      // NAT 模式使用 connect 0.0.0.0，无需替换为实际 IP
    } catch (err) {
      console.error('[Clone] IPv4 分配失败:', err)
      throw err
    }

    // 4. 处理 IPv6 地址冲突（dual/ipv6 模式需要分配新 IP）
    // 新架构: IPv6 在 eth1 (routed 模式)
    let newIPv6: string | null = null

    // 先计算 IPv6 地址（不创建数据库记录）
    if (sourceInstance.network_mode !== 'nat' && host.ipv6_subnet) {
      try {
        // 随机生成 IPv6 地址，如果地址已存在则重新生成
        let attempts = 0
        const maxAttempts = 50

        while (attempts < maxAttempts) {
          newIPv6 = generateRandomIPv6(host.ipv6_subnet)
          const exists = await db.isIpAddressExists(newIPv6)

          if (!exists) {
            console.log(`[Clone] 为新实例随机分配 IPv6: ${newIPv6} (尝试次数: ${attempts + 1})`)
            break
          }

          attempts++
          newIPv6 = null
        }

        if (!newIPv6) {
          throw new Error(`无法为新实例找到可用的 IPv6 地址，已尝试 ${maxAttempts} 次随机生成`)
        }

        // 新架构: 更新 eth1 设备的 IPv6 地址 (routed 模式)
        if (updatedDevices['eth1']) {
          (updatedDevices['eth1'] as Record<string, string>)['ipv6.address'] = newIPv6
        } else {
          // 如果 eth1 不在 updatedDevices 中，从原设备复制并修改
          const eth1Device = devices['eth1'] as Record<string, string> | undefined
          if (eth1Device) {
            updatedDevices['eth1'] = {
              ...eth1Device,
              'ipv6.address': newIPv6
            }
          } else {
            // 创建新的 eth1 设备配置 (routed 模式)
            updatedDevices['eth1'] = {
              type: 'nic',
              nictype: 'routed',
              parent: host.ipv6_parent_interface || 'eth0',
              name: 'eth1',
              'ipv6.address': newIPv6,
              'security.ipv6_filtering': 'true',
              'security.mac_filtering': 'true'
            }
          }
        }

        // 生成 cloud-init network-config
        // 使用新分配的 IPv4 地址和新分配的 IPv6 地址
        if (newIPv4 && newIPv6) {
          const { generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
          const { generateVmNicMacs } = await import('../lib/vm-network-identifiers.js')
          const networkConfig = generateCloudInitNetworkConfig({
            ipv4Address: newIPv4,
            ipv6List: [newIPv6],
            nicMacs: generateVmNicMacs(newIncusId)
          })

          // 更新实例的 cloud-init 配置
          await updateInstance(client, newIncusId, {
            config: {
              'user.network-config': networkConfig
            }
          })
          console.log(`[Clone] 生成 network-config: IPv4=${newIPv4}, IPv6=${newIPv6}`)
        }
      } catch (err) {
        console.warn(`[Clone] IPv6 计算失败:`, err)
        // 如果 IPv6 计算失败，继续执行但不设置 newIPv6
        newIPv6 = null
      }
    }

    // 4. 更新新实例的设备配置（端口映射 + IPv4 + IPv6）
    if (Object.keys(updatedDevices).length > 0) {
      await updateInstance(client, newIncusId, { devices: updatedDevices })
    }

    // 4.5. 如果只有 IPv4 没有 IPv6（NAT 模式），生成仅 IPv4 的 network-config
    if (newIPv4 && !newIPv6) {
      const { generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
      const { generateVmNicMacs } = await import('../lib/vm-network-identifiers.js')
      const networkConfig = generateCloudInitNetworkConfig({
        ipv4Address: newIPv4,
        nicMacs: generateVmNicMacs(newIncusId)
      })
      await updateInstance(client, newIncusId, {
        config: {
          'user.network-config': networkConfig
        }
      })
      console.log(`[Clone] 生成 network-config (NAT 模式): IPv4=${newIPv4}`)
    }

    // 5. 获取套餐信息
    const pkg = sourceInstance.package_id ? await db.getPackageById(sourceInstance.package_id) : null
    if (!pkg) {
      throw new Error('Package not found for source instance')
    }

    // 6. 创建数据库记录
    const snapshotSpecs = {
      packageId: pkg.id,
      packageName: pkg.name,
      cpuMax: pkg.cpu_max,
      memoryMax: pkg.memory_max,
      diskMax: pkg.disk_max,
      networkMode: sourceInstance.network_mode,
      portLimit: sourceInstance.port_limit || 20,
      nested: Boolean(pkg.nested),
      privileged: Boolean(pkg.privileged),
      nodeSelectors: JSON.parse((pkg as any).node_selectors || '[]'),
      createdAt: new Date().toISOString()
    }

    let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
    if (sourceInstance.package_plan_id) {
      const plan = await db.getPlanById(sourceInstance.package_plan_id)
      if (plan && plan.packageId === sourceInstance.package_id) {
        baseTrafficLimit = plan.trafficLimit
      }
    }
    const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(prisma as any, {
      packageId: sourceInstance.package_id,
      hostId: sourceInstance.host_id,
      baseTrafficLimit
    })

    const newInstanceId = await db.createInstance({
      incusId: newIncusId,
      name: newInstanceName,
      userId: task.userId,
      hostId: sourceInstance.host_id,
      packageId: sourceInstance.package_id!,
      storagePoolName: sourceInstance.storage_pool_name ?? null,
      image: sourceInstance.image,
      cpu: sourceInstance.cpu,
      memory: sourceInstance.memory,
      disk: sourceInstance.disk,
      networkMode: sourceInstance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      snapshotSpecs,
      sshPort: 22,  // SSH 端口固定为 22
      rootPassword: sourceInstance.root_password, // 复制密码
      monthlyTrafficLimit,
      // 复制配额限制
      portLimit: sourceInstance.port_limit,
      snapshotLimit: sourceInstance.snapshot_limit,
      backupLimit: sourceInstance.backup_limit,
      siteLimit: sourceInstance.site_limit,
      swapEnabled: sourceInstance.swap_enabled === true,
      swapSize: sourceInstance.swap_size ?? null
    })

    // 8. 创建端口映射记录
    for (const mapping of newPortMappings) {
      await db.createPortMapping({
        instanceId: newInstanceId,
        hostId: sourceInstance.host_id,
        protocol: mapping.protocol,
        publicPort: mapping.publicPort,
        privatePort: mapping.privatePort,
        remark: mapping.remark || undefined
      })
    }

    // 9. 创建 IP 地址记录并更新实例的 ipv4/ipv6 字段
    // 创建 IPv4 地址记录
    if (newIPv4) {
      await db.createIpAddress({
        address: newIPv4,
        type: 'inet4',
        isPrimary: true,
        device: 'eth0',
        instanceId: newInstanceId
      })
      // 更新实例的 ipv4 字段
      await prisma.instance.update({
        where: { id: newInstanceId },
        data: { ipv4: newIPv4 }
      })
      console.log(`[Clone] 新实例 ${newInstanceId} IPv4 已更新: ${newIPv4} (device: eth0)`)
    }

    // 创建 IPv6 地址记录
    if (newIPv6) {
      // 创建 IP 地址记录（实例已创建，可以使用有效的 instanceId）
      // 新架构: device 为 eth1
      await db.createIpAddress({
        address: newIPv6,
        type: 'inet6',
        isPrimary: true,
        device: 'eth1',
        instanceId: newInstanceId
      })
      // 更新实例的 ipv6 字段
      await prisma.instance.update({
        where: { id: newInstanceId },
        data: { ipv6: newIPv6 }
      })
      console.log(`[Clone] 新实例 ${newInstanceId} IPv6 已更新: ${newIPv6} (device: eth1)`)
    }

    // 10. 更新资源使用量
    newPortMappingsCount = newPortMappings.length
    await db.reserveResources({
      hostId: sourceInstance.host_id,
      cpu: sourceInstance.cpu,
      memory: sourceInstance.memory,
      disk: sourceInstance.disk,
      portCount: newPortMappingsCount
    })
    resourcesReserved = true

    // 11. 更新实例状态为 stopped（因为复制后默认是停止状态）
    await db.updateInstanceStatus(newInstanceId, 'stopped')

    // 更新任务记录，记录新实例ID
    await prisma.instanceTask.update({
      where: { id: task.id },
      data: { newInstanceId }
    })

    await sendNotification(task.userId, 'instance_cloned', {
      instanceName: sourceInstance.name,
      newInstanceName: newInstanceName,
      hostName: host.name
    })

    await createLog(
      task.userId,
      'instance',
      'instance.clone',
      `Cloned instance "${sourceInstance.name}" to "${newInstanceName}" [new instance ID: ${newInstanceId}]`,
      'success',
      { instanceId: newInstanceId }
    )
  } catch (error) {
    // 如果创建失败，尝试清理已创建的资源

    // 1. 清理 Incus 中的实例
    let incusCloneReleased = false
    try {
      await deleteInstance(client, newIncusId)
      console.log(`[Clone] 已清理失败的 Incus 实例: ${newIncusId}`)
      incusCloneReleased = true
    } catch (cleanupErr) {
      const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      if (cleanupMessage.includes('not found') || cleanupMessage.includes('Instance not found')) {
        incusCloneReleased = true
      } else {
        console.warn(`[Clone] 清理失败 Incus 实例失败，保留数据库记录和资源占用以便人工处理: ${newIncusId}`, cleanupErr)
      }
    }

    // 2. 只有确认 Incus 克隆实例已清理，才删除数据库记录；否则保留为 error 供人工处理。
    let cloneDbRecordRemoved = false
    let cloneDbRecordExists = false
    try {
      // 检查是否存在具有该 incusId 的实例记录
      const existingInstance = await prisma.instance.findFirst({
        where: { incusId: newIncusId }
      })
      if (existingInstance) {
        cloneDbRecordExists = true
        if (incusCloneReleased) {
          await prisma.instance.delete({
            where: { id: existingInstance.id }
          })
          cloneDbRecordRemoved = true
          console.log(`[Clone] 已清理失败的 Instance 记录: ${existingInstance.id}`)
        } else {
          await prisma.instance.update({
            where: { id: existingInstance.id },
            data: { status: 'error' }
          })
          console.warn(`[Clone] Incus 克隆实例 ${newIncusId} 未确认清理，数据库实例 ${existingInstance.id} 已标记为 error`)
        }
      }
    } catch (dbCleanupErr) {
      console.warn(`[Clone] 清理 Instance 记录失败:`, dbCleanupErr)
    }

    // 3. 只有确认远端和数据库记录都清理后，才释放已预占宿主机资源。
    if (resourcesReserved) {
      if (incusCloneReleased && (!cloneDbRecordExists || cloneDbRecordRemoved)) {
        try {
          await db.rollbackResources({
            hostId: sourceInstance.host_id,
            cpu: sourceInstance.cpu,
            memory: sourceInstance.memory,
            disk: sourceInstance.disk,
            portCount: newPortMappingsCount
          })
          console.log(`[Clone] 已回滚宿主机资源`)
        } catch (rollbackErr) {
          console.error(`[Clone] 回滚资源失败:`, rollbackErr)
        }
      } else {
        console.warn(`[Clone] 克隆实例 ${newIncusId} 未确认完全清理，暂不释放宿主机资源占用`)
      }
    }

    throw error
  }
}

/**
 * 启动 Worker
 */
export function startInstanceTaskWorker(): void {
  if (workerInterval) {
    console.warn('[InstanceTaskWorker] Worker already running')
    return
  }

  console.log('[InstanceTaskWorker] 启动 Worker...')

  // 立即清理僵尸任务
  cleanupStaleTasks().catch(err => {
    console.error('[InstanceTaskWorker] 清理僵尸任务失败:', err)
    dbBackoff.arm(err)
  })

  // 定时处理队列
  workerInterval = setInterval(() => {
    processQueue().catch(err => {
      console.error('[InstanceTaskWorker] 队列处理错误:', err)
      dbBackoff.arm(err)
    })
  }, POLL_INTERVAL)

  // 定时检查超时任务
  timeoutCheckInterval = setInterval(() => {
    cleanupTimeoutTasks().catch(err => {
      console.error('[InstanceTaskWorker] 超时检查错误:', err)
      dbBackoff.arm(err)
    })
  }, TIMEOUT_CHECK_INTERVAL)

  console.log('[InstanceTaskWorker] Worker 已启动')
}

/**
 * 停止 Worker
 */
export function stopInstanceTaskWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval)
    timeoutCheckInterval = null
  }
  console.log('[InstanceTaskWorker] Worker 已停止')
}
