import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import i18n, { getLocale } from './locales'
import App from './App.vue'
import './styles/main.css'
import 'flag-icons/css/flag-icons.min.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(i18n)

document.documentElement.lang = getLocale()

// 全局错误处理
app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue应用错误:', err, info)
  // 如果是组件加载错误，尝试重新加载页面
  if (err && typeof err === 'object' && 'message' in err) {
    const errorMessage = String(err.message)
    if (errorMessage.includes('Failed to fetch dynamically imported module') ||
        errorMessage.includes('Loading chunk') ||
        errorMessage.includes('ChunkLoadError')) {
      console.warn('检测到代码块加载失败，尝试重新加载页面')
      setTimeout(() => {
        window.location.reload()
      }, 1000)
      return
    }
  }
}

// Initialize theme (after pinia is mounted)
import { useThemeStore } from './stores/theme'
const themeStore = useThemeStore()
themeStore.init()

// Load public config
import { useConfigStore } from './stores/config'
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

// 注册 Service Worker（仅生产环境）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker 注册成功:', registration.scope)
        
        // 检测更新
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('有新版本可用，刷新页面后生效')
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
