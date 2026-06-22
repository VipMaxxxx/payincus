import '../src/config/env.js'

// @ts-ignore - bcryptjs ships its own types in this repo setup
import bcrypt from 'bcryptjs'

import { closePrismaDatabase, prisma } from '../src/db/prisma.js'

type SeedRole = 'admin' | 'user'
type SeedUserStatus = 'active' | 'banned'
type SeedHostStatus = 'online' | 'offline' | 'maintenance'
type SeedHostInstanceType = 'container' | 'vm' | 'both'
type SeedPackageInstanceType = 'container' | 'vm'
type SeedNetworkMode = 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
type SeedInstanceStatus = 'running' | 'stopped' | 'suspended' | 'error'
type SeedTrafficStatus = 'NORMAL' | 'WARNING' | 'LIMITED'
type SeedProtocol = 'tcp' | 'udp'
type SeedProxyStatus = 'pending' | 'active' | 'error'
type SeedBackupStatus = 'ready' | 'error'
type SeedTicketPriority = 'low' | 'normal' | 'high' | 'urgent'
type SeedTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type SeedBalanceLogType = 'recharge' | 'consume' | 'gift' | 'admin_adjust'
type SeedNotificationChannelType = 'telegram' | 'discord' | 'email' | 'webhook'
type SeedAnnouncementType = 'system_broadcast' | 'host_broadcast' | 'admin_message' | 'host_message'
type SeedPaymentProviderType = 'yipay' | 'stripe' | 'alipay_direct' | 'wechat_direct' | 'manual'
type SeedRechargeStatus = 'pending' | 'paid' | 'completed' | 'failed' | 'cancelled' | 'refunded'
type SeedAffLogType = 'new_purchase' | 'renew' | 'convert'
type SeedAffWithdrawalStatus = 'pending' | 'approved' | 'rejected'
type SeedRedeemCodeType = 'c' | 'r' | 'd' | 't' | 'p'

type SeedQuota = {
  hostLimit: number
  packageLimit: number
  monthlyTrafficLimit: bigint | null
}

type SeedUserSpec = {
  username: string
  email: string
  role: SeedRole
  status: SeedUserStatus
  banReason: string | null
  avatarStyle: string
  quota: SeedQuota
}

type SeedHostSpec = {
  ownerUsername: string
  name: string
  url: string
  location: string
  countryCode: string
  architecture: 'x86_64' | 'aarch64'
  status: SeedHostStatus
  instanceType: SeedHostInstanceType
  natPublicIp: string
  natPublicIpv6: string
  natBindIp: string
  natBindIpv6: string
  natPortStart: number
  natPortEnd: number
  ipAddress: string
  ipv6Subnet: string
  ipv6Gateway: string
  tags: string[]
  storageSize: number
  cpuAllowanceMax: number
  memoryMax: number
  caddyEnabled: boolean
}

type SeedStoragePoolSpec = {
  name: string
  driver: string
  purpose: 'instance_data' | 'instance_storage'
  description: string
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
  key: string
  ownerUsername: string
  name: string
  description: string
  hostNames: string[]
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax: number
  networkMode: SeedNetworkMode
  instanceType: SeedPackageInstanceType
  privileged: boolean
  nested: boolean
  active: boolean
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  monthlyTrafficLimit: bigint
  ioLimitMode: 'throughput' | 'iops'
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

type GeneratedPackageRecord = {
  id: number
  spec: SeedPackageSpec
  planIdsByName: Map<string, number>
}

type SeedInstanceSpec = {
  name: string
  incusId: string
  userUsername: string
  packageKey: string
  planName: string
  hostName: string
  image: string
  status: SeedInstanceStatus
  createdAt: Date
  expiresAt: Date | null
  suspendedAt: Date | null
  suspendedBy: number | null
  suspendReason: string | null
  autoRenew: boolean
  cloudInitState: string | null
  cloudInitSource: string | null
  ipv4: string | null
  ipv6: string | null
  sshPort: number | null
  monthlyTrafficUsed: bigint
  trafficStatus: SeedTrafficStatus
  lastIpv6ReassignAt: Date | null
  lastPlanChangeAt: Date | null
  lastSyncedAt: Date
}

type SeedBalanceLogSpec = {
  userId: number
  type: SeedBalanceLogType
  amount: number
  balanceBefore: number
  balanceAfter: number
  orderId: string | null
  remark: string
}

type GeneratedInstanceRecord = {
  id: number
  userId: number
  hostId: number
  packageId: number
  packagePlanId: number
  spec: SeedInstanceSpec
  packageSpec: SeedPackageSpec
  plan: SeedPlanSpec
}

type CreatedNotificationChannel = {
  id: number
  userId: number
  type: SeedNotificationChannelType
}

type CreatedAffCode = {
  id: number
  userId: number
  packagePlanId: number | null
  code: string
}

const SEED_PREFIX = 'bulkseed'
const SEED_MARK = `[${SEED_PREFIX}]`
const SEED_CODE_PREFIX = SEED_PREFIX.toUpperCase()
const SHARED_PASSWORD = 'BulkSeed123!'
const LOCAL_PASSWORD_SALT = '$2a$10$1234567890123456789012'
const TODAY = new Date()

const avatarStyles = ['bigSmile', 'croodles', 'notionists', 'lorelei']
const countries = ['us', 'sg', 'jp', 'de', 'nl', 'au']
const cities = ['Los Angeles', 'Singapore', 'Tokyo', 'Frankfurt', 'Amsterdam', 'Sydney']
const containerImages = [
  'images:ubuntu/24.04/cloud',
  'images:debian/12/cloud',
  'images:almalinux/9/cloud',
  'images:rockylinux/9/cloud'
]
const vmImages = [
  'images:ubuntu/24.04/cloud',
  'images:debian/12/cloud',
  'images:almalinux/9/cloud'
]
const redeemCodeTypes: SeedRedeemCodeType[] = ['c', 'r', 'd', 't', 'p']

const ownerUsers: SeedUserSpec[] = [
  createOwnerUser(1, 'admin', 'admin', 24, 40),
  createOwnerUser(2, 'apac', 'user', 18, 32),
  createOwnerUser(3, 'eu', 'user', 18, 32),
  createOwnerUser(4, 'us', 'user', 18, 32),
  createOwnerUser(5, 'edge', 'user', 18, 32),
  createOwnerUser(6, 'lab', 'user', 18, 32)
]

const customerUsers: SeedUserSpec[] = Array.from({ length: 30 }, (_, index) => {
  const id = index + 1
  const status: SeedUserStatus = id % 17 === 0 ? 'banned' : 'active'
  return {
    username: `${SEED_PREFIX}-user-${pad(id, 2)}`,
    email: `${SEED_PREFIX}-user-${pad(id, 2)}@incudal.local`,
    role: 'user',
    status,
    banReason: status === 'banned' ? `${SEED_MARK} banned sample user` : null,
    avatarStyle: avatarStyles[index % avatarStyles.length],
    quota: {
      hostLimit: 0,
      packageLimit: 0,
      monthlyTrafficLimit: bytesFromGb(800)
    }
  }
})

const allSeedUsers = [...ownerUsers, ...customerUsers]

const hostSpecs: SeedHostSpec[] = [
  createHostSpec(1, ownerUsers[0].username, 'official-us-west', 'Los Angeles, US', 'us', 'x86_64', 'both', 'online'),
  createHostSpec(2, ownerUsers[0].username, 'official-eu-vm', 'Frankfurt, DE', 'de', 'x86_64', 'vm', 'online'),
  createHostSpec(3, ownerUsers[1].username, 'apac-sg-edge', 'Singapore, SG', 'sg', 'x86_64', 'both', 'online'),
  createHostSpec(4, ownerUsers[1].username, 'apac-tokyo-arm', 'Tokyo, JP', 'jp', 'aarch64', 'container', 'online'),
  createHostSpec(5, ownerUsers[2].username, 'eu-amsterdam', 'Amsterdam, NL', 'nl', 'x86_64', 'both', 'online'),
  createHostSpec(6, ownerUsers[2].username, 'eu-madrid-vm', 'Madrid, ES', 'us', 'x86_64', 'vm', 'online'),
  createHostSpec(7, ownerUsers[3].username, 'us-ashburn', 'Ashburn, US', 'us', 'x86_64', 'both', 'online'),
  createHostSpec(8, ownerUsers[3].username, 'us-dallas-container', 'Dallas, US', 'us', 'x86_64', 'container', 'online'),
  createHostSpec(9, ownerUsers[4].username, 'edge-seoul', 'Seoul, KR', 'jp', 'aarch64', 'container', 'online'),
  createHostSpec(10, ownerUsers[4].username, 'edge-sydney', 'Sydney, AU', 'au', 'x86_64', 'both', 'online'),
  createHostSpec(11, ownerUsers[5].username, 'lab-london', 'London, GB', 'de', 'x86_64', 'both', 'online'),
  createHostSpec(12, ownerUsers[5].username, 'lab-warsaw-vm', 'Warsaw, PL', 'nl', 'x86_64', 'vm', 'online')
]

const storagePools: SeedStoragePoolSpec[] = [
  {
    name: 'default',
    driver: 'zfs',
    purpose: 'instance_data',
    description: `${SEED_MARK} default pool`
  },
  {
    name: 'archive',
    driver: 'dir',
    purpose: 'instance_storage',
    description: `${SEED_MARK} archive pool`
  }
]

const packageSpecs = buildPackageSpecs()
const instanceSpecs = buildInstanceSpecs(packageSpecs)

function createOwnerUser(index: number, slug: string, role: SeedRole, hostLimit: number, packageLimit: number): SeedUserSpec {
  return {
    username: `${SEED_PREFIX}-owner-${slug}`,
    email: `${SEED_PREFIX}-owner-${slug}@incudal.local`,
    role,
    status: 'active',
    banReason: null,
    avatarStyle: avatarStyles[(index - 1) % avatarStyles.length],
    quota: {
      hostLimit,
      packageLimit,
      monthlyTrafficLimit: bytesFromGb(3000)
    }
  }
}

function createHostSpec(
  index: number,
  ownerUsername: string,
  slug: string,
  location: string,
  countryCode: string,
  architecture: 'x86_64' | 'aarch64',
  instanceType: SeedHostInstanceType,
  status: SeedHostStatus
): SeedHostSpec {
  const natBase = 40 + index
  const hex = (0x40 + index).toString(16)
  return {
    ownerUsername,
    name: `${SEED_PREFIX}-host-${pad(index, 2)}-${slug}`,
    url: `https://${SEED_PREFIX}-host-${pad(index, 2)}-${slug}.local`,
    location,
    countryCode,
    architecture,
    status,
    instanceType,
    natPublicIp: `198.51.100.${natBase}`,
    natPublicIpv6: `2001:db8:feed:${hex}::${index}`,
    natBindIp: `10.255.${index}.10`,
    natBindIpv6: `fd00:255:${hex}::10`,
    natPortStart: 20000 + (index - 1) * 400,
    natPortEnd: 20000 + (index - 1) * 400 + 399,
    ipAddress: `10.20.${index}.10`,
    ipv6Subnet: `2001:db8:${hex}::/64`,
    ipv6Gateway: `2001:db8:${hex}::1`,
    tags: [SEED_PREFIX, slug, architecture, instanceType],
    storageSize: 200 + index * 15,
    cpuAllowanceMax: 2200 + index * 180,
    memoryMax: 65536 + index * 4096,
    caddyEnabled: index % 2 === 0
  }
}

function bytesFromGb(gb: number): bigint {
  return BigInt(gb) * 1024n * 1024n * 1024n
}

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, '0')
}

