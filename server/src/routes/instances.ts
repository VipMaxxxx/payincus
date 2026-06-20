/**
 * 实例管理路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { prisma } from '../db/prisma.js'
import type { InstanceStatus } from '@prisma/client'
import { getIncusClient } from '../lib/incus/index.js'
import {
  buildInstanceConfig,
  getInstanceState,
  getInstance,
  createInstance,
  startInstance,
  stopInstance,
  deleteInstance,
  updateInstance,
  addDevice,
  removeDevice,
  mapInstanceStatus,
  getTrafficCountersFromState
} from '../lib/incus/index.js'
import { deleteSnapshot } from '../lib/incus/incus-snapshots.js'
import { generateIncusConfig, generateRandomPassword } from '../lib/incus-config-generator.js'
import { encryptSensitiveData, decryptSensitiveData, validateName } from '../lib/security.js'
import {
  consumeOperationVerification
} from '../lib/operation-verification.js'
import {
  detectCloudInitStatus,
  getCachedCloudInitStatus,
  persistCloudInitStatus
} from '../lib/cloud-init-status.js'
import { customAlphabet } from 'nanoid'

// 自定义 nanoid，只使用小写字母和数字（Incus 不允许下划线）
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
import type { Host } from '../types/database.js'
import {
  getImageDisplayName,
  getSystemImageAvailabilityForHost,
  isImageCompatibleWithInstanceType,
  isImageCompatibleWithMemory,
  isValidSystemImage
} from '../db/images.js'
import { generateRandomIPv4, generateRandomIPv6 } from '../lib/ip-calculator.js'
import { getProxySitesByInstanceId, deleteProxySite } from '../db/proxy-sites.js'
import { calculateVipLevel, getVipBadgeStyleForLevel, getVipRules } from '../services/vip-levels.js'
import { ProxyStrategyFactory } from '../lib/proxy/index.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { createInstanceTask, getInstanceTaskById, getActiveTaskForInstance, getTaskQueuePosition, cancelInstanceTask } from '../db/instance-tasks.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { calculateDiscountAmount } from '../lib/billing-calc.js'
import { validateCommandsOwnership, mergeCommandContents, getImageDistroFromAlias } from '../db/custom-init-commands.js'
import { getPlanById, isPaidPackage } from '../db/package-plans.js'
import { calculateCreateBilling } from '../db/billing-operations.js'
import { getUserBalance } from '../db/balance.js'
import { selectBindableIpv4ListenAddress } from '../lib/network-address.js'
import { applyTrafficMultiplier, normalizeTrafficMultiplier, resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import {
  persistResolvedInstanceNetworkAddresses,
  resolveInstanceNetworkAddresses
} from '../lib/instance-network-sync.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'

import { resolveEffectiveSwapSize, resolveIncusSwapValue } from '../lib/instance-swap.js'

// 检查实例是否被转移锁定
async function checkTransferLock(instanceId: number, reply: FastifyReply): Promise<boolean> {
  const hasPending = await db.hasPendingTransfer(instanceId)
  if (hasPending) {
    reply.code(400).send(apiError(ErrorCode.TRANSFER_INSTANCE_LOCKED))
    return true
  }
  return false
}

async function claimInstanceForDelete(instanceId: number, currentStatus: InstanceStatus): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    if (!locked) return false

    const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
      tx.restoreTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.instanceTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeRestoreTask || activeUploadTask || activeInstanceTask) return false

    const result = await tx.instance.updateMany({
      where: {
        id: instanceId,
        status: currentStatus
      },
      data: { status: 'deleted' }
    })

    return result.count === 1
  })
}

/**
 * 检查用户对实例的操作权限
 * 权限规则：
 * 1. 管理员可以操作所有实例（拥有宿主机所有者的权限）
 * 2. 实例所有者可以操作自己创建的实例
 * 3. 节点所有者可以操作其节点上的所有实例
 * 
 * @deprecated 使用 lib/permission.ts 中的 checkInstancePermission 替代
 * 此函数保留用于向后兼容，新代码请使用统一权限模块
 */
async function checkInstanceOperationPermission(
  user: { id: number; role: string },
  instance: { user_id: number; host_id: number }
): Promise<boolean> {
  // 管理员拥有宿主机所有者的权限，可以操作所有实例
  if (user.role === 'admin') return true

  // 实例所有者有权限
  if (instance.user_id === user.id) return true

  // 检查是否是节点所有者
  const host = await db.getHostById(instance.host_id)
  if (host && host.user_id === user.id) return true

  return false
}

type ChangeHostUnavailableReason =
  | 'current_host'
  | 'host_offline'
  | 'host_type_mismatch'
  | 'cpu_full'
  | 'memory_full'
  | 'resource_unconfigured'
  | 'image_unavailable'

interface ChangeHostHostOption {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture: string
  status: string
  probeUrl: string | null
  isCurrent: boolean
  canChange: boolean
  unavailableReason: ChangeHostUnavailableReason | null
  resources: {
    cpuUsed: number
    cpuAllowanceMax: number
    cpuAvailable: number
    memoryUsed: number
    memoryMax: number
    memoryAvailable: number
  }
  trafficMultiplier: number
  effectiveTrafficLimit: string | null
}

interface ChangeHostOptionsResponse {
  packageId: number | null
  packageName: string | null
  currentHostId: number
  required: {
    cpu: number
    memory: number
  }
  hosts: ChangeHostHostOption[]
  sshKeys: Array<{
    id: number
    name: string
    fingerprint: string | null
  }>
  canChangeHost: boolean
  unavailableReason?: 'no_package' | 'single_host' | 'no_ssh_key'
}

function isHostCompatibleWithPackageInstanceType(
  hostInstanceType: string | null | undefined,
  packageInstanceType: 'container' | 'vm'
): boolean {
  const type = hostInstanceType || 'container'
  if (packageInstanceType === 'vm') return type === 'vm' || type === 'both'
  return type === 'container' || type === 'both'
}

async function buildChangeHostOptions(instance: {
  id: number
  user_id: number
  host_id: number
  package_id: number | null
  image: string
  cpu: number
  memory: number
  package_plan_id?: number | null
}): Promise<ChangeHostOptionsResponse> {
  const sshKeys = await db.getSSHKeysByUserId(instance.user_id)

  const baseResponse = {
    packageId: null,
    packageName: null,
    currentHostId: instance.host_id,
    required: {
      cpu: instance.cpu,
      memory: instance.memory
    },
    hosts: [],
    sshKeys: sshKeys.map(key => ({
      id: key.id,
      name: key.name,
      fingerprint: key.fingerprint ?? null
    })),
    canChangeHost: false
  } satisfies ChangeHostOptionsResponse

  if (!instance.package_id) {
    return { ...baseResponse, unavailableReason: 'no_package' }
  }

  const pkg = await db.getPackageById(instance.package_id)
  if (!pkg) {
    return { ...baseResponse, unavailableReason: 'no_package' }
  }

  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId: instance.package_id },
    select: {
      hostId: true,
      trafficMultiplier: true,
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          architecture: true,
          status: true,
          cpuUsed: true,
          cpuAllowanceMax: true,
          memoryUsed: true,
          memoryMax: true,
          instanceType: true,
          probeUrl: true
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  const hostIds = packageHosts.map(binding => binding.hostId)
  if (hostIds.length === 0) {
    return {
      ...baseResponse,
      packageId: pkg.id,
      packageName: pkg.name,
      unavailableReason: 'single_host'
    }
  }

  const resourceRows = await prisma.instance.groupBy({
    by: ['hostId'],
    where: {
      hostId: { in: hostIds },
      status: { not: 'deleted' }
    },
    _sum: {
      cpu: true,
      memory: true
    }
  })

  const resourceByHostId = new Map(resourceRows.map(row => [
    row.hostId,
    {
      cpuUsed: row._sum.cpu ?? 0,
      memoryUsed: row._sum.memory ?? 0
    }
  ]))

  const packageInstanceType = ((pkg as { instance_type?: 'container' | 'vm' }).instance_type || 'container')
  let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
  if (instance.package_plan_id) {
    const plan = await getPlanById(instance.package_plan_id)
    if (plan && plan.packageId === instance.package_id) {
      baseTrafficLimit = plan.trafficLimit
    }
  }

  const hosts = await Promise.all(packageHosts.map(async binding => {
    const host = binding.host
    const used = resourceByHostId.get(host.id) || { cpuUsed: 0, memoryUsed: 0 }
    const cpuUsed = Math.max(used.cpuUsed, host.cpuUsed || 0)
    const memoryUsed = Math.max(used.memoryUsed, host.memoryUsed || 0)
    const cpuAllowanceMax = host.cpuAllowanceMax || 0
    const memoryMax = host.memoryMax || 0
    const cpuAvailable = cpuAllowanceMax > 0 ? Math.max(0, cpuAllowanceMax - cpuUsed) : 0
    const memoryAvailable = memoryMax > 0 ? Math.max(0, memoryMax - memoryUsed) : 0
    const isCurrent = host.id === instance.host_id

    let unavailableReason: ChangeHostUnavailableReason | null = null
    if (isCurrent) {
      unavailableReason = 'current_host'
    } else if (host.status !== 'online') {
      unavailableReason = 'host_offline'
    } else if (!isHostCompatibleWithPackageInstanceType(host.instanceType, packageInstanceType)) {
      unavailableReason = 'host_type_mismatch'
    } else if (cpuAllowanceMax <= 0 || memoryMax <= 0) {
      unavailableReason = 'resource_unconfigured'
    } else if (cpuAvailable < instance.cpu) {
      unavailableReason = 'cpu_full'
    } else if (memoryAvailable < instance.memory) {
      unavailableReason = 'memory_full'
    } else {
      const imageAvailability = await getSystemImageAvailabilityForHost(instance.image, host.id, {
        instanceType: packageInstanceType,
        memory: instance.memory
      })
      if (!imageAvailability.ok) {
        unavailableReason = 'image_unavailable'
      }
    }

    return {
      id: host.id,
      name: host.name,
      location: host.location,
      countryCode: host.countryCode || 'us',
      architecture: host.architecture || 'x86_64',
      status: host.status,
      probeUrl: host.probeUrl || null,
      isCurrent,
      canChange: unavailableReason === null,
      unavailableReason,
      resources: {
        cpuUsed,
        cpuAllowanceMax,
        cpuAvailable,
        memoryUsed,
        memoryMax,
        memoryAvailable
      },
      trafficMultiplier: normalizeTrafficMultiplier(binding.trafficMultiplier),
      effectiveTrafficLimit: applyTrafficMultiplier(baseTrafficLimit, binding.trafficMultiplier)?.toString() ?? null
    } satisfies ChangeHostHostOption
  }))

  const hasTarget = hosts.some(host => host.canChange)
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    currentHostId: instance.host_id,
    required: {
      cpu: instance.cpu,
      memory: instance.memory
    },
    hosts: hosts.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      if (a.canChange !== b.canChange) return a.canChange ? -1 : 1
      return a.name.localeCompare(b.name)
    }),
    sshKeys: baseResponse.sshKeys,
    canChangeHost: hasTarget && sshKeys.length > 0,
    unavailableReason: hostIds.length <= 1
      ? 'single_host'
      : (sshKeys.length === 0 ? 'no_ssh_key' : undefined)
  }
}

