<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import type { SshKey } from '@/types/api'
import { validateName } from '@/utils/validation'

const { t } = useI18n()
const toast = useToast()

const sshKeys = ref<SshKey[]>([])
const showAddKey = ref<boolean>(false)

// 分页相关
const currentPage = ref<number>(1)
const pageSize = 5

const totalPages = computed(() => Math.ceil(sshKeys.value.length / pageSize))

const paginatedKeys = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return sshKeys.value.slice(start, end)
})

function goToPrevPage(): void {
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

function goToNextPage(): void {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}
interface NewKey {
  name: string
  content: string
}
const newKey = ref<NewKey>({ name: '', content: '' })
const keyLoading = ref<boolean>(false)

// 生成密钥相关
const generating = ref<boolean>(false)
const showPrivateKeyModal = ref<boolean>(false)
const generatedPrivateKey = ref<string>('')
const privateKeyCopied = ref<boolean>(false)

async function loadSSHKeys(): Promise<void> {
  try {
    const response = await api.sshKeys.list()
    sshKeys.value = Array.isArray(response.keys) ? response.keys : []
  } catch (error) {
    console.error('Failed to load SSH keys:', error)
  }
}

async function addKey(): Promise<void> {
  if (!newKey.value.name || !newKey.value.content) return
  
  // 验证密钥名称（防止危险字符）
  const nameValidation = validateName(newKey.value.name, t('profile.sshKeys.name'), 1, 50)
  if (!nameValidation.valid) {
    toast.error(nameValidation.message || t('profile.sshKeys.invalidName'))
    return
  }
  
  keyLoading.value = true
  try {
    await api.sshKeys.create({
      name: newKey.value.name,
      publicKey: newKey.value.content
    })
    toast.success(t('profile.sshKeys.addSuccess'))
    newKey.value = { name: '', content: '' }
    showAddKey.value = false
    await loadSSHKeys()
  } catch (error: any) {
    toast.error(t('profile.sshKeys.addFailed') + ': ' + (error?.message || String(error)))
  } finally {
    keyLoading.value = false
  }
}

async function deleteKey(keyId: number): Promise<void> {
  if (!confirm(t('profile.sshKeys.confirmDelete'))) return
  
  try {
    await api.sshKeys.delete(keyId)
    toast.success(t('profile.sshKeys.deleteSuccess'))
    await loadSSHKeys()
    // 删除后如果当前页已无数据，返回上一页
    if (paginatedKeys.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }
  } catch (error: any) {
    toast.error(t('profile.sshKeys.deleteFailed') + ': ' + (error?.message || String(error)))
  }
}

// 生成 SSH 密钥对
async function generateKey(): Promise<void> {
  generating.value = true
  try {
    const result = await api.sshKeys.generate()
    generatedPrivateKey.value = result.privateKey
    showPrivateKeyModal.value = true
    await loadSSHKeys()
    toast.success(t('profile.sshKeys.generateSuccess'))
  } catch (error: any) {
    toast.error(t('profile.sshKeys.generateFailed') + ': ' + (error?.message || String(error)))
  } finally {
    generating.value = false
  }
}

// 复制私钥到剪贴板
async function copyPrivateKey(): Promise<void> {
  try {
    await navigator.clipboard.writeText(generatedPrivateKey.value)
    privateKeyCopied.value = true
    setTimeout(() => privateKeyCopied.value = false, 2000)
  } catch {
    toast.error(t('profile.sshKeys.copyFailed'))
  }
}

// 下载私钥文件
// 使用更可靠的下载方式，兼容各种浏览器
function downloadPrivateKey(): void {
  if (!generatedPrivateKey.value) {
    toast.error(t('profile.sshKeys.noPrivateKey'))
    return
  }
  
  const content = generatedPrivateKey.value
  const filename = 'id_rsa'
  
  // 方法1: 尝试使用 Blob URL（大多数现代浏览器支持）
  try {
    const blob = new Blob([content], { type: 'application/x-pem-file' })
    
    // 检查是否支持 navigator.msSaveBlob (IE/旧版 Edge)
    if (typeof (navigator as any).msSaveBlob !== 'undefined') {
      (navigator as any).msSaveBlob(blob, filename)
      return
    }
    
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px;'
    document.body.appendChild(a)
    
    // 使用 setTimeout 确保 DOM 更新完成后再触发点击
    setTimeout(() => {
      a.click()
      // 延长释放时间，确保下载完成
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 1500)
    }, 0)
  } catch {
    // 方法2: 降级使用 Data URL（更广泛的兼容性）
    try {
      const dataUrl = 'data:application/x-pem-file;charset=utf-8,' + encodeURIComponent(content)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = filename
      a.style.cssText = 'position:fixed;left:-9999px;top:-9999px;'
      document.body.appendChild(a)
      
      setTimeout(() => {
        a.click()
        setTimeout(() => {
          document.body.removeChild(a)
        }, 1500)
      }, 0)
    } catch {
      // 方法3: 最终降级 - 提示用户手动复制
      toast.error(t('profile.sshKeys.downloadFailed'))
    }
  }
}

// 关闭私钥弹窗
function closePrivateKeyModal(): void {
  showPrivateKeyModal.value = false
  generatedPrivateKey.value = ''
  privateKeyCopied.value = false
}

// 挂载时加载
loadSSHKeys()

defineExpose({ loadSSHKeys })
</script>