function daysAgo(days: number, hour = 10): Date {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, 0, 0, 0)
  return date
}

function daysFromNow(days: number, hour = 10): Date {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  date.setUTCHours(hour, 0, 0, 0)
  return date
}

function addMonths(input: Date, months: number): Date {
  const output = new Date(input)
  output.setUTCMonth(output.getUTCMonth() + months)
  return output
}

function roundToStep(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step)
}

function getBaseRechargeAmount(user: SeedUserSpec, index: number, spend: number): number {
  return Math.max(
    user.role === 'admin' ? 30000 + index * 500 : 9000 + index * 120,
    spend + 2000 + index * 50
  )
}

function getGiftAmount(user: SeedUserSpec, index: number): number {
  return user.role === 'admin' ? 1500 : 300 + index * 10
}

function getSeedOrderNo(index: number): string {
  return `${SEED_PREFIX}-recharge-${pad(index + 1, 3)}`
}

function buildDemoPublicKey(username: string, index: number): string {
  const body = Buffer.from(`${SEED_PREFIX}:${username}:${index}`).toString('base64')
  return `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${body.slice(0, 40)} ${username}@seed.local`
}

function buildDemoFingerprint(username: string, index: number): string {
  const body = Buffer.from(`${username}:${index}:${SEED_PREFIX}`).toString('base64')
  return `SHA256:${body.slice(0, 32)}`
}

function getOwnerHosts(ownerUsername: string): SeedHostSpec[] {
  return hostSpecs.filter(host => host.ownerUsername === ownerUsername)
}

