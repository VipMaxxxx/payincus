<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'

const { t } = useI18n()
const toast = useToast()

interface StorageConfig {
  id: number
  name: string
  type: 'WEBDAV' | 'FTP' | 'SFTP' | 'S3'
  host: string
  port: number | null
  username: string | null
  basePath: string | null
  isDefault: boolean
  createdAt: string
}

const storageConfigs = ref<StorageConfig[]>([])
const showAddForm = ref(false)
const editingId = ref<number | null>(null)
const loading = ref(false)
const testingId = ref<number | null>(null)

const form = ref({
  name: '',
  type: 'WEBDAV' as 'WEBDAV' | 'FTP' | 'SFTP' | 'S3',
  host: '',
  port: null as number | null,
  username: '',
  password: '',
  basePath: '/backups/',
  isDefault: false
})

const defaultPorts: Record<string, number> = {
  WEBDAV: 443,
  FTP: 21,
  SFTP: 22
}

const typeLabels: Record<string, string> = {
  WEBDAV: 'WebDAV',
  FTP: 'FTP',
  SFTP: 'SFTP'
}

const typeIcons: Record<string, string> = {
  WEBDAV: '🌐',
  FTP: '📁',
  SFTP: '🔐'
}

const portPlaceholder = computed(() => {
  return defaultPorts[form.value.type] || 443
})

const hostPlaceholder = computed(() => {
  switch (form.value.type) {
    case 'WEBDAV':
      return 'https://nas.example.com'
    case 'FTP':
      return 'ftp.example.com'
    case 'SFTP':
      return 'ssh.example.com'
    default:
      return 'example.com'
  }
})

async function loadStorageConfigs() {
  try {
    const data = await api.storageConfigs.list()
    storageConfigs.value = data as StorageConfig[]
  } catch (error) {
    console.error('Failed to load storage configs:', error)
  }
}

function resetForm() {
  form.value = {
    name: '',
    type: 'WEBDAV',
    host: '',
    port: null,
    username: '',
    password: '',
    basePath: '/backups/',
    isDefault: false
  }
  editingId.value = null
}

function openAddForm() {
  resetForm()
  showAddForm.value = true
}

function openEditForm(config: StorageConfig) {
  form.value = {
    name: config.name,
    type: config.type,
    host: config.host,
    port: config.port,
    username: config.username || '',
    password: '', // 不回显密码
    basePath: config.basePath || '/backups/',
    isDefault: config.isDefault
  }
  editingId.value = config.id
  showAddForm.value = true
}

async function saveConfig() {
  if (!form.value.name || !form.value.host) {
    toast.error(t('profile.storage.nameHostRequired'))
    return
  }

  loading.value = true
  try {
    const data = {
      name: form.value.name,
      type: form.value.type,
      host: form.value.host,
      port: form.value.port || undefined,
      username: form.value.username || undefined,
      password: form.value.password || undefined,
      basePath: form.value.basePath || undefined,
      isDefault: form.value.isDefault
    }

    if (editingId.value) {
      await api.storageConfigs.update(editingId.value, data)
      toast.success(t('profile.storage.updateSuccess'))
    } else {
      await api.storageConfigs.create(data)
      toast.success(t('profile.storage.createSuccess'))
    }

    showAddForm.value = false
    resetForm()
    await loadStorageConfigs()
  } catch (error: any) {
    toast.error(error?.message || t('profile.storage.saveFailed'))
  } finally {
    loading.value = false
  }
}

async function deleteConfig(id: number) {
  if (!confirm(t('profile.storage.confirmDelete'))) return

  try {
    await api.storageConfigs.delete(id)
    toast.success(t('profile.storage.deleteSuccess'))
    await loadStorageConfigs()
  } catch (error: any) {
    // 处理有活跃任务的情况
    if (error?.code === 'STORAGE_HAS_ACTIVE_TASKS') {
      toast.error(t('profile.storage.hasActiveTasks'))
    } else {
      toast.error(error?.message || t('profile.storage.deleteFailed'))
    }
  }
}

async function testConnection(id: number) {
  testingId.value = id
  try {
    const result = await api.storageConfigs.test(id)
    if (result.success) {
      toast.success(t('profile.storage.testSuccess'))
    } else {
      toast.error(result.message || t('profile.storage.testFailed'))
    }
  } catch (error: any) {
    toast.error(error?.message || t('profile.storage.testFailed'))
  } finally {
    testingId.value = null
  }
}

