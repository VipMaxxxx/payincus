<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import type { Package } from '@/types/api'

const { t } = useI18n()

interface Props {
  packages: Package[]
  selectedPackageId: number | null
  stepNumber?: number  // 步骤编号，默认 1
  title?: string
  emptyMessage?: string
  soldOutLabel?: string
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  stepNumber: 1,
  title: undefined,
  emptyMessage: undefined,
  soldOutLabel: undefined,
  loading: false
})
const emit = defineEmits<{
  select: [pkg: Package]
  showOwnerInfo: [packageId: number, ownerId: number]
}>()

const themeStore = useThemeStore()
const authStore = useAuthStore()
const detailPackage = ref<Package | null>(null)
const truncatedPackageIds = ref<number[]>([])
const packageNameRefs = new Map<number, HTMLElement>()
const packageDescriptionRefs = new Map<number, HTMLElement>()

const truncatedPackageIdSet = computed(() => new Set(truncatedPackageIds.value))

function resolvePackageNetworkMode(pkg: Package): string | null {
  return ((pkg as Package & { networkMode?: string }).networkMode || pkg.network_mode || null)
}

// 检查是否是用户自己的套餐
function isOwnPackage(pkg: Package): boolean {
  return pkg.ownerId === authStore.user?.id
}

// 根据主题的网络模式样式
function getNetworkModeClass(mode: string | undefined | null): string {
  const normalizedMode = String(mode || 'nat').toLowerCase()
  switch (normalizedMode) {
    case 'nat':
      return themeStore.isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'
    case 'nat_ipv6':
      return themeStore.isDark ? 'bg-blue-900/50 text-blue-400' : 'bg-blue-100 text-blue-700'
    case 'nat_ipv6_nat':
      return themeStore.isDark ? 'bg-cyan-900/50 text-cyan-400' : 'bg-cyan-100 text-cyan-600'
    case 'ipv6_only':
      return themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'
    case 'ipv6_nat':
      return themeStore.isDark ? 'bg-teal-900/50 text-teal-400' : 'bg-teal-100 text-teal-600'
    default:
      return themeStore.isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'
  }
}

// 获取网络模式的标签文本
function getNetworkModeLabel(mode: string | undefined | null): string {
  const normalizedMode = String(mode || 'nat').toLowerCase()
  const key = `common.networkMode.${normalizedMode}`
  const translated = t(key)
  return translated === key ? t('common.networkMode.nat') : translated
}

// 实例类型标签样式
function getInstanceTypeClass(type: string | undefined | null): string {
  const normalizedType = String(type || 'container').toLowerCase()
  if (normalizedType === 'vm') {
    return themeStore.isDark ? 'bg-amber-900/50 text-amber-400' : 'bg-amber-100 text-amber-700'
  }
  return themeStore.isDark ? 'bg-teal-900/50 text-teal-400' : 'bg-teal-100 text-teal-700'
}

function getInstanceTypeLabel(type: string | undefined | null): string {
  const normalizedType = String(type || 'container').toLowerCase()
  return normalizedType === 'vm' ? t('common.instanceType.vm') : t('common.instanceType.container')
}

function getPackageBadgeClass(kind: 'soldOut' | 'own' | 'market' | 'friends' | 'available' | 'shared'): string {
  switch (kind) {
    case 'soldOut':
      return themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
    case 'own':
      return themeStore.isDark ? 'bg-amber-900/50 text-amber-400' : 'bg-amber-100 text-amber-700'
    case 'market':
      return themeStore.isDark ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-900/70' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
    case 'friends':
      return themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-700'
    case 'available':
      return themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-700'
    case 'shared':
      return themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-700'
  }
}

function getPackageBadgeKind(pkg: Package): 'soldOut' | 'own' | 'market' | 'friends' | 'available' | 'shared' | null {
  if (pkg.soldOut) return 'soldOut'
  if (isOwnPackage(pkg)) return 'own'
  if (pkg.sourceType === 'market') return 'market'
  if (pkg.sourceType === 'friends') return 'friends'
  if (pkg.isGlobalShared || pkg.sourceType === 'official' || pkg.sourceType === 'zone') return 'available'
  if (pkg.isShared && !pkg.isOwn) return 'shared'
  return null
}

function getPackageBadgeLabel(pkg: Package): string | null {
  const kind = getPackageBadgeKind(pkg)
  switch (kind) {
    case 'soldOut':
      return props.soldOutLabel || t('package.soldOut')
    case 'own':
      return t('package.myPackage')
    case 'market':
      return `UID:${pkg.ownerId}`
    case 'friends':
      return `${t('package.friendPrefix')}${pkg.ownerUsername}`
    case 'available':
      return t('package.globalShared')
    case 'shared':
      return t('package.shared')
    default:
      return null
  }
}