function buildPackageSpecs(): SeedPackageSpec[] {
  const thirdModes: SeedNetworkMode[] = ['nat_ipv6_nat', 'ipv6_only', 'ipv6_nat']
  const packageList: SeedPackageSpec[] = []

  ownerUsers.forEach((owner, ownerIndex) => {
    const hosts = getOwnerHosts(owner.username)
    const containerHosts = hosts.filter(host => host.instanceType !== 'vm')
    const vmHosts = hosts.filter(host => host.instanceType !== 'container')
    const cpuBase = 220 + ownerIndex * 20
    const memoryBase = 8192 + ownerIndex * 1024
    const diskBase = 102400 + ownerIndex * 10240
    const thirdMode = thirdModes[ownerIndex % thirdModes.length]

    packageList.push(
      createPackageSpec({
        index: packageList.length + 1,
        ownerUsername: owner.username,
        suffix: 'nat-box',
        title: `NAT Box ${ownerIndex + 1}`,
        description: `${SEED_MARK} public IPv4 NAT container package`,
        hostNames: uniqueNames(containerHosts.map(host => host.name)),
        networkMode: 'nat',
        instanceType: 'container',
        cpuMax: cpuBase,
        memoryMax: memoryBase,
        diskMax: diskBase,
        bandwidthMax: 1200 + ownerIndex * 120,
        globalShared: true,
        portLimit: 24,
        snapshotLimit: 5,
        backupLimit: 3,
        siteLimit: 4,
        monthlyTrafficLimit: bytesFromGb(480 + ownerIndex * 40),
        ioLimitMode: ownerIndex % 2 === 0 ? 'throughput' : 'iops',
        globalQuotaMultiplier: 1.5
      }),
      createPackageSpec({
        index: packageList.length + 2,
        ownerUsername: owner.username,
        suffix: 'dual-stack',
        title: `Dual Stack ${ownerIndex + 1}`,
        description: `${SEED_MARK} IPv4 NAT + routed IPv6 package`,
        hostNames: uniqueNames(containerHosts.map(host => host.name)),
        networkMode: 'nat_ipv6',
        instanceType: 'container',
        cpuMax: cpuBase + 30,
        memoryMax: memoryBase + 1024,
        diskMax: diskBase + 10240,
        bandwidthMax: 1400 + ownerIndex * 120,
        globalShared: ownerIndex % 2 === 0,
        portLimit: 28,
        snapshotLimit: 6,
        backupLimit: 3,
        siteLimit: 5,
        monthlyTrafficLimit: bytesFromGb(560 + ownerIndex * 40),
        ioLimitMode: 'throughput',
        globalQuotaMultiplier: 1.8
      }),
      createPackageSpec({
        index: packageList.length + 3,
        ownerUsername: owner.username,
        suffix: `ipv6-${thirdMode}`,
        title: `IPv6 Mix ${ownerIndex + 1}`,
        description: `${SEED_MARK} IPv6-heavy container package`,
        hostNames: uniqueNames(containerHosts.map(host => host.name)),
        networkMode: thirdMode,
        instanceType: 'container',
        cpuMax: cpuBase + 10,
        memoryMax: memoryBase + 512,
        diskMax: diskBase,
        bandwidthMax: 1000 + ownerIndex * 100,
        globalShared: true,
        portLimit: thirdMode === 'ipv6_only' ? 0 : 18,
        snapshotLimit: 4,
        backupLimit: 2,
        siteLimit: 4,
        monthlyTrafficLimit: bytesFromGb(360 + ownerIndex * 30),
        ioLimitMode: 'throughput',
        globalQuotaMultiplier: 1.2
      }),
      createPackageSpec({
        index: packageList.length + 4,
        ownerUsername: owner.username,
        suffix: 'vm-flex',
        title: `VM Flex ${ownerIndex + 1}`,
        description: `${SEED_MARK} KVM package for billing and lifecycle screens`,
        hostNames: uniqueNames(vmHosts.map(host => host.name)),
        networkMode: ownerIndex % 2 === 0 ? 'nat_ipv6' : 'nat',
        instanceType: 'vm',
        cpuMax: 300 + ownerIndex * 30,
        memoryMax: 12288 + ownerIndex * 1024,
        diskMax: 153600 + ownerIndex * 10240,
        bandwidthMax: 1800 + ownerIndex * 100,
        globalShared: ownerIndex % 3 !== 0,
        portLimit: 10,
        snapshotLimit: 4,
        backupLimit: 3,
        siteLimit: 1,
        monthlyTrafficLimit: bytesFromGb(700 + ownerIndex * 50),
        ioLimitMode: 'iops',
        globalQuotaMultiplier: 1.0
      })
    )
  })

  return packageList
}

function createPackageSpec(input: {
  index: number
  ownerUsername: string
  suffix: string
  title: string
  description: string
  hostNames: string[]
  networkMode: SeedNetworkMode
  instanceType: SeedPackageInstanceType
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax: number
  globalShared: boolean
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  monthlyTrafficLimit: bigint
  ioLimitMode: 'throughput' | 'iops'
  globalQuotaMultiplier: number | null
}): SeedPackageSpec {
  const isVm = input.instanceType === 'vm'
  const key = `${SEED_PREFIX}-pkg-${pad(input.index, 2)}`
  const planNames = isVm ? ['Starter', 'Business', 'Scale'] : ['Nano', 'Plus', 'Prime']
  const planScales = isVm ? [0.28, 0.46, 0.68] : [0.18, 0.36, 0.58]

  const plans = planNames.map((planName, index) => {
    const scale = planScales[index]
    const baseCpu = roundToStep(input.cpuMax * scale, isVm ? 20 : 5)
    const baseMemory = roundToStep(input.memoryMax * scale, 256)
    const baseDisk = roundToStep(input.diskMax * scale, 1024)
    return {
      name: planName,
      description: `${SEED_MARK} ${planName} plan for ${input.title}`,
      cpu: baseCpu,
      memory: baseMemory,
      disk: baseDisk,
      portLimit: input.networkMode === 'ipv6_only' ? 0 : Math.max(0, Math.min(input.portLimit, 6 + index * (isVm ? 2 : 6))),
      snapshotLimit: Math.min(input.snapshotLimit, 2 + index),
      backupLimit: Math.min(input.backupLimit, 1 + Math.floor(index / 1)),
      siteLimit: isVm ? Math.min(input.siteLimit, index === 2 ? 1 : 0) : Math.min(input.siteLimit, 1 + index * 2),
      swapSize: isVm ? 0 : index === 0 ? 0 : index * 512,
      trafficLimit: bytesFromGb((isVm ? 180 : 90) + index * (isVm ? 160 : 80) + input.index * 5),
      trafficLimitSpeed: ['2Mbit', '5Mbit', '10Mbit'][index],
      price: (isVm ? 2990 : 890) + input.index * (isVm ? 60 : 25) + index * (isVm ? 1800 : 900),
      billingCycle: index === 2 && isVm ? 3 : 1,
      setupFee: isVm ? index * 300 : 0,
      isActive: true,
      sortOrder: (index + 1) * 10,
      slaGuarantee: [99.5, 99.9, 99.95][index]
    }
  })

  return {
    key,
    ownerUsername: input.ownerUsername,
    name: `${key}-${input.suffix}`,
    description: input.description,
    hostNames: input.hostNames,
    networkMode: input.networkMode,
    instanceType: input.instanceType,
    cpuMax: input.cpuMax,
    memoryMax: input.memoryMax,
    diskMax: input.diskMax,
    bandwidthMax: input.bandwidthMax,
    privileged: !isVm,
    nested: !isVm,
    active: true,
    portLimit: input.portLimit,
    snapshotLimit: input.snapshotLimit,
    backupLimit: input.backupLimit,
    siteLimit: input.siteLimit,
    monthlyTrafficLimit: input.monthlyTrafficLimit,
    ioLimitMode: input.ioLimitMode,
    limitsRead: isVm ? '350MB' : '220MB',
    limitsWrite: isVm ? '350MB' : '220MB',
    limitsReadIops: isVm ? 2200 : 1100,
    limitsWriteIops: isVm ? 2200 : 1100,
    limitsIngress: isVm ? '1Gbit' : '600Mbit',
    limitsEgress: isVm ? '1Gbit' : '600Mbit',
    limitsProcesses: isVm ? 800 : 1200,
    limitsCpuPriority: isVm ? 8 : 10,
    bootAutostart: true,
    bootAutostartPriority: 10 + (input.index % 10),
    bootAutostartDelay: 10 + (input.index % 5) * 5,
    bootHostShutdownTimeout: isVm ? 60 : 45,
    globalShared: input.globalShared,
    globalQuotaMultiplier: input.globalQuotaMultiplier,
    globalMaxInstances: 12,
    allowInstanceDeletion: true,
    plans
  }
}

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values))
}

