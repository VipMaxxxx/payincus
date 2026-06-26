<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import type { OAuthProviderConsentResponse, PublicApiScopeMetadata } from '@/types/api'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const consent = ref<OAuthProviderConsentResponse | null>(null)
const scopeCatalog = ref<PublicApiScopeMetadata[]>([])

const requestParams = computed(() => {
  const clientId = String(route.query.client_id || route.query.clientId || '')
  const redirectUri = String(route.query.redirect_uri || route.query.redirectUri || '')
  const scope = String(route.query.scope || 'profile:read')
  const state = typeof route.query.state === 'string' ? route.query.state : null
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state
  }
})

const requestedScopes = computed(() => consent.value?.requestedScopes || [])
const scopeMetadataByScope = computed(() => {
  const map = new Map<string, PublicApiScopeMetadata>()
  for (const item of scopeCatalog.value) map.set(item.scope, item)
  for (const item of consent.value?.scopeMetadata || []) map.set(item.scope, item)
  return map
})

function redirectTo(url: string) {
  window.location.href = url
}

function buildDeniedRedirect(): string | null {
  const redirectUri = consent.value?.request.redirectUri || requestParams.value.redirect_uri
  if (!redirectUri) return null
  const target = new URL(redirectUri)
  target.searchParams.set('error', 'access_denied')
  target.searchParams.set('error_description', 'The user denied the authorization request')
  const state = consent.value?.request.state || requestParams.value.state
  if (state) target.searchParams.set('state', state)
  return target.toString()
}

async function loadConsent() {
  loading.value = true
  error.value = ''
  try {
    if (!requestParams.value.client_id || !requestParams.value.redirect_uri) {
      throw new Error('OAuth 授权请求缺少 client_id 或 redirect_uri')
    }
    const response = await api.oauthProvider.getConsent(requestParams.value)
    consent.value = response
    scopeCatalog.value = response.scopeMetadata
    if (!response.consentRequired) {
      await approve()
    }
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function loadScopeCatalog() {
  try {
    const response = await api.oauthProvider.listScopes()
    scopeCatalog.value = response.scopes
  } catch {
    scopeCatalog.value = []
  }
}

async function approve() {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const params = requestParams.value
    const response = await api.oauthProvider.confirm({
      responseType: 'code',
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      scope: params.scope,
      state: params.state,
      confirmed: true
    })
    redirectTo(response.redirectTo)
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}

function deny() {
  const deniedRedirect = buildDeniedRedirect()
  if (deniedRedirect) {
    redirectTo(deniedRedirect)
    return
  }
  router.push('/dashboard')
}

onMounted(() => {
  void loadScopeCatalog()
  void loadConsent()
})
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <section class="mx-auto w-full max-w-xl">
      <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div v-if="loading" class="space-y-3">
          <div class="h-5 w-40 animate-pulse rounded bg-gray-200"></div>
          <div class="h-4 w-full animate-pulse rounded bg-gray-100"></div>
          <div class="h-4 w-4/5 animate-pulse rounded bg-gray-100"></div>
        </div>

        <div v-else-if="error" class="space-y-4">
          <h1 class="text-lg font-semibold text-gray-900">OAuth 授权失败</h1>
          <p class="text-sm text-red-600">{{ error }}</p>
          <button class="btn-secondary w-full" @click="router.push('/dashboard')">返回控制台</button>
        </div>

        <div v-else-if="consent" class="space-y-6">
          <div>
            <h1 class="text-lg font-semibold text-gray-900">授权 {{ consent.app.name }}</h1>
            <p class="mt-2 break-all text-sm text-gray-500">{{ consent.request.redirectUri }}</p>
          </div>

          <div class="space-y-2">
            <div
              v-for="scope in requestedScopes"
              :key="scope"
              class="flex items-start justify-between gap-4 rounded-md border border-gray-200 px-3 py-2"
            >
              <div>
                <div class="text-sm font-medium text-gray-900">
                  {{ scopeMetadataByScope.get(scope)?.title || scope }}
                </div>
                <div class="text-xs text-gray-500">{{ scopeMetadataByScope.get(scope)?.description || '访问授权范围内的公共 API' }}</div>
                <div v-if="scopeMetadataByScope.get(scope)?.resources.length" class="mt-1 text-[11px] text-gray-400">
                  {{ scopeMetadataByScope.get(scope)?.resources.join(', ') }}
                </div>
              </div>
              <span
                v-if="consent.existingScopes.includes(scope)"
                class="shrink-0 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
              >
                已授权
              </span>
            </div>
          </div>

          <div class="flex gap-3">
            <button class="btn-secondary flex-1" :disabled="submitting" @click="deny">拒绝</button>
            <button class="btn-primary flex-1" :disabled="submitting" @click="approve">
              {{ submitting ? '处理中...' : '允许授权' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
