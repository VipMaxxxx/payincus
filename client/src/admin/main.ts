import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from '../router/admin'
import i18n, { getLocale } from '../locales'
import App from './AdminApp.vue'
import clientPackage from '../../package.json'
import { installStaleAssetRecovery, isStaleAssetLoadError, scheduleStaleAssetReload } from '../utils/staleAssetRecovery'
import '../styles/main.css'
import 'flag-icons/css/flag-icons.min.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(i18n)

document.documentElement.lang = getLocale()
installStaleAssetRecovery()

app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue应用错误:', err, info)
  if (isStaleAssetLoadError(err)) {
    scheduleStaleAssetReload('admin-vue-error-handler', err)
    return
  }
}

import { useThemeStore } from '../stores/theme'
const themeStore = useThemeStore()
themeStore.init()

import { useConfigStore } from '../stores/config'
const configStore = useConfigStore()
configStore.loadPublicConfig().then(() => {
  const logoUrl = configStore.brandLogoUrl?.trim() || '/incudal_logo.webp'
  const icon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null
  const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null
  if (icon) {
    icon.href = logoUrl
  }
  if (appleTouchIcon) {
    appleTouchIcon.href = logoUrl
  }
})

app.mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const serviceWorkerUrl = `/sw.js?v=${encodeURIComponent(clientPackage.version)}`
  let refreshingForNewWorker = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingForNewWorker) return
    refreshingForNewWorker = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' })
      .then(registration => {
        console.log('Service Worker 注册成功:', registration.scope)

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('有新版本可用，正在刷新页面')
              }
            })
          }
        })
      })
      .catch(error => {
        console.warn('Service Worker 注册失败:', error)
      })
  })
}
