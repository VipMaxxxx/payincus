import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import type { RouteLocationNormalized, NavigationGuardNext, RouteRecordRaw } from 'vue-router'
import api from '@/api'

// OAuth 登录码处理状态
let oauthProcessing = false
let oauthProcessed = false
const hiddenHostingRouteNames = new Set([
  'my-hosts',
  'my-host-create',
  'my-host-detail',
  'my-packages',
  'my-package-create',
  'my-package-edit',
  'hosting-wallet'
])
const hiddenMailRouteNames = new Set(['mail', 'mail-domain'])

// 处理 OAuth 登录码的函数
async function handleOAuthCode(): Promise<boolean> {
  if (oauthProcessed) return true
  
  const urlParams = new URLSearchParams(window.location.search)
  const oauthCode = urlParams.get('oauth_code')
  
  if (!oauthCode) return false
  
  // 防止重复处理
  if (oauthProcessing) {
    // 等待处理完成
    while (oauthProcessing) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return oauthProcessed
  }
  
  oauthProcessing = true
  
  try {
    const response = await api.oauth.exchangeCode(oauthCode)
    // 保存 token 到 localStorage
    localStorage.setItem('token', response.token)
    // 同步到 auth store
    const authStore = useAuthStore()
    authStore.syncToken()
    // 获取用户信息
    await authStore.fetchCurrentUser()
    
    // 清除 URL 中的 oauth_code 参数
    urlParams.delete('oauth_code')
    const newSearch = urlParams.toString()
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '')
    window.history.replaceState({}, '', newUrl)
    
    oauthProcessed = true
    return true
  } catch (err) {
    console.error('OAuth login code exchange failed:', err)
    // 清除 URL 参数，避免重复尝试
    urlParams.delete('oauth_code')
    const newSearch = urlParams.toString()
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '')
    window.history.replaceState({}, '', newUrl)
    return false
  } finally {
    oauthProcessing = false
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/register/:code?',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guest: true }
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    name: 'portal',
    component: () => import('@/views/PortalView.vue'),
    meta: { titleKey: 'publicSite.nav.overview', title: '首页' }
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.dashboard', title: '概览' }
  },
  {
    path: '/market',
    name: 'market',
    component: () => import('@/views/MarketView.vue'),
    meta: { titleKey: 'publicSite.market.title', title: '产品市场' }
  },
  {
    path: '/instances',
    name: 'instances',
    component: () => import('@/views/InstancesView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.instances', title: '实例' }
  },
  {
    path: '/instances/create',
    name: 'instance-create',
    component: () => import('@/views/InstanceCreateView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.createInstance', title: '创建实例' }
  },
  {
    path: '/instances/:id',
    name: 'instance-detail',
    component: () => import('@/views/InstanceDetailView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.instanceDetail', title: '实例详情' }
  },
  // 域名邮箱
  {
    path: '/mail',
    name: 'mail',
    component: () => import('@/views/MailView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.mail', title: '邮箱' }
  },
  {
    path: '/mail/domains/:id',
    name: 'mail-domain',
    component: () => import('@/views/MailDomainView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.mailDomain', title: '邮箱域名' }
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'auth.profile', title: '个人设置' }
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('@/views/WalletView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.wallet', title: '钱包' }
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.orders', title: '订单' }
  },
  {
    path: '/invites',
    name: 'invites',
    component: () => import('@/views/InvitesView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.invites', title: '邀请码' }
  },
  {
    path: '/gift-cards',
    name: 'gift-cards',
    component: () => import('@/views/GiftCardsView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.giftCards', title: '礼品卡' }
  },
  {
    path: '/extensions',
    name: 'extensions',
    component: () => import('@/views/ExtensionsView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.extensions', title: '扩展' }
  },
  {
    path: '/oauth/authorize',
    name: 'oauth-authorize',
    component: () => import('@/views/OAuthAuthorizeView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.oauthAuthorize', title: 'OAuth 授权' }
  },
  {
    path: '/plugins/:pathMatch(.*)*',
    name: 'plugin-page',
    component: () => import('@/views/PluginPageView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.plugins', title: '插件' }
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('@/views/LogsView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.logs', title: '日志' }
  },
  {
    path: '/transfers',
    name: 'transfers',
    component: () => import('@/views/TransfersView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.transfers', title: '转移' }
  },
  // 用户资源管理路由（开放给满足条件的用户）
  {
    path: '/resources/hosts',
    name: 'my-hosts',
    component: () => import('@/views/resources/MyHostsView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myHosts', title: '我的节点' }
  },
  {
    path: '/resources/hosts/create',
    name: 'my-host-create',
    component: () => import('@/views/resources/MyHostCreateView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myHostCreate', title: '创建节点' }
  },
  {
    path: '/resources/hosts/:id',
    name: 'my-host-detail',
    component: () => import('@/views/resources/MyHostDetailView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myHostDetail', title: '节点详情' }
  },
  {
    path: '/resources/packages',
    name: 'my-packages',
    component: () => import('@/views/resources/MyPackagesView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myPackages', title: '我的套餐' }
  },
  {
    path: '/resources/packages/create',
    name: 'my-package-create',
    component: () => import('@/views/resources/PackageFormView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myPackageCreate', title: '创建套餐' }
  },
  {
    path: '/resources/packages/:id/edit',
    name: 'my-package-edit',
    component: () => import('@/views/resources/PackageFormView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.myPackageEdit', title: '编辑套餐' }
  },
  // 托管余额页面
  {
    path: '/hosting-wallet',
    name: 'hosting-wallet',
    component: () => import('@/views/HostingWalletView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.hostingWallet', title: '托管收益' }
  },

  // 工单系统路由
  {
    path: '/tickets',
    name: 'tickets',
    component: () => import('@/views/TicketsView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.tickets', title: '工单' }
  },
  // Help articles (public access)
  {
    path: '/help',
    name: 'help',
    component: () => import('@/views/HelpView.vue'),
    meta: { titleKey: 'nav.help', title: '帮助' }
  },
  {
    path: '/help/:slug',
    name: 'help-article',
    component: () => import('@/views/HelpView.vue'),
    meta: { titleKey: 'nav.help', title: '帮助' }
  },
  // Inbox (notifications)
  {
    path: '/inbox',
    name: 'inbox',
    component: () => import('@/views/InboxView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.inbox', title: '通知' }
  },
  // 娱乐系统
  {
    path: '/entertainment',
    name: 'entertainment',
    component: () => import('@/views/EntertainmentView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.entertainment', title: '娱乐' }
  },
  // 集中式终端管理
  {
    path: '/terminal',
    name: 'terminal',
    component: () => import('@/views/TerminalView.vue'),
    meta: { requiresAuth: true, requiresUser: true, titleKey: 'nav.terminal', title: '终端' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { titleKey: 'error.notFound', title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 页面切换时滚动到顶部，解决页面切换后空白问题
  scrollBehavior(_to, _from, savedPosition) {
    if (_to.path === _from.path && _to.hash === _from.hash) {
      return false
    }
    if (savedPosition) {
      return savedPosition
    }
    return { top: 0, behavior: 'instant' }
  }
})

// 路由错误处理 - 捕获组件加载失败
router.onError((error) => {
  console.error('路由错误:', error)
  console.error('错误详情:', {
    message: error.message,
    name: error.name,
    stack: error.stack,
    url: window.location.href
  })
  // 如果是组件加载失败，尝试重新加载页面
  if (error.message?.includes('Failed to fetch dynamically imported module') ||
    error.message?.includes('Loading chunk') ||
    error.message?.includes('ChunkLoadError') ||
    error.name === 'ChunkLoadError') {
    console.warn('检测到代码块加载失败，尝试重新加载页面')
    // 延迟一下，避免快速重载循环
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }
})

// Route guard
router.beforeEach(async (to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const authStore = useAuthStore()
  const configStore = useConfigStore()

  // 检查是否有 OAuth 登录码需要处理
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has('oauth_code')) {
    // 先处理 OAuth 登录码，等待完成
    await handleOAuthCode()
  }

  // 如果有 token 但用户信息还没加载，先等待加载完成
  if (authStore.isAuthenticated && !authStore.user) {
    try {
      await authStore.fetchCurrentUser()
    } catch {
      // 加载失败，token 可能无效，会被 logout 清除
    }
  }
  
  // 如果配额信息未加载，尝试重新获取
  if (authStore.isAuthenticated && !authStore.quota && authStore.user) {
    try {
      await authStore.fetchCurrentUser()
    } catch {
      // 静默失败
    }
  }

  // Pages requiring authentication
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  if (to.name === 'tickets' && authStore.isAuthenticated && !authStore.isAdmin) {
    await configStore.loadPublicConfig()
    if (!configStore.ticketEnabled) {
      next({ name: 'dashboard' })
      return
    }
  }

  if (
    authStore.isAuthenticated &&
    !authStore.isAdmin &&
    typeof to.name === 'string' &&
    hiddenMailRouteNames.has(to.name)
  ) {
    await configStore.loadPublicConfig()
    if (!configStore.mailAvailable) {
      next({ name: 'dashboard' })
      return
    }
  }

  // Pages requiring user (non-admin) permission
  if ((to.meta.requiresAuth || to.meta.requiresUser) && authStore.isAdmin) {
    await authStore.logout()
    next({ name: 'login', query: { adminOnly: '1' } })
    return
  }

  if (
    !authStore.isAdmin &&
    typeof to.name === 'string' &&
    hiddenHostingRouteNames.has(to.name) &&
    authStore.user?.canAccessHostingFeature === false
  ) {
    next({ name: 'dashboard' })
    return
  }

  // 配额检查：普通用户不再需要配额检查（好友、节点、套餐功能已移除）

  // Authenticated users accessing login/register pages
  if (to.meta.guest && authStore.isAuthenticated) {
    if (authStore.isAdmin) {
      await authStore.logout()
      next({ name: 'login', query: { adminOnly: '1' } })
      return
    }
    next({ name: 'dashboard' })
    return
  }

  next()
})

// 预加载常用页面，提升切换速度
router.isReady().then(() => {
  // 延迟预加载，避免影响首屏加载
  setTimeout(() => {
    // 预加载核心页面
    import('@/views/DashboardView.vue')
    import('@/views/InstancesView.vue')
    import('@/views/InstanceDetailView.vue')
    import('@/views/ProfileView.vue')
    import('@/views/WalletView.vue')
    import('@/views/OrdersView.vue')
    import('@/views/TicketsView.vue')
  }, 1000)
})

export default router
