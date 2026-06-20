<script setup lang="ts">
/**
 * 套餐方案选择器
 * 用于付费套餐，显示可选的付费方案列表
 * 现代化卡片式布局，清晰的参数分组
 */
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { getFreeSiteBillingCycleLabel } from '@/utils/freeSiteFun'

interface PackagePlan {
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
}

interface Props {
  plans: PackagePlan[]
  selectedPlanId: number | null
  instanceType?: 'container' | 'vm'
  loading?: boolean
  stepNumber?: number  // 步骤编号，默认 2
  prerequisiteMessage?: string | null
  freeSiteMode?: boolean
  title?: string
  description?: string
  emptyMessage?: string
  soldOutLabel?: string
  customPlanHint?: string
}

const props = withDefaults(defineProps<Props>(), {
  stepNumber: 2,
  title: undefined,
  description: undefined,
  emptyMessage: undefined,
  soldOutLabel: undefined,
  customPlanHint: undefined
})
const emit = defineEmits<{
  select: [plan: PackagePlan]
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

function formatMemory(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB'
  return mb + ' MB'
}

function formatDisk(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

function formatTraffic(bytes: string): string {
  const b = BigInt(bytes || '0')
  if (b >= BigInt(1024 * 1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024 * 1024)).toFixed(1) + ' TB'
  }
  if (b >= BigInt(1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024)).toFixed(0) + ' GB'
  }
  return (Number(b) / (1024 * 1024)).toFixed(0) + ' MB'
}

function getBillingCycleLabel(days: number): string {
  if (props.freeSiteMode) return getFreeSiteBillingCycleLabel(days)
  switch (days) {
    case 1: return t('billing.cycle.monthly')
    case 3: return t('billing.cycle.quarterly')
    case 6: return t('billing.cycle.semiAnnual')
    case 12: return t('billing.cycle.annual')
    default: return `${days} ${t('billing.cycle.months')}`
  }
}

function formatLimit(limit: number): string {
  // 0 表示没有配额，不是无限制
  return String(limit)
}

// 格式化带宽限制速度，统一换算成 Mbps
function formatBandwidth(speed: string | null | undefined): string {
  if (!speed || speed === '0') return t('traffic.unlimited')

  // 如果是带单位的字符串（如 "100Mbit"），转换显示格式
  if (/Mbit$/i.test(speed)) {
    return speed.replace(/Mbit$/i, ' Mbps')
  }
  if (/Gbit$/i.test(speed)) {
    const value = parseFloat(speed)
    return (value * 1024) + ' Mbps'
  }

  // 如果是纯数字（字节数表示，1GB=1Gbps），换算成 Mbps
  const bytes = BigInt(speed)
  const GB = BigInt(1024 * 1024 * 1024)
  const MB = BigInt(1024 * 1024)

  if (bytes >= GB) {
    // 大于等于 1GB，以 Gbps 为单位，换算成 Mbps
    const gbps = Number(bytes / GB)
    return (gbps * 1024) + ' Mbps'
  } else if (bytes >= MB) {
    // MB 级别，直接显示 Mbps
    return Number(bytes / MB) + ' Mbps'
  }

  return t('traffic.unlimited')
}

function planHasSwap(plan: PackagePlan): boolean {
  return props.instanceType !== 'vm' && plan.swapSize > 0
}

function isPlanDisabled(plan: PackagePlan): boolean {
  return plan.isSoldOut || !plan.isActive
}

function isPlanSelected(plan: PackagePlan): boolean {
  return props.selectedPlanId === plan.id && !isPlanDisabled(plan)
}

