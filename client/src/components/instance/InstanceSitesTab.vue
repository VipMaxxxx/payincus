<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

interface ProxySite {
  id: number
  domain: string
  targetPort: number
  httpsEnabled: boolean
  remark: string | null
  status: 'pending' | 'active' | 'error'
  enabled: boolean
  error: string | null
  createdAt: string
}

interface Props {
  instanceId: number
}

const props = defineProps<Props>()

const loading = ref(true)
const adding = ref(false)
const editing = ref(false)
const deleting = ref<number | null>(null)
const refreshing = ref<number | null>(null)
const toggling = ref<number | null>(null)
const checkingCert = ref<number | null>(null)
const checkingDns = ref<number | null>(null)

const sites = ref<ProxySite[]>([])
const caddyEnabled = ref(false)
const dnsRecordType = ref<string | null>(null)
const dnsRecordValue = ref<string | null>(null)
const siteQuota = ref<{ used: number; limit: number } | null>(null)
const canManageSites = ref(true)

// 添加表单
const showAddModal = ref(false)
const form = ref({
  domain: '',
  targetPort: 80,
  httpsEnabled: true,
  remark: ''
})

// 编辑表单
const showEditModal = ref(false)
const editForm = ref({
  id: 0,
  domain: '',
  targetPort: 80,
  httpsEnabled: true,
  remark: ''
})

// DNS 提示弹窗
const showDnsHint = ref(false)
const dnsHint = ref({
  type: 'A',
  host: '',
  value: ''
})

// 证书状态弹窗
const showCertModal = ref(false)
const certStatus = ref<{
  domain: string
  httpsEnabled: boolean
  status: string
  message?: string
  error?: string
  hint?: string
  certificate?: {
    valid: boolean
    issuer: string
    subject: string
    validFrom: string
    validTo: string
    daysRemaining: number
  }
} | null>(null)

onMounted(() => {
  loadSites()
})

async function loadSites() {
  loading.value = true
  try {
    const res = await api.instances.getSites(props.instanceId)
    sites.value = res.sites || []
    caddyEnabled.value = res.caddyEnabled || false
    dnsRecordType.value = res.dnsRecordType
    dnsRecordValue.value = res.dnsRecordValue
    siteQuota.value = res.siteQuota || null
    canManageSites.value = res.canManageSites ?? true
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('instance.sites.loadFailed') + ': ' + (error?.message || String(err)))
  } finally {
    loading.value = false
  }
}

function openAddModal() {
  form.value = { domain: '', targetPort: 80, httpsEnabled: true, remark: '' }
  showAddModal.value = true
}

async function addSite() {
  if (!form.value.domain) {
    toast.error(t('instance.sites.domainRequired'))
    return
  }

  // 验证域名格式（不允许泛域名）
  if (form.value.domain.startsWith('*')) {
    toast.error(t('instance.sites.wildcardNotAllowed'))
    return
  }

  adding.value = true
  try {
    const res = await api.instances.addSite(props.instanceId, {
      domain: form.value.domain.toLowerCase().trim(),
      targetPort: form.value.targetPort,
      httpsEnabled: form.value.httpsEnabled,
      remark: form.value.remark.trim() || undefined
    })
    
    showAddModal.value = false
    await loadSites()
    
    // 显示 DNS 解析提示
    if (res.dnsHint) {
      dnsHint.value = res.dnsHint
      showDnsHint.value = true
    }
    
    toast.success(t('instance.sites.addSuccess'))
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.addFailed'))
  } finally {
    adding.value = false
  }
}

async function deleteSite(siteId: number, domain: string) {
  if (!confirm(t('instance.sites.deleteConfirm', { domain }))) {
    return
  }

  deleting.value = siteId
  try {
    await api.instances.deleteSite(props.instanceId, siteId)
    toast.success(t('instance.sites.deleteSuccess'))
    await loadSites()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.deleteFailed'))
  } finally {
    deleting.value = null
  }
}

async function refreshSite(siteId: number) {
  refreshing.value = siteId
  try {
    await api.instances.refreshSite(props.instanceId, siteId)
    toast.success(t('instance.sites.refreshSuccess'))
    await loadSites()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.refreshFailed'))
  } finally {
    refreshing.value = null
  }
}

async function toggleSite(siteId: number) {
  toggling.value = siteId
  try {
    const res = await api.instances.toggleSite(props.instanceId, siteId)
    toast.success(res.message)
    await loadSites()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.toggleFailed'))
  } finally {
    toggling.value = null
  }
}

