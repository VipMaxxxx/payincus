<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useBrand } from '@/composables/useBrand'

const { t } = useI18n()

interface Props {
  collapsed?: boolean
  mobileOpen?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:mobileOpen': [value: boolean]
  closeMobile: []
}>()

interface MenuItem {
  name?: string
  path?: string
  icon?: string
  label?: string
  divider?: boolean
}

const route = useRoute()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const brand = useBrand()
void configStore.loadPublicConfig()

const footerEmailHref = computed(() => {
  const email = configStore.footerContactEmail?.trim()
  if (!email) return null
  return email.startsWith('mailto:') ? email : `mailto:${email}`
})

const footerTelegramLink = computed(() => {
  const link = configStore.footerTelegramLink?.trim()
  return link || null
})

const hiddenExpandMenuNames = new Set(['my-hosts', 'my-packages', 'hosting-wallet'])
const hiddenWhenTicketDisabledMenuNames = new Set(['tickets'])
const hiddenWhenMailUnavailableMenuNames = new Set(['mail'])
const shouldHideHostingFeature = computed(() =>
  !authStore.isAdmin && authStore.user?.canAccessHostingFeature === false
)

// 普通用户菜单
const userMenuItems: MenuItem[] = [
  { divider: true, label: 'nav.main' },
  { name: 'dashboard', path: '/dashboard', icon: 'home', label: 'nav.dashboard' },
  { name: 'instances', path: '/instances', icon: 'server', label: 'nav.instances' },
  { name: 'mail', path: '/mail', icon: 'mail', label: 'nav.mail' },
  { name: 'terminal', path: '/terminal', icon: 'terminal', label: 'nav.terminal' },
  { name: 'extensions', path: '/extensions', icon: 'puzzle', label: 'nav.scripts' },
  { name: 'transfers', path: '/transfers', icon: 'transfer', label: 'nav.transfers' },
  { name: 'tickets', path: '/tickets', icon: 'ticket', label: 'nav.tickets' },
  { name: 'entertainment', path: '/entertainment', icon: 'gift', label: 'nav.entertainment' },
  { name: 'wallet', path: '/wallet', icon: 'wallet', label: 'nav.wallet' },
  { name: 'invites', path: '/invites', icon: 'key', label: 'nav.invites' },
  { divider: true, label: 'nav.expand' },
  { name: 'my-hosts', path: '/resources/hosts', icon: 'database', label: 'nav.hosts' },
  { name: 'my-packages', path: '/resources/packages', icon: 'package', label: 'nav.packages' },
  { name: 'hosting-wallet', path: '/hosting-wallet', icon: 'coin', label: 'nav.earnings' },
  { divider: true, label: 'nav.system' },
  { name: 'profile', path: '/profile', icon: 'settings', label: 'nav.settings' },
  { name: 'help', path: '/help', icon: 'help', label: 'nav.help' },
  { name: 'logs', path: '/logs', icon: 'logs', label: 'nav.logs' }
]

// 管理员专用菜单（包含节点/套餐管理）
const adminOnlyMenuItems: MenuItem[] = [
  { divider: true, label: 'nav.admin' },
  { name: 'admin-settings', path: '/admin/settings', icon: 'cog', label: 'nav.system' },
  { name: 'admin-users', path: '/admin/users', icon: 'users', label: 'nav.users' },
  { name: 'admin-hosting', path: '/admin/hosting', icon: 'coin', label: 'nav.hosting' },
  { divider: true, label: 'nav.resources' },
  { name: 'my-hosts', path: '/resources/hosts', icon: 'database', label: 'nav.hosts' },
  { name: 'my-packages', path: '/resources/packages', icon: 'package', label: 'nav.packages' },
  { name: 'admin-images', path: '/admin/images', icon: 'image', label: 'nav.images' },
  { name: 'admin-instance-create', path: '/admin/instances/create', icon: 'gift', label: 'nav.create' },
  { name: 'admin-mail', path: '/admin/mail', icon: 'mail', label: 'nav.mail' },
  { divider: true, label: 'nav.operations' },
  { name: 'tickets', path: '/tickets', icon: 'ticket', label: 'nav.tickets' },
  { name: 'admin-billing', path: '/admin/billing', icon: 'wallet', label: 'nav.billing' },
  { name: 'admin-broadcast', path: '/admin/broadcast', icon: 'bell', label: 'nav.broadcast' },
  { name: 'admin-logs', path: '/logs', icon: 'logs', label: 'nav.logs' },
  { name: 'admin-help', path: '/admin/help', icon: 'book', label: 'nav.helpManage' },
  { name: 'admin-entertainment', path: '/admin/entertainment', icon: 'gift', label: 'nav.entertainment' },
  { name: 'profile', path: '/profile', icon: 'settings', label: 'nav.settings' },
  { name: 'admin-statistics', path: '/admin/statistics', icon: 'chart', label: 'nav.statistics' },
  { name: 'admin-oauth', path: '/admin/oauth', icon: 'key', label: 'nav.oauth' }
]

