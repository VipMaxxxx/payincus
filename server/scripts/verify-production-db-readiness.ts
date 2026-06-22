import '../src/config/env.js'
import { closePrismaDatabase, prisma } from '../src/db/prisma.js'
import { getAllPaymentProviders } from '../src/db/payment-providers.js'
import { getSystemConfig } from '../src/db/system-config.js'
import { assertSafeHttpUrl } from '../src/lib/outbound-security.js'

type CheckLevel = 'warn' | 'fail'

interface Finding {
  level: CheckLevel
  message: string
}

const findings: Finding[] = []

function fail(message: string): void {
  findings.push({ level: 'fail', message })
}

function warn(message: string): void {
  findings.push({ level: 'warn', message })
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

function isEnabled(value: string | null): boolean {
  return value === 'true'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyRecord(value: unknown): boolean {
  return !isRecord(value) || Object.keys(value).length === 0
}

function validateHttpsUrl(value: string, label: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    fail(`${label} must be a valid URL`)
    return
  }

  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    fail(`${label} must use HTTPS in production`)
  }
}

function isInstanceTypeCompatible(imageType: string | null | undefined, targetType: string | null | undefined): boolean {
  const normalizedImageType = imageType || 'both'
  const normalizedTargetType = targetType || 'container'
  return normalizedTargetType === 'both' || normalizedImageType === 'both' || normalizedImageType === normalizedTargetType
}

async function checkDatabaseConnectivity(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
}

