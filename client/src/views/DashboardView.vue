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
import type { Instance, UserBalance } from '@/types/api'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import FlagIcon from '@/components/FlagIcon.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import { getRandomFunnyQuote } from '@/data/funnyQuotes'
import { freeSiteCopy } from '@/utils/freeSiteFun'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle, type VipBadgeStyle } from '@/utils/vipBadge'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'DashboardView' })

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
    
    const [instancesRes, meRes, balanceRes, vipRes, pointsRes] = await Promise.all([
      api.instances.list({ pageSize: 1000 }),  // 获取所有实例以确保统计准确
      api.auth.me(),
      api.billing.getUserBalance().catch(() => null),
      api.vipLevels.getMyOverview().catch(() => null),
      api.entertainment.getPoints().catch(() => null)
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
  <div class="space-y-6 animate-fade-in">
    <!-- 欢迎区域 -->
    <div class="page-header flex-col gap-4 sm:flex-row sm:gap-0">
      <div class="flex w-full items-start justify-between gap-3 sm:w-auto sm:items-center sm:justify-start">
        <div class="min-w-0 flex-1 sm:flex-none">
          <h1 class="page-title text-lg sm:text-xl">{{ greetingText }}</h1>
          <p class="page-description">{{ funnyQuote }}</p>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2 sm:hidden">
          <a
            v-if="footerTelegramLink"
            :href="footerTelegramLink"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors"
            :class="themeStore.isDark ? 'bg-sky-900/30 hover:bg-sky-900/50 text-sky-300' : 'bg-sky-100 hover:bg-sky-200 text-sky-600'"
            title="Telegram"
            aria-label="Telegram"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
          </a>
        </div>
      </div>
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <a
          v-if="footerTelegramLink"
          :href="footerTelegramLink"
          target="_blank"
          rel="noopener noreferrer"
          class="hidden sm:inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
          :class="themeStore.isDark ? 'bg-sky-900/30 hover:bg-sky-900/50 text-sky-300' : 'bg-sky-100 hover:bg-sky-200 text-sky-600'"
          title="Telegram"
          aria-label="Telegram"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
        <RouterLink to="/instances/create" class="btn-primary w-full sm:w-auto justify-center">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ configStore.freeSiteMode ? freeSiteCopy.dashboardNewInstance : $t('dashboard.newInstance') }}
        </RouterLink>
      </div>
    </div>

    <!-- 总览面板 -->
    <div class="grid gap-4">
      <section class="dashboard-overview-card relative overflow-hidden rounded-lg border p-5 shadow-sm sm:p-6" :class="overviewShellClass">
        <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-sky-500/12 via-emerald-400/8 to-transparent"></div>
        <div class="relative flex flex-col gap-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase text-themed-muted">{{ t('dashboard.instanceStatusOverview') }}</div>
                <RouterLink
                  to="/instances"
                  class="inline-flex items-center justify-center rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors sm:hidden"
                  :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/70 text-gray-200 hover:bg-gray-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                >
                  {{ t('dashboard.viewAll') }}
                  <svg class="ml-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </RouterLink>
              </div>
              <div class="mt-3 flex items-end gap-3">
                <div class="text-5xl font-black leading-none text-themed sm:text-6xl">{{ stats.total }}</div>
                <div class="pb-1 text-sm text-themed-muted">{{ t('dashboard.totalInstances') }}</div>
              </div>
            </div>

            <RouterLink
              to="/instances"
              class="hidden items-center justify-center rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors sm:inline-flex"
              :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/70 text-gray-200 hover:bg-gray-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
            >
              {{ t('dashboard.viewAll') }}
              <svg class="ml-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </RouterLink>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <div
              v-for="item in statusOverviewItems"
              :key="item.key"
              class="rounded-lg px-3 py-3"
              :class="item.className"
            >
              <div class="text-xl font-black leading-none sm:text-2xl">{{ item.value }}</div>
              <div class="mt-1 text-xs font-medium opacity-80">{{ item.label }}</div>
            </div>
            <div class="rounded-lg border px-3 py-3" :class="subtlePanelClass">
              <div class="text-xl font-black leading-none text-themed sm:text-2xl">{{ instanceTypeStats.container }}</div>
              <div class="mt-1 text-xs font-medium text-themed-muted">{{ t('dashboard.containerInstances') }}</div>
            </div>
            <div class="rounded-lg border px-3 py-3" :class="subtlePanelClass">
              <div class="text-xl font-black leading-none text-themed sm:text-2xl">{{ instanceTypeStats.vm }}</div>
              <div class="mt-1 text-xs font-medium text-themed-muted">{{ t('dashboard.vmInstances') }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="dashboard-overview-card relative overflow-hidden rounded-lg border p-5 shadow-sm sm:p-6" :class="overviewShellClass">
        <div class="relative flex h-full flex-col gap-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-semibold uppercase text-themed-muted">{{ t('dashboard.accountOverview') }}</div>
              <div class="mt-3 break-all text-3xl font-black leading-none text-teal-600 dark:text-teal-300 sm:text-4xl">
                {{ formatCurrency(balanceOverview.balance) }}
              </div>
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

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div
              v-for="item in balanceSummaryItems"
              :key="item.label"
              class="rounded-lg border px-3.5 py-3"
              :class="subtlePanelClass"
            >
              <div class="text-xs text-themed-muted">{{ item.label }}</div>
              <div class="mt-1 truncate text-sm font-semibold text-themed">{{ item.value }}</div>
            </div>
          </div>

          <div class="rounded-lg border p-4" :class="subtlePanelClass">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-themed">{{ t('dashboard.vipProgressTitle') }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ vipProgressTargetText }}</div>
              </div>
              <div
                class="inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold"
                :class="themeStore.isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-700'"
              >
                {{ vipProgressPercent }}%
              </div>
            </div>

            <div class="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div class="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500 transition-all duration-500" :style="vipProgressStyle"></div>
            </div>
            <div class="mt-2 text-xs text-themed-muted">{{ vipProgressHint }}</div>

            <div v-if="vipProgressConditions.length > 0" class="mt-4 grid gap-2" :class="vipProgressConditionGridClass">
              <div
                v-for="condition in vipProgressConditions"
                :key="condition.metric"
                class="rounded-lg border px-3.5 py-3"
                :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-white'"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-themed-muted">{{ getVipProgressMetricLabel(condition.metric) }}</span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    :class="condition.matched
                      ? (themeStore.isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700')
                      : (themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600')"
                  >
                    {{ condition.progress }}%
                  </span>
                </div>
                <div class="mt-3 grid gap-2 sm:grid-cols-3">
                  <div class="min-w-0 rounded-md px-2.5 py-2" :class="subtlePanelClass">
                    <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressCurrent') }}</div>
                    <div class="mt-1 truncate text-sm font-semibold text-themed">{{ formatVipProgressValue(condition, condition.current) }}</div>
                  </div>
                  <div class="min-w-0 rounded-md px-2.5 py-2" :class="subtlePanelClass">
                    <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressTarget') }}</div>
                    <div class="mt-1 truncate text-sm font-semibold text-themed">{{ formatVipProgressValue(condition, condition.target) }}</div>
                  </div>
                  <div class="min-w-0 rounded-md px-2.5 py-2" :class="subtlePanelClass">
                    <div class="text-[11px] text-themed-muted">{{ t('dashboard.vipProgressRemaining') }}</div>
                    <div
                      class="mt-1 truncate text-sm font-semibold"
                      :class="condition.matched ? 'text-emerald-600 dark:text-emerald-300' : 'text-themed'"
                    >
                      {{ formatVipProgressRemaining(condition) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <!-- 实例列表 -->
    <div class="card overflow-hidden">
      <div 
        class="px-4 py-4 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
      >
        <div>
          <h2 class="text-base font-semibold text-themed">{{ $t('dashboard.myInstances') }}</h2>
          <p class="mt-1 text-xs text-themed-muted">{{ instanceListSummary }}</p>
        </div>
        <RouterLink 
          to="/instances" 
          class="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          :class="themeStore.isDark ? 'bg-gray-900 text-gray-300 hover:bg-gray-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
        >
          {{ $t('dashboard.viewAll') }}
          <svg class="ml-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </RouterLink>
      </div>

      <div v-if="loading" class="p-3 sm:p-4">
        <div class="space-y-3">
          <div
            v-for="i in 3"
            :key="i"
            class="rounded-lg border p-3.5 sm:p-4"
            :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50/60'"
          >
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex items-center gap-3">
                <Skeleton type="circle" size="11px" />
                <div class="space-y-2 min-w-0 flex-1">
                  <Skeleton type="line" width="150px" height="15px" />
                  <Skeleton type="line" width="210px" height="11px" />
                </div>
              </div>
              <div class="flex flex-wrap gap-2 lg:justify-end">
                <Skeleton v-for="metric in 4" :key="metric" type="line" width="74px" height="28px" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="instances.length === 0" class="p-8 text-center">
        <div 
          class="w-16 h-16 mx-auto mb-4 rounded-lg flex items-center justify-center"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
        >
          <svg 
            class="w-8 h-8" 
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
          </svg>
        </div>
        <p class="text-themed-muted text-sm mb-4">{{ $t('dashboard.noInstances') }}</p>
        <RouterLink to="/instances/create" class="btn-primary btn-sm">{{ configStore.freeSiteMode ? freeSiteCopy.dashboardCreateFirst : $t('dashboard.createFirst') }}</RouterLink>
      </div>

      <div v-else class="p-3 sm:p-4">
        <RouterLink 
          v-for="instance in recentInstances" 
          :key="instance.id"
          :to="`/instances/${instance.id}`"
          class="group relative block overflow-hidden rounded-lg border p-3.5 transition-all duration-200 mb-3 last:mb-0 sm:p-4"
          :class="getInstanceRowClass()"
        >
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-3">
                <div 
                  class="w-11 h-11 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors overflow-hidden"
                  :class="themeStore.isDark ? 'bg-gray-800 group-hover:bg-gray-700' : 'bg-gray-100 group-hover:bg-gray-200'"
                >
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
                    <span 
                      class="max-w-full truncate text-sm sm:text-[15px] font-semibold"
                      :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                    >
                      {{ instance.name }}
                    </span>
                    <span :class="['badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] flex-shrink-0', getStatusInfo(instance.status, t).class]">
                      <span :class="['w-1.5 h-1.5 rounded-full', getStatusInfo(instance.status, t).dot]"></span>
                      {{ getStatusInfo(instance.status, t).label }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium"
                      :class="instance.instanceType === 'vm'
                        ? (themeStore.isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-700')
                        : (themeStore.isDark ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-100 text-sky-700')"
                    >
                      {{ getInstanceTypeLabel(instance) }}
                    </span>
                  </div>

                  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span class="truncate max-w-[14rem] sm:max-w-[22rem]" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
                      {{ formatImageName(instance.image, (instance as any).imageName) }}
                    </span>
                    <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-300'">•</span>
                    <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">CPU {{ instance.cpu }}%</span>
                    <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-300'">•</span>
                    <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatMemory(instance.memory) }}</span>
                    <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-300'">•</span>
                    <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatDisk(instance.disk) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 lg:justify-end lg:pl-4">
              <span
                class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
              >
                <FlagIcon :code="instance.host?.country_code || instance.hostCountryCode || 'us'" size="xs" />
                <span class="truncate max-w-[8rem]">{{ getHostName(instance) }}</span>
              </span>
              <span
                class="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-mono"
                :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
              >
                {{ getDisplayIp(instance) || $t('dashboard.noPublicIp') }}
              </span>
              <div
                class="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
                :class="themeStore.isDark ? 'bg-gray-800 text-gray-500 group-hover:bg-gray-700 group-hover:text-gray-300' : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200 group-hover:text-gray-700'"
              >
                <svg 
                  class="w-4 h-4 transition-transform group-hover:translate-x-0.5" 
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </RouterLink>
      </div>

      <div 
        v-if="instances.length > 5" 
        class="px-4 py-3 border-t text-center"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
      >
        <RouterLink 
          to="/instances" 
          class="text-sm transition-colors"
          :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'"
        >
          {{ $t('dashboard.viewAllInstancesWithCount', { count: instances.length }) }} →
        </RouterLink>
      </div>
    </div>
  </div>
</template>
<style scoped>
.dashboard-overview-card {
  min-height: 260px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.dashboard-overview-card:hover {
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .dashboard-overview-card {
    min-height: auto;
  }
}
</style>
