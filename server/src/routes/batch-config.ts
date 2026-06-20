/**
 * 批量配置修改路由
 * 支持宿主机所有者批量修改实例配置
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { getActiveTaskForInstance } from '../db/instance-tasks.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { patchInstanceResources, getInstance, updateInstance } from '../lib/incus/incus-instances.js'
import { resolveEffectiveSwapSize, resolveIncusSwapValue } from '../lib/instance-swap.js'
import pLimit from 'p-limit'

// 每宿主机并发限制
const BATCH_CONFIG_CONCURRENCY = 10

// 可重试的错误类型
const RETRYABLE_ERRORS = [
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'context deadline exceeded',
  'timeout'
]

function isRetryableError(error: string): boolean {
  return RETRYABLE_ERRORS.some(e => error.toLowerCase().includes(e.toLowerCase()))
}

// 批量配置修改请求体类型
interface BatchConfigBody {
  instanceIds: number[]
  config: {
    // 资源配置（需要同步到 Incus）
    cpu?: number
    memory?: number
    disk?: number
    monthlyTrafficLimit?: string | null
    swapEnabled?: boolean
    swapSize?: number | null
    // 配额限制（仅数据库）
    portLimit?: number | null
    snapshotLimit?: number | null
    backupLimit?: number | null
    siteLimit?: number | null
    // 容器权限（需要同步到 Incus）
    nested?: boolean
    privileged?: boolean
    // 高级配置（需要同步到 Incus）
    limitsRead?: string | null
    limitsWrite?: string | null
    limitsReadIops?: number | null
    limitsWriteIops?: number | null
    limitsIngress?: string | null
    limitsEgress?: string | null
    limitsProcesses?: number | null
    limitsCpuPriority?: number | null
    bootAutostart?: boolean | null
    bootAutostartPriority?: number | null
    bootAutostartDelay?: number | null
    bootHostShutdownTimeout?: number | null
  }
}

interface ResolvedStorageOverrides {
  limitsRead?: string | null
  limitsWrite?: string | null
  limitsReadIops?: number | null
  limitsWriteIops?: number | null
}

// 结果项类型
interface ResultItem {
  instanceId: number
  incusId: string
  name: string
  success: boolean
  error?: string
}

export default async function batchConfigRoutes(fastify: FastifyInstance) {
  /**
   * 批量修改实例配置
   * POST /api/hosts/:id/instances/batch-config
   */
  fastify.post<{
    Params: { id: string }
    Body: BatchConfigBody
  }>('/:id/instances/batch-config', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'config'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 1000
          },
          config: {
            type: 'object',
            properties: {
              // 资源配置
              cpu: { type: 'integer', minimum: 1 },
              memory: { type: 'integer', minimum: 1 },
              disk: { type: 'number', minimum: 1 },
              monthlyTrafficLimit: { type: ['string', 'null'] },
              swapEnabled: { type: 'boolean' },
              swapSize: { type: ['integer', 'null'], minimum: 0, maximum: 1048576 },
              // 配额限制
              portLimit: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
              snapshotLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              backupLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              siteLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              // 容器权限
              nested: { type: 'boolean' },
              privileged: { type: 'boolean' },
              // 高级配置
              limitsRead: { type: ['string', 'null'] },
              limitsWrite: { type: ['string', 'null'] },
              limitsReadIops: { type: ['integer', 'null'], minimum: 0 },
              limitsWriteIops: { type: ['integer', 'null'], minimum: 0 },
              limitsIngress: { type: ['string', 'null'] },
              limitsEgress: { type: ['string', 'null'] },
              limitsProcesses: { type: ['integer', 'null'], minimum: 0 },
              limitsCpuPriority: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
              bootAutostart: { type: ['boolean', 'null'] },
              bootAutostartPriority: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
              bootAutostartDelay: { type: ['integer', 'null'], minimum: 5, maximum: 600 },
              bootHostShutdownTimeout: { type: ['integer', 'null'], minimum: 30, maximum: 600 }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: BatchConfigBody
  }>, reply: FastifyReply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds, config } = request.body
    const hostId = Number(id)

    if (isNaN(hostId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证宿主机存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或宿主机所有者可以批量修改配置
    if (user.role !== 'admin' && host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查是否有任何配置要修改
    if (Object.keys(config).length === 0) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_NO_CHANGES))
    }

    // 获取所有目标实例并验证它们属于该宿主机
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { notIn: ['deleted', 'creating'] }
      },
      include: {
        package: {
          select: {
            instanceType: true
          }
        },
        packagePlan: {
          select: {
            swapSize: true
          }
        }
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可修改的实例' })
    }

    // 判断是否需要连接 Incus
    const needsIncus = hasIncusConfig(config)
    let client = null

    if (needsIncus) {
      try {
        client = await getIncusClient(host)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        return reply.code(503).send({ error: `无法连接到宿主机: ${errorMessage}` })
      }
    }

    // 使用并发控制处理实例
    const limit = pLimit(BATCH_CONFIG_CONCURRENCY)
    const results: ResultItem[] = []
    
    // 跟踪资源变化量（用于批量完成后统一更新）
    let totalCpuDelta = 0
    let totalMemoryDelta = 0
    let totalDiskDelta = 0

    await Promise.all(
      instances.map(instance =>
        limit(async () => {
          const result = await updateSingleInstance(
            instance,
            config,
            client
          )
          results.push(result)
          
          // 累计资源变化量
          if (result.success) {
            if (config.cpu !== undefined) totalCpuDelta += config.cpu - instance.cpu
            if (config.memory !== undefined) totalMemoryDelta += config.memory - instance.memory
            if (config.disk !== undefined) totalDiskDelta += Math.round(config.disk) - instance.disk
          }

          // 如果是可重试错误，自动重试一次
          if (!result.success && result.error && isRetryableError(result.error)) {
            console.log(`[BatchConfig] Retrying instance ${instance.name} due to: ${result.error}`)
            const retryResult = await updateSingleInstance(
              instance,
              config,
              client
            )
            // 更新结果
            const idx = results.findIndex(r => r.instanceId === instance.id)
            if (idx >= 0) {
              // 如果重试成功，累计资源变化量
              if (!results[idx].success && retryResult.success) {
                if (config.cpu !== undefined) totalCpuDelta += config.cpu - instance.cpu
                if (config.memory !== undefined) totalMemoryDelta += config.memory - instance.memory
                if (config.disk !== undefined) totalDiskDelta += Math.round(config.disk) - instance.disk
              }
              results[idx] = retryResult
            }
          }
        })
      )
    )
    
    // 批量完成后，统一更新宿主机资源使用量（避免并发问题）
    if (totalCpuDelta !== 0 || totalMemoryDelta !== 0 || totalDiskDelta !== 0) {
      await db.updateHostResources(hostId, {
        cpuUsed: host.cpu_used + totalCpuDelta,
        memoryUsed: host.memory_used + totalMemoryDelta,
        diskUsed: host.disk_used + totalDiskDelta
      })
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length
    const failedItems = results.filter(r => !r.success)

    // 记录操作日志
    await createLog(
      user.id,
      'instance',
      'instance.batch_config',
      `Batch updated ${successCount} instances config on host "${host.name}", failed: ${failedCount}`,
      failedCount > 0 ? 'partial' : 'success'
    )

    return {
      success: failedCount === 0,
      totalCount: instances.length,
      successCount,
      failedCount,
      failedItems,
      // 用于重试
      retryPayload: failedCount > 0 ? {
        instanceIds: failedItems.map(i => i.instanceId),
        config
      } : undefined
    }
  })
}

