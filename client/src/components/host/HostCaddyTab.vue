<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

interface Props {
  hostId: number
}

const props = defineProps<Props>()

const loading = ref(true)
const generating = ref(false)
const resetting = ref(false)
const confirming = ref(false)
const testing = ref(false)
const copied = ref(false)

// Caddy 状态
const caddyStatus = ref<{
  enabled: boolean
  username: string | null
  port: number
  hasPassword: boolean
  natPublicIp: string | null
  sitesCount: number
}>({
  enabled: false,
  username: null,
  port: 8444,
  hasPassword: false,
  natPublicIp: null,
  sitesCount: 0
})

// 生成的安装信息
const installInfo = ref({
  command: '',
  username: '',
  password: '',
  port: 8444
})

// 测试结果
const testResult = ref<{
  connected: boolean
  sitesCount: number
  dnsRecordType: 'A' | 'AAAA' | 'CNAME'
  dnsRecordValue: string
}>({
  connected: false,
  sitesCount: 0,
  dnsRecordType: 'A',
  dnsRecordValue: ''
})

const showInstallModal = ref(false)

// 站点列表相关
interface ProxySite {
  id: number
  domain: string
  targetPort: number
  httpsEnabled: boolean
  status: 'pending' | 'active' | 'error'
  enabled: boolean
  error: string | null
  createdAt: string
  instance: {
    id: number
    name: string
    ipv4: string | null
    status: string
  } | null
}

const sites = ref<ProxySite[]>([])
const sitesLoading = ref(false)
const sitesPage = ref(1)
const sitesPageSize = 5
const sitesTotal = ref(0)
const sitesTotalPages = ref(1)

onMounted(() => {
  loadCaddyStatus()
})

// 当 Caddy 启用状态变化时，加载站点列表
watch(() => caddyStatus.value.enabled, (enabled) => {
  if (enabled) {
    loadSites()
  }
})

// 当 hostId 变化时，重置状态并重新加载数据
watch(() => props.hostId, () => {
  // 重置分页状态
  sitesPage.value = 1
  sites.value = []
  sitesTotal.value = 0
  sitesTotalPages.value = 1
  // 重置其他状态
  showInstallModal.value = false
  testResult.value = { connected: false, sitesCount: 0, dnsRecordType: 'A', dnsRecordValue: '' }
  // 重新加载数据
  loadCaddyStatus()
})