function buildInstanceSpecs(packages: SeedPackageSpec[]): SeedInstanceSpec[] {
  return Array.from({ length: 64 }, (_, index) => {
    const id = index + 1
    const packageSpec = packages[index % packages.length]
    const planName = packageSpec.plans[index % packageSpec.plans.length].name
    const hostName = packageSpec.hostNames[index % packageSpec.hostNames.length]
    const status = pickInstanceStatus(index)
    const createdAt = daysAgo(4 + (index % 120), 8 + (index % 6))
    const expiresAt = status === 'suspended' ? daysAgo(1 + (index % 4), 9) : daysFromNow(20 + (index % 90), 9)
    const ipv4 = ['nat', 'nat_ipv6', 'nat_ipv6_nat'].includes(packageSpec.networkMode)
      ? `10.${60 + (index % 20)}.${1 + Math.floor(index / 20)}.${20 + (index % 180)}`
      : null
    const routedIpv6 = packageSpec.networkMode === 'nat_ipv6' || packageSpec.networkMode === 'ipv6_only'
      ? `2001:db8:${(0x900 + index).toString(16)}::${100 + id}`
      : null
    const sharedIpv6 = packageSpec.networkMode === 'nat_ipv6_nat' || packageSpec.networkMode === 'ipv6_nat'
      ? `2001:db8:share::${id}`
      : null
    const primaryIpv6 = routedIpv6 ?? sharedIpv6
    const firstPublicPort = packageSpec.networkMode === 'ipv6_only' ? null : 21000 + index * 6
    const trafficStatus: SeedTrafficStatus = index % 11 === 0 ? 'LIMITED' : index % 7 === 0 ? 'WARNING' : 'NORMAL'
    const monthlyTrafficUsed = trafficStatus === 'LIMITED'
      ? bytesFromGb(240 + index * 3)
      : trafficStatus === 'WARNING'
        ? bytesFromGb(180 + index * 2)
        : bytesFromGb(70 + index * 2)

    return {
      name: `${SEED_PREFIX}-inst-${pad(id, 3)}`,
      incusId: `${SEED_PREFIX}-incus-${pad(id, 3)}`,
      userUsername: customerUsers[(index * 7) % customerUsers.length].username,
      packageKey: packageSpec.key,
      planName,
      hostName,
      image: packageSpec.instanceType === 'vm'
        ? vmImages[index % vmImages.length]
        : containerImages[index % containerImages.length],
      status,
      createdAt,
      expiresAt,
      suspendedAt: status === 'suspended' ? daysAgo(index % 4, 9) : null,
      suspendedBy: status === 'suspended' && index % 2 === 0 ? 1 : null,
      suspendReason: status === 'suspended' ? `${SEED_MARK} expired sample` : null,
      autoRenew: index % 3 !== 0,
      cloudInitState: status === 'error' ? 'error' : 'done',
      cloudInitSource: packageSpec.instanceType === 'vm' ? 'cloud-init' : 'lxd-agent',
      ipv4,
      ipv6: primaryIpv6,
      sshPort: firstPublicPort ?? 22,
      monthlyTrafficUsed,
      trafficStatus,
      lastIpv6ReassignAt: packageSpec.networkMode === 'nat_ipv6' && index % 5 === 0 ? daysAgo(index % 3, 7) : null,
      lastPlanChangeAt: index % 6 === 0 ? daysAgo(2 + (index % 9), 11) : null,
      lastSyncedAt: daysAgo(index % 5, 14)
    }
  })
}

function pickInstanceStatus(index: number): SeedInstanceStatus {
  const mod = index % 20
  if (mod === 17) return 'error'
  if (mod === 18) return 'suspended'
  if (mod === 19 || mod === 14 || mod === 15) return 'stopped'
  return 'running'
}

async function ensureLocalDevGuard(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || ''
  const isDevDb = databaseUrl.includes('incudal_dev_password@db:5432/incudal')
  if (!isDevDb && process.env.FORCE_BULK_SEED !== '1') {
    throw new Error(
      `Refusing to run ${SEED_PREFIX} seed outside the local dev database. Set FORCE_BULK_SEED=1 to override.`
    )
  }
}

async function buildPasswordHash(password: string): Promise<string> {
  return bcrypt.hash(password, LOCAL_PASSWORD_SALT)
}

async function syncUsers(passwordHash: string): Promise<Map<string, number>> {
  const userIds = new Map<string, number>()

  for (const [index, user] of allSeedUsers.entries()) {
    const saved = await prisma.user.upsert({
      where: { username: user.username },
      create: {
        username: user.username,
        email: user.email,
        passwordHash,
        role: user.role,
        status: user.status,
        banReason: user.banReason,
        balance: 0,
        avatarStyle: user.avatarStyle
      },
      update: {
        email: user.email,
        passwordHash,
        role: user.role,
        status: user.status,
        banReason: user.banReason,
        avatarStyle: user.avatarStyle
      }
    })

    await prisma.userQuota.upsert({
      where: { userId: saved.id },
      create: {
        userId: saved.id,
        hostLimit: user.quota.hostLimit,
        packageLimit: user.quota.packageLimit,
        monthlyTrafficLimit: user.quota.monthlyTrafficLimit
      },
      update: {
        hostLimit: user.quota.hostLimit,
        packageLimit: user.quota.packageLimit,
        monthlyTrafficLimit: user.quota.monthlyTrafficLimit
      }
    })

    userIds.set(user.username, saved.id)
  }

  const seedUserIds = Array.from(userIds.values())
  await prisma.loginRecord.deleteMany({
    where: {
      userId: { in: seedUserIds },
      userAgent: { startsWith: `${SEED_PREFIX}/` }
    }
  })

  for (const [index, user] of allSeedUsers.entries()) {
    const userId = userIds.get(user.username)!
    const firstCountry = countries[index % countries.length]
    const secondCountry = countries[(index + 2) % countries.length]
    await prisma.loginRecord.createMany({
      data: [
        {
          userId,
          ip: `172.19.${10 + (index % 20)}.${20 + (index % 180)}`,
          country: firstCountry.toUpperCase(),
          region: cities[index % cities.length],
          city: cities[index % cities.length],
          isp: 'BulkSeedNet',
          timezone: 'Asia/Shanghai',
          userAgent: `${SEED_PREFIX}/web-chrome`
        },
        {
          userId,
          ip: `172.20.${10 + (index % 20)}.${40 + (index % 180)}`,
          country: secondCountry.toUpperCase(),
          region: cities[(index + 1) % cities.length],
          city: cities[(index + 1) % cities.length],
          isp: 'BulkSeedMobile',
          timezone: 'Asia/Shanghai',
          userAgent: `${SEED_PREFIX}/mobile-safari`
        }
      ]
    })
  }

  return userIds
}

