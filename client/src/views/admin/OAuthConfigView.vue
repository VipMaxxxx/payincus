<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import type { AdminOAuthAuthorization, OAuthClientApp, OAuthConfig, PublicApiScope, PublicApiScopeMetadata, UpdateOAuthConfigRequest } from '@/types/api'
import { buildPublicApiUrl } from '@/utils/api-url'

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

const loading = ref<boolean>(true)
interface ProviderConfig {
  clientId: string
  clientSecret: string
  enabled: boolean
  configured: boolean
}
type ProviderType = 'github' | 'google'
const configs = ref<Record<ProviderType, ProviderConfig>>({
  github: { clientId: '', clientSecret: '', enabled: false, configured: false },
  google: { clientId: '', clientSecret: '', enabled: false, configured: false }
})

// Edit modal
const showModal = ref<boolean>(false)
const editProvider = ref<ProviderType | ''>('')
const form = ref<UpdateOAuthConfigRequest>({ clientId: '', clientSecret: '', enabled: false })
const formLoading = ref<boolean>(false)
const oauthApps = ref<OAuthClientApp[]>([])
const oauthAppsLoading = ref(false)
const oauthAuthorizations = ref<AdminOAuthAuthorization[]>([])
const oauthAuthorizationsLoading = ref(false)
const oauthAuthorizationFilters = ref<{
  appId: number | null
  user: string
  status: 'all' | 'active' | 'revoked' | 'disabled'
  page: number
  pageSize: number
}>({
  appId: null,
  user: '',
  status: 'all',
  page: 1,
  pageSize: 20
})
const oauthAuthorizationTotal = ref(0)
const oauthAuthorizationTotalPages = ref(1)
const oauthAppSaving = ref(false)
const oauthAppSecret = ref('')
const availableOAuthScopes = ref<PublicApiScopeMetadata[]>([])
const oauthAppForm = ref<{
  id: number | null
  name: string
  redirectUris: string
  scopes: PublicApiScope[]
  enabled: boolean
}>({
  id: null,
  name: '',
  redirectUris: '',
  scopes: ['profile:read'],
  enabled: true
})

onMounted(async (): Promise<void> => {
  await Promise.all([loadConfigs(), loadOAuthScopes(), loadOAuthApps(), loadOAuthAuthorizations()])
})

async function loadOAuthScopes(): Promise<void> {
  try {
    const response = await api.oauthApps.listScopes()
    availableOAuthScopes.value = response.scopes
  } catch (err: any) {
    toast.error('加载 OAuth scope 元数据失败：' + (err?.message || String(err)))
  }
}

async function loadConfigs(): Promise<void> {
  loading.value = true
  try {
    const response = await api.oauth.getConfigs()
    const data = response as { configs?: OAuthConfig[] }
    
    // Reset configs
    configs.value = {
      github: { clientId: '', clientSecret: '', enabled: false, configured: false },
      google: { clientId: '', clientSecret: '', enabled: false, configured: false }
    }
    
    // Map response to configs
    for (const config of data.configs || []) {
      const provider = config.provider as ProviderType
      if (provider && configs.value[provider]) {
        // 后端返回 clientId（驼峰）和 enabled（布尔值）
        const configAny = config as any
        configs.value[provider] = {
          clientId: configAny.clientId || config.client_id || '',
          clientSecret: configAny.clientSecretMasked || '',
          enabled: Boolean(configAny.enabled ?? config.enabled),
          configured: true
        }
      }
    }
  } finally {
    loading.value = false
  }
}

async function loadOAuthApps(): Promise<void> {
  oauthAppsLoading.value = true
  try {
    const response = await api.oauthApps.list()
    oauthApps.value = response.apps
  } catch (err: any) {
    toast.error('加载对外 OAuth 应用失败：' + (err?.message || String(err)))
  } finally {
    oauthAppsLoading.value = false
  }
}

