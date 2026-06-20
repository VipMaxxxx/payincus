<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useRestoreTask } from '@/stores/restoreTask'
import { formatDate, formatDuration } from '@/utils/formatters'
import type { Backup, BackupPolicy, CreateBackupRequest, UpdateBackupPolicyRequest } from '@/types/api'

const { t } = useI18n()

interface Props {
  instanceId: string | number
  instanceName?: string
  backupLimit?: number | null
  canManageBackups?: boolean  // AUTH004: 节点所有者不能下载/上传备份
}

const props = withDefaults(defineProps<Props>(), {
  instanceName: '',
  backupLimit: null,
  canManageBackups: true
})

// 配额状态
const hasQuota = computed<boolean>(() => props.backupLimit !== null && props.backupLimit !== undefined)
const quotaUsed = computed<number>(() => backups.value.filter(b => b.status !== 'deleted').length)
const quotaRemaining = computed<number>(() => hasQuota.value ? Math.max(0, (props.backupLimit || 0) - quotaUsed.value) : 0)
const isQuotaFull = computed<boolean>(() => hasQuota.value && quotaRemaining.value <= 0)

const toast = useToast()
const themeStore = useThemeStore()
const restoreTask = useRestoreTask()

// 备份列表
const backups = ref<Backup[]>([])
const loading = ref<boolean>(true)

// 创建备份弹窗
const showCreateModal = ref<boolean>(false)
interface CreateForm {
  name: string
  description: string
}
const createForm = ref<CreateForm>({ name: '', description: '' })
const createLoading = ref<boolean>(false)

// 自动备份策略
const policy = ref<BackupPolicy | null>(null)
const showPolicyModal = ref<boolean>(false)
const policyForm = ref<UpdateBackupPolicyRequest>({ enabled: false, intervalMinutes: 360 })
const policyLoading = ref<boolean>(false)

// 导出状态
interface ExportState {
  backupId: number
  taskId: string | null
  status: 'idle' | 'preparing' | 'ready' | 'downloading' | 'error'
  error?: string
}
const exportStates = ref<Map<number, ExportState>>(new Map())

// 恢复确认弹窗
const showRestoreConfirm = ref<boolean>(false)
const restoreTargetBackup = ref<Backup | null>(null)



onMounted(async () => {
  await Promise.all([loadBackups(), loadPolicy(), loadActiveUploadTask()])
})

const instanceIdNum = computed<number>(() => Number(props.instanceId))

async function loadBackups(): Promise<void> {
  loading.value = true
  try {
    const res = await api.instances.getBackups(instanceIdNum.value)
    backups.value = Array.isArray(res) ? res : []
  } catch (err) {
    console.error('Failed to load backups:', err)
  } finally {
    loading.value = false
  }
}

async function loadPolicy(): Promise<void> {
  try {
    const res = await api.instances.getBackupPolicy(instanceIdNum.value)
    policy.value = res
    if (res) {
      policyForm.value = {
        enabled: res.enabled === 1,
        intervalMinutes: res.interval_minutes
      }
    }
  } catch (err) {
    console.error('Failed to load policy:', err)
  }
}

async function createBackup(): Promise<void> {
  if (!createForm.value.name) return
  
  createLoading.value = true
  try {
    const payload: CreateBackupRequest = {
      name: createForm.value.name,
      description: createForm.value.description || undefined
    }
    await api.instances.createBackup(instanceIdNum.value, payload)
    toast.success(t('backup.messages.createSuccess'))
    showCreateModal.value = false
    createForm.value = { name: '', description: '' }
    await loadBackups()
  } catch (err: any) {
    toast.error(t('backup.messages.createFailed') + ': ' + (err?.message || String(err)))
  } finally {
    createLoading.value = false
  }
}

async function deleteBackup(backup: Backup): Promise<void> {
  if (!confirm(t('backup.messages.deleteConfirm', { name: backup.name }))) return
  
  try {
    await api.instances.deleteBackup(instanceIdNum.value, backup.id)
    backups.value = backups.value.filter(b => b.id !== backup.id)
    toast.success(t('backup.messages.deleteSuccess'))
  } catch (err: any) {
    toast.error(t('backup.messages.deleteFailed') + ': ' + (err?.message || String(err)))
    await loadBackups()
  }
}


