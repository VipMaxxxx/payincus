<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'

const props = defineProps<{
  instanceId: number
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

// 流量数据
interface TrafficData {
  monthlyUsed: string
  monthlyUsedFormatted: string
  monthlyLimit: string | null
  monthlyLimitFormatted: string | null
  trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
  percentage: number
  trafficResetDay: number
  periodStart: string
  periodEnd: string
}

interface TrafficHistoryItem {
  date: string
  rxTotal: string
  txTotal: string
  rxFormatted: string
  txFormatted: string
  total: string
  totalFormatted: string
}

const trafficData = ref<TrafficData | null>(null)
const trafficHistory = ref<TrafficHistoryItem[]>([])
const periodInfo = ref<{ periodStart: string; periodEnd: string } | null>(null)
const loading = ref(true)
const historyLoading = ref(true)

onMounted(async () => {
  await Promise.all([loadTrafficData(), loadTrafficHistory()])
})

async function loadTrafficData() {
  loading.value = true
  try {
    const data = await api.traffic.getInstanceTraffic(props.instanceId)
    trafficData.value = data
  } catch (error) {
    console.error('Failed to load traffic data:', error)
  } finally {
    loading.value = false
  }
}

async function loadTrafficHistory() {
  historyLoading.value = true
  try {
    const response = await api.traffic.getInstanceTrafficHistory(props.instanceId)
    trafficHistory.value = response.data
    periodInfo.value = {
      periodStart: response.periodStart,
      periodEnd: response.periodEnd
    }
  } catch (error) {
    console.error('Failed to load traffic history:', error)
  } finally {
    historyLoading.value = false
  }
}

// 格式化周期日期显示 (MM-DD ~ MM-DD)
const periodDateRange = computed(() => {
  if (!trafficData.value) return ''
  const start = trafficData.value.periodStart.slice(5) // MM-DD
  const end = trafficData.value.periodEnd.slice(5)
  return `${start} ~ ${end}`
})

// 状态标签样式
const statusBadgeClass = computed(() => {
  if (!trafficData.value) return ''
  switch (trafficData.value.trafficStatus) {
    case 'LIMITED':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    case 'WARNING':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    default:
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  }
})

const statusLabel = computed(() => {
  if (!trafficData.value) return ''
  switch (trafficData.value.trafficStatus) {
    case 'LIMITED':
      return t('traffic.status.limited')
    case 'WARNING':
      return t('traffic.status.warning')
    default:
      return t('traffic.status.normal')
  }
})

// 进度条颜色
const progressBarClass = computed(() => {
  if (!trafficData.value) return 'bg-blue-500'
  if (trafficData.value.percentage >= 100) return 'bg-red-500'
  if (trafficData.value.percentage >= 80) return 'bg-yellow-500'
  return 'bg-blue-500'
})

// 计算图表最大值
const chartMaxValue = computed(() => {
  if (trafficHistory.value.length === 0) return 1
  const max = Math.max(...trafficHistory.value.map(h => Number(h.total)))
  return max || 1
})

// 格式化字节数为可读字符串
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'K'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'M'
  return (bytes / 1073741824).toFixed(1) + 'G'
}

// Y 轴刻度标签
const yAxisLabels = computed(() => {
  const max = chartMaxValue.value
  return {
    top: formatBytes(max),
    mid: formatBytes(max / 2),
    bottom: '0'
  }
})

// 格式化日期显示 (MM-DD)
const formatDate = (dateStr: string) => {
  return dateStr.slice(5) // 去掉年份，只保留 MM-DD
}

// X 轴标签（显示 5-7 个日期点）
const xAxisLabels = computed(() => {
  const len = trafficHistory.value.length
  if (len === 0) return []
  if (len <= 7) return trafficHistory.value.map(h => ({ date: formatDate(h.date), index: trafficHistory.value.indexOf(h) }))
  
  // 显示首、尾和中间均匀分布的点
  const step = Math.floor(len / 5)
  const labels = []
  for (let i = 0; i < len; i += step) {
    labels.push({ date: formatDate(trafficHistory.value[i].date), index: i })
  }
  // 确保最后一个日期显示
  if (labels[labels.length - 1].index !== len - 1) {
    labels.push({ date: formatDate(trafficHistory.value[len - 1].date), index: len - 1 })
  }
  return labels
})
</script>

