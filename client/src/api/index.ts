import axios, { type AxiosInstance } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { buildApiUrl } from '@/utils/api-url'
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UpdateUserResponse,
  GenerateInviteRequest,
  InviteListResponse,
  User,
  BadgeOverview,
  BadgeMultiDrawResponse,
  BadgeOwnership,
  BadgeCatalogItem,
  BadgeSeriesItem,
  UserQuota,
  UpdateUserRequest,
  Instance,
  InstanceWithDetails,
  InstanceStats,
  CreateInstanceRequest,
  UpdateInstanceRequest,
  ChangeHostOptionsResponse,
  PortMapping,
  CreatePortMappingRequest,
  IpAddress,
  Ipv6Subnet,
  HostAgentStatusResponse,
  HostAgentInstallCommandResponse,
  HostAgentUpgradeRequestResponse,
  Snapshot,
  Backup,
  CreateSnapshotRequest,
  CreateBackupRequest,
  SnapshotPolicy,
  BackupPolicy,
  UpdateSnapshotPolicyRequest,
  UpdateBackupPolicyRequest,
  Host,
  HostWithDetails,
  AvailableHost,
  CreateHostRequest,
  UpdateHostRequest,
  Package,
  CreatePackageRequest,
  UpdatePackageRequest,
  SshKey,
  CreateSshKeyRequest,
  NotificationChannel,
  CreateNotificationChannelRequest,
  UpdateNotificationChannelRequest,
  OAuthConfig,
  UserOAuthBinding,
  UpdateOAuthConfigRequest,
  HelpArticle,
  CreateHelpArticleRequest,
  UpdateHelpArticleRequest,
  HostImagePolicy,
  SystemImage,
  CreateSystemImageRequest,
  UpdateSystemImageRequest,
  Log,
  PaginatedResponse,
  Ticket,
  TicketMessage,
  TicketStatus,
  CreateTicketRequest,
  PaginatedTickets,
  PaginatedTicketMessages,
  TerminalSavedCommand,
  CreateTerminalSavedCommandRequest,
  UpdateTerminalSavedCommandRequest,
  TelegramBindingStatus,
  TelegramBindTokenResponse,
  TelegramAdminBindingsResponse,
  TelegramWebhookDeleteResponse,
  TelegramWebhookInfoResponse,
  TelegramWebhookSetupResponse,
  UserInvite,
  UserInviteSummary
} from '@/types/api.js'

export type VipRuleType = 'user' | 'hosting'
export type VipConditionMode = 'any' | 'all'
export type UserVipMetric = 'totalRecharge' | 'totalConsume'

export interface VipBadgeStyle {
  backgroundColor: string
  textColor: string
}

export interface VipBenefitHallConfig {
  balance?: {
    enabled?: boolean
    amount?: number
  }
  points?: {
    enabled?: boolean
    amount?: number
  }
  instance?: {
    enabled?: boolean
    packageId?: number | null
    packageName?: string | null
    planId?: number | null
    planName?: string | null
    days?: number | null
    quantity?: number | null
  }
}

export interface VipLevelRule {
  id?: number
  type: VipRuleType
  level: number
  enabled: boolean
  conditionMode: VipConditionMode
  userMetric?: UserVipMetric
  minRecharge: number | null
  minConsume: number | null
  minHostingIncome: number | null
  minHostingInstances: number | null
  benefits?: Record<string, unknown> & {
    badgeStyle?: VipBadgeStyle
    benefitHall?: VipBenefitHallConfig
  }
  badgeStyle?: VipBadgeStyle
}

export interface VipLevelRulesResponse {
  type: VipRuleType
  maxLevel: number
  userMetric?: UserVipMetric
  rules: VipLevelRule[]
}

export type VipProgressMetric = 'totalRecharge' | 'totalConsume' | 'totalHostingIncome' | 'instanceCount'

export interface VipProgressCondition {
  metric: VipProgressMetric
  current: number
  target: number
  remaining: number
  matched: boolean
  progress: number
}

export interface VipLevelProgress {
  currentLevel: number
  nextLevel: number | null
  conditionMode: VipConditionMode | null
  userMetric?: UserVipMetric | null
  progress: number
  isMaxLevel: boolean
  conditions: VipProgressCondition[]
}

export interface VipOverviewResponse {
  userVipLevel: number
  hostingVipLevel: number
  userVipBadgeStyle?: VipBadgeStyle | null
  hostingVipBadgeStyle?: VipBadgeStyle | null
  userVipMetric?: UserVipMetric
  userStats: {
    totalRecharge: number
    totalConsume: number
  }
  hostingStats: {
    totalHostingIncome: number
    instanceCount: number
  }
  userVipProgress?: VipLevelProgress
  hostingVipProgress?: VipLevelProgress
}

export type VipBenefitRewardType = 'balance' | 'points' | 'instance'
export type VipBenefitClaimStatus = 'delivered' | 'pending'
export type VipBenefitRewardState = 'claimable' | 'claimed' | 'locked' | 'blocked'

export interface VipBenefitRewardConfig {
  amount?: number
  packageId?: number | null
  packageName?: string | null
  planId?: number | null
  planName?: string | null
  days?: number
  quantity?: number
}

export interface VipBenefitClaim {
  id: number
  rewardId: number
  level: number
  status: VipBenefitClaimStatus
  claimNo: number
  snapshot: Record<string, unknown>
  deliveredAt: string | null
  createdAt: string
}

export interface VipBenefitReward {
  id: number
  level: number
  type: VipBenefitRewardType
  title: string
  description: string | null
  claimLimit: number
  sortOrder: number
  enabled: boolean
  config: VipBenefitRewardConfig
  createdAt?: string
  updatedAt?: string
  claimedCount?: number
  remainingClaims?: number
  state?: VipBenefitRewardState
  blockedByLevel?: number | null
  claims?: VipBenefitClaim[]
}

export interface VipBenefitRewardInput {
  level: number
  type: VipBenefitRewardType
  title: string
  description?: string | null
  claimLimit?: number
  sortOrder?: number
  enabled?: boolean
  config: VipBenefitRewardConfig
}

export interface VipBenefitAmountSummary {
  balanceAmount: number
  pointsAmount: number
  instanceQuantity: number
}

export interface VipBenefitOverviewResponse {
  currentLevel: number
  userVipMetric: UserVipMetric
  userStats: {
    totalRecharge: number
    totalConsume: number
  }
  userVipBadgeStyle?: VipBadgeStyle | null
  rewards: VipBenefitReward[]
  summary: {
    totalRewards: number
    unlockedRewards: number
    claimableRewards: number
    claimedRewards: number
    lockedRewards: number
    blockedRewards: number
    pendingRewards: number
    entitlement: VipBenefitAmountSummary
    remaining: VipBenefitAmountSummary
  }
}

// API 超时配置（毫秒）
const TIMEOUT = {
  DEFAULT: 30000,           // 30秒 - 普通请求
  MEDIUM: 60000,            // 60秒 - 中等耗时操作
  LONG: 120000,             // 120秒 - 较长操作（启动/停止/重启，需等待IP获取）
  SNAPSHOT: 180000,         // 3分钟 - 快照/备份操作
  REBUILD: 300000,          // 5分钟 - 重装系统
  CLONE: 600000,            // 10分钟 - 复制实例
  BATCH: 900000,            // 15分钟 - 批量操作
}

function buildTicketFormData(
  data: CreateTicketRequest | { content: string; attachments?: File[] }
): FormData {
  const formData = new FormData()

  if ('instanceId' in data && data.instanceId !== undefined && data.instanceId !== null) {
    formData.append('instanceId', String(data.instanceId))
  }
  if ('subject' in data) {
    formData.append('subject', data.subject)
  }
  if ('category' in data && data.category) {
    formData.append('category', data.category)
  }
  if ('priority' in data && data.priority) {
    formData.append('priority', data.priority)
  }

  formData.append('content', data.content ?? '')

  for (const file of data.attachments || []) {
    formData.append('images', file)
  }

  return formData
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// 创建 axios 实例
const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: TIMEOUT.DEFAULT,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 刷新 token 的锁，防止多个请求同时触发刷新
let isRefreshing = false
let failedQueue: Array<{
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
}> = []
// 记录最后一次刷新尝试的时间，避免过于频繁的刷新
let lastRefreshAttempt = 0
const MIN_REFRESH_INTERVAL = 5000 // 5秒内最多刷新一次
// 记录认证失败的时间，防止在短时间内重复清除状态
let lastAuthFailureTime = 0
const AUTH_FAILURE_COOLDOWN = 10000 // 10秒内最多清除一次认证状态

// 处理队列中的请求
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

/**
 * 解析 JWT token，获取过期时间
 */
function parseJWT(token: string): { exp?: number; iat?: number } | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(jsonPayload)
  } catch {
    return null
  }
}

/**
 * 检查 token 是否即将过期（简化版：剩余时间少于 1 天）
 */
function isTokenExpiringSoon(token: string): boolean {
  const decoded = parseJWT(token)
  if (!decoded || !decoded.exp) {
    return false
  }
  const exp = decoded.exp * 1000 // 转换为毫秒
  const now = Date.now()
  const timeUntilExpiry = exp - now
  // 简化版：如果剩余时间少于 1 天，则认为即将过期
  return timeUntilExpiry < 24 * 60 * 60 * 1000
}

/**
 * 主动刷新 token（在 token 即将过期前）
 */
async function proactiveRefreshToken(): Promise<string | null> {
  if (isRefreshing) {
    // 如果正在刷新，等待刷新完成
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject })
    }).then(token => token as string | null).catch(() => null)
  }

  // 检查刷新频率，避免过于频繁
  const now = Date.now()
  if (now - lastRefreshAttempt < MIN_REFRESH_INTERVAL) {
    // 最近刚刷新过，直接返回 null，使用当前 token
    return null
  }

  isRefreshing = true
  lastRefreshAttempt = now

  try {
    const refreshResponse = await fetch(buildApiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include', // 重要：发送 Cookie（包含 refreshToken）
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!refreshResponse.ok) {
      // 如果是 401 或 400，说明 refreshToken 也失效了，需要重新登录
      // 400 通常表示 refresh token 无效、过期或格式错误
      if (refreshResponse.status === 401 || refreshResponse.status === 400) {
        throw new Error('REFRESH_TOKEN_INVALID')
      }
      throw new Error(`Refresh token failed: ${refreshResponse.status}`)
    }

    const refreshData = await refreshResponse.json()
    const newToken = refreshData?.token
    if (newToken) {
      localStorage.setItem('token', newToken)
      // 同步更新 auth store 中的 token
      try {
        const authStore = useAuthStore()
        authStore.syncToken()
      } catch {
        // 如果 store 未初始化，忽略
      }
      processQueue(null, newToken)
      return newToken
    } else {
      throw new Error('No token in refresh response')
    }
  } catch (refreshError: any) {
    processQueue(refreshError, null)
    // 如果是 refreshToken 失效，需要清除并跳转登录
    if (refreshError?.message === 'REFRESH_TOKEN_INVALID') {
      localStorage.removeItem('token')
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login'
      }
      return null
    }
    // 其他错误（如网络错误）不立即跳转登录页，让响应拦截器处理
    // 这样可以避免因为临时网络问题导致用户被退出
    console.warn('Proactive token refresh failed:', refreshError)
    return null
  } finally {
    isRefreshing = false
  }
}

