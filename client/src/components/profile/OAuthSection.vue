<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import { buildApiUrl } from '@/utils/api-url'

const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()

interface OAuthBinding {
  provider: string
  username?: string
  email?: string
}

const oauthBindings = ref<OAuthBinding[]>([])
const enabledOAuthProviders = ref<string[]>([])
const oauthLoading = ref<boolean>(false)

async function loadOAuthBindings(): Promise<void> {
  try {
    const response = await api.oauth.getBindings()
    oauthBindings.value = (response as { bindings?: OAuthBinding[] }).bindings || []
  } catch (error) {
    console.error('Failed to load OAuth bindings:', error)
  }
}

async function loadEnabledOAuthProviders(): Promise<void> {
  try {
    const response = await api.oauth.getProviders()
    enabledOAuthProviders.value = (response as { providers?: string[] }).providers || []
  } catch (error) {
    console.error('Failed to load OAuth providers:', error)
  }
}

function checkOAuthCallbackMessages(): void {
  const urlParams = new URLSearchParams(window.location.search)
  const success = urlParams.get('success')
  const error = urlParams.get('error')
  
  if (success) {
    if (success.startsWith('bound_')) {
      const provider = success.replace('bound_', '')
      toast.success(t('profile.oauth.bindSuccess', { provider: provider.toUpperCase() }))
    }
    window.history.replaceState({}, '', window.location.pathname)
    loadOAuthBindings()
  }
  
  if (error) {
    const errorMessages: Record<string, string> = {
      'not_logged_in': t('profile.oauth.errors.notLoggedIn'),
      'already_bound_other': t('profile.oauth.errors.alreadyBoundOther'),
      'invalid_session': t('profile.oauth.errors.invalidSession'),
      'token_error': t('profile.oauth.errors.tokenError'),
      'provider_disabled': t('profile.oauth.errors.providerDisabled'),
      'oauth_error': t('profile.oauth.errors.oauthError'),
      'missing_code': t('profile.oauth.errors.missingCode')
    }
    toast.error(errorMessages[error] || t('profile.oauth.errors.bindFailed') + ': ' + error)
    window.history.replaceState({}, '', window.location.pathname)
  }
}

async function bindOAuth(provider: string): Promise<void> {
  if (!authStore.token) {
    toast.error(t('profile.oauth.errors.notLoggedIn'))
    return
  }

  try {
    const response = await api.oauth.createBindTicket()
    window.location.href = buildApiUrl(`/oauth/authorize/${provider}?mode=bind&redirect=/profile&bindTicket=${encodeURIComponent(response.ticket)}`)
  } catch (error) {
    toast.error(translateError(error))
  }
}

async function unbindOAuth(provider: string): Promise<void> {
  if (!confirm(t('profile.oauth.confirmUnbind', { provider: provider.toUpperCase() }))) return
  
  oauthLoading.value = true
  try {
    await api.oauth.unbind(provider as 'github' | 'google')
    toast.success(t('profile.oauth.unbindSuccess', { provider: provider.toUpperCase() }))
    await loadOAuthBindings()
  } catch (err: any) {
    toast.error(t('profile.oauth.unbindFailed') + ': ' + (err?.message || String(err)))
  } finally {
    oauthLoading.value = false
  }
}

function isOAuthBound(provider: string): boolean {
  return oauthBindings.value.some((b: any) => b.provider === provider)
}

function getOAuthBinding(provider: string): OAuthBinding | null {
  return oauthBindings.value.find(b => b.provider === provider) || null
}

interface ProviderInfo {
  name: string
  icon: string
}

function getProviderInfo(provider: string): ProviderInfo {
  const info: Record<string, ProviderInfo> = {
    github: {
      name: 'GitHub',
      icon: `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"></path></svg>`
    },
    google: {
      name: 'Google',
      icon: `<svg class="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>`
    }
  }
  return info[provider] || { name: provider, icon: '' }
}

onMounted(async () => {
  await Promise.all([loadOAuthBindings(), loadEnabledOAuthProviders()])
  checkOAuthCallbackMessages()
})

// 组件被缓存后重新激活时也检查回调消息
onActivated(() => {
  checkOAuthCallbackMessages()
})
</script>

<template>
  <div class="card p-5">
    <div class="mb-4">
      <h2 class="text-sm font-medium text-themed-secondary">{{ $t('profile.oauth.title') }}</h2>
      <p class="text-xs text-themed-faint mt-0.5">{{ $t('profile.oauth.description') }}</p>
    </div>

    <div class="space-y-3">
      <!-- GitHub -->
      <div 
        v-if="enabledOAuthProviders.includes('github')"
        class="flex items-center justify-between p-3 bg-themed-tertiary border border-themed rounded-lg"
      >
        <div class="flex items-center gap-3">
          <div 
            class="w-10 h-10 rounded-lg bg-themed-secondary flex items-center justify-center"
            v-html="getProviderInfo('github').icon"
          ></div>
          <div>
            <div class="text-sm text-themed font-medium">GitHub</div>
            <div v-if="isOAuthBound('github')" class="text-xs text-green-400">
              {{ $t('profile.oauth.bound') }}: {{ (() => { const b = getOAuthBinding('github'); return b?.username || b?.email || ''; })() }}
            </div>
            <div v-else class="text-xs text-themed-muted">{{ $t('profile.oauth.notBound') }}</div>
          </div>
        </div>
        <button 
          v-if="isOAuthBound('github')"
          :disabled="oauthLoading"
          class="btn-ghost btn-sm text-error"
          @click="unbindOAuth('github')"
        >
          {{ $t('profile.oauth.unbind') }}
        </button>
        <button 
          v-else
          class="btn-secondary btn-sm"
          @click="bindOAuth('github')"
        >
          {{ $t('profile.oauth.bind') }}
        </button>
      </div>

      <!-- Google -->
      <div 
        v-if="enabledOAuthProviders.includes('google')"
        class="flex items-center justify-between p-3 bg-themed-tertiary border border-themed rounded-lg"
      >
        <div class="flex items-center gap-3">
          <div 
            class="w-10 h-10 rounded-lg bg-themed-secondary flex items-center justify-center"
            v-html="getProviderInfo('google').icon"
          ></div>
          <div>
            <div class="text-sm text-themed font-medium">Google</div>
            <div v-if="isOAuthBound('google')" class="text-xs text-green-400">
              {{ $t('profile.oauth.bound') }}: {{ (() => { const b = getOAuthBinding('google'); return b?.username || b?.email || ''; })() }}
            </div>
            <div v-else class="text-xs text-themed-muted">{{ $t('profile.oauth.notBound') }}</div>
          </div>
        </div>
        <button 
          v-if="isOAuthBound('google')"
          :disabled="oauthLoading"
          class="btn-ghost btn-sm text-error"
          @click="unbindOAuth('google')"
        >
          {{ $t('profile.oauth.unbind') }}
        </button>
        <button 
          v-else
          class="btn-secondary btn-sm"
          @click="bindOAuth('google')"
        >
          {{ $t('profile.oauth.bind') }}
        </button>
      </div>

      <!-- 没有启用任何 OAuth -->
      <div 
        v-if="!enabledOAuthProviders.includes('github') && !enabledOAuthProviders.includes('google')"
        class="text-sm text-themed-muted text-center py-4"
      >
        {{ $t('profile.oauth.noProviders') }}
      </div>
    </div>
  </div>
</template>
