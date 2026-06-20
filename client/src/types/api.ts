/**
 * API 请求/响应类型定义
 */

export interface VipBadgeStyle {
  backgroundColor: string
  textColor: string
}

// ==================== 认证相关 ====================

export interface LoginRequest {
  username: string
  password: string
  turnstileToken?: string
}

export interface LoginResponse {
  token: string
  user: {
    id: number
    username: string
    email: string
    role: 'admin' | 'user'
    avatarStyle?: string
    avatarBadgeId?: string | null
    hasCreatedHostBefore?: boolean
    canAccessHostingFeature?: boolean
  }
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  inviteCode?: string
  turnstileToken?: string
  emailCode?: string
}

export interface RegisterResponse {
  token: string
  user: {
    id: number
    username: string
    email: string
    role: 'admin' | 'user'
    avatarStyle?: string
    avatarBadgeId?: string | null
    hasCreatedHostBefore?: boolean
    canAccessHostingFeature?: boolean
  }
}

export interface UpdateUserResponse {
  message: string
  reauthRequired?: boolean
}

export interface GenerateInviteRequest {
  expiresAt?: string
  count?: number
}

export interface InviteCode {
  id: number
  code: string
  created_by: number
  createdByUsername?: string | null
  createdByEmail?: string | null
  createdByAvatarStyle?: string | null
  createdByAvatarBadgeId?: string | null
  used_by: number | null
  usedBy?: number | null
  usedByUsername?: string | null
  usedByEmail?: string | null
  usedByAvatarStyle?: string | null
  usedByAvatarBadgeId?: string | null
  used_at: string | null
  usedAt?: string | null
  expires_at: string | null
  expiresAt?: string | null
  costSnapshot?: InviteGenerationCostSnapshot | null
  cost_snapshot?: InviteGenerationCostSnapshot | null
  created_at: string
  createdAt?: string
}