function setPackageNameRef(packageId: number, el: unknown): void {
  if (el instanceof HTMLElement) {
    packageNameRefs.set(packageId, el)
  } else {
    packageNameRefs.delete(packageId)
  }
}

function setPackageDescriptionRef(packageId: number, el: unknown): void {
  if (el instanceof HTMLElement) {
    packageDescriptionRefs.set(packageId, el)
  } else {
    packageDescriptionRefs.delete(packageId)
  }
}

function isOverflowing(el?: HTMLElement): boolean {
  if (!el) return false
  return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
}

function updateTruncatedPackages(): void {
  const nextIds: number[] = []
  for (const pkg of props.packages) {
    if (isOverflowing(packageNameRefs.get(pkg.id)) || isOverflowing(packageDescriptionRefs.get(pkg.id))) {
      nextIds.push(pkg.id)
    }
  }
  truncatedPackageIds.value = nextIds
}

function scheduleTruncationCheck(): void {
  void nextTick(() => {
    updateTruncatedPackages()
  })
}

function shouldShowDetailButton(pkg: Package): boolean {
  return truncatedPackageIdSet.value.has(pkg.id)
}

function openPackageDetail(pkg: Package): void {
  detailPackage.value = pkg
}

function closePackageDetail(): void {
  detailPackage.value = null
}

function handleResize(): void {
  scheduleTruncationCheck()
}

