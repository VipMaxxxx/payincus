<script setup lang="ts">
/**
 * 地区选择器组件
 * 用于创建实例时选择国家/地区
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import FlagIcon from '@/components/FlagIcon.vue'
import { getLocalizedCountryName } from '@/utils/countryDisplay'

export interface Region {
  code: string      // 国家代码，如 'hk', 'de'
  name: string      // 国家名称
  packageCount: number  // 套餐数量
  packageIds: number[]  // 该地区包含的套餐 ID 列表
}

interface Props {
  regions: Region[]
  selectedRegion: string | null  // null 表示"全部"
  loading?: boolean
  title?: string
  packageCountLabel?: string
  packageCountLabelKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  title: undefined,
  packageCountLabel: undefined,
  packageCountLabelKey: undefined
})

const emit = defineEmits<{
  select: [region: string | null]
}>()

const { t, locale } = useI18n()
const themeStore = useThemeStore()

// 计算总套餐数
const totalPackageCount = computed(() => {
  return props.regions.reduce((sum, r) => sum + r.packageCount, 0)
})

// 是否选中"全部"
const isAllSelected = computed(() => props.selectedRegion === null)

// 选择地区
function selectRegion(code: string | null) {
  emit('select', code)
}

function getRegionLabel(code: string): string {
  return getLocalizedCountryName(code, locale.value, (key, fallback) => t(key, fallback))
}

function getPackageCountLabel(count: number): string {
  if (props.packageCountLabelKey) {
    return t(props.packageCountLabelKey, { count })
  }

  if (props.packageCountLabel) {
    return props.packageCountLabel.replace('{count}', String(count))
  }

  return t('instance.selector.packageCount', { count })
}
</script>

<template>
  <div class="card p-5">
    <!-- 标题栏 -->
    <div class="flex items-center gap-2 mb-4">
      <span
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
      >1</span>
      <h2
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ props.title || t('instance.selector.selectRegion') }}
      </h2>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex items-center justify-center py-8">
      <svg class="w-6 h-6 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>

    <!-- 无数据 -->
    <div v-else-if="regions.length === 0" class="text-center py-8 text-themed-muted text-sm">
      {{ t('instance.selector.noRegions') }}
    </div>

    <template v-else>
      <!-- 移动端：pill 网格（sm 以下显示） -->
      <div class="sm:hidden grid grid-cols-2 gap-2">
        <!-- "全部"选项 -->
        <button
          type="button"
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all w-full',
            isAllSelected
              ? (themeStore.isDark
                ? 'border-white bg-white/10 text-white'
                : 'border-blue-500 bg-blue-50 text-blue-700')
              : (themeStore.isDark
                ? 'border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50')
          ]"
          @click="selectRegion(null)"
        >
          <svg class="w-4 h-4 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="truncate">{{ t('instance.selector.allRegions') }}</span>
          <span
            class="ml-auto text-xs px-1.5 py-0.5 rounded shrink-0"
            :class="isAllSelected
              ? (themeStore.isDark ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600')
              : (themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500')"
          >{{ totalPackageCount }}</span>
        </button>
        <button
          v-for="region in regions"
          :key="'m-' + region.code"
          type="button"
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all w-full',
            selectedRegion === region.code
              ? (themeStore.isDark
                ? 'border-white bg-white/10 text-white'
                : 'border-blue-500 bg-blue-50 text-blue-700')
              : (themeStore.isDark
                ? 'border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50')
          ]"
          @click="selectRegion(region.code)"
        >
          <FlagIcon :code="region.code" size="sm" class="shrink-0" />
          <span class="truncate">{{ getRegionLabel(region.code) }}</span>
          <span
            class="ml-auto text-xs px-1.5 py-0.5 rounded shrink-0"
            :class="selectedRegion === region.code
              ? (themeStore.isDark ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600')
              : (themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500')"
          >{{ region.packageCount }}</span>
        </button>
      </div>

      <!-- 桌面端：原始大卡片样式（sm 及以上显示） -->
      <div class="hidden sm:grid sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <!-- "全部"选项 -->
        <div
          :class="[
            'relative p-4 rounded-xl border-2 cursor-pointer transition-all text-center group',
            isAllSelected
              ? (themeStore.isDark
                ? 'border-white bg-white/5 shadow-lg shadow-white/5'
                : 'border-gray-900 bg-gray-50 shadow-lg shadow-gray-900/10')
              : (themeStore.isDark
                ? 'border-gray-800 hover:border-gray-600 hover:bg-gray-800/50'
                : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50')
          ]"
          @click="selectRegion(null)"
        >
          <div v-if="isAllSelected" class="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" :class="themeStore.isDark ? 'bg-white' : 'bg-gray-900'">
            <svg class="w-3 h-3" :class="themeStore.isDark ? 'text-gray-900' : 'text-white'" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center" :class="themeStore.isDark ? 'bg-blue-500/20' : 'bg-blue-100'">
            <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="font-medium text-sm mb-1" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
            {{ t('instance.selector.allRegions') }}
          </div>
          <div class="w-8 h-px mx-auto my-2" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'"></div>
          <div class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ getPackageCountLabel(totalPackageCount) }}
          </div>
        </div>

        <!-- 各国家/地区 -->
        <div
          v-for="region in regions"
          :key="'d-' + region.code"
          :class="[
            'relative p-4 rounded-xl border-2 cursor-pointer transition-all text-center group',
            selectedRegion === region.code
              ? (themeStore.isDark
                ? 'border-white bg-white/5 shadow-lg shadow-white/5'
                : 'border-gray-900 bg-gray-50 shadow-lg shadow-gray-900/10')
              : (themeStore.isDark
                ? 'border-gray-800 hover:border-gray-600 hover:bg-gray-800/50'
                : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50')
          ]"
          @click="selectRegion(region.code)"
        >
          <div v-if="selectedRegion === region.code" class="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" :class="themeStore.isDark ? 'bg-white' : 'bg-gray-900'">
            <svg class="w-3 h-3" :class="themeStore.isDark ? 'text-gray-900' : 'text-white'" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="w-10 h-10 mx-auto mb-2 rounded-lg overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-gray-800">
            <FlagIcon :code="region.code" size="lg" />
          </div>
          <div class="font-medium text-sm mb-1" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
            {{ getRegionLabel(region.code) }}
          </div>
          <div class="w-8 h-px mx-auto my-2" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'"></div>
          <div class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ getPackageCountLabel(region.packageCount) }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
