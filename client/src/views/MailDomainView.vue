<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()

// TAB 状态
const activeTab = ref<'accounts' | 'dns' | 'settings'>('accounts')

// 加载状态
const loading = ref(true)
const actionLoading = ref('')

// 域名数据
const domain = ref<any>(null)
const dnsConfig = ref<any>(null)

const domainId = computed(() => parseInt(route.params.id as string))

// 过滤后的 DNS 记录（排除验证记录，因为它单独显示）
const filteredDnsRecords = computed(() => {
  if (!dnsConfig.value?.dnsRecords) return []
  return dnsConfig.value.dnsRecords.filter(
    (r: { record: string }) => r.record !== 'workspace-verification'
  )
})

onMounted(async () => {
  await loadDomain()
})

async function loadDomain() {
  loading.value = true
  try {
    const res = await api.mail.getDomain(domainId.value)
    domain.value = res.domain
  } catch (err: any) {
    toast.error(translateError(err))
    router.push('/mail')
  } finally {
    loading.value = false
  }
}

async function loadDnsConfig() {
  try {
    const res = await api.mail.getDomainDns(domainId.value)
    dnsConfig.value = res
  } catch (err: any) {
    toast.error(translateError(err))
  }
}

async function verifyDomain() {
  actionLoading.value = 'verify'
  try {
    const res = await api.mail.verifyDomain(domainId.value)
    if (res.verified) {
      toast.success(t('mail.domainVerified'))
      await loadDomain()
    } else {
      toast.info(t('mail.domainNotVerified'))
    }
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

// 删除域名
async function deleteDomain() {
  if (!confirm(t('mail.deleteDomainConfirm', { domain: domain.value?.domain }))) return
  
  actionLoading.value = 'delete-domain'
  try {
    await api.mail.deleteDomain(domainId.value)
    toast.success(t('mail.domainDeleted'))
    router.push('/mail')
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

// 复制状态
const copiedKey = ref<string>('')
const showPassword = ref(false)

// Webmail 登录地址
const webmailUrl = computed(() => {
  if (!domain.value?.sourceCode) return ''
  const code = domain.value.sourceCode
  // us -> us2, 其他 -> {code}1
  const subdomain = code === 'us' ? 'us2' : `${code}1`
  return `https://${subdomain}.workspace.org/`
})

function copyValue(text: string, key: string) {
  navigator.clipboard.writeText(text)
  copiedKey.value = key
  toast.success(t('common.copied'))
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 2000)
}

// DNS 记录格式化函数
function formatHostRecord(record: string): string {
  // 如果是 @，直接返回
  if (record === '@') return '@'
  // 移除末尾的点
  return record.replace(/\.$/, '')
}

function formatRecordValue(record: { type: string; value: string; prio?: number }): string {
  // MX 记录显示优先级
  if (record.type === 'MX' && record.prio !== undefined) {
    return `${record.prio} ${record.value}`
  }
  return record.value
}

function getDnsRecordDescription(record: { type: string; value: string; record?: string }): string {
  switch (record.type) {
    case 'MX': return t('mail.dnsHint.mx')
    case 'CNAME': return t('mail.dnsHint.cname')
    case 'TXT':
      if (record.value?.toLowerCase().includes('spf')) return t('mail.dnsHint.spf')
      if (record.value?.toLowerCase().includes('dkim')) return t('mail.dnsHint.dkim')
      if (record.record === '_dmarc') return t('mail.dnsHint.dmarc')
      return t('mail.dnsHint.txt')
    default: return ''
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'verified': return 'badge-success'
    case 'pending': return 'badge-warning'
    case 'suspended': return 'badge-error'
    default: return 'badge-ghost'
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString()
}

// 切换到 DNS 配置 TAB 时加载配置
function switchTab(tab: 'accounts' | 'dns' | 'settings') {
  activeTab.value = tab
  if (tab === 'dns' && !dnsConfig.value) {
    loadDnsConfig()
  }
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- 返回按钮和标题 -->
    <div class="mb-6">
      <button class="btn btn-ghost btn-sm gap-1 mb-2 -ml-2" @click="router.push('/mail')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
        {{ t('common.back') }}
      </button>
      
      <div v-if="loading" class="h-8 bg-themed-secondary rounded animate-pulse w-48"></div>
      <div v-else-if="domain" class="flex items-center gap-3">
        <h1 class="text-xl font-bold text-themed">{{ domain.domain }}</h1>
        <span :class="['badge', getStatusBadge(domain.status)]">
          {{ t('mail.domainStatus.' + domain.status) }}
        </span>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="domain">
      <!-- TAB 切换 -->
      <div class="flex border-b border-themed mb-6">
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="activeTab === 'accounts' 
            ? 'border-blue-500 text-blue-500' 
            : 'border-transparent text-themed-muted hover:text-themed'"
          @click="switchTab('accounts')"
        >
          {{ t('mail.tabs.accounts') }}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="activeTab === 'dns' 
            ? 'border-blue-500 text-blue-500' 
            : 'border-transparent text-themed-muted hover:text-themed'"
          @click="switchTab('dns')"
        >
          {{ t('mail.tabs.dns') }}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="activeTab === 'settings' 
            ? 'border-blue-500 text-blue-500' 
            : 'border-transparent text-themed-muted hover:text-themed'"
          @click="switchTab('settings')"
        >
          {{ t('mail.tabs.settings') }}
        </button>
      </div>

      <!-- 邮箱账户 TAB -->
      <div v-show="activeTab === 'accounts'" class="space-y-6">
        <!-- DNS 未完成提示 -->
        <div v-if="domain.status !== 'verified'" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <span class="text-sm text-amber-700 dark:text-amber-400 flex-1">{{ t('mail.completeDnsFirst') }}</span>
            <button class="text-sm text-amber-700 dark:text-amber-400 hover:underline" @click="activeTab = 'dns'">{{ t('mail.goDnsConfig') }}</button>
          </div>
        </div>

        <!-- 管理员账号卡片 -->
        <div v-if="domain.adminUsername" class="border border-themed rounded-lg">
          <div class="p-4 border-b border-themed">
            <h4 class="text-sm font-medium text-themed">{{ t('mail.adminAccount') }}</h4>
            <p class="text-xs text-themed-muted mt-1">{{ t('mail.adminAccountDesc') }}</p>
          </div>
          <div class="p-4 space-y-4">
            <!-- 邮箱地址 -->
            <div>
              <div class="text-xs text-themed-muted mb-1.5">{{ t('mail.emailAddress') }}</div>
              <div class="flex items-center gap-2">
                <code class="text-sm text-themed">{{ domain.adminUsername }}</code>
                <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :title="t('common.copy')" @click="copyValue(domain.adminUsername, 'admin-email')">
                  <svg v-if="copiedKey !== 'admin-email'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                </button>
              </div>
            </div>
            <!-- 密码 -->
            <div>
              <div class="text-xs text-themed-muted mb-1.5">{{ t('mail.password') }}</div>
              <div class="flex items-center gap-2">
                <code class="text-sm text-themed">{{ showPassword ? domain.adminPassword : '••••••••' }}</code>
                <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :title="showPassword ? t('common.hide') : t('common.show')" @click="showPassword = !showPassword">
                  <svg v-if="!showPassword" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                </button>
                <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :title="t('common.copy')" @click="copyValue(domain.adminPassword, 'admin-password')">
                  <svg v-if="copiedKey !== 'admin-password'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                </button>
              </div>
            </div>
            <!-- 登录地址 -->
            <div>
              <div class="text-xs text-themed-muted mb-1.5">{{ t('mail.webmailUrl') }}</div>
              <div class="flex items-center gap-2">
                <a :href="webmailUrl" target="_blank" class="text-sm text-blue-500 hover:underline">{{ webmailUrl }}</a>
                <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :title="t('common.copy')" @click="copyValue(webmailUrl, 'webmail-url')">
                  <svg v-if="copiedKey !== 'webmail-url'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                </button>
              </div>
            </div>
            <!-- 帮助文档 -->
            <div>
              <router-link to="/help/mail" class="text-sm text-blue-500 hover:underline inline-flex items-center gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {{ t('mail.helpDoc') }}
              </router-link>
            </div>
          </div>
        </div>

        <!-- 无管理员账号提示 -->
        <div v-else class="border border-themed border-dashed rounded-lg p-8 text-center">
          <svg class="w-10 h-10 mx-auto mb-3 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
          </svg>
          <p class="text-sm text-themed-muted">{{ t('mail.noAdminAccount') }}</p>
        </div>
      </div>

      <!-- DNS 配置 TAB -->
      <div v-show="activeTab === 'dns'" class="space-y-6">
        <div class="flex justify-between items-center">
          <p class="text-sm text-themed-muted">{{ t('mail.dnsDescription') }}</p>
          <button class="btn btn-sm btn-outline" :disabled="actionLoading === 'verify'" @click="verifyDomain">
            <span v-if="actionLoading === 'verify'" class="loading loading-spinner loading-xs mr-1"></span>
            {{ t('mail.refreshStatus') }}
          </button>
        </div>

        <div v-if="!dnsConfig" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <!-- DNS 记录列表 -->
        <div v-else class="space-y-3">
          <!-- TXT 验证记录 -->
          <div v-if="dnsConfig.txtRecord" class="border border-themed rounded-lg p-4">
            <div class="mb-3">
              <span class="text-xs font-medium text-themed-muted uppercase tracking-wide">TXT</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 text-sm">
              <div>
                <div class="text-themed-muted text-xs mb-1">{{ t('mail.hostRecord') }}</div>
                <div class="flex items-center gap-1.5">
                  <code class="text-themed">workspace-verification</code>
                  <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :title="t('common.copy')" @click="copyValue('workspace-verification', 'txt-host')">
                    <svg v-if="copiedKey !== 'txt-host'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              </div>
              <div>
                <div class="text-themed-muted text-xs mb-1">{{ t('mail.recordValue') }}</div>
                <div class="flex items-start gap-1.5">
                  <code class="text-themed break-all">{{ dnsConfig.txtRecord }}</code>
                  <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 mt-0.5" :title="t('common.copy')" @click="copyValue(dnsConfig.txtRecord, 'txt-value')">
                    <svg v-if="copiedKey !== 'txt-value'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              </div>
            </div>
            <p class="text-xs text-themed-muted mt-3">{{ t('mail.dnsHint.txt') }}</p>
          </div>

          <!-- 其他 DNS 记录（来自 API 返回的原始数据，跳过验证记录） -->
          <div v-for="(record, idx) in filteredDnsRecords" :key="idx" class="border border-themed rounded-lg p-4">
            <div class="mb-3">
              <span class="text-xs font-medium text-themed-muted uppercase tracking-wide">{{ record.type }}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 text-sm">
              <div>
                <div class="text-themed-muted text-xs mb-1">{{ t('mail.hostRecord') }}</div>
                <div class="flex items-center gap-1.5">
                  <code class="text-themed truncate">{{ formatHostRecord(record.record) }}</code>
                  <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0" :title="t('common.copy')" @click="copyValue(formatHostRecord(record.record), `dns-${idx}-host`)">
                    <svg v-if="copiedKey !== `dns-${idx}-host`" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              </div>
              <div>
                <div class="text-themed-muted text-xs mb-1">{{ t('mail.recordValue') }}</div>
                <div class="flex items-start gap-1.5">
                  <code class="text-themed break-all">{{ formatRecordValue(record) }}</code>
                  <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 mt-0.5" :title="t('common.copy')" @click="copyValue(formatRecordValue(record), `dns-${idx}-value`)">
                    <svg v-if="copiedKey !== `dns-${idx}-value`" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              </div>
            </div>
            <p class="text-xs text-themed-muted mt-3">{{ getDnsRecordDescription(record) }}</p>
          </div>
        </div>
      </div>

      <!-- 设置 TAB -->
      <div v-show="activeTab === 'settings'" class="space-y-4">
        <div class="card p-4">
          <h4 class="font-medium text-themed mb-3">{{ t('mail.domainInfo') }}</h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ t('mail.domainName') }}</span>
              <span class="text-themed">{{ domain.domain }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ t('common.status') }}</span>
              <span :class="['badge badge-sm', getStatusBadge(domain.status)]">
                {{ t('mail.domainStatus.' + domain.status) }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ t('mail.createdAt') }}</span>
              <span class="text-themed">{{ formatDate(domain.createdAt) }}</span>
            </div>
            <div v-if="domain.verifiedAt" class="flex justify-between">
              <span class="text-themed-muted">{{ t('mail.verifiedAt') }}</span>
              <span class="text-themed">{{ formatDate(domain.verifiedAt) }}</span>
            </div>
          </div>
        </div>

        <div class="card border border-red-200 dark:border-red-900/50 overflow-hidden">
          <div class="px-4 py-3 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/50">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h4 class="text-sm font-medium text-red-600 dark:text-red-400">{{ t('mail.dangerZone') }}</h4>
            </div>
          </div>
          <div class="p-4 flex items-center justify-between">
            <p class="text-sm text-themed-muted">{{ t('mail.deleteDomainWarning') }}</p>
            <button 
              class="btn btn-error btn-sm flex-shrink-0 ml-4" 
              :disabled="actionLoading === 'delete-domain'"
              @click="deleteDomain"
            >
              <span v-if="actionLoading === 'delete-domain'" class="loading loading-spinner loading-xs mr-1"></span>
              {{ t('mail.deleteDomain') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