/**
 * 判断配置是否需要同步到 Incus
 */
function hasIncusConfig(config: BatchConfigBody['config']): boolean {
  const incusFields = [
    'cpu', 'memory', 'disk',
    'swapEnabled', 'swapSize',
    'nested', 'privileged',
    'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
    'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
    'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
  ]
  return incusFields.some(field => config[field as keyof typeof config] !== undefined)
}

/**
 * 更新单个实例配置
 */
async function updateSingleInstance(
  instance: {
    id: number
    incusId: string
    name: string
    cpu: number
    memory: number
    disk: number
    hostId: number
    swapEnabled: boolean
    swapSize: number | null
    package: {
      instanceType: string
    } | null
    packagePlan: {
      swapSize: number
    } | null
  },
  config: BatchConfigBody['config'],
  client: Awaited<ReturnType<typeof getIncusClient>> | null
): Promise<ResultItem> {
  try {
    const activeTask = await getActiveTaskForInstance(instance.id)
    if (activeTask) {
      throw new Error(`实例存在进行中的任务: ${activeTask.taskType}`)
    }

    const hasSwapConfig = config.swapEnabled !== undefined || config.swapSize !== undefined
    const instanceKind = instance.package?.instanceType === 'vm' ? 'vm' : 'container'
    const currentSwapSize = resolveEffectiveSwapSize(instance.swapSize, instance.packagePlan?.swapSize)
    const nextSwapEnabled = config.swapEnabled ?? instance.swapEnabled
    const nextSwapSize = config.swapSize !== undefined
      ? Math.max(0, config.swapSize ?? 0)
      : currentSwapSize
    const storageOverrides = resolveStorageOverrides(config)

    if (hasSwapConfig && instanceKind === 'vm') {
      throw new Error('虚拟机不支持批量 SWAP 配置')
    }

    if (nextSwapEnabled && nextSwapSize <= 0) {
      throw new Error('启用 SWAP 前需要设置大于 0 的 SWAP 大小')
    }

    // 1. 更新资源配置（CPU、内存、磁盘）到 Incus
    if (client && (config.cpu !== undefined || config.memory !== undefined || config.disk !== undefined)) {
      await patchInstanceResources(client, instance.incusId, {
        cpu: config.cpu,
        memory: config.memory,
        disk: config.disk !== undefined ? Math.round(config.disk) : undefined
      })
    }

    // 2. 更新高级配置到 Incus
    if (client && (hasAdvancedIncusConfig(config) || hasSwapConfig)) {
      const incusConfig: Record<string, string | null> = {}
      const needsDeviceConfig =
        config.limitsRead !== undefined || config.limitsReadIops !== undefined ||
        config.limitsWrite !== undefined || config.limitsWriteIops !== undefined ||
        config.limitsIngress !== undefined || config.limitsEgress !== undefined
      let incusDevices: Record<string, Record<string, string>> | null = null

      if (hasSwapConfig) {
        incusConfig['limits.memory.swap'] = resolveIncusSwapValue(nextSwapEnabled, nextSwapSize)
      }

      // 容器权限
      if (config.nested !== undefined) {
        incusConfig['security.nesting'] = config.nested ? 'true' : 'false'
      }
      if (config.privileged !== undefined) {
        incusConfig['security.privileged'] = config.privileged ? 'true' : 'false'
      }

      // 进程限制
      if (config.limitsProcesses !== undefined && config.limitsProcesses !== null) {
        incusConfig['limits.processes'] = String(config.limitsProcesses)
      } else if (config.limitsProcesses !== undefined) {
        incusConfig['limits.processes'] = null
      }

      // CPU 优先级直接使用 Incus 原生 0-10 语义
      if (config.limitsCpuPriority !== undefined && config.limitsCpuPriority !== null) {
        incusConfig['limits.cpu.priority'] = String(config.limitsCpuPriority)
      } else if (config.limitsCpuPriority !== undefined) {
        incusConfig['limits.cpu.priority'] = null
      }

      // 启动设置
      if (config.bootAutostart !== undefined && config.bootAutostart !== null) {
        incusConfig['boot.autostart'] = config.bootAutostart ? 'true' : 'false'
      } else if (config.bootAutostart !== undefined) {
        incusConfig['boot.autostart'] = null
      }
      if (config.bootAutostartPriority !== undefined && config.bootAutostartPriority !== null) {
        incusConfig['boot.autostart.priority'] = String(config.bootAutostartPriority)
      } else if (config.bootAutostartPriority !== undefined) {
        incusConfig['boot.autostart.priority'] = null
      }
      if (config.bootAutostartDelay !== undefined && config.bootAutostartDelay !== null) {
        incusConfig['boot.autostart.delay'] = String(config.bootAutostartDelay)
      } else if (config.bootAutostartDelay !== undefined) {
        incusConfig['boot.autostart.delay'] = null
      }
      if (config.bootHostShutdownTimeout !== undefined && config.bootHostShutdownTimeout !== null) {
        incusConfig['boot.host_shutdown_timeout'] = String(config.bootHostShutdownTimeout)
      } else if (config.bootHostShutdownTimeout !== undefined) {
        incusConfig['boot.host_shutdown_timeout'] = null
      }

      if (needsDeviceConfig) {
        // 复制完整的设备列表，然后修改需要修改的设备
        const currentInstance = await getInstance(client, instance.incusId) as {
          devices?: Record<string, Record<string, string>>
        }
        incusDevices = currentInstance.devices ? JSON.parse(JSON.stringify(currentInstance.devices)) : {}
      }

      // 存储 I/O 限制 (应用到 root 设备)
      if (config.limitsRead !== undefined || config.limitsReadIops !== undefined ||
        config.limitsWrite !== undefined || config.limitsWriteIops !== undefined) {
        if (!incusDevices) {
          incusDevices = {}
        }
        if (!incusDevices['root']) {
          incusDevices['root'] = { path: '/', pool: 'default', type: 'disk' }
        }

        if (config.limitsRead !== undefined) {
          if (config.limitsRead !== null) {
            incusDevices['root']['limits.read'] = config.limitsRead
          } else {
            delete incusDevices['root']['limits.read']
          }
        } else if (config.limitsReadIops !== undefined) {
          if (config.limitsReadIops !== null) {
            incusDevices['root']['limits.read'] = `${config.limitsReadIops}iops`
          } else {
            delete incusDevices['root']['limits.read']
          }
        }

        if (config.limitsWrite !== undefined) {
          if (config.limitsWrite !== null) {
            incusDevices['root']['limits.write'] = config.limitsWrite
          } else {
            delete incusDevices['root']['limits.write']
          }
        } else if (config.limitsWriteIops !== undefined) {
          if (config.limitsWriteIops !== null) {
            incusDevices['root']['limits.write'] = `${config.limitsWriteIops}iops`
          } else {
            delete incusDevices['root']['limits.write']
          }
        }
      }

      // 网络限制 (应用到 eth0 设备)
      if (config.limitsIngress !== undefined || config.limitsEgress !== undefined) {
        // 确保 eth0 设备存在
        if (!incusDevices) {
          incusDevices = {}
        }
        if (!incusDevices['eth0']) {
          incusDevices['eth0'] = {
            type: 'nic',
            name: 'eth0',
            network: 'incusbr0'
          }
        }

        if (config.limitsIngress !== undefined) {
          if (config.limitsIngress !== null) {
            incusDevices['eth0']['limits.ingress'] = config.limitsIngress
          } else {
            delete incusDevices['eth0']['limits.ingress']
          }
        }

        if (config.limitsEgress !== undefined) {
          if (config.limitsEgress !== null) {
            incusDevices['eth0']['limits.egress'] = config.limitsEgress
          } else {
            delete incusDevices['eth0']['limits.egress']
          }
        }
      }

      // 应用更新到 Incus
      const updates: Record<string, unknown> = {}
      if (Object.keys(incusConfig).length > 0) {
        updates.config = incusConfig
      }
      if (incusDevices && Object.keys(incusDevices).length > 0) {
        updates.devices = incusDevices
      }

      if (Object.keys(updates).length > 0) {
        await updateInstance(client, instance.incusId, updates)
      }
    }

    // 3. 更新数据库中的资源配置
    if (config.cpu !== undefined || config.memory !== undefined || config.disk !== undefined || config.monthlyTrafficLimit !== undefined) {
      let trafficLimit: bigint | null | undefined = undefined
      if (config.monthlyTrafficLimit !== undefined) {
        if (config.monthlyTrafficLimit === null || config.monthlyTrafficLimit === '') {
          trafficLimit = null
        } else {
          trafficLimit = BigInt(config.monthlyTrafficLimit)
        }
      }

      await db.updateInstanceResources(instance.id, {
        cpu: config.cpu,
        memory: config.memory,
        disk: config.disk !== undefined ? Math.round(config.disk) : undefined,
        monthlyTrafficLimit: trafficLimit
      })
      // 注意：宿主机资源使用量在批量处理完成后统一更新，避免并发问题
    }

    // 4. 更新数据库中的配额限制
    if (config.portLimit !== undefined || config.snapshotLimit !== undefined ||
        config.backupLimit !== undefined || config.siteLimit !== undefined) {
      await db.updateInstanceQuota(instance.id, {
        portLimit: config.portLimit,
        snapshotLimit: config.snapshotLimit,
        backupLimit: config.backupLimit,
        siteLimit: config.siteLimit
      })
    }

    // 5. 更新数据库中的 SWAP 配置
    if (hasSwapConfig) {
      const swapUpdate: {
        swapEnabled?: boolean
        swapSize?: number | null
      } = {}

      if (config.swapEnabled !== undefined) {
        swapUpdate.swapEnabled = config.swapEnabled
      }
      if (config.swapSize !== undefined) {
        swapUpdate.swapSize = config.swapSize
      } else if (config.swapEnabled === true) {
        swapUpdate.swapSize = nextSwapSize
      }

      await db.updateInstanceSwap(instance.id, swapUpdate)
    }

    // 6. 更新数据库中的高级配置
    if (hasDbAdvancedConfig(config)) {
      await db.updateInstanceConfig(instance.id, {
        limitsRead: storageOverrides.limitsRead,
        limitsWrite: storageOverrides.limitsWrite,
        limitsReadIops: storageOverrides.limitsReadIops,
        limitsWriteIops: storageOverrides.limitsWriteIops,
        limitsIngress: config.limitsIngress,
        limitsEgress: config.limitsEgress,
        limitsProcesses: config.limitsProcesses,
        limitsCpuPriority: config.limitsCpuPriority,
        bootAutostart: config.bootAutostart,
        bootAutostartPriority: config.bootAutostartPriority,
        bootAutostartDelay: config.bootAutostartDelay,
        bootHostShutdownTimeout: config.bootHostShutdownTimeout
      })
    }

    return {
      instanceId: instance.id,
      incusId: instance.incusId,
      name: instance.name,
      success: true
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[BatchConfig] Failed to update instance ${instance.name}:`, errorMessage)
    return {
      instanceId: instance.id,
      incusId: instance.incusId,
      name: instance.name,
      success: false,
      error: errorMessage
    }
  }
}

/**
 * 判断是否有需要同步到 Incus 的高级配置
 */
function hasAdvancedIncusConfig(config: BatchConfigBody['config']): boolean {
  const advancedFields = [
    'nested', 'privileged',
    'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
    'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
    'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
  ]
  return advancedFields.some(field => config[field as keyof typeof config] !== undefined)
}

/**
 * 判断是否有需要存储到数据库的高级配置
 */
function hasDbAdvancedConfig(config: BatchConfigBody['config']): boolean {
  const dbFields = [
    'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
    'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
    'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
  ]
  return dbFields.some(field => config[field as keyof typeof config] !== undefined)
}

function resolveStorageOverrides(config: BatchConfigBody['config']): ResolvedStorageOverrides {
  const overrides: ResolvedStorageOverrides = {}

  if (config.limitsRead !== undefined) {
    overrides.limitsRead = config.limitsRead
    overrides.limitsReadIops = null
  } else if (config.limitsReadIops !== undefined) {
    overrides.limitsRead = null
    overrides.limitsReadIops = config.limitsReadIops
  }

  if (config.limitsWrite !== undefined) {
    overrides.limitsWrite = config.limitsWrite
    overrides.limitsWriteIops = null
  } else if (config.limitsWriteIops !== undefined) {
    overrides.limitsWrite = null
    overrides.limitsWriteIops = config.limitsWriteIops
  }

  return overrides
}