// 请求拦截器 - 添加 token 并检查是否需要刷新
http.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('token')
    if (token) {
      // 检查 token 是否即将过期，如果是则先刷新
      if (isTokenExpiringSoon(token)) {
        const newToken = await proactiveRefreshToken()
        if (newToken) {
          token = newToken
        }
        // 如果刷新失败，继续使用旧 token，让响应拦截器处理 401
      }
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器 - 处理错误和自动刷新 token
http.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const responseData = error.response?.data
    const requestUrl = error.config?.url || ''
    const originalRequest = error.config

    // 401 未授权，尝试刷新 token
    if (error.response?.status === 401) {
      // 排除登录、注册、刷新和check-2fa接口本身
      const isAuthEndpoint = requestUrl.startsWith('/auth/login') ||
        requestUrl.startsWith('/auth/register') ||
        requestUrl.startsWith('/auth/refresh') ||
        requestUrl.startsWith('/auth/check-2fa')

      // 如果是认证相关接口的 401，不尝试刷新，直接返回错误
      if (isAuthEndpoint) {
        // 创建带有错误码的错误对象
        const apiError = {
          message: responseData?.error || 'Unauthorized',
          code: responseData?.code || null,
          details: responseData?.details || null
        }
        return Promise.reject(apiError)
      }

      // 如果已经重试过，说明刷新也失败了，清除所有认证状态并跳转登录页
      if (originalRequest?._retry) {
        const now = Date.now()
        // 防止在短时间内重复清除状态和跳转
        if (now - lastAuthFailureTime > AUTH_FAILURE_COOLDOWN) {
          lastAuthFailureTime = now
          // 清除 auth store 状态
          try {
            const authStore = useAuthStore()
            authStore.clearLocalAuth()
          } catch {
            // 如果 store 未初始化，只清除 localStorage
            localStorage.removeItem('token')
          }
          if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
            window.location.href = '/login'
          }
        }
        return Promise.reject(error)
      }

      // 如果正在刷新，将请求加入队列
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(token => {
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`
          }
          return http(originalRequest)
        }).catch(err => {
          return Promise.reject(err)
        })
      }

      // 检查刷新频率，避免过于频繁
      const now = Date.now()
      if (now - lastRefreshAttempt < MIN_REFRESH_INTERVAL && lastRefreshAttempt > 0) {
        // 最近刚刷新过，可能是网络问题，等待一下再重试原请求
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (originalRequest) {
          return http(originalRequest)
        }
        return Promise.reject(error)
      }

      // 标记正在刷新，防止重复刷新
      if (originalRequest) {
        originalRequest._retry = true
      }
      isRefreshing = true
      lastRefreshAttempt = now

      try {
        // 尝试刷新 token（使用 fetch API，避免触发拦截器循环）
        const refreshResponse = await fetch(buildApiUrl('/auth/refresh'), {
          method: 'POST',
          credentials: 'include', // 重要：发送 Cookie（包含 refreshToken）
          headers: {
            'Content-Type': 'application/json'
          }
        })

        if (!refreshResponse.ok) {
          // 如果是 401 或 400，说明 refreshToken 也失效了，需要重新登录
          // 400 通常表示 refresh token 无效、过期或格式错误
          if (refreshResponse.status === 401 || refreshResponse.status === 400) {
            throw new Error('REFRESH_TOKEN_INVALID')
          }
          throw new Error(`Refresh token failed: ${refreshResponse.status}`)
        }

        const refreshData = await refreshResponse.json()
        const newToken = refreshData?.token
        if (newToken) {
          // 更新 localStorage 中的 token
          localStorage.setItem('token', newToken)
          // 同步更新 auth store 中的 token
          try {
            const authStore = useAuthStore()
            authStore.syncToken()
          } catch {
            // 如果 store 未初始化，忽略
          }
          // 处理队列中的请求
          processQueue(null, newToken)
          // 更新请求头并重试原请求
          if (originalRequest) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            return http(originalRequest)
          }
          return Promise.reject(error)
        } else {
          throw new Error('No token in refresh response')
        }
      } catch (refreshError: any) {
        // 刷新失败，根据错误类型决定是否跳转登录
        processQueue(refreshError, null)
        
        // 如果是 refreshToken 失效（401 或 400），清除所有认证状态并跳转到登录页
        // 400 通常表示 refresh token 无效、过期或格式错误
        if (refreshError?.message === 'REFRESH_TOKEN_INVALID' || 
            (refreshError?.response?.status === 401) ||
            (refreshError?.response?.status === 400)) {
          const now = Date.now()
          // 防止在短时间内重复清除状态和跳转
          if (now - lastAuthFailureTime > AUTH_FAILURE_COOLDOWN) {
            lastAuthFailureTime = now
            // 清除 auth store 状态
            try {
              const authStore = useAuthStore()
              authStore.clearLocalAuth()
            } catch {
              // 如果 store 未初始化，只清除 localStorage
              localStorage.removeItem('token')
            }
            if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
              window.location.href = '/login'
            }
          }
        } else {
          // 其他错误（如网络错误），不立即跳转，记录日志
          console.warn('Token refresh failed, but not invalidating session:', refreshError)
        }
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // 创建带有错误码的错误对象，用于前端翻译
    // 保留原始响应数据中的额外字段（如 conflicts, availableCount 等）
    const apiError = {
      message: responseData?.error || responseData?.message || 'Request failed',
      code: responseData?.code || null,
      details: responseData?.details || null,
      ...responseData  // 保留原始响应中的所有字段
    }

    return Promise.reject(apiError)
  }
)

// API 模块
const api = {
  // 认证
  auth: {
    check2FA: (username: string): Promise<{ requires2FA: boolean }> =>
      http.post('/auth/check-2fa', { username }),
    login: (username: string, password: string, totpCode?: string, recoveryCode?: string, turnstileToken?: string): Promise<LoginResponse> =>
      http.post('/auth/login', { username, password, totpCode, recoveryCode, turnstileToken } as LoginRequest & { totpCode?: string; recoveryCode?: string; turnstileToken?: string }),
    register: (data: RegisterRequest & { emailCode?: string }): Promise<RegisterResponse> =>
      http.post('/auth/register', data),
    sendVerificationCode: (email: string, turnstileToken?: string): Promise<{ message: string; expiresAt: string }> =>
      http.post('/auth/send-verification-code', { email, turnstileToken }),
    sendForgotPasswordCode: (email: string, turnstileToken?: string): Promise<{ message: string; expiresAt: string }> =>
      http.post('/auth/forgot-password/send-code', { email, turnstileToken }),
    resetPassword: (email: string, code: string, password: string, turnstileToken?: string): Promise<{ message: string; twoFactorDisabled: boolean }> =>
      http.post('/auth/forgot-password/reset', { email, code, password, turnstileToken }),
    me: (): Promise<{ user: User }> => http.get('/auth/me'),
    logout: (): Promise<void> => http.post('/auth/logout'),
    generateInvite: (data: GenerateInviteRequest = {}): Promise<{ code: string; codes?: string[]; count?: number; expiresAt?: string; url?: string }> =>
      http.post('/auth/invite', data),
    getInvites: (params: { page?: number; pageSize?: number; status?: 'used' | 'unused' } = {}): Promise<InviteListResponse> =>
      http.get('/auth/invites', { params }),
    deleteInvite: (id: number): Promise<void> => http.delete(`/auth/invites/${id}`),
    // 双因素认证
    get2FAStatus: (): Promise<{ enabled: boolean }> => http.get('/auth/2fa/status'),
    setup2FA: (): Promise<{ secret: string; qrCode: string; recoveryCodes: string[] }> =>
      http.post('/auth/2fa/setup'),
    enable2FA: (code: string): Promise<{ message: string }> =>
      http.post('/auth/2fa/enable', { code }),
    disable2FA: (password: string, code: string): Promise<{ message: string }> =>
      http.post('/auth/2fa/disable', { password, code }),
    getRecoveryCodes: (): Promise<{ total: number; remaining: number; used: number }> =>
      http.get('/auth/2fa/recovery-codes'),
    regenerateRecoveryCodes: (password: string, code: string): Promise<{ recoveryCodes: string[] }> =>
      http.post('/auth/2fa/regenerate-recovery-codes', { password, code }),
    // 登录历史
    getLoginHistory: (params?: { page?: number; pageSize?: number }): Promise<{
      records: Array<{
        id: number
        ip: string
        country: string | null
        region: string | null
        city: string | null
        isp: string | null
        timezone: string | null
        userAgent: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/auth/login-history', { params })
  },

  userInvites: {
    summary: (): Promise<UserInviteSummary> => http.get('/user-invites/summary'),
    list: (params: { page?: number; pageSize?: number } = {}): Promise<{
      invites: UserInvite[]
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/user-invites', { params }),
    generate: (data: { costResource: string; count?: number }): Promise<{
      invites: UserInvite[]
      count: number
    }> => http.post('/user-invites', data)
  },

  // 用户管理
  users: {
    list: (params: Record<string, unknown> = {}): Promise<PaginatedResponse<User>> =>
      http.get('/users', { params }),
    get: (id: number): Promise<User> => http.get(`/users/${id}`),
    update: (id: number, data: UpdateUserRequest): Promise<UpdateUserResponse> =>
      http.patch(`/users/${id}`, data),
    sendChangeEmailCode: (id: number, email: string): Promise<{ message: string; expiresAt: string }> =>
      http.post(`/users/${id}/change-email/send-code`, { email }),
    increaseQuota: (quota: { hostLimit?: number; friendLimit?: number }): Promise<{ message: string }> =>
      http.post('/users/me/quota/increase', quota),
    updateRole: (id: number, role: 'admin' | 'user'): Promise<{ message: string; role: 'admin' | 'user'; revokedSessions?: number }> =>
      http.patch(`/users/${id}/role`, { role }),
    updateStatus: (id: number, status: 'active' | 'banned', reason?: string): Promise<User> =>
      http.patch(`/users/${id}/status`, { status, reason }),
    recalculateQuota: (id: number): Promise<UserQuota> =>
      http.post(`/users/${id}/quota/recalculate`),
    delete: (id: number): Promise<void> => http.delete(`/users/${id}`),
    // 管理员重置用户密码
    resetPassword: (id: number, password: string): Promise<{ message: string; username: string }> =>
      http.post(`/users/${id}/reset-password`, { password }),
    // 管理员取消用户 2FA
    disable2FA: (id: number): Promise<{ message: string }> =>
      http.post(`/users/${id}/disable-2fa`),
    // 管理员解绑用户 OAuth
    unbindOAuth: (userId: number, provider: 'github' | 'google'): Promise<{ message: string }> =>
      http.delete(`/users/${userId}/oauth/${provider}`),
    // 管理员获取用户登录记录
    getLoginRecords: (userId: number, params: { page?: number; pageSize?: number } = {}): Promise<{
      records: Array<{
        id: number
        ip: string
        country: string | null
        region: string | null
        city: string | null
        isp: string | null
        timezone: string | null
        userAgent: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get(`/users/${userId}/login-records`, { params }),
    // 管理员检测关联账号
    detectLinkedAccounts: (days: number = 90): Promise<{
      detectedAt: string
      durationMs: number
      days: number
      summary: {
        ipGroups: number
        emailGroups: number
        usernameGroups: number
      }
      ipGroups: Array<{
        ip: string
        userCount: number
        totalLogins: number
        users: Array<{
          id: number
          username: string
          email: string | null
          status: string
          loginCount: number
          lastLogin: string
        }>
      }>
      emailGroups: Array<{
        pattern: string
        userCount: number
        users: Array<{
          id: number
          username: string
          email: string
          status: string
          createdAt: string
        }>
      }>
      usernameGroups: Array<{
        pattern: string
        userCount: number
        users: Array<{
          id: number
          username: string
          email: string | null
          status: string
          createdAt: string
        }>
      }>
    }> => http.get('/users/detect-linked-accounts', { params: { days } })
  },

  // 终端快捷命令
  terminalSavedCommands: {
    list: (): Promise<{ commands: TerminalSavedCommand[] }> =>
      http.get('/terminal-saved-commands'),
    create: (data: CreateTerminalSavedCommandRequest): Promise<{ message: string; command: TerminalSavedCommand }> =>
      http.post('/terminal-saved-commands', data),
    update: (id: number, data: UpdateTerminalSavedCommandRequest): Promise<{ message: string; command: TerminalSavedCommand }> =>
      http.put(`/terminal-saved-commands/${id}`, data),
    delete: (id: number): Promise<{ message: string }> =>
      http.delete(`/terminal-saved-commands/${id}`)
  },

  // 实例管理
  instances: {
    list: (params: Record<string, unknown> = {}): Promise<PaginatedResponse<InstanceWithDetails> & { availableCountries?: string[] }> =>
      http.get('/instances', { params }),
    get: (id: number): Promise<InstanceWithDetails> => http.get(`/instances/${id}`),
    getPassword: (id: number): Promise<{ rootPassword: string | null }> => http.get(`/instances/${id}/password`),
    getStats: (id: number): Promise<InstanceStats & { status?: string }> => http.get(`/instances/${id}/stats`),
    create: (data: CreateInstanceRequest): Promise<Instance> => http.post('/instances', data),
    getAvailableHosts: (params: Record<string, unknown> = {}): Promise<AvailableHost[]> =>
      http.get('/instances/available-hosts', { params }),
    getChangeHostOptions: (id: number): Promise<ChangeHostOptionsResponse> =>
      http.get(`/instances/${id}/change-host-options`),
    changeHost: (id: number, data: { targetHostId: number; sshKeyId: number }): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/change-host`, data),
    createTerminalTicket: (id: number): Promise<{ ticket: string; expiresIn: number }> =>
      http.post(`/ws/instances/${id}/terminal-ticket`, {}),
    updateOrder: (id: number, action: 'top' | 'up' | 'down' | 'bottom'): Promise<{ message: string; updated: number }> =>
      http.patch(`/instances/${id}/order`, { action }),
    delete: (id: number, reason?: string): Promise<{ message: string; refundAmount?: number }> =>
      http.delete(`/instances/${id}`, { data: reason ? { reason } : {}, timeout: TIMEOUT.LONG }),
    // 实例操作任务（异步模式）
    start: (id: number): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/start`, {}),
    stop: (id: number): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/stop`, {}),
    restart: (id: number): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/restart`, {}),
    // 获取实例的活跃任务
    getActiveTask: (id: number): Promise<{
      task: {
        id: number
        taskType: string
        status: string
        progress?: string | null
        error?: string | null
        queuePosition: number
        createdAt: string
        startedAt?: string | null
        finishedAt?: string | null
      } | null
    }> => http.get(`/instances/${id}/task`),
    // 获取任务详情
    getTaskById: (taskId: number): Promise<{
      task: {
        id: number
        instanceId: number
        instanceName?: string | null
        taskType: string
        status: string
        progress?: string | null
        error?: string | null
        queuePosition: number
        createdAt: string
        startedAt?: string | null
        finishedAt?: string | null
        newInstanceId?: number | null
      }
    }> => http.get(`/instances/tasks/${taskId}`),
    rebuild: (id: number, data: { image: string; sshKeyId?: number; customInitCommandIds?: number[] }): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/rebuild`, data),
    recreate: (id: number, data: { image: string; sshKeyId?: number; customInitCommandIds?: number[] }): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/recreate`, data),
    addPort: (id: number, data: CreatePortMappingRequest): Promise<PortMapping> =>
      http.post(`/instances/${id}/ports`, data),
    addPortBatch: (id: number, data: {
      protocol: 'tcp' | 'udp' | 'both'
      privatePortStart: number
      privatePortEnd: number
      publicPortStart?: number
      publicPortEnd?: number
      remark?: string
      portMappings?: Array<{ privatePort: number; publicPort: number }>
    }): Promise<{
      message: string
      mappings: Array<{ id: number; protocol: string; publicPort: number; privatePort: number }>
      count: number
    } | {
      error: string
      message: string
      conflicts: Array<{ publicPort: number; suggestedPort: number | null }>
      availableCount: number
    }> => http.post(`/instances/${id}/ports/batch`, data),
    deletePort: (id: number, portId: number): Promise<void> =>
      http.delete(`/instances/${id}/ports/${portId}`),
    // 快照
    getSnapshots: (id: number): Promise<Snapshot[]> => http.get(`/instances/${id}/snapshots`),
    createSnapshot: (id: number, data: CreateSnapshotRequest): Promise<Snapshot> =>
      http.post(`/instances/${id}/snapshots`, data, { timeout: TIMEOUT.SNAPSHOT }),
    deleteSnapshot: (id: number, snapshotId: number): Promise<void> =>
      http.delete(`/instances/${id}/snapshots/${snapshotId}`, { timeout: TIMEOUT.MEDIUM }),
    restoreSnapshot: (id: number, snapshotId: number): Promise<void> =>
      http.post(`/instances/${id}/snapshots/${snapshotId}/restore`, {}, { timeout: TIMEOUT.SNAPSHOT }),
    getSnapshotPolicy: (id: number): Promise<SnapshotPolicy> =>
      http.get(`/instances/${id}/snapshot-policy`),
    updateSnapshotPolicy: (id: number, data: UpdateSnapshotPolicyRequest): Promise<SnapshotPolicy> =>
      http.put(`/instances/${id}/snapshot-policy`, data),
    // 备份
    getBackups: (id: number): Promise<Backup[]> => http.get(`/instances/${id}/backups`),
    createBackup: (id: number, data: CreateBackupRequest): Promise<Backup> =>
      http.post(`/instances/${id}/backups`, data, { timeout: TIMEOUT.SNAPSHOT }),
    deleteBackup: (id: number, backupId: number): Promise<void> =>
      http.delete(`/instances/${id}/backups/${backupId}`, { timeout: TIMEOUT.MEDIUM }),
    getBackupPolicy: (id: number): Promise<BackupPolicy> =>
      http.get(`/instances/${id}/backup-policy`),
    updateBackupPolicy: (id: number, data: UpdateBackupPolicyRequest): Promise<BackupPolicy> =>
      http.put(`/instances/${id}/backup-policy`, data),
    // 备份导出
    exportBackup: (id: number, backupId: number): Promise<{ taskId: string; status: string; expiresAt: string; downloadUrl: string }> =>
      http.post(`/instances/${id}/backups/${backupId}/export`, {}),
    getExportStatus: (id: number, taskId: string): Promise<{ taskId: string; status: string; error?: string; expiresAt: string }> =>
      http.get(`/instances/${id}/backups/export/${taskId}/status`),
    // 获取一次性下载 token（安全改进：使用短期 token 替代 JWT URL 参数）
    getDownloadToken: (id: number, taskId: string): Promise<{ downloadUrl: string; expiresIn: number }> =>
      http.post(`/instances/${id}/backups/export/${taskId}/download-token`, {}),
    // 已废弃：直接获取下载 URL（不安全，保留用于向后兼容）
    // @deprecated 使用 getDownloadToken 替代
    getExportDownloadUrl: (id: number, taskId: string): string =>
      buildApiUrl(`/instances/${id}/backups/export/${taskId}/download`),
    // 备份恢复
    restoreBackup: (id: number, backupId: number): Promise<{ taskId: string; status: string; message: string }> =>
      http.post(`/instances/${id}/restore/${backupId}`, {}, { timeout: TIMEOUT.SNAPSHOT }),
    getRestoreStatus: (id: number, taskId: string): Promise<{
      taskId: string
      status: string
      error?: string
      queuePosition: number
      duration: number | null
      createdAt: string
      startedAt: string | null
      finishedAt: string | null
    }> =>
      http.get(`/instances/${id}/restore/${taskId}`),
    rollbackRestore: (id: number, taskId: string): Promise<{ success: boolean; message: string }> =>
      http.post(`/instances/${id}/restore/${taskId}/rollback`, {}, { timeout: TIMEOUT.SNAPSHOT }),
    // 备份上传到远程存储
    uploadBackupRemote: (id: number, backupId: number, storageConfigId?: number): Promise<{
      taskId: number
      status: string
      queuePosition: number
      storageName: string
      message: string
    }> => http.post(`/instances/${id}/backups/${backupId}/upload-remote`, { storageConfigId }),
    getUploadTaskStatus: (id: number, taskId: number): Promise<{
      taskId: number
      status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
      error?: string
      remoteFileName?: string
      fileSize?: string
      storageName?: string
      storageType?: string
      queuePosition: number
      duration: number | null
      createdAt: string
      startedAt: string | null
      finishedAt: string | null
    }> => http.get(`/instances/${id}/upload-tasks/${taskId}`),
    cancelUploadTask: (id: number, taskId: number): Promise<{ success: boolean; message: string }> =>
      http.delete(`/instances/${id}/upload-tasks/${taskId}`),
    getActiveUploadTask: (id: number): Promise<{
      task: {
        taskId: number
        backupId: number
        status: 'PENDING' | 'PROCESSING'
        storageName?: string
        storageType?: string
        queuePosition: number
        duration: number | null
        createdAt: string
        startedAt: string | null
        finishedAt: string | null
      } | null
    }> => http.get(`/instances/${id}/upload-tasks/active`),
    // 配额
    updateQuota: (id: number, data: UpdateInstanceRequest): Promise<Instance> =>
      http.patch(`/instances/${id}/quota`, data),
    // 重命名
    rename: (id: number, name: string): Promise<{ message: string; name: string }> =>
      http.patch(`/instances/${id}/rename`, { name }),
    // 更新配置（CPU、内存、磁盘）
    updateConfig: (id: number, data: { cpu?: number; memory?: number; disk?: number; monthlyTrafficLimit?: string | null }): Promise<{
      message: string
      instance: { id: number; cpu: number; memory: number; disk: number }
    }> => http.patch(`/instances/${id}/config`, data),
    // 复制实例
    clone: (id: number): Promise<{ message: string; taskId: number; status: string }> =>
      http.post(`/instances/${id}/clone`, {}),
    // 实例配置
    getConfig: (id: number): Promise<{
      config: {
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
      overrides: Record<string, boolean>
      packageDefaults: {
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
      ioLimitMode: 'throughput' | 'iops'
      swap: {
        available: boolean
        enabled: boolean
        sizeMb: number
        kind: 'container' | 'vm'
        requiresRunning: boolean
      }
    }> => http.get(`/instances/${id}/config`),
    enableSwap: (id: number): Promise<{ message: string; swapEnabled: boolean; swapSize: number }> =>
      http.post(`/instances/${id}/swap/enable`, {}),
    disableSwap: (id: number): Promise<{ message: string; swapEnabled: boolean; swapSize: number }> =>
      http.post(`/instances/${id}/swap/disable`, {}),
    updateInstanceConfig: (id: number, data: {
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
    }): Promise<{ message: string }> => http.patch(`/instances/${id}/advanced-config`, data),
    // 提升进程数限制
    boostProcesses: (id: number): Promise<{ message: string; newLimit: number }> =>
      http.post(`/instances/${id}/boost-processes`, {}),
    // IP 地址管理
    getIpAddresses: (id: number): Promise<{ ipAddresses: IpAddress[] }> =>
      http.get(`/instances/${id}/ips`),
    addIpAddress: (id: number, customAddress?: string): Promise<{ success: boolean; ipAddress: IpAddress }> =>
      http.post(`/instances/${id}/ips`, customAddress ? { customAddress } : {}, { timeout: TIMEOUT.MEDIUM }),
    deleteIpAddress: (id: number, ipId: number): Promise<{ success: boolean }> =>
      http.delete(`/instances/${id}/ips/${ipId}`, { timeout: TIMEOUT.MEDIUM }),
    // IPv6 地址管理 (新双网卡架构)
    setCustomIpv6: (id: number, ipId: number, address: string): Promise<{ success: boolean; ipAddress: IpAddress }> =>
      http.put(`/instances/${id}/ips/${ipId}/custom`, { address }, { timeout: TIMEOUT.MEDIUM }),
    // IPv6 网段管理
    getIpv6Subnets: (id: number): Promise<{ subnets: Ipv6Subnet[] }> =>
      http.get(`/instances/${id}/subnets`),
    allocateIpv6Subnet: (id: number, prefix: 112 | 120 | 124): Promise<{ success: boolean; subnet: Ipv6Subnet }> =>
      http.post(`/instances/${id}/subnet`, { prefix }, { timeout: TIMEOUT.MEDIUM }),
    deleteIpv6Subnet: (id: number, subnetId: number): Promise<{ success: boolean }> =>
      http.delete(`/instances/${id}/subnet/${subnetId}`, { timeout: TIMEOUT.MEDIUM }),
    // 站点管理
    getSites: (id: number): Promise<{
      sites: Array<{
        id: number
        domain: string
        targetPort: number
        httpsEnabled: boolean
        remark: string | null
        status: 'pending' | 'active' | 'error'
        enabled: boolean
        error: string | null
        createdAt: string
      }>
      caddyEnabled: boolean
      dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
      dnsRecordValue: string | null
      siteQuota: {
        used: number
        limit: number  // 0 = 不限制
      }
      canManageSites?: boolean
    }> => http.get(`/instances/${id}/sites`),
    addSite: (id: number, data: { domain: string; targetPort: number; httpsEnabled?: boolean; remark?: string }): Promise<{
      success: boolean
      site: { id: number; domain: string; targetPort: number; httpsEnabled: boolean; status: string }
      dnsHint: {
        type: 'A' | 'AAAA' | 'CNAME'
        host: string
        value: string
      }
    }> => http.post(`/instances/${id}/sites`, data),
    deleteSite: (id: number, siteId: number): Promise<{ success: boolean }> =>
      http.delete(`/instances/${id}/sites/${siteId}`),
    updateSite: (id: number, siteId: number, data: { targetPort?: number; httpsEnabled?: boolean; remark?: string }): Promise<{
      message: string
      site: { id: number; domain: string; targetPort: number; httpsEnabled: boolean; remark: string | null; status: string }
    }> => http.patch(`/instances/${id}/sites/${siteId}`, data),
    refreshSite: (id: number, siteId: number): Promise<{ success: boolean; status: string }> =>
      http.post(`/instances/${id}/sites/${siteId}/refresh`),
    checkDns: (id: number, siteId: number): Promise<{
      dnsResolved: boolean
      ipMatches?: boolean
      expectedIp: string
      resolvedIps: string[]
      activated?: boolean
      status: string
      error?: string
      message?: string
    }> => http.post(`/instances/${id}/sites/${siteId}/check-dns`),
    toggleSite: (id: number, siteId: number): Promise<{ message: string; enabled: boolean; status: string }> =>
      http.post(`/instances/${id}/sites/${siteId}/toggle`),
    getCertificateStatus: (id: number, siteId: number): Promise<{
      httpsEnabled: boolean
      status: 'disabled' | 'valid' | 'pending' | 'dns_error' | 'connection_refused' | 'timeout' | 'cert_pending' | 'error'
      message?: string
      error?: string
      hint?: string
      certificate?: {
        valid: boolean
        issuer: string
        subject: string
        validFrom: string
        validTo: string
        daysRemaining: number
      }
    }> => http.get(`/instances/${id}/sites/${siteId}/certificate`),
    // Cloud-init 状态检查
    checkCloudInitStatus: (id: number): Promise<import('@/types/api').CloudInitStatusResponse> =>
      http.get(`/instances/${id}/cloud-init-status`),
    manualCompleteCloudInit: (id: number): Promise<import('@/types/api').CloudInitStatusResponse> =>
      http.post(`/instances/${id}/cloud-init-status/manual-complete`, {}),
    // 封停/解封实例（仅宿主机所有者和管理员）
    suspend: (id: number, reason?: string): Promise<{ message: string }> =>
      http.post(`/instances/${id}/suspend`, { reason }),
    unsuspend: (id: number): Promise<{ message: string }> =>
      http.post(`/instances/${id}/unsuspend`, {}),
    // 同步实例状态（从 Incus 获取实际状态并更新数据库）
    syncStatus: (id: number): Promise<{
      success: boolean
      statusChanged: boolean
      from?: string
      to?: string
      currentStatus: string
      ipv4Changed?: boolean
      oldIpv4?: string
      newIpv4?: string
      proxySitesUpdated?: number
    }> => http.post(`/instances/${id}/sync-status`, {}),
    // 重新分配 IPv6 地址（仅 nat_ipv6 模式）
    reassignIpv6: (id: number): Promise<{ message: string; oldIpv6: string | null; newIpv6: string }> =>
      http.post(`/instances/${id}/reassign-ipv6`, {})
  },

  // SSH 密钥
  sshKeys: {
    list: (): Promise<{ keys: SshKey[] }> => http.get('/ssh-keys'),
    create: (data: CreateSshKeyRequest): Promise<{ message: string; key: SshKey }> => http.post('/ssh-keys', data),
    delete: (id: number): Promise<{ message: string }> => http.delete(`/ssh-keys/${id}`),
    generate: (): Promise<{ message: string; privateKey: string; key: { id: number; name: string; fingerprint: string; publicKeyPreview: string } }> =>
      http.post('/ssh-keys/generate')
  },

  // 通知管理
  notifications: {
    list: (): Promise<{ channels: NotificationChannel[] }> => http.get('/notifications'),
    get: (id: number): Promise<NotificationChannel> => http.get(`/notifications/${id}`),
    create: (data: CreateNotificationChannelRequest): Promise<NotificationChannel> =>
      http.post('/notifications', data),
    update: (id: number, data: UpdateNotificationChannelRequest): Promise<NotificationChannel> =>
      http.patch(`/notifications/${id}`, data),
    delete: (id: number): Promise<void> => http.delete(`/notifications/${id}`),
    test: (id: number): Promise<void> => http.post(`/notifications/${id}/test`),
    toggle: (id: number): Promise<NotificationChannel> => http.post(`/notifications/${id}/toggle`),
    // 通知历史
    getLogs: (params: { page?: number; pageSize?: number; status?: 'pending' | 'sent' | 'failed' } = {}): Promise<{
      logs: Array<{
        id: number
        channelId: number
        channelName: string
        channelType: string
        eventType: string
        message: string
        status: string
        error: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/notifications/logs', { params }),
    getStats: (): Promise<{
      stats: {
        total: number
        sent: number
        failed: number
        pending: number
      }
    }> => http.get('/notifications/stats'),
    // 获取管理员创建的全局通知渠道（供托管用户绑定套餐使用）
    getGlobalChannels: (): Promise<{
      channels: Array<{ id: number; name: string; type: string; configPreview: string }>
    }> => http.get('/notifications/global-channels')
  },

  // Telegram 专用机器人绑定
  telegram: {
    getBinding: (): Promise<TelegramBindingStatus> => http.get('/telegram/binding'),
    createBindToken: (): Promise<TelegramBindTokenResponse> => http.post('/telegram/bind-token'),
    unlink: (): Promise<{ message: string }> => http.delete('/telegram/binding'),
    getWebhookInfo: (): Promise<TelegramWebhookInfoResponse> => http.get('/telegram/admin/webhook/info'),
    setupWebhook: (data: { baseUrl?: string } = {}): Promise<TelegramWebhookSetupResponse> =>
      http.post('/telegram/admin/webhook/setup', data),
    deleteWebhook: (): Promise<TelegramWebhookDeleteResponse> =>
      http.post('/telegram/admin/webhook/delete', {}),
    listBindings: (params?: { page?: number; pageSize?: number; search?: string }): Promise<TelegramAdminBindingsResponse> =>
      http.get('/telegram/admin/bindings', { params }),
    unlinkAdminBinding: (id: number): Promise<{ message: string }> =>
      http.delete(`/telegram/admin/bindings/${id}`)
  },

  // 管理员全局通知渠道管理
  adminNotificationChannels: {
    list: (): Promise<{
      channels: Array<{ id: number; name: string; type: string; enabled: boolean; boundPackages: number; configPreview: string; createdAt: string }>
    }> => http.get('/admin/notification-channels'),
    get: (id: number): Promise<{
      channel: { id: number; name: string; type: string; enabled: boolean; config: Record<string, unknown>; createdAt: string }
    }> => http.get(`/admin/notification-channels/${id}`),
    create: (data: { name: string; botToken: string; chatId: string; enabled?: boolean }): Promise<{ message: string; channel: { id: number; name: string } }> =>
      http.post('/admin/notification-channels', data),
    update: (id: number, data: { name?: string; botToken?: string; chatId?: string; enabled?: boolean }): Promise<{ message: string }> =>
      http.patch(`/admin/notification-channels/${id}`, data),
    delete: (id: number): Promise<{ message: string }> =>
      http.delete(`/admin/notification-channels/${id}`),
    test: (id: number): Promise<{ message: string }> =>
      http.post(`/admin/notification-channels/${id}/test`)
  },

  // 主机管理
  hosts: {
    list: (params: Record<string, unknown> = {}): Promise<{ hosts: HostWithDetails[]; total: number; page: number; pageSize: number; totalPages: number }> =>
      http.get('/hosts', { params }),
    // 管理员专用：获取托管节点列表
    listHosted: (params: { userId?: number; page?: number; pageSize?: number; search?: string } = {}): Promise<{ hosts: HostWithDetails[]; total: number; page: number; pageSize: number; totalPages: number }> =>
      http.get('/hosts', { params: { ...params, scope: 'hosted' } }),
    get: (id: number): Promise<HostWithDetails> => http.get(`/hosts/${id}`),
    lookupGiftTargetUser: (hostId: number, username: string): Promise<{
      user: {
        id: number
        username: string
        status: string
        hasSshKey: boolean
      }
    }> => http.get(`/hosts/${hostId}/users/lookup`, { params: { username } }),
    getImagePolicy: (id: number): Promise<HostImagePolicy> => http.get(`/hosts/${id}/images`),
    updateImagePolicy: (id: number, data: { useDefault: boolean; imageIds?: number[] }): Promise<HostImagePolicy & { message: string }> =>
      http.put(`/hosts/${id}/images`, data),
    create: (data: CreateHostRequest): Promise<Host> => http.post('/hosts', data),
    update: (id: number, data: UpdateHostRequest): Promise<Host> =>
      http.patch(`/hosts/${id}`, data),
    delete: (id: number): Promise<void> => http.delete(`/hosts/${id}`),
    test: (id: number): Promise<{ success: boolean; message?: string }> =>
      http.post(`/hosts/${id}/test`, {}, { timeout: TIMEOUT.MEDIUM }),
    takeoverOfficial: (id: number): Promise<{
      success: boolean
      summary: {
        hostId: number
        previousOwnerId: number
        previousOwnerUsername: string
        instanceCount: number
        transferredPackageCount: number
        detachedPackageCount: number
        transferredPackageNames: string[]
        detachedPackageNames: string[]
        hostRenamed: boolean
        oldHostName: string
        newHostName: string
      }
    }> => http.post(`/hosts/${id}/takeover-official`, {}),
    verify: (id: number): Promise<{ success: boolean; message?: string; resources?: { cpuTotal: number; memoryTotalGB: number; diskTotalGB: number } }> =>
      http.post(`/hosts/${id}/verify`, {}, { timeout: TIMEOUT.MEDIUM }),
    regenerateInstall: (id: number): Promise<{ success: boolean; installCommand: string; installToken?: string; message: string }> =>
      http.post(`/hosts/${id}/regenerate-install`, {}),
    getAgentStatus: (id: number): Promise<HostAgentStatusResponse> =>
      http.get(`/agent/hosts/${id}/status`),
    generateAgentInstallCommand: (id: number): Promise<HostAgentInstallCommandResponse> =>
      http.post(`/agent/hosts/${id}/install-command`, {}),
    requestAgentUpgrade: (id: number): Promise<HostAgentUpgradeRequestResponse> =>
      http.post(`/agent/hosts/${id}/upgrade`, {}),
    sync: (id: number): Promise<void> => http.post(`/hosts/${id}/sync`, {}, { timeout: TIMEOUT.LONG }),
    setMaintenance: (id: number, enabled: boolean): Promise<Host> =>
      http.post(`/hosts/${id}/maintenance`, { enabled }),
    // 存储池管理
    getStoragePools: (id: number): Promise<{ pools: Array<{ name: string; driver: string; description: string; status: string; purpose?: 'instance_data' | 'instance_storage' | null; config: Record<string, string>; usedBy: number; space?: { used: number; total: number } | null }> }> =>
      http.get(`/hosts/${id}/storage-pools`),
    createStoragePool: (id: number, data: {
      name: string
      driver?: 'zfs' | 'lvm' | 'btrfs' | 'dir'  // 使用已有池时可不传
      source?: string
      size?: string
      zfsPoolName?: string
      lvmVgName?: string
      lvmUseThinpool?: boolean
      description?: string
      purpose?: 'instance_data' | 'instance_storage'
      useExisting?: boolean  // 使用/导入已有存储池模式
      existingSource?: string  // 底层已存在的存储源名称（如 ZFS 池名、LVM VG 名）
    }): Promise<{ success: boolean; message: string; imported?: boolean }> =>
      http.post(`/hosts/${id}/storage-pools`, data),
    deleteStoragePool: (id: number, poolName: string): Promise<{ success: boolean; message: string }> =>
      http.delete(`/hosts/${id}/storage-pools/${poolName}`),
    updateStoragePool: (id: number, poolName: string, data: {
      size?: string
      description?: string
      purpose?: 'instance_data' | 'instance_storage'
    }): Promise<{ success: boolean; message: string }> =>
      http.patch(`/hosts/${id}/storage-pools/${poolName}`, data),
    // Caddy 管理
    getCaddy: (id: number): Promise<{
      enabled: boolean
      username: string | null
      port: number
      hasPassword: boolean
      natPublicIp: string | null
      sitesCount: number
    }> => http.get(`/hosts/${id}/caddy`),
    generateCaddyCommand: (id: number): Promise<{
      installCommand: string
      username: string
      password: string
      port: number
      isNewCredentials: boolean
    }> => http.post(`/hosts/${id}/caddy/generate`),
    resetCaddyCredentials: (id: number): Promise<{
      installCommand: string
      username: string
      password: string
      port: number
    }> => http.post(`/hosts/${id}/caddy/reset`),
    confirmCaddyInstalled: (id: number): Promise<{ message: string }> =>
      http.post(`/hosts/${id}/caddy/confirm`),
    testCaddyConnection: (id: number): Promise<{
      connected: boolean
      sitesCount: number
      dnsRecordType: 'A' | 'AAAA' | 'CNAME'
      dnsRecordValue: string
    }> => http.post(`/hosts/${id}/caddy/test`, {}, { timeout: TIMEOUT.MEDIUM }),
    getCaddySites: (id: number, params: { page?: number; pageSize?: number } = {}): Promise<{
      sites: Array<{
        id: number
        domain: string
        targetPort: number
        httpsEnabled: boolean
        status: 'pending' | 'active' | 'error'
        enabled: boolean
        error: string | null
        createdAt: string
        instance: {
          id: number
          name: string
          ipv4: string | null
          status: string
        } | null
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get(`/hosts/${id}/caddy/sites`, { params }),
    // 批量删除实例预览（计算退款信息）
    batchDeleteInstancesPreview: (hostId: number, instanceIds: number[]): Promise<{
      instances: Array<{
        id: number
        name: string
        username: string
        userId: number
        isOwnInstance: boolean
        isPaid: boolean
        remainingDays: number
        refundAmount: number
      }>
      totalRefundAmount: number
    }> => http.post(`/hosts/${hostId}/instances/batch-delete-preview`, { instanceIds }),
    // 批量删除实例
    batchDeleteInstances: (hostId: number, instanceIds: number[], reason?: string, databaseOnly?: boolean): Promise<{
      message: string
      results: Array<{ id: number; name: string; success: boolean; error?: string; refundAmount?: number }>
      successCount: number
      failedCount: number
      totalRefundAmount: number
    }> => http.delete(`/hosts/${hostId}/instances/batch`, { data: { instanceIds, reason, databaseOnly }, timeout: TIMEOUT.BATCH }),
    // 批量赠送时长
    giftDays: (hostId: number, instanceIds: number[], days: number): Promise<{
      message: string
      results: Array<{ instanceId: number; instanceName: string; success: boolean; error?: string; newExpiresAt?: string }>
      successCount: number
      failedCount: number
      skippedCount: number
    }> => http.post(`/hosts/${hostId}/instances/gift-days`, { instanceIds, days }),
    createInstanceForUser: (hostId: number, data: {
      username: string
      name: string
      packageId: number
      image: string
      cpu?: number
      memory?: number
      disk?: number
      planId?: number
      giftDays?: number
    }): Promise<{
      message: string
      instance: {
        id: number
        name: string
        incusId: string
        host: string
        status: string
        user: { id: number; username: string }
        isPaid: boolean
        planName: string | null
        charged: boolean
        amount: number
        expiresAt: string | null
        giftDays?: number | null
      }
    }> => http.post(`/hosts/${hostId}/instances/create-for-user`, data),
    // 修改付费实例的续费价格（托管节点所有者专用）
    updateInstanceRenewalPrice: (hostId: number, instanceId: number, newPrice: number): Promise<{
      message: string
      instanceId: number
      instanceName: string
      oldPrice: number
      newPrice: number
    }> => http.patch(`/hosts/${hostId}/instances/${instanceId}/renewal-price`, { newPrice }),
    // 批量同步实例状态
    batchSyncInstanceStatus: (hostId: number, instanceIds: number[]): Promise<{
      message: string
      results: Array<{ id: number; name: string; success: boolean; from?: string; to?: string; ipv4Changed?: boolean; oldIpv4?: string; newIpv4?: string; proxySitesUpdated?: number; error?: string }>
      syncedCount: number
      changedCount: number
      ipv4ChangedCount: number
      failedCount: number
    }> => http.post(`/hosts/${hostId}/instances/sync-status`, { instanceIds }, { timeout: TIMEOUT.MEDIUM }),
    // 资源校对：重新计算宿主机资源使用量，并将配额对齐到已用配额
    recalculateResources: (hostId: number): Promise<{
      message: string
      hasChanges: boolean
      before: { cpuUsed: number; memoryUsed: number; diskUsed: number; natPortsUsedCount: number; cpuAllowanceMax: number; memoryMax: number }
      after: { cpuUsed: number; memoryUsed: number; diskUsed: number; natPortsUsedCount: number; cpuAllowanceMax: number; memoryMax: number }
      diff: { cpuUsed: number; memoryUsed: number; diskUsed: number; natPortsUsedCount: number; cpuAllowanceMax: number; memoryMax: number }
    }> => http.post(`/hosts/${hostId}/recalculate-resources`),
    // 批量封停实例
    batchSuspendInstances: (hostId: number, instanceIds: number[], reason?: string): Promise<{
      message: string
      results: Array<{ id: number; name: string; success: boolean; error?: string }>
      successCount: number
      failedCount: number
    }> => http.post(`/hosts/${hostId}/instances/suspend`, { instanceIds, reason }, { timeout: TIMEOUT.BATCH }),
    // 批量解封实例
    batchUnsuspendInstances: (hostId: number, instanceIds: number[]): Promise<{
      message: string
      results: Array<{ id: number; name: string; success: boolean; error?: string }>
      successCount: number
      failedCount: number
    }> => http.post(`/hosts/${hostId}/instances/unsuspend`, { instanceIds }, { timeout: TIMEOUT.BATCH }),
    // 批量为节点下所有付费实例免费延期（仅管理员）
    batchExtendAll: (hostId: number, days: number): Promise<{
      success: boolean
      message: string
      extendedCount: number
    }> => http.post(`/hosts/${hostId}/extend-all`, { days }),
    // 批量迁移实例到其他节点（仅管理员）
    migrateInstances: (hostId: number, instanceIds: number[], targetHostId: number, targetImage: string, targetPlanId?: number): Promise<{
      message: string
      results: Array<{ id: number; name: string; success: boolean; error?: string; newInstanceId?: number }>
      successCount: number
      failedCount: number
    }> => http.post(`/hosts/${hostId}/instances/migrate`, { instanceIds, targetHostId, targetImage, targetPlanId }, { timeout: TIMEOUT.BATCH }),
    // 获取节点绑定的套餐方案（用于改节点）
    getHostPlans: (hostId: number): Promise<{
      plans: Array<{
        id: number
        name: string
        packageId: number
        packageName: string
        price: number
        billingCycle: number
      }>
    }> => http.get(`/hosts/${hostId}/plans`),
        // 批量修改实例配置
        batchUpdateConfig: (hostId: number, data: {
          instanceIds: number[]
          config: Record<string, unknown>
        }): Promise<{
          success: boolean
          totalCount: number
          successCount: number
          failedCount: number
          failedItems: Array<{
            instanceId: number
            incusId: string
            name: string
            error?: string
          }>
          retryPayload?: {
            instanceIds: number[]
            config: Record<string, unknown>
          }
        }> => http.post(`/hosts/${hostId}/instances/batch-config`, data, { timeout: TIMEOUT.BATCH }),
    // 兑换码管理
    getRedeemCodes: (hostId: number, params: { limit?: number; offset?: number; enabled?: boolean } = {}): Promise<{
      codes: Array<{
        id: number
        code: string
        codeType: 'c' | 'r' | 'd' | 't'
        codeValue: number
        maxUses: number
        usedCount: number
        expiresAt: string | null
        enabled: boolean
        remark: string | null
        batchId: string | null
        createdAt: string
      }>
      total: number
    }> => http.get(`/hosts/${hostId}/redeem-codes`, { params }),
    createRedeemCode: (hostId: number, data: {
      codeType: 'c' | 'r' | 'd' | 't'
      codeValue: number
      maxUses?: number
      expiresAt?: string | null
      remark?: string
      batchCount?: number
    }): Promise<{ message: string; code?: string; id?: number; codes?: string[]; batchId?: string; count?: number }> =>
      http.post(`/hosts/${hostId}/redeem-codes`, data),
    updateRedeemCode: (hostId: number, codeId: number, data: {
      enabled?: boolean
      remark?: string
      maxUses?: number
      expiresAt?: string | null
    }): Promise<{ message: string }> =>
      http.patch(`/hosts/${hostId}/redeem-codes/${codeId}`, data),
    deleteRedeemCode: (hostId: number, codeId: number): Promise<{ message: string }> =>
      http.delete(`/hosts/${hostId}/redeem-codes/${codeId}`),
    batchDeleteRedeemCodes: (hostId: number, ids: number[]): Promise<{ message: string; count: number }> =>
      http.post(`/hosts/${hostId}/redeem-codes/batch-delete`, { ids }),
    getRedeemCodeUsages: (hostId: number, codeId: number, params: { limit?: number; offset?: number } = {}): Promise<{
      usages: Array<{
        id: number
        user: { id: number; username: string }
        instance: { id: number; name: string }
        usedAt: string
      }>
      total: number
    }> => http.get(`/hosts/${hostId}/redeem-codes/${codeId}/usages`, { params }),
    getRedeemCodeOptions: (): Promise<{
      types: Array<{ value: string; label: string; unit: string }>
      ranges: Record<string, { min: number; max: number; unit: string }>
    }> => http.get('/redeem-code-options'),
    opsDiscover: (hostId: number): Promise<{
      managed: Array<{ incusName: string; incusType: string; incusStatus: string; dbId: number; dbStatus: string; userId: number }>
      orphaned: Array<{ incusName: string; incusType: string; incusStatus: string }>
      missing: Array<{ dbId: number; dbName: string; incusId: string; dbStatus: string }>
      summary: {
        totalIncus: number
        totalDb: number
        managedCount: number
        orphanedCount: number
        missingCount: number
      }
    }> => http.post(`/hosts/${hostId}/ops/discover`),
    opsBaselineSync: (hostId: number): Promise<{
      message: string
      resources: {
        cpuUsed: number
        memoryUsed: number
        diskUsed: number
      }
      instanceSync: {
        total: number
        synced: number
        ipChanged: number
      }
    }> => http.post(`/hosts/${hostId}/ops/baseline-sync`),
    opsNetworkRepair: (hostId: number): Promise<{
      message: string
      results: Array<{
        id: number
        name: string
        success: boolean
        statusChanged?: boolean
        oldStatus?: string
        newStatus?: string
        ipv4Changed?: boolean
        oldIpv4?: string | null
        newIpv4?: string | null
        ipv6Changed?: boolean
        oldIpv6?: string | null
        newIpv6?: string | null
        error?: string
      }>
      summary: {
        total: number
        success: number
        failed: number
        changed: number
      }
    }> => http.post(`/hosts/${hostId}/ops/network-repair`),
    opsInstanceSshKeys: (hostId: number, instanceId: number): Promise<{
      keys: SshKey[]
    }> => http.get(`/hosts/${hostId}/ops/instances/${instanceId}/ssh-keys`),
    opsInstanceInitCommands: (hostId: number, instanceId: number, distro: string): Promise<{
      commands: Array<{
        id: number
        name: string
        commandLineCount: number
        distros: string[]
        description: string | null
      }>
    }> => http.get(`/hosts/${hostId}/ops/instances/${instanceId}/init-commands`, { params: { distro } }),
    opsInstancePreview: (hostId: number, instanceId: number): Promise<{
      instanceId: number
      instanceName: string
      incusId: string
      instanceStatus: string
      hostName: string
      hostId: number
      imageAlias?: string | null
      canSync: boolean
      canRestart: boolean
      canForceRestart: boolean
      canRebuild: boolean
      canRecreate: boolean
      activeTask?: {
        id: number
        taskType: string
        status: string
      } | null
      risk: {
        status: string
        isStopped: boolean
        hasActiveTask: boolean
        suggestedAction: 'rebuild' | 'recreate' | 'sync' | 'restart' | 'none'
        notes: string[]
      }
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/preview`),
    opsInstanceSync: (hostId: number, instanceId: number): Promise<{
      success: boolean
      message: string
      statusChanged?: boolean
      from?: string
      to?: string
      currentStatus?: string
      ipv4Changed?: boolean
      oldIpv4?: string | null
      newIpv4?: string | null
      ipv6Changed?: boolean
      oldIpv6?: string | null
      newIpv6?: string | null
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/sync`),
    opsInstanceRestart: (hostId: number, instanceId: number, force: boolean): Promise<{
      success: boolean
      message: string
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/restart`, { force }),
    opsInstanceDangerousAction: (hostId: number, instanceId: number, data: {
      action: 'rebuild' | 'recreate'
      imageAlias: string
      sshKeyId?: number
      customInitCommandIds?: number[]
      confirmationText: string
      riskConfirmed: boolean
    }): Promise<{
      success: boolean
      message: string
      taskId: number
      status: string
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/dangerous-action`, data),
    opsInstanceAuditScan: (hostId: number, instanceId: number): Promise<{
      success: boolean
      scanId: number
      scannedAt: string
      capability: string
      instance: {
        id: number
        name: string
        incusId: string
        type: string
        status: string
      }
      summary: {
        riskLevel: 'info' | 'low' | 'medium' | 'high'
        processCount: number
        connectionCount: number
        listeningCount: number
        startupItemCount: number
        findingCount: number
      }
      ignoredCount?: number
      rules?: Array<{
        id: string
        source: 'builtin' | 'custom'
        name: string
        category: string
        severity: 'info' | 'low' | 'medium' | 'high'
        targetTypes: Array<'process' | 'network' | 'startup'>
        matchType: 'contains' | 'regex' | 'exact'
        pattern: string
        caseSensitive: boolean
        recommendation?: string | null
        enabled: boolean
      }>
      findings: Array<{
        id: string
        severity: 'info' | 'low' | 'medium' | 'high'
        category: string
        title: string
        detail: string
        targetType: 'process' | 'network' | 'startup' | 'capability'
        ruleId?: string
        ruleName?: string
        ruleSource?: 'builtin' | 'custom'
        matchedText?: string
        recommendation?: string | null
        pid?: number
        evidence: string
        ignored?: boolean
        ignoreReason?: string | null
      }>
      processes: Array<{
        pid: number
        ppid: number | null
        user: string
        stat: string
        cpuPercent: number | null
        memoryPercent: number | null
        elapsed: string
        command: string
        args: string
        raw: string
        findings: string[]
      }>
      connections: Array<{
        protocol: string
        state: string
        local: string
        peer: string
        process: string | null
        pid: number | null
        raw: string
      }>
      startupItems: Array<{
        source: string
        command: string
        raw: string
        findings: string[]
      }>
      stderr?: string[]
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/audit/scan`),
    opsInstanceAuditKillProcess: (hostId: number, instanceId: number, data: {
      pid: number
      signal?: 'TERM' | 'KILL'
      reason: string
      confirmationText: string
      scanId?: number
      expectedCommand?: string
    }): Promise<{
      success: boolean
      message: string
      pid: number
      signal: 'TERM' | 'KILL'
      stdout?: string
      stderr?: string
    }> => http.post(`/hosts/${hostId}/ops/instances/${instanceId}/audit/kill-process`, data),
    opsAuditRules: (hostId: number): Promise<{
      builtin: Array<any>
      custom: Array<any>
      canCreateGlobal: boolean
    }> => http.get(`/hosts/${hostId}/ops/audit/rules`),
    opsAuditCreateRule: (hostId: number, data: Record<string, unknown>): Promise<any> =>
      http.post(`/hosts/${hostId}/ops/audit/rules`, data),
    opsAuditUpdateRule: (hostId: number, ruleId: number, data: Record<string, unknown>): Promise<any> =>
      http.patch(`/hosts/${hostId}/ops/audit/rules/${ruleId}`, data),
    opsAuditDeleteRule: (hostId: number, ruleId: number): Promise<{ success: boolean }> =>
      http.delete(`/hosts/${hostId}/ops/audit/rules/${ruleId}`),
    opsAuditUpdateBuiltinRule: (hostId: number, ruleId: string, data: Record<string, unknown>): Promise<any> =>
      http.patch(`/hosts/${hostId}/ops/audit/builtin-rules/${encodeURIComponent(ruleId)}`, data),
    opsAuditResetBuiltinRule: (hostId: number, ruleId: string): Promise<{ success: boolean }> =>
      http.delete(`/hosts/${hostId}/ops/audit/builtin-rules/${encodeURIComponent(ruleId)}`),
    opsAuditIgnores: (hostId: number, params?: { instanceId?: number }): Promise<{ ignores: Array<any> }> =>
      http.get(`/hosts/${hostId}/ops/audit/ignores`, { params }),
    opsAuditCreateIgnore: (hostId: number, data: Record<string, unknown>): Promise<any> =>
      http.post(`/hosts/${hostId}/ops/audit/ignores`, data),
    opsAuditDeleteIgnore: (hostId: number, ignoreId: number): Promise<{ success: boolean }> =>
      http.delete(`/hosts/${hostId}/ops/audit/ignores/${ignoreId}`),
    opsAuditHistory: (hostId: number, params?: { instanceId?: number; pageSize?: number }): Promise<{
      scans: Array<any>
      actions: Array<any>
    }> => http.get(`/hosts/${hostId}/ops/audit/history`, { params })
  },

  // 套餐管理
  packages: {
    // 公开 API（无需登录）
    listPublic: (options?: { source?: 'official' | 'market' }): Promise<{ packages: Package[]; total: number }> => {
      const params = new URLSearchParams()
      if (options?.source) params.append('source', options.source)
      const queryString = params.toString()
      return http.get(queryString ? `/packages/public?${queryString}` : '/packages/public')
    },
    getPublicRegions: (options?: { source?: 'official' | 'market' }): Promise<{
      regions: Array<{
        code: string
        name: string
        packageIds: number[]
        hostCount: number
      }>
    }> => {
      const params = new URLSearchParams()
      if (options?.source) params.append('source', options.source)
      const queryString = params.toString()
      return http.get(queryString ? `/packages/public/regions?${queryString}` : '/packages/public/regions')
    },
    // 需要登录的 API
    list: (options?: { all?: boolean; source?: 'official' | 'market' | 'friends' | 'zone'; zoneId?: number; scope?: 'mine' | 'official' | 'hosted' }): Promise<{ packages: Package[]; total: number }> => {
      const params = new URLSearchParams()
      if (options?.all) params.append('all', 'true')
      if (options?.source) params.append('source', options.source)
      if (options?.zoneId) params.append('zoneId', String(options.zoneId))
      if (options?.scope) params.append('scope', options.scope)
      const queryString = params.toString()
      return http.get(queryString ? `/packages?${queryString}` : '/packages')
    },
    getHostingZones: (): Promise<{
      zones: Array<{
        id: number
        name: string
        ownerId: number
        ownerUsername: string
        logoUrl: string
        sortOrder: number
      }>
    }> => http.get('/packages/hosting-zones'),
    // 管理员专用：获取托管套餐列表
    listHosted: (params: { userId?: number } = {}): Promise<{ packages: Package[] }> =>
      http.get('/packages', { params: { ...params, scope: 'hosted' } }),
    get: (id: number): Promise<Package> => http.get(`/packages/${id}`),
    create: (data: CreatePackageRequest): Promise<Package> => http.post('/packages', data),
    update: (id: number, data: UpdatePackageRequest): Promise<Package> =>
      http.patch(`/packages/${id}`, data),
    delete: (id: number): Promise<void> => http.delete(`/packages/${id}`),
    // 套餐共享
    share: (packageId: number, friendId: number, quotaMultiplier?: number | null, maxInstances?: number | null): Promise<{ message: string }> =>
      http.post(`/packages/${packageId}/share`, { friendId, quotaMultiplier, maxInstances }),
    unshare: (packageId: number, userId: number): Promise<{ message: string }> =>
      http.delete(`/packages/${packageId}/share/${userId}`),
    updateShareQuota: (packageId: number, shareId: number, quotaMultiplier?: number | null, maxInstances?: number | null): Promise<{ message: string }> =>
      http.patch(`/packages/${packageId}/shares/${shareId}`, { quotaMultiplier, maxInstances }),
    getShares: (packageId: number): Promise<{
      shares: Array<{
        id: number
        packageId: number
        packageName: string
        ownerId: number
        ownerUsername: string
        sharedToId: number
        sharedToUsername: string
        sharedToAvatarStyle?: string | null
        sharedToAvatarBadgeId?: string | null
        quotaMultiplier: number | null
        maxInstances: number | null
        usage?: {
          instanceCount: number
          totalCpu: number
          totalMemory: number
        }
        createdAt: string
      }>
      packageQuota: {
        cpuMax: number
        memoryMax: number
      }
    }> => http.get(`/packages/${packageId}/shares`),
    getShared: (): Promise<{
      shares: Array<{
        id: number
        packageId: number
        packageName: string
        ownerId: number
        ownerUsername: string
        sharedToId: number
        sharedToUsername: string
        sharedToAvatarStyle?: string | null
        sharedToAvatarBadgeId?: string | null
        quotaMultiplier: number | null
        maxInstances: number | null
        createdAt: string
      }>
    }> => http.get('/packages/my-shares'),

    // 资源释放功能
    getHostsDetail: (packageId: number): Promise<{
      hosts: Array<{
        id: number
        name: string
        countryCode: string
        cpuAllowanceMax: number
        memoryMax: number
        cpuUsed: number
        memoryUsed: number
      }>
      packageName: string
      cpuMax: number
      memoryMax: number
    }> => http.get(`/packages/${packageId}/hosts-detail`),

    releaseQuota: (packageId: number, data: {
      hostIds: number[]
      cpuAdd: number
      memoryAdd: number
      notify?: boolean
    }): Promise<{
      message: string
      results: Array<{
        hostId: number
        hostName: string
        countryCode: string
        cpuAllowanceMax: number
        memoryMax: number
        cpuAvailable: number
        memoryAvailable: number
      }>
    }> => http.post(`/packages/${packageId}/release-quota`, data),

    // 获取托管套餐所有者信息
    getOwnerInfo: (packageId: number): Promise<{
      id: number
      username: string
      email: string
      avatarStyle: string
      avatarBadgeId?: string | null
      hostCount: number
      instanceCount: number
      registeredDays: number
      vipLevel: number
      vipBadgeStyle?: VipBadgeStyle | null
    }> => http.get(`/packages/${packageId}/owner-info`),

    // 套餐方案管理
    getPlans: (packageId: number, options?: { activeOnly?: boolean }): Promise<{
      plans: Array<{
        id: number
        name: string
        description: string | null
        cpu: number
        memory: number
        disk: number
        portLimit: number
        snapshotLimit: number
        backupLimit: number
        siteLimit: number
        swapSize: number
        trafficLimit: string
        trafficLimitSpeed: string
        price: number
        billingCycle: number
        setupFee: number
        monthlyPrice: number
        isActive: boolean
        isSoldOut: boolean
        sortOrder: number
        slaGuarantee: number | null
      }>
    }> => http.get(`/packages/${packageId}/plans`, { params: options }),

    createPlan: (packageId: number, data: {
      name: string
      description?: string
      cpu: number
      memory: number
      disk: number
      portLimit: number
      snapshotLimit: number
      backupLimit: number
      siteLimit: number
      swapSize: number
      trafficLimit: string
      trafficLimitSpeed?: string
      price: number
      billingCycle?: number
      setupFee?: number
      isActive?: boolean
      isSoldOut?: boolean
      sortOrder?: number
      slaGuarantee?: number | null
    }): Promise<{ id: number; name: string; message: string }> =>
      http.post(`/packages/${packageId}/plans`, data),

    updatePlan: (packageId: number, planId: number, data: {
      name?: string
      description?: string
      cpu?: number
      memory?: number
      disk?: number
      portLimit?: number
      snapshotLimit?: number
      backupLimit?: number
      siteLimit?: number
      swapSize?: number
      trafficLimit?: string
      trafficLimitSpeed?: string
      price?: number
      billingCycle?: number
      setupFee?: number
      isActive?: boolean
      isSoldOut?: boolean
      sortOrder?: number
      slaGuarantee?: number | null
    }): Promise<{ id: number; name: string; message: string }> =>
      http.put(`/packages/${packageId}/plans/${planId}`, data),

    deletePlan: (packageId: number, planId: number): Promise<{ message: string }> =>
      http.delete(`/packages/${packageId}/plans/${planId}`),

    // 获取可用地区列表（拥有付费方案的套餐所在的国家/地区）
    getRegions: (params?: { source?: 'official' | 'market' | 'friends' | 'zone'; zoneId?: number }): Promise<{
      regions: Array<{
        code: string
        name: string
        packageCount: number
        packageIds: number[]  // 该地区包含的套餐 ID 列表
      }>
    }> => http.get('/packages/regions', { params }),
  },

  // OAuth 配置（管理员）
  oauth: {
    getConfigs: (): Promise<OAuthConfig[]> => http.get('/oauth/configs'),
    updateConfig: (provider: 'github' | 'google', data: UpdateOAuthConfigRequest): Promise<OAuthConfig> =>
      http.put(`/oauth/configs/${provider}`, data),
    deleteConfig: (provider: 'github' | 'google'): Promise<void> =>
      http.delete(`/oauth/configs/${provider}`),
    getProviders: (): Promise<Array<{ provider: 'github' | 'google'; enabled: boolean }>> =>
      http.get('/oauth/providers'),
    getBindings: (): Promise<UserOAuthBinding[]> => http.get('/oauth/bindings'),
    unbind: (provider: 'github' | 'google'): Promise<void> =>
      http.delete(`/oauth/bindings/${provider}`),
    createBindTicket: (): Promise<{ ticket: string; expiresIn: number }> =>
      http.post('/oauth/bind-ticket', {}),
    // 交换 OAuth 登录码获取 Token（安全改进）
    exchangeCode: (code: string): Promise<{ token: string; user: { id: number; username: string; role: string } }> =>
      http.post('/oauth/exchange-code', { code })
  },

  // 帮助文章（公开）
  help: {
    list: (params: Record<string, unknown> = {}): Promise<PaginatedResponse<HelpArticle>> =>
      http.get('/help', { params }),
    pinned: (limit?: number): Promise<{ articles: Array<Pick<HelpArticle, 'id' | 'title' | 'slug' | 'category'>> }> =>
      http.get('/help/pinned', { params: limit ? { limit } : {} }),
    categories: (): Promise<string[]> => http.get('/help/categories'),
    categoryConfig: (): Promise<{ categories: Array<{ id: string; name: string; color: string }> }> =>
      http.get('/help/category-config'),
    getBySlug: (slug: string): Promise<HelpArticle> => http.get(`/help/article/${slug}`),
    // 管理员接口
    adminList: (params: Record<string, unknown> = {}): Promise<PaginatedResponse<HelpArticle>> =>
      http.get('/help/admin', { params }),
    adminGet: (id: number): Promise<HelpArticle> => http.get(`/help/admin/${id}`),
    create: (data: CreateHelpArticleRequest): Promise<HelpArticle> => http.post('/help/admin', data),
    update: (id: number, data: UpdateHelpArticleRequest): Promise<HelpArticle> =>
      http.patch(`/help/admin/${id}`, data),
    delete: (id: number): Promise<void> => http.delete(`/help/admin/${id}`),
    saveCategoryConfig: (categories: Array<{ id: string; name: string; color: string }>): Promise<{ message: string }> =>
      http.put('/help/admin/category-config', { categories })
  },

  // 镜像管理
  images: {
    // 获取系统预定义镜像列表（用户端）
    // @param type - 可选，按实例类型过滤 (container/vm)
    // @param memory - 可选，内存大小(MB)，128MB 时只返回 Alpine/Debian
    getSystemImages: (type?: 'container' | 'vm', memory?: number, hostId?: number): Promise<{ success: boolean; images: SystemImage[] }> => {
      const params: Record<string, string> = {}
      if (type) params.type = type
      if (memory !== undefined) params.memory = String(memory)
      if (hostId !== undefined) params.hostId = String(hostId)
      return http.get('/images/system', { params })
    },
    // 管理员：获取所有镜像列表
    list: (): Promise<{ success: boolean; images: SystemImage[] }> =>
      http.get('/images/admin'),
    // 管理员：创建镜像
    create: (data: CreateSystemImageRequest): Promise<{ success: boolean; image: SystemImage }> =>
      http.post('/images/admin', data),
    // 管理员：更新镜像
    update: (id: number, data: UpdateSystemImageRequest): Promise<{ success: boolean; image: SystemImage }> =>
      http.patch(`/images/admin/${id}`, data),
    // 管理员：删除镜像
    delete: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/images/admin/${id}`)
  },

  // 日志管理
  logs: {
    list: (params: Record<string, unknown> = {}): Promise<PaginatedResponse<Log>> =>
      http.get('/logs', { params }),
    getModules: (): Promise<string[]> => http.get('/logs/modules')
  },

  // 健康检查
  health: (): Promise<{ status: string; timestamp: string }> => http.get('/health'),

  // 系统配置（管理员）
  systemConfig: {
    // 公开配置（无需登录）
    getPublic: (): Promise<{
      registrationEnabled: boolean
      requireInviteCode: boolean
      turnstileEnabled?: boolean
      turnstileSiteKey?: string | null
      ticketEnabled?: boolean
      freeSiteMode?: boolean
      mailAvailable?: boolean
      avatarApiBase?: string
      emailVerificationEnabled?: boolean
      emailDomainWhitelistEnabled?: boolean
      allowedEmailDomains?: string[] | null
      transferFee?: number
      footerContactEmail?: string | null
      footerTelegramLink?: string | null
      hostingMarketEntryEnabled?: boolean
      hostingNotice?: string | null
      brandName?: string | null
      brandSubtitle?: string | null
      brandLogoUrl?: string | null
      popupAnnouncement?: string | null
      popupAnnouncementUpdatedAt?: string | null
      popupPromoImageUrl?: string | null
      popupPromoPackage?: {
        id: number
        name: string
        description: string | null
        source: 'official' | 'market'
        plans: Array<{
          id: number
          name: string
          description: string | null
          cpu: number
          memory: number
          disk: number
          trafficLimit: string
          price: number
          billingCycle: number
          isSoldOut: boolean
        }>
      } | null
      popupPromoUpdatedAt?: string | null
    }> =>
      http.get('/system-config/public'),
    // 测试 SMTP 连接
    testSmtp: (): Promise<{ success: boolean; message?: string; error?: string }> =>
      http.post('/system-config/smtp/test'),
    // 发送测试邮件
    sendTestEmail: (to: string): Promise<{ success: boolean; message?: string; error?: string }> =>
      http.post('/system-config/smtp/send-test', { to }),
    list: (): Promise<{ configs: Array<{ id: number; key: string; value: string; type: string; label: string | null; description: string | null }> }> =>
      http.get('/system-config'),
    getDefaultQuota: (): Promise<{ quota: { hostLimit: number; friendLimit: number; packageLimit: number } }> =>
      http.get('/system-config/default-quota'),
    update: (configs: Array<{ key: string; value: string }>): Promise<{ message: string }> =>
      http.put('/system-config', { configs })
  },

  // Storage Configs (远程存储配置)
  storageConfigs: {
    list: (): Promise<Array<{
      id: number
      name: string
      type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
      host: string
      port: number | null
      username: string | null
      basePath: string | null
      isDefault: boolean
      createdAt: string
      updatedAt: string
    }>> => http.get('/storage-configs'),

    create: (data: {
      name: string
      type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
      host: string
      port?: number
      username?: string
      password?: string
      basePath?: string
      isDefault?: boolean
    }): Promise<{ id: number }> => http.post('/storage-configs', data),

    update: (id: number, data: {
      name?: string
      type?: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
      host?: string
      port?: number | null
      username?: string | null
      password?: string | null
      basePath?: string | null
      isDefault?: boolean
    }): Promise<{ id: number }> => http.patch(`/storage-configs/${id}`, data),

    delete: (id: number): Promise<void> => http.delete(`/storage-configs/${id}`),

    test: (id: number): Promise<{ success: boolean; message?: string }> =>
      http.post(`/storage-configs/${id}/test`),

    setDefault: (id: number): Promise<{ success: boolean }> =>
      http.post(`/storage-configs/${id}/set-default`)
  },

  // Traffic (流量统计)
  traffic: {
    // 获取当前用户流量
    getMyTraffic: (): Promise<{
      monthlyUsed: string
      monthlyUsedFormatted: string
      monthlyLimit: string | null
      monthlyLimitFormatted: string | null
      extraQuota: string
      trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
      percentage: number
    }> => http.get('/me/traffic'),

    // 获取指定用户流量（管理员）
    getUserTraffic: (userId: number): Promise<{
      monthlyUsed: string
      monthlyUsedFormatted: string
      monthlyLimit: string | null
      monthlyLimitFormatted: string | null
      extraQuota: string
      trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
      percentage: number
    }> => http.get(`/users/${userId}/traffic`),

    // 更新用户流量限额（管理员）
    updateUserTrafficLimit: (userId: number, monthlyLimit: string | null): Promise<{ success: boolean }> =>
      http.put(`/users/${userId}/traffic/limit`, { monthlyLimit }),

    // 获取实例流量
    getInstanceTraffic: (instanceId: number): Promise<{
      monthlyUsed: string
      monthlyUsedFormatted: string
      monthlyLimit: string | null
      monthlyLimitFormatted: string | null
      trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
      percentage: number
      trafficResetDay: number
      periodStart: string
      periodEnd: string
    }> => http.get(`/instances/${instanceId}/traffic`),

    // 获取实例流量历史
    getInstanceTrafficHistory: (instanceId: number, days?: number): Promise<{
      trafficResetDay: number
      periodStart: string
      periodEnd: string
      data: Array<{
        date: string
        rxTotal: string
        txTotal: string
        rxFormatted: string
        txFormatted: string
        total: string
        totalFormatted: string
      }>
    }> => http.get(`/instances/${instanceId}/traffic/history`, { params: { days } }),

    // 更新实例流量限额（管理员）
    updateInstanceTrafficLimit: (instanceId: number, monthlyLimit: string | null): Promise<{ success: boolean }> =>
      http.put(`/instances/${instanceId}/traffic/limit`, { monthlyLimit }),

    // 重置实例月度流量（宿主机所有者）
    resetInstanceTraffic: (instanceId: number): Promise<{ success: boolean; message: string }> =>
      http.post(`/instances/${instanceId}/traffic/reset`),

    // 手动触发流量采集（管理员）
    triggerCollection: (): Promise<{ success: boolean; message: string }> =>
      http.post('/traffic/collect'),

    // 同步套餐流量限额到所有实例（管理员）
    syncPackageLimits: (): Promise<{ success: boolean; message: string; updatedCount: number }> =>
      http.post('/traffic/sync-package-limits'),

    // 获取节点流量统计（管理员）
    getHostTrafficHistory: (hostId: number): Promise<{
      trafficResetDay: number
      periodStart: string
      periodEnd: string
      data: Array<{
        date: string
        rxTotal: string
        txTotal: string
        rxFormatted: string
        txFormatted: string
        total: string
        totalFormatted: string
      }>
      summary: {
        totalUsed: string
        totalUsedFormatted: string
        totalLimit: string
        totalLimitFormatted: string
      }
    }> => http.get(`/hosts/${hostId}/traffic/history`)
  },

  // Friends (好友系统)
  friends: {
    // 获取好友列表
    list: (): Promise<{
      friends: Array<{
        id: number  // 好友的用户ID
        friendshipId: number  // friendship 记录的ID
        friendId: number  // 好友的用户ID（与 id 相同）
        username: string
        avatarStyle: string
        avatarBadgeId?: string | null
        status: string
        createdAt: string
        acceptedAt: string | null
        initiatedByMe: boolean
        hostCount?: number
        instanceCount?: number
      }>
    }> => http.get('/friends'),

    // 发送好友请求
    sendRequest: (username: string, remark?: string): Promise<{ message: string; request?: { id: number }; friendship?: any }> =>
      http.post('/friends/request', { username, remark }),

    // 获取待处理的好友请求
    getPendingRequests: (): Promise<{
      requests: Array<{
        id: number
        userId: number
        username: string
        avatarStyle: string
        avatarBadgeId?: string | null
        remark: string | null
        createdAt: string
      }>
    }> => http.get('/friends/requests'),

    // 获取已发送的好友请求
    getSentRequests: (): Promise<{
      requests: Array<{
        id: number
        userId: number
        username: string
        avatarStyle: string
        avatarBadgeId?: string | null
        remark: string | null
        createdAt: string
      }>
    }> => http.get('/friends/requests/sent'),

    // 获取历史记录（已处理的请求）
    getHistory: (filter?: 'accepted' | 'rejected' | 'removed' | 'all'): Promise<{
      history: Array<{
        id: number
        userId: number
        username: string
        avatarStyle: string
        avatarBadgeId?: string | null
        remark: string | null
        status: 'accepted' | 'rejected' | 'removed'
        createdAt: string
        acceptedAt: string | null
        rejectedAt: string | null
        initiatedByMe: boolean  // 是否是我发起的请求
      }>
    }> => http.get('/friends/history', { params: { filter } }),

    // 接受好友请求
    accept: (requestId: number): Promise<{ message: string; friendship: any }> =>
      http.post(`/friends/${requestId}/accept`),

    // 拒绝好友请求
    reject: (requestId: number): Promise<{ message: string }> =>
      http.post(`/friends/${requestId}/reject`),

    // 取消已发送的好友请求
    cancelRequest: (requestId: number): Promise<{ message: string }> =>
      http.delete(`/friends/request/${requestId}`),

    // 删除好友
    remove: (friendshipId: number): Promise<{ message: string }> =>
      http.delete(`/friends/${friendshipId}`),

    // 搜索用户（用于添加好友）
    searchUser: (username: string): Promise<{
      user: {
        id: number
        username: string
        avatarStyle: string
        isFriend: boolean
      }
    }> => http.get('/friends/search', { params: { username } }),

    // 获取好友的资源统计
    getFriendResources: (friendshipId: number): Promise<{
      resources: {
        hosts: number
        images: number
        packages: number
      }
    }> => http.get(`/friends/${friendshipId}/resources`)
  },

  // Transfers (实例转移)
  transfers: {
    // 搜索用户（用于转移时选择接收方）
    searchUser: (username: string): Promise<{
      user: {
        id: number
        username: string
        status: string
      }
    }> => http.get('/transfers/users/search', { params: { username } }),

    // 发起转移请求
    create: (instanceId: number, targetUsername: string, remark?: string): Promise<{
      message: string
      transfer: { id: number; status: string }
    }> => http.post(`/transfers/instances/${instanceId}/transfer`, { targetUsername, remark }),

    // 获取转移列表
    list: (type: 'sent' | 'received', params: { status?: string; page?: number; pageSize?: number; search?: string } = {}): Promise<{
      transfers: Array<{
        id: number
        instanceId: number
        instanceName: string
        instanceStatus: string
        instanceImage: string
        fromUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null } | null
        toUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null } | null
        status: string
        snapshot: any
        remark: string | null
        rejectReason: string | null
        createdAt: string
        acceptedAt: string | null
        rejectedAt: string | null
        cancelledAt: string | null
        canPush?: boolean
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/transfers', { params: { type, ...params } }),

    // 获取待接收数量
    getPendingCount: (): Promise<{ count: number }> => http.get('/transfers/pending-count'),

    // 获取转移详情
    get: (id: number): Promise<{
      transfer: {
        id: number
        instanceId: number
        instanceName: string
        instanceStatus: string
        fromUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null }
        toUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null }
        status: string
        snapshot: any
        remark: string | null
        rejectReason: string | null
        createdAt: string
        acceptedAt: string | null
        rejectedAt: string | null
        cancelledAt: string | null
      }
    }> => http.get(`/transfers/${id}`),

    // 接受转移
    accept: (id: number): Promise<{ message: string }> => http.post(`/transfers/${id}/accept`),

    // 拒绝转移
    reject: (id: number, reason?: string): Promise<{ message: string }> =>
      http.post(`/transfers/${id}/reject`, { reason }),

    // 取消转移
    cancel: (id: number): Promise<{ message: string }> => http.post(`/transfers/${id}/cancel`),

    // 直接推送（宿主机所有者可直接将实例推送给接收方，无需对方接受）
    push: (id: number): Promise<{ message: string }> => http.post(`/transfers/${id}/push`)
  },

  // 敏感操作二次验证
  verification: {
    // 请求验证码
    request: (operationType: string, resourceId?: number): Promise<{
      message: string
      success?: boolean
      required?: boolean
      channel: 'email' | 'telegram' | 'discord' | 'webhook'
      target?: string
      maskedTarget?: string
      expiresAt?: string
      expiresIn?: number
      operationName?: string
    }> => http.post('/verification/request', { operationType, resourceId }),

    // 验证码校验
    verify: (operationType: string, code: string, resourceId?: number): Promise<{
      message: string
      verified: boolean
    }> => http.post('/verification/verify', { operationType, code, resourceId }),

    // 检查是否已验证
    check: (operationType: string, resourceId?: number): Promise<{
      verified: boolean
      expiresAt?: string
    }> => http.get('/verification/check', { params: { operationType, resourceId } }),

    // 获取支持的操作类型
    getOperationTypes: (): Promise<{
      operationTypes: Array<{ type: string; name: string; requiresResource: boolean }>
    }> => http.get('/verification/operation-types')
  },

  // 站内信
  inbox: {
    // 获取消息列表
    list: (params?: { page?: number; pageSize?: number; isRead?: boolean }): Promise<{
      messages: Array<{
        id: number
        userId: number
        eventType: string
        title: string
        content: string
        isRead: boolean
        data: Record<string, unknown> | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/inbox', { params }),

    // 获取未读数量
    getUnreadCount: (): Promise<{ count: number }> => http.get('/inbox/unread-count'),

    // 标记单条已读
    markAsRead: (id: number): Promise<{ success: boolean }> => http.post(`/inbox/${id}/read`),

    // 全部标记已读
    markAllAsRead: (): Promise<{ success: boolean; count: number }> => http.post('/inbox/read-all'),

    // 删除单条消息
    delete: (id: number): Promise<{ success: boolean }> => http.delete(`/inbox/${id}`),

    // 清空已读消息
    deleteRead: (): Promise<{ success: boolean; count: number }> => http.delete('/inbox/read'),

    // 管理员发送全站站内信
    broadcast: (data: { title: string; content: string }): Promise<{ success: boolean; count: number }> =>
      http.post('/inbox/admin/broadcast', data),

    // 管理员发送站内信给特定用户
    sendToUser: (userId: number, data: { title: string; content: string }): Promise<{ success: boolean }> =>
      http.post(`/inbox/admin/send/${userId}`, data),

    // 节点所有者通知实例用户
    notifyHostUsers: (
      hostId: number,
      data: { title: string; content: string; instanceIds?: number[]; sendEmail?: boolean }
    ): Promise<{
      success: boolean
      count: number
      email?: {
        requested: boolean
        mode: 'none' | 'direct' | 'queued'
        sentCount: number
        queuedCount: number
        skippedCount: number
        failedCount: number
      }
    }> =>
      http.post(`/inbox/hosts/${hostId}/notify`, data),

    // 节点所有者发送站内信给特定实例用户
    notifyInstanceUser: (instanceId: number, data: { title: string; content: string }): Promise<{ success: boolean }> =>
      http.post(`/inbox/instances/${instanceId}/notify`, data)
  },

  // 公告/通知历史
  announcements: {
    // 获取公告历史列表（管理员）
    list: (params?: { page?: number; pageSize?: number; type?: string }): Promise<{
      items: Array<{
        id: number
        type: 'system_broadcast' | 'host_broadcast' | 'admin_message' | 'host_message'
        title: string
        content: string
        recipientCount: number
        hostId: number | null
        targetUserId: number | null
        instanceId: number | null
        createdAt: string
        sender: { id: number; username: string }
        host: { id: number; name: string } | null
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/announcements', { params }),

    // 获取宿主机所有者的公告历史
    listMy: (params?: { page?: number; pageSize?: number; hostId?: number }): Promise<{
      items: Array<{
        id: number
        type: 'host_broadcast' | 'host_message'
        title: string
        content: string
        recipientCount: number
        hostId: number | null
        targetUserId: number | null
        instanceId: number | null
        createdAt: string
        host: { id: number; name: string } | null
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/announcements/my', { params }),

    // 获取公告详情
    get: (id: number): Promise<{
      id: number
      type: 'system_broadcast' | 'host_broadcast' | 'admin_message' | 'host_message'
      title: string
      content: string
      recipientCount: number
      hostId: number | null
      targetUserId: number | null
      instanceId: number | null
      createdAt: string
      sender: { id: number; username: string }
      host: { id: number; name: string } | null
    }> => http.get(`/announcements/${id}`)
  },

  // 工单系统
  tickets: {
    // 创建工单
    create: (data: CreateTicketRequest): Promise<{ message: string; ticket: { id: number; messageId: number } }> =>
      (data.attachments && data.attachments.length > 0)
        ? http.post('/tickets', buildTicketFormData(data), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: TIMEOUT.MEDIUM })
        : http.post('/tickets', {
            instanceId: data.instanceId,
            subject: data.subject,
            category: data.category,
            priority: data.priority,
            content: data.content
          }),

    // 获取我的工单列表（支持 active 状态筛选和搜索）
    list: (params?: { status?: TicketStatus | 'active'; search?: string; page?: number; pageSize?: number }): Promise<PaginatedTickets> =>
      http.get('/tickets', { params }),

    // 获取工单详情
    get: (id: number): Promise<{ ticket: Ticket; isOwner: boolean; isCreator: boolean }> =>
      http.get(`/tickets/${id}`),

    // 获取工单消息列表
    getMessages: (id: number, params?: { page?: number; pageSize?: number }): Promise<PaginatedTicketMessages> =>
      http.get(`/tickets/${id}/messages`, { params }),

    // 回复工单
    reply: (id: number, content: string, attachments?: File[]): Promise<{ message: string; data: TicketMessage }> =>
      (attachments && attachments.length > 0)
        ? http.post(`/tickets/${id}/messages`, buildTicketFormData({ content, attachments }), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: TIMEOUT.MEDIUM })
        : http.post(`/tickets/${id}/messages`, { content }),

    // 读取工单图片内容
    getAttachmentContent: (attachmentId: number): Promise<Blob> =>
      http.get(`/tickets/attachments/${attachmentId}/content`, { responseType: 'blob', timeout: TIMEOUT.MEDIUM }),

    // 删除工单消息（仅管理员）
    deleteMessage: (ticketId: number, messageId: number): Promise<{ message: string }> =>
      http.delete(`/tickets/${ticketId}/messages/${messageId}`),

    // 更新工单状态（宿主机所有者）
    updateStatus: (id: number, status: TicketStatus): Promise<{ message: string; status: TicketStatus }> =>
      http.patch(`/tickets/${id}/status`, { status }),

    // 关闭工单
    close: (id: number): Promise<{ message: string }> =>
      http.post(`/tickets/${id}/close`),

    // 获取宿主机收到的工单列表（支持 active 状态筛选和搜索）
    getHostTickets: (hostId: number, params?: { status?: TicketStatus | 'active'; search?: string; page?: number; pageSize?: number }): Promise<PaginatedTickets> =>
      http.get(`/tickets/hosts/${hostId}`, { params }),

    // 获取所有宿主机的工单（汇总视图，支持 active 状态筛选和搜索）
    getMyHostTickets: (params?: { status?: TicketStatus | 'active'; hostId?: number; sourceType?: 'all' | 'user' | 'official' | 'hosted'; search?: string; page?: number; pageSize?: number }): Promise<PaginatedTickets> =>
      http.get('/tickets/my-hosts', { params }),

    // 获取待处理工单数量
    getPendingCount: (): Promise<{ userTickets: number; hostTickets: number; total: number; isHostOwner: boolean }> =>
      http.get('/tickets/pending-count')
  },

  // 签到系统
  checkin: {
    // 获取签到状态
    getStatus: (): Promise<{
      hasCheckedIn: boolean
      hasInstances: boolean
      selfOnlyMode: boolean
      consecutiveOthersUse: number
    }> => http.get('/checkin/status'),

    // 执行签到（资源直接存入资源池）
    checkin: (): Promise<{
      message: string
      codeType: string
      codeValue: number
      toResourcePool: boolean
      bonusPoints: number
    }> => http.post('/checkin/checkin'),

    // 兑换系统兑换码
    // 仅支持系统码（h-前缀）：instanceId 必须，直接应用到实例
    redeem: (redeemCode: string, instanceId: number): Promise<{
      message: string
      codeType: string
      codeValue: number
      actualAdded: number
      instanceId?: number
      instanceName?: string
      isSystemCode: boolean
      toResourcePool: boolean
    }> => http.post('/checkin/redeem', { redeemCode, instanceId }),

    // 获取可用实例列表
    getInstances: (): Promise<{
      instances: Array<{
        id: number
        name: string
        status: string
        cpu: number
        memory: number
        disk: number
        monthlyTrafficLimit: string | null
        package: {
          id: number
          name: string
          cpuMax: number
          memoryMax: number
          diskMax: number
          monthlyTrafficLimit: string | null
        } | null
        host: {
          id: number
          name: string
          location: string | null
          countryCode: string
        }
      }>
    }> => http.get('/checkin/instances'),

    // 获取签到记录
    getRecords: (params?: { limit?: number; offset?: number }): Promise<{
      records: Array<{
        id: number
        redeemCode: string
        codeType: string
        codeValue: number
        expiresAt: string
        usedAt: string | null
        usedBy: { id: number; username: string } | null
        usedFor: { id: number; name: string } | null
        createdAt: string
      }>
      total: number
    }> => http.get('/checkin/records', { params }),

    // 获取兑换记录
    getRedeems: (params?: { limit?: number; offset?: number }): Promise<{
      records: Array<{
        id: number
        redeemCode: string
        codeType: string
        codeValue: number
        owner: { id: number; username: string }
        usedFor: { id: number; name: string } | null
        usedAt: string | null
        isSystemCode?: boolean
      }>
      total: number
    }> => http.get('/checkin/redeems', { params })
  },

  // 资源池系统
  resourcePool: {
    // 获取用户资源池
    get: (): Promise<{
      cpu: number
      memory: number
      disk: number
      traffic: number
    }> => http.get('/resource-pool'),

    // 应用资源到实例
    apply: (data: {
      instanceId: number
      resourceType: 'c' | 'r' | 'd' | 't'
      amount: number
    }): Promise<{
      message: string
      resourceType: string
      amount: number
      instanceId: number
      instanceName: string
    }> => http.post('/resource-pool/apply', data),

    // 获取资源池变动记录
    getLogs: (params?: {
      action?: string
      resourceType?: string
      limit?: number
      offset?: number
    }): Promise<{
      records: Array<{
        id: number
        action: string
        resourceType: string
        amount: number
        instance: { id: number; name: string } | null
        remark: string | null
        createdAt: string
      }>
      total: number
    }> => http.get('/resource-pool/logs', { params }),

    // 获取可应用资源的实例列表（包括免费和付费）
    getInstances: (): Promise<{
      instances: Array<{
        id: number
        name: string
        status: string
        cpu: number
        memory: number
        disk: number
        monthlyTrafficLimit: string | null
        isPaid: boolean
        instanceType: 'vm' | 'container'
        host: {
          id: number
          name: string
          location: string | null
          countryCode: string
        }
      }>
    }> => http.get('/resource-pool/instances')
  },

  // 用户自定义初始化命令
  initCommands: {
    // 获取用户的所有初始化命令模板
    list: (): Promise<{
      commands: Array<{
        id: number
        name: string
        commandPreview: string
        commandLineCount: number
        distros: string[]
        description: string | null
        enabled: boolean
        createdAt: string
        updatedAt: string
      }>
    }> => http.get('/init-commands'),

    // 获取适配指定发行版的命令列表（创建/重装时使用）
    getAvailable: (distro: string): Promise<{
      commands: Array<{
        id: number
        name: string
        commandLineCount: number
        distros: string[]
        description: string | null
      }>
    }> => http.get('/init-commands/available', { params: { distro } }),

    // 获取单个命令详情
    get: (id: number): Promise<{
      command: {
        id: number
        name: string
        command: string
        distros: string[]
        description: string | null
        enabled: boolean
        createdAt: string
        updatedAt: string
      }
    }> => http.get(`/init-commands/${id}`),

    // 创建初始化命令模板
    create: (data: {
      name: string
      command: string
      distros: string[]
      description?: string
    }): Promise<{ message: string; id: number }> => http.post('/init-commands', data),

    // 更新初始化命令模板
    update: (id: number, data: {
      name?: string
      command?: string
      distros?: string[]
      description?: string | null
      enabled?: boolean
    }): Promise<{ message: string }> => http.put(`/init-commands/${id}`, data),

    // 删除初始化命令模板
    delete: (id: number): Promise<{ message: string }> => http.delete(`/init-commands/${id}`),

    // 获取可用的发行版列表（名称由前端翻译）
    getDistros: (): Promise<{
      distros: Array<{
        id: string
        icon: string
      }>
    }> => http.get('/init-commands/distros')
  },

  // 计费相关
  billing: {
    // 获取实例计费信息
    getInstanceBilling: (instanceId: number): Promise<{
      billing: {
        instanceId: number
        instanceName: string
        planId: number | null
        planName: string | null
        price: number | null
        billingCycle: number | null
        expiresAt: string | null
        autoRenew: boolean
        renewPreview: Array<{ months: number; price: number; expiresAt: string }> | null
      }
    }> => http.get(`/instances/${instanceId}/billing`),

    // 实例续费
    renewInstance: (instanceId: number, months: number): Promise<{
      message: string
      amount: number
      months: number
      newExpiresAt: string
    }> => http.post(`/instances/${instanceId}/renew`, { months }),

    applyAffCodeToInstance: (instanceId: number, affCode: string): Promise<{
      success: boolean
      message: string
      discountRate: number
      discountPercent: number
    }> => http.post(`/instances/${instanceId}/apply-aff`, { affCode }),

    previewBatchRenew: (instanceIds: number[]): Promise<{
      items: Array<{
        id: number
        name: string
        canRenew: boolean
        autoRenew: boolean
        reason?: string
        isHostedInstance: boolean
        daysUntilExpire: number | null
        options: Array<{
          months: number
          price: number
          discountedPrice: number
          expiresAt: string
        }>
      }>
    }> => http.post('/instances/batch/renew-preview', { instanceIds }, { timeout: TIMEOUT.BATCH }),

    renewInstancesBatch: (instanceIds: number[], months: number): Promise<{
      message: string
      successCount: number
      skippedCount: number
      failedCount: number
      results: Array<{
        id: number
        name: string
        success: boolean
        skipped?: boolean
        reason?: string
        amount?: number
        newExpiresAt?: string
      }>
    }> => http.post('/instances/batch/renew', { instanceIds, months }, { timeout: TIMEOUT.BATCH }),

    // 升降级预览
    getChangePlanPreview: (instanceId: number, newPlanId: number): Promise<{
      preview: {
        oldPlan: { id: number; name: string; price: number; billingCycle: number }
        newPlan: { id: number; name: string; price: number; billingCycle: number; isActive: boolean; isSoldOut: boolean }
        remainingDays: number
        oldDailyPrice: number
        newDailyPrice: number
        remainingValue: number
        newPlanCost: number
        discountRate: number
        discountAmount: number
        priceDiff: number
        isUpgrade: boolean
        newExpiresAt: string
        newConfig: { cpu: number; memory: number; disk: number }
        resourceWarnings: string[] | null
        canChange: boolean
        cannotChangeReason?: string
      }
    }> => http.get(`/instances/${instanceId}/change-plan/preview`, { params: { newPlanId } }),

    // 执行升降级
    changePlan: (instanceId: number, newPlanId: number): Promise<{
      message: string
      priceDiff: number
      newConfig: { cpu: number; memory: number; disk: number }
      needRestart: boolean
      restartMessage: string | null
    }> => http.post(`/instances/${instanceId}/change-plan`, { newPlanId }),

    // 获取销毁预览信息
    getDestroyInfo: (instanceId: number): Promise<{
      canDestroy: boolean
      cannotDestroyReason: string
      isFreeInstance: boolean
      isFirstTime: boolean
      rules: {
        feeRate: number
      }
      refund: {
        remainingDays: number
        remainingValue: number
        feeRate: number
        feeAmount: number
        refundAmount: number
        destroyCount: number
      }
      instance: {
        id: number
        name: string
        hostName: string
        planName: string | null
      }
    }> => http.get(`/instances/${instanceId}/destroy-info`),

    // 执行销毁
    destroyInstance: (instanceId: number, options?: { feeWaiver?: string }): Promise<{
      success: boolean
      message: string
      refundAmount: number
      feeAmount: number
      isFirstTime: boolean
      isFreeInstance: boolean
    }> => http.post(`/instances/${instanceId}/destroy${options?.feeWaiver ? `?feeWaiver=${options.feeWaiver}` : ''}`),

    getBatchDestroyInfo: (instanceIds: number[]): Promise<{
      items: Array<{
        id: number
        name: string
        canDestroy: boolean
        cannotDestroyReason: string
        isFreeInstance: boolean
        isFirstTime: boolean
        feeWaiverEligible: boolean
        refund: {
          remainingDays: number
          remainingValue: number
          feeRate: number
          feeAmount: number
          refundAmount: number
          destroyCount: number
          maxRefundable: number
        }
        instance: {
          id: number
          name: string
          hostName: string
          planName: string | null
        }
      }>
    }> => http.post('/instances/batch/destroy-info', { instanceIds }, { timeout: TIMEOUT.BATCH }),

    destroyInstancesBatch: (instanceIds: number[]): Promise<{
      message: string
      successCount: number
      skippedCount: number
      failedCount: number
      results: Array<{
        id: number
        name: string
        success: boolean
        skipped?: boolean
        reason?: string
        refundAmount?: number
        feeAmount?: number
        isFirstTime?: boolean
        isFreeInstance?: boolean
      }>
    }> => http.post('/instances/batch/destroy', { instanceIds }, { timeout: TIMEOUT.BATCH }),

    // 切换自动续费
    setAutoRenew: (instanceId: number, autoRenew: boolean): Promise<{
      message: string
      autoRenew: boolean
    }> => http.patch(`/instances/${instanceId}/auto-renew`, { autoRenew }),

    setAutoRenewBatch: (instanceIds: number[], autoRenew: boolean): Promise<{
      message: string
      successCount: number
      skippedCount: number
      failedCount: number
      results: Array<{
        id: number
        name: string
        success: boolean
        skipped?: boolean
        reason?: string
        autoRenew?: boolean
      }>
    }> => http.patch('/instances/batch/auto-renew', { instanceIds, autoRenew }, { timeout: TIMEOUT.BATCH }),

    // 获取实例计费记录
    getInstanceBillingRecords: (instanceId: number, params?: { page?: number; pageSize?: number; type?: string }): Promise<{
      records: Array<{
        id: number
        type: string
        amount: number
        months: number | null
        periodStart: string
        periodEnd: string
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get(`/instances/${instanceId}/billing/records`, { params }),

    // 获取用户余额
    getUserBalance: (): Promise<{
      balance: { balance: number; frozen: number; totalRecharge: number; totalConsume: number; destroyedValue: number }
    }> => http.get('/balance/me'),

    // 获取余额记录
    getBalanceLogs: (params?: { page?: number; pageSize?: number; type?: string; lotteryGift?: 'exclude' | 'only' }): Promise<{
      records: Array<{
        id: number
        type: string
        amount: number
        balanceBefore: number
        balanceAfter: number
        instanceId: number | null
        instanceName: string | null
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/balance/me/logs', { params }),

    // 获取可用支付渠道
    getPaymentProviders: (): Promise<{
      providers: Array<{
        id: number
        name: string
        type: string
        methods: string[]
        methodFees?: Record<string, { feeRate: number; feeFixed?: number }>
        minAmount: number
        maxAmount: number | null
        feeRate: number
        feeFixed: number
      }>
    }> => http.get('/recharge/providers'),

    // 创建充值订单
    createRechargeOrder: (providerId: number, amount: number, paymentMethod?: string): Promise<{
      order: {
        orderNo: string
        amount: number
        payableAmount: number
        actualAmount: number
        fee: number
        status: string
        expiredAt: string
        createdAt: string
      }
      provider: {
        id: number
        name: string
        type: string
        methods: string[]
      }
      payUrl: string | null
    }> => http.post('/recharge/orders', { providerId, amount, paymentMethod }),

    // 获取充值记录列表
    getRechargeOrders: (params?: { page?: number; pageSize?: number; status?: string }): Promise<{
      records: Array<{
        id: number
        orderNo: string
        amount: number
        payableAmount: number
        actualAmount: number | null
        fee: number
        status: string
        provider: { id: number; name: string; type: string } | null
        paymentMethod: string | null
        actualPaymentMethod: string | null
        paymentCurrency: string | null
        paymentNetwork: string | null
        paymentUuid: string | null
        paymentTxid: string | null
        invoiceCurrency: string | null
        gatewayStatus: string | null
        gatewayStatusDescription: string | null
        tradeNo: string | null
        createdAt: string
        expiredAt: string | null
        completedAt: string | null
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/recharge/orders', { params }),

    // 获取充值订单详情
    getRechargeOrder: (orderNo: string): Promise<{
      order: {
        id: number
        orderNo: string
        amount: number
        payableAmount: number
        actualAmount: number | null
        fee: number
        status: string
        provider: { id: number; name: string; type: string } | null
        paymentMethod: string | null
        actualPaymentMethod: string | null
        paymentCurrency: string | null
        paymentNetwork: string | null
        paymentUuid: string | null
        paymentTxid: string | null
        invoiceCurrency: string | null
        gatewayStatus: string | null
        gatewayStatusDescription: string | null
        tradeNo: string | null
        failReason: string | null
        createdAt: string
        expiredAt: string | null
        completedAt: string | null
      }
    }> => http.get(`/recharge/orders/${orderNo}`),

    // 取消充值订单
    cancelRechargeOrder: (orderNo: string): Promise<{
      success: boolean
      message: string
    }> => http.post(`/recharge/orders/${orderNo}/cancel`),

    // 重新支付订单
    repayRechargeOrder: (orderNo: string, paymentMethod?: string): Promise<{
      order: {
        orderNo: string
        amount: number
        payableAmount: number
        actualAmount: number | null
        status: string
        expiredAt: string | null
      }
      payUrl: string
    }> => http.post(`/recharge/orders/${orderNo}/repay`, { paymentMethod }),

    // 获取用户充值统计
    getRechargeStats: (): Promise<{
      stats: {
        totalAmount: number
        completedCount: number
        pendingCount: number
      }
    }> => http.get('/recharge/stats'),

    // 验证订单支付状态（主动查询易支付）
    verifyRechargeOrder: (orderNo: string): Promise<{
      success: boolean
      verified: boolean
      status: string
      message: string
      order?: {
        id?: number
        orderNo: string
        amount: number
        payableAmount?: number
        actualAmount?: number | null
        fee?: number
        status: string
        provider?: { id: number; name: string; type: string } | null
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
        createdAt?: string
        expiredAt?: string | null
        completedAt?: string | null
      }
    }> => http.post(`/recharge/orders/${orderNo}/verify`),

    // 获取套餐方案列表
    getPackagePlans: (packageId: number): Promise<{
      plans: Array<{
        id: number
        name: string
        description: string | null
        price: number
        billingCycle: number
        cpu: number
        memory: number
        disk: number
        portLimit: number
        snapshotLimit: number
        backupLimit: number
        siteLimit: number
        swapSize: number
        monthlyTrafficLimit: string | null
        isActive: boolean
        isSoldOut: boolean
        slaGuarantee: number | null
      }>
    }> => http.get(`/packages/${packageId}/plans`)
  },

  // 管理员 API
  admin: {
    // ==================== 支付渠道管理 ====================

    // 获取支付渠道列表
    getPaymentProviders: (): Promise<{
      providers: Array<{
        id: number
        name: string
        type: string
        status: string
        config: Record<string, unknown>
        methods: string[]
        methodFees?: Record<string, { feeRate: number; feeFixed?: number }>
        minAmount: number
        maxAmount: number | null
        feeRate: number
        feeFixed: number
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
    }> => http.get('/admin/payment-providers'),

    // 创建支付渠道
    createPaymentProvider: (data: {
      name: string
      type: string
      config?: Record<string, unknown>
      methods?: string[]
      minAmount?: number
      maxAmount?: number | null
      feeRate?: number
      feeFixed?: number
      sortOrder?: number
    }): Promise<{
      provider: { id: number; name: string; type: string; status: string }
      message: string
    }> => http.post('/admin/payment-providers', data),

    // 更新支付渠道
    updatePaymentProvider: (id: number, data: {
      name?: string
      config?: Record<string, unknown>
      methods?: string[]
      minAmount?: number
      maxAmount?: number | null
      feeRate?: number
      feeFixed?: number
      sortOrder?: number
    }): Promise<{
      provider: { id: number; name: string; type: string; status: string }
      message: string
    }> => http.put(`/admin/payment-providers/${id}`, data),

    // 更新支付渠道状态
    updatePaymentProviderStatus: (id: number, status: string): Promise<{
      message: string
    }> => http.patch(`/admin/payment-providers/${id}/status`, { status }),

    // 删除支付渠道
    deletePaymentProvider: (id: number): Promise<{
      message: string
    }> => http.delete(`/admin/payment-providers/${id}`),

    // ==================== 统计 ====================

    getStatisticsOverview: (): Promise<{
      meta: {
        timezone: string
        dailyDays: number
        monthlyMonths: number
      }
      users: {
        total: number
        dailyNewUsers: Array<{ label: string; value: number }>
        monthlyNewUsers: Array<{ label: string; value: number }>
      }
      instances: {
        total: number
        active: number
        paid: number
        free: number
        dailyCreatedInstances: Array<{ label: string; value: number }>
        monthlyCreatedInstances: Array<{ label: string; value: number }>
      }
      billing: {
        totals: {
          recharge: number
          consume: number
          aff: number
          destroyFee: number
        }
        dailyRecharge: Array<{ label: string; value: number }>
        monthlyRecharge: Array<{ label: string; value: number }>
        dailyConsume: Array<{ label: string; value: number }>
        monthlyConsume: Array<{ label: string; value: number }>
        dailyAff: Array<{ label: string; value: number }>
        monthlyAff: Array<{ label: string; value: number }>
        dailyDestroyFee: Array<{ label: string; value: number }>
        monthlyDestroyFee: Array<{ label: string; value: number }>
      }
    }> => http.get('/admin/statistics/overview'),

    // ==================== VIP 等级规则 ====================

    getVipLevelRules: (type: VipRuleType): Promise<VipLevelRulesResponse> =>
      http.get(`/admin/vip-levels/${type}`),

    updateVipLevelRules: (type: VipRuleType, rules: VipLevelRule[], options?: { userMetric?: UserVipMetric }): Promise<VipLevelRulesResponse> =>
      http.put(`/admin/vip-levels/${type}`, { rules, ...options }),

    getVipBenefitRewards: (): Promise<{ rewards: VipBenefitReward[] }> =>
      http.get('/admin/vip-benefits/rewards'),

    createVipBenefitReward: (data: VipBenefitRewardInput): Promise<{ reward: VipBenefitReward }> =>
      http.post('/admin/vip-benefits/rewards', data),

    updateVipBenefitReward: (id: number, data: VipBenefitRewardInput): Promise<{ reward: VipBenefitReward }> =>
      http.put(`/admin/vip-benefits/rewards/${id}`, data),

    deleteVipBenefitReward: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/admin/vip-benefits/rewards/${id}`),

    // ==================== 托管管理 ====================

    getHostingOwners: (params?: {
      page?: number
      pageSize?: number
      search?: string
      sortBy?: 'vipLevel' | 'hostingBalance' | 'frozenBalance' | 'totalIncome' | 'hostCount' | 'packageCount' | 'instanceCount'
      sortOrder?: 'asc' | 'desc'
    }): Promise<{
      owners: Array<{
        id: number
        username: string
        email: string | null
        status: string
        avatarStyle: string
        avatarBadgeId?: string | null
        vipLevel: number
        vipBadgeStyle?: VipBadgeStyle | null
        hostingBalance: {
          available: number
          frozen: number
          total: number
          historicalTotal: number
        }
        hostCount: number
        listedPackageCount: number
        instanceCount: number
        createdAt: string
        hostingZoneId: number | null
      }>
      summary: {
        totalHosts: number
        totalListedPackages: number
        totalInstances: number
        totalAvailableBalance: number
        totalFrozenBalance: number
        totalHostingIncome: number
      }
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get('/admin/hosting/owners', { params }),
    getHostingZones: (): Promise<{
      zones: Array<{
        id: number
        name: string
        logoUrl: string
        active: boolean
        sortOrder: number
        createdAt: string
        updatedAt: string
        listedPackageCount: number
        hostCount: number
        owner: {
          id: number
          username: string
          email: string | null
          avatarStyle: string
          avatarBadgeId?: string | null
        }
      }>
    }> => http.get('/admin/hosting/zones'),
    createHostingZone: (data: { name: string; ownerId: number; logoUrl: string }): Promise<{
      zone: {
        id: number
        name: string
        logoUrl: string
        active: boolean
        sortOrder: number
        createdAt: string
        updatedAt: string
        listedPackageCount: number
        hostCount: number
        owner: {
          id: number
          username: string
          email: string | null
          avatarStyle: string
          avatarBadgeId?: string | null
        }
      }
      message: string
    }> => http.post('/admin/hosting/zones', data),
    deleteHostingZone: (id: number): Promise<{ message: string }> =>
      http.delete(`/admin/hosting/zones/${id}`),

    // ==================== 计费管理 ====================

    // 获取计费概览
    getBillingOverview: (): Promise<{
      overview: {
        totalRevenue: number
        thisMonthRevenue: number
        lastMonthRevenue: number
        todayRevenue: number
        totalRefunds: number
        netRevenue: number
        paidInstancesCount: number
        activePaidInstancesCount: number
        suspendedCount: number
        expiringCount: number
        revenueMix: {
          direct: {
            totalAmount: number
            thisMonthAmount: number
            todayAmount: number
          }
          hosted: {
            totalAmount: number
            thisMonthAmount: number
            todayAmount: number
          }
        }
        recharge: {
          totalAmount: number
          totalCount: number
          thisMonthAmount: number
          thisMonthCount: number
          todayAmount: number
          todayCount: number
        }
        aff: {
          totalCommission: number
          totalOrders: number
          thisMonthCommission: number
          totalConverted: number
          pendingConvertCount: number
        }
      }
    }> => http.get('/admin/billing/overview'),

    // 获取扣费记录
    getBillingRecords: (params?: { page?: number; pageSize?: number; type?: string; userId?: number; instanceId?: number }): Promise<{
      records: Array<{
        id: number
        type: string
        amount: number
        months: number | null
        periodStart: string | null
        periodEnd: string | null
        remark: string | null
        createdAt: string
        instance: { id: number; name: string } | null
        user: { id: number; username: string } | null
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/billing/records', { params }),

    // 获取付费实例列表
    getBillingInstances: (params?: { page?: number; pageSize?: number; status?: string; expiring?: boolean; hostId?: number | ''; search?: string }): Promise<{
      instances: Array<{
        id: number
        incusId: string
        name: string
        status: string
        user: { id: number; username: string }
        host: { id: number; name: string; instanceType?: string } | null
        package: { id: number; name: string } | null
        packagePlan: { id: number; name: string } | null
        packagePlanId: number | null
        billingPrice: number | null
        billingCycle: number | null
        expiresAt: string | null
        createdAt: string
        remainingDays: number | null
        instanceTypeLabel: string
        autoRenew: boolean
        suspendedAt: string | null
        suspendReason: string | null
      }>
      total: number
      page: number
      pageSize: number
      hosts: Array<{ id: number; name: string }>  // 有付费实例的节点列表
    }> => http.get('/admin/billing/instances', { params }),

    // 管理员封停实例
    suspendInstance: (instanceId: number, reason?: string): Promise<{
      success: boolean
      message: string
    }> => http.post(`/admin/instances/${instanceId}/suspend`, { reason }),

    // 管理员解封实例
    unsuspendInstance: (instanceId: number): Promise<{
      success: boolean
      message: string
    }> => http.post(`/admin/instances/${instanceId}/unsuspend`),

    // 管理员延期实例
    extendInstance: (instanceId: number, days: number, reason?: string, freeExtend?: boolean): Promise<{
      success: boolean
      message: string
      amount: number
      newExpiresAt: string
    }> => http.post(`/admin/instances/${instanceId}/extend`, { days, reason, freeExtend }),

    // 管理员退款
    refundInstance: (instanceId: number, amount: number, reason: string): Promise<{
      success: boolean
      message: string
      amount: number
      maxRefundable: number
    }> => http.post(`/admin/instances/${instanceId}/refund`, { amount, reason }),

    // 管理员删除并退款
    deleteAndRefundInstance: (instanceId: number, refundType: 'remaining' | 'full', reason: string, databaseOnly: boolean = false): Promise<{
      success: boolean
      message: string
      refundAmount: number
      refundType: string
    }> => http.post(`/admin/instances/${instanceId}/delete-and-refund`, { refundType, reason, databaseOnly }),

    // 为实例应用AFF优惠码
    applyAffCode: (instanceId: number, affCode: string): Promise<{
      success: boolean
      message: string
      discountRate: number
    }> => http.post(`/admin/instances/${instanceId}/apply-aff`, { affCode }),

    // 修改实例专属价格
    updateInstancePrice: (instanceId: number, newPrice: number, settleBalance: boolean, expectedVersion?: number): Promise<{
      success: boolean
      message: string
      oldPrice: number
      newPrice: number
      priceDiff: number
      remainingDays: number
      billingCycle: number
    }> => http.post(`/admin/instances/${instanceId}/update-price`, { newPrice, settleBalance, expectedVersion }),

    previewInstancePriceUpdate: (instanceId: number, newPrice: number, settleBalance: boolean): Promise<{
      oldPrice: number
      newPrice: number
      billingCycle: number
      remainingDays: number
      priceDiff: number
      discountRate: number
      userBalance: number
      instanceVersion: number
    }> => http.post(`/admin/instances/${instanceId}/update-price/preview`, { newPrice, settleBalance }),

    previewBatchInstancePriceUpdate: (instanceIds: number[], newPrice: number, settleBalance: boolean): Promise<{
      summary: {
        selectedCount: number
        validCount: number
        changedCount: number
        unchangedCount: number
        failedCount: number
        totalCharge: number
        totalRefund: number
        netAmount: number
      }
      canSubmit: boolean
      items: Array<{
        id: number
        name: string | null
        user: { id: number; username: string; balance: number } | null
        oldPrice: number | null
        newPrice: number
        billingCycle: number | null
        remainingDays: number
        priceDiff: number
        discountRate: number
        status: 'ready' | 'unchanged' | 'failed'
        error?: string
        instanceVersion?: number
      }>
      userImpacts: Array<{
        userId: number
        username: string
        balanceBefore: number
        balanceAfter: number
        totalCharge: number
        totalRefund: number
        netDiff: number
        insufficientBalance: boolean
      }>
    }> => http.post('/admin/instances/batch-update-price/preview', { instanceIds, newPrice, settleBalance }, { timeout: TIMEOUT.MEDIUM }),

    updateBatchInstancePrice: (instanceIds: number[], newPrice: number, settleBalance: boolean, expectations?: Array<{ instanceId: number; version: number }>): Promise<{
      success: boolean
      message: string
      preview: {
        summary: {
          selectedCount: number
          validCount: number
          changedCount: number
          unchangedCount: number
          failedCount: number
          totalCharge: number
          totalRefund: number
          netAmount: number
        }
        canSubmit: boolean
        items: Array<{
          id: number
          name: string | null
          user: { id: number; username: string; balance: number } | null
          oldPrice: number | null
          newPrice: number
          billingCycle: number | null
          remainingDays: number
          priceDiff: number
          discountRate: number
          status: 'ready' | 'unchanged' | 'failed'
          error?: string
          instanceVersion?: number
        }>
        userImpacts: Array<{
          userId: number
          username: string
          balanceBefore: number
          balanceAfter: number
          totalCharge: number
          totalRefund: number
          netDiff: number
          insufficientBalance: boolean
        }>
      }
    }> => http.post('/admin/instances/batch-update-price', { instanceIds, newPrice, settleBalance, expectations }, { timeout: TIMEOUT.MEDIUM }),

    // 获取可升级的方案列表
    getAvailablePlans: (instanceId: number): Promise<{
      currentPlan: {
        id: number
        name: string
        price: number
        billingCycle: number
        monthlyPrice: number
        cpu: number
        memory: number
        disk: number
      }
      remainingDays: number
      availablePlans: Array<{
        id: number
        name: string
        description: string | null
        price: number
        billingCycle: number
        monthlyPrice: number
        priceDiff: number
        cpu: number
        memory: number
        disk: number
        portLimit: number
        snapshotLimit: number
        backupLimit: number
        siteLimit: number
        swapSize: number
        trafficLimit: string
        isSoldOut: boolean
        slaGuarantee: number | null
      }>
      userBalance: number
    }> => http.get(`/admin/instances/${instanceId}/available-plans`),

    // 升级实例方案
    upgradePlan: (instanceId: number, newPlanId: number): Promise<{
      success: boolean
      message: string
      priceDifference: number
      oldPlan: { id: number; name: string }
      newPlan: { id: number; name: string }
      resourcesSynced: boolean
    }> => http.post(`/admin/instances/${instanceId}/upgrade-plan`, { newPlanId }),

    // ==================== 充值记录管理 ====================

    // 获取充值记录列表
    getRechargeRecords: (params?: { page?: number; pageSize?: number; status?: string; userId?: number }): Promise<{
      records: Array<{
        id: number
        orderNo: string
        userId: number
        user: { id: number; username: string }
        amount: number
        payableAmount: number
        actualAmount: number | null
        fee: number
        status: string
        payMethod: string | null
        actualPaymentMethod: string | null
        paymentCurrency: string | null
        paymentNetwork: string | null
        paymentUuid: string | null
        paymentTxid: string | null
        invoiceCurrency: string | null
        gatewayStatus: string | null
        gatewayStatusDescription: string | null
        provider: { id: number; name: string; displayName: string; type: string } | null
        tradeNo: string | null
        createdAt: string
        paidAt: string | null
        completedAt: string | null
        expiresAt: string | null
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/billing/recharge-records', { params }),

    // 同步充值订单状态
    syncRechargeRecord: (id: number): Promise<{
      success: boolean
      synced: boolean
      status: string
      message: string
    }> => http.post(`/admin/billing/recharge-records/${id}/sync`),

    // 获取充值订单列表
    getRechargeOrders: (params?: { page?: number; pageSize?: number; status?: string; userId?: number }): Promise<{
      records: Array<{
        id: number
        orderNo: string
        userId: number
        amount: number
        actualAmount: number | null
        fee: number
        status: string
        provider: { id: number; name: string; type: string } | null
        createdAt: string
        completedAt: string | null
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/recharge/orders', { params }),

    // 获取充值统计
    getRechargeStats: (): Promise<{
      stats: {
        todayAmount: number
        todayCount: number
        thisMonthAmount: number
        thisMonthCount: number
        totalAmount: number
        totalCount: number
      }
    }> => http.get('/admin/recharge/stats'),

    // 手动完成充值订单
    completeRechargeOrder: (orderNo: string, tradeNo?: string): Promise<{
      success: boolean
      message: string
    }> => http.post(`/admin/recharge/orders/${orderNo}/complete`, { tradeNo }),

    // 手动失败充值订单
    failRechargeOrder: (orderNo: string, reason: string): Promise<{
      success: boolean
      message: string
    }> => http.post(`/admin/recharge/orders/${orderNo}/fail`, { reason }),

    // ==================== 用户余额管理 ====================

    // 获取用户余额
    getUserBalance: (userId: number): Promise<{
      userId: number
      username: string
      balance: number
      totalRecharge: number
      totalConsume: number
      totalRefund: number
    }> => http.get(`/balance/admin/${userId}`),

    // 获取用户余额日志
    getUserBalanceLogs: (userId: number, params?: { page?: number; pageSize?: number; type?: string; lotteryGift?: 'exclude' | 'only' }): Promise<{
      logs: Array<{
        id: number
        type: string
        amount: number
        balanceBefore: number
        balanceAfter: number
        orderId: string | null
        instanceId: number | null
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get(`/balance/admin/${userId}/logs`, { params }),

    // 调整用户余额
    adjustUserBalance: (userId: number, amount: number, remark: string): Promise<{
      message: string
      newBalance: number
      balanceLog: {
        id: number
        type: string
        amount: number
        balanceBefore: number
        balanceAfter: number
      } | null
    }> => http.post(`/balance/admin/${userId}/adjust`, { amount, remark }),

    // 赠送用户余额
    giftUserBalance: (userId: number, amount: number, remark?: string): Promise<{
      message: string
      newBalance: number
    }> => http.post(`/balance/admin/${userId}/gift`, { amount, remark }),

    // 获取用户托管余额明细
    getHostingBalanceLogs: (userId: number, params?: { page?: number; pageSize?: number }): Promise<{
      user: { id: number; username: string }
      available: number
      frozen: number
      logs: Array<{
        id: number
        type: string
        actionType: string | null
        amount: number
        frozen: boolean
        unfreezeAt: string | null
        description: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }> => http.get(`/users/${userId}/hosting-balance/logs`, { params }),

    // 调整用户托管余额
    adjustHostingBalance: (userId: number, type: 'available' | 'frozen', amount: number, reason: string): Promise<{
      success: boolean
      available: number
      frozen: number
    }> => http.post(`/users/${userId}/hosting-balance/adjust`, { type, amount, reason }),

    // ==================== 用户管理 ====================

    // 获取用户列表（搜索）
    getUsers: (params?: {
      search?: string
      searchFields?: string
      exact?: boolean
      page?: number
      pageSize?: number
    }): Promise<{
      users: Array<{
        id: number
        username: string
        email: string
        role: string
        status: string
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/users', { params }),

    // 按用户名精确查找用户
    lookupUser: (username: string): Promise<{
      user: {
        id: number
        username: string
        email: string | null
        role: string
        status: string
      }
    }> => http.get('/users/lookup', { params: { username } }),

    // ==================== 实例管理 ====================

    // 管理员创建实例（支持免费赠送或付费实例）
    createInstance: (data: {
      username: string
      name: string
      packageId: number
      image: string
      cpu?: number              // 免费实例自定义配置
      memory?: number           // 免费实例自定义配置
      disk?: number             // 免费实例自定义配置
      hostId?: number
      customInitCommandIds?: number[]
      planId?: number           // 付费方案ID（传入则创建付费实例）
      chargeFirstMonth?: boolean // 是否扣除首月费用（默认 true）
    }): Promise<{
      message: string
      instance: {
        id: number
        name: string
        incusId: string
        host: string
        status: string
        user: { id: number; username: string }
        sshPort: number
        rootPassword: string
        isPaid: boolean
        planName: string | null
        charged: boolean
        amount: number
        expiresAt: string | null
      }
    }> => http.post('/admin/instances/create', data)
  },

  // ==================== AFF 推荐计划 ====================
  aff: {
    // 获取 AFF 状态和统计
    getStatus: (): Promise<{
      activated: boolean
      totalEarnings: number
      totalConverted: number
      currentBalance: number
      totalCodes: number
      totalUsed: number
    }> => http.get('/aff/me'),

    // 获取我的优惠码列表（包括全局码）
    getCodes: (): Promise<{
      codes: Array<{
        id: number
        code: string
        packagePlanId: number | null
        planName: string | null
        packageName: string | null
        price: number | null
        isGlobal: boolean
        discountRate: number
        commissionRate: number
        usedCount: number
        totalEarnings: number
        createdAt: string
      }>
    }> => http.get('/aff/me/codes'),

    // 获取可创建优惠码的方案列表（包含全局码状态）
    getAvailablePlans: (): Promise<{
      plans: Array<{
        id: number
        name: string
        price: number
        packageName: string
        hasCode: boolean
      }>
      hasGlobalCode: boolean
    }> => http.get('/aff/me/available-plans'),

    // 创建优惠码（不传 packagePlanId 则创建全局码，固定 5% 折扣/5% 返利）
    createCode: (packagePlanId?: number): Promise<{
      message: string
      code: {
        id: number
        code: string
        packagePlanId: number | null
        isGlobal: boolean
        discountRate: number
        commissionRate: number
        createdAt: string
      }
    }> => {
      const body: { packagePlanId?: number } = {}
      if (packagePlanId !== undefined) body.packagePlanId = packagePlanId
      return http.post('/aff/me/codes', body)
    },

    // 删除优惠码（仅允许删除使用次数为 0 的优惠码）
    deleteCode: (codeId: number): Promise<{ message: string }> =>
      http.delete(`/aff/me/codes/${codeId}`),

    // 获取 AFF 收益日志
    getLogs: (params?: { page?: number; pageSize?: number; type?: string }): Promise<{
      logs: Array<{
        id: number
        type: string
        amount: number
        originalAmount: number | null
        balanceBefore: number
        balanceAfter: number
        affCodeId: number | null
        affCode: string | null
        instanceId: number | null
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/aff/me/logs', { params }),

    // 获取 AFF 收益榜单 TOP 10
    getLeaderboard: (): Promise<{
      leaderboard: Array<{
        rank: number
        username: string
        totalEarnings: number
        isCurrentUser: boolean
      }>
    }> => http.get('/aff/leaderboard'),

    // 验证优惠码
    validateCode: (code: string, packagePlanId: number): Promise<{
      valid: boolean
      discountRate?: number
    }> => http.post('/aff/validate', { code, packagePlanId }),

    // 创建转化申请
    createConvert: (amount: number): Promise<{
      message: string
      withdrawal: {
        id: number
        amount: number
        status: string
        createdAt: string
      }
    }> => http.post('/aff/me/convert', { amount }),

    // 获取我的转化申请
    getWithdrawals: (params?: { page?: number; pageSize?: number; status?: string }): Promise<{
      withdrawals: Array<{
        id: number
        amount: number
        status: string
        rejectReason: string | null
        reviewedAt: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/aff/me/withdrawals', { params }),

    // 管理员：获取所有转化申请
    adminGetWithdrawals: (params?: { page?: number; pageSize?: number; status?: string }): Promise<{
      withdrawals: Array<{
        id: number
        userId: number
        username: string
        userAffBalance: number
        amount: number
        status: string
        rejectReason: string | null
        reviewedBy: number | null
        reviewedAt: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/aff/admin/withdrawals', { params }),

    // 管理员：审核通过
    adminApprove: (withdrawalId: number): Promise<{ message: string }> =>
      http.post(`/aff/admin/withdrawals/${withdrawalId}/approve`),

    // 管理员：审核拒绝
    adminReject: (withdrawalId: number, reason: string): Promise<{ message: string }> =>
      http.post(`/aff/admin/withdrawals/${withdrawalId}/reject`, { reason })
  },

  // ==================== 娱乐系统 ====================
  entertainment: {
    // ==================== 积分相关 ====================

    // 获取用户积分信息
    getPoints: (): Promise<{
      points: number
      totalEarned: number
      totalSpent: number
      lastConvertedAt: string | null
      totalConsume: number
      convertedConsume: number
      convertibleAmount: number
      convertiblePoints: number
    }> => http.get('/entertainment/points'),

    // 兑换积分
    convertPoints: (): Promise<{
      success: boolean
      converted: number
      newPoints: number
      consumeConverted: number
    }> => http.post('/entertainment/points/convert'),

    // 获取积分变动日志
    getPointsLogs: (params?: { page?: number; pageSize?: number; type?: string }): Promise<{
      logs: Array<{
        id: number
        type: string
        amount: number
        pointsBefore: number
        pointsAfter: number
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/entertainment/points/logs', { params }),

    // ==================== 徽章相关 ====================

    getBadgeCatalog: (): Promise<{
      series: BadgeSeriesItem[]
      badges: BadgeCatalogItem[]
    }> => http.get('/entertainment/badges/catalog'),

    getBadgeOverview: (): Promise<BadgeOverview> => http.get('/entertainment/badges/overview'),

    drawBadgeRandom: (): Promise<{
      success: boolean
      currentPoints: number
      ownership: BadgeOwnership
    }> => http.post('/entertainment/badges/draw/random'),

    drawBadgeRandomMulti: (): Promise<BadgeMultiDrawResponse> => http.post('/entertainment/badges/draw/random-multi'),

    drawBadgeSelect: (badgeId: string): Promise<{
      success: boolean
      currentPoints: number
      ownership: BadgeOwnership
    }> => http.post('/entertainment/badges/draw/select', { badgeId }),

    applyBadgeToAvatar: (ownershipId: number): Promise<{
      success: boolean
      ownership: BadgeOwnership
    }> => http.post('/entertainment/badges/apply/avatar', { ownershipId }),

    applyBadgeToInstance: (ownershipId: number, instanceId: number): Promise<{
      success: boolean
      ownership: BadgeOwnership
    }> => http.post('/entertainment/badges/apply/instance', { ownershipId, instanceId }),

    unapplyBadge: (ownershipId: number): Promise<{
      success: boolean
      ownership: BadgeOwnership
    }> => http.post('/entertainment/badges/unapply', { ownershipId }),

    // ==================== 抽奖相关 ====================

    // 获取可用抽奖列表
    getLotteries: (): Promise<{
      lotteries: Array<{
        id: number
        name: string
        description: string | null
        costPoints: number
        startAt: string | null
        endAt: string | null
        totalDraws: number
        prizes: Array<{
          id: number
          name: string
          type: string
          probability: number
          remainQuantity: number | null
          totalQuantity: number | null
          displayOrder: number
          instanceDesc: string | null
        }>
      }>
    }> => http.get('/entertainment/lotteries'),

    // 获取抽奖详情
    getLottery: (id: number): Promise<{
      lottery: {
        id: number
        name: string
        description: string | null
        costPoints: number
        startAt: string | null
        endAt: string | null
        totalDraws: number
        prizes: Array<{
          id: number
          name: string
          type: string
          probability: number
          remainQuantity: number | null
          totalQuantity: number | null
          displayOrder: number
          instanceDesc: string | null
        }>
      }
    }> => http.get(`/entertainment/lotteries/${id}`),

    // 执行抽奖
    draw: (lotteryId: number): Promise<{
      success: boolean
      currentPoints: number
      record: {
        id: number
        prizeId: number
        prizeType: string
        prizeName: string
        prizeValue: number
        badgeOwnership: BadgeOwnership | null
        status: string
        pointsSpent: number
        createdAt: string
      }
      action: string | null
      message: string
    }> => http.post(`/entertainment/lotteries/${lotteryId}/draw`),

    // 十连抽
    drawMulti: (lotteryId: number): Promise<{
      success: boolean
      records: Array<{
        id: number
        prizeId: number
        prizeType: string
        prizeName: string
        prizeValue: number
        badgeOwnership: BadgeOwnership | null
        status: string
        pointsSpent: number
        createdAt: string
      }>
      totalDraws: number
      totalPointsSpent?: number
      stoppedAt?: number
      stopReason?: string
    }> => http.post(`/entertainment/lotteries/${lotteryId}/draw-multi`),

    // 获取用户中奖记录
    getLotteryRecords: (params?: { page?: number; pageSize?: number; prizeType?: string }): Promise<{
      records: Array<{
        id: number
        lotteryId: number
        lotteryName: string
        prizeType: string
        prizeName: string
        prizeValue: number
        instanceDesc: string | null
        status: string
        pointsSpent: number
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/entertainment/lottery-records', { params }),

    // ==================== 管理端 API ====================

    // 获取所有抽奖列表
    adminGetLotteries: (params?: { page?: number; pageSize?: number; isActive?: boolean }): Promise<{
      lotteries: Array<{
        id: number
        name: string
        description: string | null
        costPoints: number
        isActive: boolean
        startAt: string | null
        endAt: string | null
        totalDraws: number
        prizesCount: number
        recordsCount: number
        createdAt: string
        prizes: Array<{
          id: number
          name: string
          type: string
          value: number
          probability: number
          totalQuantity: number | null
          remainQuantity: number | null
          displayOrder: number
          instanceDesc: string | null
        }>
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/entertainment/lotteries', { params }),

    // 创建抽奖
    adminCreateLottery: (data: {
      name: string
      description?: string
      costPoints: number
      isActive?: boolean
      startAt?: string
      endAt?: string
    }): Promise<{ success: boolean; lottery: { id: number; name: string } }> =>
      http.post('/admin/entertainment/lotteries', data),

    // 更新抽奖
    adminUpdateLottery: (id: number, data: {
      name?: string
      description?: string
      costPoints?: number
      isActive?: boolean
      startAt?: string | null
      endAt?: string | null
    }): Promise<{ success: boolean }> =>
      http.put(`/admin/entertainment/lotteries/${id}`, data),

    // 删除抽奖
    adminDeleteLottery: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/admin/entertainment/lotteries/${id}`),

    // 获取抽奖详情
    adminGetLottery: (id: number): Promise<{
      lottery: {
        id: number
        name: string
        description: string | null
        costPoints: number
        isActive: boolean
        startAt: string | null
        endAt: string | null
        totalDraws: number
        createdAt: string
        prizes: Array<{
          id: number
          name: string
          type: string
          value: number
          probability: number
          totalQuantity: number | null
          remainQuantity: number | null
          displayOrder: number
          instanceDesc: string | null
        }>
        notificationConfig: {
          enabled: boolean
          type: string
          config: Record<string, unknown>
          notifyBalance: boolean
          notifyInstance: boolean
        } | null
        stats: {
          totalDraws: number
          prizeStats: Array<{ type: string; count: number }>
        }
      }
    }> => http.get(`/admin/entertainment/lotteries/${id}`),

    // 添加奖品
    adminCreatePrize: (lotteryId: number, data: {
      name: string
      type: string
      value?: number
      probability: number
      totalQuantity?: number
      displayOrder?: number
      instanceDesc?: string
    }): Promise<{ success: boolean; prize: { id: number; name: string } }> =>
      http.post(`/admin/entertainment/lotteries/${lotteryId}/prizes`, data),

    // 更新奖品
    adminUpdatePrize: (prizeId: number, data: {
      name?: string
      type?: string
      value?: number
      probability?: number
      totalQuantity?: number | null
      remainQuantity?: number | null
      displayOrder?: number
      instanceDesc?: string | null
    }): Promise<{ success: boolean }> =>
      http.put(`/admin/entertainment/prizes/${prizeId}`, data),

    // 删除奖品
    adminDeletePrize: (prizeId: number): Promise<{ success: boolean }> =>
      http.delete(`/admin/entertainment/prizes/${prizeId}`),

    // 更新抽奖通知配置
    adminUpdateNotification: (lotteryId: number, data: {
      enabled: boolean
      type: string
      config: Record<string, unknown>
      notifyBalance: boolean
      notifyInstance: boolean
    }): Promise<{ success: boolean }> =>
      http.put(`/admin/entertainment/lotteries/${lotteryId}/notification`, data),

    adminGetBadgeCatalog: (): Promise<{
      series: BadgeSeriesItem[]
      badges: BadgeCatalogItem[]
    }> => http.get('/admin/entertainment/badges/catalog'),

    adminCreateBadgeSeries: (data: {
      id: string
      title: string
      nameZh: string
      nameEn?: string | null
      description: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }): Promise<{ success: boolean; series: BadgeSeriesItem }> =>
      http.post('/admin/entertainment/badges/series', data),

    adminUpdateBadgeSeries: (id: string, data: {
      title?: string
      nameZh?: string
      nameEn?: string | null
      description?: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }): Promise<{ success: boolean }> =>
      http.put(`/admin/entertainment/badges/series/${id}`, data),

    adminDeleteBadgeSeries: (id: string): Promise<{ success: boolean }> =>
      http.delete(`/admin/entertainment/badges/series/${id}`),

    adminCreateBadge: (data: {
      id: string
      name: string
      nameEn?: string | null
      fullLabel: string
      seriesId: string
      sourceId?: string | null
      sourceLabel?: string | null
      assetUrl: string
      assetUrlDark?: string | null
      assetUrlLight?: string | null
      displayOrder?: number
      isActive?: boolean
    }): Promise<{ success: boolean; badge: BadgeCatalogItem }> =>
      http.post('/admin/entertainment/badges', data),

    adminUpdateBadge: (id: string, data: {
      name?: string
      nameEn?: string | null
      fullLabel?: string
      seriesId?: string
      sourceId?: string | null
      sourceLabel?: string | null
      assetUrl?: string
      assetUrlDark?: string | null
      assetUrlLight?: string | null
      displayOrder?: number
      isActive?: boolean
    }): Promise<{ success: boolean }> =>
      http.put(`/admin/entertainment/badges/${id}`, data),

    adminDeleteBadge: (id: string): Promise<{ success: boolean }> =>
      http.delete(`/admin/entertainment/badges/${id}`),

    // 获取所有中奖记录
    adminGetLotteryRecords: (params?: {
      page?: number
      pageSize?: number
      lotteryId?: number
      prizeType?: string
      status?: string
      search?: string
    }): Promise<{
      records: Array<{
        id: number
        lotteryId: number
        lotteryName: string
        userId: number
        username: string
        userAvatar: string
        prizeType: string
        prizeName: string
        prizeValue: number
        status: string
        pointsSpent: number
        deliveredAt: string | null
        deliveredBy: number | null
        ticketId: number | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/entertainment/lottery-records', { params }),

    // 标记实例奖励为已发放
    adminDeliverPrize: (recordId: number, ticketId?: number): Promise<{ success: boolean }> =>
      http.post(`/admin/entertainment/lottery-records/${recordId}/deliver`, { ticketId }),

    // 获取所有用户积分列表
    adminGetUserPoints: (params?: {
      page?: number
      pageSize?: number
      search?: string
      orderBy?: string
      order?: string
    }): Promise<{
      records: Array<{
        userId: number
        username: string
        userAvatar: string
        points: number
        totalEarned: number
        totalSpent: number
        convertedConsume: number
        lastConvertedAt: string | null
        updatedAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/admin/entertainment/user-points', { params }),

    // 调整用户积分
    adminAdjustPoints: (userId: number, amount: number, remark: string): Promise<{
      success: boolean
      newPoints: number
    }> => http.post(`/admin/entertainment/user-points/${userId}/adjust`, { amount, remark }),

    // 获取用户积分详情
    adminGetUserPointsDetail: (userId: number): Promise<{
      user: { id: number; username: string; avatarStyle: string; avatarBadgeId?: string | null }
      points: number
      totalEarned: number
      totalSpent: number
      convertedConsume: number
      lastConvertedAt: string | null
      totalConsume: number
      convertibleAmount: number
      convertiblePoints: number
    }> => http.get(`/admin/entertainment/user-points/${userId}`),

    // 获取用户积分日志
    adminGetUserPointsLogs: (userId: number, params?: { page?: number; pageSize?: number }): Promise<{
      logs: Array<{
        id: number
        type: string
        amount: number
        pointsBefore: number
        pointsAfter: number
        remark: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get(`/admin/entertainment/user-points/${userId}/logs`, { params })
  },

  // ==================== 托管余额 API ====================
  hosting: {
    // 检查托管准入条件
    checkAccess: (): Promise<{
      allowed: boolean
      reason?: string
      details?: {
        instanceCount: number
        hasCreatedHostBefore?: boolean
        featureEnabled?: boolean
        hiddenBySystemSetting?: boolean
      }
    }> => http.get('/hosting/access-check'),

    // 获取托管余额
    getBalance: (): Promise<{
      balance: {
        available: number
        frozen: number
        pendingWithdrawal: number
        totalIncome: number
        totalWithdrawn: number
      }
      config: {
        minWithdrawalAmount: number
        feeRateBalance: number
      }
    }> => http.get('/hosting/balance'),

    // 获取托管统计
    getStats: (): Promise<{
      stats: {
        myHostsCount: number
        instancesOnMyHosts: number
        uniqueCustomersCount: number
        monthIncome: number
        vipLevel: number
        vipBadgeStyle?: VipBadgeStyle | null
      }
      recentIncome: Array<{
        id: number
        amount: number
        instanceId: number | null
        remark: string | null
        createdAt: string
      }>
    }> => http.get('/hosting/stats'),

    // 获取托管余额日志
    getLogs: (params?: { page?: number; pageSize?: number; actionType?: string; frozen?: string; search?: string }): Promise<{
      logs: Array<{
        id: number
        type: string
        actionType: string | null
        amount: number
        frozen: boolean
        unfreezeAt: string | null
        relatedId: number | null
        remark: string | null
        createdAt: string
        instance: {
          id: number
          name: string
          buyer: {
            id: number
            username: string
            email: string | null
            avatarStyle: string
            avatarBadgeId?: string | null
          }
          host: {
            id: number
            name: string
          }
          package: {
            id: number
            name: string
          } | null
          plan: {
            id: number
            name: string
          } | null
        } | null
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/hosting/logs', { params }),

    // 申请提现
    withdraw: (data: { amount: number }): Promise<{
      message: string
      withdrawal: {
        id: number
        amount: number
        feeRate: number
        feeAmount: number
        actualAmount: number
        target: string
        status: string
        createdAt: string
      }
    }> => http.post('/hosting/withdraw', data),

    // 获取提现记录
    getWithdrawals: (params?: { page?: number; pageSize?: number; status?: string }): Promise<{
      records: Array<{
        id: number
        amount: number
        feeRate: number
        feeAmount: number
        actualAmount: number
        target: string
        status: string
        rejectReason: string | null
        processedAt: string | null
        createdAt: string
      }>
      total: number
      page: number
      pageSize: number
    }> => http.get('/hosting/withdrawals', { params }),

    getBlocks: (): Promise<{
      blocks: Array<{
        id: number
        blockedUserId: number
        username: string
        email: string | null
        avatarStyle: string
        avatarBadgeId?: string | null
        remark: string | null
        createdAt: string
      }>
    }> => http.get('/hosting/blocks'),

    searchBlockUsers: (keyword: string): Promise<{
      users: Array<{
        id: number
        username: string
        email: string | null
        avatarStyle: string
        avatarBadgeId?: string | null
        blocked: boolean
      }>
    }> => http.get('/hosting/blocks/search', { params: { keyword } }),

    blockUser: (data: { userId: number; remark?: string | null }): Promise<{
      block: {
        id: number
        blockedUserId: number
        username: string
        email: string | null
        avatarStyle: string
        avatarBadgeId?: string | null
        remark: string | null
        createdAt: string
      }
    }> => http.post('/hosting/blocks', data),

    unblockUser: (userId: number): Promise<{ success: boolean }> =>
      http.delete(`/hosting/blocks/${userId}`)
  },

  // ==================== VIP 等级 API ====================
  vipLevels: {
    getMyOverview: (): Promise<VipOverviewResponse> => http.get('/vip-levels/me')
  },

  // ==================== VIP 福利 API ====================
  vipBenefits: {
    getMyOverview: (): Promise<VipBenefitOverviewResponse> => http.get('/vip-benefits/me'),
    claim: (rewardId: number): Promise<{
      claim: VipBenefitClaim
      overview: VipBenefitOverviewResponse
    }> => http.post(`/vip-benefits/${rewardId}/claim`),
    claimAll: (): Promise<{
      claims: VipBenefitClaim[]
      overview: VipBenefitOverviewResponse
    }> => http.post('/vip-benefits/claim-all')
  },

  // 域名邮箱
  mail: {
    // 获取可购买的邮箱源和方案
    getSources: (): Promise<{
      sources: Array<{
        id: number
        name: string
        code: string
        plans: Array<{
          id: number
          name: string
          description: string | null
          domainLimit: number
          diskLimitGb: number
          billingCycle: 'monthly' | 'yearly'
          price: number
        }>
      }>
    }> => http.get('/mail/sources'),

    // 获取我的订阅
    getSubscription: (): Promise<{
      subscription: {
        id: number
        status: 'active' | 'expired' | 'suspended'
        expiresAt: string
        autoRenew: boolean
        source: { id: number; name: string; code: string }
        plan: {
          id: number
          name: string
          domainLimit: number
          diskLimitGb: number
          billingCycle: 'monthly' | 'yearly'
          price: number
        }
        usage: {
          domainCount: number
          accountCount: number
          diskUsedGb: number
        }
        domains: Array<{
          id: number
          domain: string
          status: 'pending' | 'verified' | 'suspended'
          accountCount: number
          diskUsedMb: number
          createdAt: string
        }>
      } | null
    }> => http.get('/mail/subscription'),

    // 购买订阅
    purchaseSubscription: (planId: number, affCode?: string): Promise<{
      subscription: {
        id: number
        status: string
        expiresAt: string
        source: { id: number; name: string }
        plan: { id: number; name: string }
      }
      discountApplied?: boolean
      discountAmount?: number
      finalPrice?: number
    }> => http.post('/mail/subscription', { planId, affCode }),

    // 验证优惠码
    validateAffCode: (code: string): Promise<{
      valid: boolean
      discountRate?: number
      commissionRate?: number
      error?: string
    }> => http.post('/mail/validate-aff', { code }),

    // 续费订阅
    renewSubscription: (months: number): Promise<{
      expiresAt: string
      discountApplied?: boolean
      discountAmount?: number
      finalPrice?: number
    }> =>
      http.post('/mail/subscription/renew', { months }),

    // 获取域名列表
    getDomains: (): Promise<{
      domains: Array<{
        id: number
        domain: string
        status: 'pending' | 'verified' | 'suspended'
        accountCount: number
        diskUsedMb: number
        verifiedAt: string | null
        createdAt: string
      }>
    }> => http.get('/mail/domains'),

    // 获取域名详情
    getDomain: (id: number): Promise<{
      domain: {
        id: number
        domain: string
        status: 'pending' | 'verified' | 'suspended'
        diskUsedMb: number
        verifiedAt: string | null
        createdAt: string
        accounts: Array<{
          id: number
          email: string
          username: string
          displayName: string | null
          diskLimitMb: number
          diskUsedMb: number
          isAdmin: boolean
          createdAt: string
        }>
      }
    }> => http.get(`/mail/domains/${id}`),

    // 添加域名
    addDomain: (domain: string): Promise<{
      domain: {
        id: number
        domain: string
        status: string
        createdAt: string
      }
    }> => http.post('/mail/domains', { domain }),

    // 刷新域名验证状态
    verifyDomain: (id: number): Promise<{
      status: string
      verified: boolean
      txtRecord?: string
    }> => http.post(`/mail/domains/${id}/verify`),

    // 获取域名 DNS 配置
    getDomainDns: (id: number): Promise<{
      verified: boolean
      txtRecord?: string
      dnsRecords?: Array<{ type: string; record: string; value: string; prio?: number }>
      mxRecords?: string[]
      spfRecord?: string
      dkimRecord?: string
      cnameRecords?: Array<{ record: string; value: string }>
    }> => http.get(`/mail/domains/${id}/dns`),

    // 删除域名
    deleteDomain: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/mail/domains/${id}`),

    // 获取邮箱账户列表
    getAccounts: (domainId: number): Promise<{
      accounts: Array<{
        id: number
        email: string
        username: string
        displayName: string | null
        diskLimitMb: number
        diskUsedMb: number
        isAdmin: boolean
        createdAt: string
      }>
    }> => http.get(`/mail/domains/${domainId}/accounts`),

    // 创建邮箱账户
    createAccount: (domainId: number, data: {
      username: string
      password: string
      displayName?: string
      diskLimitMb?: number
      isAdmin?: boolean
    }): Promise<{
      account: {
        id: number
        email: string
        username: string
        displayName: string | null
        diskLimitMb: number
        isAdmin: boolean
      }
    }> => http.post(`/mail/domains/${domainId}/accounts`, data),

    // 更新邮箱账户
    updateAccount: (domainId: number, accountId: number, data: {
      displayName?: string
      diskLimitMb?: number
    }): Promise<{
      account: {
        id: number
        email: string
        displayName: string | null
        diskLimitMb: number
      }
    }> => http.put(`/mail/domains/${domainId}/accounts/${accountId}`, data),

    // 重置邮箱账户密码
    resetAccountPassword: (domainId: number, accountId: number, password: string): Promise<{ success: boolean }> =>
      http.post(`/mail/domains/${domainId}/accounts/${accountId}/reset-password`, { password }),

    // 删除邮箱账户
    deleteAccount: (domainId: number, accountId: number): Promise<{ success: boolean }> =>
      http.delete(`/mail/domains/${domainId}/accounts/${accountId}`),

    // ==================== 管理员 API ====================

    // 获取所有邮箱源
    adminGetSources: (): Promise<{
      sources: Array<{
        id: number
        name: string
        code: string
        apiUrl: string
        apiKey: string
        smarterMailUrl: string
        enabled: boolean
        sortOrder: number
        planCount: number
        subscriptionCount: number
        domainCount: number
        createdAt: string
        updatedAt: string
      }>
    }> => http.get('/mail/admin/sources'),

    // 创建邮箱源
    adminCreateSource: (data: {
      name: string
      code: string
      apiUrl: string
      apiKey: string
      smarterMailUrl: string
      enabled?: boolean
      sortOrder?: number
    }): Promise<{ source: any }> => http.post('/mail/admin/sources', data),

    // 更新邮箱源
    adminUpdateSource: (id: number, data: {
      name?: string
      code?: string
      apiUrl?: string
      apiKey?: string
      smarterMailUrl?: string
      enabled?: boolean
      sortOrder?: number
    }): Promise<{ source: any }> => http.put(`/mail/admin/sources/${id}`, data),

    // 删除邮箱源
    adminDeleteSource: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/mail/admin/sources/${id}`),

    // 获取所有方案
    adminGetPlans: (): Promise<{
      plans: Array<{
        id: number
        sourceId: number
        name: string
        description: string | null
        domainLimit: number
        diskLimitGb: number
        billingCycle: 'monthly' | 'yearly'
        price: string
        enabled: boolean
        sortOrder: number
        source: { id: number; name: string; code: string }
        createdAt: string
        updatedAt: string
      }>
    }> => http.get('/mail/admin/plans'),

    // 创建方案
    adminCreatePlan: (data: {
      sourceId: number
      name: string
      description?: string
      domainLimit: number
      diskLimitGb: number
      billingCycle: 'monthly' | 'yearly'
      price: number
      enabled?: boolean
      sortOrder?: number
    }): Promise<{ plan: any }> => http.post('/mail/admin/plans', data),

    // 更新方案
    adminUpdatePlan: (id: number, data: {
      name?: string
      description?: string
      domainLimit?: number
      diskLimitGb?: number
      billingCycle?: 'monthly' | 'yearly'
      price?: number
      enabled?: boolean
      sortOrder?: number
    }): Promise<{ plan: any }> => http.put(`/mail/admin/plans/${id}`, data),

    // 删除方案
    adminDeletePlan: (id: number): Promise<{ success: boolean }> =>
      http.delete(`/mail/admin/plans/${id}`),

    // 获取所有订阅
    adminGetSubscriptions: (params?: {
      sourceId?: number
      status?: string
      search?: string
      page?: number
      pageSize?: number
    }): Promise<{
      subscriptions: Array<any>
      total: number
    }> => http.get('/mail/admin/subscriptions', { params }),

    // 获取所有域名
    adminGetDomains: (params?: {
      sourceId?: number
      status?: string
      search?: string
      page?: number
      pageSize?: number
    }): Promise<{
      domains: Array<any>
      total: number
    }> => http.get('/mail/admin/domains', { params }),

    // 管理员退订
    adminCancelSubscription: (id: number, data: {
      refundType: 'none' | 'full' | 'remaining'
      reason?: string
    }): Promise<{
      success: boolean
      refundAmount: number
      refundType: string
    }> => http.post(`/mail/admin/subscriptions/${id}/cancel`, data)
  }
}

export default api

// 导出各模块方便单独使用
export const authApi = api.auth
export const usersApi = api.users
export const instancesApi = api.instances
export const transfersApi = api.transfers