export interface InviteListResponse {
  invites: InviteCode[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface InviteCostOption {
  resource: string
  amount: number
  enabled: boolean
  label: string
  unit: string
  displayAmount: string
}

export interface InviteGenerationCostSnapshot {
  resource: string
  amount: number
  label: string
  unit: string
  displayAmount: string
  chargedAt: string
}

export interface UserInvite {
  id: number
  code: string
  createdBy: number
  usedBy: number | null
  usedAt: string | null
  expiresAt: string | null
  createdAt: string
  costSnapshot: InviteGenerationCostSnapshot | null
  registerUrl: string
  usedByUser: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    createdAt: string
  } | null
}

export interface UserInviteSummary {
  costOptions: InviteCostOption[]
  balances: {
    balance: number
    points: number
  }
  stats: {
    total: number
    used: number
    unused: number
    usageRate: number
  }
}

// ==================== 用户相关 ====================

export interface User {
  id: number
  username: string
  email: string | null
  role: 'admin' | 'user'
  status: 'active' | 'banned'
  avatarStyle?: string
  avatarBadgeId?: string | null
  hasCreatedHostBefore?: boolean
  canAccessHostingFeature?: boolean
  twoFAEnabled?: boolean
  instanceCount?: number
  hasGithubBinding?: boolean
  balance?: number
  quota?: UserQuota
  created_at: string
  updated_at: string
  createdAt?: string
}

export interface UserQuota {
  id?: number
  userId?: number
  // 新配额系统：控制用户可拥有的资源数量
  // 配额为 0 表示功能未授权，需要管理员开启
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  hostLimit: number
  hostUsed: number
  friendLimit: number
  friendUsed: number
  packageLimit: number
  packageUsed: number
}

export interface UpdateUserRequest {
  email?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'banned'
  avatarStyle?: string
  password?: string
  currentPassword?: string  // 修改密码时需要提供当前密码
  emailCode?: string
}

export interface TelegramBindingStatus {
  enabled: boolean
  configured: boolean
  botUsername: string | null
  binding: {
    telegramUserId: string
    telegramUsername: string | null
    firstName: string | null
    lastName: string | null
    boundAt: string
  } | null
}

export interface TelegramBindTokenResponse {
  bindUrl: string
  expiresAt: string
}

export interface TelegramWebhookInfo {
  url: string
  has_custom_certificate?: boolean
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  max_connections?: number
  allowed_updates?: string[]
}

export interface TelegramWebhookInfoResponse {
  info: TelegramWebhookInfo
}

export interface TelegramWebhookSetupResponse {
  message: string
  webhookUrl: string
  commandsSynced?: boolean
  commands?: Array<{
    command: string
    description: string
  }>
  result?: boolean
}

export interface TelegramWebhookDeleteResponse {
  message: string
  result?: boolean
}

export interface TelegramGroupEligibility {
  eligible: boolean
  status: 'eligible' | 'ineligible' | 'disabled' | 'unconfigured'
  message: string
  joinMode: 'any' | 'all'
  minRecharge: number
  minConsume: number
}

export interface TelegramAdminBinding {
  id: number
  userId: number
  user: {
    id: number
    username: string
    email: string | null
    status: string
  } | null
  telegramUserId: string
  telegramUsername: string | null
  firstName: string | null
  lastName: string | null
  boundAt: string
  updatedAt: string
  stats: {
    totalRecharge: number
    totalConsume: number
    totalRefund: number
    totalDestroyedValue: number
  }
  eligibility: TelegramGroupEligibility
  vipEligibility: TelegramGroupEligibility
}

export interface TelegramAdminBindingsResponse {
  bindings: TelegramAdminBinding[]
  total: number
  page: number
  pageSize: number
  group: {
    enabled: boolean
    configured: boolean
    joinMode: 'any' | 'all'
    minRecharge: number
    minConsume: number
  }
  vipGroup: {
    enabled: boolean
    configured: boolean
    joinMode: 'any' | 'all'
    minRecharge: number
    minConsume: number
  }
}

export interface BadgeCatalogItem {
  id: string
  name: string
  nameEn: string | null
  fullLabel: string
  sourceId?: string
  sourceLabel?: string
  seriesId: string
  seriesTitle: string
  seriesNameZh?: string
  seriesNameEn?: string | null
  seriesDescription: string
  assetUrl: string
  assetUrlDark?: string
  assetUrlLight?: string
  displayOrder?: number
  isActive?: boolean
  seriesIsActive?: boolean
  createdAt?: string
  updatedAt?: string
  ownershipCount?: number
  avatarUseCount?: number
  instanceUseCount?: number
}

export interface BadgeSeriesItem {
  id: string
  title: string
  nameZh: string
  nameEn: string | null
  description: string
  sourceId?: string | null
  sourceLabel?: string | null
  displayOrder: number
  isActive: boolean
  badgeCount?: number
  activeBadgeCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface BadgeOwnership {
  id: number
  badgeId: string
  badgeName: string
  badgeNameEn: string | null
  badgeLabel: string
  seriesId: string
  seriesTitle: string
  assetUrl: string
  assetUrlDark?: string | null
  assetUrlLight?: string | null
  source: 'draw' | 'lottery' | 'select' | 'admin_grant'
  applicationTarget: 'avatar' | 'instance' | null
  appliedInstanceId: number | null
  appliedInstanceName: string | null
  appliedAt: string | null
  createdAt: string
}

export interface BadgeOverview {
  costs: {
    randomDraw: number
    select: number
  }
  currentPoints: number
  avatarBadgeId: string | null
  catalog: BadgeCatalogItem[]
  ownerships: BadgeOwnership[]
  instances: Array<{
    id: number
    name: string
    status: string
    iconBadgeId: string | null
    packagePlanId: number | null
    instanceType: 'container' | 'vm'
    host: {
      id: number
      name: string
      location: string | null
      countryCode: string
    }
  }>
}

export interface BadgeMultiDrawResponse {
  success: boolean
  currentPoints: number
  ownerships: BadgeOwnership[]
}

// ==================== 实例相关 ====================

export interface Instance {
  id: number
  incus_id: string
  name: string
  user_id?: number  // Only for admin
  host_id?: number  // Only for admin
  package_id: number | null
  displayOrder?: number
  display_order?: number
  image: string
  imageName?: string | null  // 镜像显示名称
  status: 'creating' | 'running' | 'stopped' | 'suspended' | 'error' | 'deleted'
  cpu: number
  memory: number
  disk: number
  ipv4: string | null
  ipv6: string | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'  // camelCase 别名
  ssh_port: number | null
  root_password?: string | null  // Removed from API responses for security
  port_limit: number | null
  snapshot_limit: number | null
  backup_limit: number | null
  site_limit: number | null
  remaining_quota?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  quota_usage?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  effective_quota_limit?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  swapEnabled?: boolean
  swapSize?: number | null
  monthlyTrafficLimit?: string | null  // BigInt as string (Bytes)
  limitsIngress?: string | null  // 入栈带宽限制
  limitsEgress?: string | null  // 出栈带宽限制
  planId?: number | null  // 方案ID（用于变更方案）
  packagePlanId?: number | null  // 付费方案ID（列表接口返回，用于判断是否付费实例）
  planName?: string | null
  planPrice?: number | null
  billingPrice?: number | null
  billingCycle?: number | null
  affDiscountRate?: number | null
  hasAffBinding?: boolean
  isHostedInstance?: boolean
  instanceType?: 'container' | 'vm'  // 实例类型：容器或虚拟机
  iconBadgeId?: string | null
  allow_instance_deletion?: boolean  // 是否允许删除实例（来自套餐设置）
  // 实例列表返回的宿主机信息
  host?: {
    name: string
    country_code: string
    nat_public_ip?: string | null
    storageDriver?: string
  }
  hostCountryCode?: string
  natPublicIp?: string | null
  hostNatPublicIpv6?: string | null
  hostIpv6Gateway?: string | null
  hostIpAddress?: string | null
  userAvatarBadgeId?: string | null
  // 封停相关字段
  expires_at?: string | null        // 到期时间，null 表示免费实例
  suspended_at?: string | null      // 封停时间
  suspended_by?: number | null      // 封停操作者 ID
  suspend_reason?: string | null    // 封停原因
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
    vipBadgeStyle?: VipBadgeStyle | null
  } | null
  created_at: string
  createdAt?: string  // camelCase 别名
  updated_at: string
}

export interface InstanceWithDetails extends Omit<Instance, 'host'> {
  user?: Pick<User, 'id' | 'username' | 'email'>
  // 实例详情页面的宿主机信息（比列表更详细）
  host?: {
    id?: number
    name: string
    location?: string | null
    country_code: string
    nat_public_ip?: string | null
    storageDriver?: string
  }
  package?: Pick<Package, 'id' | 'name'>
  port_mappings?: PortMapping[]
  nat_public_ip?: string
  isHostOwner?: boolean  // True if current user owns the host
  isInstanceOwner?: boolean  // True if current user owns the instance
  isAdmin?: boolean  // True if current user is an admin
  enableResourcePool?: boolean  // 节点是否启用资源池玩法
}

export interface CreateInstanceRequest {
  name: string
  packageId: number
  planId?: number  // 付费方案ID（付费套餐必填）
  image: string
  cpu: number
  memory: number
  disk: number
  hostId: number
  sshKeyId: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  customInitCommandIds?: number[]  // 用户自定义初始化命令 ID 列表
}

export interface UpdateInstanceRequest {
  name?: string
  cpu?: number
  memory?: number
  disk?: number
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number | null  // 0 = 不限制, null = 继承套餐
}

export interface InstanceStats {
  cpu: {
    usage: number
    usagePercent: number
  }
  memory: {
    usage: number
    usagePercent: number
    limit: number
  }
  disk: {
    usage: number
    usagePercent: number
    limit: number
  }
  network: {
    bytesReceived: number
    bytesSent: number
  }
}

export interface PortMapping {
  id: number
  instance_id?: number
  host_id?: number
  protocol: 'tcp' | 'udp'
  publicPort: number
  privatePort: number
  public_port?: number  // 兼容旧格式
  private_port?: number  // 兼容旧格式
  remark?: string | null
  device_name?: string
  created_at?: string
}

export interface CreatePortMappingRequest {
  protocol: 'tcp' | 'udp'
  privatePort: number
  remark?: string
  deviceName?: string
}

// ==================== IP 地址 ====================

export interface IpAddress {
  id: number
  address: string
  type: 'inet4' | 'inet6'
  isPrimary: boolean
  isCustom?: boolean
  device: string
  createdAt: string
}

export interface Ipv6Subnet {
  id: number
  cidr: string
  primaryIp: string
  device: string
  instanceId: number
  createdAt: string
}

// ==================== 快照/备份 ====================

export interface Snapshot {
  id: number
  instance_id: number
  incus_name: string
  name: string
  description: string | null
  stateful: number
  size: number
  created_at: string
}

export interface Backup {
  id: number
  instance_id: number
  incus_name: string
  name: string
  description: string | null
  size: number
  status: 'creating' | 'ready' | 'error' | 'deleted'
  created_at: string
  expires_at: string | null
}

export interface CreateSnapshotRequest {
  name: string
  description?: string
}

export interface CreateBackupRequest {
  name: string
  description?: string
}

export interface SnapshotPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_minutes: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface BackupPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_minutes: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface UpdateSnapshotPolicyRequest {
  enabled?: boolean
  intervalMinutes?: number  // 10, 60, 360, 1440
}

export interface UpdateBackupPolicyRequest {
  enabled?: boolean
  intervalMinutes?: number  // 60, 360, 1440, 4320
}

// ==================== 节点相关 ====================

export interface Host {
  id: number
  name: string
  url: string
  location: string | null
  country_code: string
  architecture?: 'x86_64' | 'aarch64'
  status: 'online' | 'offline' | 'maintenance'
  cert_path?: string | null  // Removed from API responses for security
  key_path?: string | null   // Removed from API responses for security
  nat_public_ip: string | null
  nat_port_start: number | null
  nat_port_end: number | null
  cpu_used: number
  memory_used: number
  disk_used: number
  cpu_allowance_max?: number
  memory_max?: number
  instance_type?: 'container' | 'vm' | 'both'
  notify_purchase?: boolean
  notify_renew?: boolean
  notify_destroy?: boolean
  created_at: string
  updated_at: string
}

export interface HostWithDetails extends Host {
  instanceCount?: number
  tags?: string[]
  certPath?: string  // Removed from API responses for security
  keyPath?: string   // Removed from API responses for security
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskUsed: number
  }
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  architecture?: 'x86_64' | 'aarch64'
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  // 托管节点所有者信息（管理员查看托管节点时返回）
  owner?: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId?: string | null
  }
}

