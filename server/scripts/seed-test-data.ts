import 'dotenv/config'

// @ts-ignore - bcryptjs has its own types
import bcrypt from 'bcryptjs'

import * as db from '../src/db/index.js'
import { prisma } from '../src/db/prisma.js'

type SeedRole = 'admin' | 'user'
type HostStatus = 'online' | 'offline' | 'maintenance'
type HostArchitecture = 'x86_64' | 'aarch64'
type HostInstanceType = 'container' | 'vm' | 'both'
type PackageInstanceType = 'container' | 'vm'
type NetworkMode = 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
type IoLimitMode = 'throughput' | 'iops'

type SeedCounter = {
  created: number
  updated: number
}

type SeedStats = {
  users: SeedCounter
  hosts: SeedCounter
  packages: SeedCounter
  plans: SeedCounter
}

type SeedUserSpec = {
  username: string
  email: string
  role: SeedRole
  password?: string
  quota?: {
    hostLimit: number
    packageLimit: number
  }
}

type SeedHostSpec = {
  ownerUsername: string
  name: string
  url: string
  location: string
  countryCode: string
  architecture: HostArchitecture
  instanceType: HostInstanceType
  status: HostStatus
  tags: string[]
  natPublicIp: string
  natPortStart: number
  natPortEnd: number
  ipAddress: string
  storageDriver: string
  storageType: string
  storageSize: number
  enableApi: boolean
  isInstalled: boolean
  cpuAllowanceMax: number
  memoryMax: number
}

type SeedPlanSpec = {
  name: string
  description: string
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  swapSize: number
  trafficLimit: bigint
  trafficLimitSpeed: string
  price: number
  billingCycle: number
  setupFee: number
  isActive: boolean
  sortOrder: number
  slaGuarantee: number | null
}

type SeedPackageSpec = {
  ownerUsername: string
  name: string
  description: string
  hostNames: string[]
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax: number | null
  networkMode: NetworkMode
  instanceType: PackageInstanceType
  privileged: boolean
  nested: boolean
  active: boolean
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  monthlyTrafficLimit: bigint | null
  ioLimitMode: IoLimitMode
  limitsRead: string
  limitsWrite: string
  limitsReadIops: number
  limitsWriteIops: number
  limitsIngress: string
  limitsEgress: string
  limitsProcesses: number
  limitsCpuPriority: number
  bootAutostart: boolean
  bootAutostartPriority: number
  bootAutostartDelay: number
  bootHostShutdownTimeout: number
  globalShared: boolean
  globalQuotaMultiplier: number | null
  globalMaxInstances: number | null
  allowInstanceDeletion: boolean
  plans: SeedPlanSpec[]
}

const LOCAL_PASSWORD_SALT = '$2a$10$1234567890123456789012'

const stats: SeedStats = {
  users: { created: 0, updated: 0 },
  hosts: { created: 0, updated: 0 },
  packages: { created: 0, updated: 0 },
  plans: { created: 0, updated: 0 }
}

const userIds = new Map<string, number>()
const hostIds = new Map<string, number>()

function bytesFromGb(value: number): bigint {
  return BigInt(value) * 1024n * 1024n * 1024n
}

function hostKey(ownerUsername: string, hostName: string): string {
  return `${ownerUsername}:${hostName}`
}

function countPlans(packages: SeedPackageSpec[]): number {
  return packages.reduce((total, pkg) => total + pkg.plans.length, 0)
}

function getUserId(username: string): number {
  const userId = userIds.get(username)
  if (!userId) {
    throw new Error(`Missing seeded user: ${username}`)
  }
  return userId
}

function getHostId(ownerUsername: string, hostName: string): number {
  const id = hostIds.get(hostKey(ownerUsername, hostName))
  if (!id) {
    throw new Error(`Missing seeded host: ${ownerUsername}/${hostName}`)
  }
  return id
}

async function buildPasswordHash(password: string): Promise<string> {
  return bcrypt.hash(password, LOCAL_PASSWORD_SALT)
}