function openEditModal(site: ProxySite) {
  editForm.value = {
    id: site.id,
    domain: site.domain,
    targetPort: site.targetPort,
    httpsEnabled: site.httpsEnabled,
    remark: site.remark || ''
  }
  showEditModal.value = true
}

async function updateSite() {
  editing.value = true
  try {
    const res = await api.instances.updateSite(props.instanceId, editForm.value.id, {
      targetPort: editForm.value.targetPort,
      httpsEnabled: editForm.value.httpsEnabled,
      remark: editForm.value.remark.trim() || undefined
    })
    showEditModal.value = false
    toast.success(res.message)
    await loadSites()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.updateFailed'))
  } finally {
    editing.value = false
  }
}

async function checkCertificate(site: ProxySite) {
  checkingCert.value = site.id
  try {
    const res = await api.instances.getCertificateStatus(props.instanceId, site.id)
    certStatus.value = {
      domain: site.domain,
      ...res
    }
    showCertModal.value = true
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.certCheckFailed'))
  } finally {
    checkingCert.value = null
  }
}

async function checkDns(siteId: number) {
  checkingDns.value = siteId
  try {
    const res = await api.instances.checkDns(props.instanceId, siteId)
    if (res.activated) {
      toast.success(t('instance.sites.dnsActivated'))
    } else if (res.dnsResolved && res.ipMatches) {
      toast.success(res.message || t('instance.sites.dnsResolved'))
    } else {
      toast.error(res.error || t('instance.sites.dnsCheckFailed'))
    }
    await loadSites()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('instance.sites.dnsCheckFailed'))
  } finally {
    checkingDns.value = null
  }
}

function getCertStatusColor(status: string) {
  switch (status) {
    case 'valid':
      return 'text-green-600 dark:text-green-400'
    case 'disabled':
      return 'text-gray-500 dark:text-gray-400'
    case 'pending':
    case 'cert_pending':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'dns_error':
    case 'connection_refused':
    case 'timeout':
    case 'error':
      return 'text-red-600 dark:text-red-400'
    default:
      return 'text-yellow-600 dark:text-yellow-400'
  }
}

function getCertStatusText(status: string) {
  switch (status) {
    case 'valid':
      return t('instance.sites.cert.valid')
    case 'disabled':
      return t('instance.sites.cert.disabled')
    case 'pending':
      return t('instance.sites.cert.pending')
    case 'cert_pending':
      return t('instance.sites.cert.certPending')
    case 'dns_error':
      return t('instance.sites.cert.dnsError')
    case 'connection_refused':
      return t('instance.sites.cert.connectionRefused')
    case 'timeout':
      return t('instance.sites.cert.timeout')
    case 'error':
      return t('instance.sites.cert.error')
    default:
      return status
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString()
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    case 'error':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'active':
      return t('instance.sites.statusActive')
    case 'pending':
      return t('instance.sites.statusPending')
    case 'error':
      return t('instance.sites.statusError')
    default:
      return status
  }
}

const hasSites = computed(() => sites.value.length > 0)

// 配额是否已满（limit = 0 表示没有配额，不允许创建）
const isQuotaFull = computed(() => {
  if (!siteQuota.value) return false
  // limit = 0 表示没有配额，视为已满
  if (siteQuota.value.limit === 0) return true
  return siteQuota.value.used >= siteQuota.value.limit
})

// 配额显示文本
const quotaLimitDisplay = computed(() => {
  if (!siteQuota.value) return ''
  // 0 就是 0，不是无限制
  return String(siteQuota.value.limit)
})
</script>

