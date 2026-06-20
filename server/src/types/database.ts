/**
 * 数据库行类型定义
 * 对应 SQLite 数据库中的表结构
 */

// ==================== 用户相关 ====================

export interface User {
  id: number
  username: string
  email: string | null
  password_hash: string
  role: 'admin' | 'user'
  status: 'active' | 'banned'
  ban_reason: string | null  // 封禁原因
  avatar_style: string
  avatar_badge_id?: string | null
  has_created_host_before?: boolean
  created_at: string
  updated_at: string
}

export interface UserQuota {
  id: number
  user_id: number
  // 新配额系统：控制用户可拥有的资源数量
  // 默认值为 0，表示功能未开放，需要管理员授权才能使用
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  host_limit: number      // 宿主机数量上限（0 = 未授权）
  host_used: number       // 已使用宿主机数量
  friend_limit: number    // 好友数量上限（0 = 未授权）
  friend_used: number     // 已使用好友数量
  package_limit: number   // 套餐数量上限（0 = 未授权）
  package_used: number    // 已使用套餐数量
  // 流量配额
  monthly_traffic_limit: bigint | null
  monthly_traffic_used: bigint
  extra_traffic_quota: bigint
  traffic_status: TrafficStatus
}

export interface InviteCode {
  id: number
  code: string
  created_by: number
  used_by: number | null
  used_at: string | null
  expires_at: string | null
  cost_snapshot?: unknown
  created_at: string
}

export interface SshKey {
  id: number
  user_id: number
  name: string
  public_key: string
  fingerprint: string
  created_at: string
}

// ==================== 节点相关 ====================

export interface Host {
  id: number
  user_id?: number  // 节点所有者
  name: string
  url: string
  location: string | null
  country_code: string
  architecture?: 'x86_64' | 'aarch64'
  status: 'online' | 'offline' | 'maintenance'
  cert_path: string | null
  key_path: string | null
  nat_public_ip: string | null
  nat_public_ipv6?: string | null
  nat_bind_ip?: string | null
  nat_bind_ipv6?: string | null
  nat_port_start: number | null
  nat_port_end: number | null
  cpu_used: number
  memory_used: number
  disk_total?: number   // 计算值，来自 storage_size * 1024
  disk_used: number
  ip_address?: string | null
  storage_driver?: string
  storage_type?: string
  storage_path?: string | null
  storage_size?: number
  ipv6_mode?: number
  ipv6_subnet?: string | null
  ipv6_gateway?: string | null
  ipv6_parent_interface?: string | null
  enable_api?: boolean
  sysctl_config?: string | null
  cpu_allowance_max?: number
  memory_max?: number
  instance_type?: 'container' | 'vm' | 'both'
  nat_ports_used_count?: number
  tags?: string[]
  // Caddy 反代配置
  caddy_enabled?: boolean
  caddy_username?: string | null
  caddy_password?: string | null
  caddy_port?: number
  // 转移控制
  transfer_enabled?: boolean
  // 流量配置
  traffic_reset_day?: number  // 流量重置日（1-28），默认1号
  // 节点通知设置
  notify_purchase?: boolean
  notify_renew?: boolean
  notify_destroy?: boolean
  // 资源池玩法
  enable_resource_pool?: boolean  // 是否参与资源池玩法
  // 节点公告
  announcement?: string | null
  // 探针地址
  probe_url?: string | null
  created_at: string
  updated_at: string
}

// ==================== 套餐相关 ====================

export interface Package {
  id: number
  user_id?: number  // 套餐所有者
  name: string
  description: string | null
  cpu_max: number
  memory_max: number
  disk_max: number
  bandwidth_max: number | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instance_type: 'container' | 'vm' | 'both'  // 实例类型 (套餐实际不会使用 both)
  privileged: number
  nested: number
  active: number
  // 套餐资源限制
  port_limit: number        // 端口映射数上限
  snapshot_limit: number    // 快照数上限
  backup_limit: number      // 备份数上限
  site_limit: number        // 反代站点数上限
  monthly_traffic_limit: string | null  // BigInt as string
  // 存储 I/O 限制
  io_limit_mode: string     // "throughput" | "iops" - IO限制模式
  limits_read: string       // 磁盘读取吞吐限制
  limits_write: string      // 磁盘写入吞吐限制
  limits_read_iops: number  // 磁盘读取 IOPS
  limits_write_iops: number // 磁盘写入 IOPS
  // 网络限制
  limits_ingress: string    // 网络入站带宽
  limits_egress: string     // 网络出站带宽
  // 进程与调度
  limits_processes: number  // 进程数限制
  limits_cpu_priority: number // CPU 调度优先级 (0-10)
  // 启动配置
  boot_autostart: boolean   // 开机自启
  boot_autostart_priority: number // 启动优先级 (0-100)
  boot_autostart_delay: number    // 启动延迟 (5-600秒)
  boot_host_shutdown_timeout: number // 关机超时 (30-600秒)
  // 全局共享配置（可选字段，仅当有值时存在）
  global_shared?: boolean
  global_quota_multiplier?: number | null
  global_max_instances?: number | null
  required_package_id?: number | null
  required_package_name?: string | null
  // 实例操作权限
  allow_instance_deletion?: boolean  // 是否允许用户删除实例
  host_storage_pools?: Record<string, string | null>
  // 补货/释放通知渠道 ID（绑定的全局渠道或私有渠道）
  release_channel_id?: number | null
  created_at: string
}