async function checkPaymentProviders(): Promise<void> {
  const providers = await getAllPaymentProviders()
  const activeProviders = providers.filter(provider => provider.status === 'active')

  if (activeProviders.length === 0) {
    warn('No active payment providers are configured; recharge will be unavailable until one is enabled')
    return
  }

  for (const provider of activeProviders) {
    const config = provider.config as Record<string, unknown>
    const prefix = `Payment provider #${provider.id} (${provider.name}, ${provider.type})`

    if (provider.type !== 'yipay' && provider.type !== 'heleket') {
      fail(`${prefix} uses unsupported provider type for recharge`)
      continue
    }

    const apiUrl = typeof config.apiurl === 'string' ? config.apiurl.trim() : ''
    if (!apiUrl) {
      fail(`${prefix} is missing apiurl`)
    } else {
      try {
        await assertSafeHttpUrl(apiUrl, `${prefix} apiurl`)
      } catch (error) {
        fail(`${prefix} apiurl is not a safe outbound HTTP(S) URL: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (provider.type === 'yipay') {
      const version = typeof config.version === 'string' ? config.version : 'v2'
      if (isBlank(config.pid)) {
        fail(`${prefix} is missing pid`)
      }
      if (version === 'v1') {
        if (isBlank(config.key)) {
          fail(`${prefix} v1 is missing key`)
        }
      } else {
        if (isBlank(config.platform_public_key)) {
          fail(`${prefix} v2 is missing platform_public_key`)
        }
        if (isBlank(config.merchant_private_key)) {
          fail(`${prefix} v2 is missing merchant_private_key`)
        }
      }
    }

    if (provider.type === 'heleket') {
      if (isBlank(config.api_key)) {
        fail(`${prefix} is missing api_key`)
      }
      if (isBlank(config.merchant_uuid)) {
        fail(`${prefix} is missing merchant_uuid`)
      }
    }
  }
}

async function checkSmtpConfig(): Promise<void> {
  const smtpEnabled = isEnabled(await getSystemConfig('smtp_enabled'))
  const host = await getSystemConfig('smtp_host')
  const username = await getSystemConfig('smtp_username')
  const password = await getSystemConfig('smtp_password')
  const fromEmail = await getSystemConfig('smtp_from_email')

  const hasPartialSmtp = [host, username, password, fromEmail].some(value => !isBlank(value))
  if (!smtpEnabled && hasPartialSmtp) {
    warn('SMTP fields are partially configured while smtp_enabled=false; email verification and notifications will not send')
    return
  }

  if (!smtpEnabled) {
    warn('SMTP is disabled; registration/password-reset/change-email verification emails will be unavailable if those flows require email')
    return
  }

  if (isBlank(host)) fail('smtp_enabled=true but smtp_host is empty')
  if (isBlank(username)) fail('smtp_enabled=true but smtp_username is empty')
  if (isBlank(password)) fail('smtp_enabled=true but smtp_password is empty')
  if (isBlank(fromEmail)) fail('smtp_enabled=true but smtp_from_email is empty')
}

async function checkLskyConfig(): Promise<void> {
  const baseUrl = await getSystemConfig('ticket_image_lsky_base_url')
  const token = await getSystemConfig('ticket_image_lsky_token')
  const apiVersion = await getSystemConfig('ticket_image_lsky_api_version')
  const hasAnyLsky = [baseUrl, token].some(value => !isBlank(value))

  if (!hasAnyLsky) {
    warn('Lsky ticket image upload is not configured; ticket image uploads will fail until configured or avoided')
    return
  }

  if (isBlank(baseUrl)) {
    fail('Lsky token is configured but ticket_image_lsky_base_url is empty')
  } else {
    try {
      const safeUrl = await assertSafeHttpUrl(baseUrl!.trim(), 'Lsky base URL')
      validateHttpsUrl(safeUrl.toString(), 'Lsky base URL')
    } catch (error) {
      fail(`Lsky base URL is not safe: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (isBlank(token)) {
    fail('ticket_image_lsky_base_url is configured but ticket_image_lsky_token is empty')
  }
  if (apiVersion && !['v1', 'v2'].includes(apiVersion)) {
    fail('ticket_image_lsky_api_version must be v1 or v2')
  }
}

async function checkResourceDeliveryConfig(): Promise<void> {
  const [onlineHosts, visibleImages, publicPackages] = await Promise.all([
    prisma.host.findMany({
      where: { status: 'online' },
      select: {
        id: true,
        name: true,
        architecture: true,
        instanceType: true,
        cpuAllowanceMax: true,
        memoryMax: true,
        storageSize: true,
        enableApi: true,
        isInstalled: true,
        agent: {
          select: {
            enabled: true,
            status: true,
            version: true,
            capabilities: true,
            lastReport: true,
            lastSeenAt: true
          }
        },
        allowedImages: { select: { imageId: true } }
      }
    }),
    prisma.systemImage.findMany({
      where: { hidden: false },
      select: {
        id: true,
        name: true,
        architecture: true,
        instanceType: true
      }
    }),
    prisma.package.findMany({
      where: { active: true, globalShared: true },
      select: {
        id: true,
        name: true,
        instanceType: true,
        packageHosts: {
          select: {
            host: {
              select: {
                id: true,
                name: true,
                status: true,
                architecture: true,
                instanceType: true,
                cpuAllowanceMax: true,
                memoryMax: true,
                instances: {
                  where: { status: { not: 'deleted' } },
                  select: { cpu: true, memory: true }
                },
                allowedImages: { select: { imageId: true } }
              }
            }
          }
        },
        plans: {
          where: { isActive: true },
          select: { cpu: true, memory: true, isSoldOut: true }
        }
      }
    })
  ])

  if (onlineHosts.length === 0) {
    warn('No online hosts are configured; instance creation cannot run until at least one Incus host is online')
  }

  const allocatableHosts = onlineHosts.filter(host => host.cpuAllowanceMax > 0 && host.memoryMax > 0 && host.storageSize > 0)
  if (onlineHosts.length > 0 && allocatableHosts.length === 0) {
    warn('Online hosts exist but none have positive CPU, memory, and storage capacity configured')
  }

  const agentStaleAfterMs = 5 * 60 * 1000
  const now = Date.now()
  for (const host of onlineHosts) {
    const prefix = `Online host #${host.id} (${host.name})`
    if (!host.isInstalled) {
      warn(`${prefix} is online but isInstalled=false`)
    }
    if (!host.enableApi) {
      warn(`${prefix} is online but Incus API enableApi=false`)
    }
    if (!host.agent) {
      warn(`${prefix} has no Agent credentials; heartbeat and resource reports cannot run`)
      continue
    }
    if (!host.agent.enabled) {
      warn(`${prefix} Agent is disabled`)
    }
    if (host.agent.status !== 'online') {
      warn(`${prefix} Agent status is ${host.agent.status}`)
      continue
    }
    if (!host.agent.lastSeenAt) {
      warn(`${prefix} Agent is online but lastSeenAt is empty`)
      continue
    }
    if (now - host.agent.lastSeenAt.getTime() > agentStaleAfterMs) {
      warn(`${prefix} Agent heartbeat is older than 5 minutes`)
    }
    if (isBlank(host.agent.version)) {
      warn(`${prefix} Agent is online but did not report a version`)
    }
    if (!Array.isArray(host.agent.capabilities) || host.agent.capabilities.length === 0) {
      warn(`${prefix} Agent is online but did not report capabilities`)
    }
    if (isEmptyRecord(host.agent.lastReport)) {
      warn(`${prefix} Agent is online but lastReport is empty; resource and metric reports cannot be verified`)
      continue
    }
    const lastReport = host.agent.lastReport as Record<string, unknown>
    if (isEmptyRecord(lastReport.resources)) {
      warn(`${prefix} Agent lastReport.resources is empty; host resource reporting cannot be verified`)
    }
    if (isEmptyRecord(lastReport.metrics)) {
      warn(`${prefix} Agent lastReport.metrics is empty; heartbeat interval and metric reporting cannot be verified`)
    }
  }

  const runningInstancesOnOnlineHosts = await prisma.instance.findMany({
    where: {
      status: 'running',
      host: { status: 'online' }
    },
    select: {
      id: true,
      name: true,
      host: {
        select: {
          id: true,
          name: true,
          agent: {
            select: {
              enabled: true,
              status: true,
              lastSeenAt: true
            }
          }
        }
      },
      trafficSnapshot: {
        select: {
          updatedAt: true
        }
      }
    }
  })

  const runningInstancesWithoutTrafficSnapshot = runningInstancesOnOnlineHosts
    .filter(instance => !instance.trafficSnapshot)
    .slice(0, 10)
  if (runningInstancesWithoutTrafficSnapshot.length > 0) {
    warn(`Running instances on online hosts are missing traffic snapshots; first traffic collection/Agent report has not established a baseline (sample instance IDs: ${runningInstancesWithoutTrafficSnapshot.map(instance => instance.id).join(', ')})`)
  }

  const runningInstancesWithoutFreshAgent = runningInstancesOnOnlineHosts
    .filter(instance => {
      const agent = instance.host.agent
      if (!agent || !agent.enabled || agent.status !== 'online' || !agent.lastSeenAt) {
        return true
      }
      return now - agent.lastSeenAt.getTime() > agentStaleAfterMs
    })
    .slice(0, 10)
  if (runningInstancesWithoutFreshAgent.length > 0) {
    warn(`Running instances exist on hosts without a fresh online Agent heartbeat; Agent status/resource/traffic reports need live validation (sample instance IDs: ${runningInstancesWithoutFreshAgent.map(instance => instance.id).join(', ')})`)
  }

  if (visibleImages.length === 0) {
    warn('No visible system images are configured; instance creation image selection will be empty')
  }

  function hostHasCompatibleImage(host: {
    architecture: string
    instanceType: string | null
    allowedImages: Array<{ imageId: number }>
  }): boolean {
    const allowedImageIds = new Set(host.allowedImages.map(item => item.imageId))
    return visibleImages.some(image => {
      if (image.architecture !== host.architecture) {
        return false
      }
      if (!isInstanceTypeCompatible(image.instanceType, host.instanceType)) {
        return false
      }
      return allowedImageIds.size === 0 || allowedImageIds.has(image.id)
    })
  }

  if (onlineHosts.length > 0 && visibleImages.length > 0 && !onlineHosts.some(hostHasCompatibleImage)) {
    warn('Online hosts exist but none have a compatible visible system image')
  }

  if (publicPackages.length === 0) {
    warn('No active global-shared packages are configured; ordinary users will not see public instance packages')
    return
  }

  for (const pkg of publicPackages) {
    const prefix = `Public package #${pkg.id} (${pkg.name})`
    if (pkg.packageHosts.length === 0) {
      fail(`${prefix} is active but not bound to any host`)
      continue
    }

    const onlinePackageHosts = pkg.packageHosts
      .map(item => item.host)
      .filter(host => host.status === 'online')
    if (onlinePackageHosts.length === 0) {
      fail(`${prefix} is active but none of its bound hosts are online`)
      continue
    }

    const hasCompatibleImage = onlinePackageHosts.some(host => {
      if (!isInstanceTypeCompatible(host.instanceType, pkg.instanceType)) {
        return false
      }
      return hostHasCompatibleImage(host)
    })
    if (!hasCompatibleImage) {
      fail(`${prefix} has no compatible visible image on its online bound hosts`)
    }

    const activePlans = pkg.plans
    const availablePlans = activePlans.filter(plan => !plan.isSoldOut)
    if (activePlans.length > 0 && availablePlans.length === 0) {
      warn(`${prefix} has active plans but all are marked sold out`)
      continue
    }

    const minCpu = availablePlans.length > 0 ? Math.min(...availablePlans.map(plan => plan.cpu)) : 15
    const minMemory = availablePlans.length > 0 ? Math.min(...availablePlans.map(plan => plan.memory)) : 128
    const hasCapacity = onlinePackageHosts.some(host => {
      const usedCpu = host.instances.reduce((sum, instance) => sum + instance.cpu, 0)
      const usedMemory = host.instances.reduce((sum, instance) => sum + instance.memory, 0)
      return host.cpuAllowanceMax - usedCpu >= minCpu && host.memoryMax - usedMemory >= minMemory
    })
    if (!hasCapacity) {
      warn(`${prefix} is active but online bound hosts cannot satisfy its minimum CPU/memory requirement`)
    }
  }
}

async function main(): Promise<number> {
  await checkDatabaseConnectivity()
  await checkPaymentProviders()
  await checkSmtpConfig()
  await checkLskyConfig()
  await checkResourceDeliveryConfig()

  for (const finding of findings) {
    const prefix = finding.level === 'fail' ? 'ERROR' : 'WARN'
    console.error(`[verify-production-db] ${prefix}: ${finding.message}`)
  }

  if (findings.some(finding => finding.level === 'fail')) {
    return 1
  }

  console.log('[verify-production-db] passed')
  return 0
}

main()
  .then(async exitCode => {
    await closePrismaDatabase().catch(() => undefined)
    process.exit(exitCode)
  })
  .catch(async error => {
    console.error('[verify-production-db] ERROR:', error instanceof Error ? error.message : String(error))
    await closePrismaDatabase().catch(() => undefined)
    process.exit(1)
  })
