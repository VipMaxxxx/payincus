/**
 * Incus API 类型定义
 */

export interface IncusClientOptions {
  url: string
  certPath: string | null
  keyPath: string | null
}

export interface IncusApiResponse<T = unknown> {
  type: 'sync' | 'async' | 'error'
  status?: string
  status_code?: number
  operation?: string
  metadata?: T
  error?: string
  err?: string
}

export interface IncusOperation {
  id: string
  class: string
  description?: string
  created_at: string
  updated_at: string
  status: 'Pending' | 'Running' | 'Cancelling' | 'Cancelled' | 'Success' | 'Failure'
  status_code: number
  may_cancel?: boolean
  location?: string
  resources?: Record<string, unknown>
  metadata?: Record<string, unknown>
  err?: string
  error?: string
}

export interface IncusInstance {
  name: string
  type: 'container' | 'virtual-machine'
  status: 'Running' | 'Stopped' | 'Frozen' | 'Error' | 'Starting' | 'Stopping'
  status_code: number
  state?: {
    status: string
    network?: Record<string, {
      addresses?: Array<{
        family: 'inet' | 'inet6'
        address: string
        netmask?: string
        scope?: string
      }>
    }>
  }
  config?: Record<string, string>
  devices?: Record<string, Record<string, unknown>>
  expanded_config?: Record<string, string>
  expanded_devices?: Record<string, Record<string, unknown>>
}

export interface IncusImage {
  fingerprint: string
  filename: string
  size: number
  architecture: string
  created_at: string
  expires_at: string
  last_used_at: string
  uploaded_at: string
  auto_update: boolean
  properties?: Record<string, string>
  aliases?: Array<{ name: string; description: string; target: string }>
  update_source?: {
    alias: string
    certificate: string
    protocol: string
    server: string
  }
}

export interface IncusImageAlias {
  name: string
  description: string
  target: string
}

export interface IncusSnapshot {
  name: string
  created_at: string
  stateful: boolean
  expires_at?: string
}

export interface IncusBackup {
  name: string
  created_at: string
  expires_at?: string
  instance_only: boolean
  optimized_storage: boolean
  compression_algorithm: string
}

export interface IncusNetwork {
  name: string
  type: string
  used_by?: string[]
  config?: Record<string, string>
}

export interface IncusStoragePool {
  name: string
  driver: string
  status?: string
  description?: string
  used_by?: string[]
  config?: Record<string, string>
}

export interface IncusServerInfo {
  api_version: string
  auth: string
  auth_methods: string[]
  config?: Record<string, unknown>
  environment?: {
    addresses: string[]
    architectures: string[]
    certificate: string
    driver: string
    driver_version: string
    kernel: string
    kernel_architecture: string
    kernel_version: string
    server: string
    server_pid: number
    server_version: string
    storage: string
    storage_version: string
  }
}

export interface IncusResources {
  cpu?: {
    total: number
    sockets: Array<{
      name: string
      socket: number
      vendor: string
      product: string
      frequency: number
      frequency_minimum: number
      frequency_turbo: number
    }>
  }
  memory?: {
    total: number
    used: number
  }
  storage?: {
    pools: Array<{
      name: string
      driver: string
      space?: {
        used: number
        total: number
      }
    }>
  }
}

/**
 * IPv6 配置结构 (用于双网卡 routed 模式)
 */
export interface IPv6Config {
  /** 主 IP (必须) */
  primaryIp: string
  /** 额外 IP 列表 */
  extraIps?: string[]
  /** 网段 CIDR (如 "2a01:4f9:c012:e7:aaaa::/112") */
  subnet?: string
}

export interface BuildInstanceConfigOptions {
  name: string
  image: string
  cpu: number
  memory: number
  disk: number
  swapEnabled?: boolean
  swapSize?: number | null
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  sshKey?: string
  password?: string
  nested?: boolean
  privileged?: boolean
  cloudInitConfig?: {
    'user.user-data': string
    'user.network-config'?: string
  }
  // 实例类型: container(容器) 或 vm(虚拟机)
  instanceType?: 'container' | 'vm'
  // 存储池名称 (用于 root device)
  storagePool?: string | null
  // IP 地址配置 (新双网卡架构)
  ipv4Address?: string | null     // 内网 IPv4 地址 (随机分配)
  // IPv6 静态地址配置 (旧方式，保持向后兼容)
  ipv6Address?: string | null      // 静态 IPv6 地址 (已弃用，使用 ipv6Config)
  ipv6Gateway?: string | null      // IPv6 网关 (已弃用)
  networkBridge?: string | null    // NAT 网桥名称 (默认 incusbr0)
  // IPv6 Routed 模式配置 (新双网卡架构)
  ipv6Config?: IPv6Config | null   // IPv6 配置 (用于 eth1 routed 模式)
  hostInterface?: string | null    // 宿主机物理网卡名 (用于 routed 模式)
  // Advanced configuration options
  limitsRead?: string | null       // e.g., "100MB"
  limitsWrite?: string | null      // e.g., "100MB"
  limitsReadIops?: number | null   // e.g., 500
  limitsWriteIops?: number | null  // e.g., 500
  limitsIngress?: string | null    // e.g., "300Mbit"
  limitsEgress?: string | null     // e.g., "300Mbit"
  limitsProcesses?: number | null  // e.g., 500
  limitsCpuPriority?: number | null // 0-10
  bootAutostart?: boolean | null
  bootAutostartPriority?: number | null // 0-100
  bootAutostartDelay?: number | null    // 5-600 seconds
  bootHostShutdownTimeout?: number | null // 30-600 seconds
}

export interface PullImageOptions {
  server?: string
  protocol?: string
  autoUpdate?: boolean
  isPublic?: boolean
}

export interface CreateBackupOptions {
  instanceOnly?: boolean
  optimizedStorage?: boolean
  compression?: string
}

export interface ExecOptions {
  'wait-for-websocket'?: boolean
  interactive?: boolean
  environment?: Record<string, string>
  cwd?: string
  user?: number
  group?: number
}