// ==================== 实例相关 ====================

export type InstanceStatus = 'creating' | 'running' | 'stopped' | 'suspended' | 'error' | 'deleted'

export interface Instance {
  id: number
  incus_id: string
  name: string
  user_id: number
  host_id: number
  package_id: number | null
  package_plan_id: number | null  // 套餐方案 ID：null 表示免费实例
  display_order?: number
  storage_pool_name?: string | null
  image: string
  status: InstanceStatus
  cpu: number
  memory: number
  disk: number
  ipv4: string | null
  ipv6: string | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  ssh_port: number | null
  root_password: string | null
  port_limit: number | null
  snapshot_limit: number | null
  backup_limit: number | null
  site_limit: number | null
  swap_enabled: boolean
  swap_size: number | null
  monthly_traffic_limit: string | null  // BigInt as string (Bytes)
  // 存储 I/O 限制 (null = 继承套餐)
  limits_read: string | null
  limits_write: string | null
  limits_read_iops: number | null
  limits_write_iops: number | null
  // 网络限制
  limits_ingress: string | null
  limits_egress: string | null
  // 进程与调度
  limits_processes: number | null
  limits_cpu_priority: number | null
  // 启动配置
  boot_autostart: boolean | null
  boot_autostart_priority: number | null
  boot_autostart_delay: number | null
  boot_host_shutdown_timeout: number | null
  // 计费与封停相关字段
  expires_at: string | null        // 到期时间，null 表示免费实例（永不到期）
  suspended_at: string | null      // 封停时间
  suspended_by: number | null      // 封停操作者 ID，null 表示系统自动封停
  suspend_reason: string | null    // 封停原因
  icon_badge_id?: string | null
  cloud_init_state?: string | null
  cloud_init_source?: string | null
  cloud_init_last_checked_at?: string | null
  cloud_init_completed_at?: string | null
  cloud_init_manual_completed_at?: string | null
  cloud_init_manual_completed_by?: number | null
  created_at: string
  updated_at: string
}

export interface PortMapping {
  id: number
  instance_id: number
  host_id: number
  protocol: 'tcp' | 'udp'
  public_port: number
  private_port: number
  remark: string | null
  created_at: string
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

export interface BackupPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_hours: number
  retention_count: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface SnapshotPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_hours: number
  retention_count: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

// ==================== 通知相关 ====================

export interface NotificationChannel {
  id: number
  user_id: number
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: string
  enabled: number
  created_at: string
}

export interface NotificationLog {
  id: number
  channel_id: number
  event_type: string
  message: string
  status: 'pending' | 'sent' | 'failed'
  error: string | null
  created_at: string
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
  access_token: string | null
  refresh_token: string | null
  created_at: string
  updated_at: string
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
  pinned: number  // 是否置顶（0 = 否，1 = 是）
  created_by: number | null
  created_at: string
  updated_at: string
}

// ==================== 日志 ====================

export interface Log {
  id: number
  user_id: number | null
  instance_id: number | null
  module: string
  action: string
  content: string
  result: string
  created_at: string
}

// ==================== 流量统计 ====================

export type TrafficStatus = 'NORMAL' | 'WARNING' | 'LIMITED'

export interface TrafficSnapshot {
  id: number
  instance_id: number
  rx_raw: bigint
  tx_raw: bigint
  updated_at: string
}

export interface DailyTraffic {
  id: number
  instance_id: number
  date: string
  rx_total: bigint
  tx_total: bigint
}
