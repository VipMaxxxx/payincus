<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import type { OAuthProviderConsentResponse, PublicApiScopeMetadata } from '@/types/api'
import { dashboardPath } from '@/utils/app-paths'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const errorHint = ref('')
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

function describeConsentError(err: unknown): { message: string; hint: string } {
  const apiError = err as { code?: unknown; message?: unknown }
  const message = typeof apiError?.message === 'string' ? apiError.message : String(err)
  if (
    apiError?.code === 'OAUTH_CONSENT_FAILED' &&
    /disabled or missing|invalid client_id|invalid redirect_uri/i.test(message)
  ) {
    return {
      message: '授权应用不可用',
      hint: '该应用不存在、已停用，或回调地址与配置不匹配。请返回来源页面重新发起授权。'
    }
  }
  return {
    message: message || 'OAuth 授权请求加载失败',
    hint: '请确认授权链接完整有效，或稍后重试。'
  }
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
  errorHint.value = ''
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
    const friendlyError = describeConsentError(err)
    error.value = friendlyError.message
    errorHint.value = friendlyError.hint
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
  errorHint.value = ''
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
    const friendlyError = describeConsentError(err)
    error.value = friendlyError.message
    errorHint.value = friendlyError.hint
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
  router.push(dashboardPath())
}

onMounted(() => {
  void loadScopeCatalog()
  void loadConsent()
})
</script>

<template>
  <main class="nimbus-auth kawaii-public-shell kawaii-auth-shell kawaii-user-auth min-h-screen flex items-center justify-center px-4 py-10">
    <div class="nimbus-aurora" aria-hidden="true"></div>
    <section class="relative z-10 mx-auto w-full max-w-xl">
      <div class="card nimbus-card">
        <div v-if="loading" class="space-y-3">
          <div class="h-11 w-11 animate-pulse rounded-xl skeleton-bg"></div>
          <div class="h-5 w-40 animate-pulse rounded skeleton-bg"></div>
          <div class="h-4 w-full animate-pulse rounded skeleton-bg-soft"></div>
          <div class="h-4 w-4/5 animate-pulse rounded skeleton-bg-soft"></div>
        </div>

        <div v-else-if="error" class="space-y-4">
          <div class="nimbus-consent-icon nimbus-consent-icon--warn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.52 14.06A1.875 1.875 0 003.424 20.9h17.152a1.875 1.875 0 001.604-2.9L13.66 3.94a1.875 1.875 0 00-3.32 0z" />
            </svg>
          </div>
          <h1 class="text-lg font-semibold text-themed">OAuth 授权失败</h1>
          <p class="text-sm text-red-600">{{ error }}</p>
          <p v-if="errorHint" class="nimbus-consent-hint">
            {{ errorHint }}
          </p>
          <button class="btn-secondary w-full" @click="router.push(dashboardPath())">返回控制台</button>
        </div>

        <div v-else-if="consent" class="space-y-6">
          <div class="text-center">
            <div class="nimbus-consent-icon nimbus-consent-icon--app">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <h1 class="text-lg font-semibold text-themed">授权 {{ consent.app.name }}</h1>
            <p class="mt-2 break-all text-xs font-mono text-themed-muted">{{ consent.request.redirectUri }}</p>
          </div>

          <div class="space-y-2">
            <p class="nimbus-consent-section-label">{{ consent.app.name }}</p>
            <div
              v-for="scope in requestedScopes"
              :key="scope"
              class="nimbus-scope"
            >
              <div class="nimbus-scope-tick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-themed">
                  {{ scopeMetadataByScope.get(scope)?.title || scope }}
                </div>
                <div class="text-xs text-themed-muted">{{ scopeMetadataByScope.get(scope)?.description || '访问授权范围内的公共 API' }}</div>
                <div v-if="scopeMetadataByScope.get(scope)?.resources.length" class="mt-1 font-mono text-[11px] text-themed-faint">
                  {{ scopeMetadataByScope.get(scope)?.resources.join(', ') }}
                </div>
              </div>
              <span
                v-if="consent.existingScopes.includes(scope)"
                class="nimbus-scope-badge"
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

<style scoped>
.nimbus-auth {
  position: relative;
  overflow: hidden;
}

.nimbus-aurora {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.nimbus-aurora::before {
  content: '';
  position: absolute;
  top: -22%;
  left: 50%;
  width: min(760px, 128vw);
  height: min(760px, 128vw);
  transform: translateX(-50%);
  background: radial-gradient(circle, color-mix(in srgb, var(--kawaii-primary) 22%, transparent), transparent 62%);
  opacity: 0.5;
}

.nimbus-aurora::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(color-mix(in srgb, var(--kawaii-text) 9%, transparent) 1px, transparent 1px);
  background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse 78% 52% at 50% 0%, #000 0%, transparent 70%);
  mask-image: radial-gradient(ellipse 78% 52% at 50% 0%, #000 0%, transparent 70%);
  opacity: 0.45;
}

.nimbus-card {
  border-radius: 16px;
  padding: 1.75rem;
}

@media (min-width: 640px) {
  .nimbus-card {
    padding: 2rem;
  }
}

.nimbus-consent-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  margin: 0 auto;
}

.nimbus-consent-icon svg {
  width: 26px;
  height: 26px;
}

.nimbus-consent-icon--app {
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 22%, transparent);
  margin-bottom: 0.85rem;
}

.nimbus-consent-icon--warn {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.nimbus-consent-hint {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  color: color-mix(in srgb, var(--warning) 82%, var(--kawaii-text));
  padding: 0.6rem 0.75rem;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.nimbus-consent-section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.nimbus-scope {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  padding: 0.75rem 0.85rem;
}

.nimbus-scope-tick {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 14%, transparent);
}

.nimbus-scope-tick svg {
  width: 13px;
  height: 13px;
}

.nimbus-scope-badge {
  flex-shrink: 0;
  align-self: center;
  border-radius: 9999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

@media (prefers-reduced-motion: no-preference) {
  .nimbus-consent-icon--app {
    animation: nimbus-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes nimbus-pop {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