async function ensureUser(spec: SeedUserSpec): Promise<number> {
  const existing = await db.findUserByUsername(spec.username)
  const passwordHash = spec.password ? await buildPasswordHash(spec.password) : undefined

  if (!existing) {
    if (!passwordHash) {
      throw new Error(`Cannot create user without password: ${spec.username}`)
    }

    const userId = await db.createUser(spec.username, spec.email, passwordHash, spec.role)

    if (spec.quota) {
      await db.updateUserQuotaLimits(userId, {
        hostLimit: spec.quota.hostLimit,
        packageLimit: spec.quota.packageLimit
      })
    }

    stats.users.created += 1
    userIds.set(spec.username, userId)
    return userId
  }

  // 幂等处理：账号存在时只同步本脚本关心的字段，不重复创建脏数据。
  await db.updateUser(existing.id, {
    email: spec.email,
    role: spec.role,
    status: 'active',
    ...(passwordHash ? { passwordHash } : {})
  })

  const quota = await db.getUserQuota(existing.id)
  if (!quota) {
    await db.createUserQuota(existing.id, {
      hostLimit: spec.quota?.hostLimit ?? 8,
      packageLimit: spec.quota?.packageLimit ?? 8
    })
  } else if (spec.quota) {
    await db.updateUserQuotaLimits(existing.id, {
      hostLimit: spec.quota.hostLimit,
      packageLimit: spec.quota.packageLimit
    })
  }

  stats.users.updated += 1
  userIds.set(spec.username, existing.id)
  return existing.id
}

async function ensureHost(spec: SeedHostSpec): Promise<number> {
  const ownerId = getUserId(spec.ownerUsername)
  const existing = await db.getHostByUserAndName(ownerId, spec.name)

  if (!existing) {
    const hostId = await db.createHost({
      userId: ownerId,
      name: spec.name,
      url: spec.url,
      location: spec.location,
      countryCode: spec.countryCode,
      architecture: spec.architecture,
      instanceType: spec.instanceType,
      tags: spec.tags,
      natPublicIp: spec.natPublicIp,
      natPortStart: spec.natPortStart,
      natPortEnd: spec.natPortEnd,
      ipAddress: spec.ipAddress,
      storageDriver: spec.storageDriver,
      storageType: spec.storageType,
      storageSize: spec.storageSize,
      enableApi: spec.enableApi,
      isInstalled: spec.isInstalled,
      cpuAllowanceMax: spec.cpuAllowanceMax,
      memoryMax: spec.memoryMax
    })

    await db.updateHostStatus(hostId, spec.status)
    await db.updateHostResources(hostId, {
      architecture: spec.architecture,
      instanceType: spec.instanceType,
      cpuUsed: 0,
      memoryUsed: 0,
      diskUsed: 0,
      cpuAllowanceMax: spec.cpuAllowanceMax,
      memoryMax: spec.memoryMax
    })

    stats.hosts.created += 1
    hostIds.set(hostKey(spec.ownerUsername, spec.name), hostId)
    return hostId
  }

  // 关键流程：优先复用现有 helper 同步节点展示信息、状态和配额上限。
  await db.updateHost(existing.id, {
    url: spec.url,
    location: spec.location,
    countryCode: spec.countryCode,
    tags: spec.tags,
    natPublicIp: spec.natPublicIp,
    natPortStart: spec.natPortStart,
    natPortEnd: spec.natPortEnd
  })
  await db.updateHostStatus(existing.id, spec.status)
  await db.updateHostResources(existing.id, {
    architecture: spec.architecture,
    instanceType: spec.instanceType,
    cpuUsed: 0,
    memoryUsed: 0,
    diskUsed: 0,
    cpuAllowanceMax: spec.cpuAllowanceMax,
    memoryMax: spec.memoryMax
  })

  stats.hosts.updated += 1
  hostIds.set(hostKey(spec.ownerUsername, spec.name), existing.id)
  return existing.id
}