async function savePolicy(): Promise<void> {
  policyLoading.value = true
  try {
    await api.instances.updateBackupPolicy(instanceIdNum.value, policyForm.value)
    toast.success(t('backup.messages.policySaved'))
    showPolicyModal.value = false
    await loadPolicy()
  } catch (err: any) {
    toast.error(t('backup.messages.policySaveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    policyLoading.value = false
  }
}

// 取消自动备份策略
async function disableAutoPolicy(): Promise<void> {
  policyLoading.value = true
  try {
    await api.instances.updateBackupPolicy(instanceIdNum.value, { enabled: false, intervalMinutes: policyForm.value.intervalMinutes })
    toast.success(t('backup.messages.policyDisabled'))
    await loadPolicy()
  } catch (err: any) {
    toast.error(t('backup.messages.policySaveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    policyLoading.value = false
  }
}

// 获取间隔时间的显示文本
function getIntervalLabel(minutes: number): string {
  const intervalMap: Record<number, string> = {
    60: t('backup.policyModal.intervalOptions.hour1'),
    360: t('backup.policyModal.intervalOptions.hour6'),
    1440: t('backup.policyModal.intervalOptions.hour24'),
    4320: t('backup.policyModal.intervalOptions.day3')
  }
  return intervalMap[minutes] || `${minutes} ${t('backup.minutes')}`
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function getStatusInfo(status: string): { label: string; class: string } {
  const map: Record<string, { label: string; class: string }> = {
    creating: { label: t('backup.status.creating'), class: 'text-yellow-500' },
    ready: { label: t('backup.status.ready'), class: 'text-green-500' },
    error: { label: t('backup.status.error'), class: 'text-red-500' }
  }
  return map[status] || { label: status, class: 'text-gray-500' }
}

// 获取备份的导出状态
function getExportState(backupId: number): ExportState {
  if (!exportStates.value.has(backupId)) {
    exportStates.value.set(backupId, {
      backupId,
      taskId: null,
      status: 'idle'
    })
  }
  return exportStates.value.get(backupId)!
}

// 开始导出备份（内部调用，不显示提示）
async function startExport(backup: Backup): Promise<void> {
  const state = getExportState(backup.id)
  state.status = 'preparing'
  state.error = undefined

  try {
    const res = await api.instances.exportBackup(instanceIdNum.value, backup.id)
    state.taskId = res.taskId
    state.status = 'ready'
  } catch (err: any) {
    state.status = 'error'
    state.error = err?.message || String(err)
    toast.error(t('backup.messages.exportFailed') + ': ' + state.error)
  }
}

// 下载备份（安全改进：使用一次性下载 token）
async function downloadBackup(backup: Backup): Promise<void> {
  const state = getExportState(backup.id)
  
  if (!state.taskId) {
    // 如果没有任务ID，先创建导出任务
    await startExport(backup)
    if (state.status !== 'ready') return
  }

  state.status = 'downloading'

  try {
    // 获取一次性下载 token（替代不安全的 JWT URL 参数）
    const { downloadUrl } = await api.instances.getDownloadToken(instanceIdNum.value, state.taskId!)
    
    // downloadUrl 已经包含 /api 前缀，直接使用
    const fullUrl = downloadUrl
    
    // 使用隐藏 iframe 触发下载，这样：
    // 1. 浏览器会显示下载进度
    // 2. 用户可以离开页面，下载继续
    // 3. 不会打开新标签页
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = fullUrl
    document.body.appendChild(iframe)
    
    // 5秒后移除 iframe（下载已经开始）
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 5000)

    toast.success(t('backup.messages.downloadStarted'), 6000)
    
    // 重置状态（下载由浏览器处理）
    state.status = 'idle'
    state.taskId = null
  } catch (err: any) {
    state.status = 'error'
    state.error = err?.message || String(err)
    toast.error(t('backup.messages.downloadFailed') + ': ' + state.error, 5000)
  }
}

// 获取导出按钮文本
function getExportButtonText(backup: Backup): string {
  const state = getExportState(backup.id)
  switch (state.status) {
    case 'preparing':
      return t('backup.preparing')
    case 'ready':
      return t('backup.clickToDownload')
    case 'downloading':
      return t('backup.downloading')
    case 'error':
      return t('backup.retry')
    default:
      return t('backup.export')
  }
}

// 是否可以导出
function canExport(backup: Backup): boolean {
  const state = getExportState(backup.id)
  // AUTH004: 节点所有者不能下载备份
  return props.canManageBackups !== false && backup.status === 'ready' && !['preparing', 'downloading'].includes(state.status)
}

// ==================== 恢复功能 (使用全局 store) ====================

// 显示恢复确认对话框
function showRestoreConfirmDialog(backup: Backup): void {
  restoreTargetBackup.value = backup
  showRestoreConfirm.value = true
}

// 确认恢复
async function confirmRestore(): Promise<void> {
  if (!restoreTargetBackup.value) return
  
  const backup = restoreTargetBackup.value
  
  showRestoreConfirm.value = false

  // 使用全局 store 启动恢复任务
  await restoreTask.startRestore(instanceIdNum.value, backup.id, backup.name, t)
}

// 回滚恢复
async function rollbackRestore(): Promise<void> {
  await restoreTask.rollback(t)
}

// 是否可以恢复
function canRestore(backup: Backup): boolean {
  const exportState = getExportState(backup.id)
  // 检查备份状态和是否有正在进行的恢复任务
  return backup.status === 'ready' && 
         !restoreTask.isBackupRestoring(instanceIdNum.value, backup.id) &&
         !['preparing', 'downloading'].includes(exportState.status)
}

// 是否正在恢复
function isRestoring(backup: Backup): boolean {
  return restoreTask.isBackupRestoring(instanceIdNum.value, backup.id)
}

// 是否可以回滚
function canRollback(backup: Backup): boolean {
  return restoreTask.canRollbackBackup(instanceIdNum.value, backup.id)
}

// ==================== 上传到远程存储 ====================

interface StorageConfig {
  id: number
  name: string
  type: string
  host: string
  isDefault: boolean
}

const showUploadModal = ref(false)
const uploadTargetBackup = ref<Backup | null>(null)
const storageConfigs = ref<StorageConfig[]>([])
const selectedStorageId = ref<number | null>(null)
const uploadLoading = ref(false)
const uploadTaskId = ref<number | null>(null)
const uploadBackupId = ref<number | null>(null)  // 跟踪正在上传的备份ID
const uploadStatus = ref<string | null>(null)
const uploadQueuePosition = ref<number>(0)
const uploadDuration = ref<number | null>(null)
let isPolling = false  // 防止重复轮询

// 打开上传弹窗
async function openUploadModal(backup: Backup) {
  uploadTargetBackup.value = backup
  uploadLoading.value = true
  showUploadModal.value = true
  
  try {
    const configs = await api.storageConfigs.list()
    storageConfigs.value = configs
    // 默认选择默认存储
    const defaultConfig = configs.find(c => c.isDefault)
    selectedStorageId.value = defaultConfig?.id || (configs.length > 0 ? configs[0].id : null)
  } catch (err) {
    console.error('Failed to load storage configs:', err)
    storageConfigs.value = []
  } finally {
    uploadLoading.value = false
  }
}

// 开始上传
async function startUpload() {
  if (!uploadTargetBackup.value) return
  
  uploadLoading.value = true
  try {
    const result = await api.instances.uploadBackupRemote(
      instanceIdNum.value,
      uploadTargetBackup.value.id,
      selectedStorageId.value || undefined
    )
    
    uploadTaskId.value = result.taskId
    uploadBackupId.value = uploadTargetBackup.value.id
    uploadStatus.value = result.status
    toast.success(t('backup.messages.uploadStarted'))
    showUploadModal.value = false
    
    // 开始轮询任务状态
    pollUploadStatus()
  } catch (err: any) {
    if (err?.code === 'BACKUP_UPLOAD_IN_PROGRESS') {
      toast.warning(t('backup.messages.uploadInProgress'))
    } else {
      toast.error(t('backup.messages.uploadFailed') + ': ' + (err?.message || String(err)))
    }
  } finally {
    uploadLoading.value = false
  }
}

// 轮询上传状态
async function pollUploadStatus() {
  if (!uploadTaskId.value || isPolling) return
  
  isPolling = true
  
  const poll = async () => {
    // 再次检查，防止在异步间隙被清除
    if (!uploadTaskId.value) {
      isPolling = false
      return
    }
    
    try {
      const status = await api.instances.getUploadTaskStatus(instanceIdNum.value, uploadTaskId.value!)
      uploadStatus.value = status.status
      uploadQueuePosition.value = status.queuePosition || 0
      uploadDuration.value = status.duration || null
      
      if (status.status === 'COMPLETED') {
        toast.success(t('backup.messages.uploadCompleted'))
        uploadTaskId.value = null
        uploadBackupId.value = null
        uploadStatus.value = null
        uploadQueuePosition.value = 0
        uploadDuration.value = null
        isPolling = false
      } else if (status.status === 'FAILED') {
        toast.error(t('backup.messages.uploadFailed') + ': ' + (status.error || ''))
        uploadTaskId.value = null
        uploadBackupId.value = null
        uploadStatus.value = null
        uploadQueuePosition.value = 0
        uploadDuration.value = null
        isPolling = false
      } else {
        // 继续轮询
        setTimeout(poll, 3000)
      }
    } catch (err) {
      console.error('Failed to poll upload status:', err)
      uploadTaskId.value = null
      uploadBackupId.value = null
      uploadStatus.value = null
      uploadQueuePosition.value = 0
      uploadDuration.value = null
      isPolling = false
    }
  }
  
  poll()
}

// 加载活跃的上传任务（用于页面刷新后恢复状态）
async function loadActiveUploadTask() {
  try {
    const result = await api.instances.getActiveUploadTask(instanceIdNum.value)
    if (result.task) {
      uploadTaskId.value = result.task.taskId
      uploadBackupId.value = result.task.backupId
      uploadStatus.value = result.task.status
      uploadQueuePosition.value = result.task.queuePosition || 0
      uploadDuration.value = result.task.duration || null
      // 继续轮询
      pollUploadStatus()
    }
  } catch (err) {
    console.error('Failed to load active upload task:', err)
  }
}

// 是否可以上传
function canUpload(backup: Backup): boolean {
  // AUTH004: 节点所有者不能上传备份
  // 备份必须是 ready 状态，且没有正在恢复，且没有其他上传任务进行中
  return props.canManageBackups !== false && backup.status === 'ready' && !isRestoring(backup) && uploadTaskId.value === null
}

// 是否正在上传
function isUploading(backup: Backup): boolean {
  return uploadTaskId.value !== null && uploadBackupId.value === backup.id
}

// 计算属性：获取当前恢复任务（解包 ref）
const currentRestoreTask = computed(() => restoreTask.activeTask.value)

// 获取恢复任务信息
function getRestoreTaskInfo(_backup: Backup): string {
  const task = restoreTask.activeTask.value
  if (!task) return ''
  const parts: string[] = []
  if (task.createdAt) parts.push(`创建: ${formatDate(task.createdAt)}`)
  if (task.startedAt) parts.push(`开始: ${formatDate(task.startedAt)}`)
  if (task.duration) parts.push(`执行: ${formatDuration(task.duration)}`)
  if (task.queuePosition && task.queuePosition > 1) parts.push(`队列位置: ${task.queuePosition}`)
  return parts.join('\n')
}

// 获取上传任务信息
function getUploadTaskInfo(): string {
  const parts: string[] = []
  // 注意：这里没有保存createdAt等信息，如果需要可以添加
  if (uploadDuration.value) parts.push(`执行时长: ${formatDuration(uploadDuration.value)}`)
  if (uploadQueuePosition.value && uploadQueuePosition.value > 1) parts.push(`队列位置: ${uploadQueuePosition.value}`)
  return parts.join('\n')
}
</script>

<template>
  <div class="card">
    <div 
      class="flex items-center justify-between p-4 border-b"
      :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
    >
      <div>
        <h2 
          class="text-sm font-medium"
          :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
        >
          {{ t('backup.title') }}
        </h2>
        <p 
          class="text-xs mt-0.5"
          :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
        >
          {{ policy?.enabled ? t('backup.autoPolicy') : t('backup.manual') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="hasQuota" class="text-xs text-themed-muted">
          {{ quotaUsed }}/{{ backupLimit }}
        </span>
        <button class="btn-ghost btn-sm" :title="t('backup.autoSettings')" @click="showPolicyModal = true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button 
          :disabled="!hasQuota || isQuotaFull" 
          :class="['btn-ghost btn-sm', (!hasQuota || isQuotaFull) && 'opacity-50 cursor-not-allowed']"
          :title="!hasQuota ? t('backup.noQuota') : isQuotaFull ? t('backup.quotaFull') : t('backup.createBackup')"
          @click="showCreateModal = true"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('backup.create') }}
        </button>
      </div>
    </div>

    <!-- 自动备份策略提醒横幅 -->
    <div 
      v-if="policy?.enabled" 
      class="mx-4 mt-4 p-3 rounded-lg flex items-center justify-between gap-3"
      :class="themeStore.isDark ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-200'"
    >
      <div class="flex items-center gap-3">
        <div 
          class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          :class="themeStore.isDark ? 'bg-blue-500/20' : 'bg-blue-100'"
        >
          <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-700'">
            {{ t('backup.autoPolicyEnabled') }}
          </p>
          <p class="text-xs" :class="themeStore.isDark ? 'text-blue-500/70' : 'text-blue-600'">
            {{ t('backup.currentPolicy') }}: {{ getIntervalLabel(policy.interval_minutes) }}
          </p>
        </div>
      </div>
      <button 
        class="btn-ghost btn-sm flex-shrink-0"
        :class="themeStore.isDark ? 'text-blue-400 hover:bg-blue-500/20' : 'text-blue-600 hover:bg-blue-100'"
        :disabled="policyLoading"
        @click="disableAutoPolicy"
      >
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {{ t('backup.disableAutoPolicy') }}
      </button>
    </div>

    <div v-if="loading" class="p-4 animate-pulse">
      <div v-for="i in 2" :key="i" class="flex items-center gap-3 py-3">
        <div 
          class="w-8 h-8 rounded"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="flex-1 space-y-2">
          <div 
            class="h-3 rounded w-1/3"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div 
            class="h-2 rounded w-1/4"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-200/50'"
          ></div>
        </div>
      </div>
    </div>

    <div 
      v-else-if="backups.length === 0" 
      class="p-8 text-center text-sm"
      :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
    >
      <svg class="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
      </svg>
      <template v-if="!hasQuota">
        <p class="text-yellow-500 mb-1">{{ t('backup.noQuotaAllocated') }}</p>
        <p class="text-xs">{{ t('backup.allocateQuotaHint') }}</p>
      </template>
      <template v-else>
        {{ t('backup.noBackups') }}
      </template>
    </div>

    <div 
      v-else 
      class="divide-y"
      :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'"
    >
      <div 
        v-for="backup in backups" 
        :key="backup.id"
        class="flex items-center justify-between p-4 transition-colors"
        :class="themeStore.isDark ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'"
      >
        <div class="flex items-center gap-3">
          <div 
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
          >
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
          </div>
          <div>
            <div 
              class="text-sm flex items-center gap-2"
              :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
            >
              {{ backup.name }}
              <span :class="['text-xs', getStatusInfo(backup.status).class]">
                {{ getStatusInfo(backup.status).label }}
              </span>
            </div>
            <div 
              class="text-xs"
              :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
            >
              {{ formatDate(backup.created_at) }}
              <span v-if="backup.size" class="ml-2">{{ formatSize(backup.size) }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <!-- 恢复按钮 -->
          <button 
            v-if="canRestore(backup)"
            class="btn-ghost btn-sm text-blue-500"
            @click="showRestoreConfirmDialog(backup)"
          >
            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {{ t('backup.restore') }}
          </button>
          <!-- 恢复中状态 -->
          <span 
            v-else-if="isRestoring(backup)"
            class="btn-ghost btn-sm text-yellow-500 cursor-not-allowed"
            :title="getRestoreTaskInfo(backup)"
          >
            <svg class="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ t('backup.restoring') }}
            <span v-if="currentRestoreTask?.queuePosition && currentRestoreTask.queuePosition > 1" class="ml-1 text-xs">
              (队列: {{ currentRestoreTask.queuePosition }})
            </span>
            <span v-if="currentRestoreTask?.duration" class="ml-1 text-xs">
              ({{ formatDuration(currentRestoreTask.duration) }})
            </span>
          </span>
          <!-- 回滚按钮 -->
          <button 
            v-else-if="canRollback(backup)"
            class="btn-ghost btn-sm text-orange-500"
            @click="rollbackRestore()"
          >
            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            {{ t('backup.rollback') }}
          </button>
          <!-- 上传到云端按钮 -->
          <button 
            v-if="canUpload(backup) && !isUploading(backup)"
            class="btn-ghost btn-sm text-purple-500"
            @click="openUploadModal(backup)"
          >
            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {{ t('backup.upload') }}
          </button>
          <!-- 上传中状态 -->
          <span 
            v-else-if="isUploading(backup)"
            class="btn-ghost btn-sm text-purple-500 cursor-not-allowed"
            :title="getUploadTaskInfo()"
          >
            <svg class="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ uploadStatus === 'PENDING' ? t('backup.uploadStatus.pending') : t('backup.uploadStatus.processing') }}
            <span v-if="uploadQueuePosition && uploadQueuePosition > 1" class="ml-1 text-xs">
              (队列: {{ uploadQueuePosition }})
            </span>
            <span v-if="uploadDuration" class="ml-1 text-xs">
              ({{ formatDuration(uploadDuration) }})
            </span>
          </span>
          <!-- 导出按钮 -->
          <button 
            :disabled="!canExport(backup)" 
            class="btn-ghost btn-sm"
            :class="getExportState(backup.id).status === 'ready' ? 'text-green-500' : ''"
            @click="downloadBackup(backup)"
          >
            <svg 
              v-if="['preparing', 'downloading'].includes(getExportState(backup.id).status)" 
              class="w-3 h-3 mr-1 animate-spin" 
              fill="none" 
              viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg 
              v-else-if="getExportState(backup.id).status === 'ready'" 
              class="w-3 h-3 mr-1" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <svg 
              v-else 
              class="w-3 h-3 mr-1" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {{ getExportButtonText(backup) }}
          </button>
          <!-- 删除按钮 -->
          <button 
            :disabled="backup.status === 'creating' || isRestoring(backup)" 
            class="btn-ghost btn-sm text-error"
            @click="deleteBackup(backup)"
          >
            {{ t('backup.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 创建备份弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showCreateModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('backup.createModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showCreateModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="createBackup">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('backup.createModal.name') }} <span class="text-error">{{ t('backup.createModal.nameRequired') }}</span></label>
                <input v-model="createForm.name" type="text" class="input" :placeholder="t('backup.createModal.namePlaceholder')" required />
              </div>
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('backup.createModal.description') }}</label>
                <input v-model="createForm.description" type="text" class="input" :placeholder="t('backup.createModal.descriptionPlaceholder')" />
              </div>

              <p class="text-xs text-themed-muted">
                {{ t('backup.createModal.createHint') }}
              </p>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showCreateModal = false">{{ t('backup.createModal.cancel') }}</button>
              <button :disabled="createLoading || !createForm.name" class="btn-primary" @click="createBackup">
                {{ createLoading ? t('backup.createModal.creating') : t('backup.createModal.create') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 自动备份策略弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPolicyModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showPolicyModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('backup.policyModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showPolicyModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="savePolicy">
              <label class="flex items-center gap-2 cursor-pointer">
                <input 
                  v-model="policyForm.enabled" 
                  type="checkbox" 
                  class="w-4 h-4 rounded"
                  :class="themeStore.isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'"
                />
                <span class="text-sm text-themed">{{ t('backup.policyModal.enable') }}</span>
              </label>
            
              <div v-if="policyForm.enabled" class="space-y-4 pt-2">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('backup.policyModal.interval') }}</label>
                  <select v-model="policyForm.intervalMinutes" class="input">
                    <option :value="60">{{ t('backup.policyModal.intervalOptions.hour1') }}</option>
                    <option :value="360">{{ t('backup.policyModal.intervalOptions.hour6') }}</option>
                    <option :value="1440">{{ t('backup.policyModal.intervalOptions.hour24') }}</option>
                    <option :value="4320">{{ t('backup.policyModal.intervalOptions.day3') }}</option>
                  </select>
                </div>
                <p class="text-xs text-themed-muted">
                  {{ t('backup.policyModal.quotaFromPackage', { limit: backupLimit || 0 }) }}
                </p>
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showPolicyModal = false">{{ t('backup.policyModal.cancel') }}</button>
              <button :disabled="policyLoading" class="btn-primary" @click="savePolicy">
                {{ policyLoading ? t('backup.policyModal.saving') : t('backup.policyModal.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 上传到远程存储弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showUploadModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showUploadModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('backup.uploadModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showUploadModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- 备份信息 -->
              <div class="p-3 rounded-lg bg-themed-tertiary">
                <p class="text-xs text-themed-muted">{{ t('backup.createModal.name') }}</p>
                <p class="text-sm text-themed font-medium">{{ uploadTargetBackup?.name }}</p>
              </div>
            
              <!-- 存储选择 -->
              <div v-if="storageConfigs.length > 0">
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('backup.uploadModal.selectStorage') }}</label>
                <select v-model="selectedStorageId" class="input">
                  <option v-for="config in storageConfigs" :key="config.id" :value="config.id">
                    {{ config.name }} ({{ config.type }})
                    <template v-if="config.isDefault"> - {{ t('profile.storage.default') }}</template>
                  </option>
                </select>
              </div>
            
              <!-- 无存储配置提示 -->
              <div v-else class="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
                <svg class="w-8 h-8 mx-auto mb-2 text-yellow-500 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                <p class="text-sm text-themed-muted">{{ t('backup.uploadModal.noStorage') }}</p>
                <p class="text-xs text-themed-faint mt-1">{{ t('backup.uploadModal.noStorageHint') }}</p>
                <router-link to="/profile" class="btn-primary btn-sm mt-3 inline-block">
                  {{ t('backup.uploadModal.goToSettings') }}
                </router-link>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showUploadModal = false">{{ t('backup.uploadModal.cancel') }}</button>
              <button 
                :disabled="uploadLoading || storageConfigs.length === 0" 
                class="btn-primary"
                @click="startUpload"
              >
                {{ uploadLoading ? t('backup.uploadModal.uploading') : t('backup.uploadModal.upload') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 恢复确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showRestoreConfirm" class="modal-overlay">
          <div class="modal-backdrop" @click="showRestoreConfirm = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title text-error">{{ t('backup.restoreModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showRestoreConfirm = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- 主警告 -->
              <div class="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <svg class="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p class="text-sm text-themed font-medium">{{ t('backup.restoreModal.warning') }}</p>
                  <p class="text-xs text-themed-muted mt-1">{{ t('backup.restoreModal.warningDetail') }}</p>
                </div>
              </div>
              <!-- 数据删除警告 -->
              <div class="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <p class="text-sm text-orange-500 font-medium mb-2">{{ t('backup.restoreModal.dataLossWarning') }}</p>
                <ul class="text-xs text-themed-muted list-disc list-inside space-y-1">
                  <li>{{ t('backup.restoreModal.dataLossItems.backups') }}</li>
                  <li>{{ t('backup.restoreModal.dataLossItems.snapshots') }}</li>
                </ul>
              </div>
              <!-- 名称变更提示 -->
              <div class="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p class="text-xs text-blue-400">
                  {{ t('backup.restoreModal.nameChangeNotice', { name: instanceName, backup: restoreTargetBackup?.name }) }}
                </p>
              </div>
              <!-- 备份信息 -->
              <div class="text-sm text-themed-muted">
                <p>{{ t('backup.restoreModal.backupName') }}: <span class="text-themed font-medium">{{ restoreTargetBackup?.name }}</span></p>
                <p class="mt-1">{{ t('backup.restoreModal.instanceName') }}: <span class="text-themed font-medium">{{ instanceName }}</span></p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showRestoreConfirm = false">{{ t('backup.restoreModal.cancel') }}</button>
              <button class="btn-primary bg-red-600 hover:bg-red-700" @click="confirmRestore">
                {{ t('backup.restoreModal.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

