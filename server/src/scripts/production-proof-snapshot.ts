import '../config/env.js'
import { closePrismaDatabase, prisma } from '../db/prisma.js'
import { getSystemConfig } from '../db/system-config.js'

const sinceHours = Number.parseInt(process.env.PROOF_SINCE_HOURS || '24', 10)
const proofWindowHours = Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : 24
const since = new Date(Date.now() - proofWindowHours * 60 * 60 * 1000)

const requiredLifecycleActions = [
  'instance.create',
  'instance.start',
  'instance.stop',
  'instance.restart',
  'instance.rebuild',
  'instance.recreate',
  'instance.delete',
  'terminal.connect',
  'terminal.disconnect',
  'port.add'
] as const

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).sort()
}

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') return nestedValue.toString()
      return nestedValue
    },
    2
  )
}

async function main(): Promise<void> {
  const [
    hostsTotal,
    onlineHosts,
    storagePools,
    instancesTotal,
    runningInstances,
    stoppedInstances,
    deletedInstances,
    hostAgentsTotal,
    onlineAgents,
    freshAgents,
    paymentProviders,
    activePaymentProviders,
    rechargeRecords,
    recentRechargeRecords,
    paymentCallbacks,
    notificationChannels,
    recentNotificationLogs
  ] = await Promise.all([
    prisma.host.count(),
    prisma.host.count({ where: { status: 'online' } }),
    prisma.storagePool.count(),
    prisma.instance.count(),
    prisma.instance.count({ where: { status: 'running' } }),
    prisma.instance.count({ where: { status: 'stopped' } }),
    prisma.instance.count({ where: { status: 'deleted' } }),
    prisma.hostAgent.count(),
    prisma.hostAgent.count({ where: { status: 'online' } }),
    prisma.hostAgent.count({ where: { status: 'online', lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }),
    prisma.paymentProvider.count(),
    prisma.paymentProvider.count({ where: { status: 'active' } }),
    prisma.rechargeRecord.count(),
    prisma.rechargeRecord.count({ where: { createdAt: { gte: since } } }),
    prisma.paymentCallback.count({ where: { createdAt: { gte: since } } }),
    prisma.notificationChannel.count(),
    prisma.notificationLog.count({ where: { createdAt: { gte: since } } })
  ])

  const [smtpEnabled, smtpHost, smtpUsername, smtpPassword, smtpFromEmail, lskyBaseUrl, lskyToken, lskyApiVersion] =
    await Promise.all([
      getSystemConfig('smtp_enabled'),
      getSystemConfig('smtp_host'),
      getSystemConfig('smtp_username'),
      getSystemConfig('smtp_password'),
      getSystemConfig('smtp_from_email'),
      getSystemConfig('ticket_image_lsky_base_url'),
      getSystemConfig('ticket_image_lsky_token'),
      getSystemConfig('ticket_image_lsky_api_version')
    ])

  const [hosts, pools, instances, completedRecharges, callbacks, tasks, logs] = await Promise.all([
    prisma.host.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        isInstalled: true,
        enableApi: true,
        architecture: true,
        instanceType: true,
        cpuAllowanceMax: true,
        memoryMax: true,
        storageSize: true,
        cpuUsed: true,
        memoryUsed: true,
        diskUsed: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            enabled: true,
            status: true,
            version: true,
            capabilities: true,
            lastReport: true,
            lastSeenAt: true,
            installTokenUsedAt: true,
            updatedAt: true
          }
        }
      }
    }),
    prisma.storagePool.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        hostId: true,
        name: true,
        driver: true,
        purpose: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.instance.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        hostId: true,
        image: true,
        status: true,
        cpu: true,
        memory: true,
        disk: true,
        networkMode: true,
        monthlyTrafficLimit: true,
        monthlyTrafficUsed: true,
        trafficStatus: true,
        storagePoolName: true,
        createdAt: true,
        updatedAt: true,
        lastSyncedAt: true,
        _count: {
          select: {
            portMappings: true,
            snapshots: true,
            backups: true
          }
        },
        trafficSnapshot: {
          select: {
            rxRaw: true,
            txRaw: true,
            updatedAt: true
          }
        },
        dailyTraffic: {
          orderBy: { date: 'desc' },
          take: 2,
          select: {
            date: true,
            rxTotal: true,
            txTotal: true
          }
        }
      }
    }),
    prisma.rechargeRecord.findMany({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        providerId: true,
        amount: true,
        actualAmount: true,
        fee: true,
        paymentMethod: true,
        status: true,
        tradeNo: true,
        callbackAt: true,
        completedAt: true,
        paymentDetails: true
      }
    }),
    prisma.paymentCallback.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        providerId: true,
        tradeNo: true,
        callbackIp: true,
        processed: true,
        createdAt: true
      }
    }),
    prisma.instanceTask.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        instanceId: true,
        hostId: true,
        taskType: true,
        status: true,
        retryCount: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true
      }
    }),
    prisma.log.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: [...requiredLifecycleActions] }
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        instanceId: true,
        module: true,
        action: true,
        result: true,
        createdAt: true
      }
    })
  ])

  const presentLifecycleActions = new Set(logs.map(log => log.action))
  const snapshot = {
    generatedAt: new Date().toISOString(),
    proofWindowHours,
    redaction: {
      safeToShare: true,
      omittedFields: [
        'DATABASE_URL',
        'host.url',
        'host.certPath',
        'host.keyPath',
        'host install tokens',
        'agent secrets',
        'payment provider config',
        'payment order numbers',
        'payment callback body',
        'SMTP password',
        'Lsky token',
        'notification channel config',
        'instance root password',
        'user email/IP/user-agent'
      ]
    },
    counts: {
      hostsTotal,
      onlineHosts,
      storagePools,
      instancesTotal,
      runningInstances,
      stoppedInstances,
      deletedInstances,
      hostAgentsTotal,
      onlineAgents,
      freshAgents,
      paymentProviders,
      activePaymentProviders,
      rechargeRecords,
      recentRechargeRecords,
      paymentCallbacks,
      notificationChannels,
      recentNotificationLogs
    },
    configPresence: {
      smtp: {
        enabled: smtpEnabled === 'true',
        hostPresent: hasText(smtpHost),
        usernamePresent: hasText(smtpUsername),
        passwordPresent: hasText(smtpPassword),
        fromEmailPresent: hasText(smtpFromEmail)
      },
      lsky: {
        baseUrlPresent: hasText(lskyBaseUrl),
        tokenPresent: hasText(lskyToken),
        apiVersionPresent: hasText(lskyApiVersion)
      }
    },
    hosts: hosts.map(host => ({
      id: host.id,
      name: host.name,
      status: host.status,
      isInstalled: host.isInstalled,
      enableApi: host.enableApi,
      architecture: host.architecture,
      instanceType: host.instanceType,
      resources: {
        cpuAllowanceMax: host.cpuAllowanceMax,
        memoryMax: host.memoryMax,
        storageSize: host.storageSize,
        cpuUsed: host.cpuUsed,
        memoryUsed: host.memoryUsed,
        diskUsed: host.diskUsed
      },
      updatedAt: iso(host.updatedAt),
      agent: host.agent
        ? {
            id: host.agent.id,
            enabled: host.agent.enabled,
            status: host.agent.status,
            version: host.agent.version,
            lastSeenAt: iso(host.agent.lastSeenAt),
            installTokenUsedAt: iso(host.agent.installTokenUsedAt),
            updatedAt: iso(host.agent.updatedAt),
            capabilities: Array.isArray(host.agent.capabilities) ? host.agent.capabilities : [],
            lastReportKeys: keysOf(host.agent.lastReport)
          }
        : null
    })),
    storagePools: pools.map(pool => ({
      id: pool.id,
      hostId: pool.hostId,
      name: pool.name,
      driver: pool.driver,
      purpose: pool.purpose,
      createdAt: iso(pool.createdAt),
      updatedAt: iso(pool.updatedAt)
    })),
    instances: instances.map(instance => ({
      id: instance.id,
      hostId: instance.hostId,
      image: instance.image,
      status: instance.status,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      networkMode: instance.networkMode,
      storagePoolName: instance.storagePoolName,
      monthlyTrafficLimit: instance.monthlyTrafficLimit?.toString() ?? null,
      monthlyTrafficUsed: instance.monthlyTrafficUsed.toString(),
      trafficStatus: instance.trafficStatus,
      counts: instance._count,
      createdAt: iso(instance.createdAt),
      updatedAt: iso(instance.updatedAt),
      lastSyncedAt: iso(instance.lastSyncedAt),
      trafficSnapshot: instance.trafficSnapshot
        ? {
            rxRaw: instance.trafficSnapshot.rxRaw.toString(),
            txRaw: instance.trafficSnapshot.txRaw.toString(),
            updatedAt: iso(instance.trafficSnapshot.updatedAt)
          }
        : null,
      dailyTraffic: instance.dailyTraffic.map(row => ({
        date: row.date.toISOString().slice(0, 10),
        rxTotal: row.rxTotal.toString(),
        txTotal: row.txTotal.toString()
      }))
    })),
    paymentProof: {
      completedRecharges: completedRecharges.map(record => ({
        id: record.id,
        providerId: record.providerId,
        amount: record.amount.toString(),
        actualAmount: record.actualAmount?.toString() ?? null,
        fee: record.fee.toString(),
        paymentMethod: record.paymentMethod,
        status: record.status,
        hasTradeNo: hasText(record.tradeNo),
        hasCallbackAt: Boolean(record.callbackAt),
        completedAt: iso(record.completedAt),
        paymentDetailsKeys: keysOf(record.paymentDetails)
      })),
      recentCallbacks: callbacks.map(callback => ({
        id: callback.id,
        providerId: callback.providerId,
        hasTradeNo: hasText(callback.tradeNo),
        hasCallbackIp: hasText(callback.callbackIp),
        processed: callback.processed,
        createdAt: iso(callback.createdAt)
      }))
    },
    lifecycleProof: {
      requiredActions: requiredLifecycleActions,
      presentActions: [...presentLifecycleActions].sort(),
      missingActions: requiredLifecycleActions.filter(action => !presentLifecycleActions.has(action)),
      recentTasks: tasks.map(task => ({
        id: task.id,
        instanceId: task.instanceId,
        hostId: task.hostId,
        taskType: task.taskType,
        status: task.status,
        retryCount: task.retryCount,
        createdAt: iso(task.createdAt),
        startedAt: iso(task.startedAt),
        finishedAt: iso(task.finishedAt)
      })),
      recentLogs: logs.map(log => ({
        id: log.id,
        instanceId: log.instanceId,
        module: log.module,
        action: log.action,
        result: log.result,
        createdAt: iso(log.createdAt)
      }))
    }
  }

  console.log(stringify(snapshot))
}

main()
  .catch(error => {
    console.error(`[production-proof-snapshot] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePrismaDatabase()
  })