async function ensurePackage(spec: SeedPackageSpec): Promise<number> {
  const ownerId = getUserId(spec.ownerUsername)
  const owner = await db.findUserByUsername(spec.ownerUsername)

  if (!owner) {
    throw new Error(`Missing package owner: ${spec.ownerUsername}`)
  }

  const hostIdsForPackage = spec.hostNames.map(hostName => getHostId(spec.ownerUsername, hostName))
  const existing = await db.getPackageByUserAndName(ownerId, spec.name)
  const packageData = {
    name: spec.name,
    description: spec.description,
    cpuMax: spec.cpuMax,
    memoryMax: spec.memoryMax,
    diskMax: spec.diskMax,
    bandwidthMax: spec.bandwidthMax,
    networkMode: spec.networkMode,
    instanceType: spec.instanceType,
    hostIds: hostIdsForPackage,
    privileged: spec.privileged,
    nested: spec.nested,
    active: spec.active,
    portLimit: spec.portLimit,
    snapshotLimit: spec.snapshotLimit,
    backupLimit: spec.backupLimit,
    siteLimit: spec.siteLimit,
    monthlyTrafficLimit: spec.monthlyTrafficLimit,
    ioLimitMode: spec.ioLimitMode,
    limitsRead: spec.limitsRead,
    limitsWrite: spec.limitsWrite,
    limitsReadIops: spec.limitsReadIops,
    limitsWriteIops: spec.limitsWriteIops,
    limitsIngress: spec.limitsIngress,
    limitsEgress: spec.limitsEgress,
    limitsProcesses: spec.limitsProcesses,
    limitsCpuPriority: spec.limitsCpuPriority,
    bootAutostart: spec.bootAutostart,
    bootAutostartPriority: spec.bootAutostartPriority,
    bootAutostartDelay: spec.bootAutostartDelay,
    bootHostShutdownTimeout: spec.bootHostShutdownTimeout,
    globalShared: spec.globalShared,
    globalQuotaMultiplier: spec.globalQuotaMultiplier,
    globalMaxInstances: spec.globalMaxInstances,
    allowInstanceDeletion: spec.allowInstanceDeletion
  }

  if (!existing) {
    const packageId = await db.createPackage(
      {
        userId: ownerId,
        ...packageData
      },
      owner.role === 'admin'
    )

    stats.packages.created += 1
    return packageId
  }

  await db.updatePackage(existing.id, packageData, owner.role === 'admin')
  stats.packages.updated += 1
  return existing.id
}

async function ensurePlans(packageId: number, plans: SeedPlanSpec[]): Promise<void> {
  const existingPlans = await db.getPlansByPackageId(packageId)
  const existingByName = new Map(existingPlans.map(plan => [plan.name, plan]))
  const expectedNames = new Set<string>()

  // 关键流程：方案使用 packageId + name 做唯一识别，重复执行时只更新不重复插入。
  for (const plan of plans) {
    expectedNames.add(plan.name)
    const existing = existingByName.get(plan.name)

    if (!existing) {
      await db.createPlan({
        packageId,
        name: plan.name,
        description: plan.description,
        cpu: plan.cpu,
        memory: plan.memory,
        disk: plan.disk,
        portLimit: plan.portLimit,
        snapshotLimit: plan.snapshotLimit,
        backupLimit: plan.backupLimit,
        siteLimit: plan.siteLimit,
        swapSize: plan.swapSize,
        trafficLimit: plan.trafficLimit,
        trafficLimitSpeed: plan.trafficLimitSpeed,
        price: plan.price,
        billingCycle: plan.billingCycle,
        setupFee: plan.setupFee,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
        slaGuarantee: plan.slaGuarantee
      })
      stats.plans.created += 1
      continue
    }

    await db.updatePlan(existing.id, {
      description: plan.description,
      cpu: plan.cpu,
      memory: plan.memory,
      disk: plan.disk,
      portLimit: plan.portLimit,
      snapshotLimit: plan.snapshotLimit,
      backupLimit: plan.backupLimit,
      siteLimit: plan.siteLimit,
      swapSize: plan.swapSize,
      trafficLimit: plan.trafficLimit,
      trafficLimitSpeed: plan.trafficLimitSpeed,
      price: plan.price,
      billingCycle: plan.billingCycle,
      setupFee: plan.setupFee,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      slaGuarantee: plan.slaGuarantee
    })
    stats.plans.updated += 1
  }

  for (const existing of existingPlans) {
    if (!expectedNames.has(existing.name) && existing.isActive) {
      await db.updatePlan(existing.id, {
        isActive: false
      })
      stats.plans.updated += 1
    }
  }
}