watch(
  () => props.packages.map(pkg => `${pkg.id}:${pkg.name}:${pkg.description || ''}:${pkg.sourceType || ''}:${pkg.ownerId || ''}`),
  () => {
    scheduleTruncationCheck()
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('resize', handleResize)
  scheduleTruncationCheck()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="card p-5">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <span
          class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
          :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
        >{{ props.stepNumber }}</span>
        <h2
          class="text-sm font-medium"
          :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
        >
          {{ props.title || t('instance.selector.selectPackage') }}
        </h2>
      </div>
      <slot name="header-actions" />
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-8 text-themed-muted text-sm">
      <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      {{ t('common.loading') }}
    </div>
    
    <div v-else-if="packages.length === 0" class="text-center py-8 text-themed-muted text-sm">
      {{ props.emptyMessage || t('instance.selector.noPackages') }}
    </div>
    
    <div v-else class="flex flex-col gap-2 overflow-y-auto max-h-[calc(4*5.5rem+3*0.5rem)] sm:max-h-none sm:grid sm:grid-cols-1 sm:gap-3 md:grid-cols-2 2xl:grid-cols-3 sm:overflow-visible scrollbar-hide">
      <div
        v-for="pkg in packages"
        :key="pkg.id"
        :class="[
          'relative flex min-h-[132px] flex-col p-4 rounded-lg border transition-all cursor-pointer shrink-0 sm:flex-initial overflow-hidden min-w-0',
          pkg.soldOut
            ? (themeStore.isDark ? 'border-gray-800 bg-gray-900/50 opacity-60' : 'border-gray-200 bg-gray-50 opacity-60')
            : selectedPackageId === pkg.id 
              ? (themeStore.isDark ? 'border-white bg-gray-900 ring-1 ring-white/20' : 'border-gray-900 bg-gray-50 ring-1 ring-gray-900/20')
              : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300')
        ]"
        @click="emit('select', pkg)"
      >
        <div>
          <div class="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div class="min-w-0">
              <div
                :ref="el => setPackageNameRef(pkg.id, el)"
                class="block w-full overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-tight"
                :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                :title="pkg.name"
              >
                {{ pkg.name }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-if="shouldShowDetailButton(pkg)"
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                :class="themeStore.isDark ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'"
                :title="t('common.details')"
                @click.stop="openPackageDetail(pkg)"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button
                v-if="getPackageBadgeKind(pkg) === 'market'"
                type="button"
                class="text-xs px-2 py-0.5 rounded transition-colors"
                :class="getPackageBadgeClass('market')"
                @click.stop="emit('showOwnerInfo', pkg.id, pkg.ownerId!)"
              >
                {{ getPackageBadgeLabel(pkg) }}
              </button>
              <span
                v-else-if="getPackageBadgeKind(pkg)"
                class="text-xs px-2 py-0.5 rounded"
                :class="getPackageBadgeClass(getPackageBadgeKind(pkg)!)"
              >
                {{ getPackageBadgeLabel(pkg) }}
              </span>
            </div>
          </div>
          <p 
            v-if="pkg.description" 
            :ref="el => setPackageDescriptionRef(pkg.id, el)"
            class="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5"
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
            :title="pkg.description"
          >
            {{ pkg.description }}
          </p>
        </div>

        <div class="mt-3 border-t pt-3" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="flex items-start gap-2">
            <div class="flex min-w-0 flex-1 flex-wrap gap-1.5 content-start">
              <!-- 实例类型标签 -->
              <span :class="['text-2xs px-1.5 py-0.5 rounded font-medium', getInstanceTypeClass(pkg.instance_type)]">
                {{ getInstanceTypeLabel(pkg.instance_type) }}
              </span>
              <span :class="['text-2xs px-1.5 py-0.5 rounded', getNetworkModeClass(resolvePackageNetworkMode(pkg))]">
                {{ getNetworkModeLabel(resolvePackageNetworkMode(pkg)) }}
              </span>
              <span
                v-if="pkg.nested === 1"
                class="text-2xs px-1.5 py-0.5 rounded"
                :class="themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'"
              >
                {{ t('instance.selector.docker') }}
              </span>
              <span
                v-if="pkg.privileged === 1"
                class="text-2xs px-1.5 py-0.5 rounded"
                :class="themeStore.isDark ? 'bg-orange-900/50 text-orange-400' : 'bg-orange-100 text-orange-600'"
              >
                {{ t('instance.selector.privileged') }}
              </span>
            </div>
            <div
              v-if="selectedPackageId === pkg.id"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              :class="themeStore.isDark ? 'bg-white' : 'bg-gray-900'"
            >
              <svg
                class="w-3 h-3"
                :class="themeStore.isDark ? 'text-gray-900' : 'text-white'"
                fill="currentColor" viewBox="0 0 20 20"
              >
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="detailPackage" class="modal-overlay">
        <div class="modal-backdrop" @click="closePackageDetail"></div>
        <div class="modal-content max-w-lg">
          <div class="modal-header items-start">
            <div class="min-w-0 flex-1 pr-3">
              <h3 class="modal-title whitespace-normal break-words leading-snug">{{ detailPackage.name }}</h3>
              <p class="mt-1 text-xs text-themed-muted">{{ t('common.details') }}</p>
            </div>
            <button type="button" class="shrink-0 self-start text-themed-muted hover:text-themed" @click="closePackageDetail">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body space-y-4">
            <div class="flex flex-wrap gap-2">
              <button
                v-if="getPackageBadgeKind(detailPackage) === 'market'"
                type="button"
                class="text-xs px-2 py-1 rounded transition-colors"
                :class="getPackageBadgeClass('market')"
                @click.stop="emit('showOwnerInfo', detailPackage.id, detailPackage.ownerId!)"
              >
                {{ getPackageBadgeLabel(detailPackage) }}
              </button>
              <span
                v-else-if="getPackageBadgeKind(detailPackage)"
                class="text-xs px-2 py-1 rounded"
                :class="getPackageBadgeClass(getPackageBadgeKind(detailPackage)!)"
              >
                {{ getPackageBadgeLabel(detailPackage) }}
              </span>
              <span :class="['text-xs px-2 py-1 rounded font-medium', getInstanceTypeClass(detailPackage.instance_type)]">
                {{ getInstanceTypeLabel(detailPackage.instance_type) }}
              </span>
              <span :class="['text-xs px-2 py-1 rounded', getNetworkModeClass(resolvePackageNetworkMode(detailPackage))]">
                {{ getNetworkModeLabel(resolvePackageNetworkMode(detailPackage)) }}
              </span>
              <span
                v-if="detailPackage.nested === 1"
                class="text-xs px-2 py-1 rounded"
                :class="themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'"
              >
                {{ t('instance.selector.docker') }}
              </span>
              <span
                v-if="detailPackage.privileged === 1"
                class="text-xs px-2 py-1 rounded"
                :class="themeStore.isDark ? 'bg-orange-900/50 text-orange-400' : 'bg-orange-100 text-orange-600'"
              >
                {{ t('instance.selector.privileged') }}
              </span>
            </div>

            <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50/80'">
              <div class="mb-2 text-xs font-medium uppercase tracking-wide text-themed-muted">
                {{ t('common.description') }}
              </div>
              <div
                class="text-sm leading-6 whitespace-pre-wrap break-words"
                :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
              >
                {{ detailPackage.description || t('common.none') }}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-primary" @click="closePackageDetail">
              {{ t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