const menuItems = computed<MenuItem[]>(() => {
  let baseItems = authStore.isAdmin ? adminOnlyMenuItems : userMenuItems

  if (!authStore.isAdmin && !configStore.ticketEnabled) {
    baseItems = baseItems.filter(item => !item.name || !hiddenWhenTicketDisabledMenuNames.has(item.name))
  }

  if (!authStore.isAdmin && !configStore.mailAvailable) {
    baseItems = baseItems.filter(item => !item.name || !hiddenWhenMailUnavailableMenuNames.has(item.name))
  }

  if (!shouldHideHostingFeature.value) {
    return baseItems
  }

  return baseItems.filter(item => {
    if (item.divider && item.label === 'nav.expand') {
      return false
    }

    return !item.name || !hiddenExpandMenuNames.has(item.name)
  })
})

function isActive(item: MenuItem): boolean {
  if (item.name === 'dashboard') return route.path === '/dashboard'
  if (!item.path) return false
  return route.path.startsWith(item.path)
}

function handleLinkClick() {
  // 点击链接时关闭移动端抽屉
  if (props.mobileOpen) {
    emit('closeMobile')
  }
}
</script>

<template>
  <!-- Mobile: Backdrop -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div 
        v-if="mobileOpen"
        class="fixed inset-0 bg-black/50 z-40 md:hidden"
        @click="emit('closeMobile')"
      ></div>
    </Transition>
  </Teleport>

  <!-- Sidebar -->
  <aside 
    :class="[
      'flex flex-col min-h-full transition-all duration-200 border-r z-50',
      // 移动端：mobileOpen 为 true 时显示，否则隐藏
      // 桌面端：始终显示 (md:flex)
      mobileOpen ? 'flex' : 'hidden md:flex',
      // 宽度
      collapsed ? 'md:w-16' : 'md:w-56',
      'w-56', // 移动端全宽
      // 位置
      'md:relative fixed inset-y-0 left-0',
      // 滑动动画的 transform
      mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      // 主题颜色
      themeStore.isDark ? 'border-gray-800 bg-gray-950' : 'border-gray-200 bg-white'
    ]"
  >
    <!-- Logo -->
    <div 
      class="h-14 flex items-center border-b"
      :class="[
        themeStore.isDark ? 'border-gray-800' : 'border-gray-200',
        collapsed && !mobileOpen ? 'justify-center px-2' : 'px-4'
      ]"
    >
      <RouterLink to="/" class="flex items-center gap-2.5" @click="handleLinkClick">
        <img
          :src="brand.brandLogoUrl"
          :alt="brand.brandName"
          class="w-7 h-7 rounded flex-shrink-0"
        />
        <span 
          v-if="!collapsed || mobileOpen" 
          class="font-semibold text-sm"
          :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
        >{{ brand.brandName }}</span>
      </RouterLink>
    </div>

    <!-- 导航菜单 -->
    <nav class="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
      <template v-for="item in menuItems" :key="item.name || item.label">
        <!-- 分隔线 -->
        <div v-if="item.divider" class="pt-3 pb-2">
          <div 
            v-if="!collapsed || mobileOpen" 
            class="px-2 text-2xs font-medium uppercase tracking-wider"
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
          >
            {{ t(item.label || '') }}
          </div>
          <div 
            v-else 
            class="mx-2"
            :class="themeStore.isDark ? 'border-t border-gray-800' : 'border-t border-gray-200'"
          ></div>
        </div>

        <!-- 菜单项 -->
        <RouterLink
          v-else
          :to="item.path || '/'"
          :class="[
            'flex items-center py-1.5 rounded text-sm transition-colors',
            collapsed && !mobileOpen ? 'justify-center px-0' : 'gap-2.5 px-2',
            isActive(item) 
              ? (themeStore.isDark ? 'bg-gray-800 text-gray-100' : 'bg-gray-100 text-gray-900')
              : (themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-900' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100')
          ]"
          @click="handleLinkClick"
        >
          <!-- Icons -->
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path
              v-if="item.icon === 'home'" stroke-linecap="round" stroke-linejoin="round" 
              d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
            />
            <path
              v-else-if="item.icon === 'server'" stroke-linecap="round" stroke-linejoin="round" 
              d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
            />
            <path
              v-else-if="item.icon === 'settings'" stroke-linecap="round" stroke-linejoin="round" 
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              v-else-if="item.icon === 'users'" stroke-linecap="round" stroke-linejoin="round" 
              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
            />
            <path
              v-else-if="item.icon === 'database'" stroke-linecap="round" stroke-linejoin="round" 
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
            />
            <path
              v-else-if="item.icon === 'package'" stroke-linecap="round" stroke-linejoin="round" 
              d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
            />
            <path
              v-else-if="item.icon === 'key'" stroke-linecap="round" stroke-linejoin="round" 
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
            <path
              v-else-if="item.icon === 'image'" stroke-linecap="round" stroke-linejoin="round" 
              d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
            <path
              v-else-if="item.icon === 'folder'" stroke-linecap="round" stroke-linejoin="round" 
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
            <path
              v-else-if="item.icon === 'book'" stroke-linecap="round" stroke-linejoin="round" 
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
            <path
              v-else-if="item.icon === 'help'" stroke-linecap="round" stroke-linejoin="round" 
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
            />
            <path
              v-else-if="item.icon === 'bell'" stroke-linecap="round" stroke-linejoin="round" 
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
            <path
              v-else-if="item.icon === 'logs'" stroke-linecap="round" stroke-linejoin="round" 
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
            <path
              v-else-if="item.icon === 'chart'" stroke-linecap="round" stroke-linejoin="round" 
              d="M4 19h16M7 15.5V10m5 5.5V6m5 9.5v-3M6 7.5 10 10l4-5 4 2"
            />
            <path
              v-else-if="item.icon === 'transfer'" stroke-linecap="round" stroke-linejoin="round" 
              d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
            />
            <path
              v-else-if="item.icon === 'terminal'" stroke-linecap="round" stroke-linejoin="round" 
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
            />
            <path
              v-else-if="item.icon === 'friends'" stroke-linecap="round" stroke-linejoin="round" 
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            />
            <path
              v-else-if="item.icon === 'puzzle'" stroke-linecap="round" stroke-linejoin="round" 
              d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"
            />
            <path
              v-else-if="item.icon === 'ticket'" stroke-linecap="round" stroke-linejoin="round" 
              d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z"
            />
            <path
              v-else-if="item.icon === 'card'" stroke-linecap="round" stroke-linejoin="round" 
              d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
            />
            <path
              v-else-if="item.icon === 'wallet'" stroke-linecap="round" stroke-linejoin="round" 
              d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
            />
            <path
              v-else-if="item.icon === 'coin'" stroke-linecap="round" stroke-linejoin="round" 
              d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <path
              v-else-if="item.icon === 'gift'" stroke-linecap="round" stroke-linejoin="round" 
              d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H4.5a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
            <path
              v-else-if="item.icon === 'mail'" stroke-linecap="round" stroke-linejoin="round" 
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
            <path
              v-else-if="item.icon === 'sparkles'" stroke-linecap="round" stroke-linejoin="round" 
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
            <path
              v-else-if="item.icon === 'cog'" stroke-linecap="round" stroke-linejoin="round" 
              d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"
            />
            <path
              v-if="item.icon === 'cog'" stroke-linecap="round" stroke-linejoin="round" 
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span v-if="!collapsed || mobileOpen" class="truncate">{{ t(item.label || '') }}</span>
        </RouterLink>
      </template>
    </nav>

    <!-- 底部 -->
    <div 
      v-if="!collapsed || mobileOpen" 
      class="px-4 py-3 border-t flex items-center justify-between"
      :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
    >
      <div class="text-2xs" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">{{ brand.brandName }}</div>
      <div class="flex items-center gap-2">
        <!-- 邮箱链接 -->
        <a 
          v-if="footerEmailHref"
          :href="footerEmailHref"
          class="p-1 rounded transition-colors"
          :class="themeStore.isDark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'"
          title="Email"
          @click="handleLinkClick"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </a>
        <!-- Telegram 链接 -->
        <a 
          v-if="footerTelegramLink"
          :href="footerTelegramLink"
          target="_blank" 
          rel="noopener noreferrer"
          class="p-1 rounded transition-colors"
          :class="themeStore.isDark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'"
          title="Telegram"
          @click="handleLinkClick"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
      </div>
    </div>
  </aside>
</template>