const seedUsers: SeedUserSpec[] = [
  {
    username: 'admin',
    email: 'admin@incudal.local',
    role: 'admin'
  },
  {
    username: 'seed-market-alpha',
    email: 'seed-market-alpha@incudal.local',
    role: 'user',
    password: 'SeedAlpha123!',
    quota: {
      hostLimit: 8,
      packageLimit: 8
    }
  },
  {
    username: 'seed-market-beta',
    email: 'seed-market-beta@incudal.local',
    role: 'user',
    password: 'SeedBeta123!',
    quota: {
      hostLimit: 8,
      packageLimit: 8
    }
  }
]

const seedHosts: SeedHostSpec[] = [
  {
    ownerUsername: 'admin',
    name: 'seed-official-us-west',
    url: 'https://seed-official-us-west.local',
    location: 'Los Angeles, US',
    countryCode: 'us',
    architecture: 'x86_64',
    instanceType: 'both',
    status: 'online',
    tags: ['seed', 'official', 'us-west'],
    natPublicIp: '198.51.100.10',
    natPortStart: 20000,
    natPortEnd: 24999,
    ipAddress: '10.10.0.10',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 400,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 3200,
    memoryMax: 131072
  },
  {
    ownerUsername: 'admin',
    name: 'seed-official-eu-vm',
    url: 'https://seed-official-eu-vm.local',
    location: 'Frankfurt, DE',
    countryCode: 'de',
    architecture: 'x86_64',
    instanceType: 'vm',
    status: 'online',
    tags: ['seed', 'official', 'eu-central'],
    natPublicIp: '198.51.100.11',
    natPortStart: 25000,
    natPortEnd: 29999,
    ipAddress: '10.10.0.11',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 600,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 4800,
    memoryMax: 196608
  },
  {
    ownerUsername: 'admin',
    name: 'seed-official-asia-arm',
    url: 'https://seed-official-asia-arm.local',
    location: 'Singapore, SG',
    countryCode: 'sg',
    architecture: 'aarch64',
    instanceType: 'container',
    status: 'online',
    tags: ['seed', 'official', 'apac'],
    natPublicIp: '198.51.100.12',
    natPortStart: 30000,
    natPortEnd: 34999,
    ipAddress: '10.10.0.12',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 320,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 2400,
    memoryMax: 98304
  },
  {
    ownerUsername: 'seed-market-alpha',
    name: 'seed-market-jp-tokyo',
    url: 'https://seed-market-jp-tokyo.local',
    location: 'Tokyo, JP',
    countryCode: 'jp',
    architecture: 'x86_64',
    instanceType: 'container',
    status: 'online',
    tags: ['seed', 'market', 'tokyo'],
    natPublicIp: '203.0.113.20',
    natPortStart: 35000,
    natPortEnd: 38999,
    ipAddress: '10.20.0.20',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 240,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 2000,
    memoryMax: 65536
  },
  {
    ownerUsername: 'seed-market-alpha',
    name: 'seed-market-sg-latency',
    url: 'https://seed-market-sg-latency.local',
    location: 'Singapore, SG',
    countryCode: 'sg',
    architecture: 'x86_64',
    instanceType: 'container',
    status: 'online',
    tags: ['seed', 'market', 'singapore'],
    natPublicIp: '203.0.113.21',
    natPortStart: 39000,
    natPortEnd: 42999,
    ipAddress: '10.20.0.21',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 220,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 1800,
    memoryMax: 49152
  },
  {
    ownerUsername: 'seed-market-beta',
    name: 'seed-market-us-east',
    url: 'https://seed-market-us-east.local',
    location: 'Ashburn, US',
    countryCode: 'us',
    architecture: 'x86_64',
    instanceType: 'both',
    status: 'online',
    tags: ['seed', 'market', 'us-east'],
    natPublicIp: '203.0.113.22',
    natPortStart: 43000,
    natPortEnd: 46999,
    ipAddress: '10.30.0.22',
    storageDriver: 'zfs',
    storageType: 'loop',
    storageSize: 260,
    enableApi: true,
    isInstalled: true,
    cpuAllowanceMax: 2200,
    memoryMax: 65536
  }
]