export interface HostAgentStatus {
  id: number
  hostId: number
  agentId: string
  enabled: boolean
  status: 'online' | 'offline' | string
  version: string | null
  latestVersion: string | null
  versionStatus: 'latest' | 'outdated' | 'unknown'
  capabilities: string[]
  lastReport: {
    incus?: {
      available?: boolean
      socket?: string
    }
    resources?: {
      cpuTotal?: number
      cpuUsagePercent?: number
      memoryTotalMb?: number
      memoryUsedMb?: number
      memoryAvailableMb?: number
      memoryUsagePercent?: number
      swapTotalMb?: number
      swapUsedMb?: number
      swapUsagePercent?: number
      diskMountpoint?: string
      diskTotalBytes?: number
      diskUsedBytes?: number
      diskAvailableBytes?: number
      diskUsagePercent?: number
      processCount?: number
    }
    metrics?: {
      reportedAt?: string
      heartbeatIntervalSeconds?: number
      uptimeSeconds?: number
      load1?: number
      load5?: number
      load15?: number
    }
    [key: string]: unknown
  }
  lastSeenAt: string | null
  lastHeartbeatIp: string | null
  createdAt: string
  updatedAt: string
}

export interface HostAgentStatusResponse {
  host: {
    id: number
    name: string
  }
  agent: HostAgentStatus | null
}