export default async function instanceRoutes(fastify: FastifyInstance) {
  // 获取实例列表（支持分页和搜索）
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      userId?: string
      hostId?: string
      countryCode?: string
      status?: string
      sortBy?: string
      sortOrder?: string
    }
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      userId?: string
      hostId?: string
      countryCode?: string
      status?: string
      sortBy?: string
      sortOrder?: string
    }
  }>) => {
    const { user } = request
    const { page = '1', pageSize = '20', search = '', hostId, countryCode, status, sortBy, sortOrder } = request.query

    const options: {
      page: number
      pageSize: number
      search: string
      status?: string
      userId?: number
      hostId?: number
      countryCode?: string
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
    } = {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      search,
      status,
      sortBy,
      sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined
    }

    if (countryCode) {
      options.countryCode = countryCode.toLowerCase()
    }

    // 检查查询权限
    const { userId: queryUserId } = request.query

    // 标记是否应该显示用户信息（节点所有者或管理员查询时）
    let showUserInfo = false

    // 管理员可以查看所有实例
    if (user.role === 'admin') {
      showUserInfo = true
      if (queryUserId) {
        options.userId = parseInt(queryUserId, 10)
      }
      if (hostId) {
        options.hostId = parseInt(hostId, 10)
      }
      // 管理员不指定 userId 和 hostId 时可以看所有实例
    } else if (hostId) {
      // 检查是否是节点所有者查看自己节点上的实例
      options.hostId = parseInt(hostId, 10)
      const host = await db.getHostById(options.hostId)
      if (host && host.user_id === user.id) {
        // 节点所有者可以看到该节点上所有实例，不限制 userId
        showUserInfo = true
      } else {
        // 非节点所有者，只能看自己的实例
        options.userId = user.id
      }
    } else {
      // 没有指定 hostId 时，普通用户只能看自己的实例
      options.userId = user.id
    }

    const result = await db.getInstancesPaginated(options)

    return {
      instances: result.items.map((i: unknown) => {
        const instance = i as {
          id: number
          name: string
          incus_id: string | null
          status: string
          image: string
          image_name: string | null
          cpu: number
          memory: number
          disk: number
          ipv4: string | null
          ipv6: string | null
          host_name: string | null
          host_id: number
          host_country_code: string | null
          host_nat_public_ip: string | null
          host_ip_address: string | null
          network_mode: string
          username: string | null
          user_email: string | null
          user_avatar_style: string | null
          user_avatar_badge_id: string | null
          user_id: number
          display_order: number
          created_at: string
          expires_at: string | null
          auto_renew?: boolean
          package_name: string | null
          package_plan_id: number | null
          icon_badge_id: string | null
          billing_price: number | null
          monthly_traffic_limit: string | null
          monthly_traffic_used: string
          allow_instance_deletion: boolean
          port_limit: number | null
          snapshot_limit: number | null
          backup_limit: number | null
          site_limit: number | null
          package_instance_type: 'container' | 'vm' | 'both'
        }
        const response: {
          id: number
          name: string
          incusId: string | null
          status: string
          image: string
          imageName?: string | null
          cpu: number
          memory: number
          disk: number
          ipv4: string | null
          ipv6: string | null
          host: { name: string; country_code: string; nat_public_ip?: string | null; ip_address?: string | null }
          hostCountryCode: string
          networkMode: string
          natPublicIp?: string | null
          hostNatPublicIpv6?: string | null
          hostIpv6Gateway?: string | null
          hostIpAddress?: string | null
          createdAt: string
          expiresAt?: string | null
          expires_at?: string | null
          autoRenew?: boolean
          username?: string | null
          userEmail?: string | null
          userAvatarStyle?: string | null
          userId?: number
          hostId?: number
          packageName?: string | null
          packagePlanId?: number | null
          billingPrice?: number | null
          monthlyTrafficLimit?: string | null
          monthlyTrafficUsed?: string
          allow_instance_deletion?: boolean
          portLimit?: number | null
          snapshotLimit?: number | null
          backupLimit?: number | null
          siteLimit?: number | null
          instanceType?: 'container' | 'vm'
          iconBadgeId?: string | null
          userAvatarBadgeId?: string | null
          displayOrder?: number
        } = {
          id: instance.id,
          name: instance.name,
          incusId: instance.incus_id,
          status: instance.status,
          image: instance.image,
          imageName: instance.image_name || null,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          ipv4: instance.ipv4,
          ipv6: instance.ipv6,
          host: {
            name: instance.host_name || 'unknown',
            country_code: instance.host_country_code || 'us',
            nat_public_ip: instance.host_nat_public_ip || null,
            ip_address: instance.host_ip_address || null
          },
          hostCountryCode: instance.host_country_code || 'us',
          networkMode: instance.network_mode,
          natPublicIp: instance.host_nat_public_ip || null,
          hostNatPublicIpv6: (instance as any).host_nat_public_ipv6 || null,
          hostIpv6Gateway: (instance as any).host_ipv6_gateway || null,
          hostIpAddress: instance.host_ip_address || null,
          displayOrder: instance.display_order ?? 0,
          createdAt: instance.created_at,
          expiresAt: instance.expires_at,
          expires_at: instance.expires_at,
          autoRenew: instance.auto_renew ?? false,
          iconBadgeId: (instance as { icon_badge_id?: string | null }).icon_badge_id ?? null,
          packageName: instance.package_name || null,
          packagePlanId: instance.package_plan_id || null,
          billingPrice: instance.billing_price || null,
          monthlyTrafficLimit: instance.monthly_traffic_limit || null,
          monthlyTrafficUsed: instance.monthly_traffic_used || '0',
          allow_instance_deletion: instance.allow_instance_deletion,
          portLimit: instance.port_limit,
          snapshotLimit: instance.snapshot_limit,
          backupLimit: instance.backup_limit,
          siteLimit: instance.site_limit,
          // 实例类型：从套餐获取，默认为 container
          instanceType: instance.package_instance_type === 'vm' ? 'vm' : 'container'
        }

        // Include user information for host owner or admin query
        if (showUserInfo) {
          response.username = instance.username
          response.userEmail = instance.user_email
          response.userAvatarStyle = instance.user_avatar_style
          response.userAvatarBadgeId = (instance as { user_avatar_badge_id?: string | null }).user_avatar_badge_id ?? null
          response.userId = instance.user_id
          response.hostId = instance.host_id
        }

        return response
      }),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      availableCountries: result.availableCountries
    }
  })

  // 调整我的实例显示顺序。只允许实例所有者调整自己的列表顺序。
  fastify.patch<{
    Params: { id: string }
    Body: {
      action: 'top' | 'up' | 'down' | 'bottom'
    }
  }>('/:id/order', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[0-9]+$' }
        },
        additionalProperties: false
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['top', 'up', 'down', 'bottom'] }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const instanceId = parseInt(request.params.id, 10)
    if (!Number.isInteger(instanceId) || instanceId <= 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await prisma.$transaction(async tx => {
      const orderedInstances = await tx.instance.findMany({
        where: {
          userId: request.user.id,
          status: { not: 'deleted' }
        },
        orderBy: [
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
          { id: 'asc' }
        ],
        select: { id: true }
      })

      const currentIndex = orderedInstances.findIndex(instance => instance.id === instanceId)
      if (currentIndex < 0) {
        return null
      }

      let targetIndex = currentIndex
      if (request.body.action === 'top') targetIndex = 0
      else if (request.body.action === 'up') targetIndex = currentIndex - 1
      else if (request.body.action === 'down') targetIndex = currentIndex + 1
      else targetIndex = orderedInstances.length - 1

      targetIndex = Math.max(0, Math.min(targetIndex, orderedInstances.length - 1))
      if (targetIndex === currentIndex) {
        return { updated: 0 }
      }

      const nextOrder = [...orderedInstances]
      const [moved] = nextOrder.splice(currentIndex, 1)
      if (!moved) {
        return { updated: 0 }
      }
      nextOrder.splice(targetIndex, 0, moved)

      await Promise.all(nextOrder.map((instance, index) => tx.instance.update({
        where: { id: instance.id },
        data: { displayOrder: index * 1000 }
      })))

      return { updated: nextOrder.length }
    })

    if (result === null) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    return {
      message: 'Instance order updated',
      updated: result.updated
    }
  })

  // 获取可用宿主机列表（用于创建实例时选择）
  // 根据套餐所有权返回对应的节点：
  // - 自己的套餐：返回自己的节点（完整信息）
  // - 共享的套餐：返回套餐所有者的节点（部分信息）
  // - 管理员：可以访问所有套餐的宿主机
  fastify.get<{
    Querystring: {
      packageId?: string
      planId?: string
      cpu?: string
      memory?: string
      disk?: string
    }
  }>('/available-hosts', {
    // 使用 authenticate 而非 authenticateUser，因为管理员后台也需要调用此接口
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      packageId?: string
      planId?: string
      cpu?: string
      memory?: string
      disk?: string
    }
  }>, reply) => {
    const { packageId, planId, cpu = '15', memory = '128', disk = '512' } = request.query
    const { user } = request
    const isAdmin = user.role === 'admin'

    let packageOwnerId: number | undefined = undefined

    // 必须指定套餐
    if (!packageId) {
      return reply.code(400).send({ error: 'Package ID is required' })
    }

    const packageIdNum = Number(packageId)
    if (!Number.isInteger(packageIdNum) || packageIdNum <= 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let planIdNum: number | null = null
    if (planId !== undefined) {
      planIdNum = Number(planId)
      if (!Number.isInteger(planIdNum) || planIdNum <= 0) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }
    }

    const pkg = await db.getPackageById(packageIdNum)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    // 检查用户是否有权使用该套餐（管理员可以访问所有套餐）
    if (!isAdmin) {
      const canAccess = await db.canUserAccessPackage(user.id, packageIdNum)
      if (!canAccess) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
    }

    // 获取套餐绑定的宿主机ID列表
    const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
    // 套餐必须至少绑定一个宿主机
    if (packageHostIds.length === 0) {
      return reply.code(400).send({ error: 'Package must bind at least one host', code: 'PACKAGE_NO_HOSTS' })
    }

    // 判断是自己的套餐还是共享的套餐
    if (pkg.user_id !== user.id) {
      // 共享的套餐，返回套餐所有者的节点
      packageOwnerId = pkg.user_id!
    }

    const hosts = await db.getAvailableHosts(
      packageHostIds.length > 0 ? packageHostIds : null,
      parseInt(cpu, 10),
      parseInt(memory, 10),
      parseInt(disk, 10),
      {
        userId: user.id,
        packageOwnerId
      }
    )

    let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
    if (planIdNum !== null) {
      const selectedPlan = await getPlanById(planIdNum)
      if (selectedPlan && selectedPlan.packageId === packageIdNum) {
        baseTrafficLimit = selectedPlan.trafficLimit
      }
    }
    const hostTrafficMultipliers = (pkg as { host_traffic_multipliers?: Record<string, number> }).host_traffic_multipliers || {}

    return {
      hosts: hosts.map((h: unknown) => {
        const host = h as {
          id: number
          user_id: number
          owner_username: string | null
          is_own: boolean
          name: string
          location: string | null
          country_code: string | null
          architecture?: 'x86_64' | 'aarch64'
          cpu_used: number
          cpu_allowance_max?: number
          memory_used: number
          memory_max?: number
          disk_used: number
          storage_size?: number
          probe_url?: string | null
        }
        // 计算CPU额配可用量
        // 只使用用户配置的配额，不使用物理资源
        const cpuAllowanceMax = host.cpu_allowance_max || 0
        const cpuUsed = host.cpu_used || 0
        // 如果设置了CPU配额则使用配额，否则可用量为0（必须设置配额）
        const effectiveCpuMax = cpuAllowanceMax > 0 ? cpuAllowanceMax : 0
        const cpuAvailable = Math.max(0, effectiveCpuMax - cpuUsed)

        // 计算内存可用量
        // 只使用用户配置的配额，不使用物理资源
        const memoryMax = host.memory_max || 0
        const memoryUsed = host.memory_used || 0
        // 如果设置了内存配额则使用配额，否则可用量为0（必须设置配额）
        const memoryAvailable = memoryMax > 0 ? Math.max(0, memoryMax - memoryUsed) : 0

        return {
          id: host.id,
          name: host.name,
          location: host.location,
          countryCode: host.country_code || 'us',
          architecture: host.architecture || 'x86_64',
          // 节点所有者信息
          ownerId: host.user_id,
          ownerUsername: host.owner_username,
          isOwn: host.is_own,
          resources: {
            cpuUsed: cpuUsed,
            cpuAllowanceMax: cpuAllowanceMax,
            cpuEffectiveMax: effectiveCpuMax,
            cpuAvailable: cpuAvailable,
            memoryUsed: memoryUsed,
            memoryMax: memoryMax,
            memoryAvailable: memoryAvailable,
            diskTotal: host.storage_size ? host.storage_size * 1024 : 0, // 使用创建时输入的存储大小（GB转MB），如果没有则不可用
            diskAvailable: host.storage_size ? Math.max(0, (host.storage_size * 1024) - (host.disk_used || 0)) : 0
          },
          trafficMultiplier: normalizeTrafficMultiplier(hostTrafficMultipliers[String(host.id)] ?? 1),
          effectiveTrafficLimit: applyTrafficMultiplier(baseTrafficLimit, hostTrafficMultipliers[String(host.id)] ?? 1)?.toString() ?? null,
          probeUrl: host.probe_url || null
        }
      })
    }
  })

  /**
   * 创建实例
   * 安全措施：速率限制
   */
  fastify.post<{
    Body: {
      name: string
      packageId: number
      planId?: number  // 付费方案ID
      image: string
      cpu?: number
      memory?: number
      disk?: number
      hostId: number
      sshKeyId?: number
      sshKey?: string
      password?: string
      customInitCommandIds?: number[]  // 用户自定义初始化命令 ID 列表
      promoCode?: string  // AFF 优惠码
    }
  }>('/', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'packageId', 'image', 'hostId'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 64 },
          packageId: { type: 'integer' },
          image: { type: 'string' },
          cpu: { type: 'integer', minimum: 15, maximum: 10000 },
          memory: { type: 'integer', minimum: 128, maximum: 524288 },
          disk: { type: 'integer', minimum: 512, maximum: 104857600 },
          hostId: { type: 'integer', minimum: 1 },
          sshKeyId: { type: 'integer' },
          sshKey: { type: 'string' },
          password: { type: 'string' },
          customInitCommandIds: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
          promoCode: { type: 'string', maxLength: 32 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Body: {
      name: string
      packageId: number
      planId?: number  // 付费方案ID
      image: string
      cpu?: number
      memory?: number
      disk?: number
      hostId: number
      sshKeyId?: number
      sshKey?: string
      password?: string
      customInitCommandIds?: number[]
      promoCode?: string  // AFF 优惠码
    }
  }>, reply: FastifyReply) => {
    const { name, packageId, planId, image, cpu, memory, disk, hostId, sshKeyId, customInitCommandIds, promoCode } = request.body
    let { sshKey } = request.body
    const { user } = request

    // ==================== 阶段一: 验证与校验 ====================

    // 验证实例名称（防止危险字符注入）
    const nameValidation = validateName(name, 'Instance name', 2, 64)
    if (!nameValidation.valid) {
      return reply.code(400).send({ error: nameValidation.message })
    }

    // 0. 处理 SSH 密钥：支持 sshKeyId 或直接传 sshKey
    if (sshKeyId && !sshKey) {
      const keyRecord = await db.getSSHKeyById(sshKeyId)
      if (!keyRecord || keyRecord.user_id !== user.id) {
        return reply.code(400).send(apiError(ErrorCode.SSH_KEY_NOT_OWNED))
      }
      sshKey = keyRecord.public_key
    }

    // 1. 验证套餐是否存在且可用
    const pkg = await db.getPackageById(packageId)
    if (!pkg || !pkg.active) {
      return reply.code(400).send(apiError(ErrorCode.PACKAGE_UNAVAILABLE))
    }

    // 1.1 检查用户是否有权使用该套餐（自己的套餐或共享给自己的套餐）
    const canAccessPackage = await db.canUserAccessPackage(user.id, packageId)
    if (!canAccessPackage) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const requiredPackageId = (pkg as typeof pkg & { required_package_id?: number | null }).required_package_id ?? null
    if (requiredPackageId !== null) {
      const hasRequiredPackageInstance = await db.userHasNormalInstanceForPackage(user.id, requiredPackageId)
      if (!hasRequiredPackageInstance) {
        const requiredPackageName = (pkg as typeof pkg & { required_package_name?: string | null }).required_package_name || `#${requiredPackageId}`
        return reply.code(400).send(apiError(
          ErrorCode.PACKAGE_PREREQUISITE_MISSING,
          `必须持有 ${requiredPackageName} 实例才可以开通本套餐的实例`
        ))
      }
    }

    // 1.2 如果是共享套餐，初步检查共享配额限制（快速失败）
    // 注意：完整的配额检查将在事务中进行，这里只是初步验证以减少无效请求
    const isOwnPackage = pkg.user_id === user.id
    let shareInfo: { quotaMultiplier: number | null; maxInstances: number | null } | null = null
    if (!isOwnPackage) {
      shareInfo = await db.getPackageShareForUser(packageId, user.id)
      if (shareInfo) {
        // 初步检查：maxInstances = 0 表示不允许创建实例
        if (shareInfo.maxInstances === 0) {
          return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_INSTANCES_EXCEEDED,
            '该套餐的实例数量限制为 0，不允许创建实例'))
        }

        // 获取已使用的配额（初步检查，完整检查在事务中）
        const usage = await db.getSharedPackageUsage(packageId, user.id)

        // 检查实例数量限制（排除 0，因为已经在上面检查了）
        if (shareInfo.maxInstances !== null && shareInfo.maxInstances > 0 && usage.instanceCount >= shareInfo.maxInstances) {
          return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_INSTANCES_EXCEEDED,
            `已开通 ${usage.instanceCount}/${shareInfo.maxInstances} 台`))
        }

        // 检查 CPU/内存配额限制
        if (shareInfo.quotaMultiplier !== null) {
          const maxCpu = Math.floor(pkg.cpu_max * shareInfo.quotaMultiplier)
          const maxMemory = Math.floor(pkg.memory_max * shareInfo.quotaMultiplier)
          const requestedCpuCheck = cpu || 15
          const requestedMemoryCheck = memory || 128

          if (usage.totalCpu + requestedCpuCheck > maxCpu) {
            return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_CPU_EXCEEDED,
              `已使用 ${usage.totalCpu}%，限额 ${maxCpu}%`))
          }

          if (usage.totalMemory + requestedMemoryCheck > maxMemory) {
            return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_MEMORY_EXCEEDED,
              `已使用 ${usage.totalMemory}MB，限额 ${maxMemory}MB`))
          }
        }
      }
    }

    // 1.3 验证付费方案（如果提供了 planId）
    let selectedPlan: Awaited<ReturnType<typeof getPlanById>> = null
    const packageIsPaid = await isPaidPackage(packageId)

    // 检查是否是节点所有者在自己节点上创建免费实例（绕过付费方案检查）
    // 条件：套餐是自己的 + 指定了节点 + 该节点属于自己 + 没有提供 planId
    let isHostOwnerCreatingFree = false
    if (isOwnPackage && hostId && !planId) {
      const specifiedHost = await db.getHostById(hostId)
      if (specifiedHost && specifiedHost.user_id === user.id) {
        isHostOwnerCreatingFree = true
      }
    }

    if (packageIsPaid && !isHostOwnerCreatingFree) {
      // 付费套餐必须提供 planId（除非是节点所有者在自己节点上创建免费实例）
      if (!planId) {
        return reply.code(400).send(apiError(ErrorCode.PLAN_REQUIRED, '该套餐为付费套餐，必须选择一个方案'))
      }

      selectedPlan = await getPlanById(planId)
      if (!selectedPlan || selectedPlan.packageId !== packageId) {
        return reply.code(400).send(apiError(ErrorCode.PLAN_NOT_FOUND, '方案不存在或不属于该套餐'))
      }

      if (!selectedPlan.isActive) {
        return reply.code(400).send(apiError(ErrorCode.PLAN_INACTIVE, '方案已下架'))
      }
      if (selectedPlan.isSoldOut) {
        return reply.code(400).send(apiError(ErrorCode.PLAN_SOLD_OUT, '方案已售罄'))
      }
    } else if (planId && !isHostOwnerCreatingFree) {
      // 免费套餐不应该提供 planId
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '该套餐为免费套餐，不需要选择方案'))
    }

    // 1.3.1 禁止用户自己开通自己的付费套餐
    // 规则：套餐是自己的 + 套餐是付费的 + 不是节点所有者在自己节点上创建免费实例
    if (isOwnPackage && packageIsPaid && !isHostOwnerCreatingFree) {
      return reply.code(400).send(apiError(ErrorCode.CANNOT_CREATE_OWN_PAID_PACKAGE, '不能使用自己的付费套餐创建实例'))
    }

    // 1.4 计算费用并验证余额（付费方案）
    let billing: ReturnType<typeof calculateCreateBilling> | null = null
    let validatedAffCode: { id: number; userId: number; discountRate: number } | null = null
    let discountAmount = 0
    let finalPrice = 0
    let actualPrice = 0

    if (selectedPlan) {
      billing = calculateCreateBilling(selectedPlan)
      finalPrice = billing.totalPrice
      actualPrice = billing.totalPrice

      // 1.4.1 如果提供了优惠码，验证并计算折扣
      if (promoCode && promoCode.trim()) {
        const validation = await db.validateAffCode(promoCode.trim(), selectedPlan.id, user.id)
        if (!validation.valid) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, validation.error || '优惠码无效'))
        }
        validatedAffCode = {
          id: validation.affCode!.id,
          userId: validation.affCode!.userId,
          discountRate: validation.discountRate!
        }
        // 计算折扣金额（折扣应用于方案价格）
        discountAmount = calculateDiscountAmount(billing.price, validatedAffCode.discountRate)
        finalPrice = Number((billing.totalPrice - discountAmount).toFixed(2))
        actualPrice = finalPrice
      }

      const userBalance = await getUserBalance(user.id)
      if (userBalance < actualPrice) {
        return reply.code(400).send(apiError(ErrorCode.BALANCE_INSUFFICIENT,
          `余额不足，需要 ¥${actualPrice.toFixed(2)}，当前余额 ¥${userBalance.toFixed(2)}`))
      }
    }

    // 2. 确定请求的资源
    // 如果是付费方案，使用方案的固定资源配置
    // 如果是免费套餐，使用用户请求的资源或默认值
    const requestedCpu = selectedPlan ? selectedPlan.cpu : (cpu || 15)
    const requestedMemory = selectedPlan ? selectedPlan.memory : (memory || 128)
    const requestedDisk = selectedPlan ? selectedPlan.disk : (disk || 512)

    // 注意：能否开通实例只跟宿主机的资源有关，不检查套餐包资源限制
    // 宿主机资源检查在 selectAvailableHost 中进行

    // 3. 验证认证方式（必须提供 SSH 公钥）
    // 注意：不再限制用户的实例配额，用户可以创建无限数量的实例
    if (!sshKey) {
      return reply.code(400).send(apiError(ErrorCode.SSH_KEY_REQUIRED))
    }

    // 5. 验证镜像是否在预设列表中
    if (!await isValidSystemImage(image)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
    }

    // 5.1 验证镜像类型与套餐类型的兼容性（安全验证）
    const pkgInstanceType = (pkg as typeof pkg & { instance_type?: 'container' | 'vm' }).instance_type || 'container'
    if (!await isImageCompatibleWithInstanceType(image, pkgInstanceType)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_TYPE_MISMATCH))
    }

    // 5.2 验证镜像与内存配置的兼容性（128MB 只允许 Alpine/Debian）
    if (!await isImageCompatibleWithMemory(image, requestedMemory)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
    }

    // 6. 镜像别名（直接使用远程别名，Incus 会自动下载）
    const imageAlias = image

    // ==================== 阶段二: 智能调度（预筛选，快速失败） ====================

    console.log(`\n========== Instance Scheduling ==========`)
    console.log(`Package: ${pkg.name} (ID: ${pkg.id})`)
    const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
    console.log(`Package bound hosts: ${packageHostIds.length > 0 ? packageHostIds.join(', ') : 'all owner hosts'}`)
    console.log(`Requested resources: CPU=${requestedCpu}%, Memory=${requestedMemory}MB, Disk=${requestedDisk}MB`)
    console.log(`User specified host: ${hostId}`)

    // 先获取所有节点，用于调试
    const allHosts = await db.getAllHosts()
    console.log(`\nTotal ${allHosts.length} hosts in system`)
    for (const h of allHosts) {
      const hostWithExtras = h as Host & { cpu_allowance_max?: number; memory_max?: number; storage_size?: number }
      console.log(`  - ${h.name}: status=${h.status}`)
      console.log(`    资源: cpu_used=${h.cpu_used}, cpu_allowance_max=${hostWithExtras.cpu_allowance_max || 0}`)
      console.log(`          mem_used=${h.memory_used}, memory_max=${hostWithExtras.memory_max || 0}`)
      console.log(`          storage_size=${hostWithExtras.storage_size || 0}GB, disk_used=${h.disk_used}MB`)
    }

    // 选择最佳宿主机（预筛选，用于快速失败和获取候选宿主机信息）
    // 注意：这里只是预检查，实际的资源预占在事务中完成
    // 安全：必须传入套餐所有者ID，确保实例只能创建在套餐所有者的宿主机上
    const pkgWithExtras = pkg as typeof pkg & { node_selectors?: string }
    const preCheckHost = await db.selectAvailableHost({
      packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
      nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
      cpu: requestedCpu,
      memory: requestedMemory,
      disk: requestedDisk,
      hostId: hostId,
      ownerId: pkg.user_id!  // 套餐所有者ID，限制只能在其宿主机上创建实例
    })

    console.log(`Pre-check result: ${preCheckHost ? preCheckHost.name : 'No available host'}`)
    console.log(`========================================\n`)

    if (!preCheckHost) {
      return reply.code(400).send(apiError(ErrorCode.HOST_UNAVAILABLE))
    }

    // 校验套餐实例类型与节点支持的类型是否兼容
    // 套餐: container/vm, 节点: container/vm/both
    // pkgInstanceType 已在前面定义（镜像类型验证时）
    const hostInstanceType = preCheckHost.instance_type || 'container'
    // 套餐实例类型只能是 container 或 vm，直接使用
    const effectiveInstanceType = pkgInstanceType

    if (effectiveInstanceType === 'vm' && hostInstanceType === 'container') {
      // 套餐要求 VM，但节点只支持容器
      return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
    }
    if (effectiveInstanceType === 'container' && hostInstanceType === 'vm') {
      // 套餐要求容器，但节点只支持 VM
      return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
    }
    // 节点是 'both' 时，任何套餐类型都兼容

    const hostImageAvailability = await getSystemImageAvailabilityForHost(imageAlias, preCheckHost.id, {
      instanceType: effectiveInstanceType,
      memory: requestedMemory
    })
    if (!hostImageAvailability.ok) {
      switch (hostImageAvailability.reason) {
        case 'host_not_found':
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        case 'image_not_found':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
        case 'memory_incompatible':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
        case 'instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_TYPE_MISMATCH))
        case 'host_instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
        default:
          return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_UNAVAILABLE))
      }
    }

    // 用户托管节点不允许使用优惠码（托管节点命名前四位固定为 peer）
    if (validatedAffCode && preCheckHost.name.toLowerCase().startsWith('peer')) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, '用户托管节点不支持使用优惠码'))
    }

    // 镜像别名直接使用（数据库中已包含完整路径如 images:almalinux/8/cloud）
    const actualImageAlias = imageAlias

    // 获取网络模式
    const networkMode = (pkg.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    console.log(`[Provisioning] Network mode from package: ${networkMode}`)
    if (effectiveInstanceType === 'vm' && ['nat_ipv6_nat', 'ipv6_nat'].includes(networkMode)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'KVM instances do not support IPv4 NAT & IPv6 NAT or IPv6 NAT package network modes'))
    }

    // ==================== 阶段 2.5: 验证用户自定义初始化命令 =====================
    let extraShellCommands: string | undefined
    if (customInitCommandIds && customInitCommandIds.length > 0) {
      // 验证命令所有权和启用状态
      const cmdValidation = await validateCommandsOwnership(customInitCommandIds, user.id)
      if (!cmdValidation.valid) {
        return reply.code(400).send({ error: 'Invalid custom init command IDs', code: 'INVALID_COMMAND_IDS' })
      }

      // 验证命令是否适配当前发行版
      const imageDistro = getImageDistroFromAlias(actualImageAlias)
      const compatibleCmds = cmdValidation.commands.filter(cmd => {
        return cmd.distros.includes('all') || cmd.distros.includes(imageDistro)
      })

      // 如果有不兼容的命令，跳过它们（不报错，只用兼容的）
      if (compatibleCmds.length > 0) {
        extraShellCommands = mergeCommandContents(compatibleCmds)
        console.log(`[Provisioning] 应用 ${compatibleCmds.length} 条自定义初始化命令`)
      }
    }

    // ==================== 阶段三: 生成配置 =====================
    // SSH 端口固定为 22（不再使用随机端口）
    const autoPassword = generateRandomPassword(16)
    const { configPayload, metaData } = generateIncusConfig({
      instanceName: name,
      imageAlias: actualImageAlias,
      rootPassword: autoPassword,
      sshKey: sshKey,
      networkMode,
      type: effectiveInstanceType === 'vm' ? 'virtual-machine' : 'container',
      extraShellCommands
    })

    // ==================== 阶段四: 标识符生成 ====================
    const shortId = nanoid()
    const incusId = `u${user.id}-${shortId}`

    // ==================== 阶段五: 原子性资源预占和实例创建 ====================
    // 使用带行锁的事务确保并发安全
    // 关键改进：将宿主机选择、资源预占、实例创建合并到同一个事务中

    const snapshotSpecs = {
      packageId: pkg.id,
      packageName: pkg.name,
      cpuMax: pkg.cpu_max,
      memoryMax: pkg.memory_max,
      diskMax: pkg.disk_max,
      networkMode,
      portLimit: pkgWithExtras.port_limit || 20,
      nested: Boolean(pkg.nested),
      privileged: Boolean(pkg.privileged),
      nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
      createdAt: new Date().toISOString()
    }

    // 获取套餐的流量限额
    const packageTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null

    // 从套餐继承配额值
    const pkgQuota = pkg as typeof pkg & { port_limit?: number; snapshot_limit?: number; backup_limit?: number; site_limit?: number }

    // ==================== 使用带行锁的事务确保并发安全 ====================
    const { Prisma } = await import('@prisma/client')
    let instanceId: number
    let host: Awaited<ReturnType<typeof db.selectAndReserveHostWithLock>>
    let staticIPv4: string | null = null
    let staticIPv6: string | null = null
    let selectedStoragePool: string | null = null
    let planBandwidthLimit: string | null = null  // 方案带宽限制（事务中计算）

    try {
      const result = await prisma.$transaction(async (tx) => {
        // →→→ 第一步：在事务中使用行锁选择并预占宿主机资源 ←←←
        const lockedHost = await db.selectAndReserveHostWithLock(tx, {
          packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
          nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
          cpu: requestedCpu,
          memory: requestedMemory,
          disk: requestedDisk,
          hostId: hostId,
          ownerId: pkg.user_id!,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(networkMode) ? (pkgWithExtras.port_limit || 0) : 0
        })

        if (!lockedHost) {
          throw new Error('HOST_RESOURCES_INSUFFICIENT: 宿主机资源不足或已被其他请求占用')
        }

        console.log(`[Provisioning] 宿主机资源预占成功: ${lockedHost.name}`)

        if (requiredPackageId !== null) {
          const txHasRequiredPackageInstance = await db.userHasNormalInstanceForPackage(user.id, requiredPackageId, tx as any)
          if (!txHasRequiredPackageInstance) {
            const requiredPackageName = (pkg as typeof pkg & { required_package_name?: string | null }).required_package_name || `#${requiredPackageId}`
            throw new Error(`PACKAGE_PREREQUISITE_MISSING: 必须持有 ${requiredPackageName} 实例才可以开通本套餐的实例`)
          }
        }

        // →→→ 第二步：检查共享配额限制 ←←←
        if (!isOwnPackage && shareInfo) {
          const txShareInfo = await db.getPackageShareForUser(packageId, user.id, tx as any)
          if (txShareInfo) {
            const txUsage = await db.getSharedPackageUsage(packageId, user.id, tx as any)

            if (txShareInfo.maxInstances !== null) {
              if (txShareInfo.maxInstances === 0) {
                throw new Error('SHARE_QUOTA_INSTANCES_EXCEEDED: 该套餐的实例数量限制为 0，不允许创建实例')
              }
              if (txUsage.instanceCount >= txShareInfo.maxInstances) {
                throw new Error(`SHARE_QUOTA_INSTANCES_EXCEEDED: 已开通 ${txUsage.instanceCount}/${txShareInfo.maxInstances} 台`)
              }
            }

            if (txShareInfo.quotaMultiplier !== null) {
              const maxCpu = Math.floor(pkg.cpu_max * txShareInfo.quotaMultiplier)
              const maxMemory = Math.floor(pkg.memory_max * txShareInfo.quotaMultiplier)
              const requestedCpuCheck = cpu || 15
              const requestedMemoryCheck = memory || 128

              if (txUsage.totalCpu + requestedCpuCheck > maxCpu) {
                throw new Error(`SHARE_QUOTA_CPU_EXCEEDED: 已使用 ${txUsage.totalCpu}%，限额 ${maxCpu}%`)
              }

              if (txUsage.totalMemory + requestedMemoryCheck > maxMemory) {
                throw new Error(`SHARE_QUOTA_MEMORY_EXCEEDED: 已使用 ${txUsage.totalMemory}MB，限额 ${maxMemory}MB`)
              }
            }
          }
        }

        // →→→ 第三步：如果是付费方案，扣除余额并记录日志 ←←←
        let balanceLogId: number | undefined
        if (selectedPlan && billing) {
          // 获取当前余额
          const userRecord = await tx.user.findUnique({
            where: { id: user.id },
            select: { balance: true }
          })
          if (!userRecord) {
            throw new Error('USER_NOT_FOUND: 用户不存在')
          }

          const balanceBefore = Number(userRecord.balance)
          const balanceAfter = Number((balanceBefore - actualPrice).toFixed(2))

          // 再次检查余额（事务内双重检查）
          if (balanceAfter < 0) {
            throw new Error('BALANCE_INSUFFICIENT: 余额不足')
          }

          // 扣除余额
          await tx.user.update({
            where: { id: user.id },
            data: { balance: balanceAfter }
          })

          // 记录余额日志
          const remarkText = discountAmount > 0
            ? `开通实例（${billing.billingCycle}个月）：${pkg.name} - ${selectedPlan.name}，优惠码折扣 -¥${discountAmount.toFixed(2)}`
            : `开通实例（${billing.billingCycle}个月）：${pkg.name} - ${selectedPlan.name}`

          const balanceLog = await tx.balanceLog.create({
            data: {
              userId: user.id,
              type: 'consume',
              amount: -actualPrice,
              balanceBefore,
              balanceAfter,
              remark: remarkText
            }
          })
          balanceLogId = balanceLog.id
        }

        // →→→ 第四步：创建实例记录 ←←←
        // 如果是付费方案，使用方案的配额限制；否则使用套餐配额
        // 带宽限制：付费方案优先使用方案的 trafficLimitSpeed
        let planBandwidthLimit: string | null = null
        if (selectedPlan?.trafficLimitSpeed && selectedPlan.trafficLimitSpeed !== '0') {
          const bytes = BigInt(selectedPlan.trafficLimitSpeed)
          const MB = BigInt(1024 * 1024)
          const mbps = Number(bytes / MB)
          if (mbps > 0) {
            planBandwidthLimit = `${mbps}Mbit`
          }
        }

        const baseMonthlyTrafficLimit = selectedPlan ? selectedPlan.trafficLimit : packageTrafficLimit
        const effectiveMonthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
          packageId,
          hostId: lockedHost.id,
          baseTrafficLimit: baseMonthlyTrafficLimit
        })

        const instanceQuota = selectedPlan ? {
          portLimit: selectedPlan.portLimit,
          snapshotLimit: selectedPlan.snapshotLimit,
          backupLimit: selectedPlan.backupLimit,
          siteLimit: selectedPlan.siteLimit,
          swapSize: effectiveInstanceType === 'container' ? selectedPlan.swapSize : null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: planBandwidthLimit,
          limitsEgress: planBandwidthLimit
        } : {
          portLimit: pkgQuota.port_limit ?? null,
          snapshotLimit: pkgQuota.snapshot_limit ?? null,
          backupLimit: pkgQuota.backup_limit ?? null,
          siteLimit: pkgQuota.site_limit ?? null,
          swapSize: null as number | null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: null as string | null,
          limitsEgress: null as string | null
        }

        const instance = await tx.instance.create({
          data: {
            incusId,
            name,
            userId: user.id,
            hostId: lockedHost.id,
            packageId,
            packagePlanId: selectedPlan?.id ?? null,
            image,
            cpu: requestedCpu,
            memory: requestedMemory,
            disk: requestedDisk,
            networkMode,
            snapshottedSpecs: snapshotSpecs as any,
            sshPort: metaData.sshPort,
            rootPassword: encryptSensitiveData(metaData.rootPassword),
            status: 'creating',
            monthlyTrafficLimit: instanceQuota.monthlyTrafficLimit,
            portLimit: instanceQuota.portLimit,
            snapshotLimit: instanceQuota.snapshotLimit,
            backupLimit: instanceQuota.backupLimit,
            siteLimit: instanceQuota.siteLimit,
            swapEnabled: false,
            swapSize: instanceQuota.swapSize,
            limitsIngress: instanceQuota.limitsIngress,
            limitsEgress: instanceQuota.limitsEgress,
            // 计费信息（付费方案）
            expiresAt: billing?.expiresAt ?? null,
            billingPrice: billing?.price ?? null,
            billingCycle: billing?.billingCycle ?? null,
            autoRenew: false
          }
        })

        // 更新余额日志，添加 instanceId（因为创建时实例还不存在）
        if (balanceLogId) {
          await tx.balanceLog.update({
            where: { id: balanceLogId },
            data: { instanceId: instance.id }
          })
        }

        // 如果是付费方案，创建计费记录
        if (selectedPlan && billing) {
          // 创建计费记录
          await tx.instanceBillingRecord.create({
            data: {
              instanceId: instance.id,
              userId: user.id,
              type: 'newPurchase',
              amount: actualPrice,
              months: billing.billingCycle,
              periodStart: new Date(),
              periodEnd: billing.expiresAt,
              balanceLogId,
              remark: discountAmount > 0
                ? `新开通 ${billing.billingCycle} 个月，优惠码折扣 -¥${discountAmount.toFixed(2)}`
                : `新开通 ${billing.billingCycle} 个月`
            }
          })

          // 如果使用了优惠码，创建 AFF 绑定并处理返利
          if (validatedAffCode) {
            // 创建实例与优惠码的永久绑定
            await db.createAffBinding(instance.id, validatedAffCode.id, tx as any)

            // 给优惠码创建者返利（基于原价，不是折扣后价格）
            await db.processAffCommission(
              validatedAffCode.id,
              instance.id,
              billing.price, // 原价
              'new_purchase',
              tx as any
            )
          }

          // 处理托管收入结算（用户托管节点）
          const hostingIncomeResult = await db.processHostingIncome(
            lockedHost.id,
            actualPrice,
            instance.id,
            'purchase',
            tx
          )

          return { instanceId: instance.id, host: lockedHost, hostingIncomeResult, actualPrice, planBandwidthLimit }
        }

        return { instanceId: instance.id, host: lockedHost, hostingIncomeResult: null, actualPrice: 0, planBandwidthLimit }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000  // 增加超时时间，因为包含行锁操作
      })

      instanceId = result.instanceId
      host = result.host
      planBandwidthLimit = result.planBandwidthLimit

      // 事务完成后，发送托管收入通知（仅发送到外部渠道，不创建站内信）
      if (result.hostingIncomeResult) {
        sendHostManagedInstanceNotification(
          result.host.id,
          'purchase',
          {
            username: user.username,
            instanceName: name,
            amount: result.actualPrice
          }
        ).catch(err => {
          console.error('[Provisioning] 发送托管收入通知失败:', err)
        })
      }

      // 事务完成后，向套餐绑定的通知渠道发送"新购到达"通知
      if (packageId && selectedPlan) {
        ; (async () => {
          try {
            const { sendToChannel } = await import('../lib/notifier.js')
            const globalChannel = await prisma.notificationChannel.findFirst({
              where: { isGlobal: true },
              select: { id: true }
            })
            if (globalChannel) {
              const pkgInfo = await db.getPackageById(packageId)
              const formatMem = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
              const notifyTitle = `🛒 新购到达 - ${pkgInfo?.name || 'Unknown'}`
              const notifyMessage = [
                `+${requestedCpu}% CPU / +${formatMem(requestedMemory)} 内存`,
                '',
                `⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
              ].join('\n')
              const pkgOwner = pkgInfo?.user_id
                ? await prisma.user.findUnique({ where: { id: pkgInfo.user_id }, select: { role: true } })
                : null
              const pkgSource = pkgOwner?.role === 'admin' ? 'official' : 'market'
              const buyLink = process.env.SITE_URL
                ? { label: '📦 查看套餐', url: `${process.env.SITE_URL}/instances/create?source=${pkgSource}&package=${packageId}` }
                : undefined
              await sendToChannel(globalChannel.id, notifyTitle, notifyMessage, buyLink)
            }
          } catch {
            // 通知发送失败不影响主流程
          }
        })()
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err)

      // 处理宿主机资源不足错误
      if (errorMessage.includes('HOST_RESOURCES_INSUFFICIENT')) {
        return reply.code(503).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT,
          '宿主机资源不足或已被其他请求占用，请稍后重试'))
      }

      // 处理配额检查错误
      if (errorMessage.includes('PACKAGE_PREREQUISITE_MISSING')) {
        return reply.code(400).send(apiError(ErrorCode.PACKAGE_PREREQUISITE_MISSING,
          errorMessage.replace('PACKAGE_PREREQUISITE_MISSING: ', '')))
      }
      if (errorMessage.includes('SHARE_QUOTA_INSTANCES_EXCEEDED')) {
        return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_INSTANCES_EXCEEDED,
          errorMessage.replace('SHARE_QUOTA_INSTANCES_EXCEEDED: ', '')))
      }
      if (errorMessage.includes('SHARE_QUOTA_CPU_EXCEEDED')) {
        return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_CPU_EXCEEDED,
          errorMessage.replace('SHARE_QUOTA_CPU_EXCEEDED: ', '')))
      }
      if (errorMessage.includes('SHARE_QUOTA_MEMORY_EXCEEDED')) {
        return reply.code(400).send(apiError(ErrorCode.SHARE_QUOTA_MEMORY_EXCEEDED,
          errorMessage.replace('SHARE_QUOTA_MEMORY_EXCEEDED: ', '')))
      }

      // 处理余额不足错误
      if (errorMessage.includes('BALANCE_INSUFFICIENT')) {
        return reply.code(400).send(apiError(ErrorCode.BALANCE_INSUFFICIENT, '余额不足'))
      }

      // 处理用户不存在错误
      if (errorMessage.includes('USER_NOT_FOUND')) {
        return reply.code(400).send(apiError(ErrorCode.USER_NOT_FOUND, '用户不存在'))
      }

      // 并发冲突错误
      if (err?.code === 'P2034') {
        return reply.code(409).send(apiError(ErrorCode.QUOTA_EXCEEDED,
          '资源分配时发生并发冲突，请稍后重试'))
      }

      throw err
    }

    // 事务成功后，完成 IP 分配和存储池选择（这些不需要在事务中）
    // 如果这些步骤失败，实例会处于 creating 状态，后续清理任务会处理

    // 类型断言：host 在事务成功后一定不为 null
    if (!host) {
      throw new Error('Host should not be null after successful transaction')
    }

    const hostWithIpv6 = host as typeof host & {
      ipv6_mode?: number
      ipv6_subnet?: string | null
      ipv6_gateway?: string | null
      ipv6_parent_interface?: string | null
    }
    console.log(`[Provisioning] Host IPv6 config: mode=${hostWithIpv6.ipv6_mode}, subnet=${hostWithIpv6.ipv6_subnet}, gateway=${hostWithIpv6.ipv6_gateway}, parent_interface=${hostWithIpv6.ipv6_parent_interface}`)

    // 分配 IPv4
    try {
      let attempts = 0
      const maxAttempts = 50

      while (attempts < maxAttempts) {
        staticIPv4 = generateRandomIPv4()
        // 内网 IPv4 只需在同一宿主机内唯一（不同宿主机的内网是隔离的）
        const exists = await db.isIpAddressExistsOnHost(staticIPv4, host.id)

        if (!exists) {
          console.log(`[Provisioning] 分配静态 IPv4: ${staticIPv4} (尝试次数: ${attempts + 1})`)
          break
        }

        attempts++
        staticIPv4 = null
      }

      if (!staticIPv4) {
        console.error(`[Provisioning] IPv4 分配失败（已尝试 ${maxAttempts} 次），实例将使用动态 IP`)
        // 不在这里返回错误，让实例使用动态 IP
      }
    } catch (err) {
      console.error(`[Provisioning] IPv4 分配错误:`, err)
      // 不在这里返回错误，让实例使用动态 IP
    }

    // 分配 IPv6（仅当存在 IPv6 子网配置且是 Routed 模式时，即需要独立 IPv6 地址）
    // nat_ipv6 和 ipv6_only 从子网分配独立 IPv6，nat_ipv6_nat 和 ipv6_nat 共享宿主机 IPv6
    const needsRoutedIPv6 = ['nat_ipv6', 'ipv6_only'].includes(networkMode)
    if (hostWithIpv6.ipv6_subnet && needsRoutedIPv6) {
      try {
        let attempts = 0
        const maxAttempts = 50

        while (attempts < maxAttempts) {
          staticIPv6 = generateRandomIPv6(hostWithIpv6.ipv6_subnet)
          const exists = await db.isIpAddressExists(staticIPv6)

          if (!exists) {
            console.log(`[Provisioning] 分配静态 IPv6: ${staticIPv6} (尝试次数: ${attempts + 1})`)
            break
          }

          attempts++
          staticIPv6 = null
        }

        if (!staticIPv6) {
          console.warn(`[Provisioning] IPv6 分配失败（已尝试 ${maxAttempts} 次），将使用动态分配`)
        }
      } catch (err) {
        console.warn(`[Provisioning] IPv6 分配错误，将使用动态分配:`, err)
        staticIPv6 = null
      }
    }

    console.log(`[Provisioning] IP 分配完成: IPv4=${staticIPv4}, IPv6=${staticIPv6}`)

    // VM 和容器都需要在 IP 分配完成后重新生成 cloud-init network-config
    // 确保静态 IPv4 和 IPv6 地址正确注入到 guest OS
    let finalConfigPayload = configPayload
    if (effectiveInstanceType === 'vm') {
      const { generateVmConfig } = await import('../lib/incus-config-vm.js')
      const vmResult = generateVmConfig({
        instanceName: name,
        instanceIdSeed: incusId,
        imageAlias: actualImageAlias,
        rootPassword: metaData.rootPassword,
        sshKey: sshKey,
        network: staticIPv4 ? {
          ipAddress: `${staticIPv4}/22`,
          gateway: '10.10.0.1',  // NAT 网关 (与 incusbr0 一致)
          dns: ['10.10.0.1'],
          ipv6Address: staticIPv6 ? `${staticIPv6}` : undefined,
          ipv6Gateway: staticIPv6 ? (hostWithIpv6.ipv6_gateway || undefined) : undefined
        } : undefined,
        extraShellCommands
      })
      finalConfigPayload = vmResult.configPayload
      console.log(`[Provisioning] VM network-config 已更新: IPv4=${staticIPv4 || 'dhcp'}, IPv6=${staticIPv6 || 'none'}`)
    } else if (staticIPv4) {
      // 容器类型：重新生成包含静态 IP 的 cloud-init 配置
      const containerResult = generateIncusConfig({
        instanceName: name,
        imageAlias: actualImageAlias,
        rootPassword: metaData.rootPassword,
        sshKey: sshKey,
        networkMode,
        type: 'container',
        network: {
          ipAddress: `${staticIPv4}/22`,
          gateway: '10.10.0.1',
          dns: ['10.10.0.1'],
          ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
          ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
        },
        extraShellCommands
      })
      finalConfigPayload = containerResult.configPayload
      console.log(`[Provisioning] Container network-config 已更新: IPv4=${staticIPv4}, IPv6=${staticIPv6 || 'none'}`)
    }

    // 选择存储池
    selectedStoragePool = await db.resolveStoragePoolForNewInstance(host.id, { packageId })
    if (!selectedStoragePool) {
      console.error(`[Provisioning] 宿主机 ${host.name} 没有配置系统盘存储池，将使用默认存储池`)
      selectedStoragePool = 'default'
    }
    console.log(`[Provisioning] 选择存储池: ${selectedStoragePool}`)

    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        storagePoolName: selectedStoragePool
      }
    })

    // ==================== 阶段六: 异步执行创建 ====================
    // Cast pkg to include advanced config fields
    const pkgConfig = pkg as typeof pkg & {
      io_limit_mode?: string
      limits_read?: string | null
      limits_write?: string | null
      limits_read_iops?: number | null
      limits_write_iops?: number | null
      limits_ingress?: string | null
      limits_egress?: string | null
      limits_processes?: number | null
      limits_cpu_priority?: number | null
      boot_autostart?: boolean | null
      boot_autostart_priority?: number | null
      boot_autostart_delay?: number | null
      boot_host_shutdown_timeout?: number | null
    }

    // 计算带宽限制：使用事务中计算的方案带宽限制（如果有），否则使用套餐默认值
    const effectiveBandwidthLimit = planBandwidthLimit

    // 根据 ioLimitMode 选择性传入 IO 限制参数
    const ioMode = pkgConfig.io_limit_mode || 'throughput'

    createInstanceAsync(instanceId, host, {
      name: incusId,
      image: actualImageAlias,
      cpu: requestedCpu,
      memory: requestedMemory,
      disk: requestedDisk,
      swapEnabled: false,
      swapSize: effectiveInstanceType === 'container' ? (selectedPlan?.swapSize ?? null) : null,
      cloudInitConfig: finalConfigPayload,
      networkMode,
      nested: Boolean(pkg.nested),
      privileged: Boolean(pkg.privileged),
      portLimit: pkgWithExtras.port_limit || 20,
      // 实例类型：根据套餐的实例类型决定创建容器还是虚拟机
      instanceType: effectiveInstanceType,
      // SSH 端口（固定 22）
      sshPort: metaData.sshPort,
      // 存储池配置
      storagePool: selectedStoragePool,
      // IP 配置 (新双网卡架构)
      ipv4Address: staticIPv4,
      ipv6Address: staticIPv6,
      ipv6Gateway: hostWithIpv6.ipv6_gateway || null,
      hostInterface: hostWithIpv6.ipv6_parent_interface || 'eth0',
      // Advanced configuration from package (根据 ioLimitMode 选择性传入)
      limitsRead: ioMode === 'throughput' ? pkgConfig.limits_read : null,
      limitsWrite: ioMode === 'throughput' ? pkgConfig.limits_write : null,
      limitsReadIops: ioMode === 'iops' ? pkgConfig.limits_read_iops : null,
      limitsWriteIops: ioMode === 'iops' ? pkgConfig.limits_write_iops : null,
      limitsIngress: effectiveBandwidthLimit || pkgConfig.limits_ingress,
      limitsEgress: effectiveBandwidthLimit || pkgConfig.limits_egress,
      limitsProcesses: pkgConfig.limits_processes,
      limitsCpuPriority: pkgConfig.limits_cpu_priority,
      bootAutostart: pkgConfig.boot_autostart,
      bootAutostartPriority: pkgConfig.boot_autostart_priority,
      bootAutostartDelay: pkgConfig.boot_autostart_delay,
      bootHostShutdownTimeout: pkgConfig.boot_host_shutdown_timeout
    }, user.id, { cpu: requestedCpu, memory: requestedMemory, disk: requestedDisk }).catch(err => {
      const errorMessage = err instanceof Error ? err.message : String(err)
      fastify.log.error({ err: errorMessage }, `实例 ${instanceId} 创建失败`)
    })

    reply.code(202).send({
      message: 'Instance creating, please refresh later',
      instance: {
        id: instanceId,
        name,
        incusId,
        host: host.name,
        status: 'creating',
        sshPort: metaData.sshPort,
        rootPassword: metaData.rootPassword
      }
    })
  })

  // 获取实例详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const portMappings = await db.getPortMappings(instanceId)

    const host = await db.getHostById(instance.host_id)
    const natPublicIp = host?.nat_public_ip || null
    let hostIpAddress = host?.ip_address || null
    if (!hostIpAddress && host?.url) {
      try {
        const u = new URL(host.url)
        hostIpAddress = u.hostname.replace(/^\[|\]$/g, '')
      } catch {
        // null
      }
    }
    // 对于 nat_ipv6_nat / ipv6_nat 模式，获取宿主机的公网 IPv6
    let hostIpv6Address: string | null = null
    if (['nat_ipv6_nat', 'ipv6_nat'].includes(instance.network_mode)) {
      // 0) 最高优先级：从 nat_public_ipv6 字段获取（管理员/节点所有者手动配置）
      if (host?.nat_public_ipv6) {
        hostIpv6Address = host.nat_public_ipv6
      }
      // 1) 尝试 host_ip_address 本身是否为 IPv6
      if (!hostIpv6Address && hostIpAddress && hostIpAddress.includes(':')) {
        hostIpv6Address = hostIpAddress
      }
      // 2) 尝试从 ipv6_gateway 获取
      if (!hostIpv6Address && host?.ipv6_gateway) {
        hostIpv6Address = host.ipv6_gateway
      }
      // 3) 尝试从 HostAddressAlias 表查询宿主机的 IPv6 地址
      if (!hostIpv6Address && host) {
        try {
          const ipv6Alias = await prisma.hostAddressAlias.findFirst({
            where: { hostId: host.id, kind: 'ipv6' },
            select: { address: true }
          })
          if (ipv6Alias?.address) {
            hostIpv6Address = ipv6Alias.address
          }
        } catch {
          // 忽略查询失败
        }
      }
      // 4) 尝试从 host.url 解析（如果 URL 使用 IPv6）
      if (!hostIpv6Address && host?.url) {
        try {
          const u = new URL(host.url)
          const hostname = u.hostname.replace(/^\[|\]$/g, '')
          if (hostname.includes(':')) {
            hostIpv6Address = hostname
          }
        } catch {
          // 忽略
        }
      }
    }

    // 新配额系统：端口/快照/备份/站点限制在实例级别（从套餐包获取）
    // 计算当前实例已使用的端口/快照/备份/站点数
    const currentPortCount = portMappings.length
    const currentSnapshotCount = await prisma.snapshot.count({ where: { instanceId } })
    const currentBackupCount = await prisma.backup.count({ where: { instanceId, status: { not: 'deleted' } } })
    const currentSiteCount = await prisma.proxySite.count({ where: { instanceId } })

    // 获取站点限制（实例优先，否则从套餐继承）
    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const effectiveSiteLimit = instance.site_limit ?? pkg?.site_limit ?? 10

    // 获取方案信息（付费实例）
    let planName: string | null = null
    let planPrice: number | null = null  // 方案原价（续费价格，元）
    let billingCycle: number | null = null
    let affDiscountRate: number | null = null  // AFF优惠码折扣率
    let hasAffBinding = false
    let isHostedInstance = false
    if ((instance as any).package_plan_id) {
      const plan = await prisma.packagePlan.findUnique({
        where: { id: (instance as any).package_plan_id },
        select: { name: true, price: true, billingCycle: true }
      })
      planName = plan?.name ?? null
      if (plan?.price && plan?.billingCycle) {
        // 返回方案原价（分转元）
        planPrice = Number(plan.price) / 100
        billingCycle = plan.billingCycle
      }

      // 查询 AFF 绑定，获取折扣率
      const affBinding = await db.getInstanceAffBinding(instanceId)
      if (affBinding) {
        hasAffBinding = true
        affDiscountRate = Number(affBinding.affCode.discountRate)
      }
    }

    isHostedInstance = Boolean(host?.name.toLowerCase().startsWith('peer'))

    const effectivePortLimit = instance.port_limit ?? 20
    const effectiveSnapshotLimit = instance.snapshot_limit ?? 5
    const effectiveBackupLimit = instance.backup_limit ?? 3
    const quotaUsage = {
      port: currentPortCount,
      snapshot: currentSnapshotCount,
      backup: currentBackupCount,
      site: currentSiteCount
    }
    const effectiveQuotaLimit = {
      port: effectivePortLimit,
      snapshot: effectiveSnapshotLimit,
      backup: effectiveBackupLimit,
      site: effectiveSiteLimit
    }
    const remainingQuota = {
      port: effectivePortLimit === 0 ? 0 : Math.max(0, effectivePortLimit - currentPortCount),
      snapshot: effectiveSnapshotLimit === 0 ? 0 : Math.max(0, effectiveSnapshotLimit - currentSnapshotCount),
      backup: effectiveBackupLimit === 0 ? 0 : Math.max(0, effectiveBackupLimit - currentBackupCount),
      // site limit = 0 表示不限制，这里返回 0 作为 sentinel
      site: effectiveSiteLimit === 0 ? 0 : Math.max(0, effectiveSiteLimit - currentSiteCount)
    }

    // Build response based on user role
    // 获取镜像显示名称
    const imageName = await getImageDisplayName(instance.image)

    // 获取实例类型（从套餐包获取，默认为容器）
    const instanceType = (pkg as { instance_type?: 'container' | 'vm' } | null)?.instance_type || 'container'

    const response: {
      id: number
      incusId: string
      name: string
      status: string
      image: string
      imageName?: string | null
      cpu: number
      memory: number
      disk: number
      ipv4: string | null
      ipv6: string | null
      host: { name: string; country_code: string; storageDriver?: string }
      hostCountryCode: string
      network_mode: string
      instance_type: 'container' | 'vm'
      instanceType?: 'container' | 'vm'  // camelCase 别名
      iconBadgeId?: string | null
      nat_public_ip?: string | null
      ssh_port: number | null
      port_limit: number | null
      snapshot_limit: number | null
      backup_limit: number | null
      monthlyTrafficLimit?: string | null
      remaining_quota: { port: number; snapshot: number; backup: number; site: number } | null
      quota_usage?: { port: number; snapshot: number; backup: number; site: number }
      effective_quota_limit?: { port: number; snapshot: number; backup: number; site: number }
      port_mappings: Array<{ id: number; protocol: string; public_port: number; private_port: number; remark: string | null }>
      created_at: string
      package_id: number | null
      packageName?: string | null
      packagePlanId?: number | null
      planId?: number | null  // 方案ID（用于变更方案）
      planName?: string | null
      planPrice?: number | null  // 方案月价格
      billingPrice?: number | null  // 实例专属价格（管理员设置的价格，优先于方案价格）
      billingCycle?: number | null  // 计费周期（月）
      affDiscountRate?: number | null  // AFF优惠码折扣率
      hasAffBinding?: boolean  // 是否已绑定 AFF 优惠码
      isHostedInstance?: boolean  // 是否为用户托管节点实例
      hostAnnouncement?: string | null  // 节点公告
      limitsIngress?: string | null  // 入栈带宽限制
      limitsEgress?: string | null  // 出栈带宽限制
      user_id?: number
      hostId?: number
      // 封停相关字段
      expires_at?: string | null
      suspended_at?: string | null
      suspended_by?: number | null
      suspend_reason?: string | null
      // 自动续费
      autoRenew?: boolean
      // 托管节点所有者信息（仅用户托管节点）
      hostOwnerInfo?: {
        id: number
        username: string
        email: string
        avatarStyle: string
        avatarBadgeId: string | null
        hostCount: number
        instanceCount: number
        registeredDays: number
        vipLevel: number
        vipBadgeStyle?: {
          backgroundColor: string
          textColor: string
        } | null
      } | null
    } = {
      id: instance.id,
      incusId: instance.incus_id,
      name: instance.name,
      status: instance.status,
      image: instance.image,
      imageName: imageName || null,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      ipv4: instance.ipv4,
      ipv6: instance.ipv6,
      host: {
        name: instance.host_name || 'unknown',
        country_code: instance.host_country_code || 'us',
        storageDriver: (instance as any).host_storage_driver
      },
      hostCountryCode: instance.host_country_code || 'us',
      network_mode: instance.network_mode,
      instance_type: instanceType,
      instanceType: instanceType,  // camelCase 别名，确保前后端兼容
      iconBadgeId: (instance as { icon_badge_id?: string | null }).icon_badge_id ?? null,
      ssh_port: instance.ssh_port,
      port_limit: instance.port_limit,
      snapshot_limit: instance.snapshot_limit,
      backup_limit: instance.backup_limit,
      monthlyTrafficLimit: instance.monthly_traffic_limit,
      remaining_quota: remainingQuota,
      quota_usage: quotaUsage,
      effective_quota_limit: effectiveQuotaLimit,
      port_mappings: portMappings.map((p: unknown) => {
        const mapping = p as { id: number; protocol: string; public_port: number; private_port: number; remark: string | null }
        return {
          id: mapping.id,
          protocol: mapping.protocol,
          public_port: mapping.public_port,
          private_port: mapping.private_port,
          remark: mapping.remark
        }
      }),
      created_at: instance.created_at,
      package_id: instance.package_id,
      packageName: pkg?.name || null,
      packagePlanId: (instance as any).package_plan_id ?? null,
      planId: (instance as any).package_plan_id ?? null,
      planName: planName,
      planPrice: planPrice,
      billingPrice: (instance as any).billing_price ?? null,  // 实例专属价格
      billingCycle: billingCycle,
      affDiscountRate: affDiscountRate,
      hasAffBinding,
      isHostedInstance,
      hostAnnouncement: host?.announcement || null,
      limitsIngress: (instance as any).limits_ingress ?? pkg?.limits_ingress ?? null,
      limitsEgress: (instance as any).limits_egress ?? pkg?.limits_egress ?? null,
      // 封停相关字段
      expires_at: instance.expires_at,
      suspended_at: instance.suspended_at,
      suspended_by: instance.suspended_by,
      suspend_reason: instance.suspend_reason,
      // 自动续费（仅付费实例有意义）
      autoRenew: (instance as any).auto_renew ?? false
    }

    // 用户托管节点：获取节点所有者详细信息
    if (host) {
      const hostOwner = await prisma.user.findUnique({
        where: { id: host.user_id },
        select: {
          id: true,
          username: true,
          email: true,
          avatarStyle: true,
          avatarBadgeId: true,
          createdAt: true,
          role: true
        }
      })

      isHostedInstance = isHostedInstance || hostOwner?.role === 'user'
      response.isHostedInstance = isHostedInstance

      if (hostOwner && hostOwner.role !== 'admin' && hostOwner.email) {
        const [hostCount, instanceCount, totalHostingIncome] = await Promise.all([
          // 该用户持有的托管节点数
          prisma.host.count({
            where: { userId: host.user_id }
          }),
          // 该用户托管节点的总实例数（不含已删除）
          prisma.instance.count({
            where: {
              host: { userId: host.user_id },
              status: { not: 'deleted' }
            }
          }),
          // 计算历史托管总收入（用于VIP等级）
          prisma.hostingBalanceLog.aggregate({
            where: {
              userId: host.user_id,
              type: 'income'
            },
            _sum: { amount: true }
          })
        ])

        // 计算注册天数
        const registeredDays = Math.floor((Date.now() - hostOwner.createdAt.getTime()) / (1000 * 60 * 60 * 24))
        // 计算VIP等级（基于后台配置的托管 VIP 规则）
        const totalIncome = Number(totalHostingIncome._sum.amount || 0)
        const vipRules = await getVipRules('hosting')
        const vipLevel = calculateVipLevel('hosting', vipRules, {
          totalHostingIncome: totalIncome,
          instanceCount
        })
        const vipBadgeStyle = getVipBadgeStyleForLevel(vipRules, 'hosting', vipLevel)
        response.hostOwnerInfo = {
          id: hostOwner.id,
          username: hostOwner.username,
          email: hostOwner.email,
          avatarStyle: hostOwner.avatarStyle,
          avatarBadgeId: hostOwner.avatarBadgeId,
          hostCount,
          instanceCount,
          registeredDays,
          vipLevel,
          vipBadgeStyle
        }
      }
    }

    // Check if current user is the host owner or admin
    const isHostOwner = host?.user_id === user.id
    const isAdmin = user.role === 'admin'

    // Include sensitive information for instance owner only
    if (instance.user_id === user.id) {
      // NAT public IP is needed for port mapping display
      if (natPublicIp) {
        response.nat_public_ip = natPublicIp
      }
      // 宿主机连接 IP（可能是 IPv6，用于 IPv6 NAT 模式显示）
      if (hostIpAddress) {
        ; (response as any).host_ip_address = hostIpAddress
      }
      // 宿主机公网 IPv6（用于 nat_ipv6_nat / ipv6_nat 模式显示）
      if (hostIpv6Address) {
        ; (response as any).host_ipv6_address = hostIpv6Address
      }
      // Port range for port mapping hint
      if (host?.nat_port_start && host?.nat_port_end) {
        ; (response as any).port_range_start = host.nat_port_start
          ; (response as any).port_range_end = host.nat_port_end
      }
      // Instance owner needs hostId for operations like getting available images
      response.hostId = instance.host_id
      // Instance owner can see their own user_id (it's their instance)
      response.user_id = instance.user_id
        // 实例所有者标识，用于前端控制提升进程数等操作权限
        ; (response as any).isInstanceOwner = true
    }

    // Host owner or admin can see hostId and manage advanced config
    if (isHostOwner || isAdmin) {
      response.hostId = instance.host_id
      // NAT public IP for admin/host owner
      if (natPublicIp) {
        response.nat_public_ip = natPublicIp
      }
      // 宿主机连接 IP（可能是 IPv6，用于 IPv6 NAT 模式显示）
      if (hostIpAddress) {
        ; (response as any).host_ip_address = hostIpAddress
      }
      // 宿主机公网 IPv6（用于 nat_ipv6_nat / ipv6_nat 模式显示）
      if (hostIpv6Address) {
        ; (response as any).host_ipv6_address = hostIpv6Address
      }
      // AUTH004: 节点所有者/管理员需要知道自己是否也是实例所有者，以便前端正确控制权限
      // isHostOwner: 当前用户是节点所有者或管理员
      // isInstanceOwner: 当前用户是实例所有者
      ; (response as any).isHostOwner = true
        ; (response as any).isInstanceOwner = instance.user_id === user.id
        ; (response as any).isAdmin = isAdmin
    }

    // 返回节点是否启用资源池玩法（用于前端显示兑换按钮）
    ; (response as any).enableResourcePool = host?.enable_resource_pool ?? false

    // root_password should NEVER be returned in API responses
    // It's only returned once during instance creation

    return { instance: response }
  })

  // 获取实例Root密码（实例所有者或管理员）
  fastify.get<{ Params: { id: string } }>('/:id/password', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // AUTH004: 查看密码仅限实例所有者和管理员，宿主机所有者禁止
    if (instance.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 解密并返回密码
    if (instance.root_password) {
      const decryptedPassword = decryptSensitiveData(instance.root_password)
      return {
        rootPassword: decryptedPassword
      }
    }

    return {
      rootPassword: null
    }
  })

  // 获取实例实时资源使用情况
  fastify.get<{ Params: { id: string } }>('/:id/stats', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status !== 'running') {
      return {
        stats: {
          memory: { usage: 0, limit: instance.memory, usagePercent: 0 },
          disk: { usage: 0, limit: instance.disk, usagePercent: 0 },
          network: { bytesReceived: 0, bytesSent: 0 }
        }
      }
    }

    try {
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        throw new Error('Host not found')
      }
      const client = await getIncusClient(host)

      const state = await getInstanceState(client, instance.incus_id) as {
        status?: string
        memory?: { usage?: number }
        disk?: { root?: { usage?: number } }
        network?: Record<string, {
          hwaddr?: string
          counters?: { bytes_received?: number | string; bytes_sent?: number | string; packets_received?: number; packets_sent?: number }
        }>
      }

      // 被动状态同步：检查 Incus 实际状态并更新数据库
      if (state.status) {
        const incusStatus = mapInstanceStatus(state.status)
        // 仅在状态不一致且是有效状态时更新
        if (incusStatus !== 'unknown' && instance.status !== incusStatus) {
          console.log(`[StatusSync] Passive sync: Instance ${instance.id} status ${instance.status} → ${incusStatus}`)
          await db.updateInstanceStatus(instanceId, incusStatus as 'creating' | 'running' | 'stopped' | 'error')
        }
      }

      const memoryUsage = state.memory?.usage || 0
      const memoryLimit = instance.memory * 1024 * 1024
      const memoryPercent = memoryLimit > 0 ? Math.round((memoryUsage / memoryLimit) * 100) : 0

      let diskUsage = 0
      const diskLimit = instance.disk * 1024 * 1024
      if (state.disk?.root) {
        diskUsage = state.disk.root.usage || 0
      }
      const diskPercent = diskLimit > 0 ? Math.round((diskUsage / diskLimit) * 100) : 0

      const networkCounters = getTrafficCountersFromState(instance.incus_id, state)
      const bytesReceived = Number(networkCounters.rxBytes)
      const bytesSent = Number(networkCounters.txBytes)

      // 获取最新实例状态（可能已被被动同步更新）
      const updatedInstance = await db.getInstanceById(instanceId)
      const currentStatus = updatedInstance?.status || instance.status

      return {
        stats: {
          memory: {
            usage: Math.round(memoryUsage / 1024 / 1024),
            limit: instance.memory,
            usagePercent: Math.min(memoryPercent, 100)
          },
          disk: {
            usage: Math.round(diskUsage / 1024 / 1024),
            limit: instance.disk,
            usagePercent: Math.min(diskPercent, 100)
          },
          network: {
            bytesReceived,
            bytesSent
          }
        },
        // 返回当前实例状态，便于前端及时更新
        status: currentStatus
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error('获取实例资源状态失败:', errorMessage)
      return {
        stats: {
          memory: { usage: 0, limit: instance.memory, usagePercent: 0 },
          disk: { usage: 0, limit: instance.disk, usagePercent: 0 },
          network: { bytesReceived: 0, bytesSent: 0 }
        },
        status: instance.status
      }
    }
  })

  // 启动实例
  fastify.post<{ Params: { id: string } }>('/:id/start', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status === 'running') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_ALREADY_RUNNING))
    }

    // 封停状态不允许启动
    if (instance.status === 'suspended') {
      // 到期封停返回特定错误码，其他封停返回通用错误码
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: 'start'
    })

    await createLog(user.id, 'instance', 'instance.start', `Queued start task for instance "${instance.name}"`, 'success', { instanceId })

    reply.code(202).send({
      message: 'Instance start task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 停止实例
  fastify.post<{ Params: { id: string } }>('/:id/stop', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封禁状态检查：实例所有者不能停止被封禁的实例
    // 节点所有者可以停止（用于维护等操作）
    if (instance.status === 'suspended') {
      const host = await db.getHostById(instance.host_id)
      const isHostOwner = host && host.user_id === user.id
      if (!isHostOwner) {
        if (instance.suspend_reason === 'expired') {
          return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
        }
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
      }
    }

    if (instance.status === 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_ALREADY_STOPPED))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: 'stop'
    })

    await createLog(user.id, 'instance', 'instance.stop', `Queued stop task for instance "${instance.name}"`, 'success', { instanceId })

    reply.code(202).send({
      message: 'Instance stop task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 重启实例
  fastify.post<{ Params: { id: string } }>('/:id/restart', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许重启
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: 'restart'
    })

    await createLog(user.id, 'instance', 'instance.restart', `Queued restart task for instance "${instance.name}"`, 'success', { instanceId })

    reply.code(202).send({
      message: 'Instance restart task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 封停实例（仅宿主机所有者和管理员）
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>('/:id/suspend', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request
    const { reason } = request.body || {}

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 封停权限：仅管理员和宿主机所有者可以封停实例
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = host && host.user_id === user.id
    const isAdmin = user.role === 'admin'

    if (!isAdmin && !isHostOwner) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 已封停的实例不能重复封停
    if (instance.status === 'suspended') {
      return reply.code(400).send({
        error: 'Instance is already suspended',
        code: 'INSTANCE_ALREADY_SUSPENDED'
      })
    }

    // 不能封停已删除的实例
    if (instance.status === 'deleted') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 如果实例正在运行，先关机
    if (instance.status === 'running' && host) {
      try {
        const client = await getIncusClient(host)
        await stopInstance(client, instance.incus_id, true)
      } catch (err) {
        console.error(`[Suspend] Failed to stop instance ${instanceId}:`, err)
        // 继续封停流程，即使关机失败
      }
    }

    // 执行封停
    await db.suspendInstance(instanceId, {
      suspendedBy: user.id,
      suspendReason: reason || ''
    })

    await createLog(user.id, 'instance', 'instance.suspend', `Suspended instance "${instance.name}"${reason ? ` (reason: ${reason})` : ''}`, 'success', { instanceId })

    // 发送站内信通知给实例所有者
    if (instance.user_id !== user.id) {
      await sendNotification(instance.user_id, 'instance_suspended', {
        instanceName: instance.name,
        hostName: host?.name || '',
        suspendReason: reason || ''
      })
    }

    reply.code(200).send({
      message: 'Instance suspended successfully'
    })
  })

  // 解除封停（仅宿主机所有者和管理员）
  fastify.post<{ Params: { id: string } }>('/:id/unsuspend', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 解封权限：仅管理员和宿主机所有者可以解封
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = host && host.user_id === user.id
    const isAdmin = user.role === 'admin'

    if (!isAdmin && !isHostOwner) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 只能解封已封停的实例
    if (instance.status !== 'suspended') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_NOT_SUSPENDED))
    }

    // 如果是到期封停，需要检查是否已续费（有新的到期时间）
    if (instance.suspend_reason === 'expired') {
      // 如果到期时间仍然在过去，不允许解封
      if (instance.expires_at && new Date(instance.expires_at) <= new Date()) {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
    }

    // 执行解封
    await db.unsuspendInstance(instanceId)

    await createLog(user.id, 'instance', 'instance.unsuspend', `Unsuspended instance "${instance.name}"`, 'success', { instanceId })

    // 发送站内信通知给实例所有者
    if (instance.user_id !== user.id) {
      await sendNotification(instance.user_id, 'instance_unsuspended', {
        instanceName: instance.name,
        hostName: host?.name || ''
      })
    }

    reply.code(200).send({
      message: 'Instance unsuspended successfully'
    })
  })

  // 同步实例状态（从 Incus 获取实际状态和内网 IP 并更新数据库）
  fastify.post<{ Params: { id: string } }>('/:id/sync-status', {
    // 使用 authenticate，允许实例所有者、节点所有者和管理员同步状态
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：实例所有者、节点所有者或管理员
    const host = await db.getHostById(instance.host_id)
    const isInstanceOwner = instance.user_id === user.id
    const isHostOwner = host && host.user_id === user.id
    const isAdmin = user.role === 'admin'

    if (!isInstanceOwner && !isHostOwner && !isAdmin) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!host) {
      return reply.code(404).send({ error: '节点不存在' })
    }

    // 获取 Incus 客户端
    let client
    try {
      client = await getIncusClient(host as Host)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(503).send({ error: `无法连接到节点: ${errorMessage}` })
    }

    // 从 Incus state.network 中提取 IPv4 地址
    // 优先选择 eth0 接口的 IP（这是我们配置的主网卡）
    try {
      // 从 Incus 获取实例状态
      const [state, incusInstance] = await Promise.all([
        getInstanceState(client, instance.incus_id),
        getInstance(client, instance.incus_id)
      ]) as [{
        status?: string
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }, {
        devices?: Record<string, Record<string, unknown>>
        expanded_devices?: Record<string, Record<string, unknown>>
      }]

      if (!state.status) {
        return reply.code(500).send({ error: '无法获取实例状态' })
      }

      const incusStatus = mapInstanceStatus(state.status)

      if (incusStatus === 'unknown') {
        return reply.code(500).send({ error: `未知状态: ${state.status}` })
      }

      const currentStatus = instance.status
      let statusChanged = false
      let ipv4Changed = false
      let ipv6Changed = false
      let oldIpv4: string | null = null
      let newIpv4: string | null = null
      let oldIpv6: string | null = null
      let newIpv6: string | null = null
      let proxySitesUpdated = 0

      // 更新数据库状态
      if (currentStatus !== incusStatus) {
        await db.updateInstanceStatus(
          instanceId,
          incusStatus as 'creating' | 'running' | 'stopped' | 'error'
        )
        statusChanged = true
      }

      // 同步内网 IPv4（仅当实例正在运行时才能获取）
      const persistedNetwork = await persistResolvedInstanceNetworkAddresses(
        {
          id: instanceId,
          name: instance.name,
          hostId: instance.host_id,
          networkMode: instance.network_mode,
          ipv4: instance.ipv4,
          ipv6: instance.ipv6
        },
        resolveInstanceNetworkAddresses(
          {
            id: instanceId,
            name: instance.name,
            hostId: instance.host_id,
            networkMode: instance.network_mode,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
          },
          incusInstance,
          state
        ),
        { updateLastSyncedAt: true }
      )

      ipv4Changed = persistedNetwork.ipv4Changed
      oldIpv4 = persistedNetwork.oldIpv4
      newIpv4 = persistedNetwork.newIpv4
      ipv6Changed = persistedNetwork.ipv6Changed
      oldIpv6 = persistedNetwork.oldIpv6
      newIpv6 = persistedNetwork.newIpv6

      if (ipv4Changed && newIpv4) {
        console.log(`[SyncStatus] Instance ${instanceId} IPv4 changed: ${oldIpv4} -> ${newIpv4}`)

        const proxySites = await getProxySitesByInstanceId(instanceId)
        if (proxySites.length > 0 && host.caddy_enabled && host.caddy_username && host.caddy_password) {
          const targetHost = host.nat_public_ip || host.ip_address
          if (targetHost) {
            const caddyClient = createCaddyClient({
              host: targetHost,
              port: host.caddy_port || 8444,
              username: host.caddy_username,
              password: host.caddy_password
            })

            for (const site of proxySites) {
              if (site.status === 'active' && site.enabled) {
                try {
                  await caddyClient.deleteSite(site.domain)
                  await caddyClient.addSite(site.domain, newIpv4, site.targetPort, site.httpsEnabled)
                  proxySitesUpdated++
                  console.log(`[SyncStatus] Updated proxy site "${site.domain}" to new IP ${newIpv4}`)
                } catch (caddyErr) {
                  console.error(`[SyncStatus] Failed to update proxy site "${site.domain}":`, caddyErr)
                }
              }
            }
          }
        }
      }
      return reply.code(200).send({
        success: true,
        statusChanged,
        from: statusChanged ? currentStatus : undefined,
        to: statusChanged ? incusStatus : undefined,
        currentStatus: incusStatus,
        ipv4Changed,
        oldIpv4: ipv4Changed ? oldIpv4 : undefined,
        newIpv4: ipv4Changed ? newIpv4 : undefined,
        ipv6Changed,
        oldIpv6: ipv6Changed ? oldIpv6 : undefined,
        newIpv6: ipv6Changed ? newIpv6 : undefined,
        proxySitesUpdated: ipv4Changed ? proxySitesUpdated : undefined
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)

      // 如果实例在 Incus 中不存在
      if (errorMessage.includes('not found') || errorMessage.includes('Instance not found')) {
        return reply.code(404).send({ error: '实例在节点上不存在' })
      }

      return reply.code(500).send({ error: `同步失败: ${errorMessage}` })
    }
  })

  // 获取实例可改节点列表
  fastify.get<{ Params: { id: string } }>('/:id/change-host-options', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const instanceId = Number(request.params.id)
    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance || instance.status === 'deleted') {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    const hasPermission = await checkInstanceOperationPermission(request.user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    return buildChangeHostOptions(instance)
  })

  // 改节点：在目标节点重建实例，保留当前实例 ID
  fastify.post<{
    Params: { id: string }
    Body: { targetHostId: number; sshKeyId: number }
  }>('/:id/change-host', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['targetHostId', 'sshKeyId'],
        properties: {
          targetHostId: { type: 'integer', minimum: 1 },
          sshKeyId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { targetHostId: number; sshKeyId: number }
  }>, reply: FastifyReply) => {
    const instanceId = Number(request.params.id)
    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { targetHostId, sshKeyId } = request.body
    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance || instance.status === 'deleted') {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (!['running', 'stopped', 'error'].includes(instance.status)) {
      return reply.code(400).send({
        error: 'Instance status does not allow host change',
        code: 'INSTANCE_STATUS_NOT_ALLOWED'
      })
    }

    if (await checkTransferLock(instanceId, reply)) return

    const [activeTask, activeRestoreTask, activeUploadTask] = await Promise.all([
      getActiveTaskForInstance(instanceId),
      prisma.restoreTask.findFirst({
        where: {
          instanceId,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      }),
      prisma.backupUploadTask.findFirst({
        where: {
          instanceId,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      })
    ])

    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    if (activeRestoreTask) {
      return reply.code(409).send({
        error: 'Instance has an active restore task',
        code: 'RESTORE_IN_PROGRESS'
      })
    }

    if (activeUploadTask) {
      return reply.code(409).send({
        error: 'Instance has an active backup upload task',
        code: 'UPLOAD_IN_PROGRESS'
      })
    }

    const keyRecord = await db.getSSHKeyById(sshKeyId)
    if (!keyRecord || keyRecord.user_id !== instance.user_id) {
      return reply.code(400).send(apiError(ErrorCode.SSH_KEY_NOT_OWNED))
    }

    const options = await buildChangeHostOptions(instance)
    if (!options.packageId) {
      return reply.code(400).send({
        error: 'Instance does not belong to a package',
        code: 'CHANGE_HOST_NO_PACKAGE'
      })
    }

    if (options.hosts.length <= 1) {
      return reply.code(400).send({
        error: 'Package has no other host',
        code: 'CHANGE_HOST_SINGLE_HOST'
      })
    }

    const targetOption = options.hosts.find(host => host.id === targetHostId)
    if (!targetOption) {
      return reply.code(400).send({
        error: 'Target host is not bound to this package',
        code: 'CHANGE_HOST_TARGET_NOT_BOUND'
      })
    }

    if (!targetOption.canChange) {
      return reply.code(400).send({
        error: 'Target host is not available',
        code: 'CHANGE_HOST_TARGET_UNAVAILABLE',
        reason: targetOption.unavailableReason
      })
    }

    const targetHost = await db.getHostById(targetHostId)
    if (!targetHost) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const task = await createInstanceTask({
      instanceId,
      hostId: targetHostId,
      userId: user.id,
      taskType: 'change_host' as any,
      targetHostId,
      sshKeyId
    })

    await createLog(
      user.id,
      'instance',
      'instance.change_host',
      `Queued host change for instance "${instance.name}" from host "${instance.host_name || instance.host_id}" to "${targetHost.name}"`,
      'success',
      { instanceId }
    )

    return reply.code(202).send({
      message: 'Instance host change task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 重装系统
  fastify.post<{
    Params: { id: string }
    Body: { image: string; sshKeyId?: number; imageAlias?: string; customInitCommandIds?: number[] }
  }>('/:id/rebuild', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          image: { type: 'string' },
          imageAlias: { type: 'string' },
          sshKeyId: { type: 'integer' },
          customInitCommandIds: { type: 'array', items: { type: 'integer' }, maxItems: 20 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { image: string; sshKeyId?: number; imageAlias?: string; customInitCommandIds?: number[] }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 兼容前端的 image 和 imageAlias
    const imageAlias = request.body.image || request.body.imageAlias

    if (!imageAlias) {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_REQUIRED))
    }
    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // AUTH004: 重装系统仅限实例所有者，管理员和宿主机所有者禁止
    // 原因：重装会清除实例数据，影响用户资产安全
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许重装
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STOP_REQUIRED))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }



    // 验证镜像是否在预设列表中
    if (!await isValidSystemImage(imageAlias)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
    }

    // 验证镜像与实例内存配置的兼容性（128MB 只允许 Alpine/Debian）
    if (!await isImageCompatibleWithMemory(imageAlias, instance.memory)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
    }

    const rebuildPackage = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const rebuildInstanceType = (rebuildPackage as { instance_type?: 'container' | 'vm' } | null)?.instance_type || 'container'
    const rebuildImageAvailability = await getSystemImageAvailabilityForHost(imageAlias, instance.host_id, {
      instanceType: rebuildInstanceType,
      memory: instance.memory
    })
    if (!rebuildImageAvailability.ok) {
      switch (rebuildImageAvailability.reason) {
        case 'host_not_found':
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        case 'image_not_found':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
        case 'memory_incompatible':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
        case 'instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_TYPE_MISMATCH))
        case 'host_instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
        default:
          return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_UNAVAILABLE))
      }
    }

    // 验证 SSH 密钥（如果提供）
    const { sshKeyId, customInitCommandIds } = request.body
    if (sshKeyId) {
      const keyRecord = await db.getSSHKeyById(sshKeyId)
      if (!keyRecord || keyRecord.user_id !== user.id) {
        return reply.code(400).send(apiError(ErrorCode.SSH_KEY_NOT_OWNED))
      }
    }

    // 验证自定义初始化命令（如果提供）
    if (customInitCommandIds && customInitCommandIds.length > 0) {
      const cmdValidation = await validateCommandsOwnership(customInitCommandIds, user.id)
      if (!cmdValidation.valid) {
        return reply.code(400).send({ error: 'Invalid custom init command IDs', code: 'INVALID_COMMAND_IDS' })
      }
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: 'rebuild',
      imageAlias,
      sshKeyId,
      customInitCommandIds
    })

    await createLog(user.id, 'instance', 'instance.rebuild', `Queued rebuild task for instance "${instance.name}" with image ${imageAlias}`, 'success', { instanceId })

    // 清理已使用的验证记录（在任务中会重新验证）
    await consumeOperationVerification(user.id, 'reinstall_instance', instanceId)

    reply.code(202).send({
      message: 'Instance rebuild task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 重建实例（创建新实例替换旧实例，不限制状态）
  fastify.post<{
    Params: { id: string }
    Body: { image: string; sshKeyId?: number; imageAlias?: string; customInitCommandIds?: number[] }
  }>('/:id/recreate', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          image: { type: 'string' },
          imageAlias: { type: 'string' },
          sshKeyId: { type: 'integer' },
          customInitCommandIds: { type: 'array', items: { type: 'integer' }, maxItems: 20 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { image: string; sshKeyId?: number; imageAlias?: string; customInitCommandIds?: number[] }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 兼容前端的 image 和 imageAlias
    const imageAlias = request.body.image || request.body.imageAlias

    if (!imageAlias) {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_REQUIRED))
    }
    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // AUTH: 重建仅限实例所有者，管理员和宿主机所有者禁止
    // 原因：重建会清除实例数据，影响用户资产安全
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许重建
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 注意：重建不限制实例状态，任何状态都可以重建（不同于重装）

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }



    // 验证镜像是否在预设列表中
    if (!await isValidSystemImage(imageAlias)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
    }

    // 验证镜像与实例内存配置的兼容性（128MB 只允许 Alpine/Debian）
    if (!await isImageCompatibleWithMemory(imageAlias, instance.memory)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
    }

    const recreatePackage = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const recreateInstanceType = (recreatePackage as { instance_type?: 'container' | 'vm' } | null)?.instance_type || 'container'
    const recreateImageAvailability = await getSystemImageAvailabilityForHost(imageAlias, instance.host_id, {
      instanceType: recreateInstanceType,
      memory: instance.memory
    })
    if (!recreateImageAvailability.ok) {
      switch (recreateImageAvailability.reason) {
        case 'host_not_found':
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        case 'image_not_found':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
        case 'memory_incompatible':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
        case 'instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_TYPE_MISMATCH))
        case 'host_instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
        default:
          return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_UNAVAILABLE))
      }
    }

    // 验证 SSH 密钥（如果提供）
    const { sshKeyId, customInitCommandIds } = request.body
    if (sshKeyId) {
      const keyRecord = await db.getSSHKeyById(sshKeyId)
      if (!keyRecord || keyRecord.user_id !== user.id) {
        return reply.code(400).send(apiError(ErrorCode.SSH_KEY_NOT_OWNED))
      }
    }

    // 验证自定义初始化命令（如果提供）
    if (customInitCommandIds && customInitCommandIds.length > 0) {
      const cmdValidation = await validateCommandsOwnership(customInitCommandIds, user.id)
      if (!cmdValidation.valid) {
        return reply.code(400).send({ error: 'Invalid custom init command IDs', code: 'INVALID_COMMAND_IDS' })
      }
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: 'recreate',
      imageAlias,
      sshKeyId,
      customInitCommandIds
    })

    await createLog(user.id, 'instance', 'instance.recreate', `Queued recreate task for instance "${instance.name}" with image ${imageAlias}`, 'success', { instanceId })

    // 清理已使用的验证记录
    await consumeOperationVerification(user.id, 'recreate_instance', instanceId)

    reply.code(202).send({
      message: 'Instance recreate task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // 删除实例
  fastify.delete<{ Params: { id: string }; Body: { reason?: string } }>('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { reason } = request.body || {}
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、节点所有者
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查是否是宿主机拥有者（避免重复查询，复用checkInstanceOperationPermission的逻辑）
    // 注意：checkInstanceOperationPermission已经检查了是否是宿主机拥有者，但我们需要明确知道以决定是否检查套餐限制
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = !!(host && host.user_id === user.id)
    const isAdmin = user.role === 'admin'
    const isPrivilegedDeleter = isHostOwner || isAdmin

    // 付费实例禁止删除（宿主机拥有者不受限制）
    if (!isPrivilegedDeleter && instance.package_plan_id) {
      return reply.code(403).send({
        error: '付费实例不允许删除',
        code: 'PAID_INSTANCE_DELETION_NOT_ALLOWED'
      })
    }

    // 封禁状态检查：实例所有者不能删除被封禁的实例，仅节点所有者可以
    // 这是安全措施，防止用户绕过前端禁用按钮通过API直接删除
    if (instance.status === 'suspended' && !isPrivilegedDeleter) {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 检查套餐是否允许删除实例（宿主机拥有者不受限制）
    if (!isPrivilegedDeleter && instance.package_id) {
      const pkg = await db.getPackageById(instance.package_id)
      // 默认值为false，只有明确设置为true时才允许删除
      if (pkg && (pkg as any).allow_instance_deletion !== true) {
        return reply.code(403).send({
          error: 'Package does not allow instance deletion',
          code: 'INSTANCE_DELETION_NOT_ALLOWED'
        })
      }
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return



    try {
      // 复用上面已获取的host
      if (!host) {
        throw new Error('Host not found')
      }

      // ===== 0. 关闭该实例的所有终端连接 =====
      const closedSessions = closeInstanceSessions(instanceId, 'Instance is being deleted')
      if (closedSessions > 0) {
        console.log(`[Delete] Closed ${closedSessions} terminal session(s) for instance ${instanceId}`)
      }

      // 导入需要的删除函数
      const { deleteBackup: deleteIncusBackup } = await import('../lib/incus/incus-backups.js')
      const { sendNotification } = await import('../lib/notifier.js')

      // 检查是否有正在进行的恢复任务
      const activeRestoreTask = await prisma.restoreTask.findFirst({
        where: {
          instanceId,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      })
      if (activeRestoreTask) {
        return reply.code(409).send({
          error: '该实例有正在进行的恢复任务，请等待完成或取消',
          code: 'RESTORE_IN_PROGRESS'
        })
      }

      // 检查是否有正在进行的备份上传任务
      const activeUploadTask = await prisma.backupUploadTask.findFirst({
        where: {
          instanceId,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      })
      if (activeUploadTask) {
        return reply.code(409).send({
          error: '该实例有正在进行的备份上传任务，请等待完成或取消',
          code: 'UPLOAD_IN_PROGRESS'
        })
      }

      // 检查是否有正在进行的实例操作任务
      const activeInstanceTask = await getActiveTaskForInstance(instanceId)
      if (activeInstanceTask) {
        return reply.code(409).send({
          error: '该实例有正在进行的操作任务，请等待完成',
          code: 'TASK_IN_PROGRESS',
          taskId: activeInstanceTask.id,
          taskType: activeInstanceTask.taskType,
          status: activeInstanceTask.status
        })
      }

      const claimed = await claimInstanceForDelete(instanceId, instance.status as InstanceStatus)
      if (!claimed) {
        return reply.code(409).send({
          error: '实例正在删除或已删除',
          code: 'INSTANCE_DELETE_IN_PROGRESS'
        })
      }

      // ===== 0.1 处理退款（节点所有者/管理员删除他人的付费实例时）=====
      let hostOwnerRefundAmount = 0
      if (isPrivilegedDeleter && instance.user_id !== user.id) {
        const instanceBilling = await prisma.instance.findUnique({
          where: { id: instance.id },
          select: {
            billingPrice: true,
            billingCycle: true,
            expiresAt: true,
            packagePlanId: true
          }
        })

        const refundInfo = instanceBilling
          ? await db.calculateInstanceRefund({
              id: instance.id,
              billingPrice: instanceBilling.billingPrice ? Number(instanceBilling.billingPrice) : null,
              billingCycle: instanceBilling.billingCycle,
              expiresAt: instanceBilling.expiresAt,
              packagePlanId: instanceBilling.packagePlanId
            })
          : { isPaid: false, refundAmount: 0 }

        if (refundInfo.isPaid && refundInfo.refundAmount > 0) {
          hostOwnerRefundAmount = refundInfo.refundAmount

          try {
            await prisma.$transaction(async (tx) => {
              const instanceOwner = await tx.user.findUnique({
                where: { id: instance.user_id },
                select: { balance: true }
              })
              const oldBalance = Number(instanceOwner?.balance || 0)
              const newBalance = oldBalance + hostOwnerRefundAmount

              await tx.user.update({
                where: { id: instance.user_id },
                data: { balance: { increment: hostOwnerRefundAmount } }
              })

              await tx.balanceLog.create({
                data: {
                  userId: instance.user_id,
                  type: 'refund',
                  amount: hostOwnerRefundAmount,
                  balanceBefore: oldBalance,
                  balanceAfter: newBalance,
                  instanceId: instance.id,
                  remark: `托管实例被删除退款：${instance.name}`
                }
              })

              await db.deductHostingBalance(
                instance.host_id,
                hostOwnerRefundAmount,
                instance.id,
                `删除托管实例退款扣除：${instance.name}`,
                tx
              )
            })
          } catch (refundError) {
            await prisma.instance.updateMany({
              where: { id: instanceId, status: 'deleted' },
              data: { status: instance.status as InstanceStatus }
            })
            throw refundError
          }
        }
      }

      let client = null
      try {
        client = await getIncusClient(host)
      } catch (clientError) {
        const errorMessage = clientError instanceof Error ? clientError.message : String(clientError)
        console.error('获取 Incus 客户端失败:', errorMessage)
      }

      // ===== 1. 删除反代站点（Caddy 远程 + 数据库）=====
      const proxySites = await getProxySitesByInstanceId(instanceId)
      if (proxySites.length > 0) {
        // 尝试删除 Caddy 远程配置
        if (host.caddy_enabled && host.caddy_username && host.caddy_password) {
          const targetHost = host.nat_public_ip || host.ip_address
          if (targetHost) {
            const caddyClient = createCaddyClient({
              host: targetHost,
              port: host.caddy_port || 8444,
              username: host.caddy_username,
              password: host.caddy_password
            })

            for (const site of proxySites) {
              try {
                await caddyClient.deleteSite(site.domain)
              } catch (caddyError) {
                const errorMessage = caddyError instanceof Error ? caddyError.message : String(caddyError)
                console.error(`删除 Caddy 反代站点失败 (${site.domain}):`, errorMessage)
              }
            }
          }
        }
        // 始终删除数据库记录（无论 Caddy 是否启用）
        for (const site of proxySites) {
          await deleteProxySite(site.id)
        }
      }

      // ===== 2. 删除端口映射（Incus 设备 + 数据库）=====
      const portMappings = await db.getPortMappings(instanceId)
      if (portMappings && portMappings.length > 0) {
        for (const mapping of portMappings) {
          const map = mapping as { id: number; protocol: string; public_port: number }
          // 尝试删除 Incus 设备
          if (client) {
            const deviceName = `proxy-${map.protocol}-${map.public_port}`
            try {
              await removeDevice(client, instance.incus_id, deviceName)
            } catch (deviceError) {
              const errorMessage = deviceError instanceof Error ? deviceError.message : String(deviceError)
              console.error(`删除端口映射设备失败 (${deviceName}):`, errorMessage)
            }
          }
          // 始终删除数据库记录
          await db.deletePortMapping(map.id)
        }
      }

      // ===== 3. 删除快照（Incus 远程 + 数据库）=====
      const snapshots = await db.getSnapshotsByInstanceId(instanceId)
      if (snapshots.length > 0) {
        for (const snapshot of snapshots) {
          // 尝试删除 Incus 快照
          if (client) {
            try {
              await deleteSnapshot(client, instance.incus_id, snapshot.incus_name)
            } catch (snapshotError) {
              const errorMessage = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
              console.error(`删除 Incus 快照失败 (${snapshot.name}):`, errorMessage)
            }
          }
          // 始终删除数据库记录
          await db.deleteSnapshot(snapshot.id)
        }
      }

      // ===== 4. 删除备份（Incus 远程 + 数据库软删除）=====
      const backups = await db.getBackupsByInstanceId(instanceId)
      if (backups.length > 0) {
        for (const backup of backups) {
          // 尝试删除 Incus 备份
          if (client) {
            try {
              await deleteIncusBackup(client, instance.incus_id, backup.incus_name)
            } catch (backupError) {
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError)
              console.error(`删除 Incus 备份失败 (${backup.name}):`, errorMessage)
            }
          }
          // 始终软删除数据库记录
          await db.deleteBackup(backup.id)
        }
      }

      // ===== 5. 删除快照策略和备份策略 =====
      try {
        await prisma.snapshotPolicy.deleteMany({ where: { instanceId } })
        await prisma.backupPolicy.deleteMany({ where: { instanceId } })
      } catch (policyError) {
        const errorMessage = policyError instanceof Error ? policyError.message : String(policyError)
        console.error('删除策略失败:', errorMessage)
      }

      // ===== 5.1 删除流量相关记录 =====
      try {
        await prisma.trafficSnapshot.deleteMany({ where: { instanceId } })
        await prisma.dailyTraffic.deleteMany({ where: { instanceId } })
      } catch (trafficError) {
        const errorMessage = trafficError instanceof Error ? trafficError.message : String(trafficError)
        console.error('删除流量记录失败:', errorMessage)
      }

      // ===== 5.2 删除 IP 地址和 IPv6 网段记录 =====
      try {
        await prisma.ipAddress.deleteMany({ where: { instanceId } })
        await prisma.ipv6Subnet.deleteMany({ where: { instanceId } })
      } catch (ipError) {
        const errorMessage = ipError instanceof Error ? ipError.message : String(ipError)
        console.error('删除 IP 记录失败:', errorMessage)
      }

      // ===== 5.3 删除历史任务记录（已完成/失败的恢复任务、上传任务和实例任务）=====
      try {
        await prisma.restoreTask.deleteMany({
          where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } }
        })
        await prisma.backupUploadTask.deleteMany({
          where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } }
        })
        await prisma.instanceTask.deleteMany({
          where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } }
        })
      } catch (taskError) {
        const errorMessage = taskError instanceof Error ? taskError.message : String(taskError)
        console.error('删除历史任务记录失败:', errorMessage)
      }

      // ===== 5.4 取消待处理的转移请求 =====
      try {
        await prisma.instanceTransfer.updateMany({
          where: { instanceId, status: 'pending' },
          data: { status: 'cancelled', cancelledAt: new Date() }
        })
      } catch (transferError) {
        const errorMessage = transferError instanceof Error ? transferError.message : String(transferError)
        console.error('取消转移请求失败:', errorMessage)
      }

      // ===== 6. 停止并删除 Incus 实例 =====
      if (client) {
        try {
          if (instance.status === 'running') {
            await stopInstance(client, instance.incus_id, true)
          }
          await deleteInstance(client, instance.incus_id)
        } catch (incusError) {
          const errorMessage = incusError instanceof Error ? incusError.message : String(incusError)
          console.error('Incus 删除实例失败:', errorMessage)
        }
      }

      // ===== 8. 释放用户配额和宿主机资源 =====
      const portMappingsCount = portMappings?.length || 0
      await db.rollbackResources({
        hostId: instance.host_id,
        cpu: instance.cpu,
        memory: instance.memory,
        disk: instance.disk,
        portCount: portMappingsCount
      })

      // 重新计算宿主机资源使用量（包括端口）
      const usedResources = await db.calculateHostResourcesFromInstances(instance.host_id)
      // 重新计算端口映射使用量
      const actualPortsUsed = await prisma.portMapping.count({
        where: {
          instance: {
            hostId: instance.host_id,
            status: { not: 'deleted' }
          }
        }
      })
      await db.updateHostResources(instance.host_id, {
        cpuUsed: usedResources.cpuUsed,
        memoryUsed: usedResources.memoryUsed,
        diskUsed: usedResources.diskUsed
      })
      // 更新端口使用量
      await prisma.host.update({
        where: { id: instance.host_id },
        data: { natPortsUsedCount: actualPortsUsed }
      })

      // ===== 10. 发送通知 =====
      // 判断是否是宿主机所有者删除他人的实例
      if (isPrivilegedDeleter && instance.user_id !== user.id) {
        // 宿主机所有者删除他人的实例，如果提供了原因，发送特定通知给实例所有者
        if (reason && reason.trim()) {
          await sendNotification(instance.user_id, 'instance_deleted_by_host_owner', {
            instanceName: instance.name,
            hostName: host?.name || undefined,
            deleteReason: reason.trim()
          })
        } else {
          // 没有提供原因，发送普通删除通知
          await sendNotification(instance.user_id, 'instance_deleted', {
            instanceName: instance.name,
            hostName: host?.name || undefined
          })
        }
      } else {
        // 用户删除自己的实例，发送通知给自己
        await sendNotification(user.id, 'instance_deleted', {
          instanceName: instance.name,
          hostName: host?.name || undefined
        })
      }

      // 无论谁删除的，都向套餐绑定的通知渠道发送"资源释放"通知
      if (instance.package_id) {
        const { sendReleaseNotification } = await import('../lib/release-notifier.js')
        sendReleaseNotification({
          packageId: instance.package_id,
          cpu: instance.cpu,
          memory: instance.memory,
          source: isPrivilegedDeleter && instance.user_id !== user.id
            ? (isAdmin ? '管理员删除实例' : '节点所有者删除实例')
            : '用户删除实例'
        }).catch(() => { })
      }

      await createLog(
        user.id,
        'instance',
        'instance.delete',
        `Deleted instance "${instance.name}" [host: ${host?.name || 'unknown'}, user: ${instance.user_id}, released resources: CPU=${instance.cpu}%, Memory=${instance.memory}MB, Disk=${instance.disk}MB, ports=${portMappingsCount}]`,
        'success',
        { instanceId }
      )

      // 清理已使用的验证记录
      await consumeOperationVerification(user.id, 'delete_instance', instanceId)

      return {
        message: 'Instance deleted',
        refundAmount: hostOwnerRefundAmount > 0 ? hostOwnerRefundAmount : undefined
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 添加端口映射
  fastify.post<{
    Params: { id: string }
    Body: {
      protocol: 'tcp' | 'udp'
      publicPort?: number
      privatePort: number
      remark?: string
    }
  }>('/:id/ports', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['protocol', 'privatePort'],
        properties: {
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
          publicPort: { type: 'integer', minimum: 1, maximum: 65535 },
          privatePort: { type: 'integer', minimum: 1, maximum: 65535 },
          remark: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      protocol: 'tcp' | 'udp'
      publicPort?: number
      privatePort: number
      remark?: string
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let { protocol, publicPort, privatePort, remark } = request.body
    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许添加端口映射
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (!['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.network_mode)) {
      return reply.code(400).send(apiError(ErrorCode.PORT_MAPPING_NAT_ONLY))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    const quotaCheck = await db.checkPortQuota(instance.user_id, instanceId)
    if (!quotaCheck.allowed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_PORT_EXCEEDED, quotaCheck.message))
    }

    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    let allocatedPort: number | undefined = publicPort
    if (!allocatedPort) {
      const port = await db.allocatePort(instance.host_id, protocol)
      if (!port) {
        return reply.code(503).send(apiError(ErrorCode.PORT_NO_AVAILABLE))
      }
      allocatedPort = port
    } else {
      if (host.nat_port_start && host.nat_port_end) {
        if (allocatedPort < host.nat_port_start || allocatedPort > host.nat_port_end) {
          return reply.code(400).send(apiError(ErrorCode.PORT_RANGE_INVALID, `${host.nat_port_start}-${host.nat_port_end}`))
        }
      }

      const existingPort = await db.checkPortInUse(instance.host_id, allocatedPort, protocol)
      if (existingPort) {
        return reply.code(400).send(apiError(ErrorCode.PORT_IN_USE))
      }
    }

    const createdDeviceNames: string[] = []
    try {
      const client = await getIncusClient(host)

      const deviceName = `proxy-${protocol}-${allocatedPort}`
      // 获取当前用于建立底层设备的实例准确类别（解决 params.type 不能 100% 同步问题）
      let isVM = false;
      if (instance.package_id) {
        const pkg = await prisma.package.findUnique({
          where: { id: instance.package_id }
        });
        isVM = !!pkg && (('instance_type' in pkg && pkg.instance_type === 'vm') || ('instanceType' in pkg && pkg.instanceType === 'vm'));
      }
      const actualInstanceType = isVM ? 'virtual-machine' : 'container';
      if (instance.network_mode === 'ipv6_only') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'IPv6 Only instances do not require port mappings'))
      }

      // 获取保底 IPv6 供双路网卡调用
      let explicitIpv6 = (host as any).nat_bind_ipv6 || host.nat_public_ipv6 || host.ipv6_gateway || (host.ip_address?.includes(':') ? host.ip_address : null);
      if (!explicitIpv6 && host) {
        try {
          const ipv6Alias = await prisma.hostAddressAlias.findFirst({
            where: { hostId: host.id, kind: 'ipv6' },
            select: { address: true }
          })
          if (ipv6Alias?.address) explicitIpv6 = ipv6Alias.address
        } catch { }
      }

      // == 通过分离解耦工厂彻底剥夺创建网络监听阻拦的逻辑 ==
      const proxyStrategy = ProxyStrategyFactory.getStrategy(actualInstanceType);
      const bindableIpv4 = selectBindableIpv4ListenAddress(
        (host as any).nat_bind_ip || null,
        host.nat_public_ip || null,
        host.url,
        host.ip_address || null
      )
      const proxyDeviceRes = proxyStrategy.createProxyDevice(bindableIpv4, explicitIpv6, instance.network_mode, protocol, allocatedPort, privatePort);

      const deviceConfigs = proxyDeviceRes.deviceConfigs
        || (proxyDeviceRes.deviceConfig ? [{ deviceConfig: proxyDeviceRes.deviceConfig }] : [])

      if (!proxyDeviceRes.success || deviceConfigs.length === 0) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, proxyDeviceRes.errorMessage || '底层代理生成异常被工厂截断'));
      }

      for (const deviceEntry of deviceConfigs) {
        const resolvedDeviceName = `${deviceName}${deviceEntry.nameSuffix || ''}`
        await addDevice(client, instance.incus_id, resolvedDeviceName, deviceEntry.deviceConfig as Record<string, string>)
        createdDeviceNames.push(resolvedDeviceName)
      }

      const mappingId = await db.createPortMapping({
        instanceId: instanceId,
        hostId: instance.host_id,
        protocol,
        publicPort: allocatedPort,
        privatePort,
        remark: remark?.trim()
      })

      await createLog(user.id, 'instance', 'port.add', `Added port mapping for instance "${instance.name}" [host: ${host?.name || 'unknown'}, ${protocol.toUpperCase()} ${allocatedPort}:${privatePort}${remark ? `, remark: ${remark}` : ''}]`, 'success', { instanceId })

      return {
        message: 'Port mapping added',
        mapping: { id: mappingId, protocol, publicPort: allocatedPort, privatePort, remark: remark?.trim() || null }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      try {
        const host = await db.getHostById(instance.host_id)
        if (host) {
          const client = await getIncusClient(host)
          const deviceName = `proxy-${protocol}-${allocatedPort}`
          await removeDevice(client, instance.incus_id, deviceName)
          await removeDevice(client, instance.incus_id, `${deviceName}-v6`)
        }
      } catch {
        // 忽略回滚失败，保留原始错误
      }
      await createLog(user.id, 'instance', 'port.add', `Failed to add port mapping: ${errorMessage}`, 'failed', { instanceId })
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 删除端口映射
  fastify.delete<{ Params: { id: string; portId: string } }>('/:id/ports/:portId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string; portId: string } }>, reply: FastifyReply) => {
    const { id, portId } = request.params
    const instanceId = Number(id)
    const portMappingId = Number(portId)

    if (isNaN(instanceId) || isNaN(portMappingId)) {
      return reply.code(400).send(apiError(ErrorCode.PORT_MAPPING_INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许删除端口映射
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    const mapping = await db.getPortMappingById(portMappingId)
    if (!mapping || mapping.instance_id !== instanceId) {
      return reply.code(404).send(apiError(ErrorCode.PORT_MAPPING_NOT_FOUND))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    try {
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        throw new Error('Host not found')
      }
      const client = await getIncusClient(host)

      const deviceName = `proxy-${mapping.protocol}-${mapping.public_port}`
      await removeDevice(client, instance.incus_id, deviceName)
      await removeDevice(client, instance.incus_id, `${deviceName}-v6`)

      await db.deletePortMapping(portMappingId)

      await createLog(user.id, 'instance', 'port.delete', `Deleted port mapping for instance "${instance.name}" [${mapping.protocol.toUpperCase()} ${mapping.public_port}:${mapping.private_port}]`, 'success', { instanceId })

      return { message: 'Port mapping deleted' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(user.id, 'instance', 'port.delete', `Failed to delete port mapping: ${errorMessage}`, 'failed', { instanceId })
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 批量添加端口映射（支持连续端口范围）
  fastify.post<{
    Params: { id: string }
    Body: {
      protocol: 'tcp' | 'udp' | 'both'
      privatePortStart: number
      privatePortEnd: number
      publicPortStart?: number
      publicPortEnd?: number
      remark?: string
      // 用于冲突解决后重新提交，指定每个内网端口对应的公网端口
      portMappings?: Array<{ privatePort: number; publicPort: number }>
    }
  }>('/:id/ports/batch', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['protocol', 'privatePortStart', 'privatePortEnd'],
        properties: {
          protocol: { type: 'string', enum: ['tcp', 'udp', 'both'] },
          privatePortStart: { type: 'integer', minimum: 1, maximum: 65535 },
          privatePortEnd: { type: 'integer', minimum: 1, maximum: 65535 },
          publicPortStart: { type: 'integer', minimum: 1, maximum: 65535 },
          publicPortEnd: { type: 'integer', minimum: 1, maximum: 65535 },
          remark: { type: 'string', maxLength: 100 },
          portMappings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['privatePort', 'publicPort'],
              properties: {
                privatePort: { type: 'integer', minimum: 1, maximum: 65535 },
                publicPort: { type: 'integer', minimum: 1, maximum: 65535 }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      protocol: 'tcp' | 'udp' | 'both'
      privatePortStart: number
      privatePortEnd: number
      publicPortStart?: number
      publicPortEnd?: number
      remark?: string
      portMappings?: Array<{ privatePort: number; publicPort: number }>
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { protocol, privatePortStart, privatePortEnd, publicPortStart, publicPortEnd, remark, portMappings } = request.body
    const { user } = request

    // 1. 验证实例
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许添加端口映射
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (!['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.network_mode)) {
      return reply.code(400).send(apiError(ErrorCode.PORT_MAPPING_NAT_ONLY))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 2. 计算端口数量
    const privatePortCount = privatePortEnd - privatePortStart + 1
    if (privatePortCount <= 0 || privatePortCount > 100) {
      return reply.code(400).send({ error: '端口范围无效，最多支持 100 个连续端口' })
    }

    // 3. 检查配额
    // TCP/UDP 各占 1 个配额，Both 占 2 个配额
    const quotaNeeded = protocol === 'both' ? privatePortCount * 2 : privatePortCount
    const quotaCheck = await db.checkPortQuota(instance.user_id, instanceId)
    const remainingQuota = quotaCheck.limit - quotaCheck.current

    if (remainingQuota < quotaNeeded) {
      return reply.code(400).send({
        error: ErrorCode.QUOTA_PORT_BATCH_EXCEEDED,
        message: `配额不足，需要 ${quotaNeeded} 个，剩余 ${remainingQuota} 个`,
        needed: quotaNeeded,
        remaining: remainingQuota
      })
    }

    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 4. 确定映射关系
    let finalMappings: Array<{ privatePort: number; publicPort: number }> = []

    if (portMappings && portMappings.length > 0) {
      // 使用用户提供的映射（冲突解决后重新提交）
      finalMappings = portMappings
    } else if (publicPortStart !== undefined && publicPortEnd !== undefined) {
      // 用户指定了公网端口范围
      const publicPortCount = publicPortEnd - publicPortStart + 1
      if (publicPortCount !== privatePortCount) {
        return reply.code(400).send(apiError(ErrorCode.PORT_RANGE_MISMATCH, `内网 ${privatePortCount} 个端口，公网 ${publicPortCount} 个端口`))
      }

      // 检查公网端口范围是否在允许范围内
      if (host.nat_port_start && host.nat_port_end) {
        if (publicPortStart < host.nat_port_start || publicPortEnd > host.nat_port_end) {
          return reply.code(400).send(apiError(ErrorCode.PORT_RANGE_INVALID, `允许范围: ${host.nat_port_start}-${host.nat_port_end}`))
        }
      }

      // 生成映射关系
      for (let i = 0; i < privatePortCount; i++) {
        finalMappings.push({
          privatePort: privatePortStart + i,
          publicPort: publicPortStart + i
        })
      }

      // 5. 检查端口冲突（需要检查 TCP 和 UDP）
      const publicPorts = finalMappings.map(m => m.publicPort)
      const protocolsToCheck: Array<'tcp' | 'udp'> = protocol === 'both' ? ['tcp', 'udp'] : [protocol]

      const allConflicts: Array<{ publicPort: number; protocol: string }> = []
      for (const proto of protocolsToCheck) {
        const conflicts = await db.checkPortsInUse(instance.host_id, publicPorts, proto)
        conflicts.forEach(c => allConflicts.push({ publicPort: c.port, protocol: proto }))
      }

      if (allConflicts.length > 0) {
        // 去重并获取建议端口
        const conflictPorts = [...new Set(allConflicts.map(c => c.publicPort))]
        const suggestedPorts = await db.suggestAvailablePorts(
          instance.host_id,
          conflictPorts.length,
          protocol === 'both' ? 'tcp' : protocol,
          publicPorts.filter(p => !conflictPorts.includes(p)),
          protocol === 'both'  // Both 模式需要同时检查 TCP 和 UDP
        )

        const conflictsWithSuggestions = conflictPorts.map((port, index) => ({
          publicPort: port,
          suggestedPort: suggestedPorts[index] || null
        }))

        return reply.code(409).send({
          error: ErrorCode.PORT_CONFLICT,
          message: '部分端口已被占用',
          conflicts: conflictsWithSuggestions,
          availableCount: suggestedPorts.length
        })
      }
    } else {
      // 公网端口留空，自动分配
      const protocolForAlloc = protocol === 'both' ? 'tcp' : protocol
      const allocatedPorts = await db.allocatePorts(
        instance.host_id,
        privatePortCount,
        protocolForAlloc,
        protocol === 'both'  // Both 模式需要同时检查 TCP 和 UDP
      )

      if (allocatedPorts.length < privatePortCount) {
        return reply.code(503).send({
          error: ErrorCode.PORT_NO_AVAILABLE,
          message: `可用端口不足，需要 ${privatePortCount} 个，只有 ${allocatedPorts.length} 个可用`
        })
      }

      // 排序以保证顺序
      allocatedPorts.sort((a, b) => a - b)

      for (let i = 0; i < privatePortCount; i++) {
        finalMappings.push({
          privatePort: privatePortStart + i,
          publicPort: allocatedPorts[i]
        })
      }
    }

    // 6. 批量创建映射
    const createdMappings: Array<{ id: number; protocol: string; publicPort: number; privatePort: number }> = []
    const createdDeviceNames: string[] = []
    try {
      const client = await getIncusClient(host)

      // 对于 Both 模式，需要创建 TCP 和 UDP 两组映射
      const protocolsToCreate: Array<'tcp' | 'udp'> = protocol === 'both' ? ['tcp', 'udp'] : [protocol]

      for (const proto of protocolsToCreate) {
        for (const mapping of finalMappings) {
          // 再次检查端口是否被占用（防止并发冲突）
          const existingPort = await db.checkPortInUse(instance.host_id, mapping.publicPort, proto)
          if (existingPort) {
            // 回滚已创建的映射
            for (const created of createdMappings) {
              try {
                const deviceName = `proxy-${created.protocol}-${created.publicPort}`
                await removeDevice(client, instance.incus_id, deviceName)
                await removeDevice(client, instance.incus_id, `${deviceName}-v6`)
                await db.deletePortMapping(created.id)
              } catch (e) {
                // 忽略回滚错误
              }
            }
            return reply.code(400).send(apiError(ErrorCode.PORT_IN_USE, `端口 ${mapping.publicPort} (${proto.toUpperCase()}) 已被占用`))
          }

          const deviceName = `proxy-${proto}-${mapping.publicPort}`
          // 获取当前用于建立底层设备的实例准确类别
          let isVM = false;
          if (instance.package_id) {
            const pkg = await prisma.package.findUnique({
              where: { id: instance.package_id }
            });
            isVM = !!pkg && (('instance_type' in pkg && pkg.instance_type === 'vm') || ('instanceType' in pkg && pkg.instanceType === 'vm'));
          }
          const actualInstanceType = isVM ? 'virtual-machine' : 'container';
          if (instance.network_mode === 'ipv6_only') {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'IPv6 Only instances do not require port mappings'))
          }

          // 提取确切 IPv6 供给代理防崩
          let explicitBatchIpv6 = (host as any).nat_bind_ipv6 || host.nat_public_ipv6 || host.ipv6_gateway || (host.ip_address?.includes(':') ? host.ip_address : null);
          if (!explicitBatchIpv6 && host) {
            try {
              const ipv6Alias = await prisma.hostAddressAlias.findFirst({
                where: { hostId: host.id, kind: 'ipv6' },
                select: { address: true }
              })
              if (ipv6Alias?.address) explicitBatchIpv6 = ipv6Alias.address
            } catch { }
          }

          // == 一切参数交付给隔离后的独立网络策略类以规避共振 ==
          const proxyStrategy = ProxyStrategyFactory.getStrategy(actualInstanceType);
          const bindableIpv4 = selectBindableIpv4ListenAddress(
            (host as any).nat_bind_ip || null,
            host.nat_public_ip || null,
            host.url,
            host.ip_address || null
          )
          const proxyDeviceRes = proxyStrategy.createProxyDevice(bindableIpv4, explicitBatchIpv6, instance.network_mode, proto, mapping.publicPort, mapping.privatePort);

          const deviceConfigs = proxyDeviceRes.deviceConfigs
            || (proxyDeviceRes.deviceConfig ? [{ deviceConfig: proxyDeviceRes.deviceConfig }] : [])

          if (!proxyDeviceRes.success || deviceConfigs.length === 0) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, proxyDeviceRes.errorMessage || '代理对象工厂拦截异常'));
          }

          for (const deviceEntry of deviceConfigs) {
            const resolvedDeviceName = `${deviceName}${deviceEntry.nameSuffix || ''}`
            await addDevice(client, instance.incus_id, resolvedDeviceName, deviceEntry.deviceConfig as Record<string, string>)
            createdDeviceNames.push(resolvedDeviceName)
          }

          const mappingId = await db.createPortMapping({
            instanceId,
            hostId: instance.host_id,
            protocol: proto,
            publicPort: mapping.publicPort,
            privatePort: mapping.privatePort,
            remark: remark?.trim()
          })

          createdMappings.push({
            id: mappingId,
            protocol: proto,
            publicPort: mapping.publicPort,
            privatePort: mapping.privatePort
          })
        }
      }

      await createLog(
        user.id,
        'instance',
        'port.batch_add',
        `Batch added ${createdMappings.length} port mappings for instance "${instance.name}" [host: ${host?.name || 'unknown'}, ${protocol.toUpperCase()}, ports: ${privatePortStart}-${privatePortEnd}]`,
        'success',
        { instanceId }
      )

      return {
        message: 'Batch port mapping added',
        mappings: createdMappings,
        count: createdMappings.length
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      try {
        const client = await getIncusClient(host)
        for (const createdDeviceName of createdDeviceNames) {
          await removeDevice(client, instance.incus_id, createdDeviceName)
        }
        for (const created of createdMappings) {
          await db.deletePortMapping(created.id)
        }
      } catch {
        // 忽略回滚失败，保留原始错误
      }
      await createLog(user.id, 'instance', 'port.batch_add', `Failed to batch add port mappings: ${errorMessage}`, 'failed', { instanceId })
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 设置实例配额
  fastify.patch<{
    Params: { id: string }
    Body: {
      portLimit?: number | null
      snapshotLimit?: number | null
      backupLimit?: number | null
      siteLimit?: number | null
    }
  }>('/:id/quota', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          portLimit: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
          snapshotLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
          backupLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
          siteLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      portLimit?: number | null
      snapshotLimit?: number | null
      backupLimit?: number | null
      siteLimit?: number | null
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { portLimit, snapshotLimit, backupLimit, siteLimit } = request.body
    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员或宿主机所有者可以修改实例配额
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }
    if (user.role !== 'admin' && host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 新配额系统：实例级别的端口/快照/备份/站点限制独立存储，不再与用户配额关联
    const newPortLimit = portLimit !== undefined ? (portLimit || null) : instance.port_limit
    const newSnapshotLimit = snapshotLimit !== undefined ? (snapshotLimit || null) : instance.snapshot_limit
    const newBackupLimit = backupLimit !== undefined ? (backupLimit || null) : instance.backup_limit
    const newSiteLimit = siteLimit !== undefined ? (siteLimit === 0 ? 0 : (siteLimit || null)) : instance.site_limit

    const portMappings = await db.getPortMappings(instanceId)
    const currentPortUsed = portMappings.length

    // 使用 Prisma 查询快照和备份数量
    const currentSnapshotUsed = await prisma.snapshot.count({
      where: { instanceId }
    })

    const currentBackupUsed = await prisma.backup.count({
      where: {
        instanceId,
        status: { not: 'deleted' }
      }
    })

    // 验证新限制不小于当前使用量
    if (newPortLimit !== null && newPortLimit < currentPortUsed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_PORT_BELOW_USED, `used: ${currentPortUsed}, set: ${newPortLimit}`))
    }

    if (newSnapshotLimit !== null && newSnapshotLimit < currentSnapshotUsed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_SNAPSHOT_BELOW_USED, `used: ${currentSnapshotUsed}, set: ${newSnapshotLimit}`))
    }

    if (newBackupLimit !== null && newBackupLimit < currentBackupUsed) {
      return reply.code(400).send(apiError(ErrorCode.QUOTA_BACKUP_BELOW_USED, `used: ${currentBackupUsed}, set: ${newBackupLimit}`))
    }

    // 验证：端口数、快照数、备份数必须在 1-1000 范围内（null 表示不限制）
    if (newPortLimit !== null && (newPortLimit < 1 || newPortLimit > 1000)) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, 'Port limit must be between 1 and 1000'))
    }

    if (newSnapshotLimit !== null && (newSnapshotLimit < 1 || newSnapshotLimit > 1000)) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, 'Snapshot limit must be between 1 and 1000'))
    }

    if (newBackupLimit !== null && (newBackupLimit < 1 || newBackupLimit > 1000)) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, 'Backup limit must be between 1 and 1000'))
    }

    // 验证站点限制：0 表示无配额，null 表示继承套餐
    if (newSiteLimit !== null && (newSiteLimit < 0 || newSiteLimit > 1000)) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, 'Site limit must be between 0 and 1000 (0 = no quota)'))
    }

    // 更新实例配额
    await db.updateInstanceQuota(instanceId, {
      portLimit: portLimit !== undefined ? (portLimit ?? undefined) : undefined,
      snapshotLimit: snapshotLimit !== undefined ? (snapshotLimit ?? undefined) : undefined,
      backupLimit: backupLimit !== undefined ? (backupLimit ?? undefined) : undefined,
      siteLimit: siteLimit !== undefined ? (siteLimit ?? undefined) : undefined
    })

    const quotaChanges: string[] = []
    if (portLimit !== undefined) quotaChanges.push(`port: ${portLimit}`)
    if (snapshotLimit !== undefined) quotaChanges.push(`snapshot: ${snapshotLimit === 0 ? 'no quota' : snapshotLimit}`)
    if (backupLimit !== undefined) quotaChanges.push(`backup: ${backupLimit === 0 ? 'no quota' : backupLimit}`)
    if (siteLimit !== undefined) quotaChanges.push(`site: ${siteLimit === 0 ? 'no quota' : (siteLimit || 'inherit')}`)

    await createLog(
      user.id,
      'instance',
      'instance.update_quota',
      `Updated instance "${instance.name}" quota: ${quotaChanges.join(', ')}`,
      'success',
      { instanceId }
    )

    return { message: 'Instance quota updated' }
  })

  // ==================== 修改实例资源配置 ====================

  /**
   * 修改实例资源配置（CPU、内存、磁盘）
   * 支持单项或多项同时修改，实时生效无需重启
   */
  fastify.patch<{
    Params: { id: string }
    Body: {
      cpu?: number
      memory?: number
      disk?: number
    }
  }>('/:id/config', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          cpu: { type: 'integer', minimum: 15, maximum: 10000 },
          memory: { type: 'integer', minimum: 128, maximum: 524288 },
          disk: { type: 'number', minimum: 512, maximum: 10485760 },
          monthlyTrafficLimit: { type: ['string', 'null'] }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      cpu?: number
      memory?: number
      disk?: number
      monthlyTrafficLimit?: string | null
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { cpu, memory, disk } = request.body
    const { user } = request

    // 检查是否有任何修改
    const { monthlyTrafficLimit } = request.body as { monthlyTrafficLimit?: string | null }
    if (cpu === undefined && memory === undefined && disk === undefined && monthlyTrafficLimit === undefined) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_NO_CHANGES))
    }

    // 获取实例
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 获取宿主机信息
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限验证：管理员或宿主机所有者可以修改配置
    if (user.role !== 'admin' && host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查实例状态：只有 running 或 stopped 状态才能修改配置
    if (instance.status !== 'running' && instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID, `current status: ${instance.status}`))
    }

    // 计算新配置值（未修改的保持原值）
    // disk 可能是小数（前端以 GB 为单位转换为 MB），需要四舍五入
    const newCpu = cpu ?? instance.cpu
    const newMemory = memory ?? instance.memory
    const newDisk = disk !== undefined ? Math.round(disk) : instance.disk
    // 流量限制：如果传入null则清空，如果传入字符串则转换为BigInt
    let newTrafficLimit: bigint | null = null
    if (monthlyTrafficLimit !== undefined) {
      if (monthlyTrafficLimit === null || monthlyTrafficLimit === '') {
        newTrafficLimit = null
      } else {
        try {
          newTrafficLimit = BigInt(monthlyTrafficLimit)
          if (newTrafficLimit < 0n) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Traffic limit must be non-negative'))
          }
        } catch {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid traffic limit format'))
        }
      }
    } else {
      // 未修改时保持原值
      newTrafficLimit = instance.monthly_traffic_limit ? BigInt(instance.monthly_traffic_limit) : null
    }

    // 宿主机所有者修改配置时不再进行套餐匹配验证

    // 宿主机信息已在权限检查时获取

    // 磁盘缩小限制：只有ZFS文件系统允许缩小，且不能小于已用容量
    if (disk !== undefined && disk < instance.disk) {
      // 获取storageDriver（可能是storage_driver或storageDriver）
      const storageDriver = (host as any).storage_driver || (host as any).storageDriver || 'lvm'

      // 只有ZFS文件系统允许缩小
      if (storageDriver !== 'zfs') {
        return reply.code(400).send(apiError(ErrorCode.CONFIG_DISK_CANNOT_SHRINK, `current: ${instance.disk} MB`))
      }

      // ZFS允许缩小，但需要检查不能小于已用容量
      // 获取当前实例的已用磁盘容量
      let diskUsageMB = 0
      if (instance.status === 'running') {
        try {
          const client = await getIncusClient(host)
          const state = await getInstanceState(client, instance.incus_id) as {
            disk?: { root?: { usage?: number } }
          }
          if (state.disk?.root?.usage) {
            diskUsageMB = Math.ceil(state.disk.root.usage / 1024 / 1024)
          }
        } catch (err) {
          console.error('获取实例磁盘使用量失败:', err)
          // 如果获取失败，使用保守策略：不允许缩小
          return reply.code(400).send(apiError(ErrorCode.CONFIG_DISK_CANNOT_SHRINK, `无法获取磁盘使用量，不允许缩小`))
        }
      } else {
        // 实例未运行，无法获取实时使用量，使用保守策略：不允许缩小到小于当前磁盘的90%
        // 这是一个安全措施，避免缩小过多导致数据丢失
        diskUsageMB = Math.ceil(instance.disk * 0.9)
      }

      // 不能缩小到小于已用容量
      if (disk < diskUsageMB) {
        return reply.code(400).send(apiError(ErrorCode.CONFIG_DISK_CANNOT_SHRINK, `不能缩小到小于已用容量 ${diskUsageMB} MB`))
      }
    }

    // 计算资源变化量
    const cpuDelta = newCpu - instance.cpu
    const memoryDelta = newMemory - instance.memory
    const diskDelta = newDisk - instance.disk
    const currentTrafficLimit = instance.monthly_traffic_limit ? BigInt(instance.monthly_traffic_limit) : null
    const trafficChanged = monthlyTrafficLimit !== undefined && newTrafficLimit !== currentTrafficLimit

    // 如果没有实际变化，直接返回成功
    if (cpuDelta === 0 && memoryDelta === 0 && diskDelta === 0 && !trafficChanged) {
      return { message: 'No changes applied', instance: { id: instanceId, cpu: instance.cpu, memory: instance.memory, disk: instance.disk } }
    }

    // 新配额系统：CPU/内存/磁盘限制在套餐包级别，不再检查用户配额

    // 验证宿主机资源（只检查增量）

    // 检查宿主机 CPU 配额
    if (cpuDelta > 0) {
      const cpuAllowanceMax = (host as any).cpu_allowance_max
      if (cpuAllowanceMax && cpuAllowanceMax > 0) {
        if (host.cpu_used + cpuDelta > cpuAllowanceMax) {
          return reply.code(400).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, `CPU allowance insufficient`))
        }
      }
    }

    // 检查宿主机内存
    if (memoryDelta > 0) {
      const memoryMax = (host as any).memory_max || 0
      if (memoryMax > 0 && host.memory_used + memoryDelta > memoryMax) {
        return reply.code(400).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, `Memory insufficient`))
      }
    }

    // 磁盘配额检查已移除：不再限制磁盘空间

    try {
      // 调用 Incus API 更新配置
      const client = await getIncusClient(host)

      const { patchInstanceResources } = await import('../lib/incus/incus-instances.js')
      await patchInstanceResources(client, instance.incus_id, {
        cpu: cpu !== undefined ? newCpu : undefined,
        memory: memory !== undefined ? newMemory : undefined,
        disk: disk !== undefined ? newDisk : undefined
      })

      // 更新数据库
      await db.updateInstanceResources(instanceId, {
        cpu: cpu !== undefined ? newCpu : undefined,
        memory: memory !== undefined ? newMemory : undefined,
        disk: disk !== undefined ? newDisk : undefined,
        monthlyTrafficLimit: monthlyTrafficLimit !== undefined ? newTrafficLimit : undefined
      })

      // 新配额系统：不再更新用户配额使用量（CPU/内存/磁盘不在用户级别限制）

      // 更新宿主机资源使用量
      if (cpuDelta !== 0 || memoryDelta !== 0 || diskDelta !== 0) {
        await db.updateHostResources(instance.host_id, {
          cpuUsed: host.cpu_used + cpuDelta,
          memoryUsed: host.memory_used + memoryDelta,
          diskUsed: host.disk_used + diskDelta
        })
      }

      // 记录日志
      const changes: string[] = []
      if (cpu !== undefined) changes.push(`CPU: ${instance.cpu}% → ${newCpu}%`)
      if (memory !== undefined) changes.push(`Memory: ${instance.memory}MB → ${newMemory}MB`)
      if (disk !== undefined) changes.push(`Disk: ${instance.disk}MB → ${newDisk}MB`)
      if (monthlyTrafficLimit !== undefined) {
        const currentGB = currentTrafficLimit ? (Number(currentTrafficLimit) / (1024 * 1024 * 1024)).toFixed(1) : '0'
        const newGB = newTrafficLimit ? (Number(newTrafficLimit) / (1024 * 1024 * 1024)).toFixed(1) : '0'
        changes.push(`Traffic: ${currentGB}GB → ${newGB}GB`)
      }

      await createLog(
        user.id,
        'instance',
        'instance.update_config',
        `Updated instance "${instance.name}" config: ${changes.join(', ')}`,
        'success',
        { instanceId }
      )

      return {
        message: 'Instance configuration updated',
        instance: {
          id: instanceId,
          cpu: newCpu,
          memory: newMemory,
          disk: newDisk
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        'instance',
        'instance.update_config',
        `Failed to update instance "${instance.name}" config: ${errorMessage}`,
        'failed',
        { instanceId }
      )
      return reply.code(500).send(apiError(ErrorCode.CONFIG_UPDATE_FAILED, errorMessage))
    }
  })

  // ==================== 复制实例 ====================

  /**
   * 复制实例（克隆）
   * 要求：实例必须处于停止状态
   */
  fastify.post<{ Params: { id: string } }>('/:id/clone', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)
    const { user } = request

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const sourceInstance = await db.getInstanceById(instanceId)
    if (!sourceInstance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // AUTH004: 克隆实例仅限实例所有者，管理员和宿主机所有者禁止
    // 原因：克隆会复制实例数据，属于敏感操作
    if (sourceInstance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许克隆
    if (sourceInstance.status === 'suspended') {
      if (sourceInstance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 获取宿主机信息
    const host = await db.getHostById(sourceInstance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查实例状态：必须是停止状态
    if (sourceInstance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STOP_REQUIRED))
    }

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    // 检查宿主机资源是否足够（克隆会消耗与源实例相同的资源）
    const hostWithQuota = host as typeof host & { cpu_allowance_max?: number; memory_max?: number; storage_size?: number }
    const cpuAvailable = (hostWithQuota.cpu_allowance_max || 0) - (host.cpu_used || 0)
    const memoryAvailable = (hostWithQuota.memory_max || 0) - (host.memory_used || 0)
    const diskAvailable = ((hostWithQuota.storage_size || 0) * 1024) - (host.disk_used || 0)

    if (sourceInstance.cpu > cpuAvailable) {
      return reply.code(400).send({
        error: `宿主机 CPU 资源不足，需要 ${sourceInstance.cpu}%，可用 ${cpuAvailable}%`,
        code: 'HOST_RESOURCES_INSUFFICIENT'
      })
    }
    if (sourceInstance.memory > memoryAvailable) {
      return reply.code(400).send({
        error: `宿主机内存资源不足，需要 ${sourceInstance.memory}MB，可用 ${memoryAvailable}MB`,
        code: 'HOST_RESOURCES_INSUFFICIENT'
      })
    }
    if (sourceInstance.disk > diskAvailable) {
      return reply.code(400).send({
        error: `宿主机磁盘资源不足，需要 ${sourceInstance.disk}MB，可用 ${diskAvailable}MB`,
        code: 'HOST_RESOURCES_INSUFFICIENT'
      })
    }

    // 创建异步任务
    const task = await createInstanceTask({
      instanceId,
      hostId: sourceInstance.host_id,
      userId: user.id,
      taskType: 'clone'
    })

    await createLog(
      user.id,
      'instance',
      'instance.clone',
      `Queued clone task for instance "${sourceInstance.name}"`,
      'success',
      { instanceId }
    )

    reply.code(202).send({
      message: 'Instance clone task queued',
      taskId: task.id,
      status: task.status
    })
  })

  // ==================== 重命名实例 ====================

  /**
   * 重命名实例（修改显示名称，不影响 Incus ID）
   */
  fastify.patch<{
    Params: { id: string }
    Body: { name: string }
  }>('/:id/rename', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const instanceId = Number(id)
    const user = request.user

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 验证权限
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许重命名
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    const { name } = request.body
    const oldName = instance.name

    await db.updateInstance(instanceId, { name })

    await createLog(
      user.id,
      'instance',
      'instance.rename',
      `Renamed instance from "${oldName}" to "${name}"`,
      'success',
      { instanceId }
    )

    return { message: 'Instance renamed', name }
  })

  // ==================== 实例配置 API ====================

  // 获取实例配置（合并套餐默认值和实例覆盖值）
  fastify.get<{ Params: { id: string } }>('/:id/config', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取实例的完整配置（包含覆盖字段）
    const instanceConfig = await db.getInstanceConfig(instanceId)
    if (!instanceConfig) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 获取套餐默认值
    let packageDefaults = null
    let ioLimitMode: 'throughput' | 'iops' = 'throughput'
    let swapKind: 'container' | 'vm' = 'container'
    let panelSwapSupported = true
    if (instance.package_id) {
      const pkg = await db.getPackageById(instance.package_id)
      if (pkg) {
        ioLimitMode = pkg.io_limit_mode === 'iops' ? 'iops' : 'throughput'
        swapKind = pkg.instance_type === 'vm' ? 'vm' : 'container'
        panelSwapSupported = swapKind === 'container'
        packageDefaults = {
          limits_read: pkg.limits_read,
          limits_write: pkg.limits_write,
          limits_read_iops: pkg.limits_read_iops,
          limits_write_iops: pkg.limits_write_iops,
          limits_ingress: pkg.limits_ingress,
          limits_egress: pkg.limits_egress,
          limits_processes: pkg.limits_processes,
          limits_cpu_priority: pkg.limits_cpu_priority,
          boot_autostart: pkg.boot_autostart,
          boot_autostart_priority: pkg.boot_autostart_priority,
          boot_autostart_delay: pkg.boot_autostart_delay,
          boot_host_shutdown_timeout: pkg.boot_host_shutdown_timeout
        }
      }
    }

    // 系统默认值
    const systemDefaults = {
      limits_read: '100MB',
      limits_write: '100MB',
      limits_read_iops: 500,
      limits_write_iops: 500,
      limits_ingress: '300Mbit',
      limits_egress: '300Mbit',
      limits_processes: 500,
      limits_cpu_priority: 10,
      boot_autostart: true,
      boot_autostart_priority: 20,
      boot_autostart_delay: 15,
      boot_host_shutdown_timeout: 30
    }

    // 合并配置：实例覆盖 > 套餐默认 > 系统默认
    const defaults = packageDefaults || systemDefaults
    const effectiveConfig = {
      limits_read: instanceConfig.limits_read ?? defaults.limits_read,
      limits_write: instanceConfig.limits_write ?? defaults.limits_write,
      limits_read_iops: instanceConfig.limits_read_iops ?? defaults.limits_read_iops,
      limits_write_iops: instanceConfig.limits_write_iops ?? defaults.limits_write_iops,
      limits_ingress: instanceConfig.limits_ingress ?? defaults.limits_ingress,
      limits_egress: instanceConfig.limits_egress ?? defaults.limits_egress,
      limits_processes: instanceConfig.limits_processes ?? defaults.limits_processes,
      limits_cpu_priority: instanceConfig.limits_cpu_priority ?? defaults.limits_cpu_priority,
      boot_autostart: instanceConfig.boot_autostart ?? defaults.boot_autostart,
      boot_autostart_priority: instanceConfig.boot_autostart_priority ?? defaults.boot_autostart_priority,
      boot_autostart_delay: instanceConfig.boot_autostart_delay ?? defaults.boot_autostart_delay,
      boot_host_shutdown_timeout: instanceConfig.boot_host_shutdown_timeout ?? defaults.boot_host_shutdown_timeout
    }

    // 标记哪些字段是覆盖的
    const overrides = {
      limits_read: instanceConfig.limits_read !== null,
      limits_write: instanceConfig.limits_write !== null,
      limits_read_iops: instanceConfig.limits_read_iops !== null,
      limits_write_iops: instanceConfig.limits_write_iops !== null,
      limits_ingress: instanceConfig.limits_ingress !== null,
      limits_egress: instanceConfig.limits_egress !== null,
      limits_processes: instanceConfig.limits_processes !== null,
      limits_cpu_priority: instanceConfig.limits_cpu_priority !== null,
      boot_autostart: instanceConfig.boot_autostart !== null,
      boot_autostart_priority: instanceConfig.boot_autostart_priority !== null,
      boot_autostart_delay: instanceConfig.boot_autostart_delay !== null,
      boot_host_shutdown_timeout: instanceConfig.boot_host_shutdown_timeout !== null
    }

    const currentPlan = instance.package_plan_id ? await getPlanById(instance.package_plan_id) : null
    const effectiveSwapSizeMb = panelSwapSupported
      ? resolveEffectiveSwapSize(instance.swap_size, currentPlan?.swapSize)
      : 0
    const swapEnabled = panelSwapSupported && instance.swap_enabled === true
    const swapAvailable = panelSwapSupported && (swapEnabled || effectiveSwapSizeMb > 0)

    return {
      config: effectiveConfig,
      overrides,
      packageDefaults: packageDefaults || systemDefaults,
      ioLimitMode,
      swap: {
        available: swapAvailable,
        enabled: swapEnabled,
        sizeMb: effectiveSwapSizeMb,
        kind: swapKind,
        requiresRunning: swapKind === 'vm'
      }
    }
  })

  // 启用实例 SWAP
  fastify.post<{ Params: { id: string } }>('/:id/swap/enable', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (user.role !== 'admin' && instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status !== 'running' && instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID, `current status: ${instance.status}`))
    }

    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const instanceKind: 'container' | 'vm' = pkg?.instance_type === 'vm' ? 'vm' : 'container'
    if (instanceKind === 'vm') {
      return reply.code(400).send(apiError(ErrorCode.FEATURE_DISABLED, '虚拟机不支持面板管理 SWAP'))
    }
    const currentPlan = instance.package_plan_id ? await getPlanById(instance.package_plan_id) : null
    const effectiveSwapSizeMb = resolveEffectiveSwapSize(instance.swap_size, currentPlan?.swapSize)

    if (instance.swap_enabled === true) {
      return {
        message: 'SWAP already enabled',
        swapEnabled: true,
        swapSize: effectiveSwapSizeMb
      }
    }

    if (effectiveSwapSizeMb <= 0) {
      return reply.code(400).send(apiError(ErrorCode.FEATURE_DISABLED, '当前方案未提供 SWAP'))
    }

    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    try {
      const client = await getIncusClient(host)

      if (instanceKind === 'container') {
        await updateInstance(client, instance.incus_id, {
          config: {
            'limits.memory.swap': resolveIncusSwapValue(true, effectiveSwapSizeMb)
          }
        })
      }

      await db.updateInstanceSwap(instanceId, {
        swapEnabled: true,
        swapSize: effectiveSwapSizeMb
      })

      await createLog(
        user.id,
        'instance',
        'instance.enable_swap',
        `Enabled SWAP for instance "${instance.name}" (${effectiveSwapSizeMb}MB)`,
        'success',
        { instanceId }
      )

      return {
        message: 'SWAP enabled',
        swapEnabled: true,
        swapSize: effectiveSwapSizeMb
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        'instance',
        'instance.enable_swap',
        `Failed to enable SWAP for instance "${instance.name}": ${errorMessage}`,
        'failed',
        { instanceId }
      )
      return reply.code(500).send(apiError(ErrorCode.CONFIG_UPDATE_FAILED, errorMessage))
    }
  })

  // 关闭实例 SWAP
  fastify.post<{ Params: { id: string } }>('/:id/swap/disable', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (user.role !== 'admin' && instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status !== 'running' && instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID, `current status: ${instance.status}`))
    }

    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const instanceKind: 'container' | 'vm' = pkg?.instance_type === 'vm' ? 'vm' : 'container'
    if (instanceKind === 'vm') {
      return reply.code(400).send(apiError(ErrorCode.FEATURE_DISABLED, '虚拟机不支持面板管理 SWAP'))
    }

    const currentPlan = instance.package_plan_id ? await getPlanById(instance.package_plan_id) : null
    const currentSwapSizeMb = resolveEffectiveSwapSize(instance.swap_size, currentPlan?.swapSize)

    if (instance.swap_enabled !== true) {
      return {
        message: 'SWAP already disabled',
        swapEnabled: false,
        swapSize: currentSwapSizeMb
      }
    }

    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    try {
      const client = await getIncusClient(host)

      await updateInstance(client, instance.incus_id, {
        config: {
          'limits.memory.swap': resolveIncusSwapValue(false, currentSwapSizeMb)
        }
      })

      await db.updateInstanceSwap(instanceId, {
        swapEnabled: false
      })

      await createLog(
        user.id,
        'instance',
        'instance.disable_swap',
        `Disabled SWAP for instance "${instance.name}"`,
        'success',
        { instanceId }
      )

      return {
        message: 'SWAP disabled',
        swapEnabled: false,
        swapSize: currentSwapSizeMb
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        'instance',
        'instance.disable_swap',
        `Failed to disable SWAP for instance "${instance.name}": ${errorMessage}`,
        'failed',
        { instanceId }
      )
      return reply.code(500).send(apiError(ErrorCode.CONFIG_UPDATE_FAILED, errorMessage))
    }
  })

  // 更新实例配置覆盖（已禁用）
  fastify.patch<{
    Params: { id: string }
    Body: {
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
  }>('/:id/advanced-config', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
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
  }, async (_request: FastifyRequest<{
    Params: { id: string }
    Body: {
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
  }>, reply: FastifyReply) => {
    // 功能已禁用，直接返回 403
    return reply.code(403).send(apiError(ErrorCode.FEATURE_DISABLED))
  })

  // 提升进程数限制
  // LXC 实例提升到 1000，KVM 实例提升到 2000
  fastify.post<{
    Params: { id: string }
  }>('/:id/boost-processes', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：只有实例所有者可以提升进程数
    if (instance.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取宿主机信息
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 获取实例类型（从套餐获取）
    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const instanceType = (pkg as { instance_type?: 'container' | 'vm' } | null)?.instance_type || 'container'

    // 确定进程数上限：LXC=1000, KVM=2000
    const targetLimit = instanceType === 'vm' ? 2000 : 1000

    // 获取当前进程数配置
    const instanceConfig = await db.getInstanceConfig(instanceId)
    const currentProcesses = instanceConfig?.limits_processes ?? 500

    // 检查是否已达上限
    if (currentProcesses >= targetLimit) {
      return reply.code(400).send({
        error: `Process limit already at maximum (${targetLimit})`,
        code: 'PROCESS_LIMIT_ALREADY_MAX'
      })
    }

    // 更新数据库中的实例配置
    await db.updateInstanceConfig(instanceId, {
      limitsProcesses: targetLimit
    })

    // 应用配置到 Incus 容器
    try {
      const client = await getIncusClient(host)
      await updateInstance(client, instance.incus_id, {
        config: {
          'limits.processes': String(targetLimit)
        }
      })
    } catch (err) {
      console.error(`[BoostProcesses] Failed to apply to Incus for instance ${instance.name}:`, err)
      // 不抛出错误，数据库已更新成功
    }

    await createLog(
      user.id,
      'instance',
      'instance.boost_processes',
      `Boosted process limit for instance "${instance.name}" to ${targetLimit}`,
      'success',
      { instanceId }
    )

    return {
      message: 'Process limit boosted successfully',
      newLimit: targetLimit
    }
  })

  // 获取实例的活跃任务
  fastify.get<{ Params: { id: string } }>('/:id/task', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查
    const hasPermission = await checkInstanceOperationPermission(user, instance)
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const task = await getActiveTaskForInstance(instanceId)
    if (!task) {
      return { task: null }
    }

    // 获取队列位置
    const queuePosition = task.status === 'PENDING' ? await getTaskQueuePosition(task.id, task.hostId) : 0

    return {
      task: {
        id: task.id,
        taskType: task.taskType,
        status: task.status,
        progress: task.progress,
        error: task.error,
        queuePosition,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt
      }
    }
  })

  // 获取任务详情
  fastify.get<{ Params: { taskId: string } }>('/tasks/:taskId', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
    const { taskId } = request.params
    const taskIdNum = Number(taskId)

    if (isNaN(taskIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const task = await getInstanceTaskById(taskIdNum)
    if (!task) {
      return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    }

    // 权限检查：任务创建者、管理员或节点所有者可以查看
    let hasPermission = task.userId === user.id || user.role === 'admin'

    // 检查是否是节点所有者
    if (!hasPermission) {
      const host = await db.getHostById(task.hostId)
      if (host && host.user_id === user.id) {
        hasPermission = true
      }
    }

    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取队列位置
    const queuePosition = task.status === 'PENDING' ? await getTaskQueuePosition(task.id, task.hostId) : 0

    // 获取实例信息
    const instance = await db.getInstanceById(task.instanceId)

    return {
      task: {
        id: task.id,
        instanceId: task.instanceId,
        instanceName: instance?.name || null,
        taskType: task.taskType,
        status: task.status,
        progress: task.progress,
        error: task.error,
        queuePosition,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        newInstanceId: task.newInstanceId
      }
    }
  })

  // 取消任务（仅 PENDING 状态可取消）
  fastify.delete<{ Params: { taskId: string } }>('/tasks/:taskId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
    const { taskId } = request.params
    const taskIdNum = Number(taskId)

    if (isNaN(taskIdNum)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const task = await getInstanceTaskById(taskIdNum)
    if (!task) {
      return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    }

    // 权限检查：只有任务创建者可以取消任务
    if (task.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 只能取消 PENDING 状态的任务
    if (task.status !== 'PENDING') {
      return reply.code(400).send({
        error: '只能取消等待中的任务',
        code: 'TASK_CANNOT_CANCEL',
        currentStatus: task.status
      })
    }

    const cancelledTask = await cancelInstanceTask(taskIdNum)
    if (!cancelledTask) {
      return reply.code(400).send({
        error: '取消任务失败',
        code: 'CANCEL_FAILED'
      })
    }

    await createLog(
      user.id,
      'instance',
      'task.cancel',
      `Cancelled ${task.taskType} task #${task.id} for instance #${task.instanceId}`,
      'success',
      { instanceId: task.instanceId }
    )

    return {
      message: 'Task cancelled',
      task: {
        id: cancelledTask.id,
        status: cancelledTask.status
      }
    }
  })

  // ==================== Cloud-init 状态检查 ====================

  /**
   * 检查实例 Cloud-init 初始化状态
   * GET /instances/:id/cloud-init-status
   */
  fastify.get<{ Params: { id: string } }>('/:id/cloud-init-status', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查（与终端路由保持一致，管理员可访问所有实例）
    let hasPermission = false
    if (user.role === 'admin') {
      hasPermission = true
    } else {
      hasPermission = await checkInstanceOperationPermission(user, instance)
    }
    if (!hasPermission) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 实例必须处于运行状态
    if (instance.status !== 'running') {
      return reply.code(400).send({
        error: 'Instance must be running to check cloud-init status',
        code: 'INSTANCE_NOT_RUNNING'
      })
    }

    // 检查 incus_id 是否存在（实例可能正在创建中）
    if (!instance.incus_id) {
      return reply.code(400).send({
        error: 'Instance is not fully provisioned',
        code: 'INSTANCE_NOT_PROVISIONED'
      })
    }

    const cachedStatus = getCachedCloudInitStatus(instance)
    if (cachedStatus) {
      return cachedStatus
    }

    // 获取宿主机信息
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    try {
      const client = await getIncusClient(host)

      console.log(`[CloudInit] Checking status for instance ${instance.name} (${instance.incus_id})`)

      const result = await detectCloudInitStatus(client, {
        id: instance.id,
        image: instance.image,
        incus_id: instance.incus_id
      })
      await persistCloudInitStatus(instance.id, result)
      return result
    } catch (err) {
      console.error(`[CloudInit] Failed to connect for instance ${instance.name}:`, err)
      return {
        ready: false,
        state: 'unknown',
        source: 'unknown',
        manualOverride: false,
        message: 'Unable to check cloud-init status',
        detectedAt: new Date().toISOString()
      }
    }
  })

  /**
   * 手动将实例 cloud-init 标记为已完成
   * POST /instances/:id/cloud-init-status/manual-complete
   */
  fastify.post<{ Params: { id: string } }>('/:id/cloud-init-status/manual-complete', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (user.role !== 'admin' && instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (instance.status !== 'running') {
      return reply.code(400).send({
        error: 'Instance must be running to manually complete cloud-init',
        code: 'INSTANCE_NOT_RUNNING'
      })
    }

    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    if (!instance.incus_id) {
      return reply.code(400).send({
        error: 'Instance is not fully provisioned',
        code: 'INSTANCE_NOT_PROVISIONED'
      })
    }

    const now = new Date()
    const result = {
      ready: true,
      state: 'manual',
      source: 'manual',
      manualOverride: true,
      message: 'Cloud-init marked complete manually',
      detectedAt: now.toISOString()
    } as const

    await persistCloudInitStatus(instance.id, result, user.id)
    await createLog(
      user.id,
      'instance',
      'instance.cloud_init_manual_complete',
      `Manually marked cloud-init as completed for instance "${instance.name}"`,
      'success',
      { instanceId }
    )

    return result
  })

  // ==================== 重新分配 IPv6 地址 ====================

  /**
   * 重新分配 IPv6 地址
   * POST /instances/:id/reassign-ipv6
   * 
   * 仅限 nat_ipv6 模式的实例，必须处于 stopped 状态
   * 分配新的 IPv6 后需要重装系统才能生效
   */
  fastify.post<{ Params: { id: string } }>('/:id/reassign-ipv6', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const instanceId = Number(id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { user } = request

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：仅实例所有者可以重新分配 IPv6
    // 这是敏感操作，与重装系统权限一致
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许操作
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 实例必须处于停止状态
    if (instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STOP_REQUIRED))
    }

    // 检查网络模式：只有 nat_ipv6 模式才能重新分配 IPv6
    if (instance.network_mode !== 'nat_ipv6') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_IPV6_NOT_SUPPORTED))
    }

    // 检查冷却时间：每实例每天24小时只能重新分配一次
    const lastReassign = (instance as any).last_ipv6_reassign_at as Date | null
    if (lastReassign) {
      const cooldownMs = 24 * 60 * 60 * 1000 // 24小时
      const timeSinceLastReassign = Date.now() - new Date(lastReassign).getTime()
      if (timeSinceLastReassign < cooldownMs) {
        const remainingHours = Math.ceil((cooldownMs - timeSinceLastReassign) / (60 * 60 * 1000))
        return reply.code(429).send(apiError(ErrorCode.IPV6_REASSIGN_COOLDOWN, `请等待 ${remainingHours} 小时后再试`))
      }
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceId, reply)) return

    // 检查是否已有活跃任务
    const activeTask = await getActiveTaskForInstance(instanceId)
    if (activeTask) {
      return reply.code(409).send({
        error: 'Instance has an active task',
        code: 'TASK_IN_PROGRESS',
        taskId: activeTask.id,
        taskType: activeTask.taskType,
        status: activeTask.status
      })
    }

    // 获取宿主机信息
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查宿主机是否配置了 IPv6 子网
    const hostWithIpv6 = host as typeof host & {
      ipv6_subnet?: string | null
      ipv6_parent_interface?: string | null
    }
    if (!hostWithIpv6.ipv6_subnet) {
      return reply.code(400).send(apiError(ErrorCode.HOST_NO_IPV6_SUBNET))
    }

    try {
      // 1. 生成新的 IPv6 地址
      let newIPv6: string | null = null
      let attempts = 0
      const maxAttempts = 50

      while (attempts < maxAttempts) {
        newIPv6 = generateRandomIPv6(hostWithIpv6.ipv6_subnet)
        const exists = await db.isIpAddressExists(newIPv6)

        if (!exists) {
          console.log(`[ReassignIPv6] 为实例 ${instance.name} 分配新 IPv6: ${newIPv6} (尝试次数: ${attempts + 1})`)
          break
        }

        attempts++
        newIPv6 = null
      }

      if (!newIPv6) {
        return reply.code(503).send(apiError(ErrorCode.IPV6_POOL_EXHAUSTED))
      }

      const oldIPv6 = instance.ipv6

      // 2. 更新 Incus 实例的 eth1 设备配置
      const client = await getIncusClient(host)
      const instanceInfo = await getInstance(client, instance.incus_id) as {
        devices?: Record<string, Record<string, string>>
        config?: Record<string, string>
      }
      const devices = instanceInfo.devices || {}
      const { generateVmNicMacs } = await import('../lib/vm-network-identifiers.js')
      const generatedVmNicMacs = generateVmNicMacs(instance.incus_id)

      // 更新 eth1 设备的 IPv6 地址
      const eth1Device = devices['eth1'] || {
        type: 'nic',
        nictype: 'routed',
        parent: hostWithIpv6.ipv6_parent_interface || 'eth0',
        name: 'eth1',
        hwaddr: generatedVmNicMacs.eth1,
        'security.ipv6_filtering': 'true',
        'security.mac_filtering': 'true'
      }
      eth1Device['ipv6.address'] = newIPv6

      // 3. 更新 cloud-init network-config
      const { generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
      const nicMacs = {
        eth0: devices.eth0?.hwaddr || generatedVmNicMacs.eth0,
        eth1: eth1Device.hwaddr || devices.eth1?.hwaddr || generatedVmNicMacs.eth1
      }
      const networkConfig = generateCloudInitNetworkConfig({
        ipv4Address: instance.ipv4 || '10.0.0.2',  // 使用现有 IPv4
        ipv6List: [newIPv6],
        nicMacs
      })

      // 4. 应用更新到 Incus
      await updateInstance(client, instance.incus_id, {
        devices: {
          ...devices,
          eth1: eth1Device
        },
        config: {
          ...instanceInfo.config,
          'user.network-config': networkConfig
        }
      })

      // 5. 更新数据库记录
      // 5.1 更新 Instance 表的 ipv6 字段和冷却时间
      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          ipv6: newIPv6,
          lastIpv6ReassignAt: new Date() // 记录本次重新分配时间
        }
      })

      // 5.2 更新 IpAddress 表
      // 先删除旧的 IPv6 记录
      if (oldIPv6) {
        await prisma.ipAddress.deleteMany({
          where: {
            instanceId,
            type: 'inet6',
            address: oldIPv6
          }
        })
      }

      // 创建新的 IPv6 地址记录
      await db.createIpAddress({
        address: newIPv6,
        type: 'inet6',
        isPrimary: true,
        device: 'eth1',
        instanceId
      })

      // 6. 记录日志
      await createLog(
        user.id,
        'instance',
        'instance.reassign_ipv6',
        `Reassigned IPv6 for instance "${instance.name}": ${oldIPv6 || 'none'} → ${newIPv6}`,
        'success',
        { instanceId }
      )

      console.log(`[ReassignIPv6] 实例 ${instance.name} IPv6 已更新: ${oldIPv6} → ${newIPv6}`)

      return {
        message: 'IPv6 已重新分配，请重装系统使其生效',
        oldIpv6: oldIPv6,
        newIpv6: newIPv6
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[ReassignIPv6] 实例 ${instance.name} IPv6 重新分配失败:`, errorMessage)

      await createLog(
        user.id,
        'instance',
        'instance.reassign_ipv6',
        `Failed to reassign IPv6 for instance "${instance.name}": ${errorMessage}`,
        'failed',
        { instanceId }
      )

      return reply.code(500).send(apiError(ErrorCode.INSTANCE_IPV6_REASSIGN_FAILED, errorMessage))
    }
  })
}

// ==================== 辅助函数 ====================

/**
 * 异步创建实例
 */
async function createInstanceAsync(
  instanceId: number,
  host: Host,
  config: {
    name: string
    image: string
    cpu: number
    memory: number
    disk: number
    swapEnabled?: boolean
    swapSize?: number | null
    cloudInitConfig?: Record<string, string>
    networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    nested?: boolean
    privileged?: boolean
    portLimit?: number
    // 实例类型: container(容器) 或 vm(虚拟机)
    instanceType?: 'container' | 'vm'
    // SSH 端口（固定 22）
    sshPort?: number | null
    // 存储池配置
    storagePool?: string | null
    // IP 配置 (新双网卡架构)
    ipv4Address?: string | null  // 内网 IPv4 (随机分配)
    ipv6Address?: string | null  // IPv6 (随机分配)
    ipv6Gateway?: string | null
    hostInterface?: string | null  // 宿主机物理网卡名 (用于 routed 模式)
    // Advanced configuration options from package
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
  },
  userId: number,
  resources: { cpu: number; memory: number; disk: number }
): Promise<void> {
  try {
    console.log(`\n[Provisioning] ===== 开始创建实例流程 =====`)
    console.log(`[Provisioning] 实例ID: ${instanceId}, 名称: ${config.name}, 宿主机: ${host.name}`)

    const client = await getIncusClient(host)

    console.log(`[Provisioning] 正在构建 Incus 配置...`)
    // 构建 IPv6Config (如果有静态 IPv6)
    const ipv6Config = config.ipv6Address ? {
      primaryIp: config.ipv6Address
    } : null

    const incusConfig = buildInstanceConfig({
      name: config.name,
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      swapEnabled: config.swapEnabled,
      swapSize: config.swapSize,
      sshKey: '',
      password: '',
      cloudInitConfig: config.cloudInitConfig as { 'user.user-data': string } | undefined,
      networkMode: (config.networkMode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      nested: config.nested || false,
      privileged: config.privileged || false,
      instanceType: config.instanceType || 'container',
      // 存储池配置
      storagePool: config.storagePool || 'default',
      // IP 配置 (新双网卡架构)
      ipv4Address: config.ipv4Address,  // 内网 IPv4
      ipv6Config,
      hostInterface: config.hostInterface || 'eth0',
      // IPv6 静态地址配置 (向后兼容)
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
      // Advanced configuration options
      limitsRead: config.limitsRead,
      limitsWrite: config.limitsWrite,
      limitsReadIops: config.limitsReadIops,
      limitsWriteIops: config.limitsWriteIops,
      limitsIngress: config.limitsIngress,
      limitsEgress: config.limitsEgress,
      limitsProcesses: config.limitsProcesses,
      limitsCpuPriority: config.limitsCpuPriority,
      bootAutostart: config.bootAutostart,
      bootAutostartPriority: config.bootAutostartPriority,
      bootAutostartDelay: config.bootAutostartDelay,
      bootHostShutdownTimeout: config.bootHostShutdownTimeout
    })

    console.log(`[Provisioning] 开始创建实例 ${instanceId} (${config.name}) on ${host.name}`)
    console.log(`[Provisioning] 资源配置: CPU=${config.cpu}, Memory=${config.memory}MB, Disk=${config.disk}MB`)
    console.log(`[Provisioning] Incus 配置已生成，敏感字段已跳过日志输出`)

    await createInstance(client, incusConfig)
    const instanceTypeLabel = config.instanceType === 'vm' ? '虚拟机' : '容器'
    console.log(`[Provisioning] 实例 ${config.name} ${instanceTypeLabel}创建完成`)

    await startInstance(client, config.name)
    console.log(`[Provisioning] 实例 ${config.name} 启动命令已发送`)

    // KVM 虚拟机需要等待 QEMU 真正完成启动（BIOS→内核→cloud-init→agent）
    // 容器启动是瞬时的，不需要等待
    if (config.instanceType === 'vm') {
      console.log(`[Provisioning] VM ${config.name} 等待 QEMU 启动完成...`)
      const vmMaxWait = 90 // 最多等 90 轮 × 2秒 = 180秒
      let vmStarted = false
      for (let i = 0; i < vmMaxWait; i++) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          const vmState = await getInstanceState(client, config.name) as { status?: string }
          if (vmState.status === 'Running') {
            console.log(`[Provisioning] VM ${config.name} 已确认启动 (耗时 ${(i + 1) * 2}s)`)
            vmStarted = true
            break
          }
          if (i % 10 === 0) {
            console.log(`[Provisioning] VM ${config.name} 等待启动中... (${(i + 1) * 2}s, 状态: ${vmState.status || 'unknown'})`)
          }
        } catch { /* 继续等待 */ }
      }
      if (!vmStarted) {
        console.warn(`[Provisioning] VM ${config.name} 启动等待超时 (180s)，继续流程`)
      }
    }

    // 使用传入的静态 IP 地址
    const ipv4: string | null = config.ipv4Address || null
    const ipv6: string | null = config.ipv6Address || null

    console.log(`[Provisioning] 实例 ${config.name} IP 配置: IPv4=${ipv4}, IPv6=${ipv6}`)

    // 使用原子操作更新状态，防止与超时清理任务竞争
    // 只有状态仍为 creating 时才更新为 running
    const updateResult = await prisma.instance.updateMany({
      where: {
        id: instanceId,
        status: 'creating' // 原子条件
      },
      data: {
        status: 'running',
        ipv4: ipv4 ?? null,
        ipv6: ipv6 ?? null,
        storagePoolName: config.storagePool || 'default'
      }
    })

    // 如果状态已被超时清理任务修改（变为 error），需要清理已创建的 Incus 实例
    if (updateResult.count === 0) {
      console.log(`[Provisioning] 实例 ${instanceId} 已被超时清理任务处理，清理已创建的 Incus 实例`)
      try {
        await stopInstance(client, config.name, true)
        await deleteInstance(client, config.name)
        console.log(`[Provisioning] Incus 实例 ${config.name} 已清理（因超时）`)
      } catch (cleanupErr) {
        console.error(`[Provisioning] 清理超时实例失败:`, cleanupErr)
      }
      // 不再继续后续流程（IP 记录、通知等）
      return
    }

    // 创建 IP 地址记录 (新双网卡架构: eth0=IPv4, eth1=IPv6)
    if (ipv4) {
      try {
        await db.createIpAddress({
          address: ipv4,
          type: 'inet4',
          isPrimary: true,
          device: 'eth0',  // 新双网卡架构: IPv4 在 eth0
          instanceId
        })
        console.log(`[Provisioning] 主 IPv4 地址记录已创建: ${ipv4} (device: eth0)`)
      } catch (err) {
        console.warn(`[Provisioning] 创建 IPv4 记录失败 (可能已存在):`, err)
      }
    }

    if (ipv6) {
      try {
        await db.createIpAddress({
          address: ipv6,
          type: 'inet6',
          isPrimary: true,
          device: 'eth1',  // 新双网卡架构: IPv6 在 eth1
          instanceId
        })
        console.log(`[Provisioning] 主 IPv6 地址记录已创建: ${ipv6} (device: eth1)`)
      } catch (err) {
        console.warn(`[Provisioning] 创建 IPv6 记录失败 (可能已存在):`, err)
      }
    }

    console.log(`[Provisioning] ✔ 实例 ${instanceId} (${config.name}) 创建成功!`)

    const instance = await db.getInstanceById(instanceId)
    if (instance) {
      // 发送通知
      const { sendNotification } = await import('../lib/notifier.js')
      await sendNotification(userId, 'instance_created', {
        instanceName: instance.name,
        status: 'running',
        hostName: host.name,
        hostLocation: host.location || undefined,
        image: config.image,
        cpu: config.cpu,
        memory: config.memory,
        disk: config.disk,
        networkMode: config.networkMode,
        ipv4: ipv4 || undefined,
        ipv6: ipv6 || undefined
      })

      // 发送实例创建成功邮件通知
      try {
        const { sendInstanceCreatedEmail } = await import('../lib/mailer.js')
        const user = await db.findUserById(userId)
        if (user && user.email) {
          // 获取计费信息
          const instanceWithBilling = await prisma.instance.findUnique({
            where: { id: instanceId },
            select: {
              packagePlanId: true,
              billingPrice: true,
              expiresAt: true,
              packagePlan: { select: { name: true } }
            }
          })
          const isPaid = instanceWithBilling?.packagePlanId !== null

          await sendInstanceCreatedEmail(user.email, {
            username: user.username,
            instanceName: instance.name,
            hostName: host.name,
            image: config.image,
            cpu: config.cpu,
            memory: config.memory,
            disk: config.disk,
            ipv4: ipv4 || undefined,
            ipv6: ipv6 || undefined,
            isPaid,
            planName: instanceWithBilling?.packagePlan?.name,
            amount: isPaid ? Number(instanceWithBilling?.billingPrice) : undefined,
            expiresAt: instanceWithBilling?.expiresAt ?? undefined
          })
        }
      } catch (emailErr) {
        console.warn(`[Provisioning] 发送实例创建成功邮件失败:`, emailErr)
      }

      // 注意：不再检查实例配额使用率警告，因为不再限制用户的实例配额

      await createLog(
        userId,
        'instance',
        'instance.create',
        `Created instance "${instance.name}" [host: ${host.name}, image: ${config.image}, CPU: ${config.cpu}%, Memory: ${config.memory}MB, Disk: ${config.disk}MB, IPv4: ${ipv4 || 'N/A'}, IPv6: ${ipv6 || 'N/A'}, network: ${config.networkMode}]`,
        'success',
        { instanceId }
      )
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Provisioning] ✘ 实例 ${instanceId} 创建失败:`, errorMessage)

    // 使用原子操作更新状态，防止与超时清理任务竞争
    // 只有状态仍为 creating 时才更新为 error 并回滚资源
    const updateResult = await prisma.instance.updateMany({
      where: {
        id: instanceId,
        status: 'creating' // 原子条件
      },
      data: {
        status: 'error'
      }
    })

    // 只有成功更新状态时才回滚资源（避免与超时清理任务双重回滚）
    if (updateResult.count > 0 && userId && resources) {
      try {
        await db.rollbackResources({
          hostId: host.id,
          cpu: resources.cpu,
          memory: resources.memory,
          disk: resources.disk,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(config.networkMode) ? (config.portLimit || 0) : 0
        })
        console.log(`[Provisioning] 用户 ${userId} 资源已回滚 (CPU=${resources.cpu}, Mem=${resources.memory}MB, Disk=${resources.disk}MB)`)
      } catch (rollbackErr) {
        console.error(`[Provisioning] 资源回滚失败:`, rollbackErr)
      }
    } else if (updateResult.count === 0) {
      console.log(`[Provisioning] 实例 ${instanceId} 已被超时清理任务处理，跳过资源回滚`)
    }

    try {
      const client = await getIncusClient(host)
      await deleteInstance(client, config.name)
      console.log(`[Provisioning] 残留容器 ${config.name} 已清理`)
    } catch (cleanupErr) {
      const errorMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      console.log(`[Provisioning] 清理残留容器失败 (可能不存在):`, errorMessage)
    }

    const instance = await db.getInstanceById(instanceId)
    if (instance) {
      // 发送失败通知给用户
      try {
        const { sendNotification } = await import('../lib/notifier.js')
        await sendNotification(userId, 'instance_create_failed', {
          instanceName: instance.name,
          hostName: host.name,
          error: errorMessage
        })
      } catch (notifyErr) {
        console.error(`[Provisioning] 发送失败通知失败:`, notifyErr)
      }

      await createLog(
        userId,
        'instance',
        'instance.create',
        `Failed to create instance "${instance.name}": ${errorMessage}`,
        'failed',
        { instanceId }
      )
    }

    throw error
  }
}