const seedPackages: SeedPackageSpec[] = [
  {
    ownerUsername: 'admin',
    name: 'SEED Official Edge Container',
    description: 'Public official container package for local smoke testing across US and APAC.',
    hostNames: ['seed-official-us-west', 'seed-official-asia-arm'],
    cpuMax: 300,
    memoryMax: 8192,
    diskMax: 102400,
    bandwidthMax: 2000,
    networkMode: 'nat_ipv6',
    instanceType: 'container',
    privileged: true,
    nested: true,
    active: true,
    portLimit: 40,
    snapshotLimit: 8,
    backupLimit: 4,
    siteLimit: 12,
    monthlyTrafficLimit: bytesFromGb(800),
    ioLimitMode: 'throughput',
    limitsRead: '250MB',
    limitsWrite: '250MB',
    limitsReadIops: 1200,
    limitsWriteIops: 1200,
    limitsIngress: '1Gbit',
    limitsEgress: '1Gbit',
    limitsProcesses: 1200,
    limitsCpuPriority: 10,
    bootAutostart: true,
    bootAutostartPriority: 20,
    bootAutostartDelay: 15,
    bootHostShutdownTimeout: 45,
    globalShared: true,
    globalQuotaMultiplier: 2,
    globalMaxInstances: 6,
    allowInstanceDeletion: true,
    plans: [
      {
        name: 'Mini',
        description: '25% CPU / 512MB memory / 15GB disk',
        cpu: 25,
        memory: 512,
        disk: 15360,
        portLimit: 10,
        snapshotLimit: 3,
        backupLimit: 1,
        siteLimit: 2,
        swapSize: 0,
        trafficLimit: bytesFromGb(120),
        trafficLimitSpeed: '3Mbit',
        price: 690,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 10,
        slaGuarantee: 99.5
      },
      {
        name: 'Standard',
        description: '60% CPU / 2GB memory / 40GB disk',
        cpu: 60,
        memory: 2048,
        disk: 40960,
        portLimit: 20,
        snapshotLimit: 5,
        backupLimit: 2,
        siteLimit: 5,
        swapSize: 512,
        trafficLimit: bytesFromGb(260),
        trafficLimitSpeed: '5Mbit',
        price: 1990,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 20,
        slaGuarantee: 99.9
      },
      {
        name: 'Compute',
        description: '120% CPU / 4GB memory / 80GB disk',
        cpu: 120,
        memory: 4096,
        disk: 81920,
        portLimit: 35,
        snapshotLimit: 8,
        backupLimit: 4,
        siteLimit: 8,
        swapSize: 1024,
        trafficLimit: bytesFromGb(520),
        trafficLimitSpeed: '10Mbit',
        price: 3990,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 30,
        slaGuarantee: 99.95
      }
    ]
  },
  {
    ownerUsername: 'admin',
    name: 'SEED Official EU VM',
    description: 'Public official VM package for local billing and scheduler testing.',
    hostNames: ['seed-official-eu-vm'],
    cpuMax: 600,
    memoryMax: 16384,
    diskMax: 204800,
    bandwidthMax: 3000,
    networkMode: 'nat_ipv6',
    instanceType: 'vm',
    privileged: false,
    nested: false,
    active: true,
    portLimit: 20,
    snapshotLimit: 6,
    backupLimit: 4,
    siteLimit: 2,
    monthlyTrafficLimit: bytesFromGb(1000),
    ioLimitMode: 'iops',
    limitsRead: '300MB',
    limitsWrite: '300MB',
    limitsReadIops: 2000,
    limitsWriteIops: 2000,
    limitsIngress: '1Gbit',
    limitsEgress: '1Gbit',
    limitsProcesses: 600,
    limitsCpuPriority: 8,
    bootAutostart: true,
    bootAutostartPriority: 15,
    bootAutostartDelay: 20,
    bootHostShutdownTimeout: 60,
    globalShared: true,
    globalQuotaMultiplier: 1.5,
    globalMaxInstances: 4,
    allowInstanceDeletion: true,
    plans: [
      {
        name: 'VM Starter',
        description: '100% CPU / 2GB memory / 40GB disk',
        cpu: 100,
        memory: 2048,
        disk: 40960,
        portLimit: 6,
        snapshotLimit: 2,
        backupLimit: 1,
        siteLimit: 0,
        swapSize: 0,
        trafficLimit: bytesFromGb(200),
        trafficLimitSpeed: '5Mbit',
        price: 2990,
        billingCycle: 1,
        setupFee: 500,
        isActive: true,
        sortOrder: 10,
        slaGuarantee: 99.9
      },
      {
        name: 'VM Business',
        description: '200% CPU / 4GB memory / 80GB disk',
        cpu: 200,
        memory: 4096,
        disk: 81920,
        portLimit: 12,
        snapshotLimit: 4,
        backupLimit: 2,
        siteLimit: 1,
        swapSize: 0,
        trafficLimit: bytesFromGb(400),
        trafficLimitSpeed: '10Mbit',
        price: 5990,
        billingCycle: 1,
        setupFee: 1000,
        isActive: true,
        sortOrder: 20,
        slaGuarantee: 99.95
      }
    ]
  },
  {
    ownerUsername: 'seed-market-alpha',
    name: 'SEED Market APAC Burst',
    description: 'Hosted public package for local market testing in Tokyo and Singapore.',
    hostNames: ['seed-market-jp-tokyo', 'seed-market-sg-latency'],
    cpuMax: 240,
    memoryMax: 6144,
    diskMax: 81920,
    bandwidthMax: 1500,
    networkMode: 'nat_ipv6_nat',
    instanceType: 'container',
    privileged: true,
    nested: true,
    active: true,
    portLimit: 32,
    snapshotLimit: 6,
    backupLimit: 3,
    siteLimit: 6,
    monthlyTrafficLimit: bytesFromGb(500),
    ioLimitMode: 'throughput',
    limitsRead: '180MB',
    limitsWrite: '180MB',
    limitsReadIops: 1000,
    limitsWriteIops: 1000,
    limitsIngress: '600Mbit',
    limitsEgress: '600Mbit',
    limitsProcesses: 900,
    limitsCpuPriority: 9,
    bootAutostart: true,
    bootAutostartPriority: 25,
    bootAutostartDelay: 10,
    bootHostShutdownTimeout: 40,
    globalShared: true,
    globalQuotaMultiplier: 1.5,
    globalMaxInstances: 5,
    allowInstanceDeletion: true,
    plans: [
      {
        name: 'Burst Nano',
        description: '30% CPU / 768MB memory / 20GB disk',
        cpu: 30,
        memory: 768,
        disk: 20480,
        portLimit: 8,
        snapshotLimit: 2,
        backupLimit: 1,
        siteLimit: 1,
        swapSize: 0,
        trafficLimit: bytesFromGb(80),
        trafficLimitSpeed: '2Mbit',
        price: 880,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 10,
        slaGuarantee: 99.5
      },
      {
        name: 'Burst Plus',
        description: '80% CPU / 2GB memory / 45GB disk',
        cpu: 80,
        memory: 2048,
        disk: 46080,
        portLimit: 16,
        snapshotLimit: 4,
        backupLimit: 2,
        siteLimit: 3,
        swapSize: 512,
        trafficLimit: bytesFromGb(180),
        trafficLimitSpeed: '5Mbit',
        price: 2280,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 20,
        slaGuarantee: 99.8
      },
      {
        name: 'Burst Pro',
        description: '140% CPU / 4GB memory / 70GB disk',
        cpu: 140,
        memory: 4096,
        disk: 71680,
        portLimit: 24,
        snapshotLimit: 6,
        backupLimit: 3,
        siteLimit: 5,
        swapSize: 1024,
        trafficLimit: bytesFromGb(320),
        trafficLimitSpeed: '8Mbit',
        price: 3680,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 30,
        slaGuarantee: 99.9
      }
    ]
  },
  {
    ownerUsername: 'seed-market-beta',
    name: 'SEED Market US Balanced',
    description: 'Hosted public package for local market testing in the US East region.',
    hostNames: ['seed-market-us-east'],
    cpuMax: 260,
    memoryMax: 8192,
    diskMax: 102400,
    bandwidthMax: 1800,
    networkMode: 'nat',
    instanceType: 'container',
    privileged: true,
    nested: true,
    active: true,
    portLimit: 28,
    snapshotLimit: 5,
    backupLimit: 3,
    siteLimit: 4,
    monthlyTrafficLimit: bytesFromGb(420),
    ioLimitMode: 'throughput',
    limitsRead: '200MB',
    limitsWrite: '200MB',
    limitsReadIops: 1100,
    limitsWriteIops: 1100,
    limitsIngress: '700Mbit',
    limitsEgress: '700Mbit',
    limitsProcesses: 950,
    limitsCpuPriority: 9,
    bootAutostart: true,
    bootAutostartPriority: 18,
    bootAutostartDelay: 12,
    bootHostShutdownTimeout: 40,
    globalShared: true,
    globalQuotaMultiplier: 1.2,
    globalMaxInstances: 4,
    allowInstanceDeletion: true,
    plans: [
      {
        name: 'Balanced S',
        description: '40% CPU / 1GB memory / 25GB disk',
        cpu: 40,
        memory: 1024,
        disk: 25600,
        portLimit: 10,
        snapshotLimit: 2,
        backupLimit: 1,
        siteLimit: 1,
        swapSize: 0,
        trafficLimit: bytesFromGb(100),
        trafficLimitSpeed: '3Mbit',
        price: 1090,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 10,
        slaGuarantee: 99.6
      },
      {
        name: 'Balanced M',
        description: '90% CPU / 3GB memory / 60GB disk',
        cpu: 90,
        memory: 3072,
        disk: 61440,
        portLimit: 20,
        snapshotLimit: 4,
        backupLimit: 2,
        siteLimit: 2,
        swapSize: 512,
        trafficLimit: bytesFromGb(220),
        trafficLimitSpeed: '6Mbit',
        price: 2490,
        billingCycle: 1,
        setupFee: 0,
        isActive: true,
        sortOrder: 20,
        slaGuarantee: 99.85
      }
    ]
  }
]

async function main(): Promise<void> {
  await db.initPrismaDatabase()

  // 先准备账号，再按账号归属写入节点、公开套餐和套餐方案。
  for (const user of seedUsers) {
    await ensureUser(user)
  }

  for (const host of seedHosts) {
    await ensureHost(host)
  }

  for (const pkg of seedPackages) {
    const packageId = await ensurePackage(pkg)
    await ensurePlans(packageId, pkg.plans)
  }

  console.log('[seed:test-data] completed')
  console.log(
    `[seed:test-data] users created=${stats.users.created} updated=${stats.users.updated}, ` +
    `hosts created=${stats.hosts.created} updated=${stats.hosts.updated}, ` +
    `packages created=${stats.packages.created} updated=${stats.packages.updated}, ` +
    `plans created=${stats.plans.created} updated=${stats.plans.updated}`
  )
  console.log(
    `[seed:test-data] seeded targets users=${seedUsers.length}, hosts=${seedHosts.length}, ` +
    `packages=${seedPackages.length}, plans=${countPlans(seedPackages)}`
  )
}

void main().catch(async error => {
  console.error('[seed:test-data] failed:', error)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect()
})