export interface HostAgentUpgradeRequestResponse {
  requested: boolean
  currentVersion: string | null
  latestVersion: string | null
  versionStatus: 'latest' | 'outdated' | 'unknown'
  nextHeartbeatSeconds: number
  message: string
}

export interface HostAgentInstallCommandResponse {
  host: {
    id: number
    name: string
  }
  agent: HostAgentStatus
  installToken: string
  installTokenExpiresAt: string
  installScriptUrl: string
  installCommand: string
  warning: string
}

export interface CreateHostRequest {
  name: string
  url: string
  location?: string
  countryCode?: string
  tags?: string[]
  certPath?: string
  keyPath?: string
  natConfig?: {
    publicIp?: string
    publicIpv6?: string
    bindIp?: string
    bindIpv6?: string
    portRangeStart?: number
    portRangeEnd?: number
  }
  ipAddress?: string
  // 存储配置
  storageDriver?: 'zfs' | 'lvm'
  storageType?: 'loop' | 'disk'
  storagePath?: string
  storageSize?: number
  // 网络配置
  ipv6Mode?: number
  ipv6Subnet?: string
  ipv6Gateway?: string
  ipv6ParentInterface?: string
}

export interface UpdateHostRequest {
  name?: string
  url?: string
  location?: string
  countryCode?: string
  status?: 'online' | 'offline' | 'maintenance'
  certPath?: string
  keyPath?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  ipv6ParentInterface?: string
  ipv6Subnet?: string
  transferEnabled?: boolean
  trafficResetDay?: number  // 流量重置日（1-28）
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  enableResourcePool?: boolean  // 是否参与资源池玩法
  announcement?: string | null  // 节点公告
  probeUrl?: string | null  // 探针地址
  natConfig?: {
    publicIp?: string
    publicIpv6?: string
    bindIp?: string
    bindIpv6?: string
    portRangeStart?: number | null
    portRangeEnd?: number | null
  }
}