async function loadCaddyStatus() {
  loading.value = true
  try {
    const res = await api.hosts.getCaddy(props.hostId)
    caddyStatus.value = res
    // 如果 Caddy 已启用，加载站点列表
    if (res.enabled) {
      await loadSites()
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.caddy.loadFailed') + ': ' + (error?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function loadSites() {
  sitesLoading.value = true
  try {
    const res = await api.hosts.getCaddySites(props.hostId, {
      page: sitesPage.value,
      pageSize: sitesPageSize
    })
    sites.value = res.sites
    sitesTotal.value = res.total
    sitesTotalPages.value = res.totalPages
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.caddy.loadSitesFailed') + ': ' + (error?.message || String(err)))
  } finally {
    sitesLoading.value = false
  }
}

function goToPrevSitesPage(): void {
  if (sitesPage.value > 1) {
    sitesPage.value--
    loadSites()
  }
}

function goToNextSitesPage(): void {
  if (sitesPage.value < sitesTotalPages.value) {
    sitesPage.value++
    loadSites()
  }
}

function getSiteStatusBadge(site: ProxySite) {
  if (!site.enabled) {
    return { label: t('host.caddy.siteDisabled'), class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
  switch (site.status) {
    case 'active':
      return { label: t('host.caddy.siteActive'), class: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
    case 'pending':
      return { label: t('host.caddy.sitePending'), class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' }
    case 'error':
      return { label: t('host.caddy.siteError'), class: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' }
    default:
      return { label: site.status, class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
}

async function generateInstallCommand() {
  generating.value = true
  try {
    const res = await api.hosts.generateCaddyCommand(props.hostId)
    installInfo.value = {
      command: res.installCommand,
      username: res.username,
      password: res.password,
      port: res.port
    }
    showInstallModal.value = true
    // 刷新状态
    await loadCaddyStatus()
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.caddy.generateFailed') + ': ' + (error?.message || String(err)))
  } finally {
    generating.value = false
  }
}

async function resetCredentials() {
  if (!confirm(t('host.caddy.resetConfirm'))) {
    return
  }
  
  resetting.value = true
  try {
    const res = await api.hosts.resetCaddyCredentials(props.hostId)
    installInfo.value = {
      command: res.installCommand,
      username: res.username,
      password: res.password,
      port: res.port
    }
    showInstallModal.value = true
    toast.success(t('host.caddy.resetSuccess'))
    // 刷新状态
    await loadCaddyStatus()
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.caddy.resetFailed') + ': ' + (error?.message || String(err)))
  } finally {
    resetting.value = false
  }
}

async function confirmInstallation() {
  confirming.value = true
  try {
    await api.hosts.confirmCaddyInstalled(props.hostId)
    toast.success(t('host.caddy.confirmSuccess'))
    showInstallModal.value = false
    await loadCaddyStatus()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('host.caddy.confirmFailed'))
  } finally {
    confirming.value = false
  }
}

async function testConnection() {
  testing.value = true
  try {
    const res = await api.hosts.testCaddyConnection(props.hostId)
    testResult.value = res
    if (res.connected) {
      toast.success(t('host.caddy.testSuccess'))
    } else {
      toast.error(t('host.caddy.testFailed'))
    }
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } }, message?: string }
    toast.error(error?.response?.data?.error || error?.message || t('host.caddy.testFailed'))
  } finally {
    testing.value = false
  }
}

function copyCommand() {
  navigator.clipboard.writeText(installInfo.value.command)
  copied.value = true
  toast.success(t('common.copied'))
  setTimeout(() => { copied.value = false }, 2000)
}

const isEnabled = computed(() => caddyStatus.value.enabled)
</script>

<template>
  <div class="space-y-6">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Caddy 状态卡片 -->
    <div v-else class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
          {{ t('host.caddy.title') }}
        </h3>
        <span 
          class="px-3 py-1 text-sm rounded-full"
          :class="isEnabled 
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'"
        >
          {{ isEnabled ? t('host.caddy.enabled') : t('host.caddy.disabled') }}
        </span>
      </div>

      <p class="text-sm mb-6" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
        {{ t('host.caddy.description') }}
      </p>

      <!-- 未启用状态 -->
      <div v-if="!isEnabled" class="space-y-4">
        <div 
          class="border-2 border-dashed rounded-lg p-6 text-center"
          :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-300'"
        >
          <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <p class="text-sm mb-4" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
            {{ t('host.caddy.notInstalled') }}
          </p>
          <button
            :disabled="generating"
            class="btn-primary"
            @click="generateInstallCommand"
          >
            <span v-if="generating" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.generateCommand') }}</span>
          </button>
        </div>
      </div>

      <!-- 已启用状态 -->
      <div v-else class="space-y-4">
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.apiPort') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.port }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.username') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.username || '-' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.publicIp') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.natPublicIp || '-' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.sitesCount') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.sitesCount || 0 }}
            </dd>
          </div>
        </dl>

        <div class="flex gap-3 pt-2">
          <button
            :disabled="testing"
            class="btn-ghost"
            @click="testConnection"
          >
            <span v-if="testing" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.testConnection') }}</span>
          </button>
          <button
            :disabled="generating"
            class="btn-ghost"
            @click="generateInstallCommand"
          >
            {{ t('host.caddy.viewCommand') }}
          </button>
          <button
            :disabled="resetting"
            class="btn-ghost text-amber-600 hover:text-amber-700"
            @click="resetCredentials"
          >
            <span v-if="resetting" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.resetCredentials') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 反代站点列表 -->
    <div v-if="!loading && isEnabled" class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
          {{ t('host.caddy.sitesList') }}
        </h3>
        <span class="text-sm text-gray-500">{{ t('host.caddy.sitesTotalCount', { count: sitesTotal }) }}</span>
      </div>

      <!-- 加载状态 -->
      <div v-if="sitesLoading" class="flex justify-center py-8">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="sites.length === 0" class="text-center py-8">
        <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <p class="text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
          {{ t('host.caddy.noSites') }}
        </p>
      </div>

      <!-- 站点列表 -->
      <div v-else class="space-y-3">
        <div 
          v-for="site in sites" 
          :key="site.id"
          class="flex items-center justify-between gap-4 p-3 rounded-lg border"
          :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50'"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm truncate" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ site.domain }}
              </span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full flex-shrink-0"
                :class="getSiteStatusBadge(site).class"
              >
                {{ getSiteStatusBadge(site).label }}
              </span>
              <span 
                v-if="site.httpsEnabled" 
                class="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 flex-shrink-0"
              >
                HTTPS
              </span>
            </div>
            <div class="flex items-center gap-3 mt-1 text-xs" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
              <span v-if="site.instance">
                <span class="text-gray-400">{{ t('host.caddy.instance') }}:</span>
                {{ site.instance.name }}
              </span>
              <span>
                <span class="text-gray-400">{{ t('host.caddy.targetPort') }}:</span>
                {{ site.targetPort }}
              </span>
            </div>
          </div>
        </div>

        <!-- 分页控件 -->
        <div v-if="sitesTotalPages > 1" class="flex items-center justify-between mt-4 pt-3 border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <span class="text-xs text-gray-500">
            {{ t('host.caddy.pageInfo', { current: sitesPage, total: sitesTotalPages, count: sitesTotal }) }}
          </span>
          <div class="flex items-center gap-2">
            <button 
              class="btn-ghost btn-sm" 
              :disabled="sitesPage <= 1" 
              @click="goToPrevSitesPage"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              {{ t('host.caddy.prevPage') }}
            </button>
            <button 
              class="btn-ghost btn-sm" 
              :disabled="sitesPage >= sitesTotalPages" 
              @click="goToNextSitesPage"
            >
              {{ t('host.caddy.nextPage') }}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装命令模态框 -->
    <Teleport to="body">
      <div 
        v-if="showInstallModal" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        @click.self="showInstallModal = false"
      >
        <div 
          class="w-full max-w-2xl rounded-lg shadow-xl"
          :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
        >
          <div class="p-6">
            <h3 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ t('host.caddy.installCommand') }}
            </h3>

            <!-- 凭据信息 -->
            <div class="mb-4 p-4 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.username') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.username }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.password') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.password }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.apiPort') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.port }}
                  </dd>
                </div>
              </dl>
            </div>

            <!-- 安装命令 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-2" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                {{ t('host.caddy.commandLabel') }}
              </label>
              <div class="relative">
                <pre 
                  class="p-4 rounded-lg text-sm overflow-x-auto font-mono"
                  :class="themeStore.isDark ? 'bg-gray-800 text-green-400' : 'bg-gray-900 text-green-400'"
                >{{ installInfo.command }}</pre>
                <button
                  class="absolute top-2 right-2 p-2 rounded hover:bg-gray-700 transition-colors"
                  :title="t('common.copy')"
                  @click="copyCommand"
                >
                  <svg v-if="!copied" class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <svg v-else class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 提示 -->
            <div 
              class="p-4 rounded-lg mb-6 text-sm"
              :class="themeStore.isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700'"
            >
              <p class="font-medium mb-1">{{ t('host.caddy.installHint') }}</p>
              <ol class="list-decimal list-inside space-y-1 text-sm opacity-90">
                <li>{{ t('host.caddy.step1') }}</li>
                <li>{{ t('host.caddy.step2') }}</li>
                <li>{{ t('host.caddy.step3') }}</li>
              </ol>
            </div>

            <!-- 操作按钮 -->
            <div class="flex justify-end gap-3">
              <button
                class="btn-ghost"
                @click="showInstallModal = false"
              >
                {{ t('common.close') }}
              </button>
              <button
                :disabled="confirming"
                class="btn-primary"
                @click="confirmInstallation"
              >
                <span v-if="confirming" class="flex items-center gap-2">
                  <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ t('common.loading') }}
                </span>
                <span v-else>{{ t('host.caddy.confirmInstalled') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