function handleSelect(plan: PackagePlan): void {
  if (isPlanDisabled(plan)) return
  emit('select', plan)
}
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center gap-2 mb-4">
      <span
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
      >{{ props.stepNumber }}</span>
      <h2
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ props.title || t('instance.selector.selectPlan') }}
      </h2>
      <span class="text-xs text-themed-muted ml-auto">
        {{ props.description || t('instance.selector.planDesc') }}
      </span>
    </div>

    <div
      v-if="prerequisiteMessage"
      class="mb-4 rounded-lg border px-3 py-2 text-xs leading-relaxed"
      :class="themeStore.isDark ? 'border-amber-500/30 bg-amber-900/20 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700'"
    >
      {{ prerequisiteMessage }}
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="text-center py-8 text-themed-muted text-sm">
      <svg class="w-5 h-5 mx-auto mb-2 animate-spin icon-themed-muted" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {{ t('common.loading') }}
    </div>

    <!-- No plans -->
    <div v-else-if="plans.length === 0" class="text-center py-8 text-themed-muted text-sm">
      {{ props.emptyMessage || t('instance.selector.noPlans') }}
    </div>

    <!-- Plan list - 现代化卡片布局 -->
    <div v-else class="grid gap-3">
      <div
        v-for="plan in plans"
        :key="plan.id"
        :class="[
          'relative rounded-xl border-2 p-4 transition-all duration-200',
          isPlanDisabled(plan) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          isPlanSelected(plan)
            ? (themeStore.isDark
              ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10'
              : 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10')
            : isPlanDisabled(plan)
              ? (themeStore.isDark ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50')
              : (themeStore.isDark
                ? 'border-gray-800 hover:border-gray-700 hover:bg-gray-800/50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')
        ]"
        @click="handleSelect(plan)"
      >
        <!-- 选中标识 -->
        <div
          v-if="isPlanSelected(plan)"
          class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center shadow-lg"
        >
          <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        </div>

        <!-- 头部：方案名 + SLA + 价格 -->
        <div class="flex items-start justify-between gap-4 mb-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3
                class="font-semibold text-base"
                :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
              >
                {{ plan.name }}
              </h3>
              <span
                v-if="plan.isSoldOut"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                :class="themeStore.isDark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700'"
              >
                {{ props.soldOutLabel || t('instance.selector.planSoldOut') }}
              </span>
              <!-- SLA 保证标签 -->
              <span
                v-if="plan.slaGuarantee !== null"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                :class="themeStore.isDark
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-green-100 text-green-700'"
              >
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
                SLA {{ plan.slaGuarantee }}%
              </span>
            </div>
            <p
              v-if="plan.description"
              class="text-xs mt-0.5 line-clamp-2 break-all"
              :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'"
              :title="plan.description"
            >
              {{ plan.description }}
            </p>
          </div>
          <!-- 价格 -->
          <div class="text-right flex-shrink-0">
            <div
              class="text-xl font-bold"
              :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
            >
              ¥{{ formatPrice(plan.price) }}
            </div>
            <div class="text-xs text-themed-muted">
              {{ getBillingCycleLabel(plan.billingCycle) }}
            </div>
          </div>
        </div>

        <!-- 资源配置区域 - 分组展示 -->
        <div
          class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100/50'"
        >
          <!-- CPU -->
          <div class="text-center">
            <div class="text-xs text-themed-muted mb-0.5">CPU</div>
            <div
              class="font-semibold"
              :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
            >
              {{ plan.cpu }}%
            </div>
          </div>
          <!-- 内存 -->
          <div class="text-center">
            <div class="text-xs text-themed-muted mb-0.5 leading-tight">
              <div>{{ t('instance.selector.memory') }}</div>
              <div v-if="planHasSwap(plan)" class="opacity-60">SWAP ✅</div>
            </div>
            <div
              class="font-semibold"
              :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
            >
              {{ formatMemory(plan.memory) }}
            </div>
          </div>
          <!-- 硬盘 -->
          <div class="text-center">
            <div class="text-xs text-themed-muted mb-0.5">{{ t('instance.selector.disk') }}</div>
            <div
              class="font-semibold"
              :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
            >
              {{ formatDisk(plan.disk) }}
            </div>
          </div>
          <!-- 流量 -->
          <div class="text-center">
            <div class="text-xs text-themed-muted mb-0.5">
              {{ t('billing.traffic') }}
              <span class="opacity-60">({{ t('billing.trafficBidirectional') }})</span>
            </div>
            <div
              class="font-semibold"
              :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
            >
              {{ formatTraffic(plan.trafficLimit) }}
            </div>
          </div>
        </div>

        <!-- 配额信息 - 横向紧凑排列 -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs">
          <div class="flex items-center gap-1">
            <svg class="w-3.5 h-3.5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="text-themed-muted">{{ t('instance.selector.ports') }}:</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatLimit(plan.portLimit) }}</span>
          </div>
          <div class="flex items-center gap-1">
            <svg class="w-3.5 h-3.5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <span class="text-themed-muted">{{ t('instance.selector.snapshots') }}:</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatLimit(plan.snapshotLimit) }}</span>
          </div>
          <div v-if="plan.siteLimit > 0" class="flex items-center gap-1">
            <svg class="w-3.5 h-3.5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span class="text-themed-muted">{{ t('instance.selector.sites') }}:</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatLimit(plan.siteLimit) }}</span>
          </div>
          <!-- 带宽限制 -->
          <div v-if="plan.trafficLimitSpeed && plan.trafficLimitSpeed !== '0'" class="flex items-center gap-1 ml-auto">
            <span class="text-themed-muted">{{ t('instance.selector.bandwidth') }}:</span>
            <span class="text-blue-500 font-medium">{{ formatBandwidth(plan.trafficLimitSpeed) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 定制提示 -->
    <div
      class="mt-4 pt-3 border-t text-center text-xs"
      :class="themeStore.isDark ? 'border-gray-800 text-gray-500' : 'border-gray-100 text-gray-400'"
    >
      {{ props.customPlanHint || t('instance.selector.customPlanHint') }}
    </div>
  </div>
</template>
