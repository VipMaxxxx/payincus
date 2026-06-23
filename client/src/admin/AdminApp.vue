<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import AppLayout from '@/components/layout/AppLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { buildApiUrl } from '@/utils/api-url'

const route = useRoute()
const authStore = useAuthStore()
const configStore = useConfigStore()
const { t, locale } = useI18n()

const adminLoginPath = '/admin/login'
const noLayoutRoutes: string[] = ['login']
const showLayout = computed<boolean>(() => {
  return authStore.isAuthenticated && !noLayoutRoutes.includes(route.name as string)
})

watchEffect(() => {
  locale.value
  configStore.brandName
  configStore.brandSubtitle

  const titleKey = route.meta.titleKey
  const fallbackTitle = route.meta.title
  const translatedTitle = titleKey ? t(titleKey) : ''
  const pageTitle = translatedTitle && translatedTitle !== titleKey ? translatedTitle : fallbackTitle

  const brandName = configStore.brandName?.trim() || 'Incudal'
  document.title = pageTitle ? `${brandName} - ${pageTitle}` : `${brandName} - 管理后台`
})

let sessionCheckTimer: number | null = null
let tokenRefreshTimer: number | null = null
let lastVisibilityChange = Date.now()

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const now = Date.now()
    if (now - lastVisibilityChange > 2 * 60 * 1000 && authStore.isAuthenticated) {
      lastVisibilityChange = now
      try {
        const isValid = await authStore.checkSession()
        if (!isValid && !window.location.pathname.startsWith(adminLoginPath)) {
          window.location.href = adminLoginPath
        }
      } catch {
        console.warn('会话检查失败，可能是网络问题')
      }
    }
  } else {
    lastVisibilityChange = Date.now()
  }
}

onErrorCaptured((err, _instance, info) => {
  console.error('组件错误捕获:', err, info)
  if (err && typeof err === 'object' && 'message' in err) {
    const errorMessage = String(err.message)
    if (errorMessage.includes('Failed to fetch dynamically imported module') ||
        errorMessage.includes('Loading chunk') ||
        errorMessage.includes('ChunkLoadError')) {
      console.warn('检测到代码块加载失败，尝试重新加载页面')
      setTimeout(() => {
        window.location.reload()
      }, 1000)
      return false
    }
  }
  return true
})

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)

  tokenRefreshTimer = window.setInterval(async () => {
    if (authStore.isAuthenticated) {
      try {
        const response = await fetch(buildApiUrl('/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        })
        if (response.ok) {
          const data = await response.json()
          if (data.token) {
            localStorage.setItem('token', data.token)
            authStore.syncToken()
          }
        }
      } catch {
        console.warn('定时 token 刷新失败')
      }
    }
  }, 6 * 24 * 60 * 60 * 1000)

  sessionCheckTimer = window.setInterval(async () => {
    if (authStore.isAuthenticated && document.visibilityState === 'visible') {
      try {
        const isValid = await authStore.checkSession()
        if (!isValid && !window.location.pathname.startsWith(adminLoginPath)) {
          window.location.href = adminLoginPath
        }
      } catch {
        console.warn('定时会话检查失败，等待下次检查')
      }
    }
  }, 60 * 60 * 1000)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (sessionCheckTimer !== null) {
    clearInterval(sessionCheckTimer)
  }
  if (tokenRefreshTimer !== null) {
    clearInterval(tokenRefreshTimer)
  }
})
</script>

<template>
  <AppLayout v-if="showLayout">
    <RouterView v-slot="{ Component, route: currentRoute }">
      <template v-if="Component">
        <KeepAlive :exclude="['AdminInstanceCreateView', 'MyHostDetailView', 'PackageFormView']" :max="10">
          <component :is="Component" :key="currentRoute.name" />
        </KeepAlive>
      </template>
    </RouterView>
  </AppLayout>
  <RouterView v-else v-slot="{ Component, route: currentRoute }">
    <template v-if="Component">
      <component :is="Component" :key="currentRoute.name" />
    </template>
  </RouterView>
  <ToastContainer />
</template>
