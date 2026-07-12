<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import type { SystemImage, CreateSystemImageRequest, UpdateSystemImageRequest } from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 状态
const loading = ref(true)
const saving = ref(false)
const images = ref<SystemImage[]>([])
const showModal = ref(false)
const editingImage = ref<SystemImage | null>(null)
const activeArchitecture = ref<'all' | 'x86_64' | 'aarch64'>('all')

// 表单
interface ImageForm {
  name: string
  remoteAlias: string
  osType: string
  architecture: 'x86_64' | 'aarch64'
  instanceType: 'container' | 'vm' | 'both'
  icon: string
  sortOrder: number
  hidden: boolean
}

const form = ref<ImageForm>(getDefaultForm())

function getDefaultForm(): ImageForm {
  return {
    name: '',
    remoteAlias: '',
    osType: 'Linux',
    architecture: 'x86_64',
    instanceType: 'both',
    icon: '',
    sortOrder: 0,
    hidden: false
  }
}

// 常用图标列表
const iconOptions = [
  'almalinux', 'alpine', 'archlinux', 'centos', 'debian',
  'fedora', 'kali', 'opensuse', 'oracle', 'rockylinux', 'ubuntu'
]

const architectureOptions: Array<{ value: 'x86_64' | 'aarch64'; label: string }> = [
  { value: 'x86_64', label: 'x86_64' },
  { value: 'aarch64', label: 'aarch64' }
]

const architectureTabs: Array<{ value: 'all' | 'x86_64' | 'aarch64'; labelKey?: string; label?: string }> = [
  { value: 'all', labelKey: 'common.all' },
  { value: 'x86_64', label: 'x86_64' },
  { value: 'aarch64', label: 'aarch64' }
]

// 计算属性
const isEditMode = computed(() => editingImage.value !== null)
const modalTitle = computed(() => isEditMode.value 
  ? t('admin.images.edit') 
  : t('admin.images.create')
)
const filteredImages = computed(() => {
  if (activeArchitecture.value === 'all') {
    return images.value
  }
  return images.value.filter(image => image.architecture === activeArchitecture.value)
})

function getArchitectureCount(architecture: 'all' | 'x86_64' | 'aarch64'): number {
  if (architecture === 'all') {
    return images.value.length
  }
  return images.value.filter(image => image.architecture === architecture).length
}

function getArchitectureBadgeClass(architecture?: string): string {
  if (architecture === 'aarch64') {
    return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'
  }
  return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'
}

function getInstanceTypeBadgeClass(instanceType?: string): string {
  if (instanceType === 'container') {
    return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'
  }
  if (instanceType === 'vm') {
    return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'
  }
  return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'
}

// 加载镜像列表
async function loadImages(): Promise<void> {
  loading.value = true
  try {
    const response = await api.images.list()
    images.value = response.images || []
  } catch (err: any) {
    toast.error(err.message || t('admin.images.loadFailed'))
  } finally {
    loading.value = false
  }
}

// 打开创建弹窗
function openCreateModal(): void {
  editingImage.value = null
  const defaultForm = getDefaultForm()
  if (activeArchitecture.value !== 'all') {
    defaultForm.architecture = activeArchitecture.value
  }
  form.value = defaultForm
  showModal.value = true
}

// 打开编辑弹窗
function openEditModal(image: SystemImage): void {
  editingImage.value = image
  form.value = {
    name: image.name,
    remoteAlias: image.remoteAlias,
    osType: image.osType || 'Linux',
    architecture: image.architecture || 'x86_64',
    instanceType: image.instanceType || 'both',
    icon: image.icon,
    sortOrder: image.sortOrder || 0,
    hidden: image.hidden || false
  }
  showModal.value = true
}

