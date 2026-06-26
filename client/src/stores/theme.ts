/**
 * 主题管理 Store
 * 支持浅色/深色/跟随系统模式
 */
import { defineStore } from 'pinia'
import { ref, watch, computed, type Ref } from 'vue'
import { buildApiUrl } from '@/utils/api-url'

type ThemeMode = 'light' | 'dark' | 'system'
const ACTIVE_THEME_LINK_ID = 'payincus-active-theme-css'

export const useThemeStore = defineStore('theme', () => {
  // 主题模式: 'light' | 'dark' | 'system'
  const mode: Ref<ThemeMode> = ref((localStorage.getItem('theme') as ThemeMode) || 'system')
  const activeThemeId = ref<string | null>(null)
  const activeThemeCssUrl = ref<string | null>(null)
  const activeThemeTemplateUrls = ref<Record<string, { title: string; url: string }>>({})

  // 实际应用的主题
  const resolvedTheme = computed(() => {
    if (mode.value === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return mode.value
  })

  // 是否为深色主题
  const isDark = computed(() => resolvedTheme.value === 'dark')

  // 将主题应用到 DOM
  function applyTheme() {
    const theme = resolvedTheme.value
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)

    // 更新 meta 主题色
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff')
    }
  }

  function normalizeAssetUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('/api/')) return url
    return buildApiUrl(url)
  }

  function removeActiveThemeLink() {
    const existing = document.getElementById(ACTIVE_THEME_LINK_ID)
    if (existing?.parentNode) existing.parentNode.removeChild(existing)
    activeThemeId.value = null
    activeThemeCssUrl.value = null
    activeThemeTemplateUrls.value = {}
  }

  function applyActiveThemeLink(cssUrl: string) {
    const href = normalizeAssetUrl(cssUrl)
    let link = document.getElementById(ACTIVE_THEME_LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = ACTIVE_THEME_LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== new URL(href, window.location.origin).href) {
      link.href = href
    }
    activeThemeCssUrl.value = href
  }

  async function loadActiveTheme() {
    try {
      const response = await fetch(buildApiUrl('/themes/active'), {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      })
      if (!response.ok) {
        removeActiveThemeLink()
        return
      }
      const data = await response.json() as { theme?: { themeId?: string; cssUrl?: string; templateUrls?: Record<string, { title: string; url: string }> } | null }
      if (!data.theme?.themeId || !data.theme.cssUrl) {
        removeActiveThemeLink()
        return
      }
      activeThemeId.value = data.theme.themeId
      activeThemeTemplateUrls.value = data.theme.templateUrls || {}
      applyActiveThemeLink(data.theme.cssUrl)
    } catch {
      removeActiveThemeLink()
    }
  }

  function getActiveThemeTemplateUrl(slot: string): string | null {
    const template = activeThemeTemplateUrls.value[slot]
    return template?.url ? normalizeAssetUrl(template.url) : null
  }

  // 设置主题模式
  function setTheme(newMode: ThemeMode) {
    mode.value = newMode
    localStorage.setItem('theme', newMode)
    applyTheme()
  }

  // 切换主题 (dark -> light -> system -> dark)
  function toggleTheme() {
    const modes: ThemeMode[] = ['dark', 'light', 'system']
    const currentIndex = modes.indexOf(mode.value)
    const nextIndex = (currentIndex + 1) % modes.length
    setTheme(modes[nextIndex])
  }

  // 监听系统主题变化
  function setupSystemThemeListener() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      if (mode.value === 'system') {
        applyTheme()
      }
    })
  }

  // 初始化
  function init() {
    applyTheme()
    setupSystemThemeListener()
    void loadActiveTheme()
  }

  // 监听模式变化
  watch(mode, applyTheme)

  return {
    mode,
    resolvedTheme,
    isDark,
    activeThemeId,
    activeThemeCssUrl,
    activeThemeTemplateUrls,
    setTheme,
    toggleTheme,
    loadActiveTheme,
    getActiveThemeTemplateUrl,
    init
  }
})
