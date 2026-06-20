<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
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
    return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800/70'
  }
  return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800/70'
}

function getInstanceTypeBadgeClass(instanceType?: string): string {
  if (instanceType === 'container') {
    return 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:ring-cyan-800/70'
  }
  if (instanceType === 'vm') {
    return 'bg-violet-100 text-violet-800 ring-1 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-800/70'
  }
  return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800/70'
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
  <div class="space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">{{ t('admin.images.title') }}</h1>
        <p class="page-description">{{ t('admin.images.description') }}</p>
      </div>
      <button class="btn-primary whitespace-nowrap" @click="openCreateModal">
        <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('admin.images.create') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card p-12 text-center">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="text-themed-muted mt-4">{{ t('common.loading') }}</p>
    </div>

    <template v-else>
      <!-- Architecture Tabs -->
      <div class="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        <button
          v-for="tab in architectureTabs"
          :key="tab.value"
          type="button"
          class="shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          :class="activeArchitecture === tab.value
            ? 'border-black dark:border-white text-gray-900 dark:text-white'
            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
          @click="activeArchitecture = tab.value"
        >
          <span>{{ tab.labelKey ? t(tab.labelKey) : tab.label }}</span>
          <span
            class="ml-2 rounded-full px-2 py-0.5 text-xs"
            :class="activeArchitecture === tab.value
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
          >
            {{ getArchitectureCount(tab.value) }}
          </span>
        </button>
      </div>

      <!-- Images Table -->
      <div class="card overflow-x-auto">
        <table class="table-auto w-full min-w-[640px]">
          <thead>
            <tr :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.icon') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.name') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.remoteAlias') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.architecture') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.instanceType') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.sortOrder') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('admin.images.fields.status') }}</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-themed-muted uppercase">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y" :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'">
            <tr
              v-for="image in filteredImages"
              :key="image.id"
              :class="[
                'transition-colors',
                image.hidden ? (themeStore.isDark ? 'bg-gray-900/50 opacity-60' : 'bg-gray-50/50 opacity-60') : '',
                themeStore.isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
              ]"
            >
              <td class="px-4 py-3">
                <DistroIcon :distro="image.icon" :size="32" />
              </td>
              <td class="px-4 py-3 text-sm text-themed">{{ image.name }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted font-mono text-xs">{{ image.remoteAlias }}</td>
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
                    :class="themeStore.isDark ? 'hover:bg-red-900/50' : 'hover:bg-red-50'"
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

        <div v-if="filteredImages.length === 0" class="p-12 text-center text-themed-muted">
          {{ images.length === 0 ? t('admin.images.noImages') : t('admin.images.noImagesForArchitecture') }}
        </div>
      </div>
    </template>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="showModal = false"></div>
        <div 
          class="relative w-full max-w-lg mx-4 rounded-lg shadow-xl"
          :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
        >
          <div class="p-6">
            <h3 class="text-lg font-medium mb-4 text-themed">{{ modalTitle }}</h3>
            
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
