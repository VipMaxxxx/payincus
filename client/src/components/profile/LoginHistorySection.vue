<script setup lang="ts">
/**
 * LoginHistorySection - 登录历史记录组件
 * 显示用户的登录历史，包括 IP、地理位置、设备信息等
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import { normalizeCountryName } from '@/utils/countryDisplay'

const { t, locale } = useI18n()

interface LoginRecord {
  id: number
  ip: string
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  timezone: string | null
  userAgent: string | null
  createdAt: string
}

const loading = ref(false)
const records = ref<LoginRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 3
const totalPages = computed(() => Math.ceil(total.value / pageSize))
const normalizedCountryLabels = computed(() => ({
  mainlandChina: t('common.countries.cn'),
  hongKong: t('common.countries.hk'),
  macau: t('common.countries.mo'),
  taiwan: t('common.countries.tw')
}))

// 国家名称到国家代码的映射（常用国家）
const countryCodeMap: Record<string, string> = {
  'China': 'cn',
  'United States': 'us',
  'Japan': 'jp',
  'South Korea': 'kr',
  'Singapore': 'sg',
  'Macau': 'mo',
  'China Macau': 'mo',
  'Hong Kong': 'hk',
  'China Hong Kong': 'hk',
  'Taiwan': 'tw',
  'China Taiwan': 'tw',
  'Germany': 'de',
  'United Kingdom': 'gb',
  'France': 'fr',
  'Netherlands': 'nl',
  'Russia': 'ru',
  'Canada': 'ca',
  'Australia': 'au',
  'India': 'in',
  'Brazil': 'br'
}

async function loadRecords() {
  loading.value = true
  try {
    const result = await api.auth.getLoginHistory({ page: page.value, pageSize })
    records.value = result.records
    total.value = result.total
  } catch (err) {
    console.error('Failed to load login history:', err)
  } finally {
    loading.value = false
  }
}

function getCountryCode(country: string | null): string | null {
  if (!country) return null
  return countryCodeMap[country] || null
}

function formatLocation(record: LoginRecord): string {
  const parts: string[] = []
  const normalizedCountry = normalizeCountryName(record.country, normalizedCountryLabels.value)
  if (normalizedCountry) parts.push(normalizedCountry)
  if (record.region) parts.push(record.region)
  if (record.city) parts.push(record.city)
  return parts.length > 0 ? parts.join(', ') : '-'
}

function formatDevice(userAgent: string | null): string {
  if (!userAgent) return '-'
  
  // 简单解析 User-Agent
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Mac OS')) return 'macOS'
  if (userAgent.includes('Linux')) return 'Linux'
  if (userAgent.includes('Android')) return 'Android'
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS'
  
  return userAgent.substring(0, 30) + (userAgent.length > 30 ? '...' : '')
}

function formatBrowser(userAgent: string | null): string {
  if (!userAgent) return '-'
  
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) return 'Chrome'
  if (userAgent.includes('Firefox')) return 'Firefox'
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari'
  if (userAgent.includes('Edg')) return 'Edge'
  if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera'
  
  return '-'
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  // 支援 zh-CN, zh-TW, en 三種語言
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US'
  }
  const localeCode = localeMap[locale.value] || 'en-US'
  return date.toLocaleString(localeCode, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function goToPage(newPage: number) {
  if (newPage >= 1 && newPage <= totalPages.value) {
    page.value = newPage
    loadRecords()
  }
}

onMounted(loadRecords)
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-sm font-medium text-themed-secondary">{{ t('profile.loginHistory.title') }}</h2>
        <p class="text-xs text-themed-faint mt-0.5">{{ t('profile.loginHistory.description') }}</p>
      </div>
      <button
        class="btn-ghost btn-sm"
        :disabled="loading"
        @click="loadRecords"
      >
        {{ t('common.refresh') }}
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && records.length === 0" class="py-6 text-center">
      <div class="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="records.length === 0" class="text-sm text-themed-muted text-center py-6 border border-dashed border-themed rounded-lg">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ t('profile.loginHistory.empty') }}
    </div>

    <!-- 登录记录列表 -->
    <div v-else class="space-y-2">
      <div
        v-for="record in records"
        :key="record.id"
        class="p-3 bg-themed-tertiary border border-themed rounded-lg"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <!-- IP 和位置 -->
            <div class="flex items-center gap-2 mb-1">
              <FlagIcon
                v-if="getCountryCode(record.country)"
                :code="getCountryCode(record.country)!"
                class="w-4 h-3 flex-shrink-0"
              />
              <code class="text-sm font-mono text-themed">{{ record.ip }}</code>
            </div>
            
            <!-- 地理位置 -->
            <div class="text-sm text-themed-muted mb-1">
              {{ formatLocation(record) }}
              <span v-if="record.isp" class="text-themed-faint"> · {{ record.isp }}</span>
            </div>
            
            <!-- 设备和浏览器 -->
            <div class="text-xs text-themed-faint">
              {{ formatDevice(record.userAgent) }} · {{ formatBrowser(record.userAgent) }}
            </div>
          </div>
          
          <!-- 时间 -->
          <div class="text-right text-sm text-themed-muted flex-shrink-0 ml-4">
            {{ formatTime(record.createdAt) }}
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-3">
        <button
          class="btn-ghost btn-sm"
          :disabled="page === 1 || loading"
          @click="goToPage(page - 1)"
        >
          {{ t('common.previous') }}
        </button>
        <span class="text-sm text-themed-muted">
          {{ page }} / {{ totalPages }}
        </span>
        <button
          class="btn-ghost btn-sm"
          :disabled="page >= totalPages || loading"
          @click="goToPage(page + 1)"
        >
          {{ t('common.next') }}
        </button>
      </div>
    </div>
  </div>
</template>