<template>
  <div class="space-y-6">
    <!-- Current Month Usage -->
    <div class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 
          class="text-lg font-medium"
          :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
        >
          {{ $t('traffic.monthlyUsage') }}
          <span v-if="trafficData" class="text-sm font-normal ml-2" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
            ({{ periodDateRange }})
          </span>
        </h3>
        <span 
          v-if="trafficData"
          :class="['px-2.5 py-0.5 rounded-full text-xs font-medium', statusBadgeClass]"
        >
          {{ statusLabel }}
        </span>
      </div>

      <div v-if="loading" class="animate-pulse space-y-4">
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
        <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
      </div>

      <template v-else-if="trafficData">
        <div class="space-y-3">
          <div class="flex justify-between text-sm">
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
              {{ $t('traffic.used') }}
            </span>
            <span :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'" class="font-medium">
              {{ trafficData.monthlyUsedFormatted }}
              <template v-if="trafficData.monthlyLimitFormatted">
                / {{ trafficData.monthlyLimitFormatted }}
              </template>
              <template v-else>
                / {{ $t('traffic.unlimited') }}
              </template>
            </span>
          </div>

          <!-- Progress Bar -->
          <div 
            class="h-2 rounded-full overflow-hidden"
            :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'"
          >
            <div 
              :class="['h-full rounded-full transition-all duration-300', progressBarClass]"
              :style="{ width: `${Math.min(trafficData.percentage, 100)}%` }"
            ></div>
          </div>

          <div class="flex justify-between text-xs">
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
              {{ trafficData.percentage.toFixed(1) }}%
            </span>
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
              <span 
                v-if="trafficData.trafficStatus === 'LIMITED'"
                class="text-red-500"
              >
                {{ $t('traffic.throttledHint') }}
                <span class="mx-1">·</span>
              </span>
              {{ $t('traffic.periodResetHint', { date: trafficData.trafficResetDay }) }}
            </span>
          </div>
        </div>
      </template>

      <div v-else class="text-center py-4">
        <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ $t('traffic.noData') }}
        </span>
      </div>
    </div>

    <!-- Traffic History Chart -->
    <div class="card p-6">
      <h3 
        class="text-lg font-medium mb-4"
        :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
      >
        {{ $t('traffic.historyPeriod') }}
        <span v-if="periodInfo" class="text-sm font-normal ml-2" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          ({{ periodInfo.periodStart.slice(5) }} ~ {{ periodInfo.periodEnd.slice(5) }})
        </span>
      </h3>

      <div v-if="historyLoading" class="animate-pulse">
        <div class="flex items-end gap-1 h-32">
          <div 
            v-for="i in 30" 
            :key="i" 
            class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-t"
            :style="{ height: `${Math.random() * 100}%` }"
          ></div>
        </div>
      </div>

      <template v-else-if="trafficHistory.length > 0">
        <!-- Bar Chart with Y-axis -->
        <div class="flex">
          <!-- Y 轴刻度 -->
          <div class="flex flex-col justify-between h-40 pr-2 text-xs w-10" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
            <span class="text-right">{{ yAxisLabels.top }}</span>
            <span class="text-right">{{ yAxisLabels.mid }}</span>
            <span class="text-right">{{ yAxisLabels.bottom }}</span>
          </div>
          
          <!-- 图表区域 -->
          <div class="flex-1">
            <!-- 背景网格线 -->
            <div class="relative h-40">
              <div 
                class="absolute inset-0 flex flex-col justify-between pointer-events-none"
              >
                <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
                <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
                <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
              </div>
              
              <!-- 柱状图 -->
              <div class="absolute inset-0 flex items-end gap-0.5 px-1">
                <div 
                  v-for="(item, index) in trafficHistory" 
                  :key="item.date"
                  class="flex-1 min-w-1 rounded-t transition-all duration-200 cursor-pointer group relative"
                  :class="[
                    themeStore.isDark 
                      ? 'bg-gradient-to-t from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300' 
                      : 'bg-gradient-to-t from-blue-500 to-blue-400 hover:from-blue-400 hover:to-blue-300'
                  ]"
                  :style="{ height: `${Math.max((Number(item.total) / chartMaxValue) * 100, 1)}%` }"
                >
                  <!-- Tooltip -->
                  <div 
                    class="absolute bottom-full mb-2 px-2.5 py-1.5 text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10"
                    :class="[
                      themeStore.isDark ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-gray-900 border border-gray-200 shadow-md',
                      index < 5 ? 'left-0' : index > trafficHistory.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    ]"
                  >
                    <div class="font-medium mb-1">{{ item.date }}</div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-green-500"></span>
                      <span>{{ $t('traffic.download') }}: {{ item.rxFormatted }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-orange-500"></span>
                      <span>{{ $t('traffic.upload') }}: {{ item.txFormatted }}</span>
                    </div>
                    <div 
                      class="mt-1 pt-1 font-medium"
                      :class="themeStore.isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'"
                    >
                      {{ $t('traffic.total') }}: {{ item.totalFormatted }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- X-axis labels -->
            <div class="relative h-5 mt-1">
              <div 
                v-for="label in xAxisLabels" 
                :key="label.index"
                class="absolute text-xs transform -translate-x-1/2"
                :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                :style="{ left: `${(label.index / (trafficHistory.length - 1)) * 100}%` }"
              >
                {{ label.date }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="text-center py-8">
        <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ $t('traffic.noHistoryData') }}
        </span>
      </div>
    </div>
  </div>
</template>
