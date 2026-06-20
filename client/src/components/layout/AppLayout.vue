<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useInboxStore } from '@/stores/inbox'
import { supportedLocales, setLocale, type Locale } from '@/locales'
import { useBrand } from '@/composables/useBrand'
import SideNav from './SideNav.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import NotificationBell from '@/components/NotificationBell.vue'

const router = useRouter()
const route = useRoute()
const { locale } = useI18n()

// 分栏布局页面：左栏独立滚动，右栏固定
const isSplitPane = computed(() => route.name === 'instance-create')
const authStore = useAuthStore()
const themeStore = useThemeStore()
const inboxStore = useInboxStore()
const brand = useBrand()
const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)
const sidebarCollapsed = ref<boolean>(false)
const mobileMenuOpen = ref<boolean>(false)
const userMenuOpen = ref<boolean>(false)
const userMenuRef = ref<HTMLElement | null>(null)

async function handleLogout(): Promise<void> {
  userMenuOpen.value = false
  inboxStore.stopPolling()
  await authStore.logout()
  router.push('/login')
}

const { t } = useI18n()

function getThemeTooltip(): string {
  switch (themeStore.mode) {
    case 'dark': return t('theme.dark')
    case 'light': return t('theme.light')
    default: return t('theme.system')
  }
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
}

function navigateTo(path: string) {
  router.push(path)
  userMenuOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target as Node)) {
    userMenuOpen.value = false
  }
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) {
    langMenuOpen.value = false
  }
}

function toggleLangMenu() {
  langMenuOpen.value = !langMenuOpen.value
}

function changeLocale(code: Locale) {
  setLocale(code)
  langMenuOpen.value = false
}

function getCurrentLocaleShort(): string {
  switch (locale.value) {
    case 'zh-CN':
      return '简'
    case 'zh-TW':
      return '繁'
    case 'en':
    default:
      return 'EN'
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  // 启动站内信轮询
  inboxStore.startPolling()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="h-screen flex overflow-hidden" :class="themeStore.isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'">
    <!-- 侧边导航 -->
    <SideNav 
      :collapsed="sidebarCollapsed" 
      :mobile-open="mobileMenuOpen"
      @close-mobile="closeMobileMenu"
    />

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col min-w-0 h-full">
      <!-- 顶部栏 -->
      <header class="h-14 flex items-center justify-between px-4 md:px-6 border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200 bg-white'">
        <div class="flex items-center gap-2 md:gap-4">
          <!-- Mobile: Hamburger menu -->
          <button 
            class="md:hidden p-1.5 rounded transition-colors touch-target"
            :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
            :aria-label="t('nav.openMenu')"
            @click="toggleMobileMenu"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <!-- Desktop: Toggle sidebar -->
          <button 
            class="hidden md:block p-1.5 rounded transition-colors"
            :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
            :aria-label="t('nav.collapseSidebar')"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <!-- Mobile: Logo -->
          <div class="md:hidden flex items-center gap-2">
            <img 
              :src="brand.brandLogoUrl"
              :alt="brand.brandName"
              class="w-6 h-6 rounded flex-shrink-0"
            />
            <span 
              class="font-semibold text-sm"
              :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
            >{{ brand.brandName }}</span>
          </div>
        </div>

        <!-- 右侧菜单 -->
        <div class="flex items-center gap-2 md:gap-3">
          <!-- 终端管理入口 -->
          <button
            class="p-1.5 rounded transition-colors touch-target"
            :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
            :title="t('nav.terminal')"
            :aria-label="t('nav.terminal')"
            @click="router.push('/terminal')"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

          <!-- 站内信铃铛 -->
          <NotificationBell />

          <!-- 主题切换按钮 -->
          <button
            class="theme-toggle relative group p-1.5 rounded transition-colors touch-target"
            :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
            :title="getThemeTooltip()"
            :aria-label="t('nav.toggleTheme')"
            @click="themeStore.toggleTheme"
          >
            <!-- 深色图标 (月亮) -->
            <svg 
              v-if="themeStore.mode === 'dark'" 
              class="w-5 h-5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <!-- 浅色图标 (太阳) -->
            <svg 
              v-else-if="themeStore.mode === 'light'" 
              class="w-5 h-5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <!-- 系统图标 (显示器) -->
            <svg 
              v-else 
              class="w-5 h-5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            
            <!-- 悬停提示 (Desktop only) -->
            <span 
              class="hidden md:block absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700 border border-gray-200'"
            >
              {{ getThemeTooltip() }}
            </span>
          </button>

          <!-- 语言切换 -->
          <div ref="langMenuRef" class="relative">
            <button
              class="relative group px-2 py-1.5 rounded transition-colors touch-target text-xs font-medium"
              :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
              :title="$t('language.' + (locale === 'zh-CN' ? 'zh' : 'en'))"
              :aria-label="t('nav.toggleLanguage')"
              @click.stop="toggleLangMenu"
            >
              {{ getCurrentLocaleShort() }}
            </button>

            <!-- 语言下拉菜单 -->
            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div 
                v-if="langMenuOpen"
                class="absolute right-0 mt-2 w-36 rounded-lg shadow-lg py-1 z-50 border"
                :class="themeStore.isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'"
              >
                <button
                  v-for="lang in supportedLocales"
                  :key="lang.code"
                  class="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors"
                  :class="[
                    locale === lang.code 
                      ? (themeStore.isDark ? 'bg-gray-800 text-gray-100' : 'bg-gray-100 text-gray-900')
                      : (themeStore.isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')
                  ]"
                  @click="changeLocale(lang.code)"
                >
                  {{ lang.name }}
                  <svg v-if="locale === lang.code" class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </Transition>
          </div>

          <!-- 用户菜单 -->
          <div ref="userMenuRef" class="relative">
            <button 
              class="flex items-center gap-2 px-2 py-1 rounded transition-colors cursor-pointer"
              :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
              @click.stop="toggleUserMenu"
            >
              <UserAvatar 
                :username="authStore.user?.username || ''" 
                :email="authStore.user?.email"
                :avatar-style="authStore.user?.avatarStyle || 'bigSmile'"
                :size="28"
              />
              <span class="hidden sm:block text-sm" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ authStore.user?.username }}</span>
              <svg class="hidden sm:block w-4 h-4 transition-transform" :class="[themeStore.isDark ? 'text-gray-500' : 'text-gray-400', userMenuOpen ? 'rotate-180' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            <!-- 下拉菜单 -->
            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div 
                v-if="userMenuOpen"
                class="absolute right-0 mt-2 w-48 rounded-lg shadow-lg py-1 z-50 border"
                :class="themeStore.isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'"
              >
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                  :class="themeStore.isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'"
                  @click="navigateTo('/profile')"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {{ $t('userMenu.profile') }}
                </button>
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                  :class="themeStore.isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'"
                  @click="navigateTo('/instances')"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                  </svg>
                  {{ $t('userMenu.myInstances') }}
                </button>
                <div class="my-1 border-t" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'"></div>
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                  :class="themeStore.isDark ? 'text-red-400 hover:bg-gray-800' : 'text-red-600 hover:bg-gray-100'"
                  @click="handleLogout"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {{ $t('userMenu.logout') }}
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </header>

      <!-- 页面内容 -->
      <main class="flex-1 p-4 md:p-6 xl:px-14 2xl:px-24" :class="isSplitPane ? 'overflow-auto lg:overflow-hidden' : 'overflow-auto'">
        <div class="w-full mx-auto" :class="isSplitPane ? 'lg:h-full' : ''">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