async function syncHosts(userIds: Map<string, number>): Promise<Map<string, number>> {
  const hostIds = new Map<string, number>()

  for (const host of hostSpecs) {
    const userId = userIds.get(host.ownerUsername)
    if (!userId) {
      throw new Error(`Missing owner for host ${host.name}`)
    }

    const saved = await prisma.host.upsert({
      where: {
        userId_name: {
          userId,
          name: host.name
        }
      },
      create: {
        userId,
        name: host.name,
        url: host.url,
        location: host.location,
        countryCode: host.countryCode,
        architecture: host.architecture,
        status: host.status,
        natPublicIp: host.natPublicIp,
        natPublicIpv6: host.natPublicIpv6,
        natBindIp: host.natBindIp,
        natBindIpv6: host.natBindIpv6,
        natPortStart: host.natPortStart,
        natPortEnd: host.natPortEnd,
        tags: host.tags,
        cpuAllowanceMax: host.cpuAllowanceMax,
        memoryMax: host.memoryMax,
        instanceType: host.instanceType,
        ipAddress: host.ipAddress,
        storageDriver: 'zfs',
        storageType: 'loop',
        storageSize: host.storageSize,
        ipv6Mode: 1,
        ipv6Subnet: host.ipv6Subnet,
        ipv6Gateway: host.ipv6Gateway,
        ipv6ParentInterface: 'eth0',
        enableApi: true,
        isInstalled: true,
        caddyEnabled: host.caddyEnabled,
        caddyUsername: host.caddyEnabled ? `${SEED_PREFIX}-caddy` : null,
        caddyPassword: host.caddyEnabled ? `${SEED_PREFIX}-password` : null,
        caddyPort: 8444 + (host.natPortStart % 10),
        transferEnabled: true,
        trafficResetDay: 1 + (host.natPortStart % 20),
        announcement: `${SEED_MARK} ${host.location} demo host`,
        notifyPurchase: true,
        notifyRenew: true,
        notifyDestroy: host.instanceType === 'vm',
        enableResourcePool: true,
        probeUrl: `https://${host.name}.probe.local/health`
      },
      update: {
        url: host.url,
        location: host.location,
        countryCode: host.countryCode,
        architecture: host.architecture,
        status: host.status,
        natPublicIp: host.natPublicIp,
        natPublicIpv6: host.natPublicIpv6,
        natBindIp: host.natBindIp,
        natBindIpv6: host.natBindIpv6,
        natPortStart: host.natPortStart,
        natPortEnd: host.natPortEnd,
        tags: host.tags,
        cpuAllowanceMax: host.cpuAllowanceMax,
        memoryMax: host.memoryMax,
        instanceType: host.instanceType,
        ipAddress: host.ipAddress,
        storageDriver: 'zfs',
        storageType: 'loop',
        storageSize: host.storageSize,
        ipv6Mode: 1,
        ipv6Subnet: host.ipv6Subnet,
        ipv6Gateway: host.ipv6Gateway,
        ipv6ParentInterface: 'eth0',
        enableApi: true,
        isInstalled: true,
        caddyEnabled: host.caddyEnabled,
        caddyUsername: host.caddyEnabled ? `${SEED_PREFIX}-caddy` : null,
        caddyPassword: host.caddyEnabled ? `${SEED_PREFIX}-password` : null,
        transferEnabled: true,
        announcement: `${SEED_MARK} ${host.location} demo host`,
        probeUrl: `https://${host.name}.probe.local/health`
      }
    })

    hostIds.set(host.name, saved.id)

    for (const pool of storagePools) {
      await prisma.storagePool.upsert({
        where: {
          hostId_name: {
            hostId: saved.id,
            name: pool.name
          }
        },
        create: {
          hostId: saved.id,
          name: pool.name,
          driver: pool.driver,
          purpose: pool.purpose,
          description: pool.description,
          config: {
            generatedBy: SEED_PREFIX,
            host: host.name
          }
        },
        update: {
          driver: pool.driver,
          purpose: pool.purpose,
          description: pool.description,
          config: {
            generatedBy: SEED_PREFIX,
            host: host.name
          }
        }
      })
    }
  }

  return hostIds
}

async function syncPackages(
  userIds: Map<string, number>,
  hostIds: Map<string, number>
): Promise<Map<string, GeneratedPackageRecord>> {
  const packageMap = new Map<string, GeneratedPackageRecord>()

  for (const pkg of packageSpecs) {
    const userId = userIds.get(pkg.ownerUsername)
    if (!userId) {
      throw new Error(`Missing package owner ${pkg.ownerUsername}`)
    }

    const saved = await prisma.package.upsert({
      where: {
        userId_name: {
          userId,
          name: pkg.name
        }
      },
      create: {
        userId,
        name: pkg.name,
        description: pkg.description,
        cpuMax: pkg.cpuMax,
        memoryMax: pkg.memoryMax,
        diskMax: pkg.diskMax,
        bandwidthMax: pkg.bandwidthMax,
        networkMode: pkg.networkMode,
        instanceType: pkg.instanceType,
        privileged: pkg.privileged,
        nested: pkg.nested,
        active: pkg.active,
        portLimit: pkg.portLimit,
        snapshotLimit: pkg.snapshotLimit,
        backupLimit: pkg.backupLimit,
        siteLimit: pkg.siteLimit,
        monthlyTrafficLimit: pkg.monthlyTrafficLimit,
        ioLimitMode: pkg.ioLimitMode,
        limitsRead: pkg.limitsRead,
        limitsWrite: pkg.limitsWrite,
        limitsReadIops: pkg.limitsReadIops,
        limitsWriteIops: pkg.limitsWriteIops,
        limitsIngress: pkg.limitsIngress,
        limitsEgress: pkg.limitsEgress,
        limitsProcesses: pkg.limitsProcesses,
        limitsCpuPriority: pkg.limitsCpuPriority,
        bootAutostart: pkg.bootAutostart,
        bootAutostartPriority: pkg.bootAutostartPriority,
        bootAutostartDelay: pkg.bootAutostartDelay,
        bootHostShutdownTimeout: pkg.bootHostShutdownTimeout,
        globalShared: pkg.globalShared,
        globalQuotaMultiplier: pkg.globalQuotaMultiplier,
        globalMaxInstances: pkg.globalMaxInstances,
        allowInstanceDeletion: pkg.allowInstanceDeletion
      },
      update: {
        description: pkg.description,
        cpuMax: pkg.cpuMax,
        memoryMax: pkg.memoryMax,
        diskMax: pkg.diskMax,
        bandwidthMax: pkg.bandwidthMax,
        networkMode: pkg.networkMode,
        instanceType: pkg.instanceType,
        privileged: pkg.privileged,
        nested: pkg.nested,
        active: pkg.active,
        portLimit: pkg.portLimit,
        snapshotLimit: pkg.snapshotLimit,
        backupLimit: pkg.backupLimit,
        siteLimit: pkg.siteLimit,
        monthlyTrafficLimit: pkg.monthlyTrafficLimit,
        ioLimitMode: pkg.ioLimitMode,
        limitsRead: pkg.limitsRead,
        limitsWrite: pkg.limitsWrite,
        limitsReadIops: pkg.limitsReadIops,
        limitsWriteIops: pkg.limitsWriteIops,
        limitsIngress: pkg.limitsIngress,
        limitsEgress: pkg.limitsEgress,
        limitsProcesses: pkg.limitsProcesses,
        limitsCpuPriority: pkg.limitsCpuPriority,
        bootAutostart: pkg.bootAutostart,
        bootAutostartPriority: pkg.bootAutostartPriority,
        bootAutostartDelay: pkg.bootAutostartDelay,
        bootHostShutdownTimeout: pkg.bootHostShutdownTimeout,
        globalShared: pkg.globalShared,
        globalQuotaMultiplier: pkg.globalQuotaMultiplier,
        globalMaxInstances: pkg.globalMaxInstances,
        allowInstanceDeletion: pkg.allowInstanceDeletion
      }
    })

    await prisma.packageHost.deleteMany({ where: { packageId: saved.id } })
    await prisma.packageHost.createMany({
      data: pkg.hostNames.map(hostName => {
        const hostId = hostIds.get(hostName)
        if (!hostId) {
          throw new Error(`Missing host ${hostName} for package ${pkg.name}`)
        }
        return {
          packageId: saved.id,
          hostId,
          storagePoolName: 'default'
        }
      })
    })

    for (const plan of pkg.plans) {
      await prisma.packagePlan.upsert({
        where: {
          packageId_name: {
            packageId: saved.id,
            name: plan.name
          }
        },
        create: {
          packageId: saved.id,
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
        },
        update: {
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
        }
      })
    }

    const savedPlans = await prisma.packagePlan.findMany({
      where: { packageId: saved.id },
      orderBy: { sortOrder: 'asc' }
    })

    packageMap.set(pkg.key, {
      id: saved.id,
      spec: pkg,
      planIdsByName: new Map(savedPlans.map(plan => [plan.name, plan.id]))
    })
  }

  return packageMap
}