async function loadOAuthAuthorizations(): Promise<void> {
  oauthAuthorizationsLoading.value = true
  try {
    const response = await api.oauthApps.listAuthorizations({
      appId: oauthAuthorizationFilters.value.appId || undefined,
      user: oauthAuthorizationFilters.value.user.trim() || undefined,
      status: oauthAuthorizationFilters.value.status,
      page: oauthAuthorizationFilters.value.page,
      pageSize: oauthAuthorizationFilters.value.pageSize
    })
    oauthAuthorizations.value = response.authorizations
    oauthAuthorizationTotal.value = response.total
    oauthAuthorizationTotalPages.value = response.totalPages
  } catch (err: any) {
    toast.error('加载 OAuth 授权记录失败：' + (err?.message || String(err)))
  } finally {
    oauthAuthorizationsLoading.value = false
  }
}

function applyOAuthAuthorizationFilters(): void {
  oauthAuthorizationFilters.value.page = 1
  void loadOAuthAuthorizations()
}

async function revokeOAuthAuthorization(authorization: AdminOAuthAuthorization): Promise<void> {
  if (!confirm(`确认撤销 ${authorization.user.username} 对 ${authorization.app.name} 的授权？相关 access token 和 refresh token 会立即失效。`)) return
  try {
    await api.oauthApps.revokeAuthorization(authorization.id)
    toast.success('OAuth 授权已撤销')
    await loadOAuthAuthorizations()
  } catch (err: any) {
    toast.error('撤销 OAuth 授权失败：' + (err?.message || String(err)))
  }
}

function formatOAuthAuthorizationStatus(authorization: AdminOAuthAuthorization): string {
  if (authorization.revokedAt) return '已撤销'
  if (!authorization.app.enabled) return '应用停用'
  return '有效'
}

function setOAuthAuthorizationPage(page: number): void {
  oauthAuthorizationFilters.value.page = Math.min(Math.max(1, page), oauthAuthorizationTotalPages.value)
  void loadOAuthAuthorizations()
}

function resetOAuthAppForm(): void {
  oauthAppForm.value = {
    id: null,
    name: '',
    redirectUris: '',
    scopes: ['profile:read'],
    enabled: true
  }
}

function editOAuthApp(app: OAuthClientApp): void {
  oauthAppForm.value = {
    id: app.id,
    name: app.name,
    redirectUris: app.redirectUris.join('\n'),
    scopes: app.scopes.length ? [...app.scopes] : ['profile:read'],
    enabled: app.enabled
  }
  oauthAppSecret.value = ''
}

function parseRedirectUrisInput(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)))
}

async function saveOAuthApp(): Promise<void> {
  const redirectUris = parseRedirectUrisInput(oauthAppForm.value.redirectUris)
  if (!oauthAppForm.value.name.trim()) {
    toast.error('请输入应用名称')
    return
  }
  if (redirectUris.length === 0) {
    toast.error('至少需要一个 Redirect URI')
    return
  }
  if (oauthAppForm.value.scopes.length === 0) {
    toast.error('至少需要一个 scope')
    return
  }
  oauthAppSaving.value = true
  try {
    const payload = {
      name: oauthAppForm.value.name.trim(),
      redirectUris,
      scopes: oauthAppForm.value.scopes,
      enabled: oauthAppForm.value.enabled
    }
    if (oauthAppForm.value.id) {
      await api.oauthApps.update(oauthAppForm.value.id, payload)
      toast.success('OAuth 应用已更新')
    } else {
      const response = await api.oauthApps.create(payload)
      oauthAppSecret.value = response.clientSecret
      toast.success('OAuth 应用已创建，请立即保存 Client Secret')
    }
    resetOAuthAppForm()
    await Promise.all([loadOAuthApps(), loadOAuthAuthorizations()])
  } catch (err: any) {
    toast.error('保存 OAuth 应用失败：' + (err?.message || String(err)))
  } finally {
    oauthAppSaving.value = false
  }
}