<template>
  <div class="card p-5">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div>
        <h2 class="text-sm font-medium text-themed-secondary">{{ $t('profile.sshKeys.title') }}</h2>
        <p class="text-xs text-themed-faint mt-0.5">{{ $t('profile.sshKeys.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-primary btn-sm flex-1 sm:flex-none" :disabled="generating" @click="generateKey">
          <svg v-if="generating" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {{ $t('profile.sshKeys.generate') }}
        </button>
        <button class="btn-ghost btn-sm flex-1 sm:flex-none" @click="showAddKey = true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('profile.sshKeys.add') }}
        </button>
      </div>
    </div>

    <!-- 添加表单 -->
    <div v-if="showAddKey" class="mb-4 p-4 bg-themed-tertiary border border-themed rounded-lg space-y-3">
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.sshKeys.name') }}</label>
        <input v-model="newKey.name" type="text" class="input" :placeholder="$t('profile.sshKeys.namePlaceholder')" />
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.sshKeys.publicKey') }}</label>
        <textarea 
          v-model="newKey.content" 
          class="input min-h-[80px] font-mono text-xs resize-none" 
          :placeholder="$t('profile.sshKeys.publicKeyPlaceholder')"
        ></textarea>
      </div>
      <div class="flex gap-2">
        <button :disabled="!newKey.name || !newKey.content" class="btn-primary btn-sm" @click="addKey">{{ $t('profile.sshKeys.save') }}</button>
        <button class="btn-ghost btn-sm" @click="showAddKey = false; newKey = { name: '', content: '' }">{{ $t('profile.sshKeys.cancel') }}</button>
      </div>
    </div>

    <!-- SSH 密钥列表 -->
    <div v-if="sshKeys.length" class="space-y-2">
      <div v-for="key in paginatedKeys" :key="key.id" class="group flex items-center justify-between gap-3 p-3 bg-themed-tertiary border border-themed rounded-lg hover:border-themed-secondary transition-colors">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-8 h-8 rounded bg-themed-secondary flex items-center justify-center flex-shrink-0">
            <svg class="w-4 h-4 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-themed-secondary truncate">{{ key.name }}</div>
            <div class="text-xs text-themed-faint font-mono truncate">{{ key.fingerprint }}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 flex-shrink-0">
          <span class="text-xs text-themed-faint hidden sm:inline">{{ key.created_at }}</span>
          <button 
            class="text-themed-faint hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 transition-all" 
            @click="deleteKey(key.id)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 分页控件 -->
    <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 pt-3 border-t border-themed">
      <span class="text-xs text-themed-muted">
        {{ $t('profile.sshKeys.pageInfo', { current: currentPage, total: totalPages, count: sshKeys.length }) }}
      </span>
      <div class="flex items-center gap-2">
        <button 
          class="btn-ghost btn-sm" 
          :disabled="currentPage <= 1" 
          @click="goToPrevPage"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          {{ $t('profile.sshKeys.prevPage') }}
        </button>
        <button 
          class="btn-ghost btn-sm" 
          :disabled="currentPage >= totalPages" 
          @click="goToNextPage"
        >
          {{ $t('profile.sshKeys.nextPage') }}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>

    <div v-else-if="!showAddKey && !sshKeys.length" class="text-sm text-themed-muted text-center py-6 border border-dashed border-themed rounded-lg">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
      {{ $t('profile.sshKeys.noKeys') }}
    </div>

    <!-- 私钥展示弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPrivateKeyModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closePrivateKeyModal"></div>
          <div class="modal-content max-w-2xl">
            <!-- 弹窗头部 -->
            <div class="modal-header">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center">
                  <svg class="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div>
                  <h3 class="modal-title">{{ $t('profile.sshKeys.privateKeyTitle') }}</h3>
                  <p class="text-xs text-themed-muted mt-0.5">RSA 4096-bit</p>
                </div>
              </div>
              <button class="text-themed-muted hover:text-themed" @click="closePrivateKeyModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <!-- 弹窗内容 -->
            <div class="modal-body space-y-4">
              <div class="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p class="text-sm font-medium text-yellow-600 dark:text-yellow-400">{{ $t('profile.sshKeys.privateKeyWarning') }}</p>
                  <p class="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-1">{{ $t('profile.sshKeys.privateKeyWarningDesc') }}</p>
                </div>
              </div>
              <div>
                <label class="block text-xs text-themed-muted mb-2">{{ $t('profile.sshKeys.privateKeyContent') }}</label>
                <div class="relative">
                  <pre class="p-4 rounded-lg bg-themed-tertiary border border-themed font-mono text-xs text-themed-secondary overflow-x-auto whitespace-pre-wrap break-all max-h-[280px] overflow-y-auto">{{ generatedPrivateKey }}</pre>
                </div>
              </div>
            </div>
            <!-- 弹窗底部 -->
            <div class="modal-footer flex-wrap">
              <button class="btn-ghost btn-sm flex-1 sm:flex-none" @click="copyPrivateKey">
                <svg v-if="privateKeyCopied" class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {{ privateKeyCopied ? $t('common.copied') : $t('common.copy') }}
              </button>
              <button class="btn-primary btn-sm flex-1 sm:flex-none" @click="downloadPrivateKey">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {{ $t('profile.sshKeys.download') }}
              </button>
              <button class="btn-ghost btn-sm w-full sm:w-auto" @click="closePrivateKeyModal">
                {{ $t('common.close') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