async function syncInstances(
  userIds: Map<string, number>,
  hostIds: Map<string, number>,
  packagesByKey: Map<string, GeneratedPackageRecord>
): Promise<GeneratedInstanceRecord[]> {
  const records: GeneratedInstanceRecord[] = []

  for (const [index, instance] of instanceSpecs.entries()) {
    const userId = userIds.get(instance.userUsername)
    const pkg = packagesByKey.get(instance.packageKey)
    const hostId = hostIds.get(instance.hostName)
    const hostSpec = hostSpecs.find(candidate => candidate.name === instance.hostName)
    if (!userId || !pkg || !hostId || !hostSpec) {
      throw new Error(`Missing relation while seeding instance ${instance.name}`)
    }

    const planId = pkg.planIdsByName.get(instance.planName)
    const plan = pkg.spec.plans.find(candidate => candidate.name === instance.planName)
    if (!planId || !plan) {
      throw new Error(`Missing plan ${instance.planName} for ${instance.name}`)
    }

    const existing = await prisma.instance.findFirst({
      where: {
        userId,
        name: instance.name
      }
    })

    const saved = existing
      ? await prisma.instance.update({
          where: { id: existing.id },
          data: buildInstanceData(instance, userId, hostId, hostSpec, pkg.id, planId, pkg.spec, plan, index)
        })
      : await prisma.instance.create({
          data: buildInstanceData(instance, userId, hostId, hostSpec, pkg.id, planId, pkg.spec, plan, index)
        })

    await syncInstanceChildren(saved.id, userId, hostId, hostSpec, instance, pkg.spec, plan, index)

    records.push({
      id: saved.id,
      userId,
      hostId,
      packageId: pkg.id,
      packagePlanId: planId,
      spec: instance,
      packageSpec: pkg.spec,
      plan
    })
  }

  return records
}

function buildInstanceData(
  spec: SeedInstanceSpec,
  userId: number,
  hostId: number,
  hostSpec: SeedHostSpec,
  packageId: number,
  packagePlanId: number,
  pkg: SeedPackageSpec,
  plan: SeedPlanSpec,
  index: number
) {
  return {
    incusId: spec.incusId,
    name: spec.name,
    userId,
    hostId,
    packageId,
    packagePlanId,
    storagePoolName: 'default',
    image: spec.image,
    status: spec.status,
    cpu: plan.cpu,
    memory: plan.memory,
    disk: plan.disk,
    ipv4: spec.ipv4,
    ipv6: spec.ipv6,
    networkMode: pkg.networkMode,
    sshPort: pkg.networkMode === 'ipv6_only' ? 22 : hostSpec.natPortStart + 20 + index * 4,
    rootPassword: `${SHARED_PASSWORD}!${pad(index + 1, 3)}`,
    snapshottedSpecs: {
      generatedBy: SEED_PREFIX,
      packageKey: pkg.key,
      planName: plan.name,
      cpu: plan.cpu,
      memory: plan.memory,
      disk: plan.disk
    },
    portLimit: plan.portLimit,
    snapshotLimit: plan.snapshotLimit,
    backupLimit: plan.backupLimit,
    siteLimit: plan.siteLimit,
    swapEnabled: plan.swapSize > 0,
    swapSize: plan.swapSize,
    monthlyTrafficLimit: plan.trafficLimit,
    monthlyTrafficUsed: spec.monthlyTrafficUsed,
    trafficStatus: spec.trafficStatus,
    limitsRead: pkg.limitsRead,
    limitsWrite: pkg.limitsWrite,
    limitsReadIops: pkg.limitsReadIops,
    limitsWriteIops: pkg.limitsWriteIops,
    limitsIngress: pkg.limitsIngress,
    limitsEgress: pkg.limitsEgress,
    limitsProcesses: pkg.limitsProcesses,
    limitsCpuPriority: pkg.limitsCpuPriority,
    bootAutostart: pkg.bootAutostart,
    bootAutostartPriority: pkg.bootAutostartPriority,
    bootAutostartDelay: pkg.bootAutostartDelay,
    bootHostShutdownTimeout: pkg.bootHostShutdownTimeout,
    expiresAt: spec.expiresAt,
    suspendedAt: spec.suspendedAt,
    suspendedBy: spec.suspendedBy,
    suspendReason: spec.suspendReason,
    billingPrice: plan.price,
    billingCycle: plan.billingCycle,
    autoRenew: spec.autoRenew,
    iconBadgeId: index % 9 === 0 ? 'fire' : null,
    autoRenewAttempts: spec.autoRenew ? index % 3 : 0,
    lastAutoRenewAttemptAt: spec.autoRenew ? daysAgo(index % 5, 16) : null,
    expiryNotifiedAt: spec.status === 'suspended' ? daysAgo(1, 17) : null,
    version: index % 5,
    lastIpv6ReassignAt: spec.lastIpv6ReassignAt,
    lastPlanChangeAt: spec.lastPlanChangeAt,
    cloudInitState: spec.cloudInitState,
    cloudInitSource: spec.cloudInitSource,
    cloudInitLastCheckedAt: spec.lastSyncedAt,
    cloudInitCompletedAt: spec.status === 'error' ? null : addMonths(spec.createdAt, 0),
    cloudInitManualCompletedAt: spec.status === 'error' ? null : null,
    cloudInitManualCompletedBy: null,
    createdAt: spec.createdAt,
    lastSyncedAt: spec.lastSyncedAt
  }
}