async function rotateOAuthAppSecret(app: OAuthClientApp): Promise<void> {
  if (!confirm(`确认轮换 ${app.name} 的 Client Secret？旧 secret 将立即失效。`)) return
  try {
    const response = await api.oauthApps.rotateSecret(app.id)
    oauthAppSecret.value = response.clientSecret
    toast.success('Client Secret 已轮换，请立即保存')
    await Promise.all([loadOAuthApps(), loadOAuthAuthorizations()])
  } catch (err: any) {
    toast.error('轮换 Client Secret 失败：' + (err?.message || String(err)))
  }
}

async function deleteOAuthApp(app: OAuthClientApp): Promise<void> {
  if (!confirm(`确认删除 ${app.name}？关联授权码和 access token 会一起失效。`)) return
  try {
    await api.oauthApps.delete(app.id)
    toast.success('OAuth 应用已删除')
    if (oauthAppForm.value.id === app.id) resetOAuthAppForm()
    await Promise.all([loadOAuthApps(), loadOAuthAuthorizations()])
  } catch (err: any) {
    toast.error('删除 OAuth 应用失败：' + (err?.message || String(err)))
  }
}

function openEdit(provider: ProviderType): void {
  editProvider.value = provider
  const config = configs.value[provider]
  form.value = {
    clientId: config.clientId || '',
    clientSecret: '',  // Always empty for security
    enabled: config.enabled
  }
  showModal.value = true
}