export interface AvailableHost {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture?: 'x86_64' | 'aarch64'
  probeUrl?: string | null
  trafficMultiplier?: number
  effectiveTrafficLimit?: string | null
  resources: {
    cpuUsed: number
    cpuAllowanceMax: number
    cpuEffectiveMax: number
    cpuAvailable: number
    memoryUsed: number
    memoryMax: number
    memoryAvailable: number
    diskAvailable: number
  }
}

export type ChangeHostUnavailableReason =
  | 'current_host'
  | 'host_offline'
  | 'host_type_mismatch'
  | 'cpu_full'
  | 'memory_full'
  | 'resource_unconfigured'
  | 'image_unavailable'

export interface ChangeHostOption {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture: string
  status: string
  probeUrl?: string | null
  trafficMultiplier?: number
  effectiveTrafficLimit?: string | null
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
}

export interface ChangeHostOptionsResponse {
  packageId: number | null
  packageName: string | null
  currentHostId: number
  required: {
    cpu: number
    memory: number
  }
  hosts: ChangeHostOption[]
  sshKeys: Array<{
    id: number
    name: string
    fingerprint?: string | null
  }>
  canChangeHost: boolean
  unavailableReason?: 'no_package' | 'single_host' | 'no_ssh_key'
}

// ==================== 套餐相关 ====================

export interface Package {
  id: number
  name: string
  description: string | null
  cpu_max: number
  memory_max: number
  disk_max: number
  bandwidth_max: number | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'  // camelCase 别名
  instance_type?: 'container' | 'vm'  // 实例类型
  host_ids: number[]  // 绑定的宿主机ID列表
  host_storage_pools?: Record<string, string | null>
  host_traffic_multipliers?: Record<string, number>
  privileged: number
  nested: number
  active: number
  instance_count?: number
  port_limit?: number | null
  snapshot_limit?: number | null
  backup_limit?: number | null
  site_limit?: number | null
  node_selectors?: string | null
  monthly_traffic_limit?: string | null  // BigInt as string (Bytes)
  // 存储 I/O 限制
  io_limit_mode?: 'throughput' | 'iops'
  limits_read?: string
  limits_write?: string
  limits_read_iops?: number
  limits_write_iops?: number
  // 网络限制
  limits_ingress?: string
  limits_egress?: string
  // 进程与调度
  limits_processes?: number
  limits_cpu_priority?: number
  // 启动配置
  boot_autostart?: boolean
  boot_autostart_priority?: number
  boot_autostart_delay?: number
  boot_host_shutdown_timeout?: number
  created_at: string
  // 套餐所有权标识（用于区分自己的套餐和共享的套餐）
  isOwn?: boolean  // true = 用户自己拥有的套餐，false = 共享给自己的套餐
  isShared?: boolean  // true = 共享给自己的套餐
  isGlobalShared?: boolean  // true = 全局共享的套餐
  ownerId?: number  // 套餐所有者ID
  ownerUsername?: string  // 套餐所有者用户名
  sourceType?: 'official' | 'market' | 'zone' | 'friends' | 'own'  // 套餐来源类型
  hostingZoneId?: number
  hostingZoneName?: string
  hostingZoneLogoUrl?: string
  soldOut?: boolean  // 是否售罄（所有宿主机都无法满足最低配置）
  // 全局共享配置（仅当 isGlobalShared = true 或套餐所有者查看时）
  global_shared?: boolean
  global_quota_multiplier?: null  // 公开套餐不再使用资源配额倍数限制
  global_max_instances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  required_package_id?: number | null
  required_package_name?: string | null
  has_required_package_instance?: boolean
  // 实例操作权限
  allow_instance_deletion?: boolean  // 是否允许用户删除实例
  sharedAt?: string  // 共享时间（共享套餐）
  // 剩余配额信息
  quotaInfo?: {
    maxInstances: number | null
    remainingInstances: number | null
    maxCpu: number | null
    remainingCpu: number | null
    maxMemory: number | null
    remainingMemory: number | null
    ownerUsername: string | null
  }
  // 托管套餐所有者信息（管理员查看托管套餐时返回）
  owner?: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId?: string | null
  }
}

