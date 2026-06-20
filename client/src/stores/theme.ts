/**
 * 主题管理 Store
 * 支持浅色/深色/跟随系统模式
 */
import { defineStore } from 'pinia'
import { ref, watch, computed, type Ref } from 'vue'

type ThemeMode = 'light' | 'dark' | 'system'

export const useThemeStore = defineStore('theme', () => {
  // 主题模式: 'light' | 'dark' | 'system'
  const mode: Ref<ThemeMode> = ref((localStorage.getItem('theme') as ThemeMode) || 'system')

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
  }

  // 监听模式变化
  watch(mode, applyTheme)

  return {
    mode,
    resolvedTheme,
    isDark,
    setTheme,
    toggleTheme,
    init
  }
})