// 保存镜像
async function saveImage(): Promise<void> {
  if (!form.value.name || !form.value.remoteAlias || !form.value.icon) {
    toast.error(t('admin.images.validation.requiredFields'))
    return
  }

  saving.value = true
  try {
    if (isEditMode.value && editingImage.value) {
      const data: UpdateSystemImageRequest = {
        name: form.value.name,
        remoteAlias: form.value.remoteAlias,
        osType: form.value.osType,
        architecture: form.value.architecture,
        instanceType: form.value.instanceType,
        icon: form.value.icon,
        sortOrder: form.value.sortOrder,
        hidden: form.value.hidden
      }
      await api.images.update(editingImage.value.id, data)
      toast.success(t('admin.images.updateSuccess'))
    } else {
      const data: CreateSystemImageRequest = {
        name: form.value.name,
        remoteAlias: form.value.remoteAlias,
        osType: form.value.osType,
        architecture: form.value.architecture,
        instanceType: form.value.instanceType,
        icon: form.value.icon,
        sortOrder: form.value.sortOrder,
        hidden: form.value.hidden
      }
      await api.images.create(data)
      toast.success(t('admin.images.createSuccess'))
    }
    showModal.value = false
    await loadImages()
  } catch (err: any) {
    toast.error(err.message || t('admin.images.saveFailed'))
  } finally {
    saving.value = false
  }
}

// 切换隐藏状态
async function toggleHidden(image: SystemImage): Promise<void> {
  try {
    await api.images.update(image.id, { hidden: !image.hidden })
    toast.success(image.hidden ? t('admin.images.shown') : t('admin.images.hidden'))
    await loadImages()
  } catch (err: any) {
    toast.error(err.message)
  }
}

// 删除镜像
async function deleteImage(image: SystemImage): Promise<void> {
  if (!confirm(t('admin.images.confirmDelete', { name: image.name }))) return
  
  try {
    await api.images.delete(image.id)
    toast.success(t('admin.images.deleteSuccess'))
    await loadImages()
  } catch (err: any) {
    toast.error(err.message || t('admin.images.deleteFailed'))
  }
}

onMounted(() => {
  loadImages()
})
</script>