async function syncInstanceChildren(
  instanceId: number,
  userId: number,
  hostId: number,
  hostSpec: SeedHostSpec,
  spec: SeedInstanceSpec,
  pkg: SeedPackageSpec,
  plan: SeedPlanSpec,
  index: number
): Promise<void> {
  await prisma.portMapping.deleteMany({ where: { instanceId } })
  await prisma.snapshot.deleteMany({ where: { instanceId } })
  await prisma.backup.deleteMany({ where: { instanceId } })
  await prisma.proxySite.deleteMany({ where: { instanceId } })
  await prisma.ipAddress.deleteMany({ where: { instanceId } })
  await prisma.ipv6Subnet.deleteMany({ where: { instanceId } })
  await prisma.dailyTraffic.deleteMany({ where: { instanceId } })
  await prisma.instanceBillingRecord.deleteMany({ where: { instanceId } })

  const publicBase = hostSpec.natPortStart + 20 + index * 4
  const supportsPortMappings = pkg.networkMode !== 'ipv6_only' && plan.portLimit > 0
  if (supportsPortMappings) {
    const portSet = pickPortSet(index, pkg.instanceType)
    const mappings = portSet.map((privatePort, mappingIndex) => ({
      instanceId,
      hostId,
      protocol: pickProtocol(index, mappingIndex),
      publicPort: publicBase + mappingIndex,
      privatePort,
      remark: `${SEED_MARK} ${mappingIndex === 0 ? 'ssh-or-app' : 'service'}`
    }))
    await prisma.portMapping.createMany({ data: mappings })
  }

  const snapshotsToCreate = index % 3 === 0 ? 2 : index % 2 === 0 ? 1 : 0
  if (snapshotsToCreate > 0) {
    await prisma.snapshot.createMany({
      data: Array.from({ length: snapshotsToCreate }, (_, snapshotIndex) => ({
        instanceId,
        incusName: `${spec.name}/snap-${snapshotIndex + 1}`,
        name: `${SEED_PREFIX}-snap-${snapshotIndex + 1}`,
        description: `${SEED_MARK} snapshot ${snapshotIndex + 1}`,
        stateful: pkg.instanceType === 'vm' && snapshotIndex === 0,
        size: 1024 + snapshotIndex * 512
      }))
    })
  }

  const backupsToCreate = index % 4 === 0 ? 2 : index % 3 === 0 ? 1 : 0
  if (backupsToCreate > 0) {
    await prisma.backup.createMany({
      data: Array.from({ length: backupsToCreate }, (_, backupIndex) => ({
        instanceId,
        incusName: `${spec.name}/backup-${backupIndex + 1}`,
        name: `${SEED_PREFIX}-backup-${backupIndex + 1}`,
        description: `${SEED_MARK} backup ${backupIndex + 1}`,
        size: 2048 + backupIndex * 768,
        status: backupIndex === backupsToCreate - 1 && index % 8 === 0 ? 'error' : ('ready' as SeedBackupStatus),
        expiresAt: daysFromNow(14 + backupIndex * 7, 6)
      }))
    })
  }

  if (index % 4 === 0) {
    await prisma.backupPolicy.upsert({
      where: { instanceId },
      create: {
        instanceId,
        enabled: true,
        intervalMinutes: 720,
        lastRunAt: daysAgo(1, 2),
        nextRunAt: daysFromNow(1, 2)
      },
      update: {
        enabled: true,
        intervalMinutes: 720,
        lastRunAt: daysAgo(1, 2),
        nextRunAt: daysFromNow(1, 2)
      }
    })
  } else {
    await prisma.backupPolicy.deleteMany({ where: { instanceId } })
  }

  if (index % 3 === 0) {
    await prisma.snapshotPolicy.upsert({
      where: { instanceId },
      create: {
        instanceId,
        enabled: true,
        intervalMinutes: 360,
        lastRunAt: daysAgo(1, 4),
        nextRunAt: daysFromNow(1, 4)
      },
      update: {
        enabled: true,
        intervalMinutes: 360,
        lastRunAt: daysAgo(1, 4),
        nextRunAt: daysFromNow(1, 4)
      }
    })
  } else {
    await prisma.snapshotPolicy.deleteMany({ where: { instanceId } })
  }

  await prisma.trafficSnapshot.upsert({
    where: { instanceId },
    create: {
      instanceId,
      rxRaw: 100_000_000n + BigInt(index) * 10_000n,
      txRaw: 80_000_000n + BigInt(index) * 9_000n
    },
    update: {
      rxRaw: 100_000_000n + BigInt(index) * 10_000n,
      txRaw: 80_000_000n + BigInt(index) * 9_000n
    }
  })

  await prisma.dailyTraffic.createMany({
    data: Array.from({ length: 7 }, (_, dayOffset) => ({
      instanceId,
      date: daysAgo(6 - dayOffset, 0),
      rxTotal: 2_000_000_000n + BigInt(index + dayOffset) * 30_000_000n,
      txTotal: 1_200_000_000n + BigInt(index + dayOffset) * 20_000_000n
    }))
  })

  const shouldAddIpv6 = pkg.networkMode === 'nat_ipv6' || pkg.networkMode === 'ipv6_only'
  if (shouldAddIpv6 && spec.ipv6) {
    await prisma.ipAddress.createMany({
      data: [
        {
          instanceId,
          address: spec.ipv6,
          type: 'inet6',
          isPrimary: true,
          isCustom: false,
          device: 'eth1'
        },
        ...(index % 5 === 0
          ? [
              {
                instanceId,
                address: `${spec.ipv6.split('::')[0]}::${400 + index}`,
                type: 'inet6',
                isPrimary: false,
                isCustom: true,
                device: 'eth1'
              }
            ]
          : [])
      ]
    })
  }

  if (shouldAddIpv6 && spec.ipv6 && index % 6 === 0) {
    await prisma.ipv6Subnet.create({
      data: {
        instanceId,
        cidr: `${spec.ipv6.split('::')[0]}:100::/120`,
        primaryIp: `${spec.ipv6.split('::')[0]}:100::1`,
        device: 'eth1'
      }
    })
  }

  const proxyCount = pkg.instanceType === 'container' && plan.siteLimit > 0 && index % 3 !== 0 ? (index % 5 === 0 ? 2 : 1) : 0
  if (proxyCount > 0) {
    await prisma.proxySite.createMany({
      data: Array.from({ length: proxyCount }, (_, siteIndex) => ({
        instanceId,
        hostId,
        domain: `${spec.name}-${siteIndex + 1}.${SEED_PREFIX}.test`,
        targetPort: [80, 443, 8080][siteIndex % 3],
        httpsEnabled: siteIndex % 2 === 0,
        remark: `${SEED_MARK} proxy ${siteIndex + 1}`,
        status: pickProxyStatus(index, siteIndex),
        enabled: siteIndex % 4 !== 0,
        error: index % 9 === 0 && siteIndex === 0 ? `${SEED_MARK} DNS pending` : null
      }))
    })
  }

  await prisma.instanceBillingRecord.create({
    data: {
      instanceId,
      userId,
      type: 'newPurchase',
      amount: plan.price,
      months: plan.billingCycle,
      periodStart: spec.createdAt,
      periodEnd: addMonths(spec.createdAt, plan.billingCycle),
      remark: `${SEED_MARK} initial purchase`
    }
  })

  if (index % 6 === 0) {
    const renewedStart = addMonths(spec.createdAt, plan.billingCycle)
    await prisma.instanceBillingRecord.create({
      data: {
        instanceId,
        userId,
        type: 'renew',
        amount: plan.price,
        months: plan.billingCycle,
        periodStart: renewedStart,
        periodEnd: addMonths(renewedStart, plan.billingCycle),
        remark: `${SEED_MARK} renewal sample`
      }
    })
  }
}

function pickPortSet(index: number, instanceType: SeedPackageInstanceType): number[] {
  if (instanceType === 'vm') {
    return index % 2 === 0 ? [22, 3389] : [22, 8443]
  }
  const sets = [
    [22, 80],
    [22, 443],
    [25565, 19132],
    [8080, 8443]
  ]
  return sets[index % sets.length]
}

function pickProtocol(index: number, mappingIndex: number): SeedProtocol {
  if (mappingIndex === 1 && index % 4 === 2) return 'udp'
  return 'tcp'
}

function pickProxyStatus(index: number, siteIndex: number): SeedProxyStatus {
  if (index % 9 === 0 && siteIndex === 0) return 'error'
  if (index % 4 === 0) return 'pending'
  return 'active'
}

