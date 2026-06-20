/**
 * API 请求/响应类型定义
 */

import type { User, Instance, Host, Package } from './database.js'

// ==================== 认证相关 ====================

export interface LoginRequest {
  username: string
  password: string
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
  }
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  inviteCode?: string
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
  }
}

// ==================== 用户相关 ====================

export interface CreateUserRequest {
  username: string
  email: string
  password: string
  role?: 'admin' | 'user'
}

export interface UpdateUserRequest {
  email?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'banned'
  emailCode?: string
}

// ==================== 实例相关 ====================

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
}

export interface UpdateInstanceRequest {
  name?: string
  cpu?: number
  memory?: number
  disk?: number
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
}

export interface InstanceWithDetails extends Instance {
  user?: Pick<User, 'id' | 'username' | 'email'>
  host?: Pick<Host, 'id' | 'name' | 'location'>
  package?: Pick<Package, 'id' | 'name'>
}

// ==================== 节点相关 ====================

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
  storageDriver?: 'zfs' | 'lvm'
  storageType?: 'loop' | 'disk'
  storagePath?: string
  storageSize?: number
  ipv6Mode?: number
  ipv6Subnet?: string
  ipv6Gateway?: string
  ipv6ParentInterface?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
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
  trafficResetDay?: number  // 流量重置日（1-28�?
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  transferEnabled?: boolean
  enableResourcePool?: boolean
  announcement?: string | null
  probeUrl?: string | null
  natConfig?: {
    publicIp?: string
    publicIpv6?: string
    bindIp?: string
    bindIpv6?: string
    portRangeStart?: number | null
    portRangeEnd?: number | null
  }
}
// ==================== 套餐相关 ====================

export interface CreatePackageRequest {
  name: string
  description?: string
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax?: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds?: number[]
  hostStoragePools?: Record<string, string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  // 套餐资源限制
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: string | null
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调�?
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: number | null  // 配额倍数限制，如 0.5, 1.0, 1.5, 2.0，null 表示无限制（1x�?
  globalMaxInstances?: number | null  // 全局共享的最大实例数，null 表示无限�?
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
  hostIds?: number[]
  hostStoragePools?: Record<string, string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  // 套餐资源限制
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: string | null
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调�?
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: number | null  // 配额倍数限制，如 0.5, 1.0, 1.5, 2.0，null 表示无限制（1x�?
  globalMaxInstances?: number | null  // 全局共享的最大实例数，null 表示无限�?
  // 实例操作权限
  allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

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

// 实例配置覆盖请求
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

// ==================== 快照/备份 ====================

export interface CreateSnapshotRequest {
  name: string
  description?: string
}

export interface CreateBackupRequest {
  name: string
  description?: string
}

// ==================== 通用响应 ====================

export interface ApiResponse<T = unknown> {
  success: boolean
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