<template>
  <div class="kawaii-page nimbus-view space-y-6 animate-fade-in">
    <!-- Header -->
    <header class="flex flex-col gap-4 border-b border-themed pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-start gap-3">
        <span class="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 sm:flex">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 15.75h.008v.008H18v-.008zM6 6h12a2.25 2.25 0 012.25 2.25v9A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25v-9A2.25 2.25 0 016 6z" />
          </svg>
        </span>
        <div>
          <h1 class="text-xl font-semibold text-themed sm:text-2xl">{{ t('admin.images.title') }}</h1>
          <p class="mt-1 text-sm text-themed-muted">{{ t('admin.images.description') }}</p>
        </div>
      </div>
      <button class="btn-primary shrink-0 whitespace-nowrap" @click="openCreateModal">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('admin.images.create') }}
      </button>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="card p-12 text-center">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="text-themed-muted mt-4">{{ t('common.loading') }}</p>
    </div>

    <template v-else>
      <!-- Architecture Tabs -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="tab in architectureTabs"
          :key="tab.value"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors"
          :class="activeArchitecture === tab.value
            ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
            : 'border-themed bg-themed-surface text-themed-muted hover:bg-themed-hover hover:text-themed'"
          @click="activeArchitecture = tab.value"
        >
          <span>{{ tab.labelKey ? t(tab.labelKey) : tab.label }}</span>
          <span
            class="rounded-full px-1.5 py-0.5 font-mono text-2xs tabular-nums"
            :class="activeArchitecture === tab.value
              ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300'
              : 'bg-themed-secondary text-themed-muted'"
          >
            {{ getArchitectureCount(tab.value) }}
          </span>
        </button>
      </div>

      <!-- Images List -->
      <div v-if="filteredImages.length === 0" class="card p-12 text-center text-themed-muted">
        <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 15.75h.008v.008H18v-.008zM6 6h12a2.25 2.25 0 012.25 2.25v9A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25v-9A2.25 2.25 0 016 6z" />
          </svg>
        </span>
        {{ images.length === 0 ? t('admin.images.noImages') : t('admin.images.noImagesForArchitecture') }}
      </div>

      <template v-else>
        <div class="space-y-3 lg:hidden">
          <div
            v-for="image in filteredImages"
            :key="image.id"
            class="card p-4"
            :class="image.hidden ? 'opacity-70' : ''"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <DistroIcon :distro="image.icon" :size="32" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ image.name }}</div>
                  <div class="truncate font-mono text-xs text-themed-muted">{{ image.remoteAlias }}</div>
                </div>
              </div>
              <span
                class="shrink-0 px-2 py-1 text-xs rounded-full"
                :class="image.hidden
                  ? (themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600')
                  : (themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-700')"
              >
                {{ image.hidden ? t('admin.images.statusHidden') : t('admin.images.statusVisible') }}
              </span>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.images.fields.architecture') }}</div>
                <span
                  class="mt-1 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="getArchitectureBadgeClass(image.architecture)"
                >
                  {{ image.architecture }}
                </span>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.images.fields.instanceType') }}</div>
                <span
                  class="mt-1 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="getInstanceTypeBadgeClass(image.instanceType)"
                >
                  {{ image.instanceType === 'container' ? t('admin.images.typeContainer') : image.instanceType === 'vm' ? t('admin.images.typeVm') : t('admin.images.typeBoth') }}
                </span>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.images.fields.sortOrder') }}</div>
                <div class="mt-1 text-themed">{{ image.sortOrder }}</div>
              </div>
            </div>

            <div class="mt-4 flex justify-end gap-2 border-t border-themed pt-3">
              <button
                class="p-1.5 rounded transition-colors"
                :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
                :title="image.hidden ? t('admin.images.show') : t('admin.images.hide')"
                @click="toggleHidden(image)"
              >
                <svg v-if="image.hidden" class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <svg v-else class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              </button>
              <button
                class="p-1.5 rounded transition-colors"
                :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
                :title="t('common.edit')"
                @click="openEditModal(image)"
              >
                <svg class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                class="p-1.5 rounded transition-colors"
                :class="themeStore.isDark ? 'hover:bg-rose-900/50' : 'hover:bg-rose-50'"
                :title="t('common.delete')"
                @click="deleteImage(image)"
              >
                <svg class="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="card hidden overflow-hidden lg:block">
          <table class="w-full table-fixed">
          <thead>
            <tr class="border-b border-themed bg-themed-secondary/60 text-left text-2xs font-medium uppercase tracking-wide text-themed-muted">
              <th class="w-[7%] px-4 py-3">{{ t('admin.images.fields.icon') }}</th>
              <th class="w-[17%] px-4 py-3">{{ t('admin.images.fields.name') }}</th>
              <th class="w-[22%] px-4 py-3">{{ t('admin.images.fields.remoteAlias') }}</th>
              <th class="w-[13%] px-4 py-3">{{ t('admin.images.fields.architecture') }}</th>
              <th class="w-[13%] px-4 py-3">{{ t('admin.images.fields.instanceType') }}</th>
              <th class="w-[8%] px-4 py-3">{{ t('admin.images.fields.sortOrder') }}</th>
              <th class="w-[8%] px-4 py-3">{{ t('admin.images.fields.status') }}</th>
              <th class="w-[12%] px-4 py-3 text-right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr
              v-for="image in filteredImages"
              :key="image.id"
              class="transition-colors hover:bg-themed-hover"
              :class="image.hidden ? 'opacity-60' : ''"
            >
              <td class="px-4 py-3">
                <DistroIcon :distro="image.icon" :size="32" />
              </td>
              <td class="px-4 py-3 text-sm text-themed truncate" :title="image.name">{{ image.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-themed-muted truncate" :title="image.remoteAlias">{{ image.remoteAlias }}</td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="getArchitectureBadgeClass(image.architecture)"
                >
                  {{ image.architecture }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="getInstanceTypeBadgeClass(image.instanceType)"
                >
                  {{ image.instanceType === 'container' ? t('admin.images.typeContainer') : image.instanceType === 'vm' ? t('admin.images.typeVm') : t('admin.images.typeBoth') }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-themed-muted">{{ image.sortOrder }}</td>
              <td class="px-4 py-3">
                <span
                  class="px-2 py-1 text-xs rounded-full"
                  :class="image.hidden
                    ? (themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600')
                    : (themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-700')"
                >
                  {{ image.hidden ? t('admin.images.statusHidden') : t('admin.images.statusVisible') }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    class="p-1.5 rounded transition-colors"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
                    :title="image.hidden ? t('admin.images.show') : t('admin.images.hide')"
                    @click="toggleHidden(image)"
                  >
                    <svg v-if="image.hidden" class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <svg v-else class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  </button>
                  <button
                    class="p-1.5 rounded transition-colors"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
                    :title="t('common.edit')"
                    @click="openEditModal(image)"
                  >
                    <svg class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    class="p-1.5 rounded transition-colors"
                    :class="themeStore.isDark ? 'hover:bg-rose-900/50' : 'hover:bg-rose-50'"
                    :title="t('common.delete')"
                    @click="deleteImage(image)"
                  >
                    <svg class="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </template>
    </template>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="showModal = false"></div>
        <div class="relative w-full max-w-lg overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-2xl">
          <div class="p-6">
            <h3 class="mb-5 text-base font-semibold text-themed">{{ modalTitle }}</h3>
            
            <form class="space-y-4" @submit.prevent="saveImage">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.name') }} *</label>
                <input v-model="form.name" type="text" class="input" :placeholder="t('admin.images.placeholder.name')" />
              </div>
              
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.remoteAlias') }} *</label>
                <input v-model="form.remoteAlias" type="text" class="input font-mono" :placeholder="t('admin.images.placeholder.remoteAlias')" />
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.images.hint.remoteAlias') }}</p>
              </div>
              
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.osType') }}</label>
                  <input v-model="form.osType" type="text" class="input" />
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.architecture') }}</label>
                  <select v-model="form.architecture" class="input">
                    <option v-for="option in architectureOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
              </div>
              
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.instanceType') }}</label>
                <select v-model="form.instanceType" class="input">
                  <option value="both">{{ t('admin.images.typeBoth') }}</option>
                  <option value="container">{{ t('admin.images.typeContainer') }}</option>
                  <option value="vm">{{ t('admin.images.typeVm') }}</option>
                </select>
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.images.hint.instanceType') }}</p>
              </div>
              
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.icon') }} *</label>
                <select v-model="form.icon" class="input">
                  <option value="">{{ t('admin.images.placeholder.icon') }}</option>
                  <option v-for="icon in iconOptions" :key="icon" :value="icon">{{ icon }}</option>
                </select>
              </div>
              
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.images.fields.sortOrder') }}</label>
                <input v-model.number="form.sortOrder" type="number" class="input" min="0" />
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.images.hint.sortOrder') }}</p>
              </div>
              
              <div class="flex items-center gap-2">
                <input :id="'hidden'" v-model="form.hidden" type="checkbox" class="w-4 h-4 rounded" />
                <label :for="'hidden'" class="text-sm text-themed-secondary cursor-pointer">{{ t('admin.images.fields.hidden') }}</label>
              </div>
              
              <div class="flex justify-end gap-3 pt-4">
                <button type="button" class="btn-secondary" @click="showModal = false">{{ t('common.cancel') }}</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  <span v-if="saving" class="loading-spinner w-4 h-4 mr-2"></span>
                  {{ isEditMode ? t('common.save') : t('common.create') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .nimbus-view *,
  .nimbus-view *::before,
  .nimbus-view *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
  }
}
</style>