async function syncTickets(instances: GeneratedInstanceRecord[]): Promise<void> {
  await prisma.ticket.deleteMany({
    where: {
      subject: { startsWith: SEED_MARK }
    }
  })

  const selected = instances.filter((_, index) => index % 5 === 0).slice(0, 12)
  for (const [index, instance] of selected.entries()) {
    const hostOwner = await prisma.host.findUniqueOrThrow({
      where: { id: instance.hostId },
      select: { userId: true }
    })
    const status = (['open', 'in_progress', 'resolved', 'closed'] as SeedTicketStatus[])[index % 4]
    const createdAt = daysAgo(2 + index, 9)
    await prisma.ticket.create({
      data: {
        userId: instance.userId,
        hostId: instance.hostId,
        instanceId: instance.id,
        subject: `${SEED_MARK} ticket-${pad(index + 1, 2)} for ${instance.spec.name}`,
        category: ['general', 'billing', 'technical', 'abuse'][index % 4],
        priority: (['low', 'normal', 'high', 'urgent'] as SeedTicketPriority[])[index % 4],
        status,
        createdAt,
        resolvedAt: status === 'resolved' || status === 'closed' ? daysAgo(1 + index, 12) : null,
        closedAt: status === 'closed' ? daysAgo(index, 15) : null,
        messages: {
          create: [
            {
              senderId: instance.userId,
              content: `${SEED_MARK} user asks about ${instance.spec.name}`,
              isFromOwner: false,
              createdAt
            },
            {
              senderId: hostOwner.userId,
              content: `${SEED_MARK} host owner replied for ${instance.spec.name}`,
              isFromOwner: true,
              createdAt: new Date(createdAt.getTime() + 60 * 60 * 1000)
            },
            ...(index % 3 === 0
              ? [
                  {
                    senderId: instance.userId,
                    content: `${SEED_MARK} follow-up confirmation`,
                    isFromOwner: false,
                    createdAt: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000)
                  }
                ]
              : [])
          ]
        }
      }
    })
  }
}

async function syncBalances(
  userIds: Map<string, number>,
  instances: GeneratedInstanceRecord[]
): Promise<void> {
  const seedUserIds = Array.from(userIds.values())
  await prisma.balanceLog.deleteMany({
    where: {
      userId: { in: seedUserIds },
      remark: { startsWith: SEED_MARK }
    }
  })

  const spendByUser = new Map<number, number>()
  for (const instance of instances) {
    spendByUser.set(instance.userId, (spendByUser.get(instance.userId) || 0) + instance.plan.price)
  }

  const logs: SeedBalanceLogSpec[] = []

  for (const [index, user] of allSeedUsers.entries()) {
    const userId = userIds.get(user.username)!
    const spend = spendByUser.get(userId) || 0
    const baseRecharge = getBaseRechargeAmount(user, index, spend)
    const giftAmount = getGiftAmount(user, index)
    let balanceBefore = 0

    logs.push({
      userId,
      type: user.role === 'admin' ? 'admin_adjust' : 'recharge',
      amount: baseRecharge,
      balanceBefore,
      balanceAfter: balanceBefore + baseRecharge,
      orderId: user.role === 'admin' ? null : getSeedOrderNo(index),
      remark: `${SEED_MARK} initial funding`
    })
    balanceBefore += baseRecharge

    logs.push({
      userId,
      type: 'gift',
      amount: giftAmount,
      balanceBefore,
      balanceAfter: balanceBefore + giftAmount,
      orderId: null,
      remark: `${SEED_MARK} promo gift`
    })
    balanceBefore += giftAmount

    if (spend > 0) {
      logs.push({
        userId,
        type: 'consume',
        amount: -spend,
        balanceBefore,
        balanceAfter: balanceBefore - spend,
        orderId: null,
        remark: `${SEED_MARK} instance purchases`
      })
      balanceBefore -= spend
    }

    await prisma.user.update({
      where: { id: userId },
      data: { balance: balanceBefore }
    })
  }

  await prisma.balanceLog.createMany({ data: logs })
}

async function refreshHostAndQuotaUsage(
  userIds: Map<string, number>,
  hostIds: Map<string, number>,
  instances: GeneratedInstanceRecord[]
): Promise<void> {
  const hostStats = new Map<number, { cpu: number; memory: number; disk: number; ports: number }>()
  for (const hostId of hostIds.values()) {
    hostStats.set(hostId, { cpu: 0, memory: 0, disk: 0, ports: 0 })
  }

  for (const instance of instances) {
    const stats = hostStats.get(instance.hostId)
    if (!stats) continue
    stats.cpu += instance.plan.cpu
    stats.memory += instance.plan.memory
    stats.disk += instance.plan.disk
  }

  const portCounts = await prisma.portMapping.groupBy({
    by: ['hostId'],
    where: {
      hostId: { in: Array.from(hostIds.values()) }
    },
    _count: {
      _all: true
    }
  })

  for (const row of portCounts) {
    const stats = hostStats.get(row.hostId)
    if (stats) {
      stats.ports = row._count._all
    }
  }

  for (const [hostName, hostId] of hostIds.entries()) {
    const stats = hostStats.get(hostId)!
    await prisma.host.update({
      where: { id: hostId },
      data: {
        cpuUsed: stats.cpu,
        memoryUsed: stats.memory,
        diskUsed: stats.disk,
        natPortsUsedCount: stats.ports
      }
    })
  }

  const hostCountByOwner = new Map<number, number>()
  const packageCountByOwner = new Map<number, number>()
  ownerUsers.forEach(owner => {
    const ownerId = userIds.get(owner.username)!
    hostCountByOwner.set(ownerId, hostSpecs.filter(host => host.ownerUsername === owner.username).length)
    packageCountByOwner.set(ownerId, packageSpecs.filter(pkg => pkg.ownerUsername === owner.username).length)
  })

  for (const user of allSeedUsers) {
    const userId = userIds.get(user.username)!
    await prisma.userQuota.update({
      where: { userId },
      data: {
        hostUsed: hostCountByOwner.get(userId) || 0,
        packageUsed: packageCountByOwner.get(userId) || 0
      }
    })
  }
}

async function printSummary(): Promise<void> {
  const [users, hosts, packages, plans, instances, ports, snapshots, backups, sites, tickets] = await Promise.all([
    prisma.user.count({ where: { username: { startsWith: SEED_PREFIX } } }),
    prisma.host.count({ where: { name: { startsWith: `${SEED_PREFIX}-host-` } } }),
    prisma.package.count({ where: { name: { startsWith: `${SEED_PREFIX}-pkg-` } } }),
    prisma.packagePlan.count({ where: { package: { name: { startsWith: `${SEED_PREFIX}-pkg-` } } } }),
    prisma.instance.count({ where: { name: { startsWith: `${SEED_PREFIX}-inst-` } } }),
    prisma.portMapping.count({ where: { instance: { name: { startsWith: `${SEED_PREFIX}-inst-` } } } }),
    prisma.snapshot.count({ where: { instance: { name: { startsWith: `${SEED_PREFIX}-inst-` } } } }),
    prisma.backup.count({ where: { instance: { name: { startsWith: `${SEED_PREFIX}-inst-` } } } }),
    prisma.proxySite.count({ where: { instance: { name: { startsWith: `${SEED_PREFIX}-inst-` } } } }),
    prisma.ticket.count({ where: { subject: { startsWith: SEED_MARK } } })
  ])

  console.log(`${SEED_MARK} completed`)
  console.log(`${SEED_MARK} users=${users}, hosts=${hosts}, packages=${packages}, plans=${plans}, instances=${instances}`)
  console.log(`${SEED_MARK} portMappings=${ports}, snapshots=${snapshots}, backups=${backups}, proxySites=${sites}, tickets=${tickets}`)
  console.log(`${SEED_MARK} shared password for generated users: ${SHARED_PASSWORD}`)
}

async function main(): Promise<void> {
  await ensureLocalDevGuard()
  const passwordHash = await buildPasswordHash(SHARED_PASSWORD)
  const userIds = await syncUsers(passwordHash)
  const hostIds = await syncHosts(userIds)
  const packagesByKey = await syncPackages(userIds, hostIds)
  const instances = await syncInstances(userIds, hostIds, packagesByKey)
  await syncTickets(instances)
  await syncBalances(userIds, instances)
  await refreshHostAndQuotaUsage(userIds, hostIds, instances)
  await printSummary()
}

void main()
  .catch(error => {
    console.error(`${SEED_MARK} failed:`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePrismaDatabase()
  })
