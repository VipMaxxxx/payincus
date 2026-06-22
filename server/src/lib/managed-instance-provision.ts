import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { buildInstanceConfig, createInstance, deleteInstance, getIncusClient, getInstanceState, startInstance, stopInstance } from '../lib/incus/index.js'
import type { Host } from '../types/database.js'

export interface ManagedInstanceProvisionConfig {
  name: string
  image: string
  cpu: number
  memory: number
  disk: number
  cloudInitConfig?: Record<string, string>
  networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  nested?: boolean
  privileged?: boolean
  portLimit?: number
  instanceType?: 'container' | 'vm'
  sshPort?: number | null
  storagePool?: string | null
  ipv4Address?: string | null
  ipv6Address?: string | null
  ipv6Gateway?: string | null
  hostInterface?: string | null
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

export async function provisionManagedInstanceAsync(
  instanceId: number,
  host: Host,
  config: ManagedInstanceProvisionConfig
): Promise<void> {
  try {
    console.log(`\n[Managed Provisioning] ===== start =====`)
    console.log(`[Managed Provisioning] instanceId=${instanceId}, name=${config.name}, host=${host.name}`)

    const client = await getIncusClient(host)
    const ipv6Config = config.ipv6Address ? { primaryIp: config.ipv6Address } : null

    const incusConfig = buildInstanceConfig({
      name: config.name,
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      sshKey: '',
      password: '',
      cloudInitConfig: config.cloudInitConfig as { 'user.user-data': string } | undefined,
      networkMode: config.networkMode,
      nested: config.nested || false,
      privileged: config.privileged || false,
      instanceType: config.instanceType || 'container',
      storagePool: config.storagePool || 'default',
      ipv4Address: config.ipv4Address,
      ipv6Config,
      hostInterface: config.hostInterface || 'eth0',
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
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

    await createInstance(client, incusConfig)

    let ready = false
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status) {
          ready = true
          break
        }
      } catch {
        // keep waiting
      }
    }

    if (!ready) {
      throw new Error('Instance creation timed out')
    }

    await startInstance(client, config.name)

    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status === 'Running') {
          break
        }
      } catch {
        // keep waiting
      }
    }

    let ipv4: string | null = config.ipv4Address || null
    let ipv6: string | null = config.ipv6Address || null

    try {
      const stateResp = await getInstanceState(client, config.name) as {
        network?: Record<string, { addresses?: Array<{ family: string; scope: string; address: string }> }>
      }
      const network = stateResp?.network
      if (network?.eth0?.addresses) {
        for (const addr of network.eth0.addresses) {
          if (addr.family === 'inet' && addr.scope === 'global') {
            ipv4 = addr.address
          } else if (addr.family === 'inet6' && addr.scope === 'global') {
            ipv6 = addr.address
          }
        }
      }
    } catch {
      // keep pre-allocated addresses
    }

    const updateResult = await prisma.instance.updateMany({
      where: { id: instanceId, status: 'creating' },
      data: {
        status: 'running',
        ipv4,
        ipv6,
        storagePoolName: config.storagePool || 'default'
      }
    })

    if (updateResult.count === 0) {
      console.log(`[Managed Provisioning] instance ${instanceId} was already finalized, cleaning created Incus instance`)
      try {
        await stopInstance(client, config.name, true)
        await deleteInstance(client, config.name)
      } catch (cleanupError) {
        console.error(`[Managed Provisioning] failed to clean finalized instance ${config.name}:`, cleanupError)
      }
      return
    }
  } catch (error) {
    console.error(`[Managed Provisioning] instance ${instanceId} failed:`, error)

    const updateResult = await prisma.instance.updateMany({
      where: { id: instanceId, status: 'creating' },
      data: { status: 'error' }
    }).catch(() => ({ count: 0 }))

    if (updateResult.count > 0) {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: {
          userId: true,
          hostId: true,
          cpu: true,
          memory: true,
          disk: true,
          networkMode: true,
          portLimit: true
        }
      }).catch(() => null)

      if (instance) {
        try {
          await db.rollbackResources({
            hostId: instance.hostId,
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.networkMode)
              ? (instance.portLimit || 0)
              : 0
          })
        } catch (rollbackError) {
          console.error(`[Managed Provisioning] failed to roll back resources for instance ${instanceId}:`, rollbackError)
        }

        try {
          await db.compensateFailedInstancePurchase(instanceId, instance.userId, instance.hostId)
        } catch (compensationError) {
          console.error(`[Managed Provisioning] failed to compensate billing for instance ${instanceId}:`, compensationError)
        }
      }
    }

    try {
      const client = await getIncusClient(host)
      await deleteInstance(client, config.name)
    } catch {
      // Instance may not exist or may already have been cleaned by timeout handling.
    }

    throw error
  }
}
