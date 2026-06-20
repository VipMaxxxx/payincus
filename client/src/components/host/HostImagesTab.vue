<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import type { SystemImage } from '@/types/api'

interface Props {
  hostId: number
  hostName: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

const loading = ref(true)
const saving = ref(false)
const searchQuery = ref('')
const useDefaultMode = ref(true)
const selectedImageIds = ref<number[]>([])
const images = ref<SystemImage[]>([])
const hostArchitecture = ref<'x86_64' | 'aarch64'>('x86_64')
const hostInstanceType = ref<'container' | 'vm' | 'both'>('container')

const selectedCount = computed(() => selectedImageIds.value.length)

const filteredImages = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return images.value

  return images.value.filter(image =>
    image.name.toLowerCase().includes(query) ||
    image.remoteAlias.toLowerCase().includes(query) ||
    image.icon.toLowerCase().includes(query)
  )
})

const canSave = computed(() => {
  if (saving.value) return false
  if (useDefaultMode.value) return true
  return selectedCount.value > 0
})

function isSelected(imageId: number): boolean {
  return selectedImageIds.value.includes(imageId)
}

function toggleImage(imageId: number): void {
  if (useDefaultMode.value) {
    useDefaultMode.value = false
  }

  if (isSelected(imageId)) {
    selectedImageIds.value = selectedImageIds.value.filter(id => id !== imageId)
    return
  }

  selectedImageIds.value = [...selectedImageIds.value, imageId]
}

function formatInstanceType(instanceType?: 'container' | 'vm' | 'both'): string {
  if (instanceType === 'container') return t('admin.images.typeContainer')
  if (instanceType === 'vm') return t('admin.images.typeVm')
  return t('admin.images.typeBoth')
}