export interface CreatePackageRequest {
  name: string
  description?: string
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax?: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds: number[]  // 必须至少绑定一个宿主机
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  nodeSelectors?: string[]
  monthlyTrafficLimit?: string  // BigInt as string (Bytes)
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: null  // 公开套餐不再使用资源配额倍数限制
  globalMaxInstances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  requiredPackageId?: number | null
  // 实例操作权限
  allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

export interface UpdatePackageRequest {
  name?: string
  description?: string
  cpuMax?: number
  memoryMax?: number
  diskMax?: number
  bandwidthMax?: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds?: number[]  // 如果提供，将更新绑定的宿主机（必须至少一个）
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  nodeSelectors?: string[]
  monthlyTrafficLimit?: string | null  // BigInt as string (Bytes), null to clear
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: null  // 公开套餐不再使用资源配额倍数限制
  globalMaxInstances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  requiredPackageId?: number | null
  // 实例操作权限
  allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

// 实例配置类型
export interface InstanceConfig {
  limits_read: string
  limits_write: string
  limits_read_iops: number
  limits_write_iops: number
  limits_ingress: string
  limits_egress: string
  limits_processes: number
  limits_cpu_priority: number
  boot_autostart: boolean
  boot_autostart_priority: number
  boot_autostart_delay: number
  boot_host_shutdown_timeout: number
}

export interface InstanceSwapConfig {
  available: boolean
  enabled: boolean
  sizeMb: number
  kind: 'container' | 'vm'
  requiresRunning: boolean
}

export interface InstanceConfigResponse {
  config: InstanceConfig
  overrides: Record<keyof InstanceConfig, boolean>
  packageDefaults: InstanceConfig
  ioLimitMode: 'throughput' | 'iops'
  swap: InstanceSwapConfig
}

export interface UpdateInstanceConfigRequest {
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

// ==================== SSH Keys ====================

export interface SshKey {
  id: number
  user_id?: number
  name: string
  fingerprint: string
  publicKeyPreview?: string  // 截断的公钥预览
  created_at?: string
  createdAt?: string
}

export interface CreateSshKeyRequest {
  name: string
  publicKey: string
}

// ==================== 通知相关 ====================

export interface NotificationChannel {
  id: number
  user_id: number
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: string | Record<string, unknown>
  enabled: boolean | number
  created_at: string
}

export interface CreateNotificationChannelRequest {
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: Record<string, unknown>
}

export interface UpdateNotificationChannelRequest {
  name?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

export type CloudInitState =
  | 'manual'
  | 'done'
  | 'done_with_errors'
  | 'running'
  | 'disabled'
  | 'unsupported'
  | 'agent_unavailable'
  | 'unknown'

export interface CloudInitStatusResponse {
  ready: boolean
  state: CloudInitState
  source: 'manual' | 'status_json' | 'boot_finished' | 'image' | 'unknown'
  manualOverride: boolean
  message: string
  detectedAt: string
}

export interface TerminalSavedCommand {
  id: number
  userId: number
  name: string
  command: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTerminalSavedCommandRequest {
  name: string
  command: string
  description?: string | null
}

export interface UpdateTerminalSavedCommandRequest {
  name?: string
  command?: string
  description?: string | null
}

// ==================== 实例任务相关 ====================

export type InstanceTaskType = 'start' | 'stop' | 'restart' | 'rebuild' | 'recreate' | 'clone' | 'change_host'
export type InstanceTaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface InstanceTask {
  id: number
  instanceId?: number
  instanceName?: string | null
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress?: string | null
  error?: string | null
  queuePosition: number
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  newInstanceId?: number | null  // 用于 clone 操作
}

export interface InstanceTaskResponse {
  message: string
  taskId: number
  status: InstanceTaskStatus
}

// ==================== 站内信相关 ====================

export interface InboxMessage {
  id: number
  userId: number
  eventType: string
  title: string
  content: string
  isRead: boolean
  data: Record<string, unknown> | null
  createdAt: string
}

export interface PaginatedInboxMessages {
  messages: InboxMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== OAuth 相关 ====================

export interface OAuthConfig {
  id: number
  provider: 'github' | 'google'
  client_id: string
  client_secret: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface UserOAuthBinding {
  id: number
  user_id: number
  provider: 'github' | 'google'
  provider_user_id: string
  provider_username: string | null
  provider_email: string | null
  provider_avatar: string | null
  created_at: string
  updated_at: string
}

export interface UpdateOAuthConfigRequest {
  clientId?: string
  clientSecret?: string
  enabled?: boolean
}

// ==================== 帮助文档 ====================

export interface HelpArticle {
  id: number
  title: string
  slug: string
  content: string
  category: string
  sort_order: number
  published: number
  pinned?: number  // 是否置顶（0 = 否，1 = 是）
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface CreateHelpArticleRequest {
  title: string
  slug: string
  content: string
  category: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
}

export interface UpdateHelpArticleRequest {
  title?: string
  slug?: string
  content?: string
  category?: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
}

// ==================== 镜像相关 ====================

export interface SystemImage {
  id: number
  name: string
  osType: string
  remoteAlias: string
  architecture: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon: string
  sortOrder?: number
  hidden?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CreateSystemImageRequest {
  name: string
  remoteAlias: string
  osType?: string
  architecture?: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon: string
  sortOrder?: number
  hidden?: boolean
}

export interface UpdateSystemImageRequest {
  name?: string
  remoteAlias?: string
  osType?: string
  architecture?: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon?: string
  sortOrder?: number
  hidden?: boolean
}

export interface HostImagePolicy {
  success: boolean
  host: {
    id: number
    name: string
    architecture: 'x86_64' | 'aarch64'
    instanceType: 'container' | 'vm' | 'both'
  }
  useDefault: boolean
  allowedImageIds: number[]
  images: SystemImage[]
}

// ==================== 日志 ====================

export interface Log {
  id: number
  user_id: number | null
  instance_id?: number | null
  username?: string | null
  module: string
  action: string
  content: string
  result: string
  created_at: string
}

// ==================== 工单相关 ====================

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory = 'general' | 'billing' | 'technical' | 'abuse'

export interface Ticket {
  id: number
  userId: number
  hostId: number | null  // 可为 null，表示直接发给管理员的工单
  instanceId: number | null
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  closedAt: string | null
  user?: {
    id: number
    username: string
    avatarStyle?: string
    avatarBadgeId?: string | null
  }
  host?: {
    id: number
    name: string
    userId: number
  }
  instance?: {
    id: number
    name: string
    status?: string
    iconBadgeId?: string | null
    incusId?: string | null
    ipv4?: string | null
    ipv6?: string | null
    cpu?: number
    memory?: number
    disk?: number
    image?: string
    packageName?: string | null
  } | null
  messageCount?: number
  lastMessage?: {
    content: string
    isFromOwner: boolean
    createdAt: string
  } | null
  // 是否需要回复：
  // - 用户视角：宿主机主人回复了，需要用户回复
  // - 宿主机视角：用户回复了，需要宿主机主人回复
  needsReply?: boolean
}

export interface TicketMessage {
  id: number
  ticketId: number
  senderId: number
  content: string
  isFromOwner: boolean
  createdAt: string
  attachments: TicketMessageAttachment[]
  sender?: {
    id: number
    username: string
    avatarStyle?: string
    avatarBadgeId?: string | null
  }
}

export interface TicketMessageAttachment {
  id: number
  ticketId: number
  messageId: number
  uploaderId: number
  provider: string
  providerVersion: string
  providerFileId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
}

export interface CreateTicketRequest {
  instanceId?: number | null  // 可选：不选实例时工单直接发给管理员
  subject: string
  category?: TicketCategory
  priority?: TicketPriority
  content: string
  attachments?: File[]
}

export interface PaginatedTickets {
  tickets: Ticket[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginatedTicketMessages {
  messages: TicketMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== 计费相关 ====================

// 套餐方案
export interface PackagePlan {
  id: number
  packageId: number
  name: string
  description: string | null
  price: number
  billingCycle: number // 账期（月）
  setupFee?: number    // 开通费（分）
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  monthlyTrafficLimit: string | null
  isActive: boolean
  isSoldOut: boolean
  sortOrder: number
  slaGuarantee: number | null // SLA保证百分比，1-100
  createdAt: string
  package?: {
    id: number
    name: string
  }
}

// 计费信息
export interface InstanceBillingInfo {
  instanceId: number
  instanceName: string
  planId: number | null
  planName: string | null
  price: number | null
  billingCycle: number | null
  expiresAt: string | null
  autoRenew: boolean
  renewPreview: RenewPreview[] | null
  affDiscount: AffDiscount | null
  // 托管实例相关信息
  isHostedInstance: boolean
  daysUntilExpire: number | null
  hostingRenewRestriction: { monthsOnly: number; daysBeforeExpire: number } | null
}

export interface RenewPreview {
  months: number
  price: number           // 原价（元）
  discountedPrice: number // 折扣价（元）
  expiresAt: string
}

export interface AffDiscount {
  discountRate: number     // 折扣率，如 0.05
  discountPercent: number  // 百分比，如 5 表示 5%
}

// 升降级预览
export interface ChangePlanPreview {
  oldPlan: {
    id: number
    name: string
    price: number
    billingCycle: number
  }
  newPlan: {
    id: number
    name: string
    price: number
    billingCycle: number
    isActive: boolean
    isSoldOut: boolean
  }
  remainingDays: number
  // 计算详情
  oldDailyPrice: number        // 原方案日价（元）
  newDailyPrice: number        // 新方案日价（元）
  remainingValue: number       // 剩余价值（元）
  newPlanCost: number          // 新方案费用（元）
  // 折扣信息
  discountRate: number         // 折扣率（0-1）
  discountAmount: number       // 折扣金额（元）
  // 最终费用
  priceDiff: number            // 差价（元，正数=补交，负数=退款）
  isUpgrade: boolean
  newExpiresAt: string
  newConfig: {
    cpu: number
    memory: number
    disk: number
  }
  resourceWarnings: string[] | null
  // 可变更状态
  canChange: boolean
  cannotChangeReason?: string
}

// 计费记录
export interface InstanceBillingRecord {
  id: number
  type: 'purchase' | 'renewal' | 'upgrade' | 'downgrade' | 'admin_extension'
  amount: number
  months: number | null
  periodStart: string
  periodEnd: string
  remark: string | null
  createdAt: string
}

// 支付渠道
export interface PaymentProvider {
  id: number
  name: string
  type: string
  methods: string[]
  methodFees?: Record<string, { feeRate: number; feeFixed?: number }>
  minAmount: number
  maxAmount: number | null
  feeRate: number
  feeFixed: number
}

// 充值订单
export interface RechargeOrder {
  id?: number
  orderNo: string
  amount: number
  payableAmount?: number
  actualAmount: number | null
  fee: number
  status: 'pending' | 'paid' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'refunded'
  provider?: {
    id: number
    name: string
    type: string
  }
  paymentMethod?: string | null
  actualPaymentMethod?: string | null
  paymentCurrency?: string | null
  paymentNetwork?: string | null
  paymentUuid?: string | null
  paymentTxid?: string | null
  invoiceCurrency?: string | null
  gatewayStatus?: string | null
  gatewayStatusDescription?: string | null
  tradeNo?: string | null
  failReason?: string | null
  createdAt: string
  expiredAt?: string | null
  completedAt?: string | null
}

// 用户余额信息
export interface UserBalance {
  balance: number
  frozen: number
  totalRecharge: number
  totalConsume: number
}

// 余额变动记录
export interface BalanceLog {
  id: number
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  remark: string | null
  createdAt: string
}

// ==================== 通用响应 ====================

export interface ApiResponse<T = unknown> {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
