<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import AppLayout from '@/components/layout/AppLayout.vue'
import RouteErrorBoundary from '@/components/RouteErrorBoundary.vue'
import PublicSiteLayout from '@/components/public/PublicSiteLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import PopupAnnouncementModal from '@/components/PopupAnnouncementModal.vue'
import { buildApiUrl } from '@/utils/api-url'
import { isStaleAssetLoadError, scheduleStaleAssetReload } from '@/utils/staleAssetRecovery'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const configStore = useConfigStore()
const { t, locale } = useI18n()
const hiddenHostingRouteNames = new Set([
  'my-hosts',
  'my-host-create',
  'my-host-detail',
  'my-packages',
  'my-package-create',
  'my-package-edit',
  'hosting-wallet'
])

// 不需要布局的页面
const noLayoutRoutes: string[] = ['login', 'register', 'forgot-password']
const publicSiteRouteNames = new Set(['portal', 'market', 'help', 'help-article'])
const showLayout = computed<boolean>(() => {
  return authStore.isAuthenticated && !noLayoutRoutes.includes(route.name as string) && !showPublicSiteLayout.value
})
const showPublicSiteLayout = computed<boolean>(() => {
  return typeof route.name === 'string' && publicSiteRouteNames.has(route.name)
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
  const brandSubtitle = configStore.brandSubtitle?.trim() || t('common.defaultBrandSubtitle')
  document.title = pageTitle ? `${brandName} - ${pageTitle}` : `${brandName} - ${brandSubtitle}`
})

// 检查会话是否有效
let sessionCheckTimer: number | null = null
let tokenRefreshTimer: number | null = null
let lastVisibilityChange = Date.now()

async function redirectIfHostingEntryHidden() {
  if (
    !authStore.isAdmin &&
    typeof route.name === 'string' &&
    hiddenHostingRouteNames.has(route.name) &&
    authStore.user?.canAccessHostingFeature === false
  ) {
    await router.replace({ name: 'dashboard' })
  }
}

async function handleVisibilityChange() {
  // 如果页面从隐藏变为可见，且距离上次检查超过2分钟，则检查会话
  // 放宽检测间隔，避免频繁跳转登录页
  if (document.visibilityState === 'visible') {
    const now = Date.now()
    // 从5秒放宽到2分钟
    if (now - lastVisibilityChange > 2 * 60 * 1000 && authStore.isAuthenticated) {
      lastVisibilityChange = now
      // 使用 try-catch 防止网络错误导致跳转
      try {
        const isValid = await authStore.checkSession()
        if (!isValid && !noLayoutRoutes.some(name => route.name === name)) {
          // 会话已过期，跳转到登录页
          window.location.href = '/login'
        } else if (isValid) {
          await redirectIfHostingEntryHidden()
        }
      } catch {
        // 网络错误不跳转，继续使用当前状态
        console.warn('会话检查失败，可能是网络问题')
      }
    }
  } else {
    lastVisibilityChange = Date.now()
  }
}

// 捕获子组件错误
onErrorCaptured((err, _instance, info) => {
  console.error('组件错误捕获:', err, info)
  // 如果是chunk加载错误，尝试重新加载
  if (isStaleAssetLoadError(err)) {
    scheduleStaleAssetReload('app-error-captured', err)
    return false // 阻止错误继续传播
  }
  return true // 允许错误继续传播到全局错误处理
})

onMounted(() => {
  // OAuth 登录码处理已移至路由守卫中，确保在路由判断前完成
  
  // 监听页面可见性变化
  document.addEventListener('visibilitychange', handleVisibilityChange)
  
  // 定时刷新 token（简化版：每 6 天刷新一次，token 7 天有效期）
  tokenRefreshTimer = window.setInterval(async () => {
    if (authStore.isAuthenticated) {
      try {
        // 定时刷新加 15 秒超时兜底：/auth/refresh 挂起时不会长期占用连接或悬挂 Promise
        const refreshController = new AbortController()
        const refreshTimeoutId = setTimeout(() => refreshController.abort(), 15_000)
        let response: Response
        try {
          response = await fetch(buildApiUrl('/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            signal: refreshController.signal
          })
        } finally {
          clearTimeout(refreshTimeoutId)
        }
        if (response.ok) {
          const data = await response.json()
          if (data.token) {
            localStorage.setItem('token', data.token)
            authStore.syncToken()
          }
        }
      } catch {
        // 刷新失败（含超时中止）时不处理，等待下次刷新或请求时的自动刷新
        console.warn('定时 token 刷新失败')
      }
    }
  }, 6 * 24 * 60 * 60 * 1000) // 6 天
  
  // 定期检查会话（简化版：每1小时检查一次）
  sessionCheckTimer = window.setInterval(async () => {
    if (authStore.isAuthenticated && document.visibilityState === 'visible') {
      try {
        const isValid = await authStore.checkSession()
        if (!isValid && !noLayoutRoutes.some(name => route.name === name)) {
          // 会话已过期，跳转到登录页
          window.location.href = '/login'
        } else if (isValid) {
          await redirectIfHostingEntryHidden()
        }
      } catch {
        // 网络错误不处理，等待下次检查
        console.warn('定时会话检查失败，等待下次检查')
      }
    }
  }, 60 * 60 * 1000) // 1 小时
})

onUnmounted(() => {
  // 清理事件监听和定时器
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
    <RouteErrorBoundary>
      <RouterView v-slot="{ Component, route: currentRoute }">
        <template v-if="Component">
          <Transition name="kawaii-route">
            <!-- 使用 exclude 排除不需要缓存的页面，避免 include 匹配问题 -->
            <KeepAlive :exclude="['InstancesView', 'InstanceCreateView', 'InstanceDetailView', 'PackageFormView', 'MyHostDetailView']" :max="10">
              <component :is="Component" :key="currentRoute.name" />
            </KeepAlive>
          </Transition>
        </template>
      </RouterView>
    </RouteErrorBoundary>
  </AppLayout>
  <PublicSiteLayout v-else-if="showPublicSiteLayout">
    <RouterView v-slot="{ Component, route: currentRoute }">
      <template v-if="Component">
        <Transition name="kawaii-route" mode="out-in">
          <component :is="Component" :key="currentRoute.name" />
        </Transition>
      </template>
    </RouterView>
  </PublicSiteLayout>
  <RouterView v-else v-slot="{ Component, route: currentRoute }">
    <template v-if="Component">
      <Transition name="kawaii-route" mode="out-in">
        <component :is="Component" :key="currentRoute.name" />
      </Transition>
    </template>
  </RouterView>
  <PopupAnnouncementModal />
  <ToastContainer />
</template>
