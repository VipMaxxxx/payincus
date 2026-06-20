<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import type { OAuthConfig, UpdateOAuthConfigRequest } from '@/types/api'

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

onMounted(async (): Promise<void> => {
  await loadConfigs()
})

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
    await api.oauth.updateConfig(editProvider.value, {
      clientId: form.value.clientId,
      clientSecret: form.value.clientSecret || 'UNCHANGED',  // Backend should handle this
      enabled: form.value.enabled
    })
    
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
      callbackPath: '/api/oauth/callback/github'
    },
    google: {
      name: 'Google',
      // Google 图标保持原色，但需要根据主题调整背景
      icon: `<svg class="w-6 h-6" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>`,
      docsUrl: 'https://console.cloud.google.com/apis/credentials',
      callbackPath: '/api/oauth/callback/google'
    }
  }
})

// function getProviderInfo(provider: ProviderType | ''): ProviderInfo | undefined {
//   if (!provider) return undefined
//   return providerInfo.value[provider as ProviderType]
// }

const callbackUrl: string = window.location.origin
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('admin.oauth.title') }}</h1>
        <p class="page-description">{{ t('admin.oauth.description') }}</p>
      </div>
    </div>

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
            {{ callbackUrl }}{{ providerInfo[provider]?.callbackPath }}
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

