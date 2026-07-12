<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import api, { type VipLevelProgress, type VipProgressCondition, type VipProgressMetric } from '@/api'
import Skeleton from '@/components/Skeleton.vue'
import { formatMemory, formatDisk, getStatusInfo } from '@/utils/formatters'
import type { Instance, UserBalance, UserLifecycleOffer } from '@/types/api'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import FlagIcon from '@/components/FlagIcon.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import PluginFrameSlot from '@/components/plugins/PluginFrameSlot.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { getRandomFunnyQuote } from '@/data/funnyQuotes'
import { freeSiteCopy } from '@/utils/freeSiteFun'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle, type VipBadgeStyle } from '@/utils/vipBadge'
import { entertainmentPath, instanceCreatePath, instanceDetailPath, instancesPath } from '@/utils/app-paths'
import { useReveal } from '@/composables/useReveal'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'DashboardView' })

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

// 遮蔽 IPv4 地址后两位，例如：1.2.3.4 -> 1.2.*.*
function maskIpv4(ip: string | null | undefined): string | null {
  if (!ip) return null
  const parts = ip.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`
  }
  return ip
}

function isIpv4Address(ip: string | null | undefined): boolean {
  if (!ip) return false
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)
}

// 获取显示的IP地址：有NAT的模式显示NAT公网IP，纯IPv6模式显示IPv6，其他显示内网IPv4
function getDisplayIp(instance: Instance): string | null {
  const networkMode = instance.networkMode || instance.network_mode
  // 有 NAT 端口映射的模式：显示 NAT 公网 IP
  const hasNat = networkMode === 'nat' || networkMode === 'nat_ipv6' || networkMode === 'nat_ipv6_nat'
  if (hasNat) {
    const natPublicIp = instance.natPublicIp || instance.host?.nat_public_ip
    if (isIpv4Address(natPublicIp)) {
      return maskIpv4(natPublicIp)
    }
    if (networkMode === 'nat_ipv6' && instance.ipv6) {
      return instance.ipv6
    }
    return maskIpv4(instance.ipv4)
  }
  // 纯 IPv6 模式：优先显示独立 IPv6
  if (networkMode === 'ipv6_only' && instance.ipv6) {
    return instance.ipv6
  }
  return maskIpv4(instance.ipv4)
}

// 从镜像名称提取发行版标识（用于 DistroIcon 组件）
function getDistroFromName(name: string): string {
  const lowerName = (name || '').toLowerCase()
  const distros = ['almalinux', 'alma', 'alpine', 'arch', 'centos', 'debian', 'fedora', 'gentoo', 'kali', 'mint', 'opensuse', 'suse', 'oracle', 'redhat', 'rhel', 'rockylinux', 'rocky', 'ubuntu', 'void']
  for (const distro of distros) {
    if (lowerName.includes(distro)) return distro
  }
  return 'linux'
}

// 获取付费实例的图标类型（根据节点名称判断）
// 返回 'pro' | 'prime' | 'peer' | null
function getPaidIconType(instance: Instance): 'pro' | 'prime' | 'peer' | null {
  // 只有付费实例才显示付费图标
  if (!instance.packagePlanId) return null
  
  // 如果节点名称以 PEER 开头（不区分大小写），则是托管实例，显示 peer 图标
  const hostName = instance.host?.name || ''
  if (/^PEER\d/i.test(hostName)) {
    return 'peer'
  }
  
  // 根据实例类型判断：虚拟机显示 prime，容器显示 pro
  return instance.instanceType === 'vm' ? 'prime' : 'pro'
}

// 格式化镜像名称：优先使用 imageName，否则去掉 images: 前缀
function formatImageName(image: string, imageName?: string | null): string {
  if (imageName) return imageName
  return image?.replace(/^images:/, '') || ''
}

function getInstanceTypeLabel(instance: Instance): string {
  const key = `instance.instanceType.${instance.instanceType === 'vm' ? 'vm' : 'container'}`
  const translated = t(key)
  return translated === key ? (instance.instanceType === 'vm' ? 'KVM' : 'LXC') : translated
}

function getHostName(instance: Instance): string {
  return instance.host?.name || t('dashboard.unknownHost')
}

function getStatusKey(instance: Instance): string {
  return instance.status?.toLowerCase() || 'unknown'
}

const { t, locale } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
void configStore.loadPublicConfig()

const footerTelegramLink = computed(() => {
  const link = configStore.footerTelegramLink?.trim()
  return link || null
})

// 随机骚话（页面加载时固定，不随刷新变化）
const funnyQuote = ref('')

function getTimeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('dashboard.greeting.morning')
  if (hour < 18) return t('dashboard.greeting.afternoon')
  return t('dashboard.greeting.evening')
}

const instances = ref<Instance[]>([])
const balanceOverview = ref<UserBalance>({
  balance: 0,
  frozen: 0,
  totalRecharge: 0,
  totalConsume: 0
})
const userVipLevel = ref(0)
const userVipBadgeStyle = ref<VipBadgeStyle | null>(null)
const userVipProgress = ref<VipLevelProgress | null>(null)
const userPoints = ref(0)
const lifecycleOffers = ref<UserLifecycleOffer[]>([])
const loading = ref(true)

let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  // 初始化随机骚话
  funnyQuote.value = getRandomFunnyQuote(locale.value)
  await loadData()
  refreshInterval = setInterval(loadData, 15000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})

// 当组件被 KeepAlive 停用时，暂停定时器
onDeactivated(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
})

// 当组件从 KeepAlive 缓存中激活时，恢复定时器并刷新数据
onActivated(async () => {
  // 恢复定时刷新
  if (!refreshInterval) {
    refreshInterval = setInterval(loadData, 15000)
  }
  // 立即刷新数据以确保最新
  await loadData()
})

async function loadData(): Promise<void> {
  try {
    // 如果用户未认证，停止定时刷新
    if (!authStore.isAuthenticated) {
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
      return
    }
    
    const [instancesRes, meRes, balanceRes, vipRes, pointsRes, offersRes] = await Promise.all([
      api.instances.list({ pageSize: 1000 }),  // 获取所有实例以确保统计准确
      api.auth.me(),
      api.billing.getUserBalance().catch(() => null),
      api.vipLevels.getMyOverview().catch(() => null),
      api.entertainment.getPoints().catch(() => null),
      api.userLifecycle.myOffers().catch(() => null)
    ])
    const res = instancesRes as { instances?: Instance[] }
    instances.value = res.instances || []
    if ((meRes as { user?: any }).user) {
      authStore.user = (meRes as { user: any }).user
    }
    if (balanceRes?.balance) {
      balanceOverview.value = balanceRes.balance
    }
    userVipLevel.value = normalizeVipLevel(vipRes?.userVipLevel)
    userVipBadgeStyle.value = userVipLevel.value > 0
      ? normalizeVipBadgeStyle(vipRes?.userVipBadgeStyle, userVipLevel.value)
      : null
    userVipProgress.value = vipRes?.userVipProgress || null
    userPoints.value = Number(pointsRes?.points || 0)
    lifecycleOffers.value = offersRes?.offers || []
  } catch (error: any) {
    console.error('Failed to load dashboard:', error)
    // 如果是认证错误（401），停止定时刷新
    if (error?.response?.status === 401 || error?.code === 'UNAUTHORIZED') {
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
    }
  } finally {
    loading.value = false
  }
}

const stats = computed(() => {
  const all = instances.value
  // 后端返回的状态值可能是首字母大写（Running, Stopped）或小写（running, stopped）
  // 使用 toLowerCase() 进行大小写不敏感的比较
  return {
    total: all.length,  // 已获取全部实例，直接使用数组长度
    running: all.filter(i => getStatusKey(i) === 'running').length,
    stopped: all.filter(i => getStatusKey(i) === 'stopped').length,
    creating: all.filter(i => getStatusKey(i) === 'creating').length
  }
})

const recentInstances = computed(() => instances.value.slice(0, 5))
const availableLifecycleOffers = computed(() => lifecycleOffers.value.filter(offer => !offer.used).slice(0, 3))

const statusOverviewItems = computed(() => [
  {
    key: 'running',
    label: t('dashboard.runningInstances'),
    value: stats.value.running,
    className: themeStore.isDark ? 'bg-emerald-500/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
  },
  {
    key: 'stopped',
    label: t('dashboard.stoppedInstances'),
    value: stats.value.stopped,
    className: themeStore.isDark ? 'bg-slate-500/12 text-slate-300' : 'bg-slate-100 text-slate-700'
  }
])

const instanceTypeStats = computed(() => {
  const vm = instances.value.filter(instance => instance.instanceType === 'vm').length
  return {
    vm,
    container: Math.max(instances.value.length - vm, 0)
  }
})

const balanceSummaryItems = computed(() => [
  {
    label: t('dashboard.totalRecharge'),
    value: formatCurrency(balanceOverview.value.totalRecharge || 0)
  },
  {
    label: t('dashboard.totalConsume'),
    value: formatCurrency(balanceOverview.value.totalConsume || 0)
  },
  {
    label: t('dashboard.userPoints'),
    value: formatPoints(userPoints.value)
  }
])

const accountPanelHint = computed(() => t('dashboard.walletHint'))

const memberBadgeStyle = computed(() => userVipLevel.value > 0 ? getVipBadgeInlineStyle(userVipBadgeStyle.value) : undefined)

const memberBadgeClass = computed(() => userVipLevel.value > 0
  ? 'border shadow-sm'
  : themeStore.isDark
    ? 'border border-gray-700 bg-gray-800 text-gray-300'
    : 'border border-gray-200 bg-gray-100 text-gray-700'
)

const overviewShellClass = computed(() => themeStore.isDark
  ? 'border-gray-800 bg-gray-950/70 shadow-black/20'
  : 'border-gray-200 bg-white shadow-gray-200/80'
)

const subtlePanelClass = computed(() => themeStore.isDark
  ? 'border-gray-800 bg-gray-900/50'
  : 'border-gray-200 bg-gray-50/70'
)

const instanceListSummary = computed(() => t('dashboard.instanceListSummary', {
  count: Math.min(recentInstances.value.length, instances.value.length),
  total: instances.value.length
}))

const vipProgressPercent = computed(() => {
  const progress = Number(userVipProgress.value?.progress || 0)
  return Math.max(0, Math.min(100, Math.round(progress)))
})

const vipProgressStyle = computed(() => ({ width: `${vipProgressPercent.value}%` }))

const vipProgressTargetText = computed(() => {
  const progress = userVipProgress.value
  if (!progress) return t('dashboard.vipProgressUnavailable')
  if (progress.nextLevel) {
    return t('dashboard.vipProgressToNext', {
      current: formatUserVipLevel(progress.currentLevel),
      next: formatUserVipLevel(progress.nextLevel)
    })
  }
  return progress.isMaxLevel ? t('dashboard.vipProgressMaxed') : t('dashboard.vipProgressNoRule')
})

const vipProgressHint = computed(() => {
  const progress = userVipProgress.value
  if (!progress?.nextLevel) return t('dashboard.vipProgressStableHint')
  if (progress.userMetric) {
    const metric = progress.conditions[0]?.metric
      ? getVipProgressMetricLabel(progress.conditions[0].metric)
      : t('dashboard.memberLevel')
    return t('dashboard.vipProgressSingleMetricHint', {
      level: formatUserVipLevel(progress.nextLevel),
      metric
    })
  }
  const key = progress.conditionMode === 'all' ? 'dashboard.vipProgressAllHint' : 'dashboard.vipProgressAnyHint'
  return t(key, { level: formatUserVipLevel(progress.nextLevel) })
})

const vipProgressConditions = computed(() => userVipProgress.value?.conditions || [])

const vipProgressConditionGridClass = computed(() => vipProgressConditions.value.length === 1
  ? 'grid-cols-1'
  : 'sm:grid-cols-2'
)

function formatCurrency(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

function getLifecycleOfferUnit(type: string): string {
  return type === 'c' ? '%' : type === 'r' || type === 'd' ? 'MB' : 'GB'
}

function formatPoints(points: number): string {
  const normalized = Number.isFinite(points) ? Math.max(points, 0) : 0
  return Math.floor(normalized).toLocaleString()
}

function getVipProgressMetricLabel(metric: VipProgressMetric): string {
  const keyMap: Record<VipProgressMetric, string> = {
    totalRecharge: 'dashboard.vipMetricTotalRecharge',
    totalConsume: 'dashboard.vipMetricTotalConsume',
    totalHostingIncome: 'dashboard.vipMetricTotalHostingIncome',
    instanceCount: 'dashboard.vipMetricInstanceCount'
  }
  return t(keyMap[metric])
}

function isVipCountMetric(metric: VipProgressMetric): boolean {
  return metric === 'instanceCount'
}

function formatVipProgressValue(condition: VipProgressCondition, value: number): string {
  return isVipCountMetric(condition.metric) ? String(Math.floor(value)) : formatCurrency(value)
}

function formatVipProgressRemaining(condition: VipProgressCondition): string {
  if (condition.matched) return t('dashboard.vipProgressConditionMet')
  if (isVipCountMetric(condition.metric)) {
    return String(Math.ceil(condition.remaining))
  }
  return formatCurrency(condition.remaining)
}

function normalizeVipLevel(level: unknown): number {
  const parsed = Number(level)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function formatUserVipLevel(level: unknown): string {
  const normalizedLevel = normalizeVipLevel(level)
  return normalizedLevel > 0 ? `VIP${normalizedLevel}` : t('dashboard.memberLevelBasic')
}

const greetingTitle = computed(() => {
  const username = authStore.user?.username || t('common.user')
  const level = normalizeVipLevel(userVipLevel.value)
  if (level <= 0) {
    return t('dashboard.greeting.basicUser', { username })
  }

  return t('dashboard.greeting.memberUser', {
    level: formatUserVipLevel(level),
    username
  })
})

const greetingText = computed(() => t('dashboard.greeting.full', {
  greeting: getTimeGreeting(),
  member: greetingTitle.value
}))

function getInstanceRowClass(): string {
  return themeStore.isDark
    ? 'border-gray-800 bg-gray-900/45 hover:border-gray-700 hover:bg-gray-900/70'
    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/80'
}
</script>

<template>
  <div ref="revealRoot" class="kawaii-page kawaii-dashboard-page nimbus-dashboard space-y-6 animate-fade-in">
    <!-- 页头：问候语 + 主 CTA -->
    <header data-reveal class="nimbus-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold tracking-tight text-themed sm:text-2xl">{{ greetingText }}</h1>
        <p class="nimbus-status-line mt-1.5 flex items-center gap-2 text-sm text-themed-muted">
          <span class="nimbus-live-dot" aria-hidden="true"></span>{{ funnyQuote }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <a
          v-if="footerTelegramLink"
          :href="footerTelegramLink"
          target="_blank"
          rel="noopener noreferrer"
          class="nimbus-icon-btn inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          title="Telegram"
          aria-label="Telegram"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
        <RouterLink :to="instanceCreatePath()" class="btn-primary w-full justify-center sm:w-auto">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ configStore.freeSiteMode ? freeSiteCopy.dashboardNewInstance : $t('dashboard.newInstance') }}
        </RouterLink>
      </div>
    </header>

    <ThemeTemplateSlot slot-name="user.dashboard.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />
    <ThemeTemplateSlot slot-name="user.dashboard.cards" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <!-- 指标卡：总实例 / 运行中 / 账户余额 / 积分 -->
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <!-- 总实例 -->
      <div class="nimbus-card nimbus-metric overflow-hidden p-4 sm:p-5" :class="overviewShellClass" style="--i: 0">
        <div class="flex items-start justify-between gap-3">
          <span class="nimbus-tile-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" />
              <path d="M7 7.5h.01M7 16.5h.01" />
            </svg>
          </span>
          <svg class="nimbus-spark" viewBox="0 0 60 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="nbSpark1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.26" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path class="nimbus-spark-area" d="M0 17L9 15L19 16L28 11L38 13L47 8L57 9L57 24L0 24Z" fill="url(#nbSpark1)" />
            <path class="nimbus-spark-line" d="M0 17L9 15L19 16L28 11L38 13L47 8L57 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <circle class="nimbus-spark-dot" cx="57" cy="9" r="2" fill="currentColor" />
          </svg>
        </div>
        <div class="mt-4 nimbus-metric-label">{{ t('dashboard.totalInstances') }}</div>
        <div class="mt-1 nimbus-metric-value font-mono tabular-nums">{{ stats.total }}</div>
        <div class="mt-1.5 nimbus-metric-delta">
          <span class="text-themed-muted">{{ t('dashboard.stoppedInstances') }}</span>
          <span class="font-mono tabular-nums text-themed">{{ stats.stopped }}</span>
        </div>
      </div>

      <!-- 运行中 -->
      <div class="nimbus-card nimbus-metric overflow-hidden p-4 sm:p-5" :class="overviewShellClass" style="--i: 1">
        <div class="flex items-start justify-between gap-3">
          <span class="nimbus-tile-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12h4l2 6 4-13 2 8h6" />
            </svg>
          </span>
          <svg class="nimbus-spark" viewBox="0 0 60 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="nbSpark2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.26" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path class="nimbus-spark-area" d="M0 18L9 13L19 15L28 9L38 10L47 6L57 4L57 24L0 24Z" fill="url(#nbSpark2)" />
            <path class="nimbus-spark-line" d="M0 18L9 13L19 15L28 9L38 10L47 6L57 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <circle class="nimbus-spark-dot" cx="57" cy="4" r="2" fill="currentColor" />
          </svg>
        </div>
        <div class="mt-4 nimbus-metric-label">{{ t('dashboard.runningInstances') }}</div>
        <div class="mt-1 nimbus-metric-value font-mono tabular-nums">{{ stats.running }}</div>
        <div class="mt-1.5 nimbus-metric-delta" :class="stats.running > 0 ? 'nimbus-metric-delta--up' : ''">
          <span class="nimbus-delta-chip">
            <svg v-if="stats.running > 0" class="h-3 w-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M6 2.5 10 8H2z" />
            </svg>
            <span class="font-mono tabular-nums">{{ stats.running }}</span>
          </span>
          <span class="text-themed-muted">/ {{ stats.total }} {{ t('dashboard.totalInstances') }}</span>
        </div>
      </div>

      <!-- 账户余额 -->
      <div class="nimbus-card nimbus-metric overflow-hidden p-4 sm:p-5" :class="overviewShellClass" style="--i: 2">
        <div class="flex items-start justify-between gap-3">
          <span class="nimbus-tile-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M3 8V7a2 2 0 0 1 2-2h11" /><path d="M16.5 12.5h.01" />
            </svg>
          </span>
          <svg class="nimbus-spark" viewBox="0 0 60 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="nbSpark3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.26" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path class="nimbus-spark-area" d="M0 15L9 16L19 12L28 13L38 8L47 10L57 6L57 24L0 24Z" fill="url(#nbSpark3)" />
            <path class="nimbus-spark-line" d="M0 15L9 16L19 12L28 13L38 8L47 10L57 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <circle class="nimbus-spark-dot" cx="57" cy="6" r="2" fill="currentColor" />
          </svg>
        </div>
        <div class="mt-4 nimbus-metric-label">{{ t('dashboard.accountOverview') }}</div>
        <div class="mt-1 nimbus-metric-value font-mono tabular-nums">{{ formatCurrency(balanceOverview.balance) }}</div>
        <div class="mt-1.5 nimbus-metric-delta">
          <span class="text-themed-muted">{{ t('dashboard.totalRecharge') }}</span>
          <span class="font-mono tabular-nums text-themed">{{ formatCurrency(balanceOverview.totalRecharge || 0) }}</span>
        </div>
      </div>

      <!-- 用户积分 -->
      <div class="nimbus-card nimbus-metric overflow-hidden p-4 sm:p-5" :class="overviewShellClass" style="--i: 3">
        <div class="flex items-start justify-between gap-3">
          <span class="nimbus-tile-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3.5 14.4 8.6 20 9.4l-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.6-.8z" />
            </svg>
          </span>
          <svg class="nimbus-spark" viewBox="0 0 60 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="nbSpark4" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.26" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path class="nimbus-spark-area" d="M0 16L9 14L19 15L28 11L38 12L47 9L57 7L57 24L0 24Z" fill="url(#nbSpark4)" />
            <path class="nimbus-spark-line" d="M0 16L9 14L19 15L28 11L38 12L47 9L57 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <circle class="nimbus-spark-dot" cx="57" cy="7" r="2" fill="currentColor" />
          </svg>
        </div>
        <div class="mt-4 nimbus-metric-label">{{ t('dashboard.userPoints') }}</div>
        <div class="mt-1 nimbus-metric-value font-mono tabular-nums">{{ formatPoints(userPoints) }}</div>
        <div class="mt-1.5 nimbus-metric-delta">
          <span class="text-themed-muted">{{ t('dashboard.memberLevel') }}</span>
          <span class="font-semibold text-themed">{{ formatUserVipLevel(userVipLevel) }}</span>
        </div>
      </div>
    </section>

    <!-- 两栏：账户总览（含会员进度） + 实例状态分布 -->
    <section data-reveal class="grid gap-4 lg:grid-cols-3">
      <!-- 左：账户总览 -->
      <div class="nimbus-card nimbus-card--hover p-5 sm:p-6 lg:col-span-2" :class="overviewShellClass">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="nimbus-eyebrow">{{ t('dashboard.accountOverview') }}</div>
            <div class="mt-3 break-all nimbus-hero-value font-mono tabular-nums">{{ formatCurrency(balanceOverview.balance) }}</div>
            <div class="mt-2 text-sm text-themed-muted">{{ accountPanelHint }}</div>
          </div>
          <span
            class="inline-flex max-w-[11rem] items-center rounded-full px-3 py-1.5 text-sm font-bold"
            :class="memberBadgeClass"
            :style="memberBadgeStyle"
          >
            {{ formatUserVipLevel(userVipLevel) }}
          </span>
        </div>

        <div class="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div
            v-for="item in balanceSummaryItems"
            :key="item.label"
            class="nimbus-inner rounded-xl border px-3.5 py-3"
            :class="subtlePanelClass"
          >
            <div class="text-xs text-themed-muted">{{ item.label }}</div>
            <div class="mt-1 truncate text-sm font-semibold text-themed">{{ item.value }}</div>
          </div>
        </div>

        <div class="nimbus-inner mt-4 rounded-xl border p-4" :class="subtlePanelClass">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-themed">{{ t('dashboard.vipProgressTitle') }}</div>
              <div class="mt-1 text-xs text-themed-muted">{{ vipProgressTargetText }}</div>
            </div>
            <div class="nimbus-pct inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold font-mono tabular-nums">
              {{ vipProgressPercent }}%
            </div>
          </div>

          <div class="nimbus-bar nimbus-bar--lg mt-4">
            <div class="nimbus-bar-fill nimbus-bar-fill--vip" :style="vipProgressStyle"></div>
          </div>
          <div class="mt-2 text-xs text-themed-muted">{{ vipProgressHint }}</div>

          <div v-if="vipProgressConditions.length > 0" class="mt-4 grid gap-2" :class="vipProgressConditionGridClass">
            <div
              v-for="condition in vipProgressConditions"
              :key="condition.metric"
              class="nimbus-inner rounded-xl border px-3.5 py-3"
              :class="subtlePanelClass"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-themed-muted">{{ getVipProgressMetricLabel(condition.metric) }}</span>
                <span
                  class="rounded-full px-2 py-0.5 text-[11px] font-semibold font-mono tabular-nums"
                  :class="condition.matched ? 'nimbus-chip-ok' : 'nimbus-chip-idle'"
                >
                  {{ condition.progress }}%
                </span>
              </div>
              <div class="mt-3 grid gap-2 sm:grid-cols-3">
                <div class="min-w-0 rounded-lg px-2.5 py-2" :class="subtlePanelClass">
                  <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressCurrent') }}</div>
                  <div class="mt-1 truncate text-sm font-semibold text-themed font-mono tabular-nums">{{ formatVipProgressValue(condition, condition.current) }}</div>
                </div>
                <div class="min-w-0 rounded-lg px-2.5 py-2" :class="subtlePanelClass">
                  <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressTarget') }}</div>
                  <div class="mt-1 truncate text-sm font-semibold text-themed font-mono tabular-nums">{{ formatVipProgressValue(condition, condition.target) }}</div>
                </div>
                <div class="min-w-0 rounded-lg px-2.5 py-2" :class="subtlePanelClass">
                  <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressRemaining') }}</div>
                  <div
                    class="mt-1 truncate text-sm font-semibold font-mono tabular-nums"
                    :class="condition.matched ? 'nimbus-ok-text' : 'nimbus-remaining'"
                  >
                    {{ formatVipProgressRemaining(condition) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="availableLifecycleOffers.length > 0" class="nimbus-inner mt-4 rounded-xl border p-4" :class="subtlePanelClass">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="text-sm font-semibold text-themed">可用运营优惠</div>
              <div class="mt-1 text-xs text-themed-muted">管理员为您定向发放的资源兑换码。</div>
            </div>
            <RouterLink
              :to="{ path: entertainmentPath(), query: { tab: 'checkin' } }"
              class="nimbus-ghost-btn inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold"
            >
              去兑换
            </RouterLink>
          </div>
          <div class="mt-3 grid gap-2">
            <div
              v-for="offer in availableLifecycleOffers"
              :key="offer.id"
              class="nimbus-inner rounded-xl border px-3 py-2"
              :class="subtlePanelClass"
            >
              <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-themed font-mono">{{ offer.code }}</div>
                  <div class="text-xs text-themed-muted">{{ offer.host.name }} · {{ offer.codeType }} +{{ offer.codeValue }}{{ getLifecycleOfferUnit(offer.codeType) }}</div>
                </div>
                <div class="text-xs text-themed-muted">{{ offer.expiresAt ? new Date(offer.expiresAt).toLocaleDateString() : '长期有效' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：实例状态分布 -->
      <div class="nimbus-card nimbus-card--hover flex flex-col p-5 sm:p-6" :class="overviewShellClass">
        <div class="flex items-start justify-between gap-3">
          <div class="nimbus-eyebrow">{{ t('dashboard.instanceStatusOverview') }}</div>
          <RouterLink :to="instancesPath()" class="nimbus-link inline-flex items-center gap-1 text-xs font-medium">
            {{ t('dashboard.viewAll') }}
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </RouterLink>
        </div>

        <div class="mt-3 flex items-end gap-2">
          <div class="nimbus-hero-value font-mono tabular-nums leading-none">{{ stats.total }}</div>
          <div class="pb-1 text-sm text-themed-muted">{{ t('dashboard.totalInstances') }}</div>
        </div>

        <div class="mt-5 space-y-4">
          <div v-for="item in statusOverviewItems" :key="item.key">
            <div class="flex items-center justify-between text-xs">
              <span class="nimbus-sname text-themed-muted">
                <span class="nimbus-sdot" :class="item.key === 'running' ? 'nimbus-sdot--ok' : 'nimbus-sdot--faint'"></span>{{ item.label }}
              </span>
              <span class="font-mono tabular-nums text-themed">{{ item.value }}</span>
            </div>
            <div class="nimbus-bar mt-2">
              <div class="nimbus-bar-fill" :class="item.key === 'running' ? 'nimbus-bar-fill--ok' : 'nimbus-bar-fill--faint'" :style="{ width: (stats.total ? Math.round((item.value / stats.total) * 100) : 0) + '%' }"></div>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between text-xs">
              <span class="nimbus-sname text-themed-muted">
                <span class="nimbus-sdot nimbus-sdot--accent"></span>{{ t('dashboard.containerInstances') }}
              </span>
              <span class="font-mono tabular-nums text-themed">{{ instanceTypeStats.container }}</span>
            </div>
            <div class="nimbus-bar mt-2">
              <div class="nimbus-bar-fill nimbus-bar-fill--accent" :style="{ width: (stats.total ? Math.round((instanceTypeStats.container / stats.total) * 100) : 0) + '%' }"></div>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between text-xs">
              <span class="nimbus-sname text-themed-muted">
                <span class="nimbus-sdot nimbus-sdot--faint"></span>{{ t('dashboard.vmInstances') }}
              </span>
              <span class="font-mono tabular-nums text-themed">{{ instanceTypeStats.vm }}</span>
            </div>
            <div class="nimbus-bar mt-2">
              <div class="nimbus-bar-fill nimbus-bar-fill--faint" :style="{ width: (stats.total ? Math.round((instanceTypeStats.vm / stats.total) * 100) : 0) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <PluginFrameSlot slot-name="user.dashboard.cards" surface="user" frame-class="min-h-[220px]" />

    <!-- 最近实例 -->
    <section data-reveal class="nimbus-card overflow-hidden" :class="overviewShellClass">
      <div class="nimbus-panel-head flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-base font-semibold text-themed">{{ $t('dashboard.myInstances') }}</h2>
          <p class="mt-1 text-xs text-themed-muted">{{ instanceListSummary }}</p>
        </div>
        <RouterLink
          :to="instancesPath()"
          class="nimbus-ghost-btn inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium"
        >
          {{ $t('dashboard.viewAll') }}
          <svg class="ml-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </RouterLink>
      </div>

      <div v-if="loading" class="space-y-3 p-4 sm:p-5">
        <div
          v-for="i in 3"
          :key="i"
          class="nimbus-inner rounded-xl border p-4"
          :class="subtlePanelClass"
        >
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex items-center gap-3">
              <Skeleton type="circle" size="44px" />
              <div class="min-w-0 flex-1 space-y-2">
                <Skeleton type="line" width="150px" height="15px" />
                <Skeleton type="line" width="210px" height="11px" />
              </div>
            </div>
            <div class="flex flex-wrap gap-2 lg:justify-end">
              <Skeleton v-for="metric in 3" :key="metric" type="line" width="74px" height="28px" />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="instances.length === 0" class="p-10 text-center">
        <div class="nimbus-empty-icon mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
          <svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
          </svg>
        </div>
        <p class="mb-4 text-sm text-themed-muted">{{ $t('dashboard.noInstances') }}</p>
        <RouterLink :to="instanceCreatePath()" class="btn-primary btn-sm">{{ configStore.freeSiteMode ? freeSiteCopy.dashboardCreateFirst : $t('dashboard.createFirst') }}</RouterLink>
      </div>

      <div v-else class="space-y-2.5 p-4 sm:p-5">
        <RouterLink
          v-for="instance in recentInstances"
          :key="instance.id"
          :to="instanceDetailPath(instance.id)"
          class="nimbus-row group relative block overflow-hidden rounded-xl border p-4"
          :class="getInstanceRowClass()"
        >
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-3">
                <div class="nimbus-row-icon flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-12 sm:w-12">
                  <InstanceDisplayIcon
                    v-if="instance.iconBadgeId || getPaidIconType(instance)"
                    :badge-id="instance.iconBadgeId"
                    :fallback-icon="getPaidIconType(instance)"
                    :alt="instance.name"
                    :size="48"
                  />
                  <DistroIcon
                    v-else
                    :distro="getDistroFromName(instance.image)"
                    :size="26"
                  />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="nimbus-row-name max-w-full truncate text-sm sm:text-[15px]">{{ instance.name }}</span>
                    <span :class="['badge inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] sm:text-[11px] flex-shrink-0', getStatusInfo(instance.status, t).class]">
                      <span :class="['h-1.5 w-1.5 rounded-full', getStatusInfo(instance.status, t).dot]"></span>
                      {{ getStatusInfo(instance.status, t).label }}
                    </span>
                    <span class="nimbus-chip-idle inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:text-[11px]">
                      {{ getInstanceTypeLabel(instance) }}
                    </span>
                  </div>

                  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-themed-muted">
                    <span class="max-w-[14rem] truncate font-mono sm:max-w-[22rem]">{{ formatImageName(instance.image, (instance as any).imageName) }}</span>
                    <span class="nimbus-dot">•</span>
                    <span class="font-mono tabular-nums text-themed">CPU {{ instance.cpu }}%</span>
                    <span class="nimbus-dot">•</span>
                    <span class="font-mono text-themed">{{ formatMemory(instance.memory) }}</span>
                    <span class="nimbus-dot">•</span>
                    <span class="font-mono text-themed">{{ formatDisk(instance.disk) }}</span>
                  </div>

                  <div class="nimbus-load mt-2.5 max-w-md">
                    <div
                      class="nimbus-load-fill"
                      :class="{
                        'nimbus-load-fill--danger': instance.cpu > 85,
                        'nimbus-load-fill--warn': instance.cpu > 60 && instance.cpu <= 85
                      }"
                      :style="{ width: Math.min(Math.max(instance.cpu, 0), 100) + '%' }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 lg:justify-end lg:pl-4">
              <span class="nimbus-meta-chip inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]">
                <FlagIcon :code="instance.host?.country_code || instance.hostCountryCode || 'us'" size="xs" />
                <span class="max-w-[8rem] truncate">{{ getHostName(instance) }}</span>
              </span>
              <span class="nimbus-meta-chip inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-mono">
                {{ getDisplayIp(instance) || $t('dashboard.noPublicIp') }}
              </span>
              <div class="nimbus-row-chevron hidden h-9 w-9 items-center justify-center rounded-lg lg:flex">
                <svg class="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </RouterLink>
      </div>

      <div v-if="instances.length > 5" class="nimbus-panel-foot border-t px-5 py-3 text-center">
        <RouterLink :to="instancesPath()" class="nimbus-link text-sm">
          {{ $t('dashboard.viewAllInstancesWithCount', { count: instances.length }) }} →
        </RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped>
/* ============================================================
   Nimbus console · Linear 级仪表盘（发丝线 + 柔阴影 + 单一靛蓝信号色）
   颜色全部走 --kawaii-* token，随 .light/.dark 自动明暗切换。
   本页局部语义变量 --nb-* 统一映射，便于收口质感。
   ============================================================ */
.nimbus-dashboard {
  --nb-accent: var(--kawaii-primary);
  --nb-accent-strong: var(--kawaii-primary-strong);
  --nb-green: var(--kawaii-mint);
  --nb-amber: var(--kawaii-amber);
  --nb-text: var(--kawaii-text);
  --nb-muted: var(--kawaii-muted);
  --nb-faint: var(--kawaii-faint);
  --nb-line: var(--kawaii-line);
  --nb-line-strong: var(--kawaii-line-strong);
  --nb-surface: var(--kawaii-surface);
  --nb-surface-soft: var(--kawaii-surface-soft);
  --nb-tint: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  --nb-tint-2: color-mix(in srgb, var(--kawaii-primary) 18%, transparent);
  --nb-glow: color-mix(in srgb, var(--kawaii-primary) 32%, transparent);
  --nb-green-tint: color-mix(in srgb, var(--kawaii-mint) 15%, transparent);
  --nb-display: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont,
    "SF Pro Display", "PingFang SC", "Noto Sans SC", sans-serif;
}

/* --- 卡片外壳：发丝线 + 多层柔阴影 --- */
.nimbus-card {
  position: relative;
  border: 1px solid var(--nb-line);
  border-radius: 14px;
  background: var(--nb-surface);
  box-shadow: var(--kawaii-shadow);
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease,
    border-color 0.22s ease;
}

/* 悬浮上浮 2px + accent 微光（大卡片与指标卡通用） */
.nimbus-card--hover:hover,
.nimbus-metric:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nb-accent) 42%, var(--nb-line));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--nb-accent) 22%, transparent),
    0 16px 38px -18px var(--nb-glow),
    0 4px 14px -8px rgb(15 23 42 / 0.14);
}

/* --- 页头图标按钮 --- */
.nimbus-icon-btn {
  color: var(--nb-accent);
  background: var(--nb-tint);
  transition: background 0.18s ease, transform 0.18s ease;
}
.nimbus-icon-btn:hover {
  background: var(--nb-tint-2);
  transform: translateY(-1px);
}

/* --- 页头实时状态行 --- */
.nimbus-status-line {
  color: var(--nb-muted);
}
.nimbus-live-dot {
  position: relative;
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--nb-green);
}
.nimbus-live-dot::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 999px;
  border: 1px solid var(--nb-green);
  opacity: 0;
  animation: nimbusPing 2.2s ease-out infinite;
}

/* --- 指标卡：错峰入场 --- */
.nimbus-metric {
  cursor: default;
  animation: nimbusRise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 80ms);
}

/* 左上图标块：accent-tint 底 + accent 图标 + 内发丝线 */
.nimbus-tile-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: var(--nb-accent);
  background: var(--nb-tint);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-accent) 10%, transparent);
  transition: background 0.18s ease;
}
.nimbus-tile-icon svg {
  width: 20px;
  height: 20px;
}
.nimbus-metric:hover .nimbus-tile-icon {
  background: var(--nb-tint-2);
}

/* 右上 sparkline：渐变面积 + 折线 draw 入场 + 端点圆点 */
.nimbus-spark {
  width: 60px;
  height: 24px;
  color: var(--nb-accent);
  flex-shrink: 0;
  overflow: visible;
}
.nimbus-spark-line {
  stroke-dasharray: 120;
  stroke-dashoffset: 120;
  animation: nimbusDraw 1.1s 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.nimbus-spark-area {
  opacity: 0;
  animation: nimbusFade 0.7s 0.5s ease forwards;
}
.nimbus-spark-dot {
  opacity: 0;
  animation: nimbusFade 0.35s 1.1s ease forwards;
}

.nimbus-metric-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nb-faint);
}

/* 收紧字距的 display 大数字 */
.nimbus-metric-value {
  font-family: var(--nb-display);
  font-size: 1.9rem;
  line-height: 1.05;
  font-weight: 640;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  color: var(--nb-text);
}

.nimbus-metric-delta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.76rem;
  color: var(--nb-muted);
}
.nimbus-delta-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
}
/* delta 绿色 chip（↑ 运行占比） */
.nimbus-metric-delta--up .nimbus-delta-chip {
  padding: 0.05rem 0.42rem 0.05rem 0.3rem;
  border-radius: 999px;
  background: var(--nb-green-tint);
  color: var(--nb-green);
  font-weight: 600;
}
.nimbus-metric-delta--up .nimbus-delta-chip svg {
  color: var(--nb-green);
}

/* --- 大标题数字 / 眉标 --- */
.nimbus-eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--nb-faint);
}

.nimbus-hero-value {
  font-family: var(--nb-display);
  font-size: 2.15rem;
  font-weight: 660;
  letter-spacing: -0.04em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  color: var(--nb-text);
}
@media (min-width: 640px) {
  .nimbus-hero-value {
    font-size: 2.5rem;
  }
}

/* --- 内层面板：柔和二级底 --- */
.nimbus-inner {
  border: 1px solid var(--nb-line);
  border-radius: 12px;
  background: var(--nb-surface-soft);
}

/* --- 进度条（会员成长 / 状态分布） --- */
.nimbus-bar {
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--nb-muted) 15%, transparent);
}
.nimbus-bar--lg {
  height: 8px;
}
.nimbus-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--nb-accent);
  transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
}
.nimbus-bar-fill--ok {
  background: var(--nb-green);
}
.nimbus-bar-fill--accent {
  background: var(--nb-accent);
}
.nimbus-bar-fill--faint {
  background: color-mix(in srgb, var(--nb-faint) 75%, transparent);
}
/* 会员成长：靛紫渐变 + 流光 shimmer */
.nimbus-bar-fill--vip {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, var(--nb-accent), var(--nb-accent-strong));
}
.nimbus-bar-fill--vip::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, #ffffff 55%, transparent),
    transparent
  );
  transform: translateX(-100%);
  animation: nimbusShimmer 2.6s ease-in-out infinite;
}

/* 状态行名称 + 圆点 */
.nimbus-sname {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.nimbus-sdot {
  display: inline-block;
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
}
.nimbus-sdot--ok {
  background: var(--nb-green);
  box-shadow: 0 0 0 3px var(--nb-green-tint);
}
.nimbus-sdot--accent {
  background: var(--nb-accent);
  box-shadow: 0 0 0 3px var(--nb-tint);
}
.nimbus-sdot--faint {
  background: var(--nb-faint);
}

.nimbus-pct {
  color: var(--nb-accent-strong);
  background: var(--nb-tint);
}

/* 语义 chip：已满足=绿，默认=中性 */
.nimbus-chip-ok {
  color: var(--nb-green);
  background: var(--nb-green-tint);
}
.nimbus-chip-idle {
  color: var(--nb-muted);
  background: color-mix(in srgb, var(--nb-muted) 12%, transparent);
}
.nimbus-ok-text {
  color: var(--nb-green);
}
/* 会员进度「还差」用 accent 语义色 */
.nimbus-remaining {
  color: var(--nb-accent-strong);
}

/* --- 链接 / 幽灵按钮 --- */
.nimbus-link {
  color: var(--nb-accent);
  transition: color 0.18s ease;
}
.nimbus-link:hover {
  color: var(--nb-accent-strong);
}

.nimbus-ghost-btn {
  border-color: var(--nb-line);
  color: var(--nb-muted);
  background: var(--nb-surface);
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.nimbus-ghost-btn:hover {
  color: var(--nb-text);
  border-color: color-mix(in srgb, var(--nb-accent) 45%, var(--nb-line));
  background: var(--nb-surface-soft);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--nb-accent) 15%, transparent);
}

/* --- 面板头/脚分隔线 --- */
.nimbus-panel-head,
.nimbus-panel-foot {
  border-color: var(--nb-line);
}

/* --- 最近实例行 --- */
.nimbus-row {
  border-color: var(--nb-line);
  border-radius: 12px !important;
  background: var(--nb-surface);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease,
    background-color 0.18s ease;
}
.nimbus-row:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nb-accent) 40%, var(--nb-line)) !important;
  background: color-mix(in srgb, var(--nb-accent) 5%, var(--nb-surface));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--nb-accent) 14%, transparent),
    0 12px 28px -18px var(--nb-glow);
}

.nimbus-row-name {
  font-weight: 620;
  letter-spacing: -0.01em;
  color: var(--nb-text);
}

.nimbus-row-icon {
  color: var(--nb-muted);
  background: color-mix(in srgb, var(--nb-muted) 12%, transparent);
  transition: background 0.18s ease, color 0.18s ease;
}
.nimbus-row:hover .nimbus-row-icon {
  color: var(--nb-accent);
  background: var(--nb-tint);
}

.nimbus-dot {
  color: color-mix(in srgb, var(--nb-muted) 50%, transparent);
}

.nimbus-meta-chip {
  color: var(--nb-muted);
  background: color-mix(in srgb, var(--nb-muted) 10%, transparent);
}

.nimbus-row-chevron {
  color: var(--nb-faint);
  background: color-mix(in srgb, var(--nb-muted) 10%, transparent);
  transition: background 0.18s ease, color 0.18s ease;
}
.nimbus-row:hover .nimbus-row-chevron {
  color: var(--nb-accent);
  background: var(--nb-tint);
}

/* --- 实例负载条：CPU 真实占用，>85% 转红，>60% 转琥珀 --- */
.nimbus-load {
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--nb-muted) 14%, transparent);
}
.nimbus-load-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--nb-accent);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}
.nimbus-load-fill--warn {
  background: var(--nb-amber);
}
.nimbus-load-fill--danger {
  background: #dc2626;
}

/* --- 空状态图标 --- */
.nimbus-empty-icon {
  color: var(--nb-faint);
  background: color-mix(in srgb, var(--nb-muted) 12%, transparent);
}

/* --- 入场 / 动效关键帧 --- */
@keyframes nimbusRise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes nimbusDraw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes nimbusFade {
  to {
    opacity: 1;
  }
}
@keyframes nimbusShimmer {
  0% {
    transform: translateX(-100%);
  }
  60%,
  100% {
    transform: translateX(320%);
  }
}
@keyframes nimbusPing {
  0% {
    transform: scale(0.7);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

/* --- 尊重减少动态 --- */
@media (prefers-reduced-motion: reduce) {
  .nimbus-metric {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .nimbus-card--hover:hover,
  .nimbus-metric:hover,
  .nimbus-row:hover {
    transform: none;
  }
  .nimbus-spark-line {
    animation: none;
    stroke-dashoffset: 0;
  }
  .nimbus-spark-area,
  .nimbus-spark-dot {
    animation: none;
    opacity: 1;
  }
  .nimbus-bar-fill,
  .nimbus-load-fill {
    transition: none;
  }
  .nimbus-bar-fill--vip::after,
  .nimbus-live-dot::after {
    animation: none;
  }
}
</style>