async function setDefault(id: number) {
  try {
    await api.storageConfigs.setDefault(id)
    toast.success(t('profile.storage.setDefaultSuccess'))
    await loadStorageConfigs()
  } catch (error: any) {
    toast.error(error?.message || t('profile.storage.setDefaultFailed'))
  }
}

// 挂载时加载
loadStorageConfigs()
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-sm font-medium text-themed-secondary">{{ $t('profile.storage.title') }}</h2>
        <p class="text-xs text-themed-faint mt-0.5">{{ $t('profile.storage.description') }}</p>
      </div>
      <button class="btn-ghost btn-sm" @click="openAddForm">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ $t('profile.storage.add') }}
      </button>
    </div>

    <!-- 添加/编辑表单 -->
    <div v-if="showAddForm" class="mb-4 p-4 bg-themed-tertiary border border-themed rounded-lg space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.name') }}</label>
          <input v-model="form.name" type="text" class="input" :placeholder="$t('profile.storage.namePlaceholder')" />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.type') }}</label>
          <select v-model="form.type" class="input">
            <option value="WEBDAV">WebDAV</option>
            <option value="FTP">FTP</option>
            <option value="SFTP">SFTP</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.host') }}</label>
          <input v-model="form.host" type="text" class="input" :placeholder="hostPlaceholder" />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.port') }}</label>
          <input v-model.number="form.port" type="number" class="input" :placeholder="String(portPlaceholder)" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.username') }}</label>
          <input v-model="form.username" type="text" class="input" />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.password') }}</label>
          <input v-model="form.password" type="password" class="input" :placeholder="editingId ? $t('profile.storage.passwordUnchanged') : ''" />
        </div>
      </div>

      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.storage.basePath') }}</label>
        <input v-model="form.basePath" type="text" class="input" placeholder="/backups/" />
      </div>

      <div class="flex items-center gap-2">
        <input id="isDefault" v-model="form.isDefault" type="checkbox" class="rounded" />
        <label for="isDefault" class="text-xs text-themed-muted">{{ $t('profile.storage.setAsDefault') }}</label>
      </div>

      <div class="flex gap-2">
        <button :disabled="loading" class="btn-primary btn-sm" @click="saveConfig">
          {{ loading ? $t('common.saving') : $t('common.save') }}
        </button>
        <button class="btn-ghost btn-sm" @click="showAddForm = false">{{ $t('common.cancel') }}</button>
      </div>
    </div>

    <!-- 存储配置列表 -->
    <TransitionGroup v-if="storageConfigs.length" name="list" tag="div" class="space-y-2">
      <div
        v-for="config in storageConfigs" :key="config.id" 
        class="group flex items-center justify-between p-3 bg-themed-tertiary border border-themed rounded-lg hover:border-themed-secondary transition-colors"
      >
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded bg-themed-secondary flex items-center justify-center text-lg">
            {{ typeIcons[config.type] }}
          </div>
          <div>
            <div class="text-sm text-themed-secondary flex items-center gap-2">
              {{ config.name }}
              <span class="text-xs px-1.5 py-0.5 rounded badge-default">
                {{ typeLabels[config.type] }}
              </span>
              <span v-if="config.isDefault" class="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                {{ $t('profile.storage.default') }}
              </span>
            </div>
            <div class="text-xs text-themed-faint">{{ config.host }}{{ config.basePath }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            class="btn-ghost btn-sm" 
            :disabled="testingId === config.id"
            @click="testConnection(config.id)"
          >
            <svg v-if="testingId === config.id" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span v-else>{{ $t('profile.storage.test') }}</span>
          </button>
          <button v-if="!config.isDefault" class="btn-ghost btn-sm" @click="setDefault(config.id)">
            {{ $t('profile.storage.setDefault') }}
          </button>
          <button class="btn-ghost btn-sm" @click="openEditForm(config)">
            {{ $t('common.edit') }}
          </button>
          <button class="text-themed-faint hover:text-red-400" @click="deleteConfig(config.id)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </TransitionGroup>

    <!-- 空状态 -->
    <div v-else-if="!showAddForm" class="text-sm text-themed-muted text-center py-6 border border-dashed border-themed rounded-lg">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
      {{ $t('profile.storage.noConfigs') }}
    </div>
  </div>
</template>