async function loadPolicy(): Promise<void> {
  loading.value = true
  try {
    const response = await api.hosts.getImagePolicy(props.hostId)
    useDefaultMode.value = response.useDefault
    selectedImageIds.value = [...(response.allowedImageIds || [])]
    images.value = response.images || []
    hostArchitecture.value = response.host.architecture
    hostInstanceType.value = response.host.instanceType
  } catch (err: any) {
    toast.error(t('admin.hosts.imagePolicy.loadFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function savePolicy(): Promise<void> {
  if (!canSave.value) return

  saving.value = true
  try {
    await api.hosts.updateImagePolicy(props.hostId, {
      useDefault: useDefaultMode.value,
      imageIds: useDefaultMode.value ? [] : selectedImageIds.value
    })
    await loadPolicy()
    toast.success(t('admin.hosts.imagePolicy.saveSuccess'))
  } catch (err: any) {
    toast.error(t('admin.hosts.imagePolicy.saveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    saving.value = false
  }
}

watch(() => props.hostId, () => {
  searchQuery.value = ''
  loadPolicy()
}, { immediate: true })
</script>

<template>
  <div class="space-y-6">
    <div
      class="card p-5"
      :class="themeStore.isDark ? 'border border-gray-800' : 'border border-gray-200'"
    >
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-medium text-themed">{{ t('admin.hosts.imagePolicy.title') }}</h3>
            <span
              class="px-2 py-1 text-xs rounded-full"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
            >
              {{ t('admin.images.fields.architecture') }}: {{ hostArchitecture }}
            </span>
            <span
              class="px-2 py-1 text-xs rounded-full"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
            >
              {{ t('admin.images.fields.instanceType') }}: {{ formatInstanceType(hostInstanceType) }}
            </span>
          </div>
          <p class="text-sm text-themed-muted">{{ t('admin.hosts.imagePolicy.description', { name: props.hostName }) }}</p>
        </div>
        <button class="btn-secondary whitespace-nowrap" :disabled="loading" @click="loadPolicy">
          {{ t('admin.images.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card p-10 text-center text-themed-muted">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="mt-4">{{ t('common.loading') }}</p>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <button
          type="button"
          class="card p-5 text-left transition-colors"
          :class="useDefaultMode
            ? (themeStore.isDark ? 'border border-blue-500 bg-blue-900/10' : 'border border-blue-300 bg-blue-50')
            : (themeStore.isDark ? 'border border-gray-800 hover:border-gray-700' : 'border border-gray-200 hover:border-gray-300')"
          @click="useDefaultMode = true"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.defaultMode') }}</h4>
              <p class="mt-1 text-xs text-themed-muted">{{ t('admin.hosts.imagePolicy.defaultDesc') }}</p>
            </div>
            <div
              class="w-5 h-5 rounded-full border flex items-center justify-center"
              :class="useDefaultMode
                ? 'border-blue-500 bg-blue-500 text-white'
                : (themeStore.isDark ? 'border-gray-700 text-transparent' : 'border-gray-300 text-transparent')"
            >
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </button>

        <button
          type="button"
          class="card p-5 text-left transition-colors"
          :class="!useDefaultMode
            ? (themeStore.isDark ? 'border border-blue-500 bg-blue-900/10' : 'border border-blue-300 bg-blue-50')
            : (themeStore.isDark ? 'border border-gray-800 hover:border-gray-700' : 'border border-gray-200 hover:border-gray-300')"
          @click="useDefaultMode = false"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.restrictedMode') }}</h4>
              <p class="mt-1 text-xs text-themed-muted">{{ t('admin.hosts.imagePolicy.restrictedDesc') }}</p>
            </div>
            <div
              class="w-5 h-5 rounded-full border flex items-center justify-center"
              :class="!useDefaultMode
                ? 'border-blue-500 bg-blue-500 text-white'
                : (themeStore.isDark ? 'border-gray-700 text-transparent' : 'border-gray-300 text-transparent')"
            >
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </button>
      </div>

      <div class="card p-5 space-y-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.selectableImages') }}</p>
            <p class="text-xs text-themed-muted">
              {{ useDefaultMode ? t('admin.hosts.imagePolicy.defaultHint') : t('admin.hosts.imagePolicy.selectedCount', { count: selectedCount }) }}
            </p>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="input lg:w-80"
            :placeholder="t('admin.hosts.imagePolicy.searchPlaceholder')"
          />
        </div>

        <div v-if="!useDefaultMode && selectedCount === 0" class="text-sm text-orange-500 dark:text-orange-400">
          {{ t('admin.hosts.imagePolicy.emptySelection') }}
        </div>

        <div v-if="images.length === 0" class="py-10 text-center text-themed-muted">
          <div class="text-4xl mb-3">💿</div>
          <p>{{ t('admin.hosts.imagePolicy.noImages') }}</p>
        </div>

        <div v-else-if="filteredImages.length === 0" class="py-10 text-center text-themed-muted">
          {{ t('common.noSearchResults') }}
        </div>

        <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <button
            v-for="image in filteredImages"
            :key="image.id"
            type="button"
            class="rounded-xl border p-4 text-left transition-colors"
            :class="[
              isSelected(image.id)
                ? (themeStore.isDark ? 'border-blue-500 bg-blue-900/10' : 'border-blue-300 bg-blue-50')
                : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300'),
              useDefaultMode ? 'opacity-70' : ''
            ]"
            @click="toggleImage(image.id)"
          >
            <div class="flex items-start gap-3">
              <DistroIcon :distro="image.icon" :size="32" class="flex-shrink-0" />
              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-themed truncate">{{ image.name }}</div>
                    <div class="text-xs text-themed-muted font-mono break-all">{{ image.remoteAlias }}</div>
                  </div>
                  <div
                    class="w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center"
                    :class="isSelected(image.id)
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : (themeStore.isDark ? 'border-gray-700 text-transparent' : 'border-gray-300 text-transparent')"
                  >
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="px-2 py-1 text-xs rounded-full"
                    :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
                  >
                    {{ formatInstanceType(image.instanceType) }}
                  </span>
                  <span
                    class="px-2 py-1 text-xs rounded-full"
                    :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
                  >
                    {{ image.architecture }}
                  </span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div class="flex justify-end">
        <button class="btn-primary" :disabled="!canSave" @click="savePolicy">
          <span v-if="saving" class="loading-spinner w-4 h-4 mr-2"></span>
          {{ saving ? t('common.loading') : t('common.save') }}
        </button>
      </div>
    </template>
  </div>
</template>