async function saveConfig(): Promise<void> {
  if (!form.value.clientId) {
    toast.error(t('admin.oauth.clientId'))
    return
  }
  
  if (!editProvider.value) return
  
  // If already configured but no new secret provided, use a placeholder check
  const isUpdate = configs.value[editProvider.value].configured
  if (!isUpdate && !form.value.clientSecret) {
    toast.error(t('admin.oauth.clientSecret'))
    return
  }
  
  formLoading.value = true
  try {
    const payload: UpdateOAuthConfigRequest = {
      clientId: form.value.clientId,
      enabled: form.value.enabled
    }
    if (form.value.clientSecret) {
      payload.clientSecret = form.value.clientSecret
    }

    await api.oauth.updateConfig(editProvider.value, payload)
    
    toast.success(t('admin.oauth.saveSuccess'))
    showModal.value = false
    await loadConfigs()
  } catch (err: any) {
    toast.error(t('admin.oauth.saveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    formLoading.value = false
  }
}

async function deleteConfig(provider: ProviderType): Promise<void> {
  if (!confirm(`Delete ${provider.toUpperCase()} config?`)) return
  
  try {
    await api.oauth.deleteConfig(provider)
    toast.success(t('common.success'))
    await loadConfigs()
  } catch (err: any) {
    toast.error(err?.message || String(err))
  }
}

// Provider info with reactive icons based on theme
interface ProviderInfo {
  name: string
  icon: string
  docsUrl: string
  callbackPath: string
}

const providerInfo = computed<Record<ProviderType, ProviderInfo>>(() => {
  const isDark = themeStore.isDark
  return {
    github: {
      name: 'GitHub',
      icon: `<svg class="w-6 h-6" fill="${isDark ? '#ededed' : '#18181b'}" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"></path></svg>`,
      docsUrl: 'https://github.com/settings/developers',
      callbackPath: '/oauth/callback/github'
    },
    google: {
      name: 'Google',
      // Google 图标保持原色，但需要根据主题调整背景
      icon: `<svg class="w-6 h-6" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>`,
      docsUrl: 'https://console.cloud.google.com/apis/credentials',
      callbackPath: '/oauth/callback/google'
    }
  }
})

// function getProviderInfo(provider: ProviderType | ''): ProviderInfo | undefined {
//   if (!provider) return undefined
//   return providerInfo.value[provider as ProviderType]
// }

function getCallbackUrl(path?: string): string {
  return path ? buildPublicApiUrl(path) : ''
}

function formatScopeRisk(risk: PublicApiScopeMetadata['risk']): string {
  return {
    low: '低风险',
    medium: '中风险',
    high: '高风险'
  }[risk]
}

function formatScopeAccess(access: PublicApiScopeMetadata['access']): string {
  return {
    read: '读取',
    write: '写入',
    operate: '操作'
  }[access]
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('admin.oauth.title') }}</h1>
        <p class="page-description">{{ t('admin.oauth.description') }}</p>
      </div>
    </div>
    <ThemeTemplateSlot slot-name="admin.oauth.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div v-for="i in 2" :key="i" class="card p-6 animate-pulse">
        <div class="h-8 bg-themed-secondary rounded w-1/3 mb-4"></div>
        <div class="h-4 bg-themed-secondary rounded w-2/3 mb-2"></div>
        <div class="h-4 bg-themed-secondary rounded w-1/2"></div>
      </div>
    </div>

    <!-- Provider Cards -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div 
        v-for="(config, provider) in configs" 
        :key="provider"
        class="card p-6"
      >
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div 
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              :class="[
                config.configured 
                  ? 'bg-themed-secondary' 
                  : (themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'),
                provider === 'google' && !themeStore.isDark && 'bg-white'
              ]"
              v-html="providerInfo[provider]?.icon"
            ></div>
            <div>
              <h3 class="text-themed font-medium">{{ providerInfo[provider]?.name }}</h3>
              <span 
                :class="[
                  'text-xs',
                  config.configured 
                    ? (config.enabled ? 'text-green-400' : 'text-yellow-400')
                    : 'text-themed-muted'
                ]"
              >
                {{ config.configured ? (config.enabled ? t('admin.oauth.enabled') : t('admin.oauth.disabled')) : '-' }}
              </span>
            </div>
          </div>
          
          <div class="flex gap-2">
            <button class="btn-secondary btn-sm" @click="openEdit(provider)">
              {{ config.configured ? t('admin.oauth.edit') : t('common.create') }}
            </button>
            <button 
              v-if="config.configured" 
              class="btn-ghost btn-sm text-error" 
              @click="deleteConfig(provider)"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </div>

        <div v-if="config.configured" class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-themed-secondary">Client ID</span>
            <span class="text-themed font-mono text-xs">{{ config.clientId }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-themed-secondary">Client Secret</span>
            <span class="text-themed font-mono text-xs">{{ config.clientSecret }}</span>
          </div>
        </div>

        <div v-else class="text-sm text-themed-muted">
          <p>
            {{ t('admin.oauth.notConfigured') }} 
            <a 
              :href="providerInfo[provider]?.docsUrl" 
              target="_blank" 
              class="text-accent hover:underline"
            >
              {{ providerInfo[provider]?.name }} {{ t('admin.oauth.developerConsole') }}
            </a>
            {{ t('admin.oauth.createOAuthApp') }}
          </p>
        </div>

        <!-- Callback URL Info -->
        <div class="mt-4 p-3 bg-themed-tertiary rounded-lg">
          <div class="text-xs text-themed-secondary mb-1">{{ t('admin.oauth.callbackUrl') }}</div>
          <code class="text-xs text-themed font-mono break-all">
            {{ getCallbackUrl(providerInfo[provider]?.callbackPath) }}
          </code>
        </div>
      </div>
    </div>

    <!-- Usage Guide -->
    <div class="card p-6">
      <h3 class="text-themed font-medium mb-4">{{ t('admin.oauth.usageGuide') }}</h3>
      <div class="space-y-3 text-sm text-themed-secondary">
        <p>{{ t('admin.oauth.step1') }}</p>
        <p>{{ t('admin.oauth.step2') }}</p>
        <p>{{ t('admin.oauth.step3') }}</p>
        <p>{{ t('admin.oauth.step4') }}</p>
        <p class="text-yellow-500">⚠️ {{ t('admin.oauth.warning') }}</p>
      </div>
    </div>

    <div class="card p-6">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 class="text-themed font-medium">PayIncus OAuth 服务端</h3>
          <p class="mt-1 text-sm text-themed-muted">为第三方应用创建 OAuth 应用，通过授权码换取 Bearer token 后访问 /api/v1。</p>
        </div>
        <button class="btn-secondary" :disabled="oauthAppsLoading" @click="loadOAuthApps">
          {{ oauthAppsLoading ? '加载中...' : '刷新应用' }}
        </button>
      </div>

      <div v-if="oauthAppSecret" class="mt-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
        <div class="font-medium">Client Secret 只显示一次</div>
        <code class="mt-2 block break-all rounded bg-white/70 p-2 font-mono text-xs">{{ oauthAppSecret }}</code>
      </div>

      <form class="mt-5 grid min-w-0 gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(360px,480px)]" @submit.prevent="saveOAuthApp">
        <div class="grid min-w-0 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm text-themed-secondary">应用名称</label>
            <input v-model="oauthAppForm.name" class="input" type="text" placeholder="Flash Sale App" />
          </div>
          <div>
            <label class="mb-1 block text-sm text-themed-secondary">状态</label>
            <label class="flex h-10 items-center gap-2 text-sm text-themed">
              <input v-model="oauthAppForm.enabled" type="checkbox" class="h-4 w-4 rounded text-accent" />
              启用此 OAuth App
            </label>
          </div>
          <div class="md:col-span-2">
            <label class="mb-1 block text-sm text-themed-secondary">Redirect URI，每行一个</label>
            <textarea v-model="oauthAppForm.redirectUris" class="input min-h-[86px]" placeholder="https://example.com/oauth/callback"></textarea>
          </div>
        </div>

        <div class="min-w-0 rounded-lg border border-themed p-4">
          <div class="text-sm font-medium text-themed">授权 Scope</div>
          <div class="mt-3 grid gap-2 text-sm text-themed">
            <label v-for="scope in availableOAuthScopes" :key="scope.scope" class="flex min-w-0 items-start gap-2 rounded border border-themed px-3 py-2">
              <input v-model="oauthAppForm.scopes" type="checkbox" :value="scope.scope" class="mt-1 h-4 w-4 rounded text-accent" />
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs">{{ scope.scope }}</span>
                  <span class="rounded bg-themed-secondary px-1.5 py-0.5 text-[10px] text-themed-muted">{{ formatScopeRisk(scope.risk) }}</span>
                  <span class="rounded bg-themed-secondary px-1.5 py-0.5 text-[10px] text-themed-muted">{{ formatScopeAccess(scope.access) }}</span>
                </span>
                <span class="mt-1 block text-xs font-medium text-themed">{{ scope.title }}</span>
                <span class="mt-1 block break-words text-xs text-themed-muted">{{ scope.description }}</span>
                <span class="mt-1 block break-all text-[11px] text-themed-muted">{{ scope.resources.join(', ') }}</span>
              </span>
            </label>
          </div>
          <div class="mt-4 flex gap-2">
            <button type="submit" class="btn-primary" :disabled="oauthAppSaving">
              {{ oauthAppSaving ? '保存中...' : (oauthAppForm.id ? '更新应用' : '创建应用') }}
            </button>
            <button type="button" class="btn-secondary" @click="resetOAuthAppForm">清空</button>
          </div>
        </div>
      </form>

      <div class="mt-6 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4">应用</th>
              <th class="py-3 pr-4">Redirect URI</th>
              <th class="py-3 pr-4">Scope</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="appItem in oauthApps" :key="appItem.id" class="border-b border-themed">
              <td class="py-3 pr-4">
                <div class="font-medium text-themed">{{ appItem.name }}</div>
                <div class="font-mono text-xs text-themed-muted">{{ appItem.clientId }}</div>
              </td>
              <td class="max-w-[280px] py-3 pr-4 text-xs text-themed-muted">
                <div v-for="uri in appItem.redirectUris" :key="uri" class="truncate">{{ uri }}</div>
              </td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-1">
                  <span v-for="scope in appItem.scopes" :key="scope" class="rounded bg-themed-secondary px-2 py-1 font-mono text-[11px] text-themed">
                    {{ scope }}
                  </span>
                </div>
              </td>
              <td class="py-3 pr-4">
                <span :class="appItem.enabled ? 'text-green-500' : 'text-yellow-500'">{{ appItem.enabled ? '启用' : '停用' }}</span>
              </td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-2">
                  <button class="btn-secondary btn-sm" @click="editOAuthApp(appItem)">编辑</button>
                  <button class="btn-secondary btn-sm" @click="rotateOAuthAppSecret(appItem)">轮换 Secret</button>
                  <button class="btn-ghost btn-sm text-error" @click="deleteOAuthApp(appItem)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="oauthApps.length === 0">
              <td colspan="5" class="py-8 text-center text-themed-muted">暂无对外 OAuth 应用。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card p-6">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 class="text-themed font-medium">OAuth 授权审计</h3>
          <p class="mt-1 text-sm text-themed-muted">按应用、用户和状态筛选第三方授权记录，可撤销授权并使关联 access token / refresh token 失效。</p>
        </div>
        <button class="btn-secondary" :disabled="oauthAuthorizationsLoading" @click="loadOAuthAuthorizations">
          {{ oauthAuthorizationsLoading ? '加载中...' : '刷新授权' }}
        </button>
      </div>

      <div class="mt-5 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_180px_auto]">
        <select v-model="oauthAuthorizationFilters.appId" class="input">
          <option :value="null">全部 OAuth App</option>
          <option v-for="appItem in oauthApps" :key="appItem.id" :value="appItem.id">{{ appItem.name }}</option>
        </select>
        <input
          v-model="oauthAuthorizationFilters.user"
          class="input"
          type="search"
          placeholder="按用户 ID、用户名或邮箱搜索"
          @keyup.enter="applyOAuthAuthorizationFilters"
        />
        <select v-model="oauthAuthorizationFilters.status" class="input">
          <option value="all">全部状态</option>
          <option value="active">有效授权</option>
          <option value="revoked">已撤销</option>
          <option value="disabled">应用停用</option>
        </select>
        <button class="btn-primary" @click="applyOAuthAuthorizationFilters">筛选</button>
      </div>

      <div class="mt-6 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4">用户</th>
              <th class="py-3 pr-4">应用</th>
              <th class="py-3 pr-4">Scope</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">活跃 Token</th>
              <th class="py-3 pr-4">最后授权</th>
              <th class="py-3 pr-4">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="authorization in oauthAuthorizations" :key="authorization.id" class="border-b border-themed">
              <td class="py-3 pr-4">
                <div class="font-medium text-themed">{{ authorization.user.username }}</div>
                <div class="text-xs text-themed-muted">#{{ authorization.user.id }} · {{ authorization.user.email || '无邮箱' }}</div>
              </td>
              <td class="py-3 pr-4">
                <div class="font-medium text-themed">{{ authorization.app.name }}</div>
                <div class="font-mono text-xs text-themed-muted">{{ authorization.app.clientId }}</div>
              </td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-1">
                  <span v-for="scope in authorization.scopes" :key="scope" class="rounded bg-themed-secondary px-2 py-1 font-mono text-[11px] text-themed">
                    {{ scope }}
                  </span>
                </div>
              </td>
              <td class="py-3 pr-4">
                <span :class="authorization.active ? 'text-green-500' : 'text-yellow-500'">
                  {{ formatOAuthAuthorizationStatus(authorization) }}
                </span>
                <div v-if="authorization.revokedAt" class="text-xs text-themed-muted">{{ new Date(authorization.revokedAt).toLocaleString() }}</div>
              </td>
              <td class="py-3 pr-4 text-themed">
                <div>Access: {{ authorization.tokenStats.activeAccessTokens }}</div>
                <div>Refresh: {{ authorization.tokenStats.activeRefreshTokens }}</div>
              </td>
              <td class="py-3 pr-4 text-themed-muted">{{ new Date(authorization.lastAuthorizedAt).toLocaleString() }}</td>
              <td class="py-3 pr-4">
                <button
                  class="btn-ghost btn-sm text-error"
                  :disabled="Boolean(authorization.revokedAt)"
                  @click="revokeOAuthAuthorization(authorization)"
                >
                  撤销授权
                </button>
              </td>
            </tr>
            <tr v-if="oauthAuthorizations.length === 0">
              <td colspan="7" class="py-8 text-center text-themed-muted">暂无 OAuth 授权记录。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex flex-col gap-3 text-sm text-themed-muted md:flex-row md:items-center md:justify-between">
        <div>共 {{ oauthAuthorizationTotal }} 条，当前第 {{ oauthAuthorizationFilters.page }} / {{ oauthAuthorizationTotalPages }} 页</div>
        <div class="flex gap-2">
          <button class="btn-secondary btn-sm" :disabled="oauthAuthorizationFilters.page <= 1" @click="setOAuthAuthorizationPage(oauthAuthorizationFilters.page - 1)">上一页</button>
          <button class="btn-secondary btn-sm" :disabled="oauthAuthorizationFilters.page >= oauthAuthorizationTotalPages" @click="setOAuthAuthorizationPage(oauthAuthorizationFilters.page + 1)">下一页</button>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false"></div>
        
        <div class="relative w-full max-w-md bg-themed border border-themed rounded-xl p-6 shadow-2xl animate-fade-in">
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
              <div 
                class="w-10 h-10 rounded-lg flex items-center justify-center"
                :class="[
                  'bg-themed-secondary',
                  editProvider === 'google' && !themeStore.isDark && 'bg-white'
                ]"
                v-html="editProvider ? providerInfo[editProvider]?.icon : ''"
              ></div>
              <h3 class="text-lg font-semibold text-themed">
                {{ t('admin.oauth.configure') }} {{ editProvider ? providerInfo[editProvider]?.name : '' }}
              </h3>
            </div>
            <button class="text-themed-secondary hover:text-themed" @click="showModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <form class="space-y-4" @submit.prevent="saveConfig">
            <div>
              <label class="block text-sm text-themed-secondary mb-1">{{ t('admin.oauth.clientId') }} *</label>
              <input 
                v-model="form.clientId" 
                type="text" 
                class="input" 
                :placeholder="t('admin.oauth.enterClientId')"
              />
            </div>

            <div>
              <label class="block text-sm text-themed-secondary mb-1">
                {{ t('admin.oauth.clientSecret') }} {{ editProvider && configs[editProvider]?.configured ? t('admin.oauth.leaveEmptyUnchanged') : '*' }}
              </label>
              <input 
                v-model="form.clientSecret" 
                type="password" 
                class="input" 
                :placeholder="t('admin.oauth.enterClientSecret')"
              />
            </div>

            <label class="flex items-center gap-3 cursor-pointer">
              <input 
                v-model="form.enabled" 
                type="checkbox" 
                :class="[
                  'w-4 h-4 rounded text-accent',
                  themeStore.isDark ? 'border-gray-600 bg-gray-800 focus:ring-offset-gray-900' : 'border-gray-300 bg-white focus:ring-offset-white'
                ]"
              />
              <div>
                <div class="text-sm text-themed">{{ t('admin.oauth.enableLogin') }}</div>
                <div class="text-xs text-themed-muted">{{ t('admin.oauth.enableLoginHint') }}</div>
              </div>
            </label>

            <div class="flex justify-end gap-3 pt-4">
              <button type="button" class="btn-secondary" @click="showModal = false">{{ t('common.cancel') }}</button>
              <button type="submit" :disabled="formLoading" class="btn-primary">
                {{ formLoading ? t('admin.oauth.saving') : t('admin.oauth.save') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