<template>
  <div class="space-y-6">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Caddy 未启用提示 -->
    <div 
      v-else-if="!caddyEnabled" 
      class="card p-6 text-center"
    >
      <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <p class="text-lg font-medium mb-2" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
        {{ t('instance.sites.caddyNotEnabled') }}
      </p>
      <p class="text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
        {{ t('instance.sites.caddyNotEnabledHint') }}
      </p>
    </div>

    <!-- 站点管理 -->
    <div v-else class="space-y-4">
      <!-- 头部 -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
            {{ t('instance.sites.title') }}
          </h3>
          <p v-if="siteQuota" class="text-sm mt-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
            {{ t('instance.sites.quotaInfo', { used: siteQuota.used, limit: quotaLimitDisplay }) }}
            <span v-if="isQuotaFull" class="text-red-500 ml-1">
              ({{ t('instance.sites.quotaFull') }})
            </span>
          </p>
        </div>
        <button 
          v-if="canManageSites"
          class="btn-primary w-full sm:w-auto" 
          :disabled="isQuotaFull"
          @click="openAddModal"
        >
          <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('instance.sites.addSite') }}
        </button>
      </div>

      <!-- 站点列表 -->
      <div v-if="hasSites" class="space-y-3">
        <div 
          v-for="site in sites" 
          :key="site.id"
          class="card p-4"
        >
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3 flex-wrap">
                <a 
                  :href="`${site.httpsEnabled ? 'https' : 'http'}://${site.domain}`" 
                  target="_blank"
                  class="font-mono text-sm font-medium hover:text-blue-500 transition-colors break-all"
                  :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
                >
                  {{ site.domain }}
                </a>
                <!-- HTTPS 标记 + 证书检查 -->
                <button 
                  v-if="site.httpsEnabled" 
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                  :title="t('instance.sites.checkCert')"
                  :disabled="checkingCert === site.id"
                  @click="checkCertificate(site)"
                >
                  <svg v-if="checkingCert !== site.id" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <svg v-else class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  HTTPS
                </button>
                <span 
                  v-else 
                  class="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap"
                  :title="t('instance.sites.httpOnly')"
                >
                  HTTP
                </span>
                <span :class="['px-2 py-0.5 text-xs rounded-full whitespace-nowrap', getStatusColor(site.status)]">
                  {{ getStatusText(site.status) }}
                </span>
                <span 
                  v-if="!site.enabled" 
                  class="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap"
                >
                  {{ t('instance.sites.disabled') }}
                </span>
              </div>
              <div class="flex items-center gap-4 mt-1 text-sm flex-wrap" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
                <span class="font-mono">→ :{{ site.targetPort }}</span>
                <span v-if="site.remark" class="truncate max-w-xs" :title="site.remark">
                  {{ site.remark }}
                </span>
                <span v-if="site.error" class="text-red-500 break-all">{{ site.error }}</span>
              </div>
            </div>

            <div v-if="canManageSites" class="flex items-center gap-2 self-end sm:self-auto">
              <!-- 启用/禁用切换 -->
              <button
                :disabled="toggling === site.id"
                class="p-2 rounded transition-colors"
                :class="site.enabled 
                  ? 'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20' 
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
                :title="site.enabled ? t('instance.sites.disableSite') : t('instance.sites.enableSite')"
                @click="toggleSite(site.id)"
              >
                <svg 
                  v-if="toggling !== site.id" 
                  class="w-4 h-4" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path v-if="site.enabled" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </button>

              <!-- 编辑按钮 -->
              <button
                v-if="site.enabled"
                class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
                :title="t('common.edit')"
                @click="openEditModal(site)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>

              <!-- 刷新按钮（仅错误状态显示） -->
              <button
                v-if="site.status === 'error'"
                :disabled="refreshing === site.id"
                class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                :title="t('instance.sites.refresh')"
                @click="refreshSite(site.id)"
              >
                <svg 
                  class="w-4 h-4" 
                  :class="[refreshing === site.id ? 'animate-spin' : '', themeStore.isDark ? 'text-gray-400' : 'text-gray-600']"
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              <!-- 检测 DNS 按钮（仅 pending 状态显示） -->
              <button
                v-if="site.status === 'pending'"
                :disabled="checkingDns === site.id"
                class="p-2 rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                :title="t('instance.sites.checkDns')"
                @click="checkDns(site.id)"
              >
                <svg 
                  v-if="checkingDns !== site.id"
                  class="w-4 h-4" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </button>

              <!-- 删除按钮 -->
              <button
                :disabled="deleting === site.id"
                class="p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                :title="t('common.delete')"
                @click="deleteSite(site.id, site.domain)"
              >
                <svg 
                  v-if="deleting !== site.id" 
                  class="w-4 h-4" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div 
        v-else
        class="border-2 border-dashed rounded-lg p-8 text-center"
        :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-300'"
      >
        <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <p class="text-sm mb-4" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
          {{ t('instance.sites.empty') }}
        </p>
        <button 
          v-if="canManageSites"
          class="btn-primary" 
          :disabled="isQuotaFull"
          @click="openAddModal"
        >
          {{ t('instance.sites.addFirstSite') }}
        </button>
      </div>

      <!-- 添加站点模态框 -->
      <Teleport to="body">
        <div 
          v-if="showAddModal" 
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="showAddModal = false"
        >
          <div 
            class="w-full max-w-md rounded-lg shadow-xl"
            :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
          >
            <div class="p-6">
              <h3 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ t('instance.sites.addSite') }}
              </h3>

              <div class="space-y-4">
                <!-- 域名 -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.domain') }}
                  </label>
                  <input
                    v-model="form.domain"
                    type="text"
                    placeholder="example.com"
                    class="input w-full"
                  />
                  <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.sites.domainHint') }}
                  </p>
                </div>

                <!-- 端口 -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.targetPort') }}
                  </label>
                  <input
                    v-model.number="form.targetPort"
                    type="number"
                    min="1"
                    max="65535"
                    class="input w-full"
                  />
                  <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.sites.portHint') }}
                  </p>
                </div>

                <!-- HTTPS 开关 -->
                <div>
                  <label class="flex items-center justify-between cursor-pointer">
                    <div>
                      <span class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                        {{ t('instance.sites.enableHttps') }}
                      </span>
                      <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                        {{ t('instance.sites.httpsHint') }}
                      </p>
                    </div>
                    <div class="relative">
                      <input 
                        v-model="form.httpsEnabled" 
                        type="checkbox" 
                        class="sr-only peer"
                      />
                      <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </div>
                  </label>
                </div>

                <!-- 备注 -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.remark') }}
                  </label>
                  <input
                    v-model="form.remark"
                    type="text"
                    maxlength="100"
                    :placeholder="t('instance.sites.remarkPlaceholder')"
                    class="input w-full"
                  />
                </div>
              </div>

              <div class="flex justify-end gap-3 mt-6">
                <button class="btn-ghost" @click="showAddModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button :disabled="adding" class="btn-primary" @click="addSite">
                  <span v-if="adding" class="flex items-center gap-2">
                    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {{ t('common.loading') }}
                  </span>
                  <span v-else>{{ t('common.confirm') }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 编辑站点模态框 -->
      <Teleport to="body">
        <div 
          v-if="showEditModal" 
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="showEditModal = false"
        >
          <div 
            class="w-full max-w-md rounded-lg shadow-xl"
            :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
          >
            <div class="p-6">
              <h3 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ t('instance.sites.editSite') }}
              </h3>

              <div class="space-y-4">
                <!-- 域名（只读） -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.domain') }}
                  </label>
                  <input
                    :value="editForm.domain"
                    type="text"
                    disabled
                    class="input w-full bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
                  />
                </div>

                <!-- 端口 -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.targetPort') }}
                  </label>
                  <input
                    v-model.number="editForm.targetPort"
                    type="number"
                    min="1"
                    max="65535"
                    class="input w-full"
                  />
                  <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.sites.portHint') }}
                  </p>
                </div>

                <!-- HTTPS 开关 -->
                <div>
                  <label class="flex items-center justify-between cursor-pointer">
                    <div>
                      <span class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                        {{ t('instance.sites.enableHttps') }}
                      </span>
                      <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                        {{ t('instance.sites.httpsHint') }}
                      </p>
                    </div>
                    <div class="relative">
                      <input 
                        v-model="editForm.httpsEnabled" 
                        type="checkbox" 
                        class="sr-only peer"
                      />
                      <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </div>
                  </label>
                </div>

                <!-- 备注 -->
                <div>
                  <label class="block text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('instance.sites.remark') }}
                  </label>
                  <input
                    v-model="editForm.remark"
                    type="text"
                    maxlength="100"
                    :placeholder="t('instance.sites.remarkPlaceholder')"
                    class="input w-full"
                  />
                </div>
              </div>

              <div class="flex justify-end gap-3 mt-6">
                <button class="btn-ghost" @click="showEditModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button :disabled="editing" class="btn-primary" @click="updateSite">
                  <span v-if="editing" class="flex items-center gap-2">
                    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {{ t('common.saving') }}
                  </span>
                  <span v-else>{{ t('common.save') }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- DNS 解析提示模态框 -->
      <Teleport to="body">
        <div 
          v-if="showDnsHint" 
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="showDnsHint = false"
        >
          <div 
            class="w-full max-w-md rounded-lg shadow-xl"
            :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
          >
            <div class="p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg class="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                  {{ t('instance.sites.addedSuccess') }}
                </h3>
              </div>

              <p class="text-sm mb-4" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                {{ t('instance.sites.dnsHintDesc') }}
              </p>

              <!-- DNS 记录 -->
              <div 
                class="p-4 rounded-lg font-mono text-sm space-y-2"
                :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
              >
                <div class="flex">
                  <span class="w-16 text-gray-500">{{ t('instance.sites.dnsType') }}:</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ dnsHint.type }}</span>
                </div>
                <div class="flex">
                  <span class="w-16 text-gray-500">{{ t('instance.sites.dnsHost') }}:</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ dnsHint.host }}</span>
                </div>
                <div class="flex">
                  <span class="w-16 text-gray-500">{{ t('instance.sites.dnsValue') }}:</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ dnsHint.value }}</span>
                </div>
              </div>

              <p class="text-xs mt-3" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                {{ t('instance.sites.dnsHintWithCheck') }}
              </p>

              <p v-if="form.httpsEnabled" class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                {{ t('instance.sites.sslAutoHint') }}
              </p>

              <div class="flex justify-end mt-6">
                <button class="btn-primary" @click="showDnsHint = false">
                  {{ t('common.gotIt') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 证书状态弹窗 -->
      <Teleport to="body">
        <div 
          v-if="showCertModal && certStatus" 
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="showCertModal = false"
        >
          <div 
            class="w-full max-w-md rounded-lg shadow-xl"
            :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
          >
            <div class="p-6">
              <div class="flex items-center gap-3 mb-4">
                <div 
                  class="w-10 h-10 rounded-full flex items-center justify-center"
                  :class="certStatus.status === 'valid' ? 'bg-green-100 dark:bg-green-900/30' : certStatus.status === 'disabled' ? 'bg-gray-100 dark:bg-gray-800' : 'bg-red-100 dark:bg-red-900/30'"
                >
                  <svg 
                    class="w-5 h-5" 
                    :class="getCertStatusColor(certStatus.status)"
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path v-if="certStatus.status === 'valid'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    <path v-else-if="certStatus.status === 'disabled'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ t('instance.sites.cert.title') }}
                  </h3>
                  <p class="text-sm font-mono" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
                    {{ certStatus.domain }}
                  </p>
                </div>
              </div>

              <!-- 状态 -->
              <div class="mb-4">
                <span 
                  class="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium"
                  :class="certStatus.status === 'valid' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : certStatus.status === 'disabled' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'"
                >
                  {{ getCertStatusText(certStatus.status) }}
                </span>
              </div>

              <!-- 证书详情 -->
              <div 
                v-if="certStatus.certificate"
                class="p-4 rounded-lg space-y-2 text-sm"
                :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
              >
                <div class="flex justify-between">
                  <span class="text-gray-500">{{ t('instance.sites.cert.issuer') }}</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ certStatus.certificate.issuer }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">{{ t('instance.sites.cert.validFrom') }}</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ formatDate(certStatus.certificate.validFrom) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">{{ t('instance.sites.cert.validTo') }}</span>
                  <span :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ formatDate(certStatus.certificate.validTo) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">{{ t('instance.sites.cert.daysRemaining') }}</span>
                  <span 
                    :class="certStatus.certificate.daysRemaining > 30 ? 'text-green-600 dark:text-green-400' : certStatus.certificate.daysRemaining > 7 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'"
                  >
                    {{ certStatus.certificate.daysRemaining }} {{ t('instance.sites.cert.days') }}
                  </span>
                </div>
              </div>

              <!-- 错误信息 -->
              <div 
                v-if="certStatus.error || certStatus.hint"
                class="p-4 rounded-lg space-y-2 text-sm"
                :class="themeStore.isDark ? 'bg-red-900/20' : 'bg-red-50'"
              >
                <p v-if="certStatus.hint" class="text-red-600 dark:text-red-400">
                  {{ certStatus.hint }}
                </p>
                <p v-if="certStatus.error" class="text-red-500 text-xs font-mono break-all">
                  {{ certStatus.error }}
                </p>
              </div>

              <!-- 未启用提示 -->
              <p 
                v-if="certStatus.status === 'disabled'"
                class="text-sm"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
              >
                {{ certStatus.message }}
              </p>

              <div class="flex justify-end mt-6">
                <button class="btn-primary" @click="showCertModal = false">
                  {{ t('common.close') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>
